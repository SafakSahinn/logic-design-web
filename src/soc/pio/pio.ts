// SoC PIO slave (Aşama 6h), after Logisim-evolution's SocPio / PioState (an Altera/Intel Avalon PIO). Registers
// (offsets from the start address, word access only, 24 bytes):
//   0x00 data       read: input pins (not for output-only)   write: output register (not for input-only)
//   0x04 direction  bidirectional ports only: bit i = 1 drives pin i
//   0x08 irq mask   only when the inputs generate an interrupt
//   0x0C edge capt. only with synchronous capture: read the captured edges, write clears them (all, or the bits
//                   written as 1 with "bit clearing")
//   0x10 outset / 0x14 outclear   only with "individual output bits": set / clear the bits written as 1
// The part feeds the pin levels in (sampleInputs) and drives outputs()/irq() back to the pins. Reads have no side
// effects, so hidden reads (program listings) are safe.
import type { SocSlave } from '../bus/bus';
import { SocBusError, WORD_ACCESS, type SocTransaction } from '../bus/transaction';

export const PIO_SIZE = 24;
export const PIO_MIN_WIDTH = 1;
export const PIO_MAX_WIDTH = 32;

/** evo's option values ("direction"): bidir, inputonly, outputonly, inout */
export type PioDirection = 'bidir' | 'inputonly' | 'outputonly' | 'inout';
export const PIO_DIRECTIONS: readonly PioDirection[] = ['bidir', 'inputonly', 'outputonly', 'inout'];
/** evo's "capturetype" values */
export type PioCaptureEdge = 'rising' | 'falling' | 'any';
export const PIO_CAPTURE_EDGES: readonly PioCaptureEdge[] = ['rising', 'falling', 'any'];
/** evo's "irqtype" values */
export type PioIrqType = 'level' | 'edge';
export const PIO_IRQ_TYPES: readonly PioIrqType[] = ['level', 'edge'];

const REG_DATA = 0x0;
const REG_DIRECTION = 0x4;
const REG_IRQ_MASK = 0x8;
const REG_EDGE_CAPTURE = 0xc;
const REG_OUT_SET = 0x10;
const REG_OUT_CLEAR = 0x14;

export interface SocPioConfig {
  /** Unsigned start address (evo does not align it) */
  startAddress: number;
  /** Number of I/O bits, PIO_MIN_WIDTH..PIO_MAX_WIDTH */
  width: number;
  direction: PioDirection;
  /** Output register value after a reset ("outputresetvalue") */
  outputResetValue: number;
  /** Outset / outclear registers ("outputbitsetclear") */
  outputBitOps: boolean;
  /** Edge capture register ("inputssynccapt") */
  syncCapture: boolean;
  captureEdge: PioCaptureEdge;
  /** Writing the edge capture register clears only the bits written as 1 ("inputscaptbit") */
  captureBitClear: boolean;
  /** IRQ output ("genirq") */
  genIrq: boolean;
  irqType: PioIrqType;
}

export const PIO_DEFAULT_CONFIG: Readonly<SocPioConfig> = {
  startAddress: 0,
  width: 1,
  direction: 'inputonly',
  outputResetValue: 0,
  outputBitOps: false,
  syncCapture: false,
  captureEdge: 'rising',
  captureBitClear: false,
  genIrq: false,
  irqType: 'level',
};

export const clampPioWidth = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(PIO_MAX_WIDTH, Math.max(PIO_MIN_WIDTH, Math.round(n))) : PIO_MIN_WIDTH;

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

/** A complete, valid configuration from a partial / untrusted one */
export function normalizePioConfig(c: Partial<SocPioConfig> | undefined): SocPioConfig {
  const d = PIO_DEFAULT_CONFIG;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v % 2 ** 32 >>> 0 : fallback);
  return {
    startAddress: num(c?.startAddress, d.startAddress),
    width: clampPioWidth(c?.width ?? d.width),
    direction: pick(c?.direction, PIO_DIRECTIONS, d.direction),
    outputResetValue: num(c?.outputResetValue, d.outputResetValue),
    outputBitOps: typeof c?.outputBitOps === 'boolean' ? c.outputBitOps : d.outputBitOps,
    syncCapture: typeof c?.syncCapture === 'boolean' ? c.syncCapture : d.syncCapture,
    captureEdge: pick(c?.captureEdge, PIO_CAPTURE_EDGES, d.captureEdge),
    captureBitClear: typeof c?.captureBitClear === 'boolean' ? c.captureBitClear : d.captureBitClear,
    genIrq: typeof c?.genIrq === 'boolean' ? c.genIrq : d.genIrq,
    irqType: pick(c?.irqType, PIO_IRQ_TYPES, d.irqType),
  };
}

