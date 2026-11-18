// RV32IM instruction set for the generic SoC assembler (Aşama 6f): GNU as syntax, the standard pseudo-instructions
// of the RISC-V assembly manual (li, la, call, tail, bgt, csrr, ...) and the relocation functions %hi, %lo,
// %pcrel_hi and %pcrel_lo. Branch and jump operands are target addresses (labels), as in GNU as and evo.
import type { AsmEncodeError, AsmInstruction, AsmOperand, IsaAssembler } from '../asm/isa';
import { disassembleWord } from './disasm';
import {
  CSR_NAMES,
  FUNCT,
  OPC,
  REGISTER_NAMES,
  encB,
  encI,
  encJ,
  encR,
  encS,
  encU,
  fenceSetValue,
  registerIndex,
} from './isa';

/** i18n namespace of the RV32IM texts */
export const RV32IM_NAMESPACE = 'rv32im';

const BASE_OPS = [
  'lui', 'auipc', 'jal', 'jalr', 'beq', 'bne', 'blt', 'bge', 'bltu', 'bgeu',
  'lb', 'lh', 'lw', 'lbu', 'lhu', 'sb', 'sh', 'sw',
  'addi', 'slti', 'sltiu', 'xori', 'ori', 'andi', 'slli', 'srli', 'srai',
  'add', 'sub', 'sll', 'slt', 'sltu', 'xor', 'srl', 'sra', 'or', 'and',
  'mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu',
  'fence', 'fence.tso', 'ecall', 'ebreak', 'mret', 'wfi',
  'csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci',
];
const PSEUDO_OPS = [
  'nop', 'li', 'la', 'lla', 'mv', 'not', 'neg', 'seqz', 'snez', 'sltz', 'sgtz', 'zext.b',
  'beqz', 'bnez', 'blez', 'bgez', 'bltz', 'bgtz', 'bgt', 'ble', 'bgtu', 'bleu',
  'j', 'jr', 'ret', 'call', 'tail',
  'csrr', 'csrw', 'csrs', 'csrc', 'csrwi', 'csrsi', 'csrci',
  'rdcycle', 'rdtime', 'rdinstret', 'rdcycleh', 'rdtimeh', 'rdinstreth', 'unimp',
];
const TWO_WORD = new Set(['la', 'lla', 'call', 'tail']);

/** Operand formats shown in errors */
const FORMAT: Record<string, string> = {
  lui: 'rd, imm20', auipc: 'rd, imm20', jal: '[rd,] target', jalr: 'rs | rd, rs[, imm] | rd, imm(rs)',
  branch: 'rs1, rs2, target', load: 'rd, offset(rs1)', store: 'rs2, offset(rs1)',
  imm: 'rd, rs1, imm12', shift: 'rd, rs1, shamt', reg: 'rd, rs1, rs2', none: '',
  fence: '[pred, succ]', csr: 'rd, csr, rs1', csri: 'rd, csr, uimm5',
  li: 'rd, imm', la: 'rd, symbol', rr: 'rd, rs', bz: 'rs, target', j: 'target', jr: 'rs',
  call: '[rd,] symbol', tail: 'symbol', csrr: 'rd, csr', csrw: 'csr, rs | csr, uimm5', csrwi: 'csr, uimm5', rd: 'rd',
};

const signExt12 = (v: number) => ((v & 0xfff) << 20) >> 20;
const hi20 = (v: number) => (((v | 0) + 0x800) >>> 12) & 0xfffff;

type Result = { bytes: number[] } | { error: AsmEncodeError };

const err = (key: string, args?: Record<string, string | number>, operand?: number): Result => ({
  error: { ns: RV32IM_NAMESPACE, key: `asm.${key}`, ...(args ? { args } : {}), ...(operand !== undefined ? { operand } : {}) },
});
const bad = (format: string): Result => err('operands', { format: FORMAT[format] ?? format });

function words(...ws: number[]): Result {
  const bytes: number[] = [];
  for (const w of ws) bytes.push(w & 0xff, (w >>> 8) & 0xff, (w >>> 16) & 0xff, (w >>> 24) & 0xff);
  return { bytes };
}

