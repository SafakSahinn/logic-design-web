// SoC memory slave (Aşama 6e), after evo's SocMemory / SocMemoryState: a sparse little-endian word store.
// Words never written read as random values, as in evo (and as real RAM after power-up).
import type { SocSlave } from '../bus/bus';
import { HALF_WORD_ACCESS, WORD_ACCESS, type SocTransaction } from '../bus/transaction';

/** Allowed address widths: the memory holds 2^n bytes (evo: MemSize 10..26) */
export const MEM_SIZE_MIN_BITS = 10;
export const MEM_SIZE_MAX_BITS = 26;
export const MEM_SIZE_DEFAULT_BITS = 10;

export interface SocMemoryConfig {
  /** Unsigned start address; rounded down to a word boundary */
  startAddress: number;
  /** log2 of the size in bytes, MEM_SIZE_MIN_BITS..MEM_SIZE_MAX_BITS */
  sizeBits: number;
}

export function clampMemSizeBits(bits: number): number {
  if (!Number.isFinite(bits)) return MEM_SIZE_DEFAULT_BITS;
  return Math.min(MEM_SIZE_MAX_BITS, Math.max(MEM_SIZE_MIN_BITS, Math.round(bits)));
}

/** Size text as evo draws it: "1kB" .. "64MB" */
export function memSizeText(bits: number): string {
  const size = 2 ** clampMemSizeBits(bits);
  return size >= 1048576 ? `${size / 1048576}MB` : `${size / 1024}kB`;
}

export class SocMemory implements SocSlave {
  readonly key: string;
  private start = 0;
  private bytes = 2 ** MEM_SIZE_DEFAULT_BITS;
  private words = new Map<number, number>();
  private label: () => string;
  private random: () => number;

  constructor(key: string, config: SocMemoryConfig, name: () => string, random: () => number = Math.random) {
    this.key = key;
    this.label = name;
    this.random = random;
    this.configure(config);
  }

  /** New address range; the contents stay (evo keeps them until the simulation is reset) */
  configure(config: SocMemoryConfig): void {
    this.start = (config.startAddress & ~3) >>> 0;
    this.bytes = 2 ** clampMemSizeBits(config.sizeBits);
  }

  name(): string {
    return this.label();
  }
  startAddress(): number {
    return this.start;
  }
  sizeInBytes(): number {
    return this.bytes;
  }

  /** Forgets all contents (simulation reset) */
  clear(): void {
    this.words.clear();
  }

  /** Number of words written so far */
  get writtenWords(): number {
    return this.words.size;
  }

  canHandle(t: SocTransaction): boolean {
    return t.address >= this.start && t.address < this.start + this.bytes;
  }

  handle(t: SocTransaction): void {
    if (!this.canHandle(t)) return;
    if (t.isRead) t.readData = this.read(t.address, t.access);
    if (t.isWrite) this.write(t.address, t.writeData, t.access);
    t.responder = this.name();
  }

  /** Whole word at an aligned address, or undefined when never written */
  peekWord(address: number): number | undefined {
    return this.words.get((address >>> 2) >>> 0);
  }

  private word(address: number): number {
    const index = (address >>> 2) >>> 0;
    const v = this.words.get(index);
    return v === undefined ? Math.floor(this.random() * 0x100000000) >>> 0 : v;
  }

  /** evo's lanes: half word by address bit 1, byte by address bits 1..0 (no alignment check here) */
  read(address: number, access: number): number {
    const value = this.word(address);
    if (access === WORD_ACCESS) return value;
    if (access === HALF_WORD_ACCESS) return ((address >>> 1) & 1 ? value >>> 16 : value) & 0xffff;
    return (value >>> ((address & 3) * 8)) & 0xff;
  }

  write(address: number, data: number, access: number): void {
    const index = (address >>> 2) >>> 0;
    if (access === WORD_ACCESS) {
      this.words.set(index, data >>> 0);
      return;
    }
    const old = this.word(address);
    let next: number;
    if (access === HALF_WORD_ACCESS) {
      next = (address >>> 1) & 1 ? (old & 0xffff) | ((data & 0xffff) << 16) : (old & 0xffff0000) | (data & 0xffff);
    } else {
      const shift = (address & 3) * 8;
      next = (old & ~(0xff << shift)) | ((data & 0xff) << shift);
    }
    this.words.set(index, next >>> 0);
  }
}
