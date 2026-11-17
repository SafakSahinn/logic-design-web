// TCL Generic part: its state, the interface (pins from a VHDL entity) and the attribute edits.
//
// As in Logisim-evolution, the pins come from the ports of a VHDL entity (the "interface") and the behaviour from
// a Tcl script. evo keeps the script in an external file; here the script text is part of the circuit.
import { HdlError, topVhdlEntity, type VhdlEntity } from '../../hdl';
import type { CircuitComponentInstance, PinDefinition } from '../../types/circuit';
import type { PartAttrEdit } from '../registry';
import { BODY_WIDTH, PIN_GAP, PIN_TOP, pinRemap, pinsFor, pinsSame, type PortShape } from '../shared/netlistPart';
import { DEFAULT_INTERFACE, DEFAULT_SCRIPT } from './defaults';
import { t } from './text';

/** The part's name in English (meta.name), the label of a new part */
const DEFAULT_NAME = 'TCL Generic';

/** A script error as the part keeps it (translated when shown) */
export interface TclScriptError {
  /** load: the script itself failed; force / examine: the proc of that name failed */
  phase: 'load' | 'force' | 'examine';
  /** Tcl's message, or empty when a limit stopped the script */
  message: string;
  /** Line in the script, when known */
  line?: number;
  limit?: 'commands' | 'time';
}

/** What the part keeps in comp.state.part (JSON-safe) */
export interface TclPartState {
  /** The VHDL entity that gives the pins, line breaks normalised to \n */
  vhdl: string;
  /** The Tcl script, line breaks normalised to \n */
  script: string;
  /** Logisim-evolution's filePath (the external .tcl file it runs), kept from an imported file; unset = defaultScriptFileName */
  filePath?: string;
  /** Bumped by a restart (and a simulation reset): the script starts again in a new interpreter */
  epoch?: number;
  // --- run state (unset = power-on) ---
  /** Tick and run of the last logisimForce, and the inputs it saw */
  tick?: number;
  forceRun?: number;
  forcedWith?: string;
  /** Inputs of the last call into the script (force or examine) */
  seen?: string;
  /** Output values of the last logisimForce, one binary string per output pin (MSB first, X for unknown) */
  out?: string[];
  /** The last error, until the next successful logisimForce (a load error stays until the script changes) */
  error?: TclScriptError;
  /** The last console lines (echo / puts), at most LOG_LINES; logMark = where the current tick's lines start */
  log?: string[];
  logMark?: number;
}

export const LOG_LINES = 200;

export const newPartState = (): TclPartState => ({ vhdl: DEFAULT_INTERFACE, script: DEFAULT_SCRIPT });

export function partState(comp: CircuitComponentInstance): TclPartState {
  const s = comp.state.part as TclPartState | undefined;
  if (!s || typeof s.vhdl !== 'string' || typeof s.script !== 'string') return newPartState();
  return s;
}

/** The part's state without its run state (power-on), keeping the texts and the epoch */
export function powerOn(s: TclPartState): TclPartState {
  return { vhdl: s.vhdl, script: s.script, ...(s.filePath !== undefined ? { filePath: s.filePath } : {}), ...(s.epoch !== undefined ? { epoch: s.epoch } : {}) };
}

// --- interface ----------------------------------------------------------------------------------------

export type InterfaceResult = { ok: true; entity: VhdlEntity; inputs: PortShape[]; outputs: PortShape[] } | { ok: false; error: HdlError };

const interfaces = new Map<string, InterfaceResult>();

/** The entity's ports read from the interface text (in -> input pins, out / inout / buffer -> output pins) */
export function readInterface(vhdl: string): InterfaceResult {
  const hit = interfaces.get(vhdl);
  if (hit) return hit;
  let result: InterfaceResult;
  try {
    const entity = topVhdlEntity(vhdl);
    result = {
      ok: true,
      entity,
      inputs: entity.ports.filter((p) => p.mode === 'in').map((p) => ({ name: p.name, width: p.width })),
      outputs: entity.ports.filter((p) => p.mode !== 'in').map((p) => ({ name: p.name, width: p.width })),
    };
  } catch (e) {
    result = { ok: false, error: e instanceof HdlError ? e : new HdlError('internal', String(e)) };
  }
  interfaces.set(vhdl, result);
  if (interfaces.size > 64) interfaces.delete(interfaces.keys().next().value!);
  return result;
}

