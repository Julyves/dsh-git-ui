/**
 * 语法高亮服务：shiki core（JavaScript 正则引擎，无 WASM/oniguruma，bundle
 * 友好）+ 显式 grammar 白名单（同步注册——diff 场景语言集固定且数量可控，
 * 不需要平台的懒加载机制）。
 *
 * 主题：CSS 变量主题（`createCssVariablesTheme`，前缀 `--shiki-`）。颜色
 * 全部落在 CSS 变量上——宿主 web 主题（ui-theme 的 shiki token sheets）已
 * 全局注入亮/暗两套 `--shiki-*` 值；即使变量缺席（本地预览/测试环境），
 * `color: var(--shiki-…)` 会回退继承文字色，安全降级为纯文本。
 *
 * 时序设计（关键——宿主启动/首帧零阻塞）：
 *   - **模块加载不做任何工作**：不在 factory 顶层挂定时器、不预热——
 *     DSH 的 module-table 加载时机落在宿主 boot/会话恢复关键序列，
 *     任何同步任务或抢占式宏任务都可能拖垮首屏；
 *   - 首次高亮请求（打开 diff 时）**异步**触发构造（微任务让出当前渲染帧），
 *     构造完成前 `highlightLines` 返回 undefined → 调用方渲染纯文本；
 *   - 构造完成后经 `subscribeHighlightReady` 通知调用方重渲染（与
 *     `useSettings` 同款 effect+subscribe 订阅模式，无 useSyncExternalStore）。
 *
 * 与 React 无关（纯函数 + 惰性单例）；整块 `codeToTokens` 后按行切分，
 * 跨行 token（注释块 / 多行字符串）保持正确——这是逐行高亮的本质缺陷，
 * 平台 Diff/ReadBlock 同用此路径。
 */

import { createHighlighterCoreSync, createCssVariablesTheme } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import type { HighlighterCore } from 'shiki/core'
import langTs from '@shikijs/langs/typescript'
import langJson from '@shikijs/langs/json'
import langYaml from '@shikijs/langs/yaml'
import langToml from '@shikijs/langs/toml'
import langIni from '@shikijs/langs/ini'
import langMarkdown from '@shikijs/langs/markdown'
import langXml from '@shikijs/langs/xml'
import langCss from '@shikijs/langs/css'
import langPython from '@shikijs/langs/python'
import langBash from '@shikijs/langs/shellscript'
import langJava from '@shikijs/langs/java'
import langGo from '@shikijs/langs/go'
import langRust from '@shikijs/langs/rust'
import langC from '@shikijs/langs/c'
import langCsharp from '@shikijs/langs/csharp'
import langKotlin from '@shikijs/langs/kotlin'
import langSql from '@shikijs/langs/sql'
import langMake from '@shikijs/langs/make'

/**
 * 一个高亮片段：文本 + shiki 分配的 inline 颜色（CSS 变量引用）。
 */
export interface HighlightSpan {
  readonly text: string
  readonly style: { readonly color?: string }
}

/**
 * 显式 grammar 白名单（单文件 bundle 预算约束下的取舍）。
 *
 * 排除的重量级 grammar 与替代（详见 lang-map 注释）：
 *   - ruby → 依赖图携带 cpp(817KB)+graphql+haml+JS 全家，拉入成本极高；
 *   - html/javascript/jsx/tsx → html 以 xml 近似（超集，基础 token 正确）；
 *   - cpp/php/swift/less/scss/lua → 由近邻 grammar 近似或回落纯文本。
 * 缺语言的类型回落纯文本（无错误），不会炸渲染。
 */
const LANGS = [
  langTs, langJson, langYaml, langToml, langIni, langMarkdown,
  langXml, langCss,
  langPython, langBash, langJava, langGo, langRust,
  langC, langCsharp, langKotlin, langSql, langMake,
]

/** 全部 token 颜色经 `--shiki-*` 自定义属性解析（宿主主题 sheet 提供亮/暗两套）。 */
const theme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/**
 * 正则引擎：**惰性编译**（shiki 默认，不覆盖 regexConstructor）。
 *
 * 与 platform 的取舍不同——platform 用 eager（lazyCompileLength: Infinity）
 * 把编译挪到预热，因为它的 boot grammar 只有 3 个；我们注册 18 个 grammar，
 * **eager 会在首次扫描时一次性编译全部 pattern（实测 Node 284ms；用户浏览器
 * 慢 3-5 倍 → 渲染关键路径上 1s+ 的集中长任务——这是插件导致 dsh「加载卡死」
 * 的根因之一）**。惰性编译把成本**按语言、按首次使用**分散：
 * 单语言首次扫描 1-30ms（Node 实测），渲染路径可接受。
 * `forgiving: true` 保留：无效 pattern 不抛错（回退占位），高亮永不崩。
 */
