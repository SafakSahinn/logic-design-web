// What the shared processor UI (run controls, ELF loading, assembler window, listing, trace, body bars) needs from a
// processor part (RV32IM, Nios II). Each part fills a CpuPartUi once and hands it to the shared pieces.
import type { IsaAssembler, ProgramImage } from '../../../soc';
import type { CircuitComponentInstance } from '../../../types/circuit';

export type CpuRunState = 'running' | 'stopped' | 'breakpoint' | 'error';

/** Why the core stopped: an i18n key in the core's namespace and its arguments */
export interface CpuHalt {
  key: string;
  args: Record<string, string | number>;
}

export interface CpuTraceEntry {
  pc: number;
  /** The fetched word; null when the fetch failed */
  word: number | null;
  text: string;
  error: boolean;
  /** Exception cause the instruction took */
  trap?: number;
}

/** The parts of a core the shared UI drives */
export interface CpuCoreLike {
  runState: CpuRunState;
  halt: CpuHalt | null;
  pc: number;
  trace: readonly CpuTraceEntry[];
  readonly breakpoints: Set<number>;
  toggleRun(): void;
  step(): void;
  reset(entry?: number): void;
}

/** A processor part's run-time object (kept outside the circuit, keyed by the component id) */
export interface CpuRuntimeLike {
  core: CpuCoreLike;
  /** The bus the core masters */
  busId: string;
  name: string;
  /** The last loaded program (listing, symbols); null when none */
  program: ProgramImage | null;
  /** Bumped whenever the program or the breakpoints change (the windows re-read) */
  version: number;
}

export interface CpuPartUi {
  /** Name of the data-* attribute on the UI's controls (test hooks), e.g. 'rv32im' gives data-rv32im="step" */
  tag: string;
  /** The part's i18n namespace (its locale has the editor / asm / listing / load / run / body / dialog keys) */
  ns: string;
  /** A text of the part's namespace */
  t(key: string, params?: Record<string, unknown>): string;
  /** The core's halt message, translated */
  haltText(halt: CpuHalt): string;
  /** The part's run-time object for the windows (made when the simulation has not run yet) */
  runtimeOf(comp: CircuitComponentInstance): CpuRuntimeLike;
  /** The part's name in titles and traces */
  name(comp: CircuitComponentInstance): string;
  /** Assembler source kept with the part */
  asmSource(comp: CircuitComponentInstance): string | undefined;
  /** The ISA of the assembler window and the listing */
  assembler: IsaAssembler;
  /** ELF e_machine accepted by "Load ELF…" (always little endian) */
  elfMachine: number;
}

/** Longest assembler source kept with a part (it is saved with the circuit) */
export const MAX_ASM_SOURCE = 1024 * 1024;

/** Commands of a processor's editor attribute row (its value is JSON) */
export type CpuEditorCommand = { op: 'asm'; text: string };
