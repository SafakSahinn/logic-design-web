// Logisim .circ export / import of the SoC JTAG UART part (evo's Soc library, "SocJtagUart").
//
// evo's attributes: StartAddress (hex integer, not aligned), WriteFifoSize / ReadFifoSize (options: the saved value
// is the number of places "8" .. "32768"; evo only shows 1024 and up as "1KB" .. "32KB"), WriteThreshold /
// ReadThreshold (plain decimal integers, Integer.valueOf), SocBusSelection (the id of the bus it answers on), label.
// Its body is 300 x 60 with loc at the top left; the pins are fixed, at evo's places. The FIFOs are run-time state
// and are not written: evo does not save them either.
import { JTAG_UART_FIFO_SIZES } from '../../../soc';
import type { CircuitComponentInstance } from '../../../types/circuit';
import type { PartCirc } from '../partCirc';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex } from '../socCirc';
import { BODY_HEIGHT, BODY_WIDTH, jtagUartState, pinPoints, withJtagUartState, type SocJtagUartPartState } from '../../../parts/socJtagUart/model';
import { t } from '../../../parts/socJtagUart/text';

type SizeKey = 'writeFifoSize' | 'readFifoSize';
type ThresholdKey = 'writeThreshold' | 'readThreshold';

/** Each FIFO size attribute's evo name */
const SIZES: readonly [key: SizeKey, name: string][] = [
  ['writeFifoSize', 'WriteFifoSize'],
  ['readFifoSize', 'ReadFifoSize'],
];

/** Each threshold attribute's evo name */
const THRESHOLDS: readonly [key: ThresholdKey, name: string][] = [
  ['writeThreshold', 'WriteThreshold'],
  ['readThreshold', 'ReadThreshold'],
];

/** evo's integer attribute as Integer.valueOf reads it: a signed 32-bit decimal; undefined = unreadable */
function readCircInt(value: string): number | undefined {
  const v = value.trim();
  if (!/^[-+]?\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= -(2 ** 31) && n < 2 ** 31 ? n : undefined;
}

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const defaults = jtagUartState(comp);
  const patch: Partial<SocJtagUartPartState> = {};
  if (attrs.StartAddress !== undefined) {
    const start = readCircHex(attrs.StartAddress);
    if (start === undefined) warn(t('circ.badStartAddress', { value: attrs.StartAddress }));
    else patch.startAddress = start;
  }
  for (const [key, name] of SIZES) {
    const raw = attrs[name];
    if (raw === undefined) continue;
    // evo matches the option's text (" 64 " is read, "064" is not)
    const n = JTAG_UART_FIFO_SIZES.find((size) => String(size) === raw.trim());
    if (n !== undefined) patch[key] = n;
    else warn(t('circ.badFifoSize', { value: raw, used: defaults[key] }));
  }
  for (const [key, name] of THRESHOLDS) {
    const raw = attrs[name];
    if (raw === undefined) continue;
    const n = readCircInt(raw);
    if (n === undefined) warn(t('circ.badThreshold', { value: raw, used: defaults[key] }));
    else patch[key] = n;
  }
  const id = readCircBusId(attrs.SocBusSelection);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else patch.busId = id ?? '';
  return withJtagUartState(comp, patch).comp;
}

export const socJtagUartCirc: PartCirc = {
  lib: '#Soc',
  name: 'SocJtagUart',
  labelled: true,
  exportAttrs: (comp) => {
    const s = jtagUartState(comp);
    const busId = circBusId(s.busId);
    const out: Record<string, string> = {
      StartAddress: circHex(s.startAddress),
      WriteFifoSize: String(s.writeFifoSize),
      WriteThreshold: String(s.writeThreshold),
      ReadFifoSize: String(s.readFifoSize),
      ReadThreshold: String(s.readThreshold),
    };
    return busId ? { ...out, SocBusSelection: busId } : out;
  },
  // the pins sit where evo has them
  ports: () => pinPoints(),
  // the body reaches below the lowest pins (Clock and IRQ at y 50)
  box: () => ({ x0: 0, y0: 0, x1: BODY_WIDTH, y1: BODY_HEIGHT }),
  importAttrs,
};
