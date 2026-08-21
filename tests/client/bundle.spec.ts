/**
 * 构建产物冒烟测试：client bundle 必须注册 ModuleLoader 交接，
 * 且 factory 返回插件形态。在模拟 loader 环境中运行真实 `lib/client.js`
 * （需先 `pnpm build`）。
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

/** react 桩：覆盖 bundle 顶层与组件内用到的钩子（memo 为顶层调用）。 */
const reactStub = {
  createElement: () => {},
  jsx: () => {},
  memo: (component: unknown) => component,
  useCallback: (fn: unknown) => fn,
  useLayoutEffect: () => {},
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useState: () => [undefined, () => {}],
  useMemo: (fn: unknown) => (typeof fn === 'function' ? (fn as () => unknown)() : fn),
  createContext: () => ({ Provider: (props: unknown) => props }),
  useContext: () => undefined,
}

interface Captured {
  id: string
  factory: (requireFn: (spec: string) => unknown) => { name: string; inject: readonly string[]; apply: unknown }
}

function loadBundle(): Captured {
  const code = readFileSync(resolve(import.meta.dirname, '../../lib/client.js'), 'utf8')
    .replace(/\/\/# sourceMappingURL=.*$/s, '')
  let captured: Captured | undefined
  const requireStub = (spec: string): unknown => {
    if (spec === 'react' || spec === 'react/jsx-runtime') return reactStub
    if (spec === 'react-dom') return { createPortal: () => null }
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
      return {
        Modal: () => null, Button: () => null, Toast: () => null,
      }
    }
    throw new Error(`unexpected require: ${spec}`)
  }
  vm.runInNewContext(code, {
    window: { __ModuleLoader__: { load: (payload: Captured) => { captured = payload } } },
    require: requireStub,
    module: { exports: {} },
    exports: {},
    console,
  })
  if (captured === undefined) throw new Error('bundle did not register a ModuleLoader handoff')
  return captured
}

describe('client bundle artifact', () => {
  it('registers the dsh-git-ui handoff and returns the plugin shape', () => {
    const { id, factory } = loadBundle()
    expect(id).toBe('dsh-git-ui')
    const plugin = factory((spec) => {
      if (spec === 'react' || spec === 'react/jsx-runtime') return reactStub
      if (spec === 'react-dom') return { createPortal: () => null }
      if (spec === '@deepseek-ai/dsh-client-ui-primitives') {
        return {
          Modal: () => null, Button: () => null, Toast: () => null,
        }
      }
      throw new Error(`unexpected require: ${spec}`)
    })
    expect(plugin.name).toBe('dsh-git-ui')
    expect(plugin.inject).toEqual(['slots', 'remote', 'locale'])
    expect(typeof plugin.apply).toBe('function')
  })
})
