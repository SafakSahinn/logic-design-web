// RV32IM instruction formats, decoder and register/CSR names (Aşama 6f). Follows the RISC-V unprivileged spec
// (RV32I + M + Zicsr, FENCE) and the machine-mode part of the privileged spec (MRET, WFI). Logisim-evolution's
// Rv32im covers the same set; where it is incomplete (all valid encodings, reserved fields) the spec decides.

/** ABI register names, as evo and objdump show them */
export const ABI_NAMES = [
  'zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6',
] as const;

/** Every register name the assembler accepts: x0..x31, the ABI names and "fp" (= s0) */
export const REGISTER_NAMES: readonly string[] = [
  ...Array.from({ length: 32 }, (_, i) => `x${i}`),
  ...ABI_NAMES,
  'fp',
];

/** Register number of a name (x5, t0, fp), or -1 */
export function registerIndex(name: string): number {
  const n = name.toLowerCase();
  if (n === 'fp') return 8;
  const abi = (ABI_NAMES as readonly string[]).indexOf(n);
  if (abi >= 0) return abi;
  const m = /^x([0-9]{1,2})$/.exec(n);
  if (m && !(m[1].length === 2 && m[1][0] === '0')) {
    const i = Number(m[1]);
    if (i < 32) return i;
  }
  return -1;
}

/** Standard CSR names (RISC-V privileged spec) the assembler and disassembler know; not all are implemented */
export const CSR_NAMES: Readonly<Record<string, number>> = {
  cycle: 0xc00, time: 0xc01, instret: 0xc02, cycleh: 0xc80, timeh: 0xc81, instreth: 0xc82,
  mvendorid: 0xf11, marchid: 0xf12, mimpid: 0xf13, mhartid: 0xf14, mconfigptr: 0xf15,
  mstatus: 0x300, misa: 0x301, medeleg: 0x302, mideleg: 0x303, mie: 0x304, mtvec: 0x305, mcounteren: 0x306,
  mstatush: 0x310, mcountinhibit: 0x320, mscratch: 0x340, mepc: 0x341, mcause: 0x342, mtval: 0x343, mip: 0x344,
  mcycle: 0xb00, minstret: 0xb02, mcycleh: 0xb80, minstreth: 0xb82,
  tselect: 0x7a0, tdata1: 0x7a1, tdata2: 0x7a2, tdata3: 0x7a3, tinfo: 0x7a4,
  dcsr: 0x7b0, dpc: 0x7b1, dscratch0: 0x7b2, dscratch1: 0x7b3,
};

const CSR_BY_NUMBER = new Map(Object.entries(CSR_NAMES).map(([n, v]) => [v, n]));

/** Name of a CSR number, or its number in hex */
export function csrName(csr: number): string {
  return CSR_BY_NUMBER.get(csr) ?? '0x' + csr.toString(16);
}

/** Major opcodes */
export const OPC = {
  LOAD: 0x03,
  MISC_MEM: 0x0f,
  OP_IMM: 0x13,
  AUIPC: 0x17,
  STORE: 0x23,
  OP: 0x33,
  LUI: 0x37,
  BRANCH: 0x63,
  JALR: 0x67,
  JAL: 0x6f,
  SYSTEM: 0x73,
} as const;

export type Op =
  | 'lui' | 'auipc' | 'jal' | 'jalr'
  | 'beq' | 'bne' | 'blt' | 'bge' | 'bltu' | 'bgeu'
  | 'lb' | 'lh' | 'lw' | 'lbu' | 'lhu' | 'sb' | 'sh' | 'sw'
  | 'addi' | 'slti' | 'sltiu' | 'xori' | 'ori' | 'andi' | 'slli' | 'srli' | 'srai'
  | 'add' | 'sub' | 'sll' | 'slt' | 'sltu' | 'xor' | 'srl' | 'sra' | 'or' | 'and'
  | 'mul' | 'mulh' | 'mulhsu' | 'mulhu' | 'div' | 'divu' | 'rem' | 'remu'
  | 'fence' | 'fence.tso' | 'ecall' | 'ebreak' | 'mret' | 'wfi'
  | 'csrrw' | 'csrrs' | 'csrrc' | 'csrrwi' | 'csrrsi' | 'csrrci';

