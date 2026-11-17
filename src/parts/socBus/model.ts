// SoC Bus part: its state and geometry (evo's SocBus: 640 wide, one 30px row per shown transaction plus the title).
import { newSocBusId } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName } from '../registry';
import { MAX_BUS_ID_LENGTH } from '../shared/socCirc';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

export const BODY_WIDTH = 640;
/** Height of one trace row and of the title row (evo's TRACE_HEIGHT) */
export const ROW_HEIGHT = 30;
/** evo's NrOfTracesAttr: a bit width, 1..32, default 5 */
export const TRACE_SIZE_MIN = 1;
export const TRACE_SIZE_MAX = 32;
export const TRACE_SIZE_DEFAULT = 5;

/** What the part keeps in comp.state.part (JSON-safe) */
export interface SocBusPartState {
  /** evo's hidden SocBusIdentifier: the id the slaves name; new for every new or copied part */
  busId: string;
  /** Transactions shown on the body */
  traceSize: number;
  /** evo's TraceVisible: off draws only a note (faster with a busy CPU) */
  traceVisible: boolean;
  /** Bumped by a simulation reset: the trace is cleared */
  epoch?: number;
}

const clampTraceSize = (n: unknown): number =>
  typeof n === 'number' && Number.isFinite(n) ? Math.min(TRACE_SIZE_MAX, Math.max(TRACE_SIZE_MIN, Math.round(n))) : TRACE_SIZE_DEFAULT;

export function busState(comp: CircuitComponentInstance): SocBusPartState {
  const s = comp.state.part as Partial<SocBusPartState> | undefined;
  return {
    busId: typeof s?.busId === 'string' ? s.busId : '',
    traceSize: clampTraceSize(s?.traceSize),
    traceVisible: s?.traceVisible !== false,
    ...(typeof s?.epoch === 'number' ? { epoch: s.epoch } : {}),
  };
}

/** The bus id; a part without one (made outside the create hook) gets a stable one from its component id */
export function busIdOf(comp: CircuitComponentInstance): string {
  const id = busState(comp).busId;
  return id && id.length <= MAX_BUS_ID_LENGTH ? id : `lds:${comp.id}`;
}

export function busSize(comp: CircuitComponentInstance): { width: number; height: number } {
  return { width: BODY_WIDTH, height: (busState(comp).traceSize + 1) * ROW_HEIGHT };
}

export function busName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

export function withBusState(comp: CircuitComponentInstance, patch: Partial<SocBusPartState>): CircuitComponentInstance {
  return { ...comp, state: { ...comp.state, part: { ...busState(comp), ...patch } satisfies SocBusPartState } };
}

/** A new part: a new bus id and evo's defaults; no label, so its name is "SoC Bus@x,y" as in evo */
export function newBus(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withBusState(comp, { busId: newSocBusId(), traceSize: TRACE_SIZE_DEFAULT, traceVisible: true });
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
