// Run-time side of the Nios II part: one processor core per component id, outside the circuit (as the SoC memories in
// shared/socRuntime.ts). The core masters its bus through the canvas's SocManager; unlike the RV32IM it has no
// slave of its own (evo's Nios2 has no PLIC: the IRQ pins go straight to ipending). The custom-instruction inputs
// (done, result) are latched here by simulate() before the core runs, so the core's ports read the pins of the
// current evaluation. A new epoch (simulation reset) starts the core again; the loaded program (its image, for the
// listing) and the breakpoints stay with the core.
import { Nios2Core, type ProgramImage } from '../../soc';
import { socManager, trim } from '../shared/socRuntime';

/** Cores kept; the oldest not in the circuit are dropped beyond this */
const CACHE_LIMIT = 64;

export interface CpuEntry {
  /** Component id */
  key: string;
  busId: string;
  name: string;
  resetVector: number;
  exceptionVector: number;
  breakVector: number;
  irqWidth: number;
  epoch: number;
}

/** The custom-instruction inputs as the last evaluation saw them */
export interface CustomInputs {
  /** null = not a defined 0 / 1 */
  done: boolean | null;
  /** null = some bit not 0 / 1 */
  result: number | null;
}

export interface CpuRuntime {
  core: Nios2Core;
  /** The bus the core masters */
  busId: string;
  name: string;
  epoch: number;
  /** The last loaded program (listing, symbols); null when none */
  program: ProgramImage | null;
  /** Bumped whenever the program or the breakpoints change (the windows re-read) */
  version: number;
  custom: CustomInputs;
}

const cpus = new Map<string, CpuRuntime>();
/** Keys of the parts in the circuit at the last sync */
const inCircuit = new Set<string>();

/** The run-time object of a part, created on first use; a new epoch resets the core */
export function cpuRuntime(e: CpuEntry): CpuRuntime {
  let rt = cpus.get(e.key);
  let restart = false;
  if (!rt) {
    const holder = {} as CpuRuntime;
    const core = new Nios2Core({
      transact: (t) => socManager.transact(holder.busId, t),
      master: () => holder.name,
      customDone: () => holder.custom.done,
      customResult: () => holder.custom.result,
    });
    Object.assign(holder, { core, busId: e.busId, name: e.name, epoch: e.epoch, program: null, version: 0, custom: { done: null, result: null } });
    rt = holder;
    cpus.set(e.key, rt);
    trim(cpus, (k) => k === e.key || inCircuit.has(k), CACHE_LIMIT);
    restart = true;
  } else if (rt.epoch !== e.epoch) {
    rt.epoch = e.epoch;
    restart = true;
  }
  rt.busId = e.busId;
  rt.name = e.name;
  rt.core.resetVector = e.resetVector >>> 0;
  rt.core.exceptionVector = e.exceptionVector >>> 0;
  rt.core.breakVector = e.breakVector >>> 0;
  rt.core.nrOfIrqs = e.irqWidth;
  if (restart) {
    // after the vectors are set, so pc starts at this part's reset vector; evo: a new processor state is running
    rt.core.reset();
    rt.core.runState = 'running';
  }
  return rt;
}

/** The run-time object of a part when one exists (drawing, windows) */
export function peekCpu(key: string): CpuRuntime | undefined {
  return cpus.get(key);
}

/** Brings the cores of the circuit's parts in line with their attributes (and a new epoch) */
export function syncCpus(entries: readonly CpuEntry[]): void {
  inCircuit.clear();
  for (const e of entries) {
    inCircuit.add(e.key);
    cpuRuntime(e);
  }
}

export { peekBusByte } from '../shared/cpu/program';

/** Test hook */
export function resetCpuRuntimeForTests(): void {
  inCircuit.clear();
  cpus.clear();
}
