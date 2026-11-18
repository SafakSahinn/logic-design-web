// Loading a program into the RV32IM's memory (evo's "Read ELF file" and the assembler window): hidden byte writes over
// the CPU's bus, then a reset to the program's entry point. Texts are returned translated.
import i18n from '../../i18n';
import {
  EM_RISCV,
  ElfError,
  SOC_NAMESPACE,
  assemble,
  busErrorName,
  loadProgram,
  programFromElf,
  programSize,
  readElf,
  rv32imAssembler,
  type AsmDiagnostic,
  type ProgramImage,
} from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { socManager } from '../shared/socRuntime';
import { cpuName, cpuState } from './model';
import { cpuRuntime, peekCpu, type CpuRuntime } from './runtime';
import { hex, t } from './text';

export type LoadOutcome = { ok: true; message: string } | { ok: false; message: string };

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

const socText = (key: string, args: Record<string, unknown> = {}) => i18n.t(`${SOC_NAMESPACE}:${key}`, args);

/** Writes the program over the CPU's bus and resets the core to its entry point (stopped, as evo) */
export function loadImage(rt: CpuRuntime, image: ProgramImage): LoadOutcome {
  if (!socManager.getBus(rt.busId)) return { ok: false, message: socText('bus.error.noBusConnected') };
  const r = loadProgram(image, (tr) => socManager.transact(rt.busId, tr), rt.name);
  if (!r.ok) {
    return {
      ok: false,
      message: socText('elf.loadError', {
        address: hex(r.address ?? 0),
        start: hex(r.chunkStart ?? 0),
        end: hex(r.chunkEnd ?? 0),
        reason: socText(`bus.error.${busErrorName(r.error ?? 0)}`),
      }),
    };
  }
  rt.program = image;
  rt.core.breakpoints.clear();
  rt.core.reset(image.entry);
  rt.version++;
  return { ok: true, message: t('load.done', { bytes: programSize(image), entry: hex(image.entry) }) };
}

/** A file too large to be read at all */
export const elfTooLarge = (): LoadOutcome => ({ ok: false, message: socText('elf.error.tooLarge') });

/** Reads an ELF executable for RV32 and loads it */
export function loadElf(rt: CpuRuntime, bytes: Uint8Array): LoadOutcome {
  try {
    const elf = readElf(bytes, { machine: EM_RISCV, littleEndian: true });
    return loadImage(rt, programFromElf(elf));
  } catch (e) {
    if (e instanceof ElfError) return { ok: false, message: socText(`elf.error.${e.code}`, e.args) };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export interface AssembleOutcome {
  outcome: LoadOutcome;
  diagnostics: AsmDiagnostic[];
}

/** Assembles the source and loads the program */
export function assembleAndLoad(rt: CpuRuntime, source: string): AssembleOutcome {
  const r = assemble(source, rv32imAssembler);
  if (!r.ok || !r.image) return { outcome: { ok: false, message: t('asm.failed', { count: r.diagnostics.length }) }, diagnostics: r.diagnostics };
  if (!r.entryFound) return { outcome: { ok: false, message: t('asm.noCode') }, diagnostics: r.diagnostics };
  return { outcome: loadImage(rt, r.image), diagnostics: r.diagnostics };
}

/** A diagnostic of the assembler in the current UI language */
export const diagnosticText = (d: AsmDiagnostic): string => i18n.t(`${d.ns}:${d.key}`, d.args ?? {});
