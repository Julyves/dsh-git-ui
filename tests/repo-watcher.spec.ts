import { describe, expect, it } from 'vitest'
import { RepoWatcherRegistry, type WatchFactory, type WatchHandle } from '../src/host/repo-watcher.ts'

/**
 * RepoWatcherRegistry 单测：假 watcher 工厂 + 短防抖实测。
 *
 * 覆盖：trailing 防抖、maxWait 饥饿防护、事件级排除、双面独立降级、
 * 引用计数共享与释放、版本不等式语义（重启归零自愈）。
 */

/** 假工厂：记录建立的监听，允许测试注入事件与异步错误。 */
function fakeFactory() {
  const handles: FakeHandle[] = []
  const factory: WatchFactory = (path, _options, onEvent, onError) => {
    const handle = new FakeHandle(path, onEvent, onError, () => {
      const at = handles.indexOf(handle)
      if (at >= 0) handles.splice(at, 1)
    })
    handles.push(handle)
    return handle
  }
  return { handles, factory }
}

class FakeHandle implements WatchHandle {
  closed = false
  constructor(
    readonly path: string,
    private readonly onEvent: (relative: string | null) => void,
    private readonly onError: (error: unknown) => void,
    private readonly onclose: () => void,
  ) {}
  close(): void {
    this.closed = true
    this.onclose()
  }
  /** 测试注入：一条文件事件。 */
  emit(relative: string | null): void {
    if (this.closed) throw new Error('emit on closed handle')
    this.onEvent(relative)
  }
  /** 测试注入：异步监听错误（应触发该面降级）。 */
  fail(error: unknown = new Error('ENOSPC')): void {
    if (this.closed) throw new Error('fail on closed handle')
    this.onError(error)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 两面（工作区+gitdir）常规模格(idleReleaseMs=0 保持立即释放语义,
 *  宽限行为由专门测试用小值验证)。 */
function normalSetup(debounceMs = 10, maxWaitMs = 80, excludes: readonly string[] = ['node_modules', '.git']) {
  const { handles, factory } = fakeFactory()
  const registry = new RepoWatcherRegistry(factory, { debounceMs, maxWaitMs, excludes, idleReleaseMs: 0 }, async () => '/repo/.git')
  return { handles, registry }
}

describe('RepoWatcherRegistry', () => {
  it('建立双监听面（工作区 root + 解析出的 gitdir）', async () => {
    const { handles, registry } = normalSetup()
    const watch = await registry.acquire('/repo')
    expect(handles.map((h) => h.path).sort()).toEqual(['/repo', '/repo/.git'])
    expect(watch.healthy).toBe(true)
    registry.disposeAll()
  })

  it('gitdir 解析失败 → 仅工作区单面（仍健康）', async () => {
    const { handles, factory } = fakeFactory()
    const registry = new RepoWatcherRegistry(factory, { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 0 }, async () => null)
    const watch = await registry.acquire('/repo')
    expect(handles).toHaveLength(1)
    expect(watch.healthy).toBe(true)
    registry.disposeAll()
  })

  it('trailing 防抖：静默 debounceMs 后版本 +1 一次', async () => {
    const { handles, registry } = normalSetup(20)
    const watch = await registry.acquire('/repo')
    const worktree = handles.find((h) => h.path === '/repo')
    worktree?.emit('src/a.ts')
    worktree?.emit('src/b.ts')
    worktree?.emit('src/c.ts')
    expect(watch.currentVersion()).toBe(0)
    await sleep(45)
    expect(watch.currentVersion()).toBe(1)
    registry.disposeAll()
  })

  it('maxWait 饥饿防护：持续事件风暴期间每 maxWait 至多 bump 一次', async () => {
    const { handles, registry } = normalSetup(50, 60)
    const watch = await registry.acquire('/repo')
    const worktree = handles.find((h) => h.path === '/repo')
    // 持续 130ms 的事件流（每 10ms 一条）——纯 trailing 永远等不到静默。
    for (let i = 0; i < 13; i += 1) {
      worktree?.emit(`src/f${i}.ts`)
      await sleep(10)
    }
    // 风暴窗口 ≥ maxWait(60ms)：至少一次立即 bump；总量有界（≤ 3）。
    const version = watch.currentVersion()
    expect(version).toBeGreaterThanOrEqual(1)
    expect(version).toBeLessThanOrEqual(3)
    registry.disposeAll()
  })

  it('事件级排除：node_modules 下的写入不 bump 版本', async () => {
    const { handles, registry } = normalSetup(10)
    const watch = await registry.acquire('/repo')
    const worktree = handles.find((h) => h.path === '/repo')
    worktree?.emit('node_modules/pkg/index.js')
    worktree?.emit('node_modules')
    await sleep(30)
    expect(watch.currentVersion()).toBe(0)
    registry.disposeAll()
  })

  it('gitdir 面事件同样计入版本（提交/切分支感知）', async () => {
    const { handles, registry } = normalSetup(10)
    const watch = await registry.acquire('/repo')
    handles.find((h) => h.path === '/repo/.git')?.emit('index')
    await sleep(30)
    expect(watch.currentVersion()).toBe(1)
    registry.disposeAll()
  })

  it('单面异步失败 → 该面关闭降级，另一面继续工作', async () => {
    const { handles, registry } = normalSetup(10)
    const watch = await registry.acquire('/repo')
    const gitdirHandle = handles.find((h) => h.path === '/repo/.git')
    gitdirHandle?.fail(new Error('ENOSPC: watch limit reached'))
    expect(gitdirHandle?.closed).toBe(true)
    expect(watch.healthy).toBe(true)
    // 工作区面仍在服务。
    handles.find((h) => h.path === '/repo')?.emit('README.md')
    await sleep(30)
    expect(watch.currentVersion()).toBe(1)
    registry.disposeAll()
  })

  it('同步失败（工厂返回 undefined）→ 该面 dead，不抛出', async () => {
    const factory: WatchFactory = () => undefined
    const registry = new RepoWatcherRegistry(factory, { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 0 }, async () => '/repo/.git')
    const watch = await registry.acquire('/repo')
    expect(watch.healthy).toBe(false)
    expect(watch.currentVersion()).toBe(0)
    registry.disposeAll()
  })

  it('引用计数：同 root 多次 acquire 共享一份；全释放才关闭', async () => {
    const { handles, registry } = normalSetup()
    await registry.acquire('/repo')
    await registry.acquire('/repo')
    await registry.acquire('/repo')
    // 双面 × 1 份（共享）。
    expect(handles).toHaveLength(2)
    const watch = await registry.acquire('/repo')
    watch.release()
    watch.release()
    expect(handles.every((h) => !h.closed)).toBe(true)
    watch.release()
    watch.release()
    expect(handles.every((h) => h.closed)).toBe(true)
  })

  it('版本不等式：进程重启（全新注册表）后 version 归零，changedSince 自愈为 true', async () => {
    const { handles, factory } = fakeFactory()
    const registryA = new RepoWatcherRegistry(factory, { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 0 }, async () => '/repo/.git')
    const watch = await registryA.acquire('/repo')
    handles.find((h) => h.path === '/repo')?.emit('a.ts')
    await sleep(30)
    const before = watch.currentVersion()
    expect(before).toBe(1)
    expect(watch.changedSince(0)).toBe(true)
    expect(watch.changedSince(1)).toBe(false)
    registryA.disposeAll()
    // 「进程重启」：全新注册表(持久计数随之清零)——客户端持有的旧版本
    // 经不等式自愈为 changed(一次多余刷新后重新对齐)。
    const registryB = new RepoWatcherRegistry(factory, { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 0 }, async () => '/repo/.git')
    const reborn = await registryB.acquire('/repo')
    expect(reborn.changedSince(before)).toBe(true)
    registryB.disposeAll()
  })

  it('重挂间隙版本不闪断：refCount 触零销毁后重建,代数继承不归零', async () => {
    // 回归锁:客户端 watch 循环「驻留结束→立即重挂」的毫秒级间隙会让
    // refCount 触零——版本若随实例销毁归零,每次重挂都假报 changed,
    // 事件驱动退化为每心跳一次全量快照(smoke 7d 抓获的真实缺陷)。
    const { handles, registry } = normalSetup(10)
    const first = await registry.acquire('/repo')
    handles.find((h) => h.path === '/repo')?.emit('a.ts')
    await sleep(30)
    expect(first.currentVersion()).toBe(1)
    expect(registry.versionOf('/repo')).toBe(1)
    // 驻留结束:引用触零,监听资源释放。
    first.release()
    // 间隙后重挂:新实例继承持久代数——对当前版本(1)判定「未变更」。
    const second = await registry.acquire('/repo')
    expect(second.currentVersion()).toBe(1)
    expect(second.changedSince(1)).toBe(false)
    expect(second.changedSince(0)).toBe(true)
    registry.disposeAll()
  })

  it('并发首建去重：await 间隙的并发 acquire 共享同一实例(复审 M1)', async () => {
    // 回归锁:resolveGitDir 的 await 间隙,并发 acquire 不得各建实例——
    // 双实例 = 双份内核 watcher + 版本表双写,共享契约破坏。
    const { handles, factory } = fakeFactory()
    // 慢解析:收集全部等待者的 resolver,两个 acquire 都进入 await 间隙
    // 后一次放行(各自 promise 各自 resolve)。
    const resolvers: Array<(value: string | null) => void> = []
    const registry = new RepoWatcherRegistry(
      factory,
      { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 0 },
      () => new Promise((resolve) => { resolvers.push(resolve) }),
    )
    const first = registry.acquire('/repo')
    const second = registry.acquire('/repo')
    await sleep(5)
    for (const resolve of resolvers.splice(0)) resolve('/repo/.git')
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(handles).toHaveLength(2) // 双面 × 1 份
    a.release()
    b.release()
    expect(handles.every((h) => h.closed)).toBe(true)
  })

  it('心跳拆建防护：释放宽限期内 acquire 复用同一实例(复审 R5)', async () => {
    const { handles, factory } = fakeFactory()
    const registry = new RepoWatcherRegistry(
      factory,
      { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 40 },
      async () => '/repo/.git',
    )
    const first = await registry.acquire('/repo')
    first.release() // 触零 → 宽限计时(40ms)而非立即关闭
    expect(handles.every((h) => !h.closed)).toBe(true)
    // 心跳间隙内的重挂:复用同实例,零重建。
    const second = await registry.acquire('/repo')
    expect(second).toBe(first)
    second.release()
    expect(handles.every((h) => !h.closed)).toBe(true) // 宽限重启
    // 宽限到期且无新引用 → 真正关闭。
    await sleep(80)
    expect(handles.every((h) => h.closed)).toBe(true)
  })

  it('disposeAll 解析窗口：不建活监听,空实例继承持久版本(复审 R3)', async () => {
    const { handles, factory } = fakeFactory()
    const resolvers: Array<(value: string | null) => void> = []
    const registry = new RepoWatcherRegistry(
      factory,
      { debounceMs: 10, maxWaitMs: 80, excludes: [], idleReleaseMs: 0 },
      () => new Promise((resolve) => { resolvers.push(resolve) }),
    )
    // 先建一份并 bump 到版本 1(写入持久计数)——首次 acquire 的门闩
    // 解析器需先放行才会结算。
    const warmPending = registry.acquire('/repo')
    await sleep(5)
    for (const resolve of resolvers.splice(0)) resolve('/repo/.git')
    const warm = await warmPending
    handles.find((h) => h.path === '/repo')?.emit('a.ts')
    await sleep(30)
    expect(warm.currentVersion()).toBe(1)
    warm.release()
    // 解析窗口内整体回收,再放行第二次 acquire。
    const pending = registry.acquire('/repo')
    await sleep(5)
    registry.disposeAll()
    for (const resolve of resolvers.splice(0)) resolve('/repo/.git')
    const after = await pending
    // 不建活监听(空实例全 dead),且版本继承持久计数——恒 0 会令卸载
    // 窗口内的在途 watch 每次假报 changed(R1 同源风暴)。
    expect(after.healthy).toBe(false)
    expect(after.currentVersion()).toBe(1)
    expect(after.changedSince(1)).toBe(false)
  })

  it('双面全挂死亡唤醒:驻留订阅者即时收到通知(复审 P1-4)', async () => {
    const { handles, registry } = normalSetup(10)
    const watch = await registry.acquire('/repo')
    let notified = 0
    const off = watch.onChange(() => { notified += 1 })
    // 第一面死亡:仍单面存活,不唤醒。
    handles.find((h) => h.path === '/repo')?.fail(new Error('ENOSPC'))
    expect(notified).toBe(0)
    // 第二面死亡:双面全挂 → 立即唤醒(驻留查询即时降级结算,不等心跳)。
    handles.find((h) => h.path === '/repo/.git')?.fail(new Error('ENOSPC'))
    expect(notified).toBe(1)
    off()
    registry.disposeAll()
  })

  it('disposeAll：关闭全部并停止新建', async () => {
    const { handles, registry } = normalSetup()
    await registry.acquire('/repo')
    registry.disposeAll()
    expect(handles.every((h) => h.closed)).toBe(true)
    const after = await registry.acquire('/repo')
    expect(after.healthy).toBe(false)
  })

  it('订阅通知：版本 bump 唤醒全部订阅者，取消订阅后不再收到', async () => {
    const { handles, registry } = normalSetup(10)
    const watch = await registry.acquire('/repo')
    let notified = 0
    const off = watch.onChange(() => { notified += 1 })
    handles.find((h) => h.path === '/repo')?.emit('a.ts')
    await sleep(30)
    expect(notified).toBe(1)
    off()
    handles.find((h) => h.path === '/repo')?.emit('b.ts')
    await sleep(30)
    expect(notified).toBe(1)
    registry.disposeAll()
  })
})
