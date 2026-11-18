// Run-time side of the SoC parts (Aşama 6e): the one SocManager of the canvas and the bus / memory objects behind
// the parts.
//
// SoC parts are not wired to each other (evo): a bus part owns an id and the other parts name it. What a part keeps
// in comp.state is only its attributes; its bus trace and memory contents live here, outside the circuit, keyed by
// the bus id / component id (as the TCL Generic keeps its interpreters). Each top-level simulation run hands the
// parts of the circuit to the parts' syncRun() hooks, which bring the manager in line: new parts are registered,
// deleted ones dropped. The objects themselves stay in the caches below, so a run of another circuit (an IC being
// built) only changes the manager's membership until the canvas runs again, and no trace or memory contents are
// lost on the way. Known gap: a test-vector run resets its copy of the circuit (resetState bumps the epoch), and as
// the objects are shared by id, that clears the canvas's trace and memory contents too.
import { SocBus, SocManager, SocMemory, type SocMemoryConfig, type SocSlave } from '../../soc';
import type { PartAttrOption } from '../registry';

/** The manager of the circuit on the canvas */
export const socManager = new SocManager();

/** Objects kept per cache; the oldest that the manager does not use are dropped beyond this */
const CACHE_LIMIT = 256;

/** Run state of an object: `epoch` is the part's reset counter; a new epoch clears the trace / contents */
interface Cached<T> {
  obj: T;
  epoch: number;
}

const buses = new Map<string, Cached<SocBus>>();

/** Drops the oldest entries not in use until the cache holds at most `limit` (the SoC parts' run-time caches) */
export function trim<T>(cache: Map<string, T>, inUse: (key: string) => boolean, limit = CACHE_LIMIT): void {
  if (cache.size <= limit) return;
  for (const key of cache.keys()) {
    if (cache.size <= limit) return;
    if (!inUse(key)) cache.delete(key);
  }
}

/** The bus object of an id, created on first use; a new epoch clears its trace (simulation reset) */
export function socBusObject(id: string, epoch = 0): SocBus {
  let hit = buses.get(id);
  if (!hit) {
    hit = { obj: new SocBus(id), epoch };
    buses.set(id, hit);
    trim(buses, (key) => socManager.getBus(key) !== undefined || key === id);
  } else if (hit.epoch !== epoch) {
    hit.obj.trace.clear();
    hit.epoch = epoch;
  }
  return hit.obj;
}

/** The bus object of an id when one exists (for drawing; never creates one) */
export function peekSocBus(id: string): SocBus | undefined {
  return buses.get(id)?.obj;
}

export interface SocBusEntry {
  /** The bus id the part owns */
  id: string;
  /** Component id of the bus part */
  owner: string;
  /** Shown in traces, the bus selector and the slaves' bar */
  name: string;
  epoch: number;
}

/** Makes the manager's buses exactly these (the first part wins when two parts carry the same id) */
export function syncSocBuses(entries: readonly SocBusEntry[]): void {
  const keep = new Set<string>();
  for (const e of entries) {
    if (keep.has(e.id)) continue;
    keep.add(e.id);
    socManager.registerBus(e.id, e.owner, e.name, socBusObject(e.id, e.epoch));
  }
  for (const b of socManager.listBuses()) if (!keep.has(b.id)) socManager.removeBus(b.id, b.owner);
}

/** What a slave part's syncRun() hands to its cache (one entry per component) */
export interface SocSlaveEntry<C> {
  /** Component id */
  key: string;
  /** The bus it is attached to ('' = none) */
  busId: string;
  name: string;
  config: C;
  epoch: number;
}

/** How a slave cache makes and updates its objects */
export interface SocSlaveSpec<T extends SocSlave, C> {
  /** A new object; `name` reads the part's current name (it changes with the label) */
  create(key: string, config: C, name: () => string): T;
  /** New attributes (only called when the config differs from the last one, field by field) */
  configure(obj: T, config: C): void;
  /** Simulation reset (a new epoch) */
  reset(obj: T): void;
}

interface SlaveRuntime<T, C> {
  obj: T;
  name: string;
  epoch: number;
  config: C;
}

