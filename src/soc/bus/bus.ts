// SoC bus routing and trace (Aşama 6e), after evo's SocBusStateInfo / SocBusState.
import { SocBusError, type SocTransaction } from './transaction';

/** A part that answers transactions in an address range (memory, PIO, VGA, ...) */
export interface SocSlave {
  /** Stable key of the part (its component id) */
  readonly key: string;
  /** Name shown in traces and the memory map */
  name(): string;
  /** Unsigned start address */
  startAddress(): number;
  /** Size of the range in bytes */
  sizeInBytes(): number;
  canHandle(t: SocTransaction): boolean;
  /** Performs the transaction; sets readData, responder and, on failure, error */
  handle(t: SocTransaction): void;
}

/** A part that watches every successful, visible transaction (e.g. a bus monitor) */
export interface SocSniffer {
  readonly key: string;
  sniff(t: SocTransaction): void;
}

/** Transactions kept per bus, as in evo */
export const TRACE_LIMIT = 10000;

/** Ring buffer of the last TRACE_LIMIT visible transactions of a bus */
export class SocBusTrace {
  private items: SocTransaction[] = [];
  private head = 0;
  /** Index of the oldest kept transaction since the last clear */
  private dropped = 0;
  private listeners = new Set<() => void>();
  private readonly limit: number;

  constructor(limit = TRACE_LIMIT) {
    this.limit = limit;
  }

  get size(): number {
    return this.items.length;
  }
  /** Running index of the first kept transaction (grows when old ones drop out) */
  get firstIndex(): number {
    return this.dropped;
  }

  add(t: SocTransaction): void {
    if (this.items.length < this.limit) this.items.push(t);
    else {
      this.items[this.head] = t;
      this.head = (this.head + 1) % this.limit;
      this.dropped++;
    }
    this.notify();
  }

  clear(): void {
    if (this.items.length === 0 && this.dropped === 0) return;
    this.items = [];
    this.head = 0;
    this.dropped = 0;
    this.notify();
  }

  /** i-th kept transaction, oldest first */
  get(i: number): SocTransaction | undefined {
    if (i < 0 || i >= this.items.length) return undefined;
    return this.items[(this.head + i) % this.items.length];
  }

  /** The newest n transactions, newest first, with their running indices */
  latest(n: number): { index: number; t: SocTransaction }[] {
    const out: { index: number; t: SocTransaction }[] = [];
    for (let k = 0; k < n && k < this.items.length; k++) {
      const i = this.items.length - 1 - k;
      out.push({ index: this.dropped + i, t: this.get(i)! });
    }
    return out;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}

export class SocBus {
  readonly id: string;
  /** Name of the bus part (label, or "SoC Bus@x,y"), updated by the part */
  name: string;
  readonly trace = new SocBusTrace();
  private slaves: SocSlave[] = [];
  private sniffers: SocSniffer[] = [];

  constructor(id: string, name = '') {
    this.id = id;
    this.name = name;
  }

  getSlaves(): readonly SocSlave[] {
    return this.slaves;
  }

  addSlave(s: SocSlave): void {
    this.slaves = this.slaves.filter((x) => x.key !== s.key);
    this.slaves.push(s);
  }
  removeSlave(key: string): void {
    this.slaves = this.slaves.filter((x) => x.key !== key);
  }
  addSniffer(s: SocSniffer): void {
    this.sniffers = this.sniffers.filter((x) => x.key !== s.key);
    this.sniffers.push(s);
  }
  removeSniffer(key: string): void {
    this.sniffers = this.sniffers.filter((x) => x.key !== key);
  }
  /** Replaces all slaves and sniffers */
  setMembers(slaves: readonly SocSlave[], sniffers: readonly SocSniffer[]): void {
    this.slaves = [...slaves];
    this.sniffers = [...sniffers];
  }

  /** Routes a transaction to the one slave that handles its address (evo's rules and error order) */
  transact(t: SocTransaction): void {
    if (this.slaves.length === 0) t.error = SocBusError.noSlaves;
    else if (t.isRead && t.isWrite && !t.isAtomic) t.error = SocBusError.nonAtomicReadWrite;
    else {
      let responder: SocSlave | null = null;
      let count = 0;
      for (const s of this.slaves) {
        if (s.canHandle(t)) {
          count++;
          responder = s;
        }
      }
      if (count === 0) t.error = SocBusError.noResponse;
      else if (count > 1) t.error = SocBusError.multipleSlaves;
      else responder!.handle(t);
    }
    if (t.hidden) return;
    if (!t.hasError) for (const s of this.sniffers) s.sniff(t);
    this.trace.add(t);
  }
}
