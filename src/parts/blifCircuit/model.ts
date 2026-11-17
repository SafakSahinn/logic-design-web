// BLIF Circuit part: its state, the compiled-netlist cache, pin layout and the run state codec.
import {
  NetlistError,
  compileNetlist,
  newNetlistState,
  parseBlif,
  type CompiledNetlist,
  type Netlist,
  type NetlistPort,
  type NetlistState,
} from '../../netlist';
import type { CircuitComponentInstance, CircuitPin, PinDefinition } from '../../types/circuit';

/** What the part keeps in comp.state.part */
export interface BlifPartState {
  /** The BLIF text, as the user wrote it */
  blif: string;
  /** Simulation state of the compiled text (see encodeRun); unset = power-on */
  run?: string;
}

/** Shown for a new part: a half adder, as yosys `write_blif` writes one */
export const DEFAULT_BLIF = `# yosys -p "synth -flatten -top half_adder; write_blif out.blif"
.model half_adder
.inputs a b
.outputs s c
.names a b s
10 1
01 1
.names a b c
11 1
.end
`;

/** Body geometry in app pixels (evo's layout at the app's pin spacing): pins down the sides from TOP */
export const BODY_WIDTH = 140;
export const PIN_TOP = 30;
export const PIN_GAP = 20;

export type BlifEntry = { ok: true; netlist: Netlist; compiled: CompiledNetlist } | { ok: false; error: NetlistError };

/** Compiled texts, most recently used last; parts with the same text share one entry */
const cache = new Map<string, BlifEntry>();
const CACHE_SIZE = 64;

export function blifEntry(text: string): BlifEntry {
  const hit = cache.get(text);
  if (hit) {
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  let entry: BlifEntry;
  try {
    const netlist = parseBlif(text);
    entry = { ok: true, netlist, compiled: compileNetlist(netlist) };
  } catch (e) {
    entry = { ok: false, error: e instanceof NetlistError ? e : new NetlistError('internal', String(e)) };
  }
  cache.set(text, entry);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return entry;
}

export function partState(comp: CircuitComponentInstance): BlifPartState {
  const s = comp.state.part as BlifPartState | undefined;
  return s && typeof s.blif === 'string' ? s : { blif: DEFAULT_BLIF };
}

export const blifText = (comp: CircuitComponentInstance): string => partState(comp).blif;

/** Default pins of the part: those of DEFAULT_BLIF */
export function defaultPins(): { inputs: PinDefinition[]; outputs: PinDefinition[] } {
  const entry = blifEntry(DEFAULT_BLIF);
  if (!entry.ok) throw entry.error;
  const def = (p: NetlistPort, i: number, type: 'input' | 'output'): PinDefinition => ({
    id: `${type === 'input' ? 'in' : 'out'}${i}`,
    name: p.name,
    type,
    relX: type === 'input' ? 0 : BODY_WIDTH,
    relY: PIN_TOP + PIN_GAP * i,
    ...(p.bits.length > 1 ? { width: p.bits.length } : {}),
  });
  return {
    inputs: entry.netlist.inputs.map((p, i) => def(p, i, 'input')),
    outputs: entry.netlist.outputs.map((p, i) => def(p, i, 'output')),
  };
}

/** Body height for the larger of the input and output counts */
export const bodyHeight = (pins: number): number => PIN_TOP + PIN_GAP * (Math.max(1, pins) - 1) + 20;

export function bodySize(comp: CircuitComponentInstance): { width: number; height: number } {
  return { width: BODY_WIDTH, height: bodyHeight(Math.max(comp.inputs.length, comp.outputs.length)) };
}

export function pinPoints(comp: CircuitComponentInstance): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  return {
    inputs: comp.inputs.map((_, i) => ({ x: 0, y: PIN_TOP + PIN_GAP * i })),
    outputs: comp.outputs.map((_, i) => ({ x: BODY_WIDTH, y: PIN_TOP + PIN_GAP * i })),
  };
}

/**
 * Pins for the netlist's ports. A pin whose name and direction survive keeps its id (its wires follow it);
 * the others get new ids. Positions are placed again by the caller.
 */
export function pinsFor(comp: CircuitComponentInstance, netlist: Netlist): { inputs: CircuitPin[]; outputs: CircuitPin[] } {
  const used = new Set<string>();
  const old = new Map<string, string>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(`${p.type}:${p.name}`, p.id);
  const make = (port: NetlistPort, type: 'input' | 'output'): CircuitPin => {
    let id = old.get(`${type}:${port.name}`);
    if (id === undefined || used.has(id)) {
      const base = `${comp.id}_${type === 'input' ? 'in' : 'out'}`;
      let k = 0;
      while (used.has(`${base}${k}`) || [...old.values()].includes(`${base}${k}`)) k++;
      id = `${base}${k}`;
    }
    used.add(id);
    const width = port.bits.length;
    return { id, name: port.name, type, value: 0, ...(width > 1 ? { width } : {}), x: comp.x, y: comp.y };
  };
  return { inputs: netlist.inputs.map((p) => make(p, 'input')), outputs: netlist.outputs.map((p) => make(p, 'output')) };
}

/** The pins match the compiled ports (count and widths), so the netlist can drive them */
export function pinsMatch(comp: CircuitComponentInstance, c: CompiledNetlist): boolean {
  const same = (pins: CircuitPin[], ports: { width: number }[]) =>
    pins.length === ports.length && pins.every((p, i) => (p.width ?? 1) === ports[i].width);
  return same(comp.inputs, c.inputs) && same(comp.outputs, c.outputs);
}

// Run state as text, so it survives the app's JSON copies (undo, save): levels, '|', clock levels; one digit each
export function encodeRun(s: NetlistState): string {
  let out = '';
  for (const l of s.levels) out += String.fromCharCode(48 + l);
  out += '|';
  for (const l of s.prevClock) out += String.fromCharCode(48 + l);
  return out;
}

export function decodeRun(c: CompiledNetlist, run: string | undefined): NetlistState {
  const s = newNetlistState(c);
  if (!run) return s;
  const bar = run.indexOf('|');
  if (bar !== c.netCount || run.length - bar - 1 !== c.seqs.length) return s;
  for (let i = 0; i < bar; i++) s.levels[i] = Math.min(4, Math.max(0, run.charCodeAt(i) - 48));
  for (let i = 0; i < c.seqs.length; i++) s.prevClock[i] = Math.min(4, Math.max(0, run.charCodeAt(bar + 1 + i) - 48));
  s.fresh = false;
  return s;
}
