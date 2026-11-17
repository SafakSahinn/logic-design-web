// wacl loader (Aşama 6d): Tcl 8.6 compiled to WebAssembly, run in-process.
//
// wacl (BSD-3, ecky-l) is an Emscripten build of Tcl 8.6.6 packaged as an AMD module ("tcl/wacl"). It has no
// npm package of its own; the app loads the copy LiveCodes ships in @live-codes/browser-compilers (MIT) from
// jsDelivr at a pinned version, like the YoWASP tools (see registry.ts).
//
// Why in-process and not in a worker: a Tcl part is evaluated inside the synchronous simulation step
// (PartDefinition.simulate), so the interpreter must answer synchronously. The build has a fixed 16 MB heap
// (no memory growth), Tcl user code only ever runs in a safe child interpreter with command / time limits
// (sandbox.ts), and the master interpreter's JavaScript bridges (::wacl::jscall, ::wacl::dom) are deleted
// right after start, so the master interpreter cannot reach the page either.
//
// Integrity: the four files are fetched by the app itself, checked against pinned SHA-256 digests and only then
// handed to wacl, through a local XMLHttpRequest that serves exactly those bytes (wacl.js loads its .wasm and
// .data files with XMLHttpRequest). A changed file on the CDN therefore never runs.
//
// Only three C functions are exported by this build: Wacl_GetInterp, Tcl_Eval, Tcl_GetStringResult.
// Every value that crosses into Tcl is therefore sent as hex text (see tclHex) and decoded by Tcl itself, so no
// user text is ever parsed as Tcl syntax by the master interpreter.

/** The files of @live-codes/browser-compilers@0.22.10 dist/wacl/ (update together with registry.ts) */
export const WACL_FILES: { path: string; sha256: string; bytes: number }[] = [
  { path: 'tcl/wacl.js', sha256: 'aaf15692eea0ac8bb2515a65a9f8bae5561cb032cb59b8bfc2659900c10c42c9', bytes: 240_213 },
  { path: 'tcl/wacl.wasm', sha256: '9f55db5a617fd154882bb93bbf333dad5af1d0d697e8076ed05896fb91b22e99', bytes: 1_884_110 },
  { path: 'tcl/wacl-library.data', sha256: '3a8e166c2197920e36c874e2fefae4ca6e0c4a920a443b8e1d2282c344d485f0', bytes: 2_307_994 },
  { path: 'tcl/wacl-custom.data', sha256: '46874b6dfe04b9c693815fe904a52e3583260323857dee46ac7373c484e3b2f8', bytes: 976 },
];

/** What the loader needs from its surroundings (the browser by default; tests pass their own) */
export interface WaclEnvironment {
  /** Fetches a file; onBytes reports how many bytes of it arrived so far */
  fetchBytes(url: string, onBytes: (loaded: number) => void): Promise<ArrayBuffer>;
  /** The object wacl treats as `window` (it reads window.location and deletes window.Module) */
  window: object;
}

export interface WaclLoadOptions {
  env?: WaclEnvironment;
  /** Download progress over all files, in bytes */
  onProgress?: (loaded: number, total: number) => void;
}

export interface WaclRuntime {
  /**
   * Evaluates a script in the master interpreter. Only the app's own fixed scripts go here, with user values
   * passed as hex; returns Tcl's completion code (0 = ok, 1 = error, ...) and the result string.
   */
  evalMaster(script: string): { code: number; result: string };
  /** True after the WebAssembly instance aborted (out of memory, ...); the runtime cannot be used again */
  readonly broken: boolean;
  /** Tcl patchlevel, e.g. "8.6.6" */
  readonly version: string;
}

interface WaclResult {
  Module: {
    cwrap(name: string, returnType: string | null, argTypes: string[]): (...args: unknown[]) => unknown;
  };
  interp: number;
}

interface WaclFactoryResult {
  onReady(callback: (result: WaclResult) => void): void;
}

const LOAD_TIMEOUT_MS = 120_000;

