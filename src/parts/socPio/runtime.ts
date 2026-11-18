// Run-time side of the SoC PIO part: one SocPio slave per component id, outside the circuit (a SocSlaveCache, as the
// SoC memories in shared/socRuntime.ts). syncRun() keeps the attachments in line with the circuit; a new epoch
// (simulation reset) resets the registers.
import { SocPio, type SocPioConfig } from '../../soc';
import { SocSlaveCache, type SocSlaveEntry } from '../shared/socRuntime';

export type PioEntry = SocSlaveEntry<SocPioConfig>;

const pios = new SocSlaveCache<SocPio, SocPioConfig>({
  create: (key, config, name) => new SocPio(key, config, name),
  configure: (pio, config) => pio.configure(config),
  reset: (pio) => pio.reset(),
});

/** The PIO of a part, created on first use; new attributes keep the registers, a new epoch resets them */
export const pioObject = (e: PioEntry): SocPio => pios.object(e);

/** The PIO of a part when one exists (drawing, status) */
export const peekPio = (key: string): SocPio | undefined => pios.peek(key);

/** Attaches exactly these parts' PIOs to their buses; parts no longer in the circuit are detached */
export const syncPios = (entries: readonly PioEntry[]): void => pios.sync(entries);

/** Test hook */
export const resetPioRuntimeForTests = (): void => pios.clear();
