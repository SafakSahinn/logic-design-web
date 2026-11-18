// SoC PIO (Aşama 6h), as Logisim-evolution's SoC "SocPio" (an Altera/Intel Avalon PIO): a bus slave with up to 32
// input, output or bidirectional bit pins, optional edge capture and an interrupt output. The program reads and
// writes its registers over the bus; the part samples the input pins and drives the output pins on every
// evaluation. Reset high resets the registers. "C header" writes a driver (.h + .c) for the configuration.
import { registerNamespace } from '../../i18n';
import { PIO_CAPTURE_EDGES, PIO_DIRECTIONS, PIO_IRQ_TYPES, PIO_MAX_WIDTH, PIO_MIN_WIDTH, PIO_SIZE, pioHasInputs, pioHasOutputs, type SocPio } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partNamespace, registerPart, type PartAttribute } from '../registry';
import { socBusOptions, socManager } from '../shared/socRuntime';
import { socPioCirc } from './circ';
import { drawSocPio } from './draw';
import { SocPioExportRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { BODY_HEIGHT, BODY_WIDTH, RESET_POINT, bitX, newPio, pinPoints, pioConfig, pioHasIrq, pioName, pioState, withPioState, type SocPioPartState } from './model';
import { peekPio, pioObject, syncPios, type PioEntry } from './runtime';
import { hex, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A 32-bit unsigned value from an attribute edit, or null */
const u32 = (value: string | number): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 2 ** 32 ? Math.trunc(n) >>> 0 : null;
};

const entryOf = (comp: CircuitComponentInstance): PioEntry => {
  const s = pioState(comp);
  return { key: comp.id, busId: s.busId, name: pioName(comp), config: pioConfig(comp), epoch: s.epoch ?? 0 };
};

/** Edit of one attribute; null when the value does not change */
const change = <K extends keyof SocPioPartState>(comp: CircuitComponentInstance, key: K, value: SocPioPartState[K]) =>
  pioState(comp)[key] === value ? null : withPioState(comp, { [key]: value } as Partial<SocPioPartState>);

/** An on / off attribute shown as two buttons */
function toggle(key: 'outputBitOps' | 'syncCapture' | 'captureBitClear' | 'genIrq', visible?: (s: SocPioPartState) => boolean): PartAttribute {
  return {
    key,
    kind: 'buttons',
    options: [
      { value: 1, labelKey: 'options.on' },
      { value: 0, labelKey: 'options.off' },
    ],
    get: (comp) => (pioState(comp)[key] ? 1 : 0),
    set: (comp, value) => change(comp, key, Number(value) === 1),
    ...(visible ? { visible: (comp: CircuitComponentInstance) => visible(pioState(comp)) } : {}),
  };
}

/** The data register reads the pins (bidirectional ports too) */
const hasIn = (s: SocPioPartState) => s.direction !== 'outputonly';
const hasOut = (s: SocPioPartState) => pioHasOutputs(s.direction);

function statusText(comp: CircuitComponentInstance): string {
  const s = pioState(comp);
  if (!s.busId || !socManager.getBus(s.busId)) return t('status.notConnected');
  const addrRange = t('status.range', { start: hex(s.startAddress), end: hex(Math.min(s.startAddress + PIO_SIZE - 1, 0xffffffff)) });
  const pio = peekPio(comp.id);
  if (!pio) return `${addrRange}, ${t('status.notRun')}`;
  const r = pio.registers();
  const digits = Math.ceil(s.width / 4);
  const parts = [addrRange];
  if (hasOut(s)) parts.push(t('status.output', { value: hex(r.output, digits) }));
  if (hasIn(s)) parts.push(t('status.input', { value: hex(pio.inputLevels, digits) }));
  if (s.direction === 'bidir') parts.push(t('status.direction', { value: hex(r.direction, digits) }));
  if (pio.generatesIrq) parts.push(t('status.irqMask', { value: hex(r.irqMask, digits) }));
  if (s.syncCapture && hasIn(s)) parts.push(t('status.capture', { value: hex(r.capture, digits) }));
  return parts.join(', ');
}

/** Bit b of a value as a pin level */
const bit = (v: number, b: number): 0 | 1 => ((v >>> b) & 1) as 0 | 1;

function drive(pio: SocPio, s: SocPioPartState, setOut: (i: number, v: 0 | 1 | 'Z') => void): void {
  let index = 0;
  if (pioHasIrq(s)) setOut(index++, pio.irq() ? 1 : 0);
  if (!pioHasOutputs(s.direction)) return;
  const out = pio.outputs();
  for (let b = 0; b < s.width; b++) setOut(index + b, bit(out.driven, b) ? bit(out.value, b) : 'Z');
}

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  // evo's default port: input only, 1 bit
  inputs: [
    { id: 'reset', name: 'Reset', type: 'input', relX: RESET_POINT.x, relY: RESET_POINT.y },
    { id: 'in0', name: 'In0', type: 'input', relX: bitX(0), relY: BODY_HEIGHT },
  ],
  outputs: [],
  pinPoints,
  attributes: [
    {
      key: 'bus',
      kind: 'select',
      options: (comp) => socBusOptions(pioState(comp).busId, 'attributes.bus.none', 'attributes.bus.missing'),
      get: (comp) => pioState(comp).busId,
      set: (comp, value) => change(comp, 'busId', String(value)),
    },
    {
      key: 'startAddress',
      kind: 'hex',
      get: (comp) => pioState(comp).startAddress,
      set: (comp, value) => {
        // evo does not align the PIO's start address
        const v = u32(value);
        return v === null ? null : change(comp, 'startAddress', v);
      },
    },
    {
      key: 'width',
      kind: 'select',
      options: range(PIO_MIN_WIDTH, PIO_MAX_WIDTH).map((n) => ({ value: n, label: String(n) })),
      get: (comp) => pioState(comp).width,
      set: (comp, value) => change(comp, 'width', Number(value)),
    },
    {
      key: 'direction',
      kind: 'select',
      options: PIO_DIRECTIONS.map((d) => ({ value: d, labelKey: `attributes.direction.options.${d}` })),
      get: (comp) => pioState(comp).direction,
      set: (comp, value) => (PIO_DIRECTIONS.includes(value as never) ? change(comp, 'direction', value as SocPioPartState['direction']) : null),
    },
    {
      key: 'outputResetValue',
      kind: 'hex',
      get: (comp) => pioState(comp).outputResetValue,
      set: (comp, value) => {
        const v = u32(value);
        return v === null ? null : change(comp, 'outputResetValue', v);
      },
      visible: (comp) => hasOut(pioState(comp)),
    },
    toggle('outputBitOps', hasOut),
    toggle('syncCapture', hasIn),
    {
      key: 'captureEdge',
      kind: 'select',
      options: PIO_CAPTURE_EDGES.map((e) => ({ value: e, labelKey: `attributes.captureEdge.options.${e}` })),
      get: (comp) => pioState(comp).captureEdge,
      set: (comp, value) => (PIO_CAPTURE_EDGES.includes(value as never) ? change(comp, 'captureEdge', value as SocPioPartState['captureEdge']) : null),
      visible: (comp) => {
        const s = pioState(comp);
        return hasIn(s) && s.syncCapture;
      },
    },
    toggle('captureBitClear', (s) => hasIn(s) && s.syncCapture),
    toggle('genIrq', hasIn),
    {
      key: 'irqType',
      kind: 'select',
      options: PIO_IRQ_TYPES.map((v) => ({ value: v, labelKey: `attributes.irqType.options.${v}` })),
      get: (comp) => pioState(comp).irqType,
      set: (comp, value) => (PIO_IRQ_TYPES.includes(value as never) ? change(comp, 'irqType', value as SocPioPartState['irqType']) : null),
      visible: (comp) => {
        const s = pioState(comp);
        return pioHasIrq(s) && s.syncCapture;
      },
    },
    {
      key: 'cExport',
      kind: 'editor',
      singleOnly: true,
      editor: SocPioExportRow,
      get: () => '',
    },
    {
      key: 'status',
      kind: 'info',
      get: statusText,
    },
  ],
  draw: drawSocPio,
  circ: socPioCirc,
  simulate(comp, ctx) {
    const s = pioState(comp);
    const pio = peekPio(comp.id) ?? pioObject(entryOf(comp));
    // evo: reset high resets the registers on every evaluation, the pins are still sampled and driven
    if (ctx.raw[0] === 1) pio.reset();
    if (pioHasInputs(s.direction) || s.direction === 'bidir') {
      let levels = 0;
      for (let b = 0; b < s.width; b++) if (ctx.raw[1 + b] === 1) levels |= 1 << b;
      pio.sampleInputs(levels >>> 0);
    }
    drive(pio, s, ctx.setOut);
  },
  create: newPio,
  // a PIO copied together with its bus answers on the bus copy
  relink(comp, renamed) {
    const busId = renamed.get(pioState(comp).busId);
    return busId ? withPioState(comp, { busId }).comp : comp;
  },
  // a copy has its own registers (its new component id gives it a new PIO)
  syncRun(comps) {
    syncPios(comps.map(entryOf));
  },
  resetState(comp) {
    const s = pioState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies SocPioPartState;
  },
});