const engine = createJavaScriptRegexEngine({
  forgiving: true,
})

let singleton: HighlighterCore | undefined
/** 构造是否已在途（幂等：同一时刻至多一次）。 */
let constructing = false
/** 就绪通知订阅者（渲染层重渲）。 */
const readyListeners = new Set<() => void>()
/** 每次构造完成递增；组件以它为 useMemo 依赖触发重算。 */
let readyCount = 0
/** 构造失败原因（最后一次；诊断与测试用）。 */
let lastFailure: string | undefined
/** 失败是否已上报（每个失败原因只 console.warn 一次——防刷屏）。 */
let warnedFailure: string | undefined

/**
 * 订阅高亮就绪（构造完成）；返回取消订阅函数。
 * 与 useSettings 同款订阅形状——不使用 useSyncExternalStore。
 */
export function subscribeHighlightReady(listener: () => void): () => void {
  readyListeners.add(listener)
  return () => { readyListeners.delete(listener) }
}

/** 构造完成计数（订阅者重渲染的稳定标识）。 */
export function highlightReadyCount(): number {
  return readyCount
}

/**
 * 显式启动构造（幂等；供订阅方调用）。
 *
 * 组件层在 ready 前**不调用** `highlightLines`（`ready>0` 短路），因此构造
 * 不能只由高亮调用触发——订阅方（useHighlightReady）挂载时调用本入口启动，
 * 否则就绪事件永不到来（蛋鸡死锁：未就绪 → 不调用 → 永不就绪）。
 */
export function ensureHighlightInit(): void {
  ensureConstructing()
}

/** 构造失败原因（undefined = 未曾失败或已就绪）；诊断/测试用。 */
export function highlightFailureReason(): string | undefined {
  return singleton !== undefined ? undefined : lastFailure
}

/** 异步触发构造（幂等，让出当前帧）；失败自动重试（下次调用再触发）。 */
function ensureConstructing(): void {
  if (singleton !== undefined || constructing) return
  constructing = true
  // 微任务让出当前渲染帧；构造是同步 CPU 长任务，安排在空闲时机执行。
  void Promise.resolve().then(() => {
    try {
      singleton = createHighlighterCoreSync({ themes: [theme], langs: LANGS, engine })
      readyCount += 1
      lastFailure = undefined
      // 一次性就绪日志：环境异常定位用，成功路径仅一条。
      if (typeof console !== 'undefined') console.info('[dsh-git-ui] syntax highlight ready')
      for (const listener of [...readyListeners]) listener()
    } catch (error) {
      // 构造失败（环境异常/版本问题）：保持未就绪 → 渲染恒为纯文本。
      // 原因上报一次（同类错误不刷屏）；下次调用自动重试。
      lastFailure = error instanceof Error ? error.message : String(error)
      if (lastFailure !== warnedFailure) {
        warnedFailure = lastFailure
        if (typeof console !== 'undefined') console.warn('[dsh-git-ui] syntax highlight init failed:', lastFailure)
      }
    } finally {
      constructing = false
    }
  })
}

/**
 * 整块 tokenize（2D 行结构）。`code` 为完整文件文本；未知语言或构造
 * 未就绪时返回 undefined（渲染层回落纯文本）。每个 run 的 color 是
 * `--shiki-*` 变量引用，与 platform HTML 路径同一主题系统。
 */
export function highlightLines(code: string, lang: string): HighlightSpan[][] | undefined {
  ensureConstructing()
  const instance = singleton
  if (instance === undefined) return undefined
  try {
    const { tokens } = instance.codeToTokens(code, { lang, theme: 'css-variables' })
    const last = tokens[tokens.length - 1]
    const lines = tokens.length > 1 && last !== undefined && last.length === 0
      ? tokens.slice(0, -1)
      : tokens
    return lines.map((line) => line.map((token) => ({ text: token.content, style: { color: token.color } })))
  } catch {
    // grammar 缺失 / 引擎异常（防御）：回落纯文本，绝不炸渲染。
    return undefined
  }
}
