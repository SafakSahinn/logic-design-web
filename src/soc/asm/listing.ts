// Program listing of a loaded program (Aşama 6e), after evo's AbstractAssembler.getProgram: the sections of the
// program, read back from memory, as assembler text with labels; code is disassembled by the ISA, data shown as
// .word lines with their characters. Each line knows its address so a debugger can mark the current pc.
import type { ProgramImage } from '../program';
import type { IsaAssembler } from './isa';

export interface ListingLine {
  /** Address of the instruction or data on this line; null for headers and labels */
  address: number | null;
  text: string;
}

const hex8 = (n: number) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

function printable(b: number): string {
  return b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
}

/**
 * Listing of `program`; `readByte` reads the memory (undefined = nothing there). `maxLines` bounds the work for
 * very large programs.
 */
export function buildListing(
  program: ProgramImage,
  readByte: (address: number) => number | undefined,
  isa?: IsaAssembler,
  maxLines = 100000,
): ListingLine[] {
  const out: ListingLine[] = [];
  const labels = new Map<number, string[]>();
  for (const s of program.symbols) {
    const list = labels.get(s.address) ?? [];
    list.push(s.name);
    labels.set(s.address, list);
  }
  const sections = [...program.sections].sort((a, b) => a.start - b.start);
  for (const sec of sections) {
    if (out.length >= maxLines) break;
    out.push({ address: null, text: `.section ${sec.name}` });
    out.push({ address: null, text: `.org ${hex8(sec.start)}` });
    const end = sec.start + sec.size;
    let addr = sec.start;
    while (addr < end && out.length < maxLines) {
      for (const l of labels.get(addr) ?? []) out.push({ address: null, text: `${l}:` });
      if (sec.executable && isa?.disassemble) {
        const d = isa.disassemble(readByte, addr);
        if (d && d.size > 0) {
          out.push({ address: addr, text: `    ${d.text}` });
          addr += d.size;
          continue;
        }
      }
      // data (or an undecodable word): up to 4 bytes, stopping before the next label
      let n = 1;
      while (n < 4 && addr + n < end && !labels.has(addr + n)) n++;
      const bytes: number[] = [];
      for (let k = 0; k < n; k++) bytes.push(readByte(addr + k) ?? 0);
      const le = isa?.littleEndian ?? true;
      const value = (le ? [...bytes].reverse() : bytes).reduce((v, b) => v * 256 + b, 0);
      const directive = n === 4 ? '.word' : n === 2 ? '.half' : '.byte';
      const text =
        n === 4 || n === 2 || n === 1
          ? `    ${directive} 0x${value.toString(16).toUpperCase().padStart(n * 2, '0')}`
          : `    .byte ${bytes.map((b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0')).join(', ')}`;
      out.push({ address: addr, text: `${text.padEnd(28)}# ${bytes.map(printable).join('')}` });
      addr += n;
    }
  }
  return out;
}
