// SoC JTAG UART slave (Aşama 6h), after Logisim-evolution's JtagUart / JtagUartState (an Altera/Intel Avalon JTAG
// UART). Registers (offsets from the start address, word access only, 8 bytes):
//   0x00 data     read: pops one character of the read FIFO: bits 7:0 data, bit 15 RVALID, bits 31:16 RAVAIL (the
//                 characters left after this one); an empty FIFO reads 0. write: bits 7:0 are queued in the write
//                 FIFO (dropped when it is full)
//   0x04 control  bit 0 RE / bit 1 WE (interrupt enables, read-write), bit 8 RI / bit 9 WI (pending, read-only),
//                 bit 10 AC (set by activity, cleared by writing 1), bits 31:16 WSPACE (free write FIFO places)
// The two FIFOs are emptied / filled on the rising clock edges by the part, through the pins of a keyboard and a TTY
// (step()): one character a clock each way, as evo does. A read of the data register pops the read FIFO; a byte or
// half-word access (a program listing's peek) is rejected before any state is touched, as in evo.
import type { SocSlave } from '../bus/bus';
import { SocBusError, WORD_ACCESS, type SocTransaction } from '../bus/transaction';

export const JTAG_UART_SIZE = 8;
/** evo's FIFO size options ("WriteFifoSize" / "ReadFifoSize") */
export const JTAG_UART_FIFO_SIZES: readonly number[] = [8, 16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

const REG_DATA = 0x0;
const REG_CONTROL = 0x4;

const CTRL_RE = 1 << 0;
const CTRL_WE = 1 << 1;
const CTRL_RI = 1 << 8;
const CTRL_WI = 1 << 9;
const CTRL_AC = 1 << 10;
const DATA_RVALID = 1 << 15;

export interface SocJtagUartConfig {
  /** Unsigned start address (evo does not align it) */
  startAddress: number;
  /** Places of the write FIFO (program -> TTY), one of JTAG_UART_FIFO_SIZES */
  writeFifoSize: number;
  /** Places of the read FIFO (keyboard -> program), one of JTAG_UART_FIFO_SIZES */
  readFifoSize: number;
  /** WI is pending (with WE) while the write FIFO holds at most this many characters */
  writeThreshold: number;
  /** RI is pending (with RE) while the read FIFO has at most this many free places */
  readThreshold: number;
}

export const JTAG_UART_DEFAULT_CONFIG: Readonly<SocJtagUartConfig> = {
  startAddress: 0,
  writeFifoSize: 64,
  readFifoSize: 64,
  writeThreshold: 8,
  readThreshold: 8,
};

/** A FIFO size from untrusted input: one of evo's options, else the default */
export const clampJtagUartFifoSize = (v: unknown, fallback = 64): number =>
  typeof v === 'number' && JTAG_UART_FIFO_SIZES.includes(v) ? v : fallback;

/** Attributes from untrusted input (a file, an old state): missing or bad fields take the defaults */
export function normalizeJtagUartConfig(c: Partial<SocJtagUartConfig> | undefined): SocJtagUartConfig {
  const d = JTAG_UART_DEFAULT_CONFIG;
  const addr = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v % 2 ** 32 >>> 0 : d.startAddress);
  // evo's thresholds are plain (signed 32-bit) integers
  const int = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) | 0 : fallback);
  return {
    startAddress: addr(c?.startAddress),
    writeFifoSize: clampJtagUartFifoSize(c?.writeFifoSize, d.writeFifoSize),
    readFifoSize: clampJtagUartFifoSize(c?.readFifoSize, d.readFifoSize),
    writeThreshold: int(c?.writeThreshold, d.writeThreshold),
    readThreshold: int(c?.readThreshold, d.readThreshold),
  };
}

/** A pin level as the part sees it: true / false, or undefined for unknown / error / floating */
export type JtagUartLevel = boolean | undefined;

/** Inputs of one step: the clock and reset pins and the keyboard's "available" and 7-bit data pins */
export interface JtagUartInputs {
  clock: JtagUartLevel;
  reset: JtagUartLevel;
  /** Keyboard "available" */
  available: JtagUartLevel;
  /** Keyboard data (7 bits); undefined when not fully known */
  data: number | undefined;
}

