// Chronogram (timing diagram) model, after Logisim-evolution's gui/log Model: the list of signals that can be
// logged, the user's selection of them (shared with value logging), and the sample history.
//
// Recording follows evolution's default "coarse" granularity:
// - clock mode (a clock is the time source, CLOCK_DUAL): every edge of that clock starts a new time slot;
//   changes between two edges replace the values of the current slot (back-dated to the last edge);
// - step mode (no clock): every change of any logged value starts a new slot.
// A sample holds the values of every candidate signal, so a signal added to the selection later has a history.
import type { SignalValue } from '../types/logic';
import type { WaveformSample, WaveformValue } from './vcdGenerator';

/** A loggable signal. key: `${componentId}` or `${componentId}_${port}` (also the VCD sample key). */
export interface ChronoSignal {
  key: string;
  name: string;
  /** clock / input (switch, button, keyboard...) / output (LED, probe...) / state (flip-flop, register...) / gate */
  kind: 'clock' | 'input' | 'output' | 'state' | 'gate';
  width: number;
  color: string;
}

export interface ChronoLog {
  samples: WaveformSample[];
  /** time of the next slot (slots are numbered 0, 1, 2 ... from the last reset; dropping old samples keeps it) */
  nextTime: number;
  /** clock key the log was recorded against (null = step mode) */
  clockKey: string | null;
  /** level of that clock in the last slot */
  lastClock?: string;
}

/** evolution's default history limit (Model.historyLimit) */
export const CHRONO_DEFAULT_LIMIT = 400;
/** history limits offered in the panel; 0 = unlimited */
export const CHRONO_LIMITS = [100, 400, 2000, 0] as const;

export const emptyChronoLog = (clockKey: string | null = null): ChronoLog => ({ samples: [], nextTime: 0, clockKey });

/** One level as evolution's chronogram writes it: 0, 1, x, z, E */
export const waveSymbol = (v: SignalValue): string => (v === 'E' ? 'E' : v === 'Z' ? 'z' : v === 'X' ? 'x' : String(v));

/** Key that tells two values apart (scalar value or the bit pattern) */
export const waveKey = (v: WaveformValue | undefined): string =>
  v === undefined ? '0' : Array.isArray(v) ? `b${v.join('')}` : String(v);

const sameValues = (a: Record<string, WaveformValue>, b: Record<string, WaveformValue>): boolean => {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => k in b && waveKey(a[k]) === waveKey(b[k]));
};

const trim = (samples: WaveformSample[], limit: number): WaveformSample[] =>
  limit > 0 && samples.length > limit ? samples.slice(samples.length - limit) : samples;

/**
 * Add the current values to the log. Returns the same object when nothing is recorded, so React skips a render.
 * clockKey: the time source clock (its key in values), or null for step mode. A different clock key than the
 * log's starts a new log (evolution resets the model when the mode changes).
 */
export function recordChrono(
  log: ChronoLog,
  values: Record<string, WaveformValue>,
  clockKey: string | null,
  limit: number
): ChronoLog {
  if (log.clockKey !== clockKey) log = emptyChronoLog(clockKey);
  const last = log.samples[log.samples.length - 1];
  const clock = clockKey === null ? undefined : waveKey(values[clockKey]);
  if (!last) return { samples: [{ time: 0, values }], nextTime: 1, clockKey, lastClock: clock };
  if (clockKey !== null && clock === log.lastClock) {
    // no edge: back-date the change to the current slot
    if (sameValues(last.values, values)) return log;
    return { ...log, samples: [...log.samples.slice(0, -1), { time: last.time, values }] };
  }
  if (clockKey === null && sameValues(last.values, values)) return log;
  return {
    samples: trim([...log.samples, { time: log.nextTime, values }], limit),
    nextTime: log.nextTime + 1,
    clockKey,
    lastClock: clock,
  };
}

/** The log trimmed to a new history limit */
export const limitChrono = (log: ChronoLog, limit: number): ChronoLog => {
  const samples = trim(log.samples, limit);
  return samples === log.samples ? log : { ...log, samples };
};

/**
 * Loggable signals of one circuit level: the top-level circuit, or a subcircuit instance with its own parts.
 * Keys inside a subcircuit are `${instanceId}/${innerKey}` (nested levels add more `/` parts).
 */
export interface ChronoTreeNode {
  id: string;
  name: string;
  signals: ChronoSignal[];
  children: ChronoTreeNode[];
}

/**
 * The user's selection: keys in display order, and the top-level keys that existed when it was last edited.
 * A top-level signal that appears later (a new part) is added at the end, as evolution's Model adds new pins
 * and clocks; one the user removed stays removed. null selection = automatic: every top-level signal.
 */
export interface ChronoSelection {
  keys: string[];
  known: string[];
}

/** Keys of the selected signals in display order */
export function resolveChronoSelection(topLevel: ChronoSignal[], selection: ChronoSelection | null): string[] {
  if (selection === null) return topLevel.map((s) => s.key);
  const known = new Set(selection.known);
  const keys = new Set(selection.keys);
  return [...selection.keys, ...topLevel.filter((s) => !known.has(s.key) && !keys.has(s.key)).map((s) => s.key)];
}

/** A selection edited to these keys (in this order) */
export const editChronoSelection = (topLevel: ChronoSignal[], keys: string[]): ChronoSelection => ({
  keys: [...new Set(keys)],
  known: topLevel.map((s) => s.key),
});

/** Every signal of a tree, top level first, depth first */
export const flattenChronoTree = (node: ChronoTreeNode): ChronoSignal[] => [
  ...node.signals,
  ...node.children.flatMap(flattenChronoTree),
];

/** The selected signals in their order; keys of parts that no longer exist are skipped */
export function selectedChronoSignals(pool: ChronoSignal[], keys: string[]): ChronoSignal[] {
  const byKey = new Map(pool.map((s) => [s.key, s]));
  return keys.flatMap((k) => {
    const s = byKey.get(k);
    return s ? [s] : [];
  });
}

/** Move the key at index `from` to index `to` (both in the current list) */
export const moveChronoKey = (keys: string[], from: number, to: number): string[] => {
  if (from === to || from < 0 || from >= keys.length || to < 0 || to >= keys.length) return keys;
  const next = [...keys];
  const [k] = next.splice(from, 1);
  next.splice(to, 0, k);
  return next;
};

/**
 * evolution's default order (Model constructor): the time source clock first, then the inputs, then the rest,
 * each group sorted by location (Location.sortHorizontal: x, then y). Rows of one part stay together.
 */
export function sortChronoGroups<T extends { x: number; y: number; input: boolean; clock: boolean }>(groups: T[]): T[] {
  const byLoc = (a: T, b: T) => a.x - b.x || a.y - b.y;
  return [
    ...groups.filter((g) => g.clock).sort(byLoc),
    ...groups.filter((g) => !g.clock && g.input).sort(byLoc),
    ...groups.filter((g) => !g.clock && !g.input).sort(byLoc),
  ];
}

/** Value of a signal in a sample, as a bit array (LSB first); a missing value counts as x */
export const sampleBits = (v: WaveformValue | undefined, width: number): SignalValue[] =>
  Array.isArray(v) ? v : v === undefined ? Array<SignalValue>(width).fill('X') : [v];
