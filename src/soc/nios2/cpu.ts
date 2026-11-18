// Nios II processor core (Aşama 6g), after evo's Nios2State.ProcessorState: one instruction per clock edge,
// instruction fetch and data accesses as transactions on the SoC bus, a trace of the last instructions,
// breakpoints and evo's run / stop / breakpoint / error states.
//
// Exceptions follow the Nios II Processor Reference: a hardware interrupt or trap saves status in estatus, clears
// PIE, writes the address after the interrupted (interrupt) or trap instruction to ea and jumps to the exception
// vector, with the cause in the exception control register; break saves status in bstatus, writes ba and jumps to
// the break vector; eret / bret return. evo writes ea = the interrupted instruction itself; here a handler
// subtracts 4 from ea for hardware interrupts, as on real hardware and in Altera's HAL.
// Like evo (and a core without the optional exceptions), an invalid instruction, a misaligned or failing access,
// a division by zero and rdprs / wrprs (no shadow register sets) stop the core with a message.
import { BYTE_ACCESS, HALF_WORD_ACCESS, READ_TRANSACTION, SocTransaction, WORD_ACCESS, WRITE_TRANSACTION, busErrorName, type SocAccess } from '../bus/transaction';
import { decode, type Decoded } from './isa';
import { formatDecoded, jumpTarget } from './disasm';

/** Instructions kept in the trace (evo: CpuDrawSupport.NR_OF_TRACES) */
export const TRACE_ENTRIES = 21;
/** IRQ inputs at most */
export const MAX_IRQS = 32;

/** status bits: PIE (interrupts enabled); RSIE always reads 1 without an external interrupt controller */
export const STATUS_PIE = 1;
export const STATUS_RSIE = 1 << 23;

/** Exception causes (exception control register, bits 6:2) */
export const Cause = { interrupt: 2, trap: 3 } as const;

export type RunState = 'running' | 'stopped' | 'breakpoint' | 'error';

export interface TraceEntry {
  pc: number;
  /** The fetched word; null when the fetch failed */
  word: number | null;
  /** Disassembly ("" when the word is not an instruction) */
  text: string;
  /** The instruction stopped the core with an error */
  error: boolean;
  /** Exception cause the instruction took (trap) */
  trap?: number;
}

/** Why the core stopped: i18n key in the "nios2" namespace ("halt.<name>") and its arguments */
export interface HaltInfo {
  key: string;
  args: Record<string, string | number>;
}

/** Values a custom instruction drives on the custom-instruction pins */
export interface CustomRequest {
  dataa: number;
  datab: number;
  n: number;
  a: number;
  b: number;
  c: number;
  readra: boolean;
  readrb: boolean;
  writerc: boolean;
}

export interface Nios2Ports {
  /** Routes a transaction (the CPU's bus via the SocManager) */
  transact(t: SocTransaction): void;
  /** Master name shown in the bus trace */
  master(): string;
  /** The done input (null = not a defined 0 / 1) and the result input (null = undefined bits) of the custom logic */
  customDone?(): boolean | null;
  customResult?(): number | null;
}

const hex8 = (n: number) => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

class Halt {
  readonly info: HaltInfo;
  constructor(info: HaltInfo) {
    this.info = info;
  }
}

export class Nios2Core {
  /** r0..r31 (r0 always 0) */
  readonly regs = new Int32Array(32);
  /** Written since reset (evo shows the others as "??????????") */
  readonly valid: boolean[] = new Array(32).fill(false);
  pc = 0;
  status = STATUS_RSIE;
  estatus = 0;
  bstatus = 0;
  ienable = 0;
  /** Exception control register (cause << 2) */
  exception = 0;
  /** Levels of the IRQ inputs, bit i = IRQ i */
  irqLines = 0;
  /** Number of IRQ inputs (attribute irqWidth) */
  private irqCount = 0;
  resetVector = 0;
  exceptionVector = 0x14;
  breakVector = 0x30;
  /** Entry point of the loaded program (wins over the reset vector) */
  entryPoint: number | null = null;
  runState: RunState = 'stopped';
  halt: HaltInfo | null = null;
  /** Register written by the last instruction, -1 if none */
  lastWritten = -1;
  /** Newest first */
  trace: TraceEntry[] = [];
  readonly breakpoints = new Set<number>();
  /** Last values driven on the custom-instruction outputs (null before the first custom instruction) */
  customOut: CustomRequest | null = null;
  /** The start output: high for the clock period after a custom instruction issued */
  customStart = false;
  /** A custom instruction waits for done */
  customBusy = false;
  cycles = 0;
  private continueAfterBreak = false;
  private readonly ports: Nios2Ports;