/** Levels the part drives on its output pins */
export interface JtagUartOutputs {
  irq: boolean;
  /** Keyboard "read enable": takes the character shown on the data pins */
  readEnable: boolean;
  /** Keyboard "clear" */
  clearKeyboard: boolean;
  /** TTY data (7 bits) */
  ttyData: number;
  /** TTY "write": writes ttyData on the clock edge */
  write: boolean;
  /** TTY "clear" */
  clearTty: boolean;
}

/** A queue of characters with an O(1) pop (the FIFOs hold up to 32768 entries) */
class CharQueue {
  private items: number[] = [];
  private head = 0;

  get size(): number {
    return this.items.length - this.head;
  }
  push(v: number): void {
    this.items.push(v);
  }
  /** Removes and returns the oldest entry (the queue must not be empty) */
  pop(): number {
    const v = this.items[this.head++];
    if (this.head > 1024 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return v;
  }
  toArray(): number[] {
    return this.items.slice(this.head);
  }
  clear(): void {
    this.items = [];
    this.head = 0;
  }
}

const RESET_OUTPUTS: Readonly<JtagUartOutputs> = {
  irq: false,
  readEnable: false,
  clearKeyboard: false,
  ttyData: 0,
  write: false,
  clearTty: false,
};

export class SocJtagUart implements SocSlave {
  readonly key: string;
  private cfg: SocJtagUartConfig = { ...JTAG_UART_DEFAULT_CONFIG };
  private label: () => string;
  // evo's JtagUartFifoState
  private writeFifo = new CharQueue();
  private readFifo = new CharQueue();
  private readIrqEnable = false;
  private writeIrqEnable = false;
  private acBit = false;
  private lastReset: JtagUartLevel = undefined;
  /** No evaluation since construction / reset() yet: the first one starts with the reset output levels */
  private fresh = true;
  private lastClock: JtagUartLevel = undefined;
  private out: JtagUartOutputs = { ...RESET_OUTPUTS };
  private sentCount = 0;

  constructor(key: string, config: Partial<SocJtagUartConfig>, name: () => string) {
    this.key = key;
    this.label = name;
    this.configure(config);
  }

  /** New attributes; the FIFO contents stay (evo reads the sizes when it queues the next character) */
  configure(config: Partial<SocJtagUartConfig>): void {
    this.cfg = normalizeJtagUartConfig(config);
  }

  get config(): Readonly<SocJtagUartConfig> {
    return this.cfg;
  }

  /**
   * Simulation reset (a new epoch): empties the FIFOs and clears the enables / AC (evo's reset()), and forgets the
   * pin history and output levels, as a new evo instance state does
   */
  reset(): void {
    this.clearRegisters();
    this.lastReset = undefined;
    this.fresh = true;
    this.lastClock = undefined;
    this.out = { ...RESET_OUTPUTS };
  }

  private clearRegisters(): void {
    this.writeFifo.clear();
    this.readFifo.clear();
    this.readIrqEnable = false;
    this.writeIrqEnable = false;
    this.acBit = false;
  }

  /**
   * One evaluation of the pins (evo's handleOperations). A rising reset edge clears the registers and pulses the
   * keyboard / TTY "clear" outputs until reset falls. On a rising clock edge while reset is low: IRQ shows the
   * pending interrupts, one character of the write FIFO goes to the TTY, and an available keyboard character is
   * queued in the read FIFO (read enable alternates, so a held "available" is taken every other clock).
   */
  step(inp: JtagUartInputs): JtagUartOutputs {
    const doReset = (this.lastReset === false || (this.lastReset === undefined && !this.fresh)) && inp.reset === true;
    // evo also ends a reset after every evaluation whose previous reset level was unknown, so with Reset left open
    // it forced the outputs low between clock edges (the keyboard / TTY handshake never completed). Here an open
    // Reset reads as low: only the very first evaluation and a falling reset edge restore the reset levels.
    const endReset = this.fresh || (this.lastReset === true && inp.reset === false);
    this.fresh = false;
    this.lastReset = inp.reset;
    if (doReset) {
      this.out = { ...RESET_OUTPUTS, clearKeyboard: true, clearTty: true };
      this.clearRegisters();
    }
    if (endReset) this.out = { ...RESET_OUTPUTS };
    if (inp.reset === true) return this.outputs();
    const last = this.lastClock;
    this.lastClock = inp.clock;
    if (last === false && inp.clock === true) {
      const next = { ...this.out };
      next.irq = this.irqPending();
      if (this.writeFifo.size === 0) next.write = false;
      else {
        next.ttyData = this.writeFifo.pop() & 0x7f;
        this.sentCount++;
        this.acBit = true;
        next.write = true;
      }
      if (inp.available === true && !this.out.readEnable) {
        this.acBit = true;
        // evo: toLongValue() of a not fully known value is -1, which reads back as 0xFF
        this.pushRead(inp.data === undefined ? 0xff : inp.data & 0x7f);
        next.readEnable = true;
      } else next.readEnable = false;
      this.out = next;
    }
    return this.outputs();
  }

