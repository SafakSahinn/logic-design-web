// Tool definitions (Aşama 6.0c): which tools exist and where each one can run.
//
// The desktop main process keeps its own copy of the native part of this table (electron/toolRunner.cjs).
// That copy is the security boundary: the renderer sends only a ToolId, and the main process decides which
// executable that id means. Keep the two tables in step when a tool is added.
import type { ToolId } from './types';

export interface NativeToolInfo {
  /** Executable base name looked up on PATH ("ghdl" -> ghdl.exe on Windows) */
  executable: string;
  /** Arguments that print the version (used by probe) */
  versionArgs: string[];
}

export interface WasmToolInfo {
  /** npm package that provides the WASM build, loaded on first use */
  pkg: string;
  /**
   * Exact package version. The build is loaded from jsDelivr at this pinned version (published npm versions are
   * immutable and the CDN serves them with a one-year immutable cache), so the app bundle stays small.
   * Empty while the tool's WASM build is not wired up yet: the WASM backend then reports "no-backend".
   */
  version: string;
  /** Export of that package that runs the tool, e.g. runYosys */
  entry: string;
  /** Approximate first download size; the user is asked before downloading */
  downloadMB: number;
  /**
   * The build runs in the page itself instead of the worker backend (Tcl: the simulation needs synchronous
   * answers, see src/tools/tcl). runTool() refuses such a tool; its own module loads it from `path`.
   */
  inProcess?: { path: string };
}

export interface ToolDefinition {
  id: ToolId;
  /** Shown as is (tool names are not translated) */
  displayName: string;
  native?: NativeToolInfo;
  wasm?: WasmToolInfo;
  /** Which roadmap steps use the tool (documentation only) */
  usedBy: string[];
}

export const TOOL_DEFINITIONS: Record<ToolId, ToolDefinition> = {
  ghdl: {
    id: 'ghdl',
    displayName: 'GHDL',
    native: { executable: 'ghdl', versionArgs: ['--version'] },
    // No WASM build exists: on the web the VHDL features show the "desktop only" notice.
    usedBy: ['6b'],
  },
  yosys: {
    id: 'yosys',
    displayName: 'Yosys',
    native: { executable: 'yosys', versionArgs: ['-V'] },
    wasm: { pkg: '@yowasp/yosys', version: '0.70.1258', entry: 'runYosys', downloadMB: 80 },
    usedBy: ['6c', '6j'],
  },
  'nextpnr-ecp5': {
    id: 'nextpnr-ecp5',
    displayName: 'nextpnr-ecp5',
    native: { executable: 'nextpnr-ecp5', versionArgs: ['--version'] },
    wasm: { pkg: '@yowasp/nextpnr-ecp5', version: '0.11.825', entry: 'runNextpnrEcp5', downloadMB: 172 },
    usedBy: ['6j'],
  },
  ecppack: {
    id: 'ecppack',
    displayName: 'ecppack',
    native: { executable: 'ecppack', versionArgs: ['--version'] },
    // Ships in the same YoWASP package as nextpnr-ecp5 (most of the size is the ECP5 chip database).
    wasm: { pkg: '@yowasp/nextpnr-ecp5', version: '0.11.825', entry: 'runEcppack', downloadMB: 172 },
    usedBy: ['6j'],
  },
  tcl: {
    id: 'tcl',
    displayName: 'Tcl',
    // Runs the same WASM interpreter (wacl, Tcl 8.6.6) everywhere so scripts behave identically; no native
    // tclsh on purpose (Tcl can exec). wacl has no npm package of its own: LiveCodes ships it in
    // @live-codes/browser-compilers (wacl.js 0.2 MB + wacl.wasm 1.9 MB + Tcl library 2.3 MB).
    wasm: {
      pkg: '@live-codes/browser-compilers',
      version: '0.22.10',
      entry: 'wacl',
      downloadMB: 5,
      inProcess: { path: 'dist/wacl/' },
    },
    usedBy: ['6d'],
  },
};

export const TOOL_IDS = Object.keys(TOOL_DEFINITIONS) as ToolId[];

export function isToolId(value: unknown): value is ToolId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TOOL_DEFINITIONS, value);
}

export function getToolDefinition(id: ToolId): ToolDefinition {
  return TOOL_DEFINITIONS[id];
}

/** CDN address of a WASM build's ES module, or null when the build is not wired up yet or runs in-process */
export function wasmModuleUrl(wasm: WasmToolInfo): string | null {
  if (!wasm.version || wasm.inProcess) return null;
  return `https://cdn.jsdelivr.net/npm/${wasm.pkg}@${wasm.version}/gen/bundle.js`;
}

/** CDN folder of an in-process build (ends with "/"), or null */
export function inProcessBaseUrl(wasm: WasmToolInfo): string | null {
  if (!wasm.version || !wasm.inProcess) return null;
  return `https://cdn.jsdelivr.net/npm/${wasm.pkg}@${wasm.version}/${wasm.inProcess.path}`;
}

/**
 * A relative path inside the run directory: no drive letter, no leading slash, no "..", no empty or
 * "." segments, no NUL. Both backends enforce it; the desktop main process checks it again.
 */
export function isSafeRelativePath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0 || path.length > 260) return false;
  if (path.includes('\0') || path.includes(':')) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  return path.split(/[\\/]/).every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}
