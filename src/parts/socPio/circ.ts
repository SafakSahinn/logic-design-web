// Logisim .circ export / import of the SoC PIO part (evo's Soc library, "SocPio").
//
// evo's attributes: StartAddress (hex integer, not aligned), width (a bit width 1..32), direction (bidir |
// inputonly | outputonly | inout), outputresetvalue (hex integer), outputbitsetclear, inputssynccapt, capturetype
// (rising | falling | any), inputscaptbit, genirq (booleans "true" / "false"), irqtype (level | edge),
// SocBusSelection (the id of the bus it answers on), label. evo saves only the attributes its direction and capture
// setting show; all are written here, so a file read back keeps the hidden settings too (evo ignores them). Its body
// is 380 x 120 with loc at the top left; the pins are at the part's own (evo's) places. The registers are run-time
// state and are not written: evo does not save them either.
import { PIO_CAPTURE_EDGES, PIO_DIRECTIONS, PIO_IRQ_TYPES, PIO_MAX_WIDTH, PIO_MIN_WIDTH } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { PartCirc } from '../registry';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex, readCircWidth } from '../shared/socCirc';
import { BODY_HEIGHT, BODY_WIDTH, pinPoints, pioState, withPioState, type SocPioPartState } from './model';
import { t } from './text';

type BoolKey = 'outputBitOps' | 'syncCapture' | 'captureBitClear' | 'genIrq';
type OptionKey = 'direction' | 'captureEdge' | 'irqType';

/** Each boolean attribute's evo name */
const BOOLS: readonly [key: BoolKey, name: string][] = [
  ['outputBitOps', 'outputbitsetclear'],
  ['syncCapture', 'inputssynccapt'],
  ['captureBitClear', 'inputscaptbit'],
  ['genIrq', 'genirq'],
];

/** Each option attribute's evo name, its values and the locale key of its warning */
const OPTIONS: readonly [key: OptionKey, name: string, values: readonly string[], warning: string][] = [
  ['direction', 'direction', PIO_DIRECTIONS, 'circ.badDirection'],
  ['captureEdge', 'capturetype', PIO_CAPTURE_EDGES, 'circ.badCaptureEdge'],
  ['irqType', 'irqtype', PIO_IRQ_TYPES, 'circ.badIrqType'],
];

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const defaults = pioState(comp);
  const patch: Partial<SocPioPartState> = {};
  if (attrs.StartAddress !== undefined) {
    const start = readCircHex(attrs.StartAddress);
    if (start === undefined) warn(t('circ.badStartAddress', { value: attrs.StartAddress }));
    else patch.startAddress = start;
  }
  if (attrs.width !== undefined) {
    const n = readCircWidth(attrs.width, PIO_MIN_WIDTH, PIO_MAX_WIDTH);
    if (n === undefined) warn(t('circ.badWidth', { value: attrs.width, min: PIO_MIN_WIDTH, max: PIO_MAX_WIDTH, used: defaults.width }));
    else patch.width = n;
  }
  for (const [key, name, values, warning] of OPTIONS) {
    const raw = attrs[name];
    if (raw === undefined) continue;
    const v = raw.trim();
    if (values.includes(v)) (patch as Record<OptionKey, string>)[key] = v;
    else warn(t(warning, { value: raw, used: defaults[key] }));
  }
  if (attrs.outputresetvalue !== undefined) {
    const v = readCircHex(attrs.outputresetvalue);
    if (v === undefined) warn(t('circ.badOutputResetValue', { value: attrs.outputresetvalue }));
    else patch.outputResetValue = v;
  }
  // evo's boolean attribute: "true" (any case) is on, anything else off
  for (const [key, name] of BOOLS) if (attrs[name] !== undefined) patch[key] = attrs[name].trim().toLowerCase() === 'true';
  const id = readCircBusId(attrs.SocBusSelection);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else patch.busId = id ?? '';
  // the pins follow the width, direction and IRQ setting
  return withPioState(comp, patch).comp;
}

export const socPioCirc: PartCirc = {
  lib: '#Soc',
  name: 'SocPio',
  labelled: true,
  exportAttrs: (comp) => {
    const s = pioState(comp);
    const busId = circBusId(s.busId);
    const out: Record<string, string> = {
      StartAddress: circHex(s.startAddress),
      width: String(s.width),
      direction: s.direction,
      outputresetvalue: circHex(s.outputResetValue),
    };
    for (const [key, name] of BOOLS) out[name] = String(s[key]);
    out.capturetype = s.captureEdge;
    out.irqtype = s.irqType;
    return busId ? { ...out, SocBusSelection: busId } : out;
  },
  // the pins sit where evo has them already; a bidirectional bit is one evo pin: its wires belong to the output
  // pin of the pair (as on the part), so the input half that reads it back has no connection point of its own
  ports: (comp) => {
    const pts = pinPoints(comp);
    return {
      inputs: comp.inputs.map((p, i) => (/_io\d+in$/.test(p.id) ? null : pts.inputs[i])),
      outputs: pts.outputs,
    };
  },
  // the body reaches 10 beyond the last bit's pins
  box: () => ({ x0: 0, y0: 0, x1: BODY_WIDTH, y1: BODY_HEIGHT }),
  importAttrs,
};
