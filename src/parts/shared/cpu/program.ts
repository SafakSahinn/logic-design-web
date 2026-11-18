// Loading a program into a processor part's memory (evo's "Read ELF file" and the assembler window): hidden byte
// writes over the CPU's bus, then a reset to the program's entry point. Shared by the processor parts; texts are
// returned translated.
import i18n from '../../../i18n';
import {
  BYTE_ACCESS,
  ElfError,
  READ_TRANSACTION,
  SOC_NAMESPACE,
  SocBusError,
  SocTransaction,
  assemble,
  busErrorName,
  loadProgram,
  programFromElf,
  programSize,
  readElf,
  type AsmDiagnostic,
  type ProgramImage,
} from '../../../soc';
import { socHex as hex, socManager } from '../socRuntime';
import type { CpuPartUi, CpuRuntimeLike } from './types';

export type LoadOutcome = { ok: true; message: string } | { ok: false; message: string };

const socText = (key: string, args: Record<string, unknown> = {}) => i18n.t(`${SOC_NAMESPACE}:${key}`, args);

/** Writes the program over the CPU's bus and resets the core to its entry point (stopped, as evo) */
export function loadImage(ui: CpuPartUi, rt: CpuRuntimeLike, image: ProgramImage): LoadOutcome {
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
  return { ok: true, message: ui.t('load.done', { bytes: programSize(image), entry: hex(image.entry) }) };
}

/** A file too large to be read at all */
export const elfTooLarge = (): LoadOutcome => ({ ok: false, message: socText('elf.error.tooLarge') });

/** Reads an ELF executable for the part's machine and loads it */
export function loadElf(ui: CpuPartUi, rt: CpuRuntimeLike, bytes: Uint8Array): LoadOutcome {
  try {
    const elf = readElf(bytes, { machine: ui.elfMachine, littleEndian: true });
    return loadImage(ui, rt, programFromElf(elf));
  } catch (e) {
    if (e instanceof ElfError) return { ok: false, message: socText(`elf.error.${e.code}`, e.args) };
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export interface AssembleOutcome {
  outcome: LoadOutcome;
  diagnostics: AsmDiagnostic[];
}

/** Assembles the source with the part's ISA and loads the program */
export function assembleAndLoad(ui: CpuPartUi, rt: CpuRuntimeLike, source: string): AssembleOutcome {
  const r = assemble(source, ui.assembler);
  if (!r.ok || !r.image) return { outcome: { ok: false, message: ui.t('asm.failed', { count: r.diagnostics.length }) }, diagnostics: r.diagnostics };
  if (!r.entryFound) return { outcome: { ok: false, message: ui.t('asm.noCode') }, diagnostics: r.diagnostics };
  return { outcome: loadImage(ui, rt, r.image), diagnostics: r.diagnostics };
}

/** A diagnostic of the assembler in the current UI language */
export const diagnosticText = (d: AsmDiagnostic): string => i18n.t(`${d.ns}:${d.key}`, d.args ?? {});

/** A byte of the CPU's bus as the core would read it, without a trace row (listing); undefined on a bus error */
export function peekBusByte(busId: string, address: number): number | undefined {
  const t = new SocTransaction(READ_TRANSACTION, address >>> 0, 0, BYTE_ACCESS, 'listing');
  t.hidden = true;
  socManager.transact(busId, t);
  return t.error === SocBusError.none ? t.readData & 0xff : undefined;
}

/**
 * A core's halt message in the current UI language: `ns` is the core's namespace; a bus error name in the arguments
 * is translated through the soc namespace and follows the text
 */
export function coreHaltText(ns: string, halt: { key: string; args: Record<string, string | number> }): string {
  const args: Record<string, unknown> = { ...halt.args };
  if (typeof args.error === 'string') args.error = i18n.t(`${SOC_NAMESPACE}:bus.error.${args.error}`);
  const text = i18n.t(`${ns}:${halt.key}`, args);
  // the halt texts name the failing access; the bus error follows them
  return typeof args.error === 'string' ? `${text}: ${args.error}` : text;
}
