// Nios II (R1) instruction formats, decoder and register names (Aşama 6g). Follows the Nios II Processor Reference
// (classic R1 encoding, the instruction set of a Nios II/s or /f core without MMU, MPU, EIC or shadow register
// sets). Logisim-evolution's Nios2 covers about the same set; where it differs from the reference (custom
// instruction register bits, call/jmpi target, reserved fields) the reference decides.

/** Register names as GNU objdump shows them (r30 is "sstatus", alias "ba") */
export const ABI_NAMES = [
  'zero', 'at', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15',
  'r16', 'r17', 'r18', 'r19', 'r20', 'r21', 'r22', 'r23', 'et', 'bt', 'gp', 'sp', 'fp', 'ea', 'sstatus', 'ra',
] as const;

const ALIASES: Readonly<Record<string, number>> = {
  zero: 0, at: 1, et: 24, bt: 25, gp: 26, sp: 27, fp: 28, ea: 29, ba: 30, sstatus: 30, ra: 31,
};

/** Control register names (GNU as / the Processor Reference), by number */
export const CONTROL_NAMES: Readonly<Record<string, number>> = {
  status: 0, estatus: 1, bstatus: 2, ienable: 3, ipending: 4, cpuid: 5, exception: 7,
  pteaddr: 8, tlbacc: 9, tlbmisc: 10, eccinj: 11, badaddr: 12, config: 13, mpubase: 14, mpuacc: 15,
};
const CONTROL_BY_NUMBER = new Map(Object.entries(CONTROL_NAMES).map(([n, v]) => [v, n]));

/** Name of a control register number ("ctl6" for unnamed ones) */
export function controlName(n: number): string {
  return CONTROL_BY_NUMBER.get(n) ?? `ctl${n}`;
}

const nums = (prefix: string) => Array.from({ length: 32 }, (_, i) => `${prefix}${i}`);

/** Every general-purpose register name the assembler accepts: r0..r31 and the aliases */
export const GP_REGISTER_NAMES: readonly string[] = [...nums('r'), ...Object.keys(ALIASES)];
/** Control registers as register operands: ctl0..ctl31 (the named ones go through namedOperand) */
export const CONTROL_REGISTER_NAMES: readonly string[] = nums('ctl');
/** Custom-instruction internal registers c0..c31 */
export const CUSTOM_REGISTER_NAMES: readonly string[] = nums('c');
export const REGISTER_NAMES: readonly string[] = [...GP_REGISTER_NAMES, ...CONTROL_REGISTER_NAMES, ...CUSTOM_REGISTER_NAMES];

function numbered(name: string, prefix: string): number {
  if (!name.startsWith(prefix)) return -1;
  const d = name.slice(prefix.length);
  if (!/^[0-9]{1,2}$/.test(d) || (d.length === 2 && d[0] === '0')) return -1;
  const i = Number(d);
  return i < 32 ? i : -1;
}

/** Number of a general-purpose register name (r5, sp, ba), or -1 */
export function registerIndex(name: string): number {
  const n = name.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ALIASES, n)) return ALIASES[n];
  return numbered(n, 'r');
}

/** Number of a control register written ctlN, or -1 */
export function controlIndex(name: string): number {
  return numbered(name.toLowerCase(), 'ctl');
}

/** Number of a custom register written cN, or -1 */
export function customIndex(name: string): number {
  return numbered(name.toLowerCase(), 'c');
}

