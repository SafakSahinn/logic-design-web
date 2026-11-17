// Shared pieces of the parts that a netlist drives (BLIF Circuit 6a, VHDL Entity 6b, Verilog 6c): the body
// geometry of evo's GenericInterfaceComponent, pins built from port lists, and the run state codec.
import { newNetlistState, type CompiledNetlist, type NetlistState } from '../../netlist';
import type { CircuitComponentInstance, CircuitPin } from '../../types/circuit';

/** Body geometry in app pixels (evo's layout at the app's pin spacing): pins down the sides from PIN_TOP */
export const BODY_WIDTH = 140;
export const PIN_TOP = 30;
export const PIN_GAP = 20;

/** evo's GenericInterfaceComponent geometry (Logisim pixels): loc top-left, inputs west, outputs east */
export const EVO_WIDTH = 140;
export const EVO_PIN_TOP = 40;
export const EVO_PIN_GAP = 10;

/** A port as the pins need it */
export interface PortShape {
  name: string;
  width: number;
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

/** evo's connection points, for PartCirc.ports */
export function evoPorts(comp: CircuitComponentInstance): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  return {
    inputs: comp.inputs.map((_, i) => ({ x: 0, y: EVO_PIN_TOP + EVO_PIN_GAP * i })),
    outputs: comp.outputs.map((_, i) => ({ x: EVO_WIDTH, y: EVO_PIN_TOP + EVO_PIN_GAP * i })),
  };
}

/**
 * Pins for the ports. A pin whose name and direction survive keeps its id (its wires follow it); the others
 * get new ids. Positions are placed again by the caller.
 */
export function pinsFor(comp: CircuitComponentInstance, inputs: PortShape[], outputs: PortShape[]): { inputs: CircuitPin[]; outputs: CircuitPin[] } {
  const used = new Set<string>();
  const old = new Map<string, string>();
  for (const p of [...comp.inputs, ...comp.outputs]) old.set(`${p.type}:${p.name}`, p.id);
  const oldIds = new Set(old.values());
  const make = (port: PortShape, type: 'input' | 'output'): CircuitPin => {
    let id = old.get(`${type}:${port.name}`);
    if (id === undefined || used.has(id)) {
      const base = `${comp.id}_${type === 'input' ? 'in' : 'out'}`;
      let k = 0;
      while (used.has(`${base}${k}`) || oldIds.has(`${base}${k}`)) k++;
      id = `${base}${k}`;
    }
    used.add(id);
    return { id, name: port.name, type, value: 0, ...(port.width > 1 ? { width: port.width } : {}), x: comp.x, y: comp.y };
  };
  return { inputs: inputs.map((p) => make(p, 'input')), outputs: outputs.map((p) => make(p, 'output')) };
}

/** The pins have the ports' names and widths already */
export function pinsSame(comp: CircuitComponentInstance, inputs: PortShape[], outputs: PortShape[]): boolean {
  const same = (pins: CircuitPin[], ports: PortShape[]) => pins.length === ports.length && pins.every((p, i) => p.name === ports[i].name && (p.width ?? 1) === ports[i].width);
  return same(comp.inputs, inputs) && same(comp.outputs, outputs);
}

/** The pins match the compiled ports (count and widths), so the netlist can drive them */
export function pinsMatch(comp: CircuitComponentInstance, c: CompiledNetlist): boolean {
  const same = (pins: CircuitPin[], ports: { width: number }[]) =>
    pins.length === ports.length && pins.every((p, i) => (p.width ?? 1) === ports[i].width);
  return same(comp.inputs, c.inputs) && same(comp.outputs, c.outputs);
}

const snap = (v: number): number => Math.round(v / 10) * 10;

/** The remap of an edit that replaced the pins: wires on a kept pin follow it, the others stay as open ends */
export function pinRemap(comp: CircuitComponentInstance, pins: { inputs: CircuitPin[]; outputs: CircuitPin[] }): Map<string, string | null> {
  const kept = new Set([...pins.inputs, ...pins.outputs].map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of [...comp.inputs, ...comp.outputs]) remap.set(`${snap(p.x)},${snap(p.y)}`, kept.has(p.id) ? p.id : null);
  return remap;
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

/** cyrb53: a short fingerprint of the text a synthesis ran on (HDL parts keep it instead of a copy) */
export function fingerprint(text: string): string {
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
