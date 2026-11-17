// Logisim .circ export / import of the SoC Bus part (evo's Soc library, "SocBus").
//
// evo's attributes: SocBusIdentifier (hidden; the id the slaves name), TraceSize (a bit width, the shown
// transactions), TraceVisible, label. Its body is 640 x (TraceSize + 1) * 30 with loc at the top left; its one
// pin, Reset, is at (0,10). The trace itself is not written (evo does not save it either).
import type { CircuitComponentInstance } from '../../types/circuit';
import type { PartCirc } from '../registry';
import { circBusId, readCircBusId, MAX_BUS_ID_LENGTH } from '../shared/socCirc';
import { TRACE_SIZE_DEFAULT, TRACE_SIZE_MAX, busIdOf, busSize, busState, withBusState, type SocBusPartState } from './model';
import { t } from './text';

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const patch: Partial<SocBusPartState> = {};
  // the file's id (the slaves in it name it); without one the bus keeps the new id it was made with, as in evo
  const id = readCircBusId(attrs.SocBusIdentifier);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else if (id !== undefined) patch.busId = id;
  if (attrs.TraceSize !== undefined) {
    const v = attrs.TraceSize.trim();
    const n = /^\d{1,4}$/.test(v) ? Number(v) : NaN;
    if (!(n >= 1)) warn(t('circ.badTraceSize', { value: attrs.TraceSize, used: TRACE_SIZE_DEFAULT }));
    else if (n > TRACE_SIZE_MAX) {
      // evo keeps any bit width here; this part shows at most TRACE_SIZE_MAX
      warn(t('circ.traceSizeClamped', { value: n, max: TRACE_SIZE_MAX }));
      patch.traceSize = TRACE_SIZE_MAX;
    } else patch.traceSize = n;
  }
  // evo's boolean attribute: "true" (any case) is on, anything else off
  if (attrs.TraceVisible !== undefined) patch.traceVisible = attrs.TraceVisible.trim().toLowerCase() === 'true';
  return withBusState(comp, patch);
}

export const socBusCirc: PartCirc = {
  lib: '#Soc',
  name: 'SocBus',
  labelled: true,
  exportAttrs: (comp) => {
    const s = busState(comp);
    return { SocBusIdentifier: circBusId(busIdOf(comp)), TraceSize: String(s.traceSize), TraceVisible: String(s.traceVisible) };
  },
  ports: () => ({ inputs: [{ x: 0, y: 10 }], outputs: [] }),
  box: (comp) => {
    const { width, height } = busSize(comp);
    return { x0: 0, y0: 0, x1: width, y1: height };
  },
  importAttrs,
};