export interface Decoded {
  op: Op;
  rd: number;
  rs1: number;
  rs2: number;
  /** Sign-extended immediate (I/S/B/U/J; U is the value already shifted left by 12); shamt for shifts; zimm for csr*i */
  imm: number;
  /** CSR number (csr* only) */
  csr: number;
  /** FENCE predecessor / successor sets (bits i=8 o=4 r=2 w=1) */
  pred: number;
  succ: number;
}

const BRANCH_OPS: (Op | null)[] = ['beq', 'bne', null, null, 'blt', 'bge', 'bltu', 'bgeu'];
const LOAD_OPS: (Op | null)[] = ['lb', 'lh', 'lw', null, 'lbu', 'lhu', null, null];
const STORE_OPS: (Op | null)[] = ['sb', 'sh', 'sw', null, null, null, null, null];
const OP_IMM_OPS: Op[] = ['addi', 'slli', 'slti', 'sltiu', 'xori', 'srli', 'ori', 'andi'];
const OP_OPS: Op[] = ['add', 'sll', 'slt', 'sltu', 'xor', 'srl', 'or', 'and'];
const M_OPS: Op[] = ['mul', 'mulh', 'mulhsu', 'mulhu', 'div', 'divu', 'rem', 'remu'];
const CSR_OPS: (Op | null)[] = [null, 'csrrw', 'csrrs', 'csrrc', null, 'csrrwi', 'csrrsi', 'csrrci'];

export const immI = (w: number) => w >> 20;
export const immS = (w: number) => ((w >> 25) << 5) | ((w >>> 7) & 0x1f);
export const immB = (w: number) =>
  ((w >> 31) << 12) | (((w >>> 7) & 1) << 11) | (((w >>> 25) & 0x3f) << 5) | (((w >>> 8) & 0xf) << 1);
export const immU = (w: number) => w & 0xfffff000;
export const immJ = (w: number) =>
  ((w >> 31) << 20) | (((w >>> 12) & 0xff) << 12) | (((w >>> 20) & 1) << 11) | (((w >>> 21) & 0x3ff) << 1);

/** Decodes one instruction word; null when it is not a valid RV32IM instruction */
export function decode(word: number): Decoded | null {
  const w = word | 0;
  const opcode = w & 0x7f;
  const rd = (w >>> 7) & 0x1f;
  const f3 = (w >>> 12) & 7;
  const rs1 = (w >>> 15) & 0x1f;
  const rs2 = (w >>> 20) & 0x1f;
  const f7 = (w >>> 25) & 0x7f;
  const d = (op: Op, imm = 0, extra: Partial<Decoded> = {}): Decoded => ({ op, rd, rs1, rs2, imm, csr: 0, pred: 0, succ: 0, ...extra });
  switch (opcode) {
    case OPC.LUI:
      return d('lui', immU(w));
    case OPC.AUIPC:
      return d('auipc', immU(w));
    case OPC.JAL:
      return d('jal', immJ(w));
    case OPC.JALR:
      return f3 === 0 ? d('jalr', immI(w)) : null;
    case OPC.BRANCH: {
      const op = BRANCH_OPS[f3];
      return op ? d(op, immB(w)) : null;
    }
    case OPC.LOAD: {
      const op = LOAD_OPS[f3];
      return op ? d(op, immI(w)) : null;
    }
    case OPC.STORE: {
      const op = STORE_OPS[f3];
      return op ? d(op, immS(w)) : null;
    }
    case OPC.OP_IMM: {
      if (f3 === 1) return f7 === 0 ? d('slli', rs2) : null;
      if (f3 === 5) return f7 === 0 ? d('srli', rs2) : f7 === 0x20 ? d('srai', rs2) : null;
      return d(OP_IMM_OPS[f3], immI(w));
    }
    case OPC.OP: {
      if (f7 === 0) return d(OP_OPS[f3]);
      if (f7 === 1) return d(M_OPS[f3]);
      if (f7 === 0x20) return f3 === 0 ? d('sub') : f3 === 5 ? d('sra') : null;
      return null;
    }
    case OPC.MISC_MEM: {
      if (f3 !== 0) return null; // FENCE.I (Zifencei) is not part of RV32IM
      const fm = (w >>> 28) & 0xf;
      const pred = (w >>> 24) & 0xf;
      const succ = (w >>> 20) & 0xf;
      // rd and rs1 are reserved for future use and ignored, as the spec asks; an unknown fm is a plain FENCE
      if (fm === 8 && pred === 3 && succ === 3) return d('fence.tso', 0, { pred, succ });
      return d('fence', 0, { pred, succ });
    }
    case OPC.SYSTEM: {
      if (f3 === 0) {
        if (w === 0x00000073) return d('ecall');
        if (w === 0x00100073) return d('ebreak');
        if (w === 0x30200073) return d('mret');
        if (w === 0x10500073) return d('wfi');
        return null;
      }
      const op = CSR_OPS[f3];
      if (!op) return null;
      return d(op, f3 >= 5 ? rs1 : 0, { csr: (w >>> 20) & 0xfff });
    }
    default:
      return null;
  }
}

