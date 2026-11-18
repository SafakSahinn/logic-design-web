// RV32IM processor core (Aşama 6f), after evo's RV32imState.ProcessorState: one instruction per clock edge,
// instruction fetch and data accesses as transactions on the SoC bus, a trace of the last instructions,
// breakpoints and evo's run / stop / breakpoint / error states.
//
// Where evo is incomplete the RISC-V spec decides: synchronous exceptions (illegal instruction, misaligned or
// failing accesses, ecall, ebreak) trap to mtvec like interrupts, with mepc / mcause / mtval set. While the program
// has not written mtvec since reset there is no handler: the core halts with a message instead (ebreak and ecall
// then stop after the instruction, so "run" continues the program).
import { BYTE_ACCESS, HALF_WORD_ACCESS, READ_TRANSACTION, SocTransaction, WORD_ACCESS, WRITE_TRANSACTION, busErrorName, type SocAccess } from '../bus/transaction';
import { CSR_NAMES, decode, type Decoded } from './isa';
import { formatDecoded } from './disasm';
import { CsrFile, MIP_MEIP, MSTATUS_MIE, MSTATUS_MPIE } from './csr';

/** Instructions kept in the trace (evo: CpuDrawSupport.NR_OF_TRACES) */
export const TRACE_ENTRIES = 21;

/** mcause exception codes */
export const Cause = {
  instructionMisaligned: 0,
  instructionAccessFault: 1,
  illegalInstruction: 2,
  breakpoint: 3,
  loadMisaligned: 4,
  loadAccessFault: 5,
  storeMisaligned: 6,
  storeAccessFault: 7,
  ecallM: 11,
  /** Interrupt code (with bit 31 set in mcause) */
  machineExternalInterrupt: 11,
} as const;

export type RunState = 'running' | 'stopped' | 'breakpoint' | 'error';

export interface TraceEntry {
  pc: number;
  /** The fetched word; null when the fetch failed */
  word: number | null;
  /** Disassembly ("" when the word is not an instruction) */
  text: string;
  /** The instruction stopped the core with an error */
  error: boolean;
  /** mcause of the trap the instruction took */
  trap?: number;
}

/** Why the core stopped: i18n key in the "rv32im" namespace ("halt.<name>") and its arguments */
export interface HaltInfo {
  key: string;
  args: Record<string, string | number>;
}

export interface Rv32imBusPort {
  /** Routes a transaction (the CPU's bus via the SocManager) */
  transact(t: SocTransaction): void;
  /** Master name shown in the bus trace */
  master(): string;
}

const hex8 = (n: number) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

class Trap {
  readonly cause: number;
  readonly tval: number;
  readonly halt: HaltInfo;
  constructor(cause: number, tval: number, halt: HaltInfo) {
    this.cause = cause;
    this.tval = tval;
    this.halt = halt;
  }
}

export class Rv32imCore {
  /** x0..x31 (x0 always 0) */
  readonly regs = new Int32Array(32);
  /** Written since reset (evo shows the others as "??????????") */
  readonly valid: boolean[] = new Array(32).fill(false);
  pc = 0;
  readonly csr = new CsrFile();
  /** Address the core starts at without a loaded program */
  resetVector = 0;
  /** Entry point of the loaded program (wins over the reset vector) */
  entryPoint: number | null = null;
  runState: RunState = 'stopped';
  halt: HaltInfo | null = null;
  /** Register written by the last instruction, -1 if none */
  lastWritten = -1;
  /** Newest first */
  trace: TraceEntry[] = [];
  readonly breakpoints = new Set<number>();
  private continueAfterBreak = false;
  private readonly bus: Rv32imBusPort;

  constructor(bus: Rv32imBusPort) {
    this.bus = bus;
    this.reset();
  }

  /** Reset pin / simulation reset; `entry` sets the program's entry point (evo: setEntryPointandReset) */
  reset(entry?: number): void {
    if (entry !== undefined) this.entryPoint = entry >>> 0;
    this.pc = (this.entryPoint ?? this.resetVector) >>> 0;
    this.regs.fill(0);
    this.valid.fill(false);
    this.valid[0] = true;
    this.csr.reset();
    this.lastWritten = -1;
    this.trace = [];
    this.runState = 'stopped';
    this.halt = null;
    this.continueAfterBreak = false;
  }

  /** Forgets the loaded program's entry point (the reset vector applies again) */
  clearProgram(): void {
    this.entryPoint = null;
  }

