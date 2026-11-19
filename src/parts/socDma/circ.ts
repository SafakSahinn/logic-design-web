// Logisim .circ export / import of the SoC DMA part (evo's Soc library, "SocDma").
//
// evo's attributes, in its order: StartAddress (hex integer; evo's engine clears the low two bits, so it saves it
// aligned), BurstSize (a decimal number: evo takes the first option not below it, above 256 gives 256), label,
// SocBusSelection (the control bus: the registers answer there), DmaSrcBus and DmaDstBus (the buses the words are
// read from / written to; empty means the control bus). Its body is 320 x 120 with loc at the top left, and the
// pins are at the part's own (evo's) places. The registers are run-time state and are not written: evo does not
// save them either.
import { clampDmaBurstSize } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { PartCirc } from '../registry';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex } from '../shared/socCirc';
import { BODY_HEIGHT, BODY_WIDTH, dmaState, pinPoints, withDmaState, type SocDmaPartState } from './model';
import { t } from './text';

type BusField = 'busId' | 'srcBusId' | 'dstBusId';

/** Each bus attribute's evo name and the locale key of its "id too long" warning */
const BUSES: readonly [field: BusField, name: string, warning: string][] = [
  ['busId', 'SocBusSelection', 'circ.idTooLong'],
  ['srcBusId', 'DmaSrcBus', 'circ.srcIdTooLong'],
  ['dstBusId', 'DmaDstBus', 'circ.dstIdTooLong'],
];

/**
 * evo's BurstSize as Java's Integer.parseInt reads it (spaces around it allowed here, leading zeros too): the number
 * written, or undefined when unreadable
 */
function readBurstSize(value: string): number | undefined {
  const m = /^([+-]?)0*(\d{1,10})$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1] + m[2]);
  return n >= -0x80000000 && n <= 0x7fffffff ? n : undefined;
}

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const defaults = dmaState(comp);
  const patch: Partial<SocDmaPartState> = {};
  if (attrs.StartAddress !== undefined) {
    const start = readCircHex(attrs.StartAddress);
    if (start === undefined) warn(t('circ.badStartAddress', { value: attrs.StartAddress }));
    // aligned without a warning, as evo's engine does (evo itself never writes an unaligned one)
    else patch.startAddress = (start & ~3) >>> 0;
  }
  if (attrs.BurstSize !== undefined) {
    const written = readBurstSize(attrs.BurstSize);
    if (written === undefined) warn(t('circ.badBurstSize', { value: attrs.BurstSize, used: defaults.burstSize }));
    else {
      // evo takes the first option not below it (above 256: 256)
      const n = clampDmaBurstSize(written);
      if (n !== written) warn(t('circ.burstSizeRounded', { value: attrs.BurstSize, used: n }));
      patch.burstSize = n;
    }
  }
  for (const [field, name, warning] of BUSES) {
    const id = readCircBusId(attrs[name]);
    if (id === 'tooLong') warn(t(warning, { max: MAX_BUS_ID_LENGTH }));
    else patch[field] = id ?? '';
  }
  return withDmaState(comp, patch).comp;
}

export const socDmaCirc: PartCirc = {
  lib: '#Soc',
  name: 'SocDma',
  labelled: true,
  exportAttrs: (comp) => {
    const s = dmaState(comp);
    const out: Record<string, string> = { StartAddress: circHex(s.startAddress), BurstSize: String(s.burstSize) };
    // an unset bus is left out, as evo leaves out an empty one
    for (const [field, name] of BUSES) {
      const id = circBusId(s[field]);
      if (id) out[name] = id;
    }
    return out;
  },
  ports: () => pinPoints(),
  box: () => ({ x0: 0, y0: 0, x1: BODY_WIDTH, y1: BODY_HEIGHT }),
  importAttrs,
};
