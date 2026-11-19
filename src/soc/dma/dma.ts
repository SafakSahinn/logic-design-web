// SoC DMA engine (Aşama 6h), after Logisim-evolution's SocDma / DmaState. The part is a slave on its control bus
// (six word registers) and a master on a source and a destination bus (each falls back to the control bus when not
// set). Registers (offsets from the word-aligned start address, word access only, 24 bytes):
//   0x00 SRC_ADDR    R/W   source address (the low two bits are cleared); ignored while busy
//   0x04 DST_ADDR    R/W   destination address (the low two bits are cleared); ignored while busy
//   0x08 LENGTH      R/W   transfer length in bytes (the low two bits are cleared); ignored while busy
//   0x0C CONTROL     R/W   bit 0 START (write 1 to start, reads 0), bit 1 IRQ_EN, bit 2 DST_FIXED, bit 3 SRC_FIXED
//   0x10 STATUS      R/W1C bit 0 BUSY (read-only), bit 1 DONE (writing 1 clears it and the interrupt)
//   0x14 BYTES_DONE  R     bytes moved so far (a write is a read-only error)
// On every rising clock edge while busy (and Reset low) the engine moves up to "burst size" words, word by word: a
// hidden word read from the source bus, then a visible word write to the destination bus (so a VGA sniffs it). A
// fixed address does not advance. When all bytes are moved, BUSY falls, DONE rises and, with IRQ_EN, the IRQ pin goes
// high until DONE is cleared.
//
// Kept as evo does, on purpose:
//   - a failed read or write ends the burst; the word is retried on the next clock, so a transfer whose address keeps
//     failing stays busy for ever (it can only be ended by Reset)
//   - LENGTH is a signed 32-bit number for START: a length of 2^31 bytes or more never starts
//   - CONTROL's IRQ_EN / fixed bits may be changed while busy; a burst uses the bits it started with
//   - a byte / half-word access is rejected before any state is touched; no register read has a side effect, so a
//     program listing's peek or another DMA's hidden read is safe
import type { SocSlave } from '../bus/bus';
import {
  READ_TRANSACTION,
  SocBusError,
  SocTransaction,
  WORD_ACCESS,
  WRITE_TRANSACTION,
} from '../bus/transaction';

export const DMA_REGISTER_SIZE = 0x18;
/** evo's burst size options (words a clock) */
export const DMA_BURST_SIZES: readonly number[] = [1, 2, 4, 8, 16, 32, 64, 128, 256];

export const DMA_REG = {
  srcAddr: 0x00,
  dstAddr: 0x04,
  length: 0x08,
  control: 0x0c,
  status: 0x10,
  bytesDone: 0x14,
} as const;

export const DMA_CTRL_START = 1 << 0;
export const DMA_CTRL_IRQ_EN = 1 << 1;
export const DMA_CTRL_DST_FIXED = 1 << 2;
export const DMA_CTRL_SRC_FIXED = 1 << 3;
export const DMA_STAT_BUSY = 1 << 0;
export const DMA_STAT_DONE = 1 << 1;
const CTRL_KEPT = DMA_CTRL_IRQ_EN | DMA_CTRL_DST_FIXED | DMA_CTRL_SRC_FIXED;

export interface SocDmaConfig {
  /** Unsigned, word-aligned address of the first register (evo clears the low two bits) */
  startAddress: number;
  /** Words moved per rising clock edge, one of DMA_BURST_SIZES */
  burstSize: number;
}

export const DMA_DEFAULT_CONFIG: Readonly<SocDmaConfig> = { startAddress: 0, burstSize: 16 };

/** A burst size from untrusted input as evo parses it: the first option not below it (above 256: 256) */
export function clampDmaBurstSize(v: unknown, fallback = DMA_DEFAULT_CONFIG.burstSize): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fallback;
  for (const b of DMA_BURST_SIZES) if (b >= v) return b;
  return DMA_BURST_SIZES[DMA_BURST_SIZES.length - 1];
}