/** Which pin groups a direction has (evo's port layout) */
export const pioHasInputs = (d: PioDirection): boolean => d === 'inputonly' || d === 'inout';
export const pioHasOutputs = (d: PioDirection): boolean => d !== 'inputonly';
/** evo's inputGeneratesIrq(): never for output-only ports */
export const pioGeneratesIrq = (c: Pick<SocPioConfig, 'genIrq' | 'direction'>): boolean => c.genIrq && c.direction !== 'outputonly';
/**
 * evo's getIrqType(): edge only with synchronous capture (the attribute is hidden otherwise). evo's simulation reads
 * the raw attribute instead, so a hidden 'edge' never fires there; but evo does not save a hidden attribute, so after
 * reopening the file it is 'level' anyway. LDS runs what the attributes show.
 */
export const pioEffectiveIrqType = (c: Pick<SocPioConfig, 'genIrq' | 'direction' | 'syncCapture' | 'irqType'>): PioIrqType =>
  pioGeneratesIrq(c) && c.syncCapture ? c.irqType : 'level';

export class SocPio implements SocSlave {
  readonly key: string;
  private cfg: SocPioConfig = { ...PIO_DEFAULT_CONFIG };
  private label: () => string;
  // registers (evo's PioRegState)
  private outputReg = 0;
  private captureReg = 0;
  private directionReg = 0;
  private irqMask = 0;
  private inputs = 0;
  private inputsValid = false;

  constructor(key: string, config: Partial<SocPioConfig>, name: () => string) {
    this.key = key;
    this.label = name;
    this.configure(config);
    this.reset();
  }

  /**
   * New attributes; the registers stay (evo: the output reset value is used at the next reset). The sampled inputs
   * and captured edges are cut to the new width, so a narrower port sees no edges on pins it no longer has.
   */
  configure(config: Partial<SocPioConfig>): void {
    this.cfg = normalizePioConfig(config);
    this.inputs = (this.inputs & this.widthMask) >>> 0;
    this.captureReg = (this.captureReg & this.widthMask) >>> 0;
  }

  get config(): Readonly<SocPioConfig> {
    return this.cfg;
  }

  /** evo's PioRegState.reset */
  reset(): void {
    this.outputReg = this.cfg.outputResetValue >>> 0;
    this.captureReg = 0;
    this.directionReg = 0;
    this.irqMask = 0;
    this.inputs = 0;
    this.inputsValid = false;
  }

  private get widthMask(): number {
    return this.cfg.width >= 32 ? 0xffffffff : (1 << this.cfg.width) - 1;
  }

  /** evo's inputGeneratesIrq() */
  get generatesIrq(): boolean {
    return pioGeneratesIrq(this.cfg);
  }

  /** See pioEffectiveIrqType */
  get effectiveIrqType(): PioIrqType {
    return pioEffectiveIrqType(this.cfg);
  }

  /**
   * Samples the input pin levels (bit i = pin i; for bidirectional ports the pin's wire): updates the edge capture
   * register on a change, as evo's propagate does
   */
  sampleInputs(levels: number): void {
    const next = (levels & this.widthMask) >>> 0;
    if (this.inputsValid && next === this.inputs) return;
    if (this.inputsValid && this.cfg.syncCapture) {
      const rose = ~this.inputs & next;
      const fell = this.inputs & ~next;
      const edges = this.cfg.captureEdge === 'any' ? rose | fell : this.cfg.captureEdge === 'rising' ? rose : fell;
      if (edges) this.captureReg = (this.captureReg | edges) >>> 0;
    }
    this.inputsValid = true;
    this.inputs = next;
  }

