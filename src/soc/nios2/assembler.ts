// Nios II instruction set for the generic SoC assembler (Aşama 6g): GNU as syntax, its pseudo-instructions (nop,
// mov, movi, movui, movhi, movia, subi, cmpgt*, cmple*, bgt*, ble*) and the relocation functions %lo, %hi and
// %hiadj. Branch, call and jmpi operands are target addresses (labels), as in GNU as and evo.
import type { AsmEncodeError, AsmInstruction, AsmOperand, IsaAssembler } from '../asm/isa';
import { disassembleWord } from './disasm';
import {
  CONTROL_NAMES,
  NOP_WORD,
  OP,
  OPX,
  REGISTER_NAMES,
  controlIndex,
  customIndex,
  encCustom,
  encI,
  encJ,
  encR,
  registerIndex,
} from './isa';

/** i18n namespace of the Nios II texts */
export const NIOS2_NAMESPACE = 'nios2';

const R3_OPS = [
  'add', 'sub', 'and', 'or', 'xor', 'nor', 'mul', 'mulxss', 'mulxuu', 'mulxsu', 'div', 'divu',
  'cmpeq', 'cmpne', 'cmpge', 'cmpgeu', 'cmplt', 'cmpltu', 'rol', 'ror', 'sll', 'srl', 'sra',
];
const SHIFT_IMM_OPS = ['roli', 'slli', 'srli', 'srai'];
const SIGNED_I_OPS = ['addi', 'muli', 'cmpeqi', 'cmpnei', 'cmpgei', 'cmplti'];
const UNSIGNED_I_OPS = ['andi', 'ori', 'xori', 'andhi', 'orhi', 'xorhi', 'cmpgeui', 'cmpltui'];
const MEM_OPS = [
  'ldb', 'ldbu', 'ldh', 'ldhu', 'ldw', 'ldbio', 'ldbuio', 'ldhio', 'ldhuio', 'ldwio',
  'stb', 'sth', 'stw', 'stbio', 'sthio', 'stwio',
];
const CACHE_I_OPS = ['flushd', 'flushda', 'initd', 'initda'];
const BRANCH_OPS = ['beq', 'bne', 'bge', 'bgeu', 'blt', 'bltu'];
const BASE_OPS = [
  ...R3_OPS, ...SHIFT_IMM_OPS, ...SIGNED_I_OPS, ...UNSIGNED_I_OPS, ...MEM_OPS, ...CACHE_I_OPS, ...BRANCH_OPS,
  'br', 'call', 'jmpi', 'callr', 'jmp', 'ret', 'nextpc', 'eret', 'bret', 'trap', 'break', 'rdctl', 'wrctl',
  'flushi', 'initi', 'flushp', 'sync', 'rdprs', 'wrprs', 'custom',
];
const PSEUDO_OPS = [
  'nop', 'mov', 'movi', 'movui', 'movhi', 'movia', 'subi',
  'cmpgt', 'cmpgtu', 'cmple', 'cmpleu', 'cmpgti', 'cmpgtui', 'cmplei', 'cmpleui',
  'bgt', 'bgtu', 'ble', 'bleu',
];

/** Operand formats shown in errors */
const FORMAT: Record<string, string> = {
  r3: 'rC, rA, rB', shift: 'rC, rA, imm5', i: 'rB, rA, imm16', mem: 'rB, offset(rA)', cache: 'offset(rA)',
  branch: 'rA, rB, target', target: 'target', ra: 'rA', rc: 'rC', none: '', imm5: '[imm5]',
  rdctl: 'rC, ctlN', wrctl: 'ctlN, rA', rdprs: 'rB, rA, imm16', wrprs: 'rC, rA',
  custom: 'N, rC|cC, rA|cA, rB|cB', mov: 'rC, rA', movi: 'rB, imm16', movia: 'rB, symbol',
};

type Result = { bytes: number[] } | { error: AsmEncodeError };

