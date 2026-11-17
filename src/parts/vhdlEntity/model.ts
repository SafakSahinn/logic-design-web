// VHDL Entity part: its state, the synthesis status, the compiled-netlist cache and the attribute edits.
//
// The part keeps the VHDL text, the generic settings and the netlist of its last successful synthesis. The
// netlist is what simulates, so a file opens and runs without the tools; after the text changes it keeps
// running (status "stale") as long as the pins still match it.
import {
  HdlError,
  genericValues,
  isStoredNetlist,
  netlistFromStored,
  parseGenericSettings,
  topVhdlEntity,
  type HdlDiagnostic,
  type StoredNetlist,
  type StoredPort,
  type VhdlEntity,
} from '../../hdl';
import { NetlistError, compileNetlist, type CompiledNetlist, type Netlist } from '../../netlist';
import type { CircuitComponentInstance, PinDefinition } from '../../types/circuit';
import type { PartAttrEdit } from '../registry';
import { BODY_WIDTH, PIN_GAP, PIN_TOP, pinRemap, pinsFor, pinsSame, type PortShape } from '../shared/netlistPart';
import { DEFAULT_NETLIST } from './defaultNetlist';
import { DEFAULT_VHDL } from './defaultVhdl';

/** What the part keeps in comp.state.part (JSON-safe) */
export interface VhdlPartState {
  /** The VHDL text, line breaks normalised to \n */
  vhdl: string;
  /** The "Generics" attribute as written ("W=8, N=2") */
  generics: string;
  /** Netlist of the last successful synthesis */
  netlist?: StoredNetlist;
  /** synthKey() of the text and generics the netlist came from */
  netlistOf?: string;
  /** Messages of the last synthesis, the key it ran on and whether it failed */
  diagnostics?: HdlDiagnostic[];
  diagnosticsOf?: string;
  failed?: boolean;
  /** Simulation state of the netlist (shared/netlistPart encodeRun); unset = power-on */
  run?: string;
}

export const newPartState = (): VhdlPartState => ({
  vhdl: DEFAULT_VHDL,
  generics: '',
  netlist: DEFAULT_NETLIST,
  netlistOf: synthKey(DEFAULT_VHDL, ''),
});

export function partState(comp: CircuitComponentInstance): VhdlPartState {
  const s = comp.state.part as VhdlPartState | undefined;
  if (!s || typeof s.vhdl !== 'string') return newPartState();
  return { ...s, generics: typeof s.generics === 'string' ? s.generics : '', netlist: isStoredNetlist(s.netlist) ? s.netlist : undefined };
}

/** cyrb53: a short fingerprint of the text and generics a synthesis ran on (kept instead of a copy) */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** Generics are compared without spaces, so "W = 8" and "W=8" are the same setting */
export const synthKey = (vhdl: string, generics: string): string => hash(`${generics.replace(/\s+/g, '')}\u0000${vhdl}`);
export const currentKey = (s: VhdlPartState): string => synthKey(s.vhdl, s.generics);

export type SynthStatus = 'ok' | 'stale' | 'failed' | 'none';

export function synthStatus(s: VhdlPartState): SynthStatus {
  const key = currentKey(s);
  if (s.failed && s.diagnosticsOf === key) return 'failed';
  if (s.netlist && s.netlistOf === key) return 'ok';
  return s.netlist ? 'stale' : 'none';
}

// --- entity preview ---------------------------------------------------------------------------------

export type PreviewResult = { ok: true; entity: VhdlEntity; inputs: PortShape[]; outputs: PortShape[] } | { ok: false; error: HdlError };

const previews = new Map<string, PreviewResult>();

/** The top entity's ports read from the text (before or without synthesis) */
export function preview(s: VhdlPartState): PreviewResult {
  const key = currentKey(s);
  const hit = previews.get(key);
  if (hit) return hit;
  let result: PreviewResult;
  try {
    const entity = topVhdlEntity(s.vhdl, genericValues(parseGenericSettings(s.generics)));
    result = {
      ok: true,
      entity,
      inputs: entity.ports.filter((p) => p.mode === 'in').map((p) => ({ name: p.name, width: p.width })),
      outputs: entity.ports.filter((p) => p.mode !== 'in').map((p) => ({ name: p.name, width: p.width })),
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
export function wantedPorts(s: VhdlPartState): { inputs: PortShape[]; outputs: PortShape[] } | undefined {
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
export function withState(comp: CircuitComponentInstance, state: VhdlPartState): PartAttrEdit {
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
 *   synth: a synthesis finished for `key` (ignored when the text or generics changed meanwhile)
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
    if (text === s.vhdl) return null;
    return withState(comp, { ...s, vhdl: text });
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

export function setGenerics(comp: CircuitComponentInstance, value: string | number): PartAttrEdit | null {
  const text = String(value).trim();
  const s = partState(comp);
  if (text === s.generics) return null;
  return withState(comp, { ...s, generics: text });
}
