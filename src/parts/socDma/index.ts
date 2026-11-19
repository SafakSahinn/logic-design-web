// SoC DMA engine (Aşama 6h), as Logisim-evolution's SoC "SocDma": a linear memory-copy engine driven by a clock pin.
// It is a slave on its control bus (six word registers: source, destination, length, control, status, bytes done)
// and a master on a source and a destination bus (each falls back to the control bus). On every rising clock edge
// while busy it moves up to "burst size" words: a hidden read from the source, then a visible write to the
// destination (so a VGA screen sees it). Reset high clears the registers; the IRQ pin rises when a transfer with
// IRQ_EN set ends, until DONE is cleared. "C header" writes a driver (.h + .c).
import { registerNamespace } from '../../i18n';
import { DMA_BURST_SIZES, DMA_REGISTER_SIZE, type DmaLevel } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { SignalValue } from '../../types/logic';
import { partNamespace, registerPart, type PartAttribute } from '../registry';
import { parseU32 as u32, socBusOptions, socManager } from '../shared/socRuntime';
import { socDmaCirc } from './circ';
import { drawSocDma } from './draw';
import { SocDmaExportRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { BODY_HEIGHT, BODY_WIDTH, INPUT_PINS, OUTPUT_PINS, dmaMasterBuses, dmaState, newDma, pinPoints, withDmaState, type SocDmaPartState } from './model';
import { dmaEntry, dmaObject, dmaTransact, peekDma, syncDmas } from './runtime';
import { dmaStatusLine } from './status';
import { hex, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

/** Edit of one attribute; null when the value does not change */
const change = <K extends keyof SocDmaPartState>(comp: CircuitComponentInstance, key: K, value: SocDmaPartState[K]) =>
  dmaState(comp)[key] === value ? null : withDmaState(comp, { [key]: value } as Partial<SocDmaPartState>);

/** A bus selector: the control bus (the slave side) or a master side, whose "none" means the control bus */
function busAttribute(key: 'bus' | 'srcBus' | 'dstBus', field: 'busId' | 'srcBusId' | 'dstBusId'): PartAttribute {
  return {
    key,
    kind: 'select',
    options: (comp) => socBusOptions(dmaState(comp)[field], `attributes.${key}.none`, `attributes.${key}.missing`),
    get: (comp) => dmaState(comp)[field],
    set: (comp, value) => change(comp, field, String(value)),
  };
}

const busLabel = (id: string): string => (id ? (socManager.getBus(id)?.name ?? t('status.missingBus')) : t('status.noBus'));

function statusText(comp: CircuitComponentInstance): string {
  const s = dmaState(comp);
  if (!s.busId || !socManager.getBus(s.busId)) return t('status.notConnected');
  const { src, dst } = dmaMasterBuses(s);
  const parts = [
    t('status.range', { start: hex(s.startAddress), end: hex(Math.min(s.startAddress + DMA_REGISTER_SIZE - 1, 0xffffffff)) }),
    t('status.buses', { src: busLabel(src), dst: busLabel(dst) }),
  ];
  const dma = peekDma(comp.id);
  if (!dma) return [...parts, t('status.notRun')].join(', ');
  const r = dma.registers();
  parts.push(t('status.registers', { src: hex(r.srcAddr), dst: hex(r.dstAddr), length: r.length }), dmaStatusLine(r));
  if (r.irq) parts.push(t('status.irq'));
  return parts.join(', ');
}

/** A 1-bit pin value as the engine's level: 1 / 0, or unknown */
const level = (v: SignalValue | undefined): DmaLevel => (v === 1 ? true : v === 0 ? false : undefined);

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  inputs: INPUT_PINS.map((p) => ({ id: p.id, name: p.name, type: 'input' as const, relX: p.x, relY: p.y })),
  outputs: OUTPUT_PINS.map((p) => ({ id: p.id, name: p.name, type: 'output' as const, relX: p.x, relY: p.y })),
  pinPoints,
  attributes: [
    busAttribute('bus', 'busId'),
    {
      key: 'startAddress',
      kind: 'hex',
      get: (comp) => dmaState(comp).startAddress,
      set: (comp, value) => {
        // the engine clears the low two bits (word-aligned registers), as evo does
        const v = u32(value);
        return v === null ? null : change(comp, 'startAddress', (v & ~3) >>> 0);
      },
    },
    {
      key: 'burstSize',
      kind: 'select',
      options: DMA_BURST_SIZES.map((n) => ({ value: n, label: String(n) })),
      get: (comp) => dmaState(comp).burstSize,
      set: (comp, value) => (DMA_BURST_SIZES.includes(Number(value)) ? change(comp, 'burstSize', Number(value)) : null),
    },
    busAttribute('srcBus', 'srcBusId'),
    busAttribute('dstBus', 'dstBusId'),
    {
      key: 'cExport',
      kind: 'editor',
      singleOnly: true,
      editor: SocDmaExportRow,
      get: () => '',
    },
    {
      key: 'status',
      kind: 'info',
      get: statusText,
    },
  ],
  draw: drawSocDma,
  circ: socDmaCirc,
  simulate(comp, ctx) {
    const dma = peekDma(comp.id) ?? dmaObject(dmaEntry(comp));
    const irq = dma.step({ reset: level(ctx.raw[0]), clock: level(ctx.raw[1]) }, dmaTransact(dmaState(comp)));
    ctx.setOut(0, irq ? 1 : 0);
  },
  create: newDma,
  // a DMA copied together with a bus it uses (control, source or destination) uses the bus copy
  relink(comp, renamed) {
    const s = dmaState(comp);
    const patch: Partial<SocDmaPartState> = {};
    for (const field of ['busId', 'srcBusId', 'dstBusId'] as const) {
      const id = renamed.get(s[field]);
      if (id) patch[field] = id;
    }
    return Object.keys(patch).length ? withDmaState(comp, patch).comp : comp;
  },
  // a copy has its own registers (its new component id gives it a new DMA)
  syncRun(comps) {
    syncDmas(comps.map(dmaEntry));
  },
  resetState(comp) {
    const s = dmaState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies SocDmaPartState;
  },
});
