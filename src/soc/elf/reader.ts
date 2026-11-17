// ELF32 reader (Aşama 6e), for the programs a SoC processor loads (evo: ElfHeader / ElfProgramHeader /
// ElfSectionHeader / ProcessorReadElf). The file is untrusted input: every offset, size and count is checked
// against the buffer before it is read, and the loadable size is capped.

export const EM_OPENRISC = 92;
export const EM_INTEL_NIOS2 = 113;
export const EM_RISCV = 243;
/** Architecture names as evo shows them */
export const ELF_ARCHITECTURES: Record<number, string> = {
  [EM_OPENRISC]: 'Open Risc',
  [EM_INTEL_NIOS2]: 'Nios II',
  [EM_RISCV]: 'Risc V',
};

export const ET_EXEC = 2;
export const PT_LOAD = 1;
export const SHT_SYMTAB = 2;
export const SHT_STRTAB = 3;
export const SHT_NOBITS = 8;
export const SHF_WRITE = 0x1;
export const SHF_ALLOC = 0x2;
export const SHF_EXECINSTR = 0x4;
export const PF_X = 0x1;
export const STT_FUNC = 2;
export const STT_SECTION = 3;
export const STT_FILE = 4;

/** Largest file read (bytes) */
export const MAX_ELF_FILE_BYTES = 128 * 1024 * 1024;
/** Largest sum of the PT_LOAD memory sizes (bytes): the largest SoC memory is 64 MiB */
export const MAX_ELF_LOAD_BYTES = 64 * 1024 * 1024;
/** Most symbols kept */
export const MAX_ELF_SYMBOLS = 200000;
/** Longest name read from a string table */
const MAX_NAME_BYTES = 4096;

/** Why a file cannot be loaded; i18n key "elf.error.<code>" in namespace "soc" */
export type ElfErrorCode =
  | 'tooLarge'
  | 'tooSmall'
  | 'notElf'
  | 'not32Bit'
  | 'badEndian'
  | 'badVersion'
  | 'notExecutable'
  | 'wrongArchitecture'
  | 'endianMismatch'
  | 'badProgramHeaders'
  | 'badSegment'
  | 'segmentTooLarge'
  | 'segmentOverflow'
  | 'badSectionHeaders'
  | 'badStringTable'
  | 'badSymbolTable';

export class ElfError extends Error {
  readonly code: ElfErrorCode;
  readonly args: Record<string, string>;
  constructor(code: ElfErrorCode, args: Record<string, string> = {}) {
    super(`ELF: ${code}${Object.keys(args).length ? ' ' + JSON.stringify(args) : ''}`);
    this.code = code;
    this.args = args;
  }
}

export interface ElfSegment {
  type: number;
  flags: number;
  offset: number;
  vaddr: number;
  paddr: number;
  fileSize: number;
  memSize: number;
}

export interface ElfSection {
  name: string;
  type: number;
  flags: number;
  addr: number;
  offset: number;
  size: number;
  link: number;
}

export interface ElfSymbol {
  name: string;
  value: number;
  size: number;
  /** STT_* */
  type: number;
  /** STB_* */
  bind: number;
  sectionIndex: number;
}

export interface ElfFile {
  littleEndian: boolean;
  machine: number;
  type: number;
  entry: number;
  flags: number;
  segments: ElfSegment[];
  sections: ElfSection[];
  symbols: ElfSymbol[];
  /** The file itself (segment data is read from it) */
  bytes: Uint8Array;
}

export interface ElfExpectations {
  /** Required e_machine (EM_RISCV, EM_INTEL_NIOS2) */
  machine?: number;
  /** Required byte order */
  littleEndian?: boolean;
}

function architectureName(machine: number): string {
  return ELF_ARCHITECTURES[machine] ?? `#${machine}`;
}

/** Bounded reader over the file bytes */
class Reader {
  readonly view: DataView;
  readonly le: boolean;
  readonly size: number;
  constructor(bytes: Uint8Array, le: boolean) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.le = le;
    this.size = bytes.byteLength;
  }
  /** offset..offset+length lies in the file (all values are non-negative safe integers) */
  fits(offset: number, length: number): boolean {
    return offset >= 0 && length >= 0 && offset <= this.size && length <= this.size - offset;
  }
  u16(o: number): number {
    return this.view.getUint16(o, this.le);
  }
  u32(o: number): number {
    return this.view.getUint32(o, this.le);
  }
}