  constructor(ports: Nios2Ports) {
    this.ports = ports;
    this.reset();
  }

  /** Number of IRQ inputs (0..32); fewer inputs also clear the ienable bits of the removed ones */
  get nrOfIrqs(): number {
    return this.irqCount;
  }

  set nrOfIrqs(n: number) {
    this.irqCount = n;
    this.ienable = (this.ienable & this.irqMask) >>> 0;
  }

  /** IRQ mask of the implemented inputs */
  private get irqMask(): number {
    return this.irqCount >= 32 ? 0xffffffff : (1 << this.irqCount) - 1;
  }

  /** ipending = asserted and enabled IRQs (read-only) */
  get ipending(): number {
    return (this.irqLines & this.ienable & this.irqMask) >>> 0;
  }

  /** Reset pin / simulation reset; `entry` sets the program's entry point (evo: setEntryPointandReset) */
  reset(entry?: number): void {
    if (entry !== undefined) this.entryPoint = entry >>> 0;
    this.pc = (this.entryPoint ?? this.resetVector) >>> 0;
    this.regs.fill(0);
    this.valid.fill(false);
    this.valid[0] = true;
    this.status = STATUS_RSIE;
    this.estatus = 0;
    this.bstatus = 0;
    this.ienable = 0;
    this.exception = 0;
    this.cycles = 0;
    this.lastWritten = -1;
    this.trace = [];
    this.runState = 'stopped';
    this.halt = null;
    this.continueAfterBreak = false;
    this.customOut = null;
    this.customStart = false;
    this.customBusy = false;
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
    if (this.customBusy && !this.finishCustom()) return false;
    // an interrupt is taken first, so a breakpoint on the handler's first instruction stops there
    this.takeInterrupt();
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
    // the step that sees done completes the custom instruction only (rC written, pc on)
    if (this.customBusy) {
      this.finishCustom();
      return;
    }
    this.takeInterrupt();
    this.execute();
  }

  read(index: number): number {
    return index === 0 ? 0 : this.regs[index];
  }

  private write(r: number, value: number): void {
    if (r === 0) return;
    this.regs[r] = value | 0;
    this.valid[r] = true;
    this.lastWritten = r;
  }

  /** Control register read (rdctl); unimplemented ones read 0 */
  readControl(n: number): number {
    switch (n) {
      case 0:
        return this.status >>> 0;
      case 1:
        return this.estatus >>> 0;
      case 2:
        return this.bstatus >>> 0;
      case 3:
        return this.ienable >>> 0;
      case 4:
        return this.ipending;
      case 7:
        return this.exception >>> 0;
      default:
        return 0; // cpuid 0, no MMU / MPU / ECC registers
    }
  }

  /** Control register write (wrctl); read-only and unimplemented ones ignore it */
  writeControl(n: number, value: number): void {
    const st = (value & STATUS_PIE) | STATUS_RSIE;
    switch (n) {
      case 0:
        this.status = st;
        break;
      case 1:
        this.estatus = st;
        break;
      case 2:
        this.bstatus = st;
        break;
      case 3:
        this.ienable = (value & this.irqMask) >>> 0;
        break;
    }
  }

  private addTrace(e: TraceEntry): void {
    this.trace.unshift(e);
    if (this.trace.length > TRACE_ENTRIES) this.trace.length = TRACE_ENTRIES;
  }

  private access(type: number, address: number, data: number, access: SocAccess): SocTransaction {
    const t = new SocTransaction(type, address >>> 0, data, access, this.ports.master());
    this.ports.transact(t);
    return t;
  }