/** I- and J-type opcodes (bits 5:0); 0x3a selects the R-type table */
export const OP: Readonly<Record<string, number>> = {
  call: 0x00, jmpi: 0x01, ldbu: 0x03, addi: 0x04, stb: 0x05, br: 0x06, ldb: 0x07, cmpgei: 0x08,
  ldhu: 0x0b, andi: 0x0c, sth: 0x0d, bge: 0x0e, ldh: 0x0f, cmplti: 0x10, initda: 0x13, ori: 0x14,
  stw: 0x15, blt: 0x16, ldw: 0x17, cmpnei: 0x18, flushda: 0x1b, xori: 0x1c, bne: 0x1e, cmpeqi: 0x20,
  ldbuio: 0x23, muli: 0x24, stbio: 0x25, beq: 0x26, ldbio: 0x27, cmpgeui: 0x28, ldhuio: 0x2b, andhi: 0x2c,
  sthio: 0x2d, bgeu: 0x2e, ldhio: 0x2f, cmpltui: 0x30, custom: 0x32, initd: 0x33, orhi: 0x34, stwio: 0x35,
  bltu: 0x36, ldwio: 0x37, rdprs: 0x38, flushd: 0x3b, xorhi: 0x3c,
};
export const R_TYPE = 0x3a;

/** R-type extended opcodes (bits 16:11) */
export const OPX: Readonly<Record<string, number>> = {
  eret: 0x01, roli: 0x02, rol: 0x03, flushp: 0x04, ret: 0x05, nor: 0x06, mulxuu: 0x07, cmpge: 0x08,
  bret: 0x09, ror: 0x0b, flushi: 0x0c, jmp: 0x0d, and: 0x0e, cmplt: 0x10, slli: 0x12, sll: 0x13,
  wrprs: 0x14, or: 0x16, mulxsu: 0x17, cmpne: 0x18, srli: 0x1a, srl: 0x1b, nextpc: 0x1c, callr: 0x1d,
  xor: 0x1e, mulxss: 0x1f, cmpeq: 0x20, divu: 0x24, div: 0x25, rdctl: 0x26, mul: 0x27, cmpgeu: 0x28,
  initi: 0x29, trap: 0x2d, wrctl: 0x2e, cmpltu: 0x30, add: 0x31, break: 0x34, sync: 0x36, sub: 0x39,
  srai: 0x3a, sra: 0x3b,
};

const OP_NAME = new Map(Object.entries(OP).map(([n, v]) => [v, n]));
const OPX_NAME = new Map(Object.entries(OPX).map(([n, v]) => [v, n]));

export type Format = 'I' | 'J' | 'R' | 'custom';

/** How the I-type 16-bit immediate is extended */
const ZERO_EXT_IMM = new Set(['andi', 'ori', 'xori', 'cmpgeui', 'cmpltui']);
const HIGH_IMM = new Set(['andhi', 'orhi', 'xorhi']);

/** R-type operand fields an instruction uses: a, b, c registers and the 5-bit immediate; fixed = required values */
interface RShape {
  a?: boolean;
  b?: boolean;
  c?: boolean;
  imm5?: boolean;
  fixed?: { a?: number; b?: number; c?: number | number[] };
}
const R3: RShape = { a: true, b: true, c: true };
const R_SHAPES: Readonly<Record<string, RShape>> = {
  // bret: the reference shows C = 30, GNU as encodes C = 0; both decode
  eret: { fixed: { a: 29, b: 30 } }, bret: { fixed: { a: 30, c: [0, 30] } }, ret: { fixed: { a: 31 } },
  roli: { a: true, c: true, imm5: true }, slli: { a: true, c: true, imm5: true }, srli: { a: true, c: true, imm5: true },
  srai: { a: true, c: true, imm5: true },
  flushp: {}, sync: {}, flushi: { a: true }, initi: { a: true }, jmp: { a: true },
  callr: { a: true, fixed: { c: 31 } }, nextpc: { c: true },
  trap: { imm5: true, fixed: { c: 29 } }, break: { imm5: true, fixed: { c: 30 } },
  rdctl: { c: true, imm5: true }, wrctl: { a: true, imm5: true },
  wrprs: { a: true, c: true },
};

export interface Decoded {
  op: string;
  format: Format;
  /** Register fields A, B, C (0 when unused) */
  a: number;
  b: number;
  c: number;
  /** I-type: the immediate extended as the instruction uses it (sign, zero or <<16); J-type: IMM26; R-type: IMM5 */
  imm: number;
  /** custom: N and the register-file selects (1 = the general-purpose register, 0 = the custom register) */
  n?: number;
  readra?: boolean;
  readrb?: boolean;
  writerc?: boolean;
}

