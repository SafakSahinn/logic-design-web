// Simulation of the TCL Generic part: Logisim-evolution's TCL Generic protocol, run in-process in a Tcl sandbox.
//
// evo starts one tclsh per part with tcl_wrapper.tcl, which sources the user script and talks to Logisim over a
// socket. On every propagate evo sends all port values; on a new simulation tick ("sync_force") the wrapper sets
// the input variables, sets the output variables to X, calls the script's logisimForce and sends the output
// variables back; otherwise ("sync_examine") it calls logisimExamine and the outputs stay as they were.
// Here the wrapper's procs (examine, force, echo, ...) are installed in a safe child interpreter (src/tools/tcl)
// from fixed text, and the part calls them directly.
//
// One difference is forced by the engine: a step here moves signals one level, so on a tick the part may run
// before its inputs have settled. Within the run of a tick the part therefore calls logisimForce again whenever its
// inputs change, each time from the script's global variables as they were before the tick (a snapshot). The
// same snapshot makes a repeated evaluation of one state (React's strict mode, undo) give the same result.
import { hasDownloadConsent } from '../../tools';
import { TclSandbox, currentTclRuntime, loadTclRuntime, onTclRuntimeLoaded, type TclLimits, type TclOutcome, type WaclRuntime } from '../../tools/tcl';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { SignalValue } from '../../types/logic';
import { requestSimulation, type SimContext } from '../registry';
import { fingerprint } from '../shared/netlistPart';
import { LOG_LINES, partState, type TclPartState, type TclScriptError } from './model';

/** Bounds of one call into the script during the simulation (it runs on the page's main thread) */
export const STEP_LIMITS: TclLimits = { commands: 200_000, timeMs: 250 };
/** Bounds of loading the script */
export const LOAD_LIMITS: TclLimits = { commands: 2_000_000, timeMs: 2_000 };
/** Sandboxes kept at once (each is a Tcl interpreter in the runtime's fixed 16 MB heap) */
const MAX_SANDBOXES = 32;

// The wrapper's API, installed in the child before the user script. Fixed text: no user value is spliced in.
// getName / getIndex / the messages are tcl_wrapper.tcl's; examine and force take evo's optional type argument.
const CHILD_PRELUDE = String.raw`
proc getName {signal} {
  if {[regexp {([^\/\(]+)[0-9\(\)]*$} $signal matched name]} { return $name }
  return $signal
}
proc getIndex {signal} {
  if {[regexp {[^\/\(]+\(?([0-9]*)\)?$} $signal matched index]} { return $index }
  return {}
}
proc echo {message} { puts "\[TCL\] $message" }
proc examine {args} {
  if {[llength $args] < 1 || [llength $args] > 2} {
    echo "Error, wrong number of args for examine function : examine (type) signal. You called \"examine $args\""
    return X
  }
  set signal [lindex $args end]
  if {[getIndex $signal] ne ""} {
    echo "Single bit read is not implemented"
    return 0
  }
  if {[catch {set ::[getName $signal]} value]} { return 0 }
  return $value
}
proc force {args} {
  if {[llength $args] < 2 || [llength $args] > 3} {
    echo "Error, wrong number of args for force function : force (type) signal value. You called \"force $args\""
    return
  }
  set ::[getName [lindex $args end-1]] [lindex $args end]
  return
}
proc run {args} {}
proc restart {args} { echo "Restart" }
proc add {args} { echo "'add' command ignored in Logisim execution mode" }
proc delete {args} { echo "'delete' command ignored in Logisim execution mode" }
proc configure {args} { echo "'configure' command ignored in Logisim execution mode" }
proc WaveRestoreZoom {args} { echo "'WaveRestoreZoom' command ignored in Logisim execution mode" }
proc enableLogisim {args} {}
proc logisimExamine {} {}

namespace eval ::lds_tcl { variable snap {} }
# The script's variables: the globals and those of its namespaces (not Tcl's own ::tcl / ::oo / ::zlib, nor ::lds_tcl)
proc ::lds_tcl::vars {} {
  set names {}
  foreach name [info globals] { lappend names ::$name }
  foreach ns [::lds_tcl::spaces ::] {
    foreach name [info vars $ns\::*] { lappend names $name }
  }
  return $names
}
proc ::lds_tcl::spaces {parent} {
  set found {}
  foreach ns [namespace children $parent] {
    if {$ns in {::tcl ::oo ::zlib ::lds_tcl}} continue
    lappend found $ns {*}[::lds_tcl::spaces $ns]
  }
  return $found
}
proc ::lds_tcl::save {} {
  variable snap {}
  foreach name [::lds_tcl::vars] {
    if {[array exists $name]} {
      lappend snap $name 1 [array get $name]
    } elseif {![catch {set $name} value]} {
      lappend snap $name 0 $value
    }
  }
}
proc ::lds_tcl::restore {} {
  variable snap
  foreach name [::lds_tcl::vars] { unset -nocomplain $name }
  foreach {name isArray value} $snap {
    # (a namespace the script deleted since the snapshot is made again)
    namespace eval ::[namespace qualifiers $name] {}
    if {$isArray} { array set $name $value } else { set $name $value }
  }
}
proc ::lds_tcl::step {mode keep ins outs} {
  if {$keep eq "save"} { ::lds_tcl::save } elseif {$keep eq "restore"} { ::lds_tcl::restore }
  foreach {name value} $ins { set ::$name $value }
  foreach name $outs { set ::$name X }
  if {$mode ne "force"} {
    logisimExamine
    return
  }
  logisimForce
  set values {}
  foreach name $outs {
    if {[catch {set ::$name} value]} { set value X }
    lappend values [regsub -all {[^01]} $value X]
  }
  return [join $values " "]
}
`;

