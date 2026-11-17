// Public entry of the in-process Tcl runtime (Aşama 6d). Import from 'src/tools/tcl'.
export { loadTclRuntime, currentTclRuntime, onTclRuntimeLoaded, tclBaseUrl } from './runtime';
export { TclSandbox, DEFAULT_TCL_LIMITS, OUTPUT_LIMIT, RECURSION_LIMIT, MAX_TEXT_BYTES } from './sandbox';
export type { TclLimits, TclOutcome } from './sandbox';
export { tclString, WACL_FILES } from './wacl';
export type { WaclEnvironment, WaclLoadOptions, WaclRuntime } from './wacl';
