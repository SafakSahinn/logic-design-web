// SoC DMA part: its state (evo's SocDma attributes), pins and geometry. The registers live in the run-time object of
// runtime.ts, keyed by the component id; comp.state.part keeps only the JSON-safe attributes.
//
// Pins (evo's ports, loc at the top left, body 320 x 120): Reset (0,100), Clock (0,110), IRQ (320,100). They never
// change. The DMA answers on its control bus (evo's SocBusSelection) and moves data over its source and destination
// buses (evo's DmaSrcBus / DmaDstBus); an empty source or destination bus means the control bus.
import { dmaEffectiveBus, normalizeDmaConfig, type SocDmaConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName, type PartAttrEdit } from '../registry';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

/** evo's bounds: 320 x 120 */
export const BODY_WIDTH = 320;
export const BODY_HEIGHT = 120;

export interface DmaPinPlace {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Input pins in comp.inputs order (simulate() reads them by index) */
export const INPUT_PINS: readonly DmaPinPlace[] = [
  { id: 'reset', name: 'Reset', x: 0, y: 100 },
  { id: 'clock', name: 'Clock', x: 0, y: 110 },
];

/** Output pins in comp.outputs order */
export const OUTPUT_PINS: readonly DmaPinPlace[] = [{ id: 'irq', name: 'IRQ', x: BODY_WIDTH, y: 100 }];

/** What the part keeps in comp.state.part (JSON-safe) */
export interface SocDmaPartState extends SocDmaConfig {
  /** Id of the control bus: the registers answer there ('' = not connected) */
  busId: string;
  /** Id of the bus the source words are read from ('' = the control bus) */
  srcBusId: string;
  /** Id of the bus the words are written to ('' = the control bus) */
  dstBusId: string;
  /** Bumped by a simulation reset: the registers start again */
  epoch?: number;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export function dmaState(comp: CircuitComponentInstance): SocDmaPartState {
  const s = comp.state.part as Partial<SocDmaPartState> | undefined;
  return {
    ...normalizeDmaConfig(s),
    busId: str(s?.busId),
    srcBusId: str(s?.srcBusId),
    dstBusId: str(s?.dstBusId),
    ...(typeof s?.epoch === 'number' && Number.isFinite(s.epoch) ? { epoch: s.epoch } : {}),
  };
}

export function dmaConfig(comp: CircuitComponentInstance): SocDmaConfig {
  const { busId: _bus, srcBusId: _src, dstBusId: _dst, epoch: _epoch, ...cfg } = dmaState(comp);
  return cfg;
}

/** The buses the two master sides use (each falls back to the control bus; '' = none) */
export function dmaMasterBuses(s: Pick<SocDmaPartState, 'busId' | 'srcBusId' | 'dstBusId'>): { src: string; dst: string } {
  return { src: dmaEffectiveBus(s.srcBusId, s.busId), dst: dmaEffectiveBus(s.dstBusId, s.busId) };
}

export function dmaName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

/** Places of the pins in the unrotated body, in comp.inputs / comp.outputs order (they never change) */
export function pinPoints(): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  const at = (list: readonly DmaPinPlace[]) => list.map((p) => ({ x: p.x, y: p.y }));
  return { inputs: at(INPUT_PINS), outputs: at(OUTPUT_PINS) };
}

/** The part with new attributes (the pins stay as they are) */
export function withDmaState(comp: CircuitComponentInstance, patch: Partial<SocDmaPartState>): PartAttrEdit {
  const s = dmaState({ ...comp, state: { ...comp.state, part: { ...dmaState(comp), ...patch } } });
  return { comp: { ...comp, state: { ...comp.state, part: s satisfies SocDmaPartState } }, stateOnly: true };
}

/** A new part: evo's defaults (registers at 0, 16 words a clock, no buses) and no label ("DMA engine@x,y") */
export function newDma(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withDmaState(comp, { ...normalizeDmaConfig({}), busId: '', srcBusId: '', dstBusId: '' }).comp;
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