/** Matches operand kinds: "r" register, "i" immediate, "m" memory (offset(base)) */
function shape(ops: AsmOperand[], pattern: string): boolean {
  if (ops.length !== pattern.length) return false;
  return ops.every((o, k) => o.kind === ({ r: 'reg', i: 'imm', m: 'mem' } as const)[pattern[k] as 'r' | 'i' | 'm']);
}
const reg = (o: AsmOperand) => registerIndex((o as { name: string }).name);
const immOf = (o: AsmOperand) => (o as { value: number }).value;

class Checker {
  failure: Result | null = null;
  /** Signed or unsigned value in [min, max] */
  range(v: number, min: number, max: number, operand: number): number {
    if (!this.failure && (!Number.isFinite(v) || v < min || v > max)) this.failure = err('range', { min, max }, operand);
    return v;
  }
  /** pc-relative offset to `target`: even, in [min, max] */
  offset(target: number, pc: number, min: number, max: number, operand: number): number {
    const off = Number(BigInt.asIntN(32, BigInt(Math.trunc(target)) - BigInt(pc)));
    if (!this.failure && (!Number.isFinite(target) || target < -0x80000000 || target > 0xffffffff || off < min || off > max)) {
      this.failure = err('targetRange', { min, max }, operand);
    } else if (!this.failure && off % 2 !== 0) this.failure = err('targetOdd', undefined, operand);
    return off;
  }
}