// ---------- encoders (fields are masked; range checks are the assembler's job)
export const encR = (opcode: number, rd: number, f3: number, rs1: number, rs2: number, f7: number) =>
  ((f7 & 0x7f) << 25) | ((rs2 & 0x1f) << 20) | ((rs1 & 0x1f) << 15) | ((f3 & 7) << 12) | ((rd & 0x1f) << 7) | opcode;
export const encI = (opcode: number, rd: number, f3: number, rs1: number, imm: number) =>
  ((imm & 0xfff) << 20) | ((rs1 & 0x1f) << 15) | ((f3 & 7) << 12) | ((rd & 0x1f) << 7) | opcode;
export const encS = (opcode: number, f3: number, rs1: number, rs2: number, imm: number) =>
  (((imm >> 5) & 0x7f) << 25) | ((rs2 & 0x1f) << 20) | ((rs1 & 0x1f) << 15) | ((f3 & 7) << 12) | ((imm & 0x1f) << 7) | opcode;
export const encB = (opcode: number, f3: number, rs1: number, rs2: number, imm: number) =>
  (((imm >> 12) & 1) << 31) |
  (((imm >> 5) & 0x3f) << 25) |
  ((rs2 & 0x1f) << 20) |
  ((rs1 & 0x1f) << 15) |
  ((f3 & 7) << 12) |
  (((imm >> 1) & 0xf) << 8) |
  (((imm >> 11) & 1) << 7) |
  opcode;
/** `upper` is the 20-bit field value (not shifted) */
export const encU = (opcode: number, rd: number, upper: number) => ((upper & 0xfffff) << 12) | ((rd & 0x1f) << 7) | opcode;
export const encJ = (opcode: number, rd: number, imm: number) =>
  (((imm >> 20) & 1) << 31) |
  (((imm >> 1) & 0x3ff) << 21) |
  (((imm >> 11) & 1) << 20) |
  (((imm >> 12) & 0xff) << 12) |
  ((rd & 0x1f) << 7) |
  opcode;

