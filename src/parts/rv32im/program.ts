// The RV32IM's description for the shared processor UI (src/parts/shared/cpu) and its program loading: an RV32 ELF
// file or the assembler window, written over the CPU's bus (see shared/cpu/program.ts).
import { EM_RISCV, rv32imAssembler, type ProgramImage } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import * as shared from '../shared/cpu/program';
import type { CpuPartUi } from '../shared/cpu/types';
import { cpuName, cpuState } from './model';
import { cpuRuntime, peekCpu, type CpuRuntime } from './runtime';
import { NS, haltText, t } from './text';

export { diagnosticText, elfTooLarge, type AssembleOutcome, type LoadOutcome } from '../shared/cpu/program';

/**
 * The part's run-time object for the windows (made now when the simulation has not run yet). An existing one is
 * returned as it is: only the simulation (syncRun / simulate) reconfigures it or applies a new epoch, so a render
 * with an older copy of the part cannot reset the core.
 */
export function runtimeOf(comp: CircuitComponentInstance): CpuRuntime {
  const known = peekCpu(comp.id);
  if (known) return known;
  const s = cpuState(comp);
  return cpuRuntime({ key: comp.id, busId: s.busId, name: cpuName(comp), resetVector: s.resetVector, plicBase: s.plicBase, irqWidth: s.irqWidth, epoch: s.epoch ?? 0 });
}

export const RV32IM_UI: CpuPartUi = {
  tag: 'rv32im',
  ns: NS,
  t,
  haltText,
  runtimeOf,
  name: cpuName,
  asmSource: (comp) => cpuState(comp).asm,
  assembler: rv32imAssembler,
  elfMachine: EM_RISCV,
};

export const loadImage = (rt: CpuRuntime, image: ProgramImage) => shared.loadImage(RV32IM_UI, rt, image);
export const loadElf = (rt: CpuRuntime, bytes: Uint8Array) => shared.loadElf(RV32IM_UI, rt, bytes);
export const assembleAndLoad = (rt: CpuRuntime, source: string) => shared.assembleAndLoad(RV32IM_UI, rt, source);