/** Field-by-field comparison of two flat configs */
function sameConfig<C extends object>(a: C, b: C): boolean {
  const ka = Object.keys(a) as (keyof C)[];
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

/**
 * The run-time objects of one kind of SoC slave part (memory, PIO, ...), keyed by component id and kept outside the
 * circuit: created on first use, reconfigured when the attributes change, reset on a new epoch, and attached to /
 * detached from the manager's buses by sync(). The oldest objects not attached are dropped beyond CACHE_LIMIT.
 */
export class SocSlaveCache<T extends SocSlave, C extends object> {
  private readonly objects = new Map<string, SlaveRuntime<T, C>>();
  /** Keys this cache attached to the manager (other kinds of slaves keep their own) */
  private readonly attached = new Set<string>();
  private readonly spec: SocSlaveSpec<T, C>;

  constructor(spec: SocSlaveSpec<T, C>) {
    this.spec = spec;
  }

  /** The object of a part, created on first use; new attributes keep its state, a new epoch resets it */
  object(e: Omit<SocSlaveEntry<C>, 'busId'>): T {
    let rt = this.objects.get(e.key);
    if (!rt) {
      const holder = { name: e.name, epoch: e.epoch, config: { ...e.config } } as SlaveRuntime<T, C>;
      holder.obj = this.spec.create(e.key, e.config, () => holder.name);
      rt = holder;
      this.objects.set(e.key, rt);
      trim(this.objects, (k) => k === e.key || this.attached.has(k));
      return rt.obj;
    }
    rt.name = e.name;
    if (!sameConfig(rt.config, e.config)) {
      rt.config = { ...e.config };
      this.spec.configure(rt.obj, e.config);
    }
    if (rt.epoch !== e.epoch) {
      rt.epoch = e.epoch;
      this.spec.reset(rt.obj);
    }
    return rt.obj;
  }

  /** The object of a part when one exists (drawing, status; never creates one) */
  peek(key: string): T | undefined {
    return this.objects.get(key)?.obj;
  }

  /** Attaches exactly these parts' objects to their buses; parts no longer in the circuit are detached */
  sync(entries: readonly SocSlaveEntry<C>[]): void {
    const keep = new Set<string>();
    for (const e of entries) {
      keep.add(e.key);
      socManager.attachSlave(e.busId, this.object(e));
      if (e.busId) this.attached.add(e.key);
      else this.attached.delete(e.key);
    }
    for (const key of [...this.attached]) {
      if (keep.has(key)) continue;
      socManager.detach(key);
      this.attached.delete(key);
    }
  }

  /** Test hook: detach and forget everything */
  clear(): void {
    for (const key of this.attached) socManager.detach(key);
    this.attached.clear();
    this.objects.clear();
  }
}

export type SocMemoryEntry = SocSlaveEntry<SocMemoryConfig>;

const memories = new SocSlaveCache<SocMemory, SocMemoryConfig>({
  create: (key, config, name) => new SocMemory(key, config, name),
  configure: (mem, config) => mem.configure(config),
  reset: (mem) => mem.clear(),
});

/** The memory object of a part, created on first use; a new epoch forgets its contents (simulation reset) */
export function socMemoryObject(key: string, config: SocMemoryConfig, name: string, epoch = 0): SocMemory {
  return memories.object({ key, config, name, epoch });
}

/** The memory object of a part when one exists */
export function peekSocMemory(key: string): SocMemory | undefined {
  return memories.peek(key);
}

/** Attaches exactly these memory parts to their buses; memory parts no longer in the circuit are detached */
export function syncSocMemories(entries: readonly SocMemoryEntry[]): void {
  memories.sync(entries);
}

/** Name of a SoC part as evo shows it: its label, or "<part name>@x,y" */
export function socPartName(label: string | undefined, partName: string, x: number, y: number): string {
  const l = label?.trim();
  return l ? l : `${partName}@${Math.round(x)},${Math.round(y)}`;
}

/** "0x" + upper-case hex digits, padded to `digits` (addresses and data in traces and on bodies) */
export const socHex = (value: number, digits = 8): string => `0x${(value >>> 0).toString(16).toUpperCase().padStart(digits, '0')}`;

/**
 * Options of a "Bus" attribute (evo's SocBusSelection), for every SoC part that attaches to a bus: "not connected",
 * the buses of the circuit by name, and the part's current id when no bus has it (shown as missing, so the
 * selection is not lost while the bus part is on another sheet or deleted).
 */
export function socBusOptions(currentId: string, noneKey: string, missingKey: string): PartAttrOption[] {
  const buses = socManager.listBuses().sort((a, b) => a.name.localeCompare(b.name));
  const options: PartAttrOption[] = [{ value: '', labelKey: noneKey }, ...buses.map((b) => ({ value: b.id, label: b.name }))];
  if (currentId && !buses.some((b) => b.id === currentId)) options.push({ value: currentId, labelKey: missingKey });
  return options;
}

/** Test hook: forget every bus, memory and attachment */
export function resetSocRuntimeForTests(): void {
  for (const b of socManager.listBuses()) socManager.removeBus(b.id, b.owner);
  memories.clear();
  buses.clear();
}
