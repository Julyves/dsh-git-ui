/**
 * Host 端点契约:纯业务逻辑,零框架依赖。
 *
 * 将 `snapshotForSession` / `runAction` / `runQuery` 聚合为统一的
 * `HostEndpoints` 接口——宿主适配层(Cordis/typert 或其他框架)只需调用
 * `createHostEndpoints(deps, config)` 即可获得全部端点方法,再以任何
 * RPC 机制暴露。业务层对此一无所知。
 */
import { snapshotForSession, type GitStatusConfig, type SnapshotDeps } from '../host/core.ts'
import { runAction } from '../host/actions.ts'
import { runQuery } from '../host/queries.ts'
import type { GitActionRequest, GitActionResult, GitQueryRequest, GitQueryResponse, GitSnapshotRequest, GitSnapshotResult } from '../host/types.ts'

/**
 * 业务端点集合:三个 RPC 方法的纯函数实现。
 * 每个方法接收 wire 请求、可选取消信号,返回 wire 响应。
 */
export interface HostEndpoints {
  snapshot(request: GitSnapshotRequest, signal?: AbortSignal): Promise<GitSnapshotResult>
  run(request: GitActionRequest, signal?: AbortSignal): Promise<GitActionResult>
  query(request: GitQueryRequest, signal?: AbortSignal): Promise<GitQueryResponse>
}

/** turn-records 查询后端(适配层注入;业务端点只做路由)。 */
export interface TurnRecordsBackend {
  run(sessionId: string, signal?: AbortSignal): Promise<GitQueryResponse>
}

/**
 * watch 查询后端(适配层注入;业务端点只做路由)。
 * 携带客户端已知版本与等待时长;版本不一致立即返回,一致时挂起至
 * waitMs(clamp 后)或版本变化/中止。signal 为 RPC 取消槽——客户端
 * 卸载会话时宿主侧驻留即时释放。
 */
export interface WatchBackend {
  run(sessionId: string, version: number, waitMs: number, signal?: AbortSignal): Promise<GitQueryResponse>
}

/**
 * 构造业务端点实例。
 *
 * `deps` 携带全部宿主能力(子进程、会话查找、文件系统);`config` 携带
 * 运行参数;`records`(可选)承载 turn-records 查询后端,`watch`(可选)
 * 承载文件监听后端——两者缺省时对应查询返回 git-error(降级)。返回的
 * 端点对象可直接绑定到 RPC 装饰器、HTTP 路由、或测试桩。
 */
export function createHostEndpoints(
  deps: SnapshotDeps,
  config: GitStatusConfig,
  records?: TurnRecordsBackend,
  watch?: WatchBackend,
): HostEndpoints {
  return {
    snapshot(request, signal) {
      // 合并调用方信号与 deps 自带信号(deps.signal 来自 Cordis Remote 的
      // 取消槽;此处 signal 来自适配层传入——两者取并集,任一触发即中止)。
      const merged = mergeSignals(deps.signal, signal)
      const effectiveDeps = merged === deps.signal ? deps : { ...deps, signal: merged }
      return snapshotForSession(effectiveDeps, config, request.sessionId)
    },
    run(request, signal) {
      const merged = mergeSignals(deps.signal, signal)
      const effectiveDeps = merged === deps.signal ? deps : { ...deps, signal: merged }
      return runAction(effectiveDeps, config, request)
    },
    query(request, signal) {
      if (request.query.kind === 'turn-records') {
        if (records === undefined) {
          return Promise.resolve({
            ok: false,
            error: { code: 'git-error', message: 'turn-records unavailable' },
          })
        }
        return records.run(request.sessionId, signal)
      }
      if (request.query.kind === 'watch') {
        if (watch === undefined) {
          return Promise.resolve({
            ok: false,
            error: { code: 'git-error', message: 'watch unavailable' },
          })
        }
        return watch.run(request.sessionId, request.query.version, request.query.waitMs, signal)
      }
      const merged = mergeSignals(deps.signal, signal)
      const effectiveDeps = merged === deps.signal ? deps : { ...deps, signal: merged }
      return runQuery(effectiveDeps, config, request)
    },
  }
}

/** 合并两个可选信号:任一 undefined 取另一个,均存在则 AbortSignal.any。 */
function mergeSignals(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return AbortSignal.any([a, b])
}