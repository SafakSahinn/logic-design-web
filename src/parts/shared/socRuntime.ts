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
import { SocBus, SocManager, SocMemory, type SocMemoryConfig } from '../../soc';
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
const memories = new Map<string, Cached<SocMemory> & { name: string }>();
/** Keys of the memories this module attached to the manager (other slaves, e.g. 6h peripherals, keep their own) */
const attachedMemories = new Set<string>();

function trim<T>(cache: Map<string, T>, inUse: (key: string) => boolean): void {
  if (cache.size <= CACHE_LIMIT) return;
  for (const key of cache.keys()) {
    if (cache.size <= CACHE_LIMIT) return;
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

export interface SocMemoryEntry {
  /** Component id of the memory part */
  key: string;
  /** The bus it is attached to ('' = none) */
  busId: string;
  config: SocMemoryConfig;
  name: string;
  epoch: number;
}

/** The memory object of a part, created on first use; a new epoch forgets its contents (simulation reset) */
export function socMemoryObject(key: string, config: SocMemoryConfig, name: string, epoch = 0): SocMemory {
  let hit = memories.get(key);
  if (!hit) {
    const entry = { name, epoch } as Cached<SocMemory> & { name: string };
    entry.obj = new SocMemory(key, config, () => entry.name);
    hit = entry;
    memories.set(key, hit);
    trim(memories, (k) => attachedMemories.has(k) || k === key);
  } else {
    if (hit.epoch !== epoch) {
      hit.obj.clear();
      hit.epoch = epoch;
    }
    hit.obj.configure(config);
    hit.name = name;
  }
  return hit.obj;
}

/** The memory object of a part when one exists */
export function peekSocMemory(key: string): SocMemory | undefined {
  return memories.get(key)?.obj;
}

/** Attaches exactly these memory parts to their buses; memory parts no longer in the circuit are detached */
export function syncSocMemories(entries: readonly SocMemoryEntry[]): void {
  const keep = new Set<string>();
  for (const e of entries) {
    keep.add(e.key);
    const mem = socMemoryObject(e.key, e.config, e.name, e.epoch);
    socManager.attachSlave(e.busId, mem);
    if (e.busId) attachedMemories.add(e.key);
    else attachedMemories.delete(e.key);
  }
  for (const key of [...attachedMemories]) {
    if (keep.has(key)) continue;
    socManager.detach(key);
    attachedMemories.delete(key);
  }
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
  for (const key of attachedMemories) socManager.detach(key);
  attachedMemories.clear();
  buses.clear();
  memories.clear();
}