function browserEnvironment(): WaclEnvironment {
  return {
    fetchBytes: async (url, onBytes) => {
      const response = await fetch(url);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status} for ${url}`);
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onBytes(loaded);
      }
      const all = new Uint8Array(loaded);
      let at = 0;
      for (const chunk of chunks) {
        all.set(chunk, at);
        at += chunk.length;
      }
      return all.buffer;
    },
    window,
  };
}

/** Text as hex digits of its UTF-8 bytes (decoded in Tcl with [encoding convertfrom utf-8 [binary decode hex ..]]) */
export function tclHex(text: string): string {
  let out = '';
  for (const byte of new TextEncoder().encode(text)) out += byte.toString(16).padStart(2, '0');
  return out;
}

/** Tcl expression that yields `text` exactly, whatever characters it holds */
export function tclString(text: string): string {
  return `[encoding convertfrom utf-8 [binary decode hex ${tclHex(text)}]]`;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Fetches and verifies every wacl file; returns them keyed by full URL */
async function fetchVerified(baseUrl: string, env: WaclEnvironment, onProgress?: (loaded: number, total: number) => void) {
  const total = WACL_FILES.reduce((sum, f) => sum + f.bytes, 0);
  const loaded = new Map<string, number>();
  const report = () => onProgress?.([...loaded.values()].reduce((a, b) => a + b, 0), total);
  const files = new Map<string, ArrayBuffer>();
  await Promise.all(
    WACL_FILES.map(async (file) => {
      const url = `${baseUrl}${file.path}`;
      const data = await env.fetchBytes(url, (n) => {
        loaded.set(file.path, n);
        report();
      });
      const digest = await sha256Hex(data);
      if (digest !== file.sha256) throw new Error(`${file.path} does not match its pinned SHA-256 digest`);
      files.set(url, data);
    }),
  );
  return files;
}

/** The only XMLHttpRequest wacl sees: serves the verified files and refuses everything else */
function memoryXhr(files: Map<string, ArrayBuffer>) {
  return class MemoryXMLHttpRequest {
    responseType = '';
    status = 0;
    readyState = 0;
    response: ArrayBuffer | null = null;
    onload: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onprogress: ((event: unknown) => void) | null = null;
    private url = '';
    open(_method: string, url: string) {
      this.url = url;
      this.readyState = 1;
    }
    addEventListener(name: string, listener: (event: unknown) => void) {
      if (name === 'load') this.onload = listener;
      else if (name === 'error') this.onerror = listener;
      else if (name === 'progress') this.onprogress = listener;
    }
    setRequestHeader() {}
    overrideMimeType() {}
    getResponseHeader() {
      return null;
    }
    send() {
      setTimeout(() => {
        const data = files.get(this.url);
        this.readyState = 4;
        if (!data) {
          this.status = 404;
          this.onerror?.({ target: this });
          return;
        }
        this.status = 200;
        this.response = data.slice(0);
        this.onprogress?.({ target: this, loaded: data.byteLength, total: data.byteLength });
        this.onload?.({ target: this });
      }, 0);
    }
  };
}

/**
 * Loads wacl from `baseUrl` (the folder that holds tcl/wacl.js, tcl/wacl.wasm and the .data packages, ending
 * with "/"). The caller is responsible for the download consent (prepareTool('tcl')).
 */
export async function loadWacl(baseUrl: string, options: WaclLoadOptions = {}): Promise<WaclRuntime> {
  const env = options.env ?? browserEnvironment();
  const files = await fetchVerified(baseUrl, env, options.onProgress);
  const source = new TextDecoder().decode(files.get(`${baseUrl}tcl/wacl.js`));

  let factory: (() => WaclFactoryResult) | null = null;
  const define = (name: string, body: () => WaclFactoryResult) => {
    if (name === 'tcl/wacl') factory = body;
  };
  // wacl.js asks only require.toUrl("tcl/") for the folder its .wasm and .data files live in.
  const require = { toUrl: (path: string) => `${baseUrl}${path}` };
  // wacl prints through console.log / console.error (its start-up chatter, and the master interpreter's stdout,
  // which the app never uses). A local `console` keeps that out of the page console; the last lines are kept
  // for the error message when the start fails.
  const recent: string[] = [];
  const keep = (...args: unknown[]) => {
    recent.push(args.map(String).join(' '));
    if (recent.length > 20) recent.shift();
  };
  const quiet = { log: keep, error: keep, warn: keep, info: keep, debug: keep };
  const noFetch = () => Promise.reject(new Error('wacl may not fetch'));
  // The source is the verified wacl.js. Its free names define / require / window / console / XMLHttpRequest /
  // fetch resolve to the parameters below instead of the page's globals.
  new Function('define', 'require', 'window', 'console', 'XMLHttpRequest', 'fetch', source)(
    define,
    require,
    env.window,
    quiet,
    memoryXhr(files),
    noFetch,
  );
  const makeModule = factory as (() => WaclFactoryResult) | null;
  if (!makeModule) throw new Error('wacl.js did not define tcl/wacl');

  const ready = await new Promise<WaclResult>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`wacl did not start in time${recent.length ? `: ${recent.slice(-3).join(' | ')}` : ''}`)),
      LOAD_TIMEOUT_MS,
    );
    makeModule().onReady((result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });

  const evalRaw = ready.Module.cwrap('Tcl_Eval', 'number', ['number', 'string']) as (interp: number, script: string) => number;
  const resultRaw = ready.Module.cwrap('Tcl_GetStringResult', 'string', ['number']) as (interp: number) => string;
  const interp = ready.interp;
  let broken = false;

  const evalMaster = (script: string) => {
    if (broken) throw new Error('The Tcl runtime stopped and must be reloaded');
    try {
      const code = evalRaw(interp, script);
      return { code, result: resultRaw(interp) };
    } catch (error) {
      // An Emscripten abort (heap exhausted, ...) leaves the instance unusable.
      broken = true;
      throw error instanceof Error ? error : new Error(String(error));
    }
  };

  // Remove the master interpreter's JavaScript bridges: nothing in the app uses them.
  const bridges = evalMaster(
    'foreach c [info commands ::wacl::*] {rename $c {}}; catch {namespace delete ::wacl}; info patchlevel',
  );
  if (bridges.code !== 0) throw new Error(`wacl setup failed: ${bridges.result}`);
  const version = bridges.result;

  return {
    evalMaster,
    get broken() {
      return broken;
    },
    version,
  };
}