/** Attributes from untrusted input (a file, an old state): missing or bad fields take the defaults */
export function normalizeDmaConfig(c: Partial<SocDmaConfig> | undefined): SocDmaConfig {
  const a = c?.startAddress;
  const start = typeof a === 'number' && Number.isFinite(a) ? ((Math.trunc(a) % 2 ** 32 >>> 0) & ~3) >>> 0 : DMA_DEFAULT_CONFIG.startAddress;
  return { startAddress: start, burstSize: clampDmaBurstSize(c?.burstSize) };
}

/** A pin level as the part sees it: true / false, or undefined for unknown / error / floating */
export type DmaLevel = boolean | undefined;

export interface DmaInputs {
  clock: DmaLevel;
  reset: DmaLevel;
}

/** Which master side a transaction of the engine goes out on */
export type DmaSide = 'src' | 'dst';

/**
 * Runs a transaction of the engine on the bus of `side` (the part resolves the source / destination bus, falling
 * back to the control bus). An unknown bus must set the transaction's error (SocManager.transact does).
 */
export type DmaTransact = (side: DmaSide, t: SocTransaction) => void;

/** The registers as the status view shows them */
export interface DmaRegisters {
  srcAddr: number;
  dstAddr: number;
  length: number;
  control: number;
  busy: boolean;
  done: boolean;
  bytesDone: number;
  irq: boolean;
}

/** Bus id one master side of the engine uses: its own (source / destination) bus, else the control bus; empty when neither is set */
export function dmaEffectiveBus(own: string, control: string): string {
  return own || control;
}

export class SocDma implements SocSlave {
  readonly key: string;
  private cfg: SocDmaConfig = { ...DMA_DEFAULT_CONFIG };
  private label: () => string;
  // evo's DmaRegState
  private srcAddr = 0;
  private dstAddr = 0;
  private length = 0;
  private control = 0;
  private busy = false;
  private done = false;
  private bytesDone = 0;
  private irqAsserted = false;
  private lastClock: DmaLevel = undefined;
  private ver = 0;

  constructor(key: string, config: Partial<SocDmaConfig>, name: () => string) {
    this.key = key;
    this.label = name;
    this.configure(config);
  }

  /** New attributes; the registers stay (evo keeps the instance state) */
  configure(config: Partial<SocDmaConfig>): void {
    this.cfg = normalizeDmaConfig(config);
  }

  get config(): Readonly<SocDmaConfig> {
    return this.cfg;
  }

  /** Simulation reset (a new evo instance state): clears the registers and forgets the clock history */
  reset(): void {
    this.clearRegisters();
    this.lastClock = undefined;
  }

  private clearRegisters(): void {
    this.srcAddr = 0;
    this.dstAddr = 0;
    this.length = 0;
    this.control = 0;
    this.busy = false;
    this.done = false;
    this.bytesDone = 0;
    this.irqAsserted = false;
    this.ver++;
  }

  private isClear(): boolean {
    return !(this.busy || this.done || this.irqAsserted || this.srcAddr || this.dstAddr || this.length || this.control || this.bytesDone);
  }

  /**
   * Grows on every register change, so a caller can tell whether anything changed. The part's body does not use it:
   * it is drawn from registers() each time the canvas renders.
   */
  get version(): number {
    return this.ver;
  }

  registers(): DmaRegisters {
    return {
      srcAddr: this.srcAddr,
      dstAddr: this.dstAddr,
      length: this.length,
      control: this.control,
      busy: this.busy,
      done: this.done,
      bytesDone: this.bytesDone,
      irq: this.irqAsserted,
    };
  }

  /** Level of the IRQ pin */
  get irq(): boolean {
    return this.irqAsserted;
  }

  /**
   * One evaluation of the pins (evo's propagate). Reset high clears the registers and holds IRQ low; a rising clock
   * edge while Reset is not high runs a burst through `transact` (null: no bus to use, nothing moves, as in evo).
   * Returns the IRQ level.
   */
  step(inp: DmaInputs, transact: DmaTransact | null): boolean {
    if (inp.reset === true) {
      if (!this.isClear()) this.clearRegisters();
      this.lastClock = inp.clock;
      return false;
    }
    if (this.lastClock === false && inp.clock === true && transact) this.burst(transact);
    this.lastClock = inp.clock;
    return this.irqAsserted;
  }