  /** Exception entry (interrupt or trap): ea = `ea`, pc = exception vector */
  private enterException(cause: number, ea: number): void {
    this.estatus = this.status;
    this.status &= ~STATUS_PIE;
    this.exception = cause << 2;
    this.write(29, ea);
    this.pc = this.exceptionVector >>> 0;
  }

  /** The clock edge after a custom instruction: drops start, reads done; true when the core may go on */
  private finishCustom(): boolean {
    this.customStart = false;
    const done = this.ports.customDone ? this.ports.customDone() : true;
    if (done === null) {
      this.customBusy = false;
      this.lastWritten = -1;
      this.stop('error', { key: 'halt.customDone', args: { pc: hex8(this.pc) } });
      return false;
    }
    if (!done) return false;
    this.customBusy = false;
    const req = this.customOut;
    if (req?.writerc) {
      const result = this.ports.customResult ? this.ports.customResult() : 0;
      if (result === null) {
        this.lastWritten = -1;
        this.stop('error', { key: 'halt.customResult', args: { pc: hex8(this.pc), reg: `r${req.c}` } });
        return false;
      }
      this.write(req.c, result);
    }
    this.pc = (this.pc + 4) >>> 0;
    return true;
  }

  /** Interrupts are taken before the fetch (evo); ea = the address after the interrupted instruction */
  private takeInterrupt(): void {
    if ((this.status & STATUS_PIE) !== 0 && this.ipending !== 0) this.enterException(Cause.interrupt, this.pc + 4);
  }

  private stop(state: RunState, halt: HaltInfo): void {
    this.runState = state;
    this.halt = halt;
  }

  private execute(): void {
    this.cycles++;
    this.lastWritten = -1;
    const pc = this.pc;
    let word: number | null = null;
    let d: Decoded | null = null;
    try {
      if ((pc & 3) !== 0) throw new Halt({ key: 'halt.misalignedFetch', args: { pc: hex8(pc) } });
      const f = this.access(READ_TRANSACTION, pc, 0, WORD_ACCESS);
      if (f.hasError) throw new Halt({ key: 'halt.fetchError', args: { pc: hex8(pc), error: busErrorName(f.error) } });
      word = f.readData >>> 0;
      d = decode(word);
      if (!d) throw new Halt({ key: 'halt.illegal', args: { pc: hex8(pc), word: hex8(word) } });
      const trap = this.run(d, pc);
      this.addTrace({ pc, word, text: formatDecoded(d, pc), error: false, ...(trap !== undefined ? { trap } : {}) });
    } catch (e) {
      if (!(e instanceof Halt)) throw e;
      this.lastWritten = -1;
      this.addTrace({ pc, word, text: d ? formatDecoded(d, pc) : '', error: true });
      this.stop('error', e.info);
    }
  }

