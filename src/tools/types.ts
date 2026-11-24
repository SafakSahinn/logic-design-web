// ToolRunner types (Aşama 6.0c).
//
// The ToolRunner runs external EDA tools (ghdl, yosys, nextpnr, ...) behind one interface.
// Callers never know where a tool runs:
// - "native": the desktop app runs an installed executable through Electron IPC (lds-tool:*).
// - "wasm":   a WebAssembly build runs in a Web Worker (web, and desktop fallback).
//
// Every run happens in its own empty working directory. Input files are written there, the tool runs
// with that directory as its current directory, and only the files named in `outputs` are read back.
// File names are therefore always relative ("top.v", "build/out.json"), never absolute and never "..".

/** Tools the runner knows. The list is closed on purpose: the desktop backend only starts these. */
export type ToolId =
  | 'ghdl'
  | 'yosys'
  | 'nextpnr-ecp5'
  | 'ecppack'
  | 'nextpnr-xilinx'
  | 'fasm2frames'
  | 'xc7frames2bit'
  | 'openfpgaloader'
  // Vendor FPGA tools (Aşama 6k): desktop only, the user's own install; the page sends an option line, the main
  // process builds the script from a fixed template (electron/vendorPolicy.cjs, vendorScripts.cjs)
  | 'vivado'
  | 'quartus'
  | 'ise'
  | 'tcl';

export type ToolBackendKind = 'native' | 'wasm';

/** File contents: text is written as UTF-8 */
export type ToolFileData = string | Uint8Array;

export interface ToolProgress {
  /** "download": fetching a WASM build; "run": the tool is running */
  phase: 'download' | 'run';
  /** Download progress in bytes (phase "download") */
  loaded?: number;
  total?: number;
  /** One line the tool printed (phase "run") */
  line?: string;
  stream?: 'stdout' | 'stderr';
}

export interface ToolRunRequest {
  tool: ToolId;
  args: string[];
  /** Input files, keyed by relative path */
  files?: Record<string, ToolFileData>;
  /** Relative paths to read back after the run; a missing output is simply absent from the result */
  outputs?: string[];
  /** Kill the tool after this many milliseconds (default DEFAULT_TIMEOUT_MS) */
  timeoutMs?: number;
  /** Aborting cancels the run; the promise then rejects with a ToolError of kind "cancelled" */
  signal?: AbortSignal;
  onProgress?: (progress: ToolProgress) => void;
  /** Force one backend instead of the automatic choice (tests, settings) */
  backend?: ToolBackendKind;
}

export interface ToolRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Output files that existed after the run, keyed by the requested relative path */
  files: Record<string, Uint8Array>;
  backend: ToolBackendKind;
  durationMs: number;
}

/** Why a tool cannot run right now */
export type ToolUnavailableReason =
  | 'not-installed' // desktop: no executable found and no WASM build
  | 'web-unsupported' // web: the tool has no WASM build (e.g. ghdl)
  | 'download-required' // a WASM build exists but the user has not agreed to download it yet
  | 'no-backend'; // neither backend is present in this build

export interface ToolStatus {
  tool: ToolId;
  available: boolean;
  /** The backend runTool() would use */
  backend?: ToolBackendKind;
  version?: string;
  reason?: ToolUnavailableReason;
  /** Approximate size of the WASM download, when reason is "download-required" */
  downloadMB?: number;
}

export type ToolErrorKind =
  | 'unavailable' // see ToolStatus.reason
  | 'cancelled'
  | 'timeout'
  | 'stalled' // a vendor tool printed nothing at all after it started (hung while starting)
  | 'bad-request' // unknown tool, absolute or ".." path, ...
  | 'busy' // a tool that runs one at a time (openFPGALoader) is already running
  | 'output-limit' // the tool printed more than the backend accepts
  | 'internal';

export class ToolError extends Error {
  readonly kind: ToolErrorKind;
  readonly tool: ToolId | undefined;
  readonly reason: ToolUnavailableReason | undefined;

  constructor(kind: ToolErrorKind, message: string, tool?: ToolId, reason?: ToolUnavailableReason) {
    super(message);
    this.name = 'ToolError';
    this.kind = kind;
    this.tool = tool;
    this.reason = reason;
  }
}

/** One way of running tools; the runner picks a backend per tool */
export interface ToolBackend {
  readonly kind: ToolBackendKind;
  /** Can this backend run the tool now? (cheap, cached by the backend) */
  probe(tool: ToolId): Promise<{ available: boolean; version?: string; reason?: ToolUnavailableReason }>;
  run(request: ToolRunRequest): Promise<ToolRunResult>;
}

export const DEFAULT_TIMEOUT_MS = 60_000;