function encode(instr: AsmInstruction): Result {
  const { opcode: op, operands: o, address: pc } = instr;
  const c = new Checker();
  const done = (...ws: number[]): Result => c.failure ?? words(...ws);
  const f = FUNCT[op];

  switch (op) {
    // ---------- base instructions
    case 'lui':
    case 'auipc':
      if (!shape(o, 'ri')) return bad('lui');
      return done(encU(op === 'lui' ? OPC.LUI : OPC.AUIPC, reg(o[0]), c.range(immOf(o[1]), 0, 0xfffff, 1)));
    case 'jal':
      if (shape(o, 'i')) return done(encJ(OPC.JAL, 1, c.offset(immOf(o[0]), pc, -0x100000, 0xffffe, 0)));
      if (shape(o, 'ri')) return done(encJ(OPC.JAL, reg(o[0]), c.offset(immOf(o[1]), pc, -0x100000, 0xffffe, 1)));
      return bad('jal');
    case 'jalr':
      if (shape(o, 'r')) return done(encI(OPC.JALR, 1, 0, reg(o[0]), 0));
      if (shape(o, 'rr')) return done(encI(OPC.JALR, reg(o[0]), 0, reg(o[1]), 0));
      if (shape(o, 'rri')) return done(encI(OPC.JALR, reg(o[0]), 0, reg(o[1]), c.range(immOf(o[2]), -2048, 2047, 2)));
      if (shape(o, 'rm')) {
        const m = o[1] as { offset: number; base: string };
        return done(encI(OPC.JALR, reg(o[0]), 0, registerIndex(m.base), c.range(m.offset, -2048, 2047, 1)));
      }
      if (shape(o, 'm')) {
        const m = o[0] as { offset: number; base: string };
        return done(encI(OPC.JALR, 1, 0, registerIndex(m.base), c.range(m.offset, -2048, 2047, 0)));
      }
      return bad('jalr');
    case 'beq':
    case 'bne':
    case 'blt':
    case 'bge':
    case 'bltu':
    case 'bgeu':
      if (!shape(o, 'rri')) return bad('branch');
      return done(encB(OPC.BRANCH, f.f3, reg(o[0]), reg(o[1]), c.offset(immOf(o[2]), pc, -4096, 4094, 2)));
    case 'lb':
    case 'lh':
    case 'lw':
    case 'lbu':
    case 'lhu': {
      if (!shape(o, 'rm')) return bad('load');
      const m = o[1] as { offset: number; base: string };
      return done(encI(OPC.LOAD, reg(o[0]), f.f3, registerIndex(m.base), c.range(m.offset, -2048, 2047, 1)));
    }
    case 'sb':
    case 'sh':
    case 'sw': {
      if (!shape(o, 'rm')) return bad('store');
      const m = o[1] as { offset: number; base: string };
      return done(encS(OPC.STORE, f.f3, registerIndex(m.base), reg(o[0]), c.range(m.offset, -2048, 2047, 1)));
    }
    case 'addi':
    case 'slti':
    case 'sltiu':
    case 'xori':
    case 'ori':
    case 'andi':
      if (!shape(o, 'rri')) return bad('imm');
      return done(encI(OPC.OP_IMM, reg(o[0]), f.f3, reg(o[1]), c.range(immOf(o[2]), -2048, 2047, 2)));
    case 'slli':
    case 'srli':
    case 'srai':
      if (!shape(o, 'rri')) return bad('shift');
      return done(encI(OPC.OP_IMM, reg(o[0]), f.f3, reg(o[1]), (f.f7! << 5) | c.range(immOf(o[2]), 0, 31, 2)));
    case 'fence': {
      if (o.length === 0) return done(encI(OPC.MISC_MEM, 0, 0, 0, 0x0ff));
      if (!shape(o, 'ii')) return bad('fence');
      const pred = c.range(immOf(o[0]), 0, 15, 0);
      const succ = c.range(immOf(o[1]), 0, 15, 1);
      return done(encI(OPC.MISC_MEM, 0, 0, 0, (pred << 4) | succ));
    }
    case 'fence.tso':
      return o.length ? bad('none') : words(0x8330000f);
    case 'ecall':
      return o.length ? bad('none') : words(0x00000073);
    case 'ebreak':
      return o.length ? bad('none') : words(0x00100073);
    case 'mret':
      return o.length ? bad('none') : words(0x30200073);
    case 'wfi':
      return o.length ? bad('none') : words(0x10500073);
    case 'csrrw':
    case 'csrrs':
    case 'csrrc':
      if (!shape(o, 'rir')) return bad('csr');
      return done(encI(OPC.SYSTEM, reg(o[0]), f.f3, reg(o[2]), c.range(immOf(o[1]), 0, 0xfff, 1)));
    case 'csrrwi':
    case 'csrrsi':
    case 'csrrci':
      if (!shape(o, 'rii')) return bad('csri');
      return done(encI(OPC.SYSTEM, reg(o[0]), f.f3, c.range(immOf(o[2]), 0, 31, 2), c.range(immOf(o[1]), 0, 0xfff, 1)));

    // ---------- pseudo-instructions
    case 'nop':
      return o.length ? bad('none') : words(encI(OPC.OP_IMM, 0, 0, 0, 0));
    case 'li': {
      if (!shape(o, 'ri')) return bad('li');
      const v = c.range(immOf(o[1]), -0x80000000, 0xffffffff, 1) | 0;
      const rd = reg(o[0]);
      if (instr.size === 4) {
        if (v >= -2048 && v <= 2047) return done(encI(OPC.OP_IMM, rd, 0, 0, v));
        // the layout gave one word for a value that changed later (a .set redefinition): two words are needed
        if ((v & 0xfff) !== 0) return err('liGrew', { value: `0x${(v >>> 0).toString(16)}` }, 1);
        return done(encU(OPC.LUI, rd, v >>> 12));
      }
      return done(encU(OPC.LUI, rd, hi20(v)), encI(OPC.OP_IMM, rd, 0, rd, signExt12(v)));
    }
    case 'la':
    case 'lla': {
      if (!shape(o, 'ri')) return bad('la');
      const rd = reg(o[0]);
      const off = Number(BigInt.asIntN(32, BigInt(Math.trunc(immOf(o[1]))) - BigInt(pc)));
      c.range(immOf(o[1]), -0x80000000, 0xffffffff, 1);
      return done(encU(OPC.AUIPC, rd, hi20(off)), encI(OPC.OP_IMM, rd, 0, rd, signExt12(off)));
    }
    case 'call':
    case 'tail': {
      let rd: number;
      let t: number;
      if (shape(o, 'i')) {
        rd = op === 'call' ? 1 : 0;
        t = immOf(o[0]);
      } else if (op === 'call' && shape(o, 'ri')) {
        rd = reg(o[0]);
        t = immOf(o[1]);
      } else return bad(op);
      c.range(t, -0x80000000, 0xffffffff, o.length - 1);
      const off = Number(BigInt.asIntN(32, BigInt(Math.trunc(t)) - BigInt(pc)));
      // GNU as: call uses the link register itself, tail uses t1 for the address
      const tmp = op === 'call' ? rd : 6;
      return done(encU(OPC.AUIPC, tmp, hi20(off)), encI(OPC.JALR, rd, 0, tmp, signExt12(off)));
    }
    case 'mv':
      return shape(o, 'rr') ? done(encI(OPC.OP_IMM, reg(o[0]), 0, reg(o[1]), 0)) : bad('rr');
    case 'not':
      return shape(o, 'rr') ? done(encI(OPC.OP_IMM, reg(o[0]), 4, reg(o[1]), -1)) : bad('rr');
    case 'zext.b':
      return shape(o, 'rr') ? done(encI(OPC.OP_IMM, reg(o[0]), 7, reg(o[1]), 255)) : bad('rr');
    case 'seqz':
      return shape(o, 'rr') ? done(encI(OPC.OP_IMM, reg(o[0]), 3, reg(o[1]), 1)) : bad('rr');
    case 'neg':
      return shape(o, 'rr') ? done(encR(OPC.OP, reg(o[0]), 0, 0, reg(o[1]), 0x20)) : bad('rr');
    case 'snez':
      return shape(o, 'rr') ? done(encR(OPC.OP, reg(o[0]), 3, 0, reg(o[1]), 0)) : bad('rr');
    case 'sltz':
      return shape(o, 'rr') ? done(encR(OPC.OP, reg(o[0]), 2, reg(o[1]), 0, 0)) : bad('rr');
    case 'sgtz':
      return shape(o, 'rr') ? done(encR(OPC.OP, reg(o[0]), 2, 0, reg(o[1]), 0)) : bad('rr');
    case 'beqz':
    case 'bnez':
    case 'bltz':
    case 'bgez':
    case 'blez':
    case 'bgtz': {
      if (!shape(o, 'ri')) return bad('bz');
      const rs = reg(o[0]);
      const off = c.offset(immOf(o[1]), pc, -4096, 4094, 1);
      const [f3, rs1, rs2] = {
        beqz: [0, rs, 0], bnez: [1, rs, 0], bltz: [4, rs, 0], bgez: [5, rs, 0], blez: [5, 0, rs], bgtz: [4, 0, rs],
      }[op];
      return done(encB(OPC.BRANCH, f3, rs1, rs2, off));
    }
    case 'bgt':
    case 'ble':
    case 'bgtu':
    case 'bleu': {
      if (!shape(o, 'rri')) return bad('branch');
      const f3 = { bgt: 4, ble: 5, bgtu: 6, bleu: 7 }[op];
      return done(encB(OPC.BRANCH, f3, reg(o[1]), reg(o[0]), c.offset(immOf(o[2]), pc, -4096, 4094, 2)));
    }
    case 'j':
      return shape(o, 'i') ? done(encJ(OPC.JAL, 0, c.offset(immOf(o[0]), pc, -0x100000, 0xffffe, 0))) : bad('j');
    case 'jr':
      if (shape(o, 'r')) return done(encI(OPC.JALR, 0, 0, reg(o[0]), 0));
      if (shape(o, 'm')) {
        const m = o[0] as { offset: number; base: string };
        return done(encI(OPC.JALR, 0, 0, registerIndex(m.base), c.range(m.offset, -2048, 2047, 0)));
      }
      return bad('jr');
    case 'ret':
      return o.length ? bad('none') : words(encI(OPC.JALR, 0, 0, 1, 0));
    case 'csrr':
      return shape(o, 'ri') ? done(encI(OPC.SYSTEM, reg(o[0]), 2, 0, c.range(immOf(o[1]), 0, 0xfff, 1))) : bad('csrr');
    case 'csrw':
    case 'csrs':
    case 'csrc': {
      const f3 = { csrw: 1, csrs: 2, csrc: 3 }[op];
      if (shape(o, 'ir')) return done(encI(OPC.SYSTEM, 0, f3, reg(o[1]), c.range(immOf(o[0]), 0, 0xfff, 0)));
      // GNU as turns an immediate source into the csr*i form
      if (shape(o, 'ii')) return done(encI(OPC.SYSTEM, 0, f3 + 4, c.range(immOf(o[1]), 0, 31, 1), c.range(immOf(o[0]), 0, 0xfff, 0)));
      return bad('csrw');
    }
    case 'csrwi':
    case 'csrsi':
    case 'csrci': {
      const f3 = { csrwi: 5, csrsi: 6, csrci: 7 }[op];
      if (!shape(o, 'ii')) return bad('csrwi');
      return done(encI(OPC.SYSTEM, 0, f3, c.range(immOf(o[1]), 0, 31, 1), c.range(immOf(o[0]), 0, 0xfff, 0)));
    }
    case 'rdcycle':
    case 'rdtime':
    case 'rdinstret':
    case 'rdcycleh':
    case 'rdtimeh':
    case 'rdinstreth': {
      const csr = { rdcycle: 0xc00, rdtime: 0xc01, rdinstret: 0xc02, rdcycleh: 0xc80, rdtimeh: 0xc81, rdinstreth: 0xc82 }[op];
      return shape(o, 'r') ? done(encI(OPC.SYSTEM, reg(o[0]), 2, 0, csr)) : bad('rd');
    }
    case 'unimp':
      return o.length ? bad('none') : words(0xc0001073);
    default: {
      // register-register ops and the M extension
      if (f && f.opcode === OPC.OP) {
        if (!shape(o, 'rrr')) return bad('reg');
        return done(encR(OPC.OP, reg(o[0]), f.f3, reg(o[1]), reg(o[2]), f.f7!));
      }
      return err('unknown', { name: op });
    }
  }
}

