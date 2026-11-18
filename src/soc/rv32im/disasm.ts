// RV32IM disassembler (Aşama 6f): GNU objdump style with ABI register names and the standard aliases (li, mv,
// ret, j, beqz, csrr, ...). Branch and jump targets are absolute addresses, so every line assembles back to the
// same word at the same address.
import { ABI_NAMES, csrName, decode, fenceSetText, type Decoded } from './isa';

const r = (i: number) => ABI_NAMES[i];
const hex = (n: number) => '0x' + (n >>> 0).toString(16);
const target = (pc: number, imm: number) => '0x' + ((pc + imm) >>> 0).toString(16).padStart(8, '0');

function line(mnemonic: string, operands = ''): string {
  return operands ? `${mnemonic.padEnd(7)} ${operands}` : mnemonic;
}

/** Text of a decoded instruction at `pc` */
export function formatDecoded(d: Decoded, pc: number): string {
  const { op, rd, rs1, rs2, imm } = d;
  switch (op) {
    case 'lui':
    case 'auipc':
      return line(op, `${r(rd)}, ${hex(imm >>> 12)}`);
    case 'jal':
      if (rd === 0) return line('j', target(pc, imm));
      if (rd === 1) return line('jal', target(pc, imm));
      return line('jal', `${r(rd)}, ${target(pc, imm)}`);
    case 'jalr':
      if (rd === 0 && rs1 === 1 && imm === 0) return 'ret';
      if (rd === 0 && imm === 0) return line('jr', r(rs1));
      if (rd === 1 && imm === 0) return line('jalr', r(rs1));
      return line('jalr', `${r(rd)}, ${imm}(${r(rs1)})`);
    case 'beq':
    case 'bne':
    case 'blt':
    case 'bge':
    case 'bltu':
    case 'bgeu': {
      const t = target(pc, imm);
      if (rs2 === 0 && (op === 'beq' || op === 'bne' || op === 'blt' || op === 'bge')) {
        const alias = { beq: 'beqz', bne: 'bnez', blt: 'bltz', bge: 'bgez' }[op];
        return line(alias, `${r(rs1)}, ${t}`);
      }
      if (rs1 === 0 && (op === 'blt' || op === 'bge')) return line(op === 'blt' ? 'bgtz' : 'blez', `${r(rs2)}, ${t}`);
      return line(op, `${r(rs1)}, ${r(rs2)}, ${t}`);
    }
    case 'lb':
    case 'lh':
    case 'lw':
    case 'lbu':
    case 'lhu':
      return line(op, `${r(rd)}, ${imm}(${r(rs1)})`);
    case 'sb':
    case 'sh':
    case 'sw':
      return line(op, `${r(rs2)}, ${imm}(${r(rs1)})`);
    case 'addi':
      if (rd === 0 && rs1 === 0 && imm === 0) return 'nop';
      if (rs1 === 0) return line('li', `${r(rd)}, ${imm}`);
      if (imm === 0) return line('mv', `${r(rd)}, ${r(rs1)}`);
      return line(op, `${r(rd)}, ${r(rs1)}, ${imm}`);
    case 'xori':
      if (imm === -1) return line('not', `${r(rd)}, ${r(rs1)}`);
      return line(op, `${r(rd)}, ${r(rs1)}, ${imm}`);
    case 'sltiu':
      if (imm === 1) return line('seqz', `${r(rd)}, ${r(rs1)}`);
      return line(op, `${r(rd)}, ${r(rs1)}, ${imm}`);
    case 'slti':
    case 'ori':
    case 'andi':
    case 'slli':
    case 'srli':
    case 'srai':
      return line(op, `${r(rd)}, ${r(rs1)}, ${imm}`);
    case 'sub':
      if (rs1 === 0) return line('neg', `${r(rd)}, ${r(rs2)}`);
      return line(op, `${r(rd)}, ${r(rs1)}, ${r(rs2)}`);
    case 'sltu':
      if (rs1 === 0) return line('snez', `${r(rd)}, ${r(rs2)}`);
      return line(op, `${r(rd)}, ${r(rs1)}, ${r(rs2)}`);
    case 'slt':
      if (rs2 === 0) return line('sltz', `${r(rd)}, ${r(rs1)}`);
      if (rs1 === 0) return line('sgtz', `${r(rd)}, ${r(rs2)}`);
      return line(op, `${r(rd)}, ${r(rs1)}, ${r(rs2)}`);
    case 'fence':
      if (d.pred === 0xf && d.succ === 0xf) return 'fence';
      return line('fence', `${fenceSetText(d.pred)}, ${fenceSetText(d.succ)}`);
    case 'fence.tso':
    case 'ecall':
    case 'ebreak':
    case 'mret':
    case 'wfi':
      return op;
    case 'csrrw':
    case 'csrrs':
    case 'csrrc': {
      const c = csrName(d.csr);
      if (op === 'csrrw' && rd === 0 && rs1 === 0 && d.csr === 0xc00) return 'unimp';
      if (op === 'csrrs' && rs1 === 0) {
        const rdAlias: Record<number, string> = { 0xc00: 'rdcycle', 0xc01: 'rdtime', 0xc02: 'rdinstret', 0xc80: 'rdcycleh', 0xc81: 'rdtimeh', 0xc82: 'rdinstreth' };
        if (rdAlias[d.csr]) return line(rdAlias[d.csr], r(rd));
        return line('csrr', `${r(rd)}, ${c}`);
      }
      if (rd === 0) return line(op === 'csrrw' ? 'csrw' : op === 'csrrs' ? 'csrs' : 'csrc', `${c}, ${r(rs1)}`);
      return line(op, `${r(rd)}, ${c}, ${r(rs1)}`);
    }
    case 'csrrwi':
    case 'csrrsi':
    case 'csrrci': {
      const c = csrName(d.csr);
      if (rd === 0) return line(op === 'csrrwi' ? 'csrwi' : op === 'csrrsi' ? 'csrsi' : 'csrci', `${c}, ${imm}`);
      return line(op, `${r(rd)}, ${c}, ${imm}`);
    }
    default:
      // add, sll, xor, srl, sra, or, and, M extension
      return line(op, `${r(rd)}, ${r(rs1)}, ${r(rs2)}`);
  }
}

/** Text of the instruction word at `pc`, or null when it is not a valid RV32IM instruction */
export function disassembleWord(word: number, pc: number): string | null {
  const d = decode(word);
  if (!d) return null;
  // a FENCE with hint bits (fm other than TSO, rd, rs1) runs as a plain fence but has no assembler form:
  // the listing shows the word itself, so the line still assembles back to it
  if (d.op === 'fence' && (word >>> 0) !== ((((d.pred ?? 0) << 24) | ((d.succ ?? 0) << 20) | 0x0f) >>> 0)) {
    return `.word 0x${(word >>> 0).toString(16).padStart(8, '0')}`;
  }
  return formatDecoded(d, pc);
}