interface Entry {
  runtime: WaclRuntime;
  sandbox: TclSandbox | null;
  /** Script fingerprint and epoch the sandbox was loaded for */
  key: string;
  loadError?: TclScriptError;
  /** Console lines of loading the script */
  loadLog: string[];
  /** No logisimForce has run in this sandbox yet */
  fresh: boolean;
  /** The part state (stateSig) the snapshot was taken in, and whether that force was the sandbox's first */
  base?: string;
  baseFresh?: boolean;
}

const entries = new Map<string, Entry>();

// The runtime may come later (the user agrees to the download, or it was agreed before): simulate again then
onTclRuntimeLoaded(() => requestSimulation());

let autoLoadTried = false;

/** Loads the runtime in the background when the user agreed to its download before (once per page) */
function autoLoad(): void {
  if (autoLoadTried) return;
  autoLoadTried = true;
  if (hasDownloadConsent('tcl')) loadTclRuntime().catch(() => {});
}

/** The line in `script` where a Tcl error happened: the script's own line, or a proc's line counted from its `proc` */
export function scriptLine(outcome: TclOutcome, script: string): number | undefined {
  if (outcome.line !== undefined) return outcome.line;
  const lines = script.split('\n');
  for (const m of (outcome.errorInfo ?? '').matchAll(/\(procedure "([^"]+)" line (\d+)\)/g)) {
    const name = m[1].replace(/^::/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*proc\\s+(?:::)?${name}(?:\\s|$)`);
    const at = lines.findIndex((l) => re.test(l));
    if (at >= 0) return at + Number(m[2]);
  }
  return undefined;
}

function errorOf(phase: TclScriptError['phase'], outcome: TclOutcome, script: string): TclScriptError {
  const line = scriptLine(outcome, script);
  if (outcome.limit) return { phase, message: '', limit: outcome.limit, ...(line !== undefined ? { line } : {}) };
  return { phase, message: outcome.result.slice(0, 500), ...(line !== undefined ? { line } : {}) };
}

function load(runtime: WaclRuntime, script: string, key: string): Entry {
  const entry: Entry = { runtime, sandbox: null, key, loadLog: [], fresh: true };
  try {
    const sandbox = TclSandbox.create(runtime);
    entry.sandbox = sandbox;
    const prelude = sandbox.run(CHILD_PRELUDE, LOAD_LIMITS);
    if (!prelude.ok) throw new Error(prelude.result);
    const loaded = sandbox.run(script, LOAD_LIMITS);
    entry.loadLog.push(...loaded.output);
    if (!loaded.ok) {
      entry.loadError = errorOf('load', loaded, script);
      return entry;
    }
    // tcl_wrapper.tcl calls it after sourcing the script; a script may define its own
    const enabled = sandbox.call(['enableLogisim', 'TRUE'], STEP_LIMITS);
    entry.loadLog.push(...enabled.output);
    if (!enabled.ok) entry.loadError = errorOf('load', enabled, script);
  } catch (e) {
    entry.loadError = { phase: 'load', message: e instanceof Error ? e.message : String(e) };
  }
  return entry;
}

function dispose(entry: Entry): void {
  try {
    entry.sandbox?.dispose();
  } catch {
    // the runtime is gone; nothing to free
  }
}

/** The sandbox of a part, loaded for its current script and epoch */
function entryFor(id: string, s: TclPartState, runtime: WaclRuntime): Entry {
  const key = `${fingerprint(s.script)}:${s.epoch ?? 0}`;
  let entry = entries.get(id);
  if (entry && (entry.key !== key || entry.runtime !== runtime || (entry.sandbox && !entry.sandbox.usable))) {
    dispose(entry);
    entry = undefined;
  }
  entries.delete(id);
  entry ??= load(runtime, s.script, key);
  entries.set(id, entry);
  if (entries.size > MAX_SANDBOXES) {
    const [oldId, old] = entries.entries().next().value!;
    dispose(old);
    entries.delete(oldId);
  }
  return entry;
}

/** Drops the sandbox of a part (its script starts again on the next step) */
export function forgetSandbox(id: string): void {
  const entry = entries.get(id);
  if (entry) dispose(entry);
  entries.delete(id);
}

/**
 * A call into the script during the simulation. A failure of the runtime itself (e.g. the fixed heap is full and
 * the WebAssembly module aborts) becomes the part's error instead of escaping into the simulation; the sandbox is
 * then no longer usable and the next step loads a fresh runtime and sandbox.
 */
function safeCall(sandbox: TclSandbox, words: string[]): TclOutcome {
  try {
    return sandbox.call(words, STEP_LIMITS);
  } catch (e) {
    return { ok: false, result: e instanceof Error ? e.message : String(e), output: [], outputTruncated: false };
  }
}

// evo's Value.toBinaryString: 0, 1, x (unknown or floating), E (error)
const bitChar = (v: SignalValue | undefined): string => (v === 0 ? '0' : v === 1 ? '1' : v === 'E' ? 'E' : 'x');

/** A value from the script as `width` bits: short values padded with X on the left, long ones cut on the left */
export function fitValue(value: string, width: number): string {
  return value.length >= width ? value.slice(value.length - width) : 'X'.repeat(width - value.length) + value;
}

/** Binary string (MSB first) to the engine's bits (LSB first) */
function toBits(value: string | undefined, width: number): SignalValue[] {
  const bits: SignalValue[] = [];
  for (let b = 0; b < width; b++) {
    const ch = value?.[width - 1 - b];
    bits.push(ch === '0' ? 0 : ch === '1' ? 1 : 'X');
  }
  return bits;
}

function appendLog(log: string[], mark: number, lines: string[]): { log: string[]; logMark: number } {
  const all = [...log, ...lines];
  const drop = Math.max(0, all.length - LOG_LINES);
  return { log: drop ? all.slice(drop) : all, logMark: Math.max(0, mark - drop) };
}

const sameError = (a: TclScriptError | undefined, b: TclScriptError | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The part's simulate(): see the top of this file */
export function simulateTcl(comp: CircuitComponentInstance, ctx: SimContext): void {
  const s = partState(comp);
  const emit = (values: string[] | undefined) => comp.outputs.forEach((p, i) => ctx.setBitsOut(i, toBits(values?.[i], p.width ?? 1)));
  const runtime = currentTclRuntime();
  if (!runtime) {
    // the outputs hold their last values until the runtime is there
    autoLoad();
    emit(s.out);
    return;
  }

  const entry = entryFor(comp.id, s, runtime);
  let next = s;
  if (entry.loadError || !entry.sandbox) {
    if (!sameError(s.error, entry.loadError) || s.out) {
      next = { ...s, error: entry.loadError, out: undefined, log: entry.loadLog.slice(-LOG_LINES), logMark: 0 };
    }
    emit(undefined);
    if (next !== s) comp.state.part = next;
    return;
  }

  const inputs = comp.inputs.map((p, i) => {
    const width = p.width ?? 1;
    const bits = width > 1 ? (p.bits ?? []) : [ctx.raw[i]];
    let text = '';
    for (let b = width - 1; b >= 0; b--) text += bitChar(bits[b]);
    return text;
  });
  const inKey = inputs.join(' ');
  const stateSig = `${s.tick ?? ''}|${s.forceRun ?? ''}|${s.seen ?? ''}`;

  let keep: 'save' | 'restore' | 'none' | null = null;
  let resetLog = false;
  if (entry.fresh) {
    keep = 'save';
    resetLog = true;
  } else if (entry.base === stateSig) {
    // the state the snapshot was taken in, evaluated again
    keep = 'restore';
    resetLog = !!entry.baseFresh;
  } else if (s.tick !== ctx.tick) {
    keep = 'save';
  } else if (s.forceRun === ctx.run && s.forcedWith !== inKey) {
    // inputs still settling in the run of the tick: again from the state before the tick
    keep = 'restore';
  }

  const ins = comp.inputs.map((p, i) => `${p.name} ${inputs[i]}`).join(' ');
  const outs = comp.outputs.map((p) => p.name).join(' ');
  if (keep) {
    if (keep === 'save') {
      entry.base = stateSig;
      entry.baseFresh = entry.fresh;
      entry.fresh = false;
    }
    const r = safeCall(entry.sandbox, ['::lds_tcl::step', 'force', keep, ins, outs]);
    const rerun = keep === 'restore' && entry.base !== stateSig;
    const before = resetLog ? entry.loadLog : rerun ? (s.log ?? []).slice(0, s.logMark ?? 0) : (s.log ?? []);
    const log = appendLog(before, before.length, r.output);
    let out: string[] | undefined;
    if (r.ok) {
      const values = comp.outputs.length ? r.result.split(' ') : [];
      out = comp.outputs.map((p, i) => fitValue(values[i] ?? '', p.width ?? 1));
    }
    next = { ...s, tick: ctx.tick, forceRun: ctx.run, forcedWith: inKey, seen: inKey, out, error: r.ok ? undefined : errorOf('force', r, s.script), ...log };
  } else if (s.seen !== inKey) {
    const r = safeCall(entry.sandbox, ['::lds_tcl::step', 'examine', 'none', ins, outs]);
    const log = r.output.length ? appendLog(s.log ?? [], s.logMark ?? 0, r.output) : {};
    next = { ...s, seen: inKey, ...log, ...(r.ok ? {} : { error: errorOf('examine', r, s.script) }) };
  }
  emit(next.out);
  if (next !== s) comp.state.part = next;
}
