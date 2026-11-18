// SoC PIO part: its state (evo's SocPio attributes), pins and geometry. The registers live in the run-time object of
// runtime.ts, keyed by the component id; comp.state.part keeps only the JSON-safe attributes.
//
// Pins (evo's ports, loc at the top left): Reset (0,110); IRQ (20,0) only when the inputs generate an interrupt;
// input bit b (370 - 10 b, 120); output / bidirectional bit b (370 - 10 b, 0). A bidirectional bit is an output pin
// (floating while the direction bit is 0) plus an input pin on the same point that reads the wire back, as the TTL
// chips' in/out pins.
import { normalizePioConfig, pioGeneratesIrq, pioHasInputs, pioHasOutputs, type PioDirection, type SocPioConfig } from '../../soc';
import type { CircuitComponentInstance, CircuitPin } from '../../types/circuit';
import { partName, type PartAttrEdit } from '../registry';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

/** evo's bounds: 380 x 120 */
export const BODY_WIDTH = 380;
export const BODY_HEIGHT = 120;
export const RESET_POINT = { x: 0, y: 110 };
export const IRQ_POINT = { x: 20, y: 0 };
/** x of bit b's pins */
export const bitX = (b: number): number => 370 - 10 * b;

/** What the part keeps in comp.state.part (JSON-safe) */
export interface SocPioPartState extends SocPioConfig {
  /** Id of the bus it answers on ('' = not connected) */
  busId: string;
  /** Bumped by a simulation reset: the registers start again */
  epoch?: number;
}

export function pioState(comp: CircuitComponentInstance): SocPioPartState {
  const s = comp.state.part as Partial<SocPioPartState> | undefined;
  return {
    ...normalizePioConfig(s),
    busId: typeof s?.busId === 'string' ? s.busId : '',
    ...(typeof s?.epoch === 'number' && Number.isFinite(s.epoch) ? { epoch: s.epoch } : {}),
  };
}

export function pioConfig(comp: CircuitComponentInstance): SocPioConfig {
  const { busId: _bus, epoch: _epoch, ...cfg } = pioState(comp);
  return cfg;
}

/** evo's inputGeneratesIrq(): the IRQ pin exists */
export const pioHasIrq = pioGeneratesIrq;

export function pioName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

export interface PioPinPlace {
  /** Pin id without the component id prefix */
  key: string;
  name: string;
  x: number;
  y: number;
}

/** Pin keys, names and places of a configuration, in comp.inputs / comp.outputs order */
export function pioPinLayout(cfg: Pick<SocPioConfig, 'width' | 'direction' | 'genIrq'>): { inputs: PioPinPlace[]; outputs: PioPinPlace[] } {
  const bits = Array.from({ length: cfg.width }, (_, b) => b);
  const dir: PioDirection = cfg.direction;
  const inputs: PioPinPlace[] = [{ key: 'reset', name: 'Reset', ...RESET_POINT }];
  const outputs: PioPinPlace[] = [];
  if (pioHasIrq(cfg)) outputs.push({ key: 'irq', name: 'IRQ', ...IRQ_POINT });
  if (pioHasInputs(dir)) for (const b of bits) inputs.push({ key: `in${b}`, name: `In${b}`, x: bitX(b), y: BODY_HEIGHT });
  if (dir === 'bidir') {
    for (const b of bits) inputs.push({ key: `io${b}in`, name: `IO${b}`, x: bitX(b), y: 0 });
    for (const b of bits) outputs.push({ key: `io${b}`, name: `IO${b}`, x: bitX(b), y: 0 });
  } else if (pioHasOutputs(dir)) for (const b of bits) outputs.push({ key: `out${b}`, name: `Out${b}`, x: bitX(b), y: 0 });
  return { inputs, outputs };
}

/** Places of the pins in the unrotated body, in comp.inputs / comp.outputs order */
export function pinPoints(comp: CircuitComponentInstance): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  const l = pioPinLayout(pioState(comp));
  const at = (list: PioPinPlace[], pins: CircuitPin[]) => pins.map((p, i) => list.find((q) => p.id === `${comp.id}_${q.key}`) ?? list[i] ?? { x: 0, y: 0 });
  return { inputs: at(l.inputs, comp.inputs), outputs: at(l.outputs, comp.outputs) };
}

const snap = (v: number): number => Math.round(v / 10) * 10;

/**
 * The part with new attributes. When the pins change (width, direction, IRQ) they are built again: pins that stay
 * keep their ids, so their wires follow; a wire on a removed pin's point moves to the new pin there (a bidirectional
 * bit becoming an output bit), else it stays as an open end.
 */
export function withPioState(comp: CircuitComponentInstance, patch: Partial<SocPioPartState>): PartAttrEdit {
  const state = { ...pioState(comp), ...patch };
  const s = pioState({ ...comp, state: { ...comp.state, part: state } });
  const next = { ...comp, state: { ...comp.state, part: s satisfies SocPioPartState } };
  const layout = pioPinLayout(s);
  const id = (key: string) => `${comp.id}_${key}`;
  const same = (pins: CircuitPin[], list: PioPinPlace[]) => pins.length === list.length && pins.every((p, i) => p.id === id(list[i].key));
  if (same(comp.inputs, layout.inputs) && same(comp.outputs, layout.outputs)) return { comp: next, stateOnly: true };
  const old = new Map([...comp.inputs, ...comp.outputs].map((p) => [p.id, p]));
  const build = (list: PioPinPlace[], type: 'input' | 'output'): CircuitPin[] =>
    list.map((q) => {
      const kept = old.get(id(q.key));
      if (kept && kept.type === type) return { ...kept, name: q.name };
      return { id: id(q.key), name: q.name, type, value: type === 'output' && q.key.startsWith('io') ? 'Z' : 0, x: comp.x, y: comp.y };
    });
  const inputs = build(layout.inputs, 'input');
  const outputs = build(layout.outputs, 'output');
  // wires follow by grid point: a kept pin keeps its id; a point that now holds another pin hands its wires on to it
  // (the output of a bidirectional pair, which the wires attach to)
  const byPoint = new Map<string, string>();
  for (const q of layout.outputs) byPoint.set(`${q.x},${q.y}`, id(q.key));
  for (const q of layout.inputs) if (!byPoint.has(`${q.x},${q.y}`)) byPoint.set(`${q.x},${q.y}`, id(q.key));
  const kept = new Set([...inputs, ...outputs].map((p) => p.id));
  const points = pinPoints(comp);
  const remap = new Map<string, string | null>();
  const place = (p: CircuitPin, rel: { x: number; y: number }) => {
    const key = `${snap(p.x)},${snap(p.y)}`;
    if (kept.has(p.id)) remap.set(key, p.id);
    else if (!remap.has(key)) remap.set(key, byPoint.get(`${rel.x},${rel.y}`) ?? null);
  };
  comp.outputs.forEach((p, i) => place(p, points.outputs[i]));
  comp.inputs.forEach((p, i) => place(p, points.inputs[i]));
  return { comp: { ...next, inputs, outputs }, remap };
}

/** A new part: evo's defaults (1 input bit, not connected) and no label, so its name is "SoC PIO@x,y" */
export function newPio(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withPioState(comp, { ...normalizePioConfig({}), busId: '' }).comp;
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