/** funct3 of each base op (and funct7 where it selects the op) for the encoder */
export const FUNCT: Readonly<Record<string, { opcode: number; f3: number; f7?: number }>> = {
  beq: { opcode: OPC.BRANCH, f3: 0 }, bne: { opcode: OPC.BRANCH, f3: 1 }, blt: { opcode: OPC.BRANCH, f3: 4 },
  bge: { opcode: OPC.BRANCH, f3: 5 }, bltu: { opcode: OPC.BRANCH, f3: 6 }, bgeu: { opcode: OPC.BRANCH, f3: 7 },
  lb: { opcode: OPC.LOAD, f3: 0 }, lh: { opcode: OPC.LOAD, f3: 1 }, lw: { opcode: OPC.LOAD, f3: 2 },
  lbu: { opcode: OPC.LOAD, f3: 4 }, lhu: { opcode: OPC.LOAD, f3: 5 },
  sb: { opcode: OPC.STORE, f3: 0 }, sh: { opcode: OPC.STORE, f3: 1 }, sw: { opcode: OPC.STORE, f3: 2 },
  addi: { opcode: OPC.OP_IMM, f3: 0 }, slti: { opcode: OPC.OP_IMM, f3: 2 }, sltiu: { opcode: OPC.OP_IMM, f3: 3 },
  xori: { opcode: OPC.OP_IMM, f3: 4 }, ori: { opcode: OPC.OP_IMM, f3: 6 }, andi: { opcode: OPC.OP_IMM, f3: 7 },
  slli: { opcode: OPC.OP_IMM, f3: 1, f7: 0 }, srli: { opcode: OPC.OP_IMM, f3: 5, f7: 0 }, srai: { opcode: OPC.OP_IMM, f3: 5, f7: 0x20 },
  add: { opcode: OPC.OP, f3: 0, f7: 0 }, sub: { opcode: OPC.OP, f3: 0, f7: 0x20 }, sll: { opcode: OPC.OP, f3: 1, f7: 0 },
  slt: { opcode: OPC.OP, f3: 2, f7: 0 }, sltu: { opcode: OPC.OP, f3: 3, f7: 0 }, xor: { opcode: OPC.OP, f3: 4, f7: 0 },
  srl: { opcode: OPC.OP, f3: 5, f7: 0 }, sra: { opcode: OPC.OP, f3: 5, f7: 0x20 }, or: { opcode: OPC.OP, f3: 6, f7: 0 },
  and: { opcode: OPC.OP, f3: 7, f7: 0 },
  mul: { opcode: OPC.OP, f3: 0, f7: 1 }, mulh: { opcode: OPC.OP, f3: 1, f7: 1 }, mulhsu: { opcode: OPC.OP, f3: 2, f7: 1 },
  mulhu: { opcode: OPC.OP, f3: 3, f7: 1 }, div: { opcode: OPC.OP, f3: 4, f7: 1 }, divu: { opcode: OPC.OP, f3: 5, f7: 1 },
  rem: { opcode: OPC.OP, f3: 6, f7: 1 }, remu: { opcode: OPC.OP, f3: 7, f7: 1 },
  csrrw: { opcode: OPC.SYSTEM, f3: 1 }, csrrs: { opcode: OPC.SYSTEM, f3: 2 }, csrrc: { opcode: OPC.SYSTEM, f3: 3 },
  csrrwi: { opcode: OPC.SYSTEM, f3: 5 }, csrrsi: { opcode: OPC.SYSTEM, f3: 6 }, csrrci: { opcode: OPC.SYSTEM, f3: 7 },
};

/** FENCE set text: "iorw" order, "0" when empty */
export function fenceSetText(set: number): string {
  const s = (set & 8 ? 'i' : '') + (set & 4 ? 'o' : '') + (set & 2 ? 'r' : '') + (set & 1 ? 'w' : '');
  return s || '0';
}

/** FENCE set of a name such as "rw" or "iorw" (letters in i, o, r, w order), or undefined */
export function fenceSetValue(name: string): number | undefined {
  const m = /^(i?)(o?)(r?)(w?)$/.exec(name.toLowerCase());
  if (!m || name === '') return undefined;
  return (m[1] ? 8 : 0) | (m[2] ? 4 : 0) | (m[3] ? 2 : 0) | (m[4] ? 1 : 0);
}
