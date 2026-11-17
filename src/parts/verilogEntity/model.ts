// Verilog Entity part: its state, the synthesis status, the compiled-netlist cache and the attribute edits.
//
// The part keeps the Verilog text, the parameter settings and the netlist of its last successful synthesis.
// The netlist is what simulates, so a file opens and runs without Yosys; after the text changes it keeps
// running (status "stale") as long as the pins still match it.
import {
  HdlError,
  checkParamSettings,
  isStoredNetlist,
  netlistFromStored,
  paramValues,
  parseParamSettings,
  topVerilogModule,
  type HdlDiagnostic,
  type StoredNetlist,
  type StoredPort,
  type VerilogModule,
} from '../../hdl';
import { NetlistError, compileNetlist, type CompiledNetlist, type Netlist } from '../../netlist';
import type { CircuitComponentInstance, PinDefinition } from '../../types/circuit';
import type { PartAttrEdit } from '../registry';
import { BODY_WIDTH, PIN_GAP, PIN_TOP, fingerprint, pinRemap, pinsFor, pinsSame, type PortShape } from '../shared/netlistPart';
import { DEFAULT_NETLIST } from './defaultNetlist';
import { DEFAULT_VERILOG } from './defaultVerilog';

/** What the part keeps in comp.state.part (JSON-safe) */
export interface VerilogPartState {
  /** The Verilog / SystemVerilog text, line breaks normalised to \n */
  verilog: string;
  /** The "Parameters" attribute as written ("W=8, N=2") */
  parameters: string;
  /** Netlist of the last successful synthesis */
  netlist?: StoredNetlist;
  /** synthKey() of the text and parameters the netlist came from */
  netlistOf?: string;
  /** Messages of the last synthesis, the key it ran on and whether it failed */
  diagnostics?: HdlDiagnostic[];
  diagnosticsOf?: string;
  failed?: boolean;
  /** Simulation state of the netlist (shared/netlistPart encodeRun); unset = power-on */
  run?: string;
}

/** Parameters are compared without spaces, so "W = 8" and "W=8" are the same setting */
export const synthKey = (verilog: string, parameters: string): string => fingerprint(`${parameters.replace(/\s+/g, '')}\u0000${verilog}`);
export const currentKey = (s: VerilogPartState): string => synthKey(s.verilog, s.parameters);

export const newPartState = (): VerilogPartState => ({
  verilog: DEFAULT_VERILOG,
  parameters: '',
  netlist: DEFAULT_NETLIST,
  netlistOf: synthKey(DEFAULT_VERILOG, ''),
});

export function partState(comp: CircuitComponentInstance): VerilogPartState {
  const s = comp.state.part as VerilogPartState | undefined;
  if (!s || typeof s.verilog !== 'string') return newPartState();
  return { ...s, parameters: typeof s.parameters === 'string' ? s.parameters : '', netlist: isStoredNetlist(s.netlist) ? s.netlist : undefined };
}

export type SynthStatus = 'ok' | 'stale' | 'failed' | 'none';

export function synthStatus(s: VerilogPartState): SynthStatus {
  const key = currentKey(s);
  if (s.failed && s.diagnosticsOf === key) return 'failed';
  if (s.netlist && s.netlistOf === key) return 'ok';
  return s.netlist ? 'stale' : 'none';
}

// --- module preview ---------------------------------------------------------------------------------

export type PreviewResult = { ok: true; module: VerilogModule; inputs: PortShape[]; outputs: PortShape[] } | { ok: false; error: HdlError };

const previews = new Map<string, PreviewResult>();

/** The top module's ports read from the text with the parameter settings (before or without synthesis) */
export function preview(s: VerilogPartState): PreviewResult {
  const key = currentKey(s);
  const hit = previews.get(key);
  if (hit) return hit;
  let result: PreviewResult;
  try {
    const settings = parseParamSettings(s.parameters);
    const module = topVerilogModule(s.verilog, paramValues(settings));
    checkParamSettings(module, settings);
    result = {
      ok: true,
      module,
      inputs: module.ports.filter((p) => p.direction === 'input').map((p) => ({ name: p.name, width: p.width })),
      outputs: module.ports.filter((p) => p.direction !== 'input').map((p) => ({ name: p.name, width: p.width })),
    };
  } catch (e) {
    result = { ok: false, error: e instanceof HdlError ? e : new HdlError('internal', String(e)) };
  }
  previews.set(key, result);
  if (previews.size > 64) previews.delete(previews.keys().next().value!);
  return result;
}

// --- compiled netlists ------------------------------------------------------------------------------

export type NetlistEntry = { ok: true; netlist: Netlist; compiled: CompiledNetlist } | { ok: false; error: NetlistError | HdlError };

const compiled = new Map<string, NetlistEntry>();