  /** evo's run/stop button: stops a running core, otherwise runs (past a breakpoint it stopped at) */
  toggleRun(): void {
    if (this.runState === 'running') this.runState = 'stopped';
    else {
      if (this.runState === 'breakpoint') this.continueAfterBreak = true;
      this.runState = 'running';
      this.halt = null;
    }
  }

  /** A rising clock edge: executes one instruction while running; returns whether it executed */
  tick(): boolean {
    if (this.runState !== 'running') return false;
    // the run past a breakpoint covers only the first instruction after Start, wherever the core stopped
    const pass = this.continueAfterBreak;
    this.continueAfterBreak = false;
    if (!pass && this.breakpoints.has(this.pc)) {
      this.runState = 'breakpoint';
      this.halt = { key: 'halt.breakpoint', args: { pc: hex8(this.pc) } };
      return false;
    }
    this.execute();
    return true;
  }

  /** One instruction while halted (the debugger's step); does nothing while running */
  step(): void {
    if (this.runState === 'running') return;
    this.continueAfterBreak = false;
    if (this.runState === 'error') this.runState = 'stopped';
    this.halt = null;
    this.execute();
  }

  read(index: number): number {
    return index === 0 ? 0 : this.regs[index];
  }

  private write(rd: number, value: number): void {
    if (rd === 0) return;
    this.regs[rd] = value | 0;
    this.valid[rd] = true;
    this.lastWritten = rd;
  }

  private addTrace(e: TraceEntry): void {
    this.trace.unshift(e);
    if (this.trace.length > TRACE_ENTRIES) this.trace.length = TRACE_ENTRIES;
  }

  private access(type: number, address: number, data: number, access: SocAccess): SocTransaction {
    const t = new SocTransaction(type, address >>> 0, data, access, this.bus.master());
    this.bus.transact(t);
    return t;
  }

  /** Enters the trap handler; false when there is none (the caller halts) */
  private enterTrap(cause: number, tval: number, interrupt: boolean): boolean {
    const c = this.csr;
    if (!c.mtvecSet) return false;
    c.write(CSR_NAMES.mepc, this.pc);
    c.write(CSR_NAMES.mcause, ((interrupt ? 0x80000000 : 0) | cause) >>> 0);
    c.write(CSR_NAMES.mtval, tval);
    const mie = (c.mstatus & MSTATUS_MIE) !== 0;
    c.mstatus = (c.mstatus & ~(MSTATUS_MIE | MSTATUS_MPIE)) | (mie ? MSTATUS_MPIE : 0);
    const base = c.mtvec & ~3;
    this.pc = (interrupt && (c.mtvec & 1) === 1 ? base + 4 * cause : base) >>> 0;
    return true;
  }

  private execute(): void {
    const c = this.csr;
    c.cycles++;
    this.lastWritten = -1;

    // interrupts are taken before the fetch (evo); mip.MEIP comes from the PLIC
    if ((c.mstatus & MSTATUS_MIE) !== 0 && (c.mie & MIP_MEIP) !== 0 && c.meip) {
      if (!this.enterTrap(Cause.machineExternalInterrupt, 0, true)) {
        this.stop('error', { key: 'halt.interrupt', args: { pc: hex8(this.pc) } });
        this.addTrace({ pc: this.pc, word: null, text: '', error: true });
        return;
      }
    }

    const pc = this.pc;
    let word: number | null = null;
    let d: Decoded | null = null;
    try {
      if ((pc & 3) !== 0) throw new Trap(Cause.instructionMisaligned, pc, { key: 'halt.misalignedFetch', args: { pc: hex8(pc) } });
      const f = this.access(READ_TRANSACTION, pc, 0, WORD_ACCESS);
      if (f.hasError) {
        throw new Trap(Cause.instructionAccessFault, pc, { key: 'halt.fetchError', args: { pc: hex8(pc), error: busErrorName(f.error) } });
      }
      word = f.readData >>> 0;
      d = decode(word);
      if (!d) throw new Trap(Cause.illegalInstruction, word, { key: 'halt.illegal', args: { pc: hex8(pc), word: hex8(word) } });
      const wroteInstret = this.run(d, pc, word);
      if (!wroteInstret) c.instret++;
      this.addTrace({ pc, word, text: formatDecoded(d, pc), error: false });
    } catch (e) {
      if (!(e instanceof Trap)) throw e;
      const text = d ? formatDecoded(d, pc) : '';
      if (e.cause === Cause.breakpoint && !c.mtvecSet) {
        // no handler: stop like a debugger breakpoint, after the instruction
        this.pc = (pc + 4) >>> 0;
        c.instret++;
        this.addTrace({ pc, word, text, error: false });
        this.stop('breakpoint', e.halt);
        return;
      }
      if (e.cause === Cause.ecallM && !c.mtvecSet) {
        this.pc = (pc + 4) >>> 0;
        c.instret++;
        this.addTrace({ pc, word, text, error: false });
        this.stop('stopped', e.halt);
        return;
      }
      if (this.enterTrap(e.cause, e.tval, false)) {
        this.addTrace({ pc, word, text, error: false, trap: e.cause });
        return;
      }
      this.lastWritten = -1;
      this.addTrace({ pc, word, text, error: true });
      this.stop('error', e.halt);
    }
  }

