/**
 * dsh-git-ui build script (self-contained; also runs as `prepare` for git
 * installs — must not assume a monorepo checkout or dev-only context).
 *
 * 1. Host half: tsc emits `lib/host/` (ESM, declarations). Never minified —
 *    the gateway SRC mode reflects method parameter names for argument
 *    validation, so renaming breaks the wire contract.
 * 2. Client half: esbuild bundles `src/client/index.ts` into one IIFE file
 *    `lib/client.js` — the `window.__ModuleLoader__.load({ id, factory })`
 *    closure format served by dsh-client-modules. Platform modules (react,
 *    @deepseek-ai/*) stay external and resolve through the loader module table;
 *    zod and other ordinary libraries are inlined.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)))

/** Platform modules the browser loader provides; must stay external in the bundle. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
]

/** External packages resolved at runtime: the host dsh installation provides
 * @deepseek-ai/* (peerDependencies); node builtins are auto-external. */
const HOST_EXTERNALS = ['@deepseek-ai/*']

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

// ── Host half: tsc declarations + esbuild bundle (never minified — the
//    gateway SRC mode reflects method parameter names for argument
//    validation, so renaming would break the wire contract) ───────────────
run('npx', ['tsc', '-p', 'tsconfig.build.json'])
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/host/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  external: HOST_EXTERNALS,
  minify: false,
  sourcemap: true,
  outfile: resolve(ROOT, 'lib/host/index.js'),
  logLevel: 'info',
})

// ── Client half: single-file bundle ───────────────────────────────────────
// CJS format + banner/footer wrap the whole bundle into the ModuleLoader
// handoff `load({ id, factory: (require) => { ... } })`: the factory IS the
// bundle body, so every external require (platform modules) resolves through
// the loader-provided `require` parameter at materialization time — matching
// the harness client-bundle contract (side effects run inside the factory).
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  minify: true,
  sourcemap: true,
  outfile: resolve(ROOT, 'lib/client.js'),
  logLevel: 'info',
  banner: {
    js: 'var module = { exports: {} }; var exports = module.exports;\n'
      + 'window.__ModuleLoader__.load({ id: "dsh-git-ui", factory: (require) => {',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

// ── Artifact assertions ───────────────────────────────────────────────────
const client = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
if (!client.includes('__ModuleLoader__.load')) {
  console.error('build: lib/client.js is missing the __ModuleLoader__.load entry')
  process.exit(1)
}
if (!client.includes("'dsh-git-ui'") && !client.includes('"dsh-git-ui"')) {
  console.error('build: lib/client.js does not carry the bundle id dsh-git-ui')
  process.exit(1)
}
for (const required of ['lib/host/index.js', 'lib/client.js']) {
  const path = resolve(ROOT, required)
  if (!existsSync(path)) {
    console.error(`build: missing artifact ${required}`)
    process.exit(1)
  }
}
mkdirSync(resolve(ROOT, 'lib'), { recursive: true })
writeFileSync(resolve(ROOT, 'lib/.keep'), '')
console.log('build: OK — lib/host/ (tsc) + lib/client.js (esbuild ModuleLoader closure)')