/** The stored netlist parsed and compiled; parts with the same netlist share one entry */
export function netlistEntry(stored: StoredNetlist): NetlistEntry {
  const key = JSON.stringify([stored.top, stored.inputs, stored.outputs, stored.blif]);
  const hit = compiled.get(key);
  if (hit) {
    compiled.delete(key);
    compiled.set(key, hit);
    return hit;
  }
  let entry: NetlistEntry;
  try {
    const netlist = netlistFromStored(stored);
    entry = { ok: true, netlist, compiled: compileNetlist(netlist) };
  } catch (e) {
    entry = { ok: false, error: e instanceof NetlistError || e instanceof HdlError ? e : new NetlistError('internal', String(e)) };
  }
  compiled.set(key, entry);
  if (compiled.size > 32) compiled.delete(compiled.keys().next().value!);
  return entry;
}

// --- pins -------------------------------------------------------------------------------------------

const storedShape = (ports: StoredPort[]): PortShape[] => ports.map((p) => ({ name: p.name, width: p.width }));

/** The ports the pins should have: the netlist's when it is current, else the text's, else none known */
export function wantedPorts(s: VerilogPartState): { inputs: PortShape[]; outputs: PortShape[] } | undefined {
  if (s.netlist && synthStatus(s) === 'ok') return { inputs: storedShape(s.netlist.inputs), outputs: storedShape(s.netlist.outputs) };
  const p = preview(s);
  return p.ok ? { inputs: p.inputs, outputs: p.outputs } : undefined;
}

/** Default pins of the part: those of the default netlist */
export function defaultPins(): { inputs: PinDefinition[]; outputs: PinDefinition[] } {
  const def = (p: StoredPort, i: number, type: 'input' | 'output'): PinDefinition => ({
    id: `${type === 'input' ? 'in' : 'out'}${i}`,
    name: p.name,
    type,
    relX: type === 'input' ? 0 : BODY_WIDTH,
    relY: PIN_TOP + PIN_GAP * i,
    ...(p.width > 1 ? { width: p.width } : {}),
  });
  return {
    inputs: DEFAULT_NETLIST.inputs.map((p, i) => def(p, i, 'input')),
    outputs: DEFAULT_NETLIST.outputs.map((p, i) => def(p, i, 'output')),
  };
}

/** The part with a new state, its pins following wantedPorts() (kept when the ports are unknown) */
export function withState(comp: CircuitComponentInstance, state: VerilogPartState): PartAttrEdit {
  const next: CircuitComponentInstance = { ...comp, state: { ...comp.state, part: state } };
  const ports = wantedPorts(state);
  if (!ports || pinsSame(comp, ports.inputs, ports.outputs)) return { comp: next, stateOnly: true };
  const pins = pinsFor(comp, ports.inputs, ports.outputs);
  return { comp: { ...next, inputs: pins.inputs, outputs: pins.outputs }, remap: pinRemap(comp, pins) };
}

// --- edits ------------------------------------------------------------------------------------------

/**
 * Commands of the editor row (its value is JSON, since one row both edits the text and stores a synthesis):
 *   text:  the user applied a new text
 *   synth: a synthesis finished for `key` (ignored when the text or parameters changed meanwhile)
 */
export type EditorCommand =
  | { op: 'text'; text: string }
  | { op: 'synth'; key: string; netlist?: StoredNetlist; diagnostics: HdlDiagnostic[] };

export function applyEditorCommand(comp: CircuitComponentInstance, raw: string | number): PartAttrEdit | null {
  let cmd: EditorCommand;
  try {
    cmd = JSON.parse(String(raw)) as EditorCommand;
  } catch {
    return null;
  }
  const s = partState(comp);
  if (cmd.op === 'text' && typeof cmd.text === 'string') {
    const text = cmd.text.replace(/\r\n?/g, '\n');
    if (text === s.verilog) return null;
    return withState(comp, { ...s, verilog: text });
  }
  if (cmd.op === 'synth' && cmd.key === currentKey(s) && Array.isArray(cmd.diagnostics)) {
    const diagnostics = cmd.diagnostics.slice(0, 50);
    if (cmd.netlist !== undefined) {
      if (!isStoredNetlist(cmd.netlist)) return null;
      // a new netlist starts from power-on
      const { run: _run, ...rest } = s;
      return withState(comp, { ...rest, netlist: cmd.netlist, netlistOf: cmd.key, diagnostics, diagnosticsOf: cmd.key, failed: false });
    }
    return { comp: { ...comp, state: { ...comp.state, part: { ...s, diagnostics, diagnosticsOf: cmd.key, failed: true } } }, stateOnly: true };
  }
  return null;
}

export function setParameters(comp: CircuitComponentInstance, value: string | number): PartAttrEdit | null {
  const text = String(value).trim();
  const s = partState(comp);
  if (text === s.parameters) return null;
  return withState(comp, { ...s, parameters: text });
}