/**
 * The script's file name when the part has no filePath: the label (unless it is the part's default name, which
 * every new part has), else the entity's name, as a safe file name
 */
export function defaultScriptFileName(comp: CircuitComponentInstance): string {
  const iface = readInterface(partState(comp).vhdl);
  const label = (comp.label ?? '').trim();
  const named = label !== '' && label !== DEFAULT_NAME && label !== t('meta.name');
  const base = (named ? label : '') || (iface.ok ? iface.entity.name : '') || 'script';
  return `${base.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^\.+/, '_').slice(0, 64)}.tcl`;
}

/** The file Logisim-evolution runs for the part (its filePath attribute) */
export const scriptFilePath = (comp: CircuitComponentInstance): string => partState(comp).filePath ?? defaultScriptFileName(comp);

/** The file name to save the script under: the last part of the filePath when it is a .tcl file, else the default */
export function scriptFileName(comp: CircuitComponentInstance): string {
  const name = scriptFilePath(comp).split(/[\\/]/).pop() ?? '';
  return /\.tcl$/i.test(name) ? name : defaultScriptFileName(comp);
}

/** Default pins of the part: the default interface's ports */
export function defaultPins(): { inputs: PinDefinition[]; outputs: PinDefinition[] } {
  const r = readInterface(DEFAULT_INTERFACE);
  if (!r.ok) throw new Error(`The default TCL Generic interface cannot be read: ${r.error.message}`);
  const def = (p: PortShape, i: number, type: 'input' | 'output'): PinDefinition => ({
    id: `${type === 'input' ? 'in' : 'out'}${i}`,
    name: p.name,
    type,
    relX: type === 'input' ? 0 : BODY_WIDTH,
    relY: PIN_TOP + PIN_GAP * i,
    ...(p.width > 1 ? { width: p.width } : {}),
  });
  return { inputs: r.inputs.map((p, i) => def(p, i, 'input')), outputs: r.outputs.map((p, i) => def(p, i, 'output')) };
}

/** The part with a new state, its pins following the interface (kept while the interface cannot be read) */
export function withState(comp: CircuitComponentInstance, state: TclPartState): PartAttrEdit {
  const next: CircuitComponentInstance = { ...comp, state: { ...comp.state, part: state } };
  const ports = readInterface(state.vhdl);
  if (!ports.ok || pinsSame(comp, ports.inputs, ports.outputs)) return { comp: next, stateOnly: true };
  const pins = pinsFor(comp, ports.inputs, ports.outputs);
  // held output values follow their pins by name (MSB-first strings: a wider pin gets X on the left)
  const out = state.out?.length
    ? pins.outputs.map((p) => {
        const width = p.width ?? 1;
        const v = state.out?.[comp.outputs.findIndex((o) => o.name === p.name)] ?? '';
        return v.length >= width ? v.slice(v.length - width) : 'X'.repeat(width - v.length) + v;
      })
    : state.out;
  const moved = { ...next, state: { ...next.state, part: { ...state, out } } };
  return { comp: { ...moved, inputs: pins.inputs, outputs: pins.outputs }, remap: pinRemap(comp, pins) };
}

// --- edits --------------------------------------------------------------------------------------------

/**
 * Commands of the editor row (its value is JSON):
 *   script:  the user applied a new script (it starts again from power-on)
 *   vhdl:    the user applied a new interface (the pins follow it; the script keeps running)
 *   restart: start the script again from power-on
 */
export type EditorCommand = { op: 'script'; text: string } | { op: 'vhdl'; text: string } | { op: 'restart' };

const normalise = (text: string): string => text.replace(/\r\n?/g, '\n');

export function applyEditorCommand(comp: CircuitComponentInstance, raw: string | number): PartAttrEdit | null {
  let cmd: EditorCommand;
  try {
    cmd = JSON.parse(String(raw)) as EditorCommand;
  } catch {
    return null;
  }
  const s = partState(comp);
  if (cmd.op === 'script' && typeof cmd.text === 'string') {
    const text = normalise(cmd.text);
    if (text === s.script) return null;
    return withState(comp, { ...powerOn(s), script: text });
  }
  if (cmd.op === 'vhdl' && typeof cmd.text === 'string') {
    const text = normalise(cmd.text);
    if (text === s.vhdl) return null;
    return withState(comp, { ...s, vhdl: text });
  }
  if (cmd.op === 'restart') return withState(comp, { ...powerOn(s), epoch: (s.epoch ?? 0) + 1 });
  return null;
}
