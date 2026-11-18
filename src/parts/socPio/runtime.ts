// Run-time side of the SoC PIO part: one SocPio slave per component id, outside the circuit (as the SoC memories in
// shared/socRuntime.ts). syncRun() keeps the attachments in line with the circuit; a new epoch (simulation reset)
// resets the registers.
import { SocPio, type SocPioConfig } from '../../soc';
import { socManager, trim } from '../shared/socRuntime';

/** PIOs kept; the oldest not attached are dropped beyond this */
const CACHE_LIMIT = 256;

export interface PioEntry {
  /** Component id */
  key: string;
  busId: string;
  name: string;
  config: SocPioConfig;
  epoch: number;
}

interface PioRuntime {
  pio: SocPio;
  name: string;
  epoch: number;
}

const pios = new Map<string, PioRuntime>();
/** Keys this module attached to the manager */
const attached = new Set<string>();

/** The PIO of a part, created on first use; new attributes keep the registers, a new epoch resets them */
export function pioObject(e: PioEntry): SocPio {
  let rt = pios.get(e.key);
  if (!rt) {
    const holder = { name: e.name, epoch: e.epoch } as PioRuntime;
    holder.pio = new SocPio(e.key, e.config, () => holder.name);
    rt = holder;
    pios.set(e.key, rt);
    trim(pios, (k) => k === e.key || attached.has(k), CACHE_LIMIT);
    return rt.pio;
  }
  rt.name = e.name;
  if (!sameConfig(rt.pio.config, e.config)) rt.pio.configure(e.config);
  if (rt.epoch !== e.epoch) {
    rt.epoch = e.epoch;
    rt.pio.reset();
  }
  return rt.pio;
}

function sameConfig(a: Readonly<SocPioConfig>, b: SocPioConfig): boolean {
  return (Object.keys(b) as (keyof SocPioConfig)[]).every((k) => a[k] === b[k]);
}

/** The PIO of a part when one exists (drawing, status) */
export function peekPio(key: string): SocPio | undefined {
  return pios.get(key)?.pio;
}

/** Attaches exactly these parts' PIOs to their buses; parts no longer in the circuit are detached */
export function syncPios(entries: readonly PioEntry[]): void {
  const keep = new Set<string>();
  for (const e of entries) {
    keep.add(e.key);
    socManager.attachSlave(e.busId, pioObject(e));
    if (e.busId) attached.add(e.key);
    else attached.delete(e.key);
  }
  for (const key of [...attached]) {
    if (keep.has(key)) continue;
    socManager.detach(key);
    attached.delete(key);
  }
}

/** Test hook */
export function resetPioRuntimeForTests(): void {
  for (const key of attached) socManager.detach(key);
  attached.clear();
  pios.clear();
}
