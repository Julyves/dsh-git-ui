/**
 * Browser module loader contract provided by dsh-client-modules (host half).
 * Client bundles register through `window.__ModuleLoader__.load({ id, factory })`;
 * `factory(require)` resolves platform modules from the loader module table.
 */
interface ModuleLoaderPayload {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => void
}

interface Window {
  __ModuleLoader__: { load(payload: ModuleLoaderPayload): void }
}