  /** evo's executeBurst: up to burstSize words, one hidden read and one visible write each */
  private burst(transact: DmaTransact): void {
    if (!this.busy) return;
    const ctrl = this.control;
    const remaining = this.length - this.bytesDone;
    const words = Math.min(this.cfg.burstSize, Math.floor(remaining / 4));
    let moved = 0;
    for (let i = 0; i < words; i++) {
      const offset = this.bytesDone + i * 4;
      const src = ctrl & DMA_CTRL_SRC_FIXED ? this.srcAddr : (this.srcAddr + offset) >>> 0;
      const read = new SocTransaction(READ_TRANSACTION, src, 0, WORD_ACCESS, this.name());
      read.hidden = true;
      transact('src', read);
      if (read.hasError) break;
      const dst = ctrl & DMA_CTRL_DST_FIXED ? this.dstAddr : (this.dstAddr + offset) >>> 0;
      const write = new SocTransaction(WRITE_TRANSACTION, dst, read.readData, WORD_ACCESS, this.name());
      transact('dst', write);
      if (write.hasError) break;
      moved++;
    }
    this.bytesDone += moved * 4;
    if (this.bytesDone >= this.length) {
      this.busy = false;
      this.done = true;
      if (this.control & DMA_CTRL_IRQ_EN) this.irqAsserted = true;
    }
    this.ver++;
  }

  // ---- slave (registers) ----

  name(): string {
    return this.label();
  }
  startAddress(): number {
    return this.cfg.startAddress;
  }
  sizeInBytes(): number {
    return DMA_REGISTER_SIZE;
  }

  canHandle(t: SocTransaction): boolean {
    return t.address >= this.cfg.startAddress && t.address < this.cfg.startAddress + DMA_REGISTER_SIZE;
  }

  handle(t: SocTransaction): void {
    if (!this.canHandle(t)) return;
    t.responder = this.name();
    if (t.access !== WORD_ACCESS) {
      t.error = SocBusError.accessTypeNotSupported;
      return;
    }
    switch (t.address - this.cfg.startAddress) {
      case DMA_REG.srcAddr:
        if (t.isRead) t.readData = this.srcAddr;
        if (t.isWrite && !this.busy) this.set(() => (this.srcAddr = (t.writeData & ~3) >>> 0));
        break;
      case DMA_REG.dstAddr:
        if (t.isRead) t.readData = this.dstAddr;
        if (t.isWrite && !this.busy) this.set(() => (this.dstAddr = (t.writeData & ~3) >>> 0));
        break;
      case DMA_REG.length:
        if (t.isRead) t.readData = this.length;
        if (t.isWrite && !this.busy) this.set(() => (this.length = (t.writeData & ~3) >>> 0));
        break;
      case DMA_REG.control:
        if (t.isRead) t.readData = this.control;
        if (t.isWrite) this.writeControl(t.writeData);
        break;
      case DMA_REG.status:
        if (t.isRead) t.readData = (this.busy ? DMA_STAT_BUSY : 0) | (this.done ? DMA_STAT_DONE : 0);
        if (t.isWrite && t.writeData & DMA_STAT_DONE) {
          this.set(() => {
            this.done = false;
            this.irqAsserted = false;
          });
        }
        break;
      case DMA_REG.bytesDone:
        if (t.isRead) t.readData = this.bytesDone;
        if (t.isWrite) t.error = SocBusError.readOnlyAccess;
        break;
      default:
        t.error = SocBusError.misalignedAddress;
    }
  }

  private set(fn: () => void): void {
    fn();
    this.ver++;
  }

  /** evo's control write: keeps IRQ_EN and the fixed bits; START begins a transfer when idle and LENGTH > 0 */
  private writeControl(data: number): void {
    this.control = data & CTRL_KEPT;
    // evo compares the signed int: a length of 2^31 or more does not start
    if (data & DMA_CTRL_START && !this.busy && (this.length | 0) > 0) {
      this.busy = true;
      this.done = false;
      this.bytesDone = 0;
      this.irqAsserted = false;
    }
    this.ver++;
  }
}
