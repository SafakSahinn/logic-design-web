// A program ready to load into SoC memory (Aşama 6e): what both the ELF reader and the assembler produce. A CPU
// (6f/6g) loads it with hidden byte writes over its bus, as evo does, then resets to the entry point.
import { BYTE_ACCESS, SocBusError, SocTransaction, WRITE_TRANSACTION, type SocBusErrorCode } from './bus/transaction';
import { PT_LOAD, SHF_ALLOC, SHF_EXECINSTR, STT_FILE, STT_SECTION, segmentData, type ElfFile } from './elf/reader';

export interface ProgramChunk {
  /** Unsigned load address */
  address: number;
  /** Bytes to write from `address` */
  data: Uint8Array;
  /** Zero bytes written after `data` (.bss, memsz > filesz) */
  zeroFill: number;
}

export interface ProgramSection {
  name: string;
  start: number;
  size: number;
  executable: boolean;
}

export interface ProgramSymbol {
  name: string;
  address: number;
}

export interface ProgramImage {
  /** Address the CPU starts at */
  entry: number;
  chunks: ProgramChunk[];
  /** Sections with an address (for the listing / debugger) */
  sections: ProgramSection[];
  /** Labels and functions, by address */
  symbols: ProgramSymbol[];
  /** Source line (0-based) of each instruction address, when the program was assembled here */
  lines?: Map<number, number>;
}

/** Program of an ELF executable: its PT_LOAD segments at their physical addresses (evo uses p_paddr) */
export function programFromElf(elf: ElfFile): ProgramImage {
  const chunks: ProgramChunk[] = elf.segments
    .filter((s) => s.type === PT_LOAD && s.memSize > 0)
    .map((s) => ({ address: s.paddr, data: segmentData(elf, s), zeroFill: s.memSize - s.fileSize }));
  const sections = elf.sections
    .filter((s) => (s.flags & SHF_ALLOC) !== 0 && s.size > 0)
    .map((s) => ({ name: s.name, start: s.addr, size: s.size, executable: (s.flags & SHF_EXECINSTR) !== 0 }));
  const symbols = elf.symbols
    // like objdump: no section/file symbols, no RISC-V/ARM mapping symbols ($x, $d.1) and no assembler locals (.L*)
    .filter((s) => s.name !== '' && s.type !== STT_SECTION && s.type !== STT_FILE && s.sectionIndex !== 0)
    .filter((s) => !/^\$[a-z](\.|$)/.test(s.name) && !s.name.startsWith('.L'))
    .map((s) => ({ name: s.name, address: s.value }));
  return { entry: elf.entry, chunks, sections, symbols };
}

/** Total bytes a load writes */
export function programSize(p: ProgramImage): number {
  return p.chunks.reduce((n, c) => n + c.data.length + c.zeroFill, 0);
}

export interface LoadResult {
  ok: boolean;
  /** First failing address and the bus error, when !ok */
  address?: number;
  error?: SocBusErrorCode;
  /** The range of the failing chunk (evo's message names it) */
  chunkStart?: number;
  chunkEnd?: number;
}

/**
 * Loads a program over a bus: one hidden byte write per byte (`transact` routes it; e.g. a SocManager bus).
 * Stops at the first error.
 */
export function loadProgram(
  p: ProgramImage,
  transact: (t: SocTransaction) => void,
  master = 'elf',
): LoadResult {
  for (const c of p.chunks) {
    const total = c.data.length + c.zeroFill;
    for (let j = 0; j < total; j++) {
      const address = (c.address + j) >>> 0;
      const t = new SocTransaction(WRITE_TRANSACTION, address, j < c.data.length ? c.data[j] : 0, BYTE_ACCESS, master);
      t.hidden = true;
      transact(t);
      if (t.hasError) {
        return { ok: false, address, error: t.error, chunkStart: c.address, chunkEnd: (c.address + total - 1) >>> 0 };
      }
    }
  }
  return { ok: true, error: SocBusError.none };
}
