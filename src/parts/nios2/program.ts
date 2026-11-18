// The Nios II's description for the shared processor UI (src/parts/shared/cpu) and its program loading: a Nios II ELF
// file (EM 113, little endian) or the assembler window, written over the CPU's bus (see shared/cpu/program.ts).
import { EM_INTEL_NIOS2, nios2Assembler, type ProgramImage } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import * as shared from '../shared/cpu/program';
import type { CpuPartUi } from '../shared/cpu/types';
import { cpuName, cpuState } from './model';
import { cpuRuntime, peekCpu, type CpuEntry, type CpuRuntime } from './runtime';
import { NS, haltText, t } from './text';

export { diagnosticText, elfTooLarge, type AssembleOutcome, type LoadOutcome } from '../shared/cpu/program';

/** What the run-time object of a part is made from */
export function entryOf(comp: CircuitComponentInstance): CpuEntry {
  const s = cpuState(comp);
  return {
    key: comp.id,
    busId: s.busId,
    name: cpuName(comp),
    resetVector: s.resetVector,
    exceptionVector: s.exceptionVector,
    breakVector: s.breakVector,
    irqWidth: s.irqWidth,
    epoch: s.epoch ?? 0,
  };
}

/**
 * The part's run-time object for the windows (made now when the simulation has not run yet). An existing one is
 * returned as it is: only the simulation (syncRun / simulate) reconfigures it or applies a new epoch, so a render
 * with an older copy of the part cannot reset the core.
 */
export function runtimeOf(comp: CircuitComponentInstance): CpuRuntime {
  return peekCpu(comp.id) ?? cpuRuntime(entryOf(comp));
}

export const NIOS2_UI: CpuPartUi = {
  tag: 'nios2',
  ns: NS,
  t,
  haltText,
  runtimeOf,
  name: cpuName,
  asmSource: (comp) => cpuState(comp).asm,
  assembler: nios2Assembler,
  elfMachine: EM_INTEL_NIOS2,
};

export const loadImage = (rt: CpuRuntime, image: ProgramImage) => shared.loadImage(NIOS2_UI, rt, image);
export const loadElf = (rt: CpuRuntime, bytes: Uint8Array) => shared.loadElf(NIOS2_UI, rt, bytes);
export const assembleAndLoad = (rt: CpuRuntime, source: string) => shared.assembleAndLoad(NIOS2_UI, rt, source);