  /** Executes a decoded instruction; returns the exception cause when it trapped */
  private run(d: Decoded, pc: number): number | undefined {
    const { op, a: ra, b: rb, c: rc, imm } = d;
    const a = this.read(ra);
    const b = this.read(rb);
    let next = (pc + 4) >>> 0;
    const jump = (target: number) => {
      const t = target >>> 0;
      if ((t & 3) !== 0) throw new Halt({ key: 'halt.misalignedJump', args: { pc: hex8(pc), target: hex8(t) } });
      next = t;
    };
    const load = (size: 1 | 2 | 4, signed: boolean) => {
      const addr = (a + imm) >>> 0;
      if (addr % size !== 0) throw new Halt({ key: 'halt.misalignedLoad', args: { pc: hex8(pc), address: hex8(addr) } });
      const t = this.access(READ_TRANSACTION, addr, 0, size === 4 ? WORD_ACCESS : size === 2 ? HALF_WORD_ACCESS : BYTE_ACCESS);
      if (t.hasError) throw new Halt({ key: 'halt.loadError', args: { pc: hex8(pc), address: hex8(addr), error: busErrorName(t.error) } });
      const v = t.readData;
      this.write(rb, size === 4 ? v | 0 : size === 2 ? (signed ? (v << 16) >> 16 : v & 0xffff) : signed ? (v << 24) >> 24 : v & 0xff);
    };
    const store = (size: 1 | 2 | 4) => {
      const addr = (a + imm) >>> 0;
      if (addr % size !== 0) throw new Halt({ key: 'halt.misalignedStore', args: { pc: hex8(pc), address: hex8(addr) } });
      const data = size === 4 ? b >>> 0 : size === 2 ? b & 0xffff : b & 0xff;
      const t = this.access(WRITE_TRANSACTION, addr, data, size === 4 ? WORD_ACCESS : size === 2 ? HALF_WORD_ACCESS : BYTE_ACCESS);
      if (t.hasError) throw new Halt({ key: 'halt.storeError', args: { pc: hex8(pc), address: hex8(addr), error: busErrorName(t.error) } });
    };
    const mulHigh = (x: bigint, y: bigint) => Number(BigInt.asIntN(32, (x * y) >> 32n));
    let trap: number | undefined;

    switch (op) {
      // ---------- I-type arithmetic, logic and compares (rB = rA op imm)
      case 'addi':
        this.write(rb, a + imm);
        break;
      case 'muli':
        this.write(rb, Math.imul(a, imm));
        break;
      case 'andi':
      case 'andhi':
        this.write(rb, a & imm);
        break;
      case 'ori':
      case 'orhi':
        this.write(rb, a | imm);
        break;
      case 'xori':
      case 'xorhi':
        this.write(rb, a ^ imm);
        break;
      case 'cmpeqi':
        this.write(rb, a === imm ? 1 : 0);
        break;
      case 'cmpnei':
        this.write(rb, a !== imm ? 1 : 0);
        break;
      case 'cmpgei':
        this.write(rb, a >= imm ? 1 : 0);
        break;
      case 'cmplti':
        this.write(rb, a < imm ? 1 : 0);
        break;
      case 'cmpgeui':
        this.write(rb, a >>> 0 >= imm >>> 0 ? 1 : 0);
        break;
      case 'cmpltui':
        this.write(rb, a >>> 0 < imm >>> 0 ? 1 : 0);
        break;
      // ---------- loads and stores (the io variants bypass a data cache; there is none)
      case 'ldw':
      case 'ldwio':
        load(4, true);
        break;
      case 'ldh':
      case 'ldhio':
        load(2, true);
        break;
      case 'ldhu':
      case 'ldhuio':
        load(2, false);
        break;
      case 'ldb':
      case 'ldbio':
        load(1, true);
        break;
      case 'ldbu':
      case 'ldbuio':
        load(1, false);
        break;
      case 'stw':
      case 'stwio':
        store(4);
        break;
      case 'sth':
      case 'sthio':
        store(2);
        break;
      case 'stb':
      case 'stbio':
        store(1);
        break;
      // ---------- branches and jumps (branch offsets count from the next instruction)
      case 'br':
        jump(pc + 4 + imm);
        break;
      case 'beq':
        if (a === b) jump(pc + 4 + imm);
        break;
      case 'bne':
        if (a !== b) jump(pc + 4 + imm);
        break;
      case 'bge':
        if (a >= b) jump(pc + 4 + imm);
        break;
      case 'blt':
        if (a < b) jump(pc + 4 + imm);
        break;
      case 'bgeu':
        if (a >>> 0 >= b >>> 0) jump(pc + 4 + imm);
        break;
      case 'bltu':
        if (a >>> 0 < b >>> 0) jump(pc + 4 + imm);
        break;
      case 'call':
        jump(jumpTarget(pc, imm));
        this.write(31, pc + 4);
        break;
      case 'jmpi':
        jump(jumpTarget(pc, imm));
        break;
      case 'callr':
        jump(a);
        this.write(31, pc + 4);
        break;
      case 'jmp':
      case 'ret':
        jump(a);
        break;
      case 'nextpc':
        this.write(rc, pc + 4);
        break;
      // ---------- exceptions
      case 'trap':
        this.enterException(Cause.trap, pc + 4);
        next = this.pc;
        trap = Cause.trap;
        break;
      case 'eret':
        this.status = this.estatus;
        jump(a); // ea
        break;
      case 'break':
        this.bstatus = this.status;
        this.status &= ~STATUS_PIE;
        this.write(30, pc + 4);
        next = this.breakVector >>> 0;
        break;
      case 'bret':
        this.status = this.bstatus;
        jump(a); // ba
        break;
      case 'rdctl':
        this.write(rc, this.readControl(imm));
        break;
      case 'wrctl':
        this.writeControl(imm, a);
        break;
      case 'rdprs':
      case 'wrprs':
        throw new Halt({ key: 'halt.shadow', args: { pc: hex8(pc) } });
      // ---------- cache and pipeline control: no caches, nothing to do
      case 'flushd':
      case 'flushda':
      case 'initd':
      case 'initda':
      case 'flushi':
      case 'initi':
      case 'flushp':
      case 'sync':
        break;
      // ---------- custom instruction: drive the pins, wait for done on the next clock edges
      case 'custom':
        this.customOut = {
          dataa: a >>> 0, datab: b >>> 0, n: d.n ?? 0, a: ra, b: rb, c: rc,
          readra: !!d.readra, readrb: !!d.readrb, writerc: !!d.writerc,
        };
        this.customStart = true;
        this.customBusy = true;
        return undefined; // pc moves on when done
      // ---------- R-type
      case 'add':
        this.write(rc, a + b);
        break;
      case 'sub':
        this.write(rc, a - b);
        break;
      case 'and':
        this.write(rc, a & b);
        break;
      case 'or':
        this.write(rc, a | b);
        break;
      case 'xor':
        this.write(rc, a ^ b);
        break;
      case 'nor':
        this.write(rc, ~(a | b));
        break;
      case 'mul':
        this.write(rc, Math.imul(a, b));
        break;
      case 'mulxss':
        this.write(rc, mulHigh(BigInt(a), BigInt(b)));
        break;
      case 'mulxuu':
        this.write(rc, mulHigh(BigInt(a >>> 0), BigInt(b >>> 0)));
        break;
      case 'mulxsu':
        this.write(rc, mulHigh(BigInt(a), BigInt(b >>> 0)));
        break;
      case 'div':
      case 'divu':
        if (b === 0) throw new Halt({ key: 'halt.divZero', args: { pc: hex8(pc) } });
        // signed overflow (-2^31 / -1) is undefined on the hardware; the quotient wraps to -2^31
        this.write(rc, op === 'div' ? Math.trunc(a / b) : Math.floor((a >>> 0) / (b >>> 0)));
        break;
      case 'cmpeq':
        this.write(rc, a === b ? 1 : 0);
        break;
      case 'cmpne':
        this.write(rc, a !== b ? 1 : 0);
        break;
      case 'cmpge':
        this.write(rc, a >= b ? 1 : 0);
        break;
      case 'cmplt':
        this.write(rc, a < b ? 1 : 0);
        break;
      case 'cmpgeu':
        this.write(rc, a >>> 0 >= b >>> 0 ? 1 : 0);
        break;
      case 'cmpltu':
        this.write(rc, a >>> 0 < b >>> 0 ? 1 : 0);
        break;
      case 'sll':
        this.write(rc, a << (b & 31));
        break;
      case 'srl':
        this.write(rc, a >>> (b & 31));
        break;
      case 'sra':
        this.write(rc, a >> (b & 31));
        break;
      case 'rol': {
        const s = b & 31;
        this.write(rc, s ? (a << s) | (a >>> (32 - s)) : a);
        break;
      }
      case 'ror': {
        const s = b & 31;
        this.write(rc, s ? (a >>> s) | (a << (32 - s)) : a);
        break;
      }
      case 'slli':
        this.write(rc, a << imm);
        break;
      case 'srli':
        this.write(rc, a >>> imm);
        break;
      case 'srai':
        this.write(rc, a >> imm);
        break;
      case 'roli':
        this.write(rc, imm ? (a << imm) | (a >>> (32 - imm)) : a);
        break;
      default:
        throw new Halt({ key: 'halt.illegal', args: { pc: hex8(pc), word: op } });
    }
    this.pc = next;
    return trap;
  }
}
