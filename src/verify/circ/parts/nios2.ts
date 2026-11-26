// Logisim .circ export / import of the Nios II part (evo's Soc library, "Nios2").
//
// evo's attributes: resetVector, exceptionVector, breakVector (hex integers), irqWidth (a bit width 0..32),
// stateVisible (boolean), SocBusSelection (the id of the bus it masters), label. Its body is 640 x 650 with loc at
// the top left; its pins are the custom-instruction pins on the top edge (dataa .. writerc out, done and result in),
// Reset (0,620), Clock (0,640) and IRQi (0, 40 + 10 i). The processor state, the loaded program and the assembler
// source are not written: evo does not save them either.
import { NIOS2_MAX_IRQS } from '../../../soc';
import type { CircuitComponentInstance } from '../../../types/circuit';
import type { PartCirc } from '../partCirc';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex, readCircWidth } from '../socCirc';
import { BODY_HEIGHT, BODY_WIDTH, cpuState, pinPoints, withCpuState, withIrqWidth, type Nios2PartState } from '../../../parts/nios2/model';
import { peekCpu } from '../../../parts/nios2/runtime';
import { hex, t } from '../../../parts/nios2/text';

type VectorKey = 'resetVector' | 'exceptionVector' | 'breakVector';

/** Each vector attribute and the locale key of its warning */
const VECTORS: readonly [key: VectorKey, warning: string][] = [
  ['resetVector', 'circ.badResetVector'],
  ['exceptionVector', 'circ.badExceptionVector'],
  ['breakVector', 'circ.badBreakVector'],
];

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const defaults = cpuState(comp);
  const patch: Partial<Nios2PartState> = {};
  for (const [key, warning] of VECTORS) {
    const raw = attrs[key];
    if (raw === undefined) continue;
    const v = readCircHex(raw);
    if (v === undefined) warn(t(warning, { value: raw, used: hex(defaults[key]) }));
    else patch[key] = v;
  }
  // evo's boolean attribute: "true" (any case) is on, anything else off
  if (attrs.stateVisible !== undefined) patch.stateVisible = attrs.stateVisible.trim().toLowerCase() === 'true';
  const id = readCircBusId(attrs.SocBusSelection);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else patch.busId = id ?? '';
  let made = withCpuState(comp, patch);
  if (attrs.irqWidth !== undefined) {
    const n = readCircWidth(attrs.irqWidth, 0, NIOS2_MAX_IRQS);
    if (n === undefined) warn(t('circ.badIrqWidth', { value: attrs.irqWidth, max: NIOS2_MAX_IRQS }));
    else made = withIrqWidth(made, n).comp;
  }
  return made;
}

export const nios2Circ: PartCirc = {
  lib: '#Soc',
  name: 'Nios2',
  labelled: true,
  exportAttrs: (comp) => {
    const s = cpuState(comp);
    const busId = circBusId(s.busId);
    return {
      resetVector: circHex(s.resetVector),
      exceptionVector: circHex(s.exceptionVector),
      breakVector: circHex(s.breakVector),
      irqWidth: String(s.irqWidth),
      stateVisible: String(s.stateVisible),
      ...(busId ? { SocBusSelection: busId } : {}),
    };
  },
  exportWarnings: (comp) => {
    const out: string[] = [];
    if (peekCpu(comp.id)?.program) out.push(t('circ.program'));
    if (cpuState(comp).asm?.trim()) out.push(t('circ.asmSource'));
    return out;
  },
  // the pins sit where evo has them already (the part's own pin places are evo's); tunnels are matched by place,
  // so evo's port order (clock, reset, dataa .. writerc, result, done, irq) does not matter here
  ports: (comp) => pinPoints(comp),
  box: () => ({ x0: 0, y0: 0, x1: BODY_WIDTH, y1: BODY_HEIGHT }),
  importAttrs,
};
