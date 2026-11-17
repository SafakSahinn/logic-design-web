// SoC Memory part: its state (evo's SocMemory attributes: StartAddress, MemSize, SocBusSelection) and geometry.
import { MEM_SIZE_DEFAULT_BITS, clampMemSizeBits, type SocMemoryConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName } from '../registry';
import { socPartName, type SocMemoryEntry } from '../shared/socRuntime';
import { PART_ID } from './id';

/** evo's bounds: 320 x 60 */
export const BODY_WIDTH = 320;
export const BODY_HEIGHT = 60;

/** What the part keeps in comp.state.part (JSON-safe); the contents live in the run-time object, not here */
export interface SocMemoryPartState {
  /** Unsigned, word aligned */
  startAddress: number;
  /** log2 of the size in bytes */
  sizeBits: number;
  /** Id of the bus it answers on ('' = not connected) */
  busId: string;
  /** Bumped by a simulation reset: the contents are forgotten */
  epoch?: number;
}

export function memoryState(comp: CircuitComponentInstance): SocMemoryPartState {
  const s = comp.state.part as Partial<SocMemoryPartState> | undefined;
  const start = typeof s?.startAddress === 'number' && Number.isFinite(s.startAddress) ? s.startAddress : 0;
  return {
    startAddress: (start & ~3) >>> 0,
    sizeBits: clampMemSizeBits(typeof s?.sizeBits === 'number' ? s.sizeBits : MEM_SIZE_DEFAULT_BITS),
    busId: typeof s?.busId === 'string' ? s.busId : '',
    ...(typeof s?.epoch === 'number' ? { epoch: s.epoch } : {}),
  };
}

export function withMemoryState(comp: CircuitComponentInstance, patch: Partial<SocMemoryPartState>): CircuitComponentInstance {
  return { ...comp, state: { ...comp.state, part: { ...memoryState(comp), ...patch } satisfies SocMemoryPartState } };
}

export const memoryConfig = (comp: CircuitComponentInstance): SocMemoryConfig => {
  const s = memoryState(comp);
  return { startAddress: s.startAddress, sizeBits: s.sizeBits };
};

export function memoryName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

export function memoryEntry(comp: CircuitComponentInstance): SocMemoryEntry {
  const s = memoryState(comp);
  return { key: comp.id, busId: s.busId, config: memoryConfig(comp), name: memoryName(comp), epoch: s.epoch ?? 0 };
}

/** A new part: evo's defaults (start 0, 1 kB, not connected) and no label, so its name is "SoC Memory@x,y" */
export function newMemory(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withMemoryState(comp, { startAddress: 0, sizeBits: MEM_SIZE_DEFAULT_BITS, busId: '' });
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