/** Parses an ELF32 executable and checks it against the processor's expectations */
export function readElf(bytes: Uint8Array, expect: ElfExpectations = {}): ElfFile {
  if (bytes.byteLength > MAX_ELF_FILE_BYTES) throw new ElfError('tooLarge');
  if (bytes.byteLength < 16) throw new ElfError('tooSmall');
  if (bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) throw new ElfError('notElf');
  if (bytes[4] !== 1) throw new ElfError('not32Bit');
  if (bytes[5] !== 1 && bytes[5] !== 2) throw new ElfError('badEndian');
  if (bytes[6] !== 1) throw new ElfError('badVersion');
  const le = bytes[5] === 1;
  const r = new Reader(bytes, le);
  if (!r.fits(0, 52)) throw new ElfError('tooSmall');
  const type = r.u16(16);
  const machine = r.u16(18);
  const entry = r.u32(24);
  const phoff = r.u32(28);
  const shoff = r.u32(32);
  const flags = r.u32(36);
  const phentsize = r.u16(42);
  const phnum = r.u16(44);
  const shentsize = r.u16(46);
  const shnum = r.u16(48);
  const shstrndx = r.u16(50);

  if (type !== ET_EXEC) throw new ElfError('notExecutable');
  if (expect.machine !== undefined && machine !== expect.machine) {
    throw new ElfError('wrongArchitecture', { found: architectureName(machine), expected: architectureName(expect.machine) });
  }
  if (expect.littleEndian !== undefined && le !== expect.littleEndian) {
    throw new ElfError('endianMismatch', {
      found: le ? 'little endian' : 'big endian',
      expected: expect.littleEndian ? 'little endian' : 'big endian',
    });
  }

  // program headers
  if (phnum === 0 || phentsize < 32 || !r.fits(phoff, phentsize * phnum)) throw new ElfError('badProgramHeaders');
  const segments: ElfSegment[] = [];
  let loadTotal = 0;
  for (let i = 0; i < phnum; i++) {
    const o = phoff + i * phentsize;
    const seg: ElfSegment = {
      type: r.u32(o),
      offset: r.u32(o + 4),
      vaddr: r.u32(o + 8),
      paddr: r.u32(o + 12),
      fileSize: r.u32(o + 16),
      memSize: r.u32(o + 20),
      flags: r.u32(o + 24),
    };
    if (seg.type === PT_LOAD) {
      if (seg.fileSize > seg.memSize || !r.fits(seg.offset, seg.fileSize)) throw new ElfError('badSegment', { index: String(i) });
      loadTotal += seg.memSize;
      if (loadTotal > MAX_ELF_LOAD_BYTES) throw new ElfError('segmentTooLarge');
      if (seg.paddr + seg.memSize > 0x100000000) throw new ElfError('segmentOverflow', { index: String(i) });
    }
    segments.push(seg);
  }

  // section headers (optional: a file without them simply has no section names or symbols)
  const sections: ElfSection[] = [];
  if (shnum > 0) {
    if (shentsize < 40 || !r.fits(shoff, shentsize * shnum)) throw new ElfError('badSectionHeaders');
    const nameOffsets: number[] = [];
    for (let i = 0; i < shnum; i++) {
      const o = shoff + i * shentsize;
      nameOffsets.push(r.u32(o));
      sections.push({
        name: '',
        type: r.u32(o + 4),
        flags: r.u32(o + 8),
        addr: r.u32(o + 12),
        offset: r.u32(o + 16),
        size: r.u32(o + 20),
        link: r.u32(o + 24),
      });
    }
    if (shstrndx !== 0) {
      const strtab = sections[shstrndx];
      if (!strtab || strtab.type !== SHT_STRTAB || !r.fits(strtab.offset, strtab.size)) throw new ElfError('badStringTable');
      sections.forEach((s, i) => (s.name = readString(bytes, strtab.offset, strtab.size, nameOffsets[i])));
    }
  }

  return { littleEndian: le, machine, type, entry, flags, segments, sections, symbols: readSymbols(r, bytes, sections), bytes };
}

/** NUL-terminated string at `index` of a string table; an index outside the table gives "" */
function readString(bytes: Uint8Array, tableOffset: number, tableSize: number, index: number): string {
  if (index >= tableSize) return '';
  const start = tableOffset + index;
  const limit = Math.min(tableOffset + tableSize, start + MAX_NAME_BYTES);
  let end = start;
  while (end < limit && bytes[end] !== 0) end++;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(start, end));
}

function readSymbols(r: Reader, bytes: Uint8Array, sections: ElfSection[]): ElfSymbol[] {
  const symbols: ElfSymbol[] = [];
  for (const tab of sections) {
    if (tab.type !== SHT_SYMTAB) continue;
    const strtab = sections[tab.link];
    if (!strtab || strtab.type !== SHT_STRTAB || !r.fits(strtab.offset, strtab.size)) throw new ElfError('badSymbolTable');
    if (!r.fits(tab.offset, tab.size) || tab.size % 16 !== 0) throw new ElfError('badSymbolTable');
    for (let o = tab.offset; o < tab.offset + tab.size; o += 16) {
      if (symbols.length >= MAX_ELF_SYMBOLS) return symbols;
      const info = bytes[o + 12];
      symbols.push({
        name: readString(bytes, strtab.offset, strtab.size, r.u32(o)),
        value: r.u32(o + 4),
        size: r.u32(o + 8),
        type: info & 0xf,
        bind: info >> 4,
        sectionIndex: r.u16(o + 14),
      });
    }
  }
  return symbols;
}

/** Bytes of a segment as stored in the file (memSize - fileSize more bytes are zero) */
export function segmentData(elf: ElfFile, seg: ElfSegment): Uint8Array {
  return elf.bytes.subarray(seg.offset, seg.offset + seg.fileSize);
}
