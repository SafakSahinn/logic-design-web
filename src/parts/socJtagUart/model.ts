// SoC JTAG UART part: its state (evo's JtagUart attributes), pins and geometry. The FIFOs live in the run-time
// object of runtime.ts, keyed by the component id; comp.state.part keeps only the JSON-safe attributes.
//
// Pins (evo's ports, loc at the top left, body 300 x 60): Clock (0,50), Reset (0,30), IRQ (300,50); along the top
// the keyboard side (read enable (10,0), clear (20,0), available (130,0), 7-bit data in (140,0)) and the TTY side
// (7-bit data out (160,0), write (180,0), clear (190,0)), so a Keyboard and a TTY part wire straight to them.
import { normalizeJtagUartConfig, type SocJtagUartConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partName, type PartAttrEdit } from '../registry';
import { socPartName } from '../shared/socRuntime';
import { PART_ID } from './id';

/** evo's bounds: 300 x 60 */
export const BODY_WIDTH = 300;
export const BODY_HEIGHT = 60;

export interface JtagUartPinPlace {
  id: string;
  name: string;
  x: number;
  y: number;
  width?: number;
}

/** Input pins in comp.inputs order (simulate() reads them by index) */
export const INPUT_PINS: readonly JtagUartPinPlace[] = [
  { id: 'clock', name: 'Clock', x: 0, y: 50 },
  { id: 'reset', name: 'Reset', x: 0, y: 30 },
  { id: 'kbdAvailable', name: 'KbdAvailable', x: 130, y: 0 },
  { id: 'kbdData', name: 'KbdData', x: 140, y: 0, width: 7 },
];

/** Output pins in comp.outputs order (simulate() drives them by index) */
export const OUTPUT_PINS: readonly JtagUartPinPlace[] = [
  { id: 'irq', name: 'IRQ', x: 300, y: 50 },
  { id: 'kbdReadEnable', name: 'KbdReadEnable', x: 10, y: 0 },
  { id: 'kbdClear', name: 'KbdClear', x: 20, y: 0 },
  { id: 'ttyData', name: 'TtyData', x: 160, y: 0, width: 7 },
  { id: 'ttyWrite', name: 'TtyWrite', x: 180, y: 0 },
  { id: 'ttyClear', name: 'TtyClear', x: 190, y: 0 },
];

/** What the part keeps in comp.state.part (JSON-safe) */
export interface SocJtagUartPartState extends SocJtagUartConfig {
  /** Id of the bus it answers on ('' = not connected) */
  busId: string;
  /** Bumped by a simulation reset: the FIFOs start again */
  epoch?: number;
}

export function jtagUartState(comp: CircuitComponentInstance): SocJtagUartPartState {
  const s = comp.state.part as Partial<SocJtagUartPartState> | undefined;
  return {
    ...normalizeJtagUartConfig(s),
    busId: typeof s?.busId === 'string' ? s.busId : '',
    ...(typeof s?.epoch === 'number' && Number.isFinite(s.epoch) ? { epoch: s.epoch } : {}),
  };
}

export function jtagUartConfig(comp: CircuitComponentInstance): SocJtagUartConfig {
  const { busId: _bus, epoch: _epoch, ...cfg } = jtagUartState(comp);
  return cfg;
}

export function jtagUartName(comp: CircuitComponentInstance): string {
  return socPartName(comp.label, partName(PART_ID), comp.x, comp.y);
}

/** Places of the pins in the unrotated body, in comp.inputs / comp.outputs order (they never change) */
export function pinPoints(): { inputs: { x: number; y: number }[]; outputs: { x: number; y: number }[] } {
  const at = (list: readonly JtagUartPinPlace[]) => list.map((p) => ({ x: p.x, y: p.y }));
  return { inputs: at(INPUT_PINS), outputs: at(OUTPUT_PINS) };
}

/** The part with new attributes (the pins stay as they are) */
export function withJtagUartState(comp: CircuitComponentInstance, patch: Partial<SocJtagUartPartState>): PartAttrEdit {
  const s = jtagUartState({ ...comp, state: { ...comp.state, part: { ...jtagUartState(comp), ...patch } } });
  return { comp: { ...comp, state: { ...comp.state, part: s satisfies SocJtagUartPartState } }, stateOnly: true };
}

/** A new part: evo's defaults (64-place FIFOs, thresholds 8, not connected) and no label ("JTAG UART@x,y") */
export function newJtagUart(comp: CircuitComponentInstance): CircuitComponentInstance {
  const next = withJtagUartState(comp, { ...normalizeJtagUartConfig({}), busId: '' }).comp;
  return comp.label === partName(PART_ID) ? { ...next, label: '' } : next;
}
