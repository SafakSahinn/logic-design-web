// Nios II part: its state (evo's Nios2 attributes: resetVector, exceptionVector, breakVector, irqWidth, stateVisible,
// SocBusSelection), pins and geometry. The processor itself (registers, pc, trace) lives in the run-time object of
// runtime.ts, keyed by the component id; comp.state.part keeps only what is JSON-safe.
import { NIOS2_MAX_IRQS } from '../../soc';
import type { CircuitComponentInstance, CircuitPin } from '../../types/circuit';
import type { SignalValue } from '../../types/logic';
import { partName, type PartAttrEdit } from '../registry';
import { MAX_ASM_SOURCE } from '../shared/cpu/types';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

/** evo's bounds: 640 x 650 */
export const BODY_WIDTH = 640;
export const BODY_HEIGHT = 650;
/** evo draws the processor state (and the bars below it) 10 lower than the RV32IM, below the top pins' names */
export const STATE_OFFSET = 10;
/** evo's pins: Reset (0,620), Clock (0,640), IRQi (0, 40 + 10 i) */
export const RESET_Y = 620;
export const CLOCK_Y = 640;
export const IRQ_TOP = 40;
export const IRQ_GAP = 10;

/** The custom-instruction pins on the top edge (evo's ports, x and bit width); outputs in this order */
export const CUSTOM_OUTPUTS = [
  { id: 'dataa', x: 30, width: 32 },
  { id: 'datab', x: 80, width: 32 },
  { id: 'start', x: 130, width: 1 },
  { id: 'n', x: 180, width: 8 },
  { id: 'a', x: 230, width: 5 },
  { id: 'readra', x: 280, width: 1 },
  { id: 'b', x: 330, width: 5 },
  { id: 'readrb', x: 380, width: 1 },
  { id: 'c', x: 430, width: 5 },
  { id: 'writerc', x: 480, width: 1 },
] as const;
/** done and result: inputs 2 and 3 */
export const DONE_X = 560;
export const RESULT_X = 610;
/** Inputs before the IRQ pins: reset, clock, done, result */
export const FIXED_INPUTS = 4;

export { MAX_ASM_SOURCE };

/** What the part keeps in comp.state.part (JSON-safe) */
export interface Nios2PartState {
  /** pc after a reset when no program is loaded (unsigned) */
  resetVector: number;
  /** Where interrupts and trap go (unsigned) */
  exceptionVector: number;
  /** Where break goes (unsigned) */
  breakVector: number;
  /** Number of IRQ pins (0..32) */
  irqWidth: number;
  /** evo's stateVisible: off draws a grey box (faster with a busy CPU) */
  stateVisible: boolean;
  /** Id of the bus the CPU masters ('' = not connected) */
  busId: string;
  /** Source of the assembler window */
  asm?: string;
  /** Clock level at the previous evaluation (edge detection) */
  lastClk?: SignalValue;
  /** Bumped by a simulation reset: the core starts again */
  epoch?: number;
}

export const DEFAULT_EXCEPTION_VECTOR = 0x14;
export const DEFAULT_BREAK_VECTOR = 0x30;

const u32 = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? (v % 2 ** 32) >>> 0 : fallback);

export const clampIrqWidth = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(NIOS2_MAX_IRQS, Math.max(0, Math.round(n))) : 0;

export function cpuState(comp: CircuitComponentInstance): Nios2PartState {
  const s = comp.state.part as Partial<Nios2PartState> | undefined;
  return {
    resetVector: u32(s?.resetVector, 0),
    exceptionVector: u32(s?.exceptionVector, DEFAULT_EXCEPTION_VECTOR),
    breakVector: u32(s?.breakVector, DEFAULT_BREAK_VECTOR),
    irqWidth: clampIrqWidth(s?.irqWidth),
    stateVisible: s?.stateVisible !== false,
    busId: typeof s?.busId === 'string' ? s.busId : '',
    ...(typeof s?.asm === 'string' ? { asm: s.asm.slice(0, MAX_ASM_SOURCE) } : {}),
    ...(s?.lastClk !== undefined ? { lastClk: s.lastClk } : {}),
    ...(typeof s?.epoch === 'number' ? { epoch: s.epoch } : {}),
  };
}

export function withCpuState(comp: CircuitComponentInstance, patch: Partial<Nios2PartState>): CircuitComponentInstance {
  return { ...comp, state: { ...comp.state, part: { ...cpuState(comp), ...patch } satisfies Nios2PartState } };
}

export function cpuName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

/** Pin ids: reset, clock, done, result, irq0..irqN-1 (inputs in that order); the custom outputs as CUSTOM_OUTPUTS */
export const irqPinId = (i: number): string => `irq${i}`;

const inputPoint = (i: number): { x: number; y: number } => {
  switch (i) {
    case 0:
      return { x: 0, y: RESET_Y };
    case 1:
      return { x: 0, y: CLOCK_Y };
    case 2:
      return { x: DONE_X, y: 0 };
    case 3:
      return { x: RESULT_X, y: 0 };
    default:
      return { x: 0, y: IRQ_TOP + IRQ_GAP * (i - FIXED_INPUTS) };
  }
};

/** Places of the pins in the unrotated body, in comp.inputs / comp.outputs order */
export function pinPoints(comp: CircuitComponentInstance): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  return {
    inputs: comp.inputs.map((_, i) => inputPoint(i)),
    outputs: comp.outputs.map((_, i) => ({ x: CUSTOM_OUTPUTS[i]?.x ?? 0, y: 0 })),
  };
}

const snap = (v: number): number => Math.round(v / 10) * 10;

/** The part with `n` IRQ pins; the kept pins keep their ids (wires follow), removed ones leave open wire ends */
export function withIrqWidth(comp: CircuitComponentInstance, n: number): PartAttrEdit {
  const width = clampIrqWidth(n);
  const next = withCpuState(comp, { irqWidth: width });
  const have = comp.inputs.length - FIXED_INPUTS;
  if (have === width) return { comp: next, stateOnly: true };
  const keep = comp.inputs.slice(0, FIXED_INPUTS + Math.min(have, width));
  const added: CircuitPin[] = [];
  for (let i = have; i < width; i++) added.push({ id: `${comp.id}_${irqPinId(i)}`, name: `IRQ${i}`, type: 'input', value: 0, x: comp.x, y: comp.y });
  const inputs = [...keep, ...added];
  const kept = new Set(inputs.map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of comp.inputs) remap.set(`${snap(p.x)},${snap(p.y)}`, kept.has(p.id) ? p.id : null);
  return { comp: { ...next, inputs }, remap };
}

/** A new part: evo's defaults and no label, so its name is "Nios II@x,y" */
export function newCpu(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withCpuState(comp, {
    resetVector: 0,
    exceptionVector: DEFAULT_EXCEPTION_VECTOR,
    breakVector: DEFAULT_BREAK_VECTOR,
    irqWidth: 0,
    stateVisible: true,
    busId: '',
  });
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
