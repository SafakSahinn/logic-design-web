// Run-time side of the SoC DMA part: one SocDma per component id, outside the circuit (a SocSlaveCache, as the
// PIOs), attached as a slave to its control bus. Its transfers are master transactions on the source / destination
// buses, which need no attachment: dmaTransact() routes them through the manager on every rising clock edge.
import { SocDma, type DmaTransact, type SocDmaConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { SocSlaveCache, socManager, type SocSlaveEntry } from '../shared/socRuntime';
import { dmaConfig, dmaMasterBuses, dmaName, dmaState, type SocDmaPartState } from './model';

export type DmaEntry = SocSlaveEntry<SocDmaConfig>;

const dmas = new SocSlaveCache<SocDma, SocDmaConfig>({
  create: (key, config, name) => new SocDma(key, config, name),
  configure: (d, config) => d.configure(config),
  reset: (d) => d.reset(),
});

/** The cache entry of a part (simulate() and syncRun() use this one); its bus is the control bus */
export function dmaEntry(comp: CircuitComponentInstance): DmaEntry {
  const s = dmaState(comp);
  return { key: comp.id, busId: s.busId, name: dmaName(comp), config: dmaConfig(comp), epoch: s.epoch ?? 0 };
}

/**
 * The engine's bus access for this state: each side on its own bus or the control bus. Null when either side has
 * no bus at all (evo moves nothing then); a bus id that names no bus fails the transaction (no bus connected).
 */
export function dmaTransact(s: Pick<SocDmaPartState, 'busId' | 'srcBusId' | 'dstBusId'>): DmaTransact | null {
  const { src, dst } = dmaMasterBuses(s);
  if (!src || !dst) return null;
  return (side, t) => socManager.transact(side === 'src' ? src : dst, t);
}

/** The DMA of a part, created on first use; new attributes keep the registers, a new epoch clears them */
export const dmaObject = (e: DmaEntry): SocDma => dmas.object(e);

/** The DMA of a part when one exists (drawing, status) */
export const peekDma = (key: string): SocDma | undefined => dmas.peek(key);

/** Attaches exactly these parts' DMAs to their control buses; parts no longer in the circuit are detached */
export const syncDmas = (entries: readonly DmaEntry[]): void => dmas.sync(entries);

/** Test hook */
export const resetDmaRuntimeForTests = (): void => dmas.clear();
