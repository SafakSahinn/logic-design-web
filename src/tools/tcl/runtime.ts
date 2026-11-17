// The page's one Tcl runtime (Aşama 6d).
//
// wacl is loaded once and shared: every Tcl part gets its own sandbox (a safe child interpreter) inside it.
// Loading needs the download consent first: call prepareTool('tcl', confirm) from the UI, then loadTclRuntime().
// The simulation itself only uses currentTclRuntime(), which never loads anything.
import { getToolDefinition, inProcessBaseUrl } from '../registry';
import { loadWacl, type WaclLoadOptions, type WaclRuntime } from './wacl';

let loading: Promise<WaclRuntime> | null = null;
let current: WaclRuntime | null = null;
const listeners = new Set<() => void>();

/** CDN folder of the pinned wacl build */
export function tclBaseUrl(): string {
  const wasm = getToolDefinition('tcl').wasm;
  const url = wasm ? inProcessBaseUrl(wasm) : null;
  if (!url) throw new Error('No Tcl build is configured');
  return url;
}

/**
 * Loads wacl (or returns the loaded runtime). A runtime that aborted (out of memory) is replaced by a fresh one;
 * its sandboxes are gone with it and must be created again. While a load is running, later callers share it
 * (their onProgress is not called).
 */
export function loadTclRuntime(options: WaclLoadOptions = {}, baseUrl: string = tclBaseUrl()): Promise<WaclRuntime> {
  if (current && !current.broken) return Promise.resolve(current);
  if (current?.broken) {
    current = null;
    loading = null;
  }
  if (!loading) {
    loading = loadWacl(baseUrl, options).then(
      (runtime) => {
        current = runtime;
        for (const listener of listeners) listener();
        return runtime;
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
  }
  return loading;
}

/** The loaded runtime, or null (never starts a download) */
export function currentTclRuntime(): WaclRuntime | null {
  return current && !current.broken ? current : null;
}

/** Called whenever a runtime finished loading (the simulation can then start its Tcl parts) */
export function onTclRuntimeLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
