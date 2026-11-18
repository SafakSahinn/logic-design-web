// RV32IM part: its state (evo's Rv32im attributes: resetVector, irqWidth, plicBaseAddress, stateVisible,
// SocBusSelection), pins and geometry. The processor itself (registers, pc, trace, PLIC) lives in the run-time
// object of runtime.ts, keyed by the component id; comp.state.part keeps only what is JSON-safe.
import { MAX_IRQS, PLIC_DEFAULT_BASE } from '../../soc';
import type { CircuitComponentInstance, CircuitPin } from '../../types/circuit';
import type { SignalValue } from '../../types/logic';
import { partName, type PartAttrEdit } from '../registry';
import { MAX_ASM_SOURCE } from '../shared/cpu/types';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

/** evo's bounds: 640 x 640 */
export const BODY_WIDTH = 640;
export const BODY_HEIGHT = 640;
/** evo's pins: Reset (0,610), Clock (0,630), IRQi (0, 10 + 10 i) */
export const RESET_Y = 610;
export const CLOCK_Y = 630;
export const IRQ_TOP = 10;
export const IRQ_GAP = 10;
export { MAX_ASM_SOURCE };

/** What the part keeps in comp.state.part (JSON-safe) */
export interface Rv32imPartState {
  /** pc after a reset when no program is loaded (unsigned) */
  resetVector: number;
  /** Number of IRQ pins = PLIC sources (0..32) */
  irqWidth: number;
  /** Word aligned, unsigned */
  plicBase: number;
  /** evo's stateVisible: off draws a grey box (faster with a busy CPU) */
  stateVisible: boolean;
  /** Id of the bus the CPU masters and the PLIC answers on ('' = not connected) */
  busId: string;
  /** Source of the assembler window */
  asm?: string;
  /** Clock level at the previous evaluation (edge detection) */
  lastClk?: SignalValue;
  /** Bumped by a simulation reset: the core and the PLIC start again */
  epoch?: number;
}

const u32 = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? (v % 2 ** 32) >>> 0 : fallback);

export const clampIrqWidth = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(MAX_IRQS, Math.max(0, Math.round(n))) : 0;

export function cpuState(comp: CircuitComponentInstance): Rv32imPartState {
  const s = comp.state.part as Partial<Rv32imPartState> | undefined;
  return {
    resetVector: u32(s?.resetVector, 0),
    irqWidth: clampIrqWidth(s?.irqWidth),
    plicBase: (u32(s?.plicBase, PLIC_DEFAULT_BASE) & ~3) >>> 0,
    stateVisible: s?.stateVisible !== false,
    busId: typeof s?.busId === 'string' ? s.busId : '',
    ...(typeof s?.asm === 'string' ? { asm: s.asm.slice(0, MAX_ASM_SOURCE) } : {}),
    ...(s?.lastClk !== undefined ? { lastClk: s.lastClk } : {}),
    ...(typeof s?.epoch === 'number' ? { epoch: s.epoch } : {}),
  };
}

export function withCpuState(comp: CircuitComponentInstance, patch: Partial<Rv32imPartState>): CircuitComponentInstance {
  return { ...comp, state: { ...comp.state, part: { ...cpuState(comp), ...patch } satisfies Rv32imPartState } };
}

export function cpuName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

/** Pin ids: reset, clock, irq0..irqN-1 (inputs in that order, as evo's ports 0, 1, 2..) */
export const irqPinId = (i: number): string => `irq${i}`;

/** Places of the pins in the unrotated body, in comp.inputs order */
export function pinPoints(comp: CircuitComponentInstance): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  return {
    inputs: comp.inputs.map((_, i) => ({ x: 0, y: i === 0 ? RESET_Y : i === 1 ? CLOCK_Y : IRQ_TOP + IRQ_GAP * (i - 2) })),
    outputs: [],
  };
}

const snap = (v: number): number => Math.round(v / 10) * 10;

/** The part with `n` IRQ pins; the kept pins keep their ids (wires follow), removed ones leave open wire ends */
export function withIrqWidth(comp: CircuitComponentInstance, n: number): PartAttrEdit {
  const width = clampIrqWidth(n);
  const next = withCpuState(comp, { irqWidth: width });
  const have = comp.inputs.length - 2;
  if (have === width) return { comp: next, stateOnly: true };
  const keep = comp.inputs.slice(0, 2 + Math.min(have, width));
  const added: CircuitPin[] = [];
  for (let i = have; i < width; i++) added.push({ id: `${comp.id}_${irqPinId(i)}`, name: `IRQ${i}`, type: 'input', value: 0, x: comp.x, y: comp.y });
  const inputs = [...keep, ...added];
  const kept = new Set(inputs.map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of comp.inputs) remap.set(`${snap(p.x)},${snap(p.y)}`, kept.has(p.id) ? p.id : null);
  return { comp: { ...next, inputs }, remap };
}

/** A new part: evo's defaults and no label, so its name is "RV32IM@x,y" */
export function newCpu(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withCpuState(comp, { resetVector: 0, irqWidth: 0, plicBase: PLIC_DEFAULT_BASE, stateVisible: true, busId: '' });
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
