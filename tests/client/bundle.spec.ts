/**
 * Build artifact smoke test: the client bundle must register the ModuleLoader
 * handoff and the factory must return the plugin shape. Runs the actual
 * `lib/client.js` output in a simulated loader environment (requires the
 * bundle to exist — run `pnpm build` first).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

interface Captured {
  id: string
  factory: (requireFn: (spec: string) => unknown) => { name: string; inject: readonly string[]; apply: unknown }
}

function loadBundle(): Captured {
  const code = readFileSync(resolve(import.meta.dirname, '../../lib/client.js'), 'utf8')
    .replace(/\/\/# sourceMappingURL=.*$/s, '')
  let captured: Captured | undefined
  const requireStub = (spec: string): unknown => {
    if (spec === 'react' || spec === 'react/jsx-runtime') return { createElement: () => {}, jsx: () => {} }
    if (spec === 'react-dom') return { createPortal: () => null }
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
      if (spec === 'react' || spec === 'react/jsx-runtime') return { createElement: () => {}, jsx: () => {} }
      if (spec === 'react-dom') return { createPortal: () => null }
      throw new Error(`unexpected require: ${spec}`)
    })
    expect(plugin.name).toBe('dsh-git-ui')
    expect(plugin.inject).toEqual(['slots', 'remote', 'locale'])
    expect(typeof plugin.apply).toBe('function')
  })
})
