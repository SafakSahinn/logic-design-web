// Run-time side of the SoC JTAG UART part: one SocJtagUart slave per component id, outside the circuit (a
// SocSlaveCache, as the PIOs). Each keeps the characters it sent to its TTY pins for the part's terminal window.
// syncRun() keeps the attachments in line with the circuit; a new epoch (simulation reset) empties the FIFOs and
// the terminal.
import { SocJtagUart, type JtagUartInputs, type JtagUartOutputs, type SocJtagUartConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { SocSlaveCache, type SocSlaveEntry } from '../shared/socRuntime';
import { jtagUartConfig, jtagUartName, jtagUartState } from './model';

/** Characters a terminal keeps at least; older ones are dropped (in chunks of TERMINAL_SLACK) */
export const TERMINAL_LIMIT = 16384;
/** The log may grow this far past the limit before the oldest characters go, so trimming is not done per character */
const TERMINAL_SLACK = 4096;

/** A JTAG UART that also records what it sends, for the terminal window */
export class JtagUartRuntime extends SocJtagUart {
  private log: number[] = [];
  /** Bumped on every change of the log (a window re-renders on it) */
  logVersion = 0;

  /** step(), recording a character put on the TTY pins; the TTY clear pulse of a reset clears the log too */
  run(inp: JtagUartInputs): JtagUartOutputs {
    const before = this.transmitted;
    const wasClearing = this.outputs().clearTty;
    const out = this.step(inp);
    if (out.clearTty && !wasClearing) this.clearLog();
    if (this.transmitted !== before) this.record(out.ttyData);
    return out;
  }

  private record(ch: number): void {
    this.log.push(ch);
    if (this.log.length > TERMINAL_LIMIT + TERMINAL_SLACK) this.log.splice(0, this.log.length - TERMINAL_LIMIT);
    this.logVersion++;
  }

  /** The characters sent so far, oldest first */
  sent(): readonly number[] {
    return this.log;
  }

  clearLog(): void {
    this.log = [];
    this.logVersion++;
  }

  override reset(): void {
    super.reset();
    this.clearLog();
  }
}

export type JtagUartEntry = SocSlaveEntry<SocJtagUartConfig>;

const uarts = new SocSlaveCache<JtagUartRuntime, SocJtagUartConfig>({
  create: (key, config, name) => new JtagUartRuntime(key, config, name),
  configure: (u, config) => u.configure(config),
  reset: (u) => u.reset(),
});

/** The cache entry of a part (simulate(), syncRun() and the terminal window all use this one) */
export function jtagUartEntry(comp: CircuitComponentInstance): JtagUartEntry {
  const s = jtagUartState(comp);
  return { key: comp.id, busId: s.busId, name: jtagUartName(comp), config: jtagUartConfig(comp), epoch: s.epoch ?? 0 };
}

/** The UART of a part, created on first use; new attributes keep the FIFOs, a new epoch empties them */
export const jtagUartObject = (e: JtagUartEntry): JtagUartRuntime => uarts.object(e);

/** The UART of a part when one exists (drawing, status, terminal) */
export const peekJtagUart = (key: string): JtagUartRuntime | undefined => uarts.peek(key);

/** Attaches exactly these parts' UARTs to their buses; parts no longer in the circuit are detached */
export const syncJtagUarts = (entries: readonly JtagUartEntry[]): void => uarts.sync(entries);

/** Test hook */
export const resetJtagUartRuntimeForTests = (): void => uarts.clear();