  private stop(state: RunState, halt: HaltInfo): void {
    this.runState = state;
    this.halt = halt;
  }

  /** Executes a decoded instruction; returns whether it wrote minstret (no increment then) */
  private run(d: Decoded, pc: number, word: number): boolean {
    const { op, rd, rs1, rs2, imm } = d;
    const a = this.read(rs1);
    const b = this.read(rs2);
    let next = (pc + 4) >>> 0;
    const jump = (target: number) => {
      const t = target >>> 0;
      if ((t & 3) !== 0) throw new Trap(Cause.instructionMisaligned, t, { key: 'halt.misalignedJump', args: { pc: hex8(pc), target: hex8(t) } });
      next = t;
    };
    let wroteInstret = false;

    switch (op) {
      case 'lui':
        this.write(rd, imm);
        break;
      case 'auipc':
        this.write(rd, (pc + imm) | 0);
        break;
      case 'jal':
        jump(pc + imm);
        this.write(rd, pc + 4);
        break;
      case 'jalr':
        jump((a + imm) & ~1);
        this.write(rd, pc + 4);
        break;
      case 'beq':
        if (a === b) jump(pc + imm);
        break;
      case 'bne':
        if (a !== b) jump(pc + imm);
        break;
      case 'blt':
        if (a < b) jump(pc + imm);
        break;
      case 'bge':
        if (a >= b) jump(pc + imm);
        break;
      case 'bltu':
        if (a >>> 0 < b >>> 0) jump(pc + imm);
        break;
      case 'bgeu':
        if (a >>> 0 >= b >>> 0) jump(pc + imm);
        break;
      case 'lb':
      case 'lh':
      case 'lw':
      case 'lbu':
      case 'lhu': {
        const addr = (a + imm) >>> 0;
        const size = op === 'lw' ? 4 : op === 'lb' || op === 'lbu' ? 1 : 2;
        if (addr % size !== 0) throw new Trap(Cause.loadMisaligned, addr, { key: 'halt.misalignedLoad', args: { pc: hex8(pc), address: hex8(addr) } });
        const t = this.access(READ_TRANSACTION, addr, 0, size === 4 ? WORD_ACCESS : size === 2 ? HALF_WORD_ACCESS : BYTE_ACCESS);
        if (t.hasError) {
          throw new Trap(Cause.loadAccessFault, addr, { key: 'halt.loadError', args: { pc: hex8(pc), address: hex8(addr), error: busErrorName(t.error) } });
        }
        const v = t.readData;
        this.write(rd, op === 'lb' ? (v << 24) >> 24 : op === 'lh' ? (v << 16) >> 16 : op === 'lbu' ? v & 0xff : op === 'lhu' ? v & 0xffff : v | 0);
        break;
      }
      case 'sb':
      case 'sh':
      case 'sw': {
        const addr = (a + imm) >>> 0;
        const size = op === 'sw' ? 4 : op === 'sb' ? 1 : 2;
        if (addr % size !== 0) throw new Trap(Cause.storeMisaligned, addr, { key: 'halt.misalignedStore', args: { pc: hex8(pc), address: hex8(addr) } });
        const data = size === 4 ? b >>> 0 : size === 2 ? b & 0xffff : b & 0xff;
        const t = this.access(WRITE_TRANSACTION, addr, data, size === 4 ? WORD_ACCESS : size === 2 ? HALF_WORD_ACCESS : BYTE_ACCESS);
        if (t.hasError) {
          throw new Trap(Cause.storeAccessFault, addr, { key: 'halt.storeError', args: { pc: hex8(pc), address: hex8(addr), error: busErrorName(t.error) } });
        }
        break;
      }
      case 'addi':
        this.write(rd, a + imm);
        break;
      case 'slti':
        this.write(rd, a < imm ? 1 : 0);
        break;
      case 'sltiu':
        this.write(rd, a >>> 0 < imm >>> 0 ? 1 : 0);
        break;
      case 'xori':
        this.write(rd, a ^ imm);
        break;
      case 'ori':
        this.write(rd, a | imm);
        break;
      case 'andi':
        this.write(rd, a & imm);
        break;
      case 'slli':
        this.write(rd, a << imm);
        break;
      case 'srli':
        this.write(rd, a >>> imm);
        break;
      case 'srai':
        this.write(rd, a >> imm);
        break;
      case 'add':
        this.write(rd, a + b);
        break;
      case 'sub':
        this.write(rd, a - b);
        break;
      case 'sll':
        this.write(rd, a << (b & 31));
        break;
      case 'slt':
        this.write(rd, a < b ? 1 : 0);
        break;
      case 'sltu':
        this.write(rd, a >>> 0 < b >>> 0 ? 1 : 0);
        break;
      case 'xor':
        this.write(rd, a ^ b);
        break;
      case 'srl':
        this.write(rd, a >>> (b & 31));
        break;
      case 'sra':
        this.write(rd, a >> (b & 31));
        break;
      case 'or':
        this.write(rd, a | b);
        break;
      case 'and':
        this.write(rd, a & b);
        break;
      case 'mul':
        this.write(rd, Math.imul(a, b));
        break;
      case 'mulh':
        this.write(rd, Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b)) >> 32n)));
        break;
      case 'mulhsu':
        this.write(rd, Number(BigInt.asIntN(32, (BigInt(a) * BigInt(b >>> 0)) >> 32n)));
        break;
      case 'mulhu':
        this.write(rd, Number(BigInt.asIntN(32, (BigInt(a >>> 0) * BigInt(b >>> 0)) >> 32n)));
        break;
      // division by zero and overflow give the spec's results instead of a trap
      case 'div':
        this.write(rd, b === 0 ? -1 : a === -0x80000000 && b === -1 ? a : Math.trunc(a / b));
        break;
      case 'divu':
        this.write(rd, b === 0 ? -1 : Math.floor((a >>> 0) / (b >>> 0)));
        break;
      case 'rem':
        this.write(rd, b === 0 ? a : a === -0x80000000 && b === -1 ? 0 : a % b);
        break;
      case 'remu':
        this.write(rd, b === 0 ? a : (a >>> 0) % (b >>> 0));
        break;
      case 'fence':
      case 'fence.tso':
      case 'wfi':
        break; // one hart, no caches; wfi may be a no-op
      case 'ecall':
        throw new Trap(Cause.ecallM, 0, { key: 'halt.ecall', args: { pc: hex8(pc), a7: this.read(17) } });
      case 'ebreak':
        throw new Trap(Cause.breakpoint, pc, { key: 'halt.ebreak', args: { pc: hex8(pc) } });
      case 'mret': {
        const c = this.csr;
        const mpie = (c.mstatus & MSTATUS_MPIE) !== 0;
        c.mstatus = (c.mstatus & ~MSTATUS_MIE) | (mpie ? MSTATUS_MIE : 0) | MSTATUS_MPIE;
        next = c.mepc >>> 0;
        break;
      }
      default: {
        // Zicsr
        const csr = d.csr;
        const immForm = op === 'csrrwi' || op === 'csrrsi' || op === 'csrrci';
        const src = immForm ? imm : a;
        const isWrite = op === 'csrrw' || op === 'csrrwi';
        const writes = isWrite || (immForm ? imm !== 0 : rs1 !== 0);
        const illegal = () =>
          new Trap(Cause.illegalInstruction, word, { key: 'halt.illegalCsr', args: { pc: hex8(pc), csr: '0x' + csr.toString(16).padStart(3, '0') } });
        if (!CsrFile.implemented(csr)) throw illegal();
        if (writes && CsrFile.readOnly(csr)) throw illegal();
        const old = isWrite && rd === 0 ? 0 : this.csr.read(csr);
        if (writes) {
          const value = isWrite ? src : op === 'csrrs' || op === 'csrrsi' ? old | src : old & ~src;
          this.csr.write(csr, value);
          if (csr === CSR_NAMES.minstret || csr === CSR_NAMES.minstreth) wroteInstret = true;
        }
        this.write(rd, old);
      }
    }
    this.pc = next;
    return wroteInstret;
  }
}
