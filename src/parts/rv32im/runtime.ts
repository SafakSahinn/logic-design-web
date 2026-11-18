// Run-time side of the RV32IM part: one processor core and its PLIC per component id, outside the circuit (as the
// SoC memories in shared/socRuntime.ts). The core masters its bus through the canvas's SocManager; the PLIC is a
// slave on the same bus. syncRun() keeps the PLIC attachments in line with the circuit; a new epoch (simulation
// reset) starts the core and the PLIC again. The loaded program (its image, for the listing) and the breakpoints
// stay with the core.
import {
  BYTE_ACCESS,
  READ_TRANSACTION,
  Rv32imCore,
  Rv32imPlic,
  SocBusError,
  SocTransaction,
  type ProgramImage,
} from '../../soc';
import { socManager, trim } from '../shared/socRuntime';

/** Cores kept; the oldest not in the circuit are dropped beyond this */
const CACHE_LIMIT = 64;

export interface CpuEntry {
  /** Component id */
  key: string;
  busId: string;
  name: string;
  resetVector: number;
  plicBase: number;
  irqWidth: number;
  epoch: number;
}

export interface CpuRuntime {
  core: Rv32imCore;
  plic: Rv32imPlic;
  /** The bus the core masters */
  busId: string;
  name: string;
  epoch: number;
  /** The last loaded program (listing, symbols); null when none */
  program: ProgramImage | null;
  /** Bumped whenever the program or the breakpoints change (the windows re-read) */
  version: number;
}

const cpus = new Map<string, CpuRuntime>();
/** Keys whose PLIC this module attached to the manager */
const attached = new Set<string>();

const plicKey = (key: string) => `${key}:plic`;

/** The run-time object of a part, created on first use; a new epoch resets the core and the PLIC */
export function cpuRuntime(e: CpuEntry): CpuRuntime {
  let rt = cpus.get(e.key);
  if (!rt) {
    const holder = {} as CpuRuntime;
    const core = new Rv32imCore({ transact: (t) => socManager.transact(holder.busId, t), master: () => holder.name });
    // evo: a new processor state is running; a reset stops it
    core.runState = 'running';
    Object.assign(holder, { core, plic: new Rv32imPlic(plicKey(e.key), () => holder.name), busId: e.busId, name: e.name, epoch: e.epoch, program: null, version: 0 });
    rt = holder;
    cpus.set(e.key, rt);
    trim(cpus, (k) => k === e.key || attached.has(k), CACHE_LIMIT);
  } else if (rt.epoch !== e.epoch) {
    rt.epoch = e.epoch;
    rt.core.reset();
    rt.core.runState = 'running';
    rt.plic.reset();
  }
  rt.busId = e.busId;
  rt.name = e.name;
  rt.core.resetVector = e.resetVector >>> 0;
  rt.plic.configure(e.plicBase, e.irqWidth);
  return rt;
}

/** The run-time object of a part when one exists (drawing, windows) */
export function peekCpu(key: string): CpuRuntime | undefined {
  return cpus.get(key);
}

/** Attaches exactly these parts' PLICs to their buses; parts no longer in the circuit are detached */
export function syncCpus(entries: readonly CpuEntry[]): void {
  const keep = new Set<string>();
  for (const e of entries) {
    keep.add(e.key);
    const rt = cpuRuntime(e);
    socManager.attachSlave(e.busId, rt.plic);
    if (e.busId) attached.add(e.key);
    else attached.delete(e.key);
  }
  for (const key of [...attached]) {
    if (keep.has(key)) continue;
    socManager.detach(plicKey(key));
    attached.delete(key);
  }
}

/** A byte of the CPU's bus as the core would read it, without a trace row (listing); undefined on a bus error */
export function peekBusByte(busId: string, address: number): number | undefined {
  const t = new SocTransaction(READ_TRANSACTION, address >>> 0, 0, BYTE_ACCESS, 'listing');
  t.hidden = true;
  socManager.transact(busId, t);
  return t.error === SocBusError.none ? t.readData & 0xff : undefined;
}

/** Test hook */
export function resetCpuRuntimeForTests(): void {
  for (const key of attached) socManager.detach(plicKey(key));
  attached.clear();
  cpus.clear();
}