/** Whether a 32-bit value fits "li" in one word (addi or lui) */
function liFitsOneWord(v: bigint): boolean {
  if (v < -0x80000000n || v > 0xffffffffn) return true; // an error either way; keep the layout small
  const s = Number(BigInt.asIntN(32, v));
  return (s >= -2048 && s <= 2047) || (s & 0xfff) === 0;
}

/** Operand position of the CSR in each CSR opcode (the other operands are registers or plain values) */
const CSR_OPERAND: ReadonlyMap<string, number> = new Map([
  ...['csrrw', 'csrrs', 'csrrc', 'csrrwi', 'csrrsi', 'csrrci', 'csrr'].map((op): [string, number] => [op, 1]),
  ...['csrw', 'csrs', 'csrc', 'csrwi', 'csrsi', 'csrci'].map((op): [string, number] => [op, 0]),
]);

export const rv32imAssembler: IsaAssembler = {
  name: 'RV32IM',
  opcodes: [...BASE_OPS, ...PSEUDO_OPS],
  registers: REGISTER_NAMES,
  brackets: 'round',
  littleEndian: true,
  nop: [0x13, 0, 0, 0],
  instructionSize(opcode, constant) {
    if (TWO_WORD.has(opcode)) return 8;
    if (opcode === 'li') {
      const v = constant?.(1);
      return v !== undefined && liFitsOneWord(v) ? 4 : 8;
    }
    return 4;
  },
  encode,
  functions: {
    hi: (v) => BigInt(hi20(Number(BigInt.asIntN(32, v)))),
    lo: (v) => BigInt(signExt12(Number(BigInt.asIntN(32, v)))),
    pcrel_hi: (v, ctx) => {
      const rel = BigInt.asIntN(32, v - ctx.here);
      ctx.memo.set(`pcrel:${BigInt.asUintN(32, ctx.here)}`, rel);
      return BigInt(hi20(Number(rel)));
    },
    pcrel_lo: (v, ctx) => {
      const rel = ctx.memo.get(`pcrel:${BigInt.asUintN(32, v)}`);
      return rel === undefined ? null : BigInt(signExt12(Number(rel)));
    },
  },
  namedOperand(opcode, name, index) {
    const csrAt = CSR_OPERAND.get(opcode);
    if (csrAt !== undefined) return index === csrAt && Object.prototype.hasOwnProperty.call(CSR_NAMES, name) ? CSR_NAMES[name] : undefined;
    if (opcode === 'fence') return fenceSetValue(name);
    return undefined;
  },
  disassemble(readByte, address) {
    const b: number[] = [];
    for (let k = 0; k < 4; k++) {
      const v = readByte((address + k) >>> 0);
      if (v === undefined) return null;
      b.push(v);
    }
    const word = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
    const text = disassembleWord(word, address);
    return text === null ? null : { text, size: 4 };
  },
};