  /** Last sampled input levels */
  get inputLevels(): number {
    return this.inputs;
  }

  /** IRQ output level: level = inputs & mask, edge = captured edges & mask */
  irq(): boolean {
    if (!this.generatesIrq) return false;
    const source = this.effectiveIrqType === 'level' ? this.inputs : this.captureReg;
    return (source & this.irqMask & this.widthMask) !== 0;
  }

  /**
   * Output pin values and which pins are driven (bit i = pin i): every output pin is driven, except bidirectional
   * pins whose direction bit is 0. Input-only ports drive nothing.
   */
  outputs(): { value: number; driven: number } {
    if (!pioHasOutputs(this.cfg.direction)) return { value: 0, driven: 0 };
    const m = this.widthMask;
    const driven = this.cfg.direction === 'bidir' ? this.directionReg & m : m;
    return { value: (this.outputReg & m) >>> 0, driven: driven >>> 0 };
  }

  /** Register values for a status view, cut to the port width (the bus reads return the full registers) */
  registers(): { output: number; capture: number; direction: number; irqMask: number } {
    const m = this.widthMask;
    const cut = (v: number) => (v & m) >>> 0;
    return { output: cut(this.outputReg), capture: cut(this.captureReg), direction: cut(this.directionReg), irqMask: cut(this.irqMask) };
  }

  name(): string {
    return this.label();
  }
  startAddress(): number {
    return this.cfg.startAddress;
  }
  sizeInBytes(): number {
    return PIO_SIZE;
  }

  canHandle(t: SocTransaction): boolean {
    return t.address >= this.cfg.startAddress && t.address < this.cfg.startAddress + PIO_SIZE;
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
        if (t.isWrite) this.writeData(t);
        if (t.isRead) this.readData(t);
        return;
      case REG_DIRECTION:
        return this.directionRegister(t);
      case REG_IRQ_MASK:
        return this.irqMaskRegister(t);
      case REG_EDGE_CAPTURE:
        return this.captureRegister(t);
      case REG_OUT_SET:
        return this.bitOperation(t, false);
      case REG_OUT_CLEAR:
        return this.bitOperation(t, true);
      default:
        t.error = SocBusError.misalignedAddress;
    }
  }

  private writeData(t: SocTransaction): void {
    if (this.cfg.direction === 'inputonly') {
      t.error = SocBusError.readOnlyAccess;
      return;
    }
    this.outputReg = t.writeData >>> 0;
  }

  private readData(t: SocTransaction): void {
    if (this.cfg.direction === 'outputonly') t.error = SocBusError.writeOnlyAccess;
    else t.readData = this.inputs;
  }

  private directionRegister(t: SocTransaction): void {
    if (this.cfg.direction !== 'bidir') {
      t.error = SocBusError.registerDoesNotExist;
      return;
    }
    if (t.isRead) t.readData = this.directionReg;
    if (t.isWrite) {
      this.directionReg = t.writeData >>> 0;
    }
  }

  private irqMaskRegister(t: SocTransaction): void {
    if (!this.generatesIrq) {
      t.error = SocBusError.registerDoesNotExist;
      return;
    }
    // evo: a read (also an atomic one) only reads
    if (t.isRead) t.readData = this.irqMask;
    else {
      this.irqMask = t.writeData >>> 0;
    }
  }

  private captureRegister(t: SocTransaction): void {
    if (!this.cfg.syncCapture) {
      t.error = SocBusError.registerDoesNotExist;
      return;
    }
    if (t.isRead) t.readData = this.captureReg;
    if (t.isWrite) {
      this.captureReg = this.cfg.captureBitClear ? (this.captureReg & ~t.writeData) >>> 0 : 0;
    }
  }

  private bitOperation(t: SocTransaction, clear: boolean): void {
    if (!this.cfg.outputBitOps) {
      t.error = SocBusError.registerDoesNotExist;
      return;
    }
    // evo flags a read but still applies the (atomic) write data; a plain read writes 0 = no change
    if (t.isRead) t.error = SocBusError.writeOnlyAccess;
    if (!t.isWrite) return;
    this.outputReg = (clear ? this.outputReg & ~t.writeData : this.outputReg | t.writeData) >>> 0;
  }
}