/** Decodes a 32-bit word; null when it is not a valid R1 instruction (unused R-type fields must be zero) */
export function decode(word: number): Decoded | null {
  const w = word >>> 0;
  const opc = w & 0x3f;
  const a = (w >>> 27) & 0x1f;
  const b = (w >>> 22) & 0x1f;
  if (opc === R_TYPE) {
    const opx = (w >>> 11) & 0x3f;
    const op = OPX_NAME.get(opx);
    if (!op) return null;
    const c = (w >>> 17) & 0x1f;
    const imm5 = (w >>> 6) & 0x1f;
    const s = R_SHAPES[op] ?? R3;
    const want = (used: boolean | undefined, fixed: number | number[] | undefined, v: number) =>
      fixed !== undefined ? (Array.isArray(fixed) ? fixed.includes(v) : v === fixed) : used ? true : v === 0;
    if (!want(s.a, s.fixed?.a, a) || !want(s.b, s.fixed?.b, b) || !want(s.c, s.fixed?.c, c) || (!s.imm5 && imm5 !== 0)) return null;
    return { op, format: 'R', a, b, c, imm: imm5 };
  }
  if (opc === OP.custom) {
    const opx = (w >>> 6) & 0x7ff;
    return {
      op: 'custom', format: 'custom', a, b, c: (w >>> 17) & 0x1f, imm: 0,
      n: opx & 0xff, writerc: ((opx >> 8) & 1) === 1, readrb: ((opx >> 9) & 1) === 1, readra: ((opx >> 10) & 1) === 1,
    };
  }
  const op = OP_NAME.get(opc);
  if (!op) return null;
  if (op === 'call' || op === 'jmpi') return { op, format: 'J', a: 0, b: 0, c: 0, imm: (w >>> 6) & 0x3ffffff };
  const raw = (w >>> 6) & 0xffff;
  const imm = HIGH_IMM.has(op) ? (raw << 16) | 0 : ZERO_EXT_IMM.has(op) ? raw : (raw << 16) >> 16;
  // br has no registers; the reference requires A = B = 0, as GNU as encodes it
  if (op === 'br' && (a !== 0 || b !== 0)) return null;
  // the cache-line instructions take an address operand only
  if ((op === 'flushd' || op === 'flushda' || op === 'initd' || op === 'initda') && b !== 0) return null;
  return { op, format: 'I', a, b, c: 0, imm };
}

/** I-type word */
export function encI(op: number, a: number, b: number, imm16: number): number {
  return (((a & 0x1f) << 27) | ((b & 0x1f) << 22) | ((imm16 & 0xffff) << 6) | (op & 0x3f)) >>> 0;
}

/** R-type word */
export function encR(opx: number, a: number, b: number, c: number, imm5 = 0): number {
  return (((a & 0x1f) << 27) | ((b & 0x1f) << 22) | ((c & 0x1f) << 17) | ((opx & 0x3f) << 11) | ((imm5 & 0x1f) << 6) | R_TYPE) >>> 0;
}

/** J-type word */
export function encJ(op: number, imm26: number): number {
  return (((imm26 & 0x3ffffff) << 6) | (op & 0x3f)) >>> 0;
}

/** custom instruction word; the read/write flags are 1 for a general-purpose register */
export function encCustom(n: number, a: number, b: number, c: number, readra: boolean, readrb: boolean, writerc: boolean): number {
  const opx = (n & 0xff) | (writerc ? 1 << 8 : 0) | (readrb ? 1 << 9 : 0) | (readra ? 1 << 10 : 0);
  return (((a & 0x1f) << 27) | ((b & 0x1f) << 22) | ((c & 0x1f) << 17) | (opx << 6) | OP.custom) >>> 0;
}

/** Encoding of "nop" (add zero, zero, zero) */
export const NOP_WORD = encR(OPX.add, 0, 0, 0);
