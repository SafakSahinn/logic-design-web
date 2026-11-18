// Minimal single-context PLIC of the RV32IM part (Aşama 6f), after evo's Rv32imPlicState: a bus slave at the
// "PLIC base address" whose sources 1..n are the part's IRQ0..IRQn-1 pins (level-triggered). Registers (offsets as
// in the RISC-V PLIC layout; word access only):
//   0x001000 / 0x001004  pending (read-only)       0x002000 / 0x002004  enable
//   0x200000             threshold (non-zero masks all sources; there are no priorities)
//   0x200004             claim (read: lowest pending enabled source, 0 if none) / complete (write: source id)
import type { SocSlave } from '../bus/bus';
import { SocBusError, WORD_ACCESS, type SocTransaction } from '../bus/transaction';

export const PLIC_DEFAULT_BASE = 0x0c000000;
export const PLIC_SIZE = 0x00400000;
export const MAX_IRQS = 32;

const REG_PENDING_0 = 0x1000;
const REG_PENDING_1 = 0x1004;
const REG_ENABLE_0 = 0x2000;
const REG_ENABLE_1 = 0x2004;
const REG_THRESHOLD = 0x200000;
const REG_CLAIM = 0x200004;

export class Rv32imPlic implements SocSlave {
  readonly key: string;
  private base = PLIC_DEFAULT_BASE;
  private sources = 0;
  /** Bit i = source i (bit 0 unused), up to source 32 */
  private pending = 0n;
  private enable = 0n;
  private claimed = 0n;
  private threshold = 0;
  private label: () => string;

  constructor(key: string, name: () => string) {
    this.key = key;
    this.label = name;
  }

  /** Base address (word-aligned) and number of IRQ pins */
  configure(base: number, irqs: number): void {
    this.base = (base & ~3) >>> 0;
    this.sources = Math.max(0, Math.min(MAX_IRQS, Math.trunc(irqs) || 0));
    const mask = this.mask();
    this.pending &= mask;
    this.enable &= mask;
    this.claimed &= mask;
  }

  reset(): void {
    this.pending = 0n;
    this.enable = 0n;
    this.claimed = 0n;
    this.threshold = 0;
  }

  private mask(): bigint {
    return ((1n << BigInt(this.sources)) - 1n) << 1n;
  }

  /** Samples the IRQ pin levels (index 0 = IRQ0 = source 1) */
  updateIrqs(levels: readonly boolean[]): void {
    let level = 0n;
    for (let i = 0; i < this.sources; i++) if (levels[i]) level |= 1n << BigInt(i + 1);
    const claimedMask = this.claimed & this.mask();
    const unclaimed = level & ~claimedMask;
    // level-triggered: pending follows the line while it is not claimed
    this.pending = ((this.pending & (unclaimed | claimedMask)) | unclaimed) & ~claimedMask;
  }

  /** mip.MEIP */
  get interruptPending(): boolean {
    return this.threshold === 0 && (this.pending & this.enable & this.mask()) !== 0n;
  }

  private claimId(): number {
    if (this.threshold !== 0) return 0;
    const c = this.pending & this.enable & this.mask();
    for (let s = 1; s <= this.sources; s++) if ((c >> BigInt(s)) & 1n) return s;
    return 0;
  }

  name(): string {
    return this.label();
  }
  startAddress(): number {
    return this.base;
  }
  sizeInBytes(): number {
    return PLIC_SIZE;
  }

  canHandle(t: SocTransaction): boolean {
    return t.address >= this.base && t.address < this.base + PLIC_SIZE;
  }

  handle(t: SocTransaction): void {
    if (!this.canHandle(t)) return;
    t.responder = this.name();
    if (t.access !== WORD_ACCESS) {
      t.error = SocBusError.accessTypeNotSupported;
      return;
    }
    const word = (v: bigint, upper: boolean) => Number((upper ? v >> 32n : v) & 0xffffffffn);
    const put = (old: bigint, data: number, upper: boolean) =>
      (upper ? (old & 0xffffffffn) | (BigInt(data >>> 0) << 32n) : (old & ~0xffffffffn) | BigInt(data >>> 0)) & this.mask();
    switch (t.address - this.base) {
      case REG_PENDING_0:
      case REG_PENDING_1:
        if (t.isWrite) {
          t.error = SocBusError.readOnlyAccess;
          return;
        }
        t.readData = word(this.pending, t.address - this.base === REG_PENDING_1);
        return;
      case REG_ENABLE_0:
      case REG_ENABLE_1: {
        const upper = t.address - this.base === REG_ENABLE_1;
        if (t.isRead) t.readData = word(this.enable, upper);
        if (t.isWrite) this.enable = put(this.enable, t.writeData, upper);
        return;
      }
      case REG_THRESHOLD:
        if (t.isRead) t.readData = this.threshold >>> 0;
        if (t.isWrite) this.threshold = t.writeData >>> 0;
        return;
      case REG_CLAIM:
        if (t.isRead) {
          const id = this.claimId();
          if (id !== 0) {
            this.pending &= ~(1n << BigInt(id));
            this.claimed |= 1n << BigInt(id);
          }
          t.readData = id;
        }
        if (t.isWrite) {
          const id = t.writeData >>> 0;
          if (id >= 1 && id <= this.sources) this.claimed &= ~(1n << BigInt(id));
        }
        return;
      default:
        t.error = SocBusError.misalignedAddress; // evo's answer for an unmapped offset
    }
  }
}