  /** Number of characters put on the TTY pins so far (a step that sends one adds 1; a terminal compares it) */
  get transmitted(): number {
    return this.sentCount;
  }

  /** The output pin levels set by the last step() */
  outputs(): JtagUartOutputs {
    return { ...this.out };
  }

  private pushRead(v: number): void {
    if (this.readFifo.size < this.cfg.readFifoSize) this.readFifo.push(v);
  }

  /**
   * Queues a character in the read FIFO directly (a terminal attached to the part instead of keyboard pins); false
   * when the FIFO is full
   */
  receive(char: number): boolean {
    if (this.readFifo.size >= this.cfg.readFifoSize) return false;
    this.acBit = true;
    this.readFifo.push(char & 0xff);
    return true;
  }

  private readIrqPending(): boolean {
    return this.readIrqEnable && this.cfg.readFifoSize - this.readFifo.size <= this.cfg.readThreshold;
  }

  private writeIrqPending(): boolean {
    return this.writeIrqEnable && this.writeFifo.size <= this.cfg.writeThreshold;
  }

  /** Interrupt condition now (the IRQ pin follows it on the next rising clock edge) */
  irqPending(): boolean {
    return this.readIrqPending() || this.writeIrqPending();
  }

  /** The control register as a read returns it (no side effects) */
  controlValue(): number {
    let v = 0;
    if (this.readIrqEnable) v |= CTRL_RE;
    if (this.writeIrqEnable) v |= CTRL_WE;
    if (this.readIrqPending()) v |= CTRL_RI;
    if (this.writeIrqPending()) v |= CTRL_WI;
    if (this.acBit) v |= CTRL_AC;
    v |= ((this.cfg.writeFifoSize - this.writeFifo.size) & 0xffff) << 16;
    return v >>> 0;
  }

  /** FIFO fill levels and contents, oldest first (status view) */
  fifos(): { read: number[]; write: number[] } {
    return { read: this.readFifo.toArray(), write: this.writeFifo.toArray() };
  }

  name(): string {
    return this.label();
  }
  startAddress(): number {
    return this.cfg.startAddress;
  }
  sizeInBytes(): number {
    return JTAG_UART_SIZE;
  }

  canHandle(t: SocTransaction): boolean {
    return t.address >= this.cfg.startAddress && t.address < this.cfg.startAddress + JTAG_UART_SIZE;
  }

  handle(t: SocTransaction): void {
    if (!this.canHandle(t)) return;
    t.responder = this.name();
    if (t.access !== WORD_ACCESS) {
      t.error = SocBusError.accessTypeNotSupported;
      return;
    }
    switch (t.address - this.cfg.startAddress) {
      case REG_DATA:
        if (t.isRead) t.readData = this.popData();
        if (t.isWrite && this.writeFifo.size < this.cfg.writeFifoSize) this.writeFifo.push(t.writeData & 0xff);
        return;
      case REG_CONTROL:
        if (t.isRead) t.readData = this.controlValue();
        if (t.isWrite) {
          this.readIrqEnable = (t.writeData & CTRL_RE) !== 0;
          this.writeIrqEnable = (t.writeData & CTRL_WE) !== 0;
          if (t.writeData & CTRL_AC) this.acBit = false;
        }
        return;
      default:
        t.error = SocBusError.misalignedAddress;
    }
  }

  /** evo's readDataRegister */
  private popData(): number {
    if (this.readFifo.size === 0) return 0;
    const ch = this.readFifo.pop() & 0xff;
    return (ch | DATA_RVALID | ((this.readFifo.size & 0xffff) << 16)) >>> 0;
  }
}
