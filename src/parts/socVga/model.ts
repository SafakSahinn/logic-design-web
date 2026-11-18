// SoC VGA part: its state (evo's SocVga attributes) and name. The picture lives in the run-time object of
// runtime.ts, keyed by the component id; comp.state.part keeps only the JSON-safe attributes. The part has no pins:
// it talks to the program only over its SoC bus.
import { normalizeVgaConfig, type SocVgaConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName, type PartAttrEdit } from '../registry';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

/** What the part keeps in comp.state.part (JSON-safe) */
export interface SocVgaPartState extends SocVgaConfig {
  /** Id of the bus it answers on and sniffs ('' = not connected) */
  busId: string;
  /** Bumped by a simulation reset: the initial mode again, the picture rebuilt from the buffer */
  epoch?: number;
}

export function vgaState(comp: CircuitComponentInstance): SocVgaPartState {
  const s = comp.state.part as Partial<SocVgaPartState> | undefined;
  return {
    ...normalizeVgaConfig(s),
    busId: typeof s?.busId === 'string' ? s.busId : '',
    ...(typeof s?.epoch === 'number' && Number.isFinite(s.epoch) ? { epoch: s.epoch } : {}),
  };
}

export function vgaConfig(comp: CircuitComponentInstance): SocVgaConfig {
  const { busId: _bus, epoch: _epoch, ...cfg } = vgaState(comp);
  return cfg;
}

export function vgaName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

/** The part with new attributes (it has no pins, so an edit only changes its state) */
export function withVgaState(comp: CircuitComponentInstance, patch: Partial<SocVgaPartState>): PartAttrEdit {
  const s = vgaState({ ...comp, state: { ...comp.state, part: { ...vgaState(comp), ...patch } } });
  return { comp: { ...comp, state: { ...comp.state, part: s satisfies SocVgaPartState } }, stateOnly: true };
}

/** A new part: evo's defaults (160x120, buffer at 0, not connected) and no label ("VGA screen@x,y") */
export function newVga(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withVgaState(comp, { ...normalizeVgaConfig({}), busId: '' }).comp;
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
