// Nios II disassembler (Aşama 6g): GNU objdump style with its register names and aliases (nop, mov, movi, movui,
// movhi). Branch, call and jmpi targets are absolute addresses, so every line assembles back to the same word at
// the same address.
import { ABI_NAMES, controlName, decode, type Decoded } from './isa';

const r = (i: number) => ABI_NAMES[i];
const addr = (n: number) => '0x' + (n >>> 0).toString(16).padStart(8, '0');

function line(mnemonic: string, operands = ''): string {
  return operands ? `${mnemonic.padEnd(7)} ${operands}` : mnemonic;
}

const LOADS_STORES = new Set([
  'ldb', 'ldbu', 'ldh', 'ldhu', 'ldw', 'ldbio', 'ldbuio', 'ldhio', 'ldhuio', 'ldwio',
  'stb', 'sth', 'stw', 'stbio', 'sthio', 'stwio',
]);
const BRANCHES = new Set(['beq', 'bne', 'bge', 'bgeu', 'blt', 'bltu']);
const CACHE_I = new Set(['flushd', 'flushda', 'initd', 'initda']);

/** Target of call / jmpi at `pc` */
export function jumpTarget(pc: number, imm26: number): number {
  return ((pc & 0xf0000000) | (imm26 << 2)) >>> 0;
}

/** Text of a decoded instruction at `pc` */
export function formatDecoded(d: Decoded, pc: number): string {
  const { op, a, b, c, imm } = d;
  if (d.format === 'custom') {
    const reg = (gp: boolean | undefined, i: number) => (gp ? r(i) : `c${i}`);
    return line('custom', `${d.n}, ${reg(d.writerc, c)}, ${reg(d.readra, a)}, ${reg(d.readrb, b)}`);
  }
  if (d.format === 'J') return line(op, addr(jumpTarget(pc, imm)));
  if (d.format === 'I') {
    if (LOADS_STORES.has(op)) return line(op, `${r(b)}, ${imm}(${r(a)})`);
    if (CACHE_I.has(op)) return line(op, `${imm}(${r(a)})`);
    if (BRANCHES.has(op)) return line(op, `${r(a)}, ${r(b)}, ${addr(pc + 4 + imm)}`);
    if (op === 'br') return line(op, addr(pc + 4 + imm));
    if (a === 0 && op === 'addi') return line('movi', `${r(b)}, ${imm}`);
    if (a === 0 && op === 'ori') return line('movui', `${r(b)}, ${imm}`);
    if (a === 0 && op === 'orhi') return line('movhi', `${r(b)}, ${imm >>> 16}`);
    const shown = op === 'andhi' || op === 'orhi' || op === 'xorhi' ? imm >>> 16 : imm;
    return line(op, `${r(b)}, ${r(a)}, ${shown}`);
  }
  // R-type
  switch (op) {
    case 'add':
      if (a === 0 && b === 0 && c === 0) return 'nop';
      if (b === 0) return line('mov', `${r(c)}, ${r(a)}`);
      return line(op, `${r(c)}, ${r(a)}, ${r(b)}`);
    case 'eret':
    case 'bret':
    case 'ret':
    case 'flushp':
    case 'sync':
      return op;
    case 'roli':
    case 'slli':
    case 'srli':
    case 'srai':
      return line(op, `${r(c)}, ${r(a)}, ${imm}`);
    case 'flushi':
    case 'initi':
    case 'jmp':
    case 'callr':
      return line(op, r(a));
    case 'nextpc':
      return line(op, r(c));
    case 'trap':
    case 'break':
      return imm ? line(op, String(imm)) : op;
    case 'rdctl':
      return line(op, `${r(c)}, ${controlName(imm)}`);
    case 'wrctl':
      return line(op, `${controlName(imm)}, ${r(a)}`);
    case 'wrprs':
      return line(op, `${r(c)}, ${r(a)}`);
    default:
      return line(op, `${r(c)}, ${r(a)}, ${r(b)}`);
  }
}

/** Disassembly of a word at `pc`, or null when it is not an instruction */
export function disassembleWord(word: number, pc: number): string | null {
  const d = decode(word);
  return d ? formatDecoded(d, pc) : null;
}
