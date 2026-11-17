// What a processor's instruction set gives the generic SoC assembler (Aşama 6e; implemented by RV32IM in 6f and
// Nios II in 6g). evo: AssemblerInterface / AssemblerExecutionInterface.

export interface AsmRegisterOperand {
  kind: 'reg';
  /** Register name in lower case, as written (an ABI alias stays an alias) */
  name: string;
}

export interface AsmImmediateOperand {
  kind: 'imm';
  /** Value of the expression (labels, .equ names and the location counter resolved) */
  value: number;
}

export interface AsmMemoryOperand {
  kind: 'mem';
  /** Offset expression before the bracket (0 when none) */
  offset: number;
  /** Base register in lower case */
  base: string;
}

export type AsmOperand = AsmRegisterOperand | AsmImmediateOperand | AsmMemoryOperand;

export interface AsmInstruction {
  /** Opcode in lower case */
  opcode: string;
  operands: AsmOperand[];
  /** Address of the instruction (for pc-relative branches) */
  address: number;
}

/** A failed encoding: i18n key in the ISA's namespace (or "soc" for the generic keys), and which operand */
export interface AsmEncodeError {
  ns: string;
  key: string;
  args?: Record<string, string | number>;
  /** 0-based operand the error is about; omitted = the opcode */
  operand?: number;
}

export interface IsaAssembler {
  /** Shown in messages, e.g. "RV32IM" */
  readonly name: string;
  /** Opcodes (incl. pseudo-instructions) in lower case */
  readonly opcodes: readonly string[];
  /** Register names (incl. ABI aliases) in lower case */
  readonly registers: readonly string[];
  /** "round": 4(sp) as in RISC-V and Nios II; "square": 4[sp] */
  readonly brackets: 'round' | 'square';
  readonly littleEndian: boolean;
  /** Size in bytes of an opcode's encoding (fixed per opcode; pseudo-instructions may take several words) */
  instructionSize(opcode: string): number;
  /** Encodes one instruction to exactly instructionSize(opcode) bytes */
  encode(instr: AsmInstruction): { bytes: number[] } | { error: AsmEncodeError };
  /** Decodes the instruction at `address` for the listing; null when it is not a valid instruction */
  disassemble?(readByte: (address: number) => number | undefined, address: number): { text: string; size: number } | null;
}