const err = (key: string, args?: Record<string, string | number>, operand?: number): Result => ({
  error: { ns: NIOS2_NAMESPACE, key: `asm.${key}`, ...(args ? { args } : {}), ...(operand !== undefined ? { operand } : {}) },
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
const nameOf = (o: AsmOperand) => (o as { name: string }).name;
const immOf = (o: AsmOperand) => (o as { value: number }).value;

const S16: [number, number] = [-32768, 32767];
// unsigned fields also take negative 16-bit values, so %lo (sign-extended, as addi needs it) fits ori as well
const U16: [number, number] = [-32768, 65535];

const hiadj = (v: number) => ((((v | 0) >>> 16) + (((v | 0) >>> 15) & 1)) & 0xffff);
const lo16 = (v: number) => ((v & 0xffff) << 16) >> 16;

class Checker {
  failure: Result | null = null;
  private fail(r: Result) {
    if (!this.failure) this.failure = r;
  }
  /** General-purpose register at operand k */
  gp(o: AsmOperand, k: number): number {
    const name = nameOf(o);
    const i = registerIndex(name);
    if (i < 0) this.fail(err(controlIndex(name) >= 0 ? 'controlNotAllowed' : 'customNotAllowed', { name }, k));
    return Math.max(i, 0);
  }
  range(v: number, [min, max]: [number, number], k: number): number {
    if (!Number.isFinite(v) || v < min || v > max) this.fail(err('range', { min, max }, k));
    return v;
  }
  /** Branch offset to `target` from the instruction after `pc` */
  branch(target: number, pc: number, k: number): number {
    const off = Number(BigInt.asIntN(32, BigInt(Math.trunc(target)) - BigInt(pc + 4)));
    if (!Number.isFinite(target) || target < -0x80000000 || target > 0xffffffff || off < -32768 || off > 32767) {
      this.fail(err('targetRange', { min: -32768, max: 32767 }, k));
    } else if ((off & 3) !== 0) this.fail(err('targetAlign', undefined, k));
    return off;
  }
  /** IMM26 of a call / jmpi to `target` (same 256 MB region as the instruction) */
  jump(target: number, pc: number, k: number): number {
    const t = Math.trunc(target);
    if (!Number.isFinite(target) || t < -0x80000000 || t > 0xffffffff) {
      this.fail(err('range', { min: 0, max: '0xffffffff' }, k));
      return 0;
    }
    const u = t >>> 0;
    if ((u & 3) !== 0) this.fail(err('targetAlign', undefined, k));
    else if ((u & 0xf0000000) !== ((pc >>> 0) & 0xf0000000)) this.fail(err('jumpRegion', undefined, k));
    return (u >>> 2) & 0x3ffffff;
  }
  /** Control register number at operand k (ctlN register or a name) */
  control(o: AsmOperand, k: number): number {
    if (o.kind === 'imm') return this.range(o.value, [0, 31], k);
    const i = o.kind === 'reg' ? controlIndex(o.name) : -1;
    if (i < 0) this.fail(err('expectedControl', undefined, k));
    return Math.max(i, 0);
  }
}

function encode(instr: AsmInstruction): Result {
  const { opcode: op, operands: o, address: pc } = instr;
  const c = new Checker();
  const done = (...ws: number[]): Result => c.failure ?? words(...ws);

  if (R3_OPS.includes(op)) {
    if (!shape(o, 'rrr')) return bad('r3');
    return done(encR(OPX[op], c.gp(o[1], 1), c.gp(o[2], 2), c.gp(o[0], 0)));
  }
  if (SHIFT_IMM_OPS.includes(op)) {
    if (!shape(o, 'rri')) return bad('shift');
    return done(encR(OPX[op], c.gp(o[1], 1), 0, c.gp(o[0], 0), c.range(immOf(o[2]), [0, 31], 2)));
  }
  if (SIGNED_I_OPS.includes(op) || UNSIGNED_I_OPS.includes(op)) {
    if (!shape(o, 'rri')) return bad('i');
    const r = SIGNED_I_OPS.includes(op) ? S16 : U16;
    return done(encI(OP[op], c.gp(o[1], 1), c.gp(o[0], 0), c.range(immOf(o[2]), r, 2)));
  }
  if (MEM_OPS.includes(op)) {
    if (!shape(o, 'rm')) return bad('mem');
    const m = o[1] as { offset: number; base: string };
    return done(encI(OP[op], c.gp({ kind: 'reg', name: m.base }, 1), c.gp(o[0], 0), c.range(m.offset, S16, 1)));
  }
  if (CACHE_I_OPS.includes(op)) {
    if (!shape(o, 'm')) return bad('cache');
    const m = o[0] as { offset: number; base: string };
    return done(encI(OP[op], c.gp({ kind: 'reg', name: m.base }, 0), 0, c.range(m.offset, S16, 0)));
  }
  if (BRANCH_OPS.includes(op)) {
    if (!shape(o, 'rri')) return bad('branch');
    return done(encI(OP[op], c.gp(o[0], 0), c.gp(o[1], 1), c.branch(immOf(o[2]), pc, 2)));
  }

  switch (op) {
    case 'br':
      if (!shape(o, 'i')) return bad('target');
      return done(encI(OP.br, 0, 0, c.branch(immOf(o[0]), pc, 0)));
    case 'call':
    case 'jmpi':
      if (!shape(o, 'i')) return bad('target');
      return done(encJ(OP[op], c.jump(immOf(o[0]), pc, 0)));
    case 'callr':
      return shape(o, 'r') ? done(encR(OPX.callr, c.gp(o[0], 0), 0, 31)) : bad('ra');
    case 'jmp':
    case 'flushi':
    case 'initi':
      if (!shape(o, 'r')) return bad('ra');
      // GNU as: "jmp r31" is an error (use ret)
      if (op === 'jmp' && registerIndex(nameOf(o[0])) === 31) return err('jmpRa', undefined, 0);
      return done(encR(OPX[op], c.gp(o[0], 0), 0, 0));
    case 'nextpc':
      return shape(o, 'r') ? done(encR(OPX.nextpc, 0, 0, c.gp(o[0], 0))) : bad('rc');
    case 'ret':
      return o.length ? bad('none') : words(encR(OPX.ret, 31, 0, 0));
    case 'eret':
      return o.length ? bad('none') : words(encR(OPX.eret, 29, 30, 0));
    case 'bret':
      return o.length ? bad('none') : words(encR(OPX.bret, 30, 0, 0));
    case 'flushp':
    case 'sync':
      return o.length ? bad('none') : words(encR(OPX[op], 0, 0, 0));
    case 'trap':
    case 'break': {
      if (o.length > 1 || (o.length === 1 && !shape(o, 'i'))) return bad('imm5');
      const imm = o.length ? c.range(immOf(o[0]), [0, 31], 0) : 0;
      return done(encR(OPX[op], 0, 0, op === 'trap' ? 29 : 30, imm));
    }
    case 'rdctl':
      if (o.length !== 2 || o[0].kind !== 'reg' || o[1].kind === 'mem') return bad('rdctl');
      return done(encR(OPX.rdctl, 0, 0, c.gp(o[0], 0), c.control(o[1], 1)));
    case 'wrctl':
      if (o.length !== 2 || o[1].kind !== 'reg' || o[0].kind === 'mem') return bad('wrctl');
      return done(encR(OPX.wrctl, c.gp(o[1], 1), 0, 0, c.control(o[0], 0)));
    case 'rdprs':
      if (!shape(o, 'rri')) return bad('rdprs');
      return done(encI(OP.rdprs, c.gp(o[1], 1), c.gp(o[0], 0), c.range(immOf(o[2]), S16, 2)));
    case 'wrprs':
      if (!shape(o, 'rr')) return bad('wrprs');
      return done(encR(OPX.wrprs, c.gp(o[1], 1), 0, c.gp(o[0], 0)));
    case 'custom': {
      if (!shape(o, 'irrr')) return bad('custom');
      const n = c.range(immOf(o[0]), [0, 255], 0);
      // each register operand is a general-purpose register (flag 1) or a custom register cN (flag 0)
      const sel = (k: number): [number, boolean] => {
        const name = nameOf(o[k]);
        const gp = registerIndex(name);
        if (gp >= 0) return [gp, true];
        const ci = customIndex(name);
        if (ci < 0) c.failure ??= err('controlNotAllowed', { name }, k);
        return [Math.max(ci, 0), false];
      };
      const [rc, writerc] = sel(1);
      const [ra, readra] = sel(2);
      const [rb, readrb] = sel(3);
      return done(encCustom(n, ra, rb, rc, readra, readrb, writerc));
    }

    // ---------- pseudo-instructions
    case 'nop':
      return o.length ? bad('none') : words(NOP_WORD);
    case 'mov':
      return shape(o, 'rr') ? done(encR(OPX.add, c.gp(o[1], 1), 0, c.gp(o[0], 0))) : bad('mov');
    case 'movi':
    case 'movui':
    case 'movhi': {
      if (!shape(o, 'ri')) return bad('movi');
      const base = { movi: OP.addi, movui: OP.ori, movhi: OP.orhi }[op];
      return done(encI(base, 0, c.gp(o[0], 0), c.range(immOf(o[1]), op === 'movi' ? S16 : U16, 1)));
    }
    case 'movia': {
      if (!shape(o, 'ri')) return bad('movia');
      const rb = c.gp(o[0], 0);
      const v = c.range(immOf(o[1]), [-0x80000000, 0xffffffff], 1) | 0;
      return done(encI(OP.orhi, 0, rb, hiadj(v)), encI(OP.addi, rb, rb, lo16(v)));
    }
    case 'subi':
      if (!shape(o, 'rri')) return bad('i');
      return done(encI(OP.addi, c.gp(o[1], 1), c.gp(o[0], 0), -c.range(immOf(o[2]), [-32767, 32768], 2)));
    case 'cmpgt':
    case 'cmpgtu':
    case 'cmple':
    case 'cmpleu': {
      if (!shape(o, 'rrr')) return bad('r3');
      const real = { cmpgt: 'cmplt', cmpgtu: 'cmpltu', cmple: 'cmpge', cmpleu: 'cmpgeu' }[op];
      return done(encR(OPX[real], c.gp(o[2], 2), c.gp(o[1], 1), c.gp(o[0], 0)));
    }
    case 'cmpgti':
    case 'cmpgtui':
    case 'cmplei':
    case 'cmpleui': {
      if (!shape(o, 'rri')) return bad('i');
      const real = { cmpgti: 'cmpgei', cmpgtui: 'cmpgeui', cmplei: 'cmplti', cmpleui: 'cmpltui' }[op];
      const r: [number, number] = op === 'cmpgti' || op === 'cmplei' ? [-32769, 32766] : [0, 65534];
      return done(encI(OP[real], c.gp(o[1], 1), c.gp(o[0], 0), c.range(immOf(o[2]), r, 2) + 1));
    }
    case 'bgt':
    case 'bgtu':
    case 'ble':
    case 'bleu': {
      if (!shape(o, 'rri')) return bad('branch');
      const real = { bgt: 'blt', bgtu: 'bltu', ble: 'bge', bleu: 'bgeu' }[op];
      return done(encI(OP[real], c.gp(o[1], 1), c.gp(o[0], 0), c.branch(immOf(o[2]), pc, 2)));
    }
    default:
      return err('unknown', { name: op });
  }
}

/** Operand position of the control register in rdctl / wrctl */
const CONTROL_OPERAND: ReadonlyMap<string, number> = new Map([['rdctl', 1], ['wrctl', 0]]);

export const nios2Assembler: IsaAssembler = {
  name: 'Nios II',
  opcodes: [...BASE_OPS, ...PSEUDO_OPS],
  registers: REGISTER_NAMES,
  brackets: 'round',
  littleEndian: true,
  // GNU as options that only change its warnings
  setOptions: ['noat', 'at', 'nobreak', 'break', 'norelax', 'relax'],
  nop: [NOP_WORD & 0xff, (NOP_WORD >>> 8) & 0xff, (NOP_WORD >>> 16) & 0xff, NOP_WORD >>> 24],
  instructionSize: (opcode) => (opcode === 'movia' ? 8 : 4),
  encode,
  functions: {
    lo: (v) => BigInt(lo16(Number(BigInt.asIntN(32, v)))),
    hi: (v) => (BigInt.asUintN(32, v) >> 16n) & 0xffffn,
    hiadj: (v) => BigInt(hiadj(Number(BigInt.asIntN(32, v)))),
  },
  namedOperand(opcode, name, index) {
    const at = CONTROL_OPERAND.get(opcode);
    if (at === undefined || index !== at) return undefined;
    return Object.prototype.hasOwnProperty.call(CONTROL_NAMES, name) ? CONTROL_NAMES[name] : undefined;
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
