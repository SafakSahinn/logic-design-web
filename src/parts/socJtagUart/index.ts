// SoC JTAG UART (Aşama 6h), as Logisim-evolution's SoC "SocJtagUart" (an Altera/Intel Avalon JTAG UART): a bus
// slave with a write FIFO (program -> TTY pins) and a read FIFO (keyboard pins -> program), interrupt thresholds and
// an IRQ output. On each rising clock edge one character goes to the TTY and one available keyboard character is
// taken. Reset high (rising edge) empties the FIFOs and clears the keyboard and the TTY. The "Terminal" window shows
// what was sent and types into the read FIFO, so a program can be tried without Keyboard / TTY parts.
import { registerNamespace } from '../../i18n';
import { JTAG_UART_FIFO_SIZES, JTAG_UART_SIZE, type JtagUartLevel } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { bitsToNumber, numberToBits, type SignalValue } from '../../types/logic';
import { partNamespace, registerPart, type PartAttribute } from '../registry';
import { parseU32 as u32, socBusOptions, socManager } from '../shared/socRuntime';
import { socJtagUartCirc } from './circ';
import { drawSocJtagUart } from './draw';
import { SocJtagUartTerminalRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import {
  BODY_HEIGHT,
  BODY_WIDTH,
  INPUT_PINS,
  OUTPUT_PINS,
  jtagUartState,
  newJtagUart,
  pinPoints,
  withJtagUartState,
  type SocJtagUartPartState,
} from './model';
import { jtagUartEntry, jtagUartObject, peekJtagUart, syncJtagUarts } from './runtime';
import { hex, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

/** A signed 32-bit integer from an attribute edit (evo's thresholds are plain integers), or null */
const i32 = (value: string | number): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31 ? n : null;
};

/** Edit of one attribute; null when the value does not change */
const change = <K extends keyof SocJtagUartPartState>(comp: CircuitComponentInstance, key: K, value: SocJtagUartPartState[K]) =>
  jtagUartState(comp)[key] === value ? null : withJtagUartState(comp, { [key]: value } as Partial<SocJtagUartPartState>);

function fifoSize(key: 'writeFifoSize' | 'readFifoSize'): PartAttribute {
  return {
    key,
    kind: 'select',
    // evo shows 1024 and up as "1KB" .. "32KB"
    options: JTAG_UART_FIFO_SIZES.map((n) => ({ value: n, label: n >= 1024 ? `${n / 1024}KB` : String(n) })),
    get: (comp) => jtagUartState(comp)[key],
    set: (comp, value) => (JTAG_UART_FIFO_SIZES.includes(Number(value)) ? change(comp, key, Number(value)) : null),
  };
}

function threshold(key: 'writeThreshold' | 'readThreshold'): PartAttribute {
  return {
    key,
    kind: 'int',
    get: (comp) => jtagUartState(comp)[key],
    set: (comp, value) => {
      const v = i32(value);
      return v === null ? null : change(comp, key, v);
    },
  };
}

function statusText(comp: CircuitComponentInstance): string {
  const s = jtagUartState(comp);
  if (!s.busId || !socManager.getBus(s.busId)) return t('status.notConnected');
  const addrRange = t('status.range', { start: hex(s.startAddress), end: hex(Math.min(s.startAddress + JTAG_UART_SIZE - 1, 0xffffffff)) });
  const uart = peekJtagUart(comp.id);
  if (!uart) return `${addrRange}, ${t('status.notRun')}`;
  const f = uart.fifos();
  return [
    addrRange,
    t('status.read', { used: f.read.length, size: s.readFifoSize }),
    t('status.write', { used: f.write.length, size: s.writeFifoSize }),
    t('status.control', { value: hex(uart.controlValue()) }),
  ].join(', ');
}

/** A 1-bit pin value as the engine's level: 1 / 0, or unknown */
const level = (v: SignalValue | undefined): JtagUartLevel => (v === 1 ? true : v === 0 ? false : undefined);
const pin = (b: boolean): 0 | 1 => (b ? 1 : 0);

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  inputs: INPUT_PINS.map((p) => ({ id: p.id, name: p.name, type: 'input' as const, relX: p.x, relY: p.y, ...(p.width ? { width: p.width } : {}) })),
  outputs: OUTPUT_PINS.map((p) => ({ id: p.id, name: p.name, type: 'output' as const, relX: p.x, relY: p.y, ...(p.width ? { width: p.width } : {}) })),
  pinPoints,
  attributes: [
    {
      key: 'bus',
      kind: 'select',
      options: (comp) => socBusOptions(jtagUartState(comp).busId, 'attributes.bus.none', 'attributes.bus.missing'),
      get: (comp) => jtagUartState(comp).busId,
      set: (comp, value) => change(comp, 'busId', String(value)),
    },
    {
      key: 'startAddress',
      kind: 'hex',
      get: (comp) => jtagUartState(comp).startAddress,
      set: (comp, value) => {
        // evo does not align the start address
        const v = u32(value);
        return v === null ? null : change(comp, 'startAddress', v);
      },
    },
    fifoSize('writeFifoSize'),
    threshold('writeThreshold'),
    fifoSize('readFifoSize'),
    threshold('readThreshold'),
    {
      key: 'terminal',
      kind: 'editor',
      singleOnly: true,
      editor: SocJtagUartTerminalRow,
      get: () => '',
    },
    {
      key: 'status',
      kind: 'info',
      get: statusText,
    },
  ],
  draw: drawSocJtagUart,
  circ: socJtagUartCirc,
  simulate(comp, ctx) {
    const uart = peekJtagUart(comp.id) ?? jtagUartObject(jtagUartEntry(comp));
    const bits = comp.inputs[3]?.bits;
    const data = bits?.length === 7 ? bitsToNumber(bits) : undefined;
    const out = uart.run({ clock: level(ctx.raw[0]), reset: level(ctx.raw[1]), available: level(ctx.raw[2]), data });
    ctx.setOut(0, pin(out.irq));
    ctx.setOut(1, pin(out.readEnable));
    ctx.setOut(2, pin(out.clearKeyboard));
    ctx.setBitsOut(3, numberToBits(out.ttyData, 7));
    ctx.setOut(4, pin(out.write));
    ctx.setOut(5, pin(out.clearTty));
  },
  create: newJtagUart,
  // a UART copied together with its bus answers on the bus copy
  relink(comp, renamed) {
    const busId = renamed.get(jtagUartState(comp).busId);
    return busId ? withJtagUartState(comp, { busId }).comp : comp;
  },
  // a copy has its own FIFOs (its new component id gives it a new UART)
  syncRun(comps) {
    syncJtagUarts(comps.map(jtagUartEntry));
  },
  resetState(comp) {
    const s = jtagUartState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies SocJtagUartPartState;
  },
});
