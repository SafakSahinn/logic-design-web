// SoC simulation manager (Aşama 6e), after evo's SocSimulationManager: one per circuit state. SoC parts are not
// wired to each other; a bus part owns an id and the other parts name that id in their "bus" attribute.
import { SocBus, type SocSlave, type SocSniffer } from './bus';
import { SocBusError, type SocTransaction } from './transaction';

/**
 * New bus id in evo's format: "0x" + 16 hex digits of the time in ms + an object hash in hex
 * (evo: String.format("0x%016X%s", date.getTime(), hash)). Unique enough for one project.
 */
export function newSocBusId(now = Date.now(), random: () => number = Math.random): string {
  const time = now.toString(16).toUpperCase().padStart(16, '0');
  const hash = Math.floor(random() * 0x7fffffff).toString(16);
  return `0x${time}${hash}`;
}

/** Evo's bus id shape (an empty id means "not connected") */
export function isSocBusId(id: string): boolean {
  return /^0x[0-9A-F]{16}[0-9a-f]+$/i.test(id) && id.length <= 64;
}

interface Attachment {
  busId: string;
  slave?: SocSlave;
  sniffer?: SocSniffer;
}

export class SocManager {
  private buses = new Map<string, { bus: SocBus; owner: string }>();
  /** Slaves/sniffers by part key, with the bus id they name (kept while that bus does not exist) */
  private attachments = new Map<string, Attachment>();
  private listeners = new Set<() => void>();

  /**
   * Registers the bus part `owner` with its id; keeps the existing bus (and its trace) when the id is known.
   * `bus` hands in the bus object to use (a host that keeps buses across circuits); it replaces another one of
   * that id, and the attached parts move to it.
   */
  registerBus(id: string, owner: string, name: string, bus?: SocBus): SocBus {
    let entry = this.buses.get(id);
    if (entry && (!bus || entry.bus === bus)) {
      if (entry.owner === owner && entry.bus.name === name) return entry.bus;
      entry.owner = owner;
      entry.bus.name = name;
    } else {
      const next = bus ?? new SocBus(id, name);
      next.name = name;
      entry = { bus: next, owner };
      this.buses.set(id, entry);
      // exactly the parts attached now: a handed-in bus object may still list parts that were detached while it
      // was not registered (and so could not be told)
      const slaves: SocSlave[] = [];
      const sniffers: SocSniffer[] = [];
      for (const a of this.attachments.values()) {
        if (a.busId !== id) continue;
        if (a.slave) slaves.push(a.slave);
        if (a.sniffer) sniffers.push(a.sniffer);
      }
      next.setMembers(slaves, sniffers);
    }
    this.notify();
    return entry.bus;
  }

  /** Removes the bus when `owner` still owns it; attached parts wait for a bus with that id again */
  removeBus(id: string, owner: string): void {
    const entry = this.buses.get(id);
    if (!entry || entry.owner !== owner) return;
    this.buses.delete(id);
    this.notify();
  }

  getBus(id: string): SocBus | undefined {
    return this.buses.get(id)?.bus;
  }

  /** All buses, for the bus selector (name = label or "SoC Bus@x,y"), with the part that owns each */
  listBuses(): { id: string; name: string; owner: string }[] {
    return [...this.buses.values()].map((e) => ({ id: e.bus.id, name: e.bus.name, owner: e.owner }));
  }

  /** Attaches (or moves) a slave to the bus `busId`; an empty id detaches it */
  attachSlave(busId: string, slave: SocSlave): void {
    this.attach(slave.key, { busId, slave });
  }

  attachSniffer(busId: string, sniffer: SocSniffer): void {
    this.attach(sniffer.key, { busId, sniffer });
  }

  /** Removes a part's slave/sniffer attachment */
  detach(key: string): void {
    const old = this.attachments.get(key);
    if (!old) return;
    this.disconnect(key, old);
    this.attachments.delete(key);
    this.notify();
  }

  /** The bus id a part is attached to and whether that bus exists ("connected" in evo's green/red bar) */
  attachmentOf(key: string): { busId: string; connected: boolean } | null {
    const a = this.attachments.get(key);
    return a ? { busId: a.busId, connected: this.buses.has(a.busId) } : null;
  }

  /** Starts a transaction from a master on the bus `busId` (evo: initializeTransaction) */
  transact(busId: string, t: SocTransaction): void {
    const bus = this.buses.get(busId)?.bus;
    if (!bus) {
      t.error = SocBusError.noBusConnected;
      return;
    }
    bus.transact(t);
  }

  /** Clears all traces (simulation reset) */
  clearTraces(): void {
    for (const { bus } of this.buses.values()) bus.trace.clear();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private attach(key: string, a: Attachment): void {
    const old = this.attachments.get(key);
    if (old && old.busId === a.busId && old.slave === a.slave && old.sniffer === a.sniffer) return;
    if (old) this.disconnect(key, old);
    if (!a.busId) {
      this.attachments.delete(key);
    } else {
      this.attachments.set(key, a);
      const entry = this.buses.get(a.busId);
      if (entry) this.connect(entry.bus, a);
    }
    this.notify();
  }

  private connect(bus: SocBus, a: Attachment): void {
    if (a.slave) bus.addSlave(a.slave);
    if (a.sniffer) bus.addSniffer(a.sniffer);
  }

  private disconnect(key: string, a: Attachment): void {
    const bus = this.buses.get(a.busId)?.bus;
    if (!bus) return;
    if (a.slave) bus.removeSlave(key);
    if (a.sniffer) bus.removeSniffer(key);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }
}
