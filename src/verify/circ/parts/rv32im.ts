// Logisim .circ export / import of the RV32IM part (evo's Soc library, "Rv32im").
//
// evo's attributes: resetVector (hex integer), irqWidth (a bit width 0..32), plicBaseAddress (hex integer, rounded
// down to a word), stateVisible (boolean), SocBusSelection (the id of the bus it masters), label. Its body is
// 640 x 640 with loc at the top left; its pins are Reset (0,610), Clock (0,630) and IRQi (0, 10 + 10 i). The
// processor state, the loaded program and the assembler source are not written: evo does not save them either.
import { MAX_IRQS, PLIC_DEFAULT_BASE } from '../../../soc';
import type { CircuitComponentInstance } from '../../../types/circuit';
import type { PartCirc } from '../partCirc';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex, readCircWidth } from '../socCirc';
import { BODY_HEIGHT, BODY_WIDTH, cpuState, pinPoints, withCpuState, withIrqWidth, type Rv32imPartState } from '../../../parts/rv32im/model';
import { peekCpu } from '../../../parts/rv32im/runtime';
import { hex, t } from '../../../parts/rv32im/text';

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const patch: Partial<Rv32imPartState> = {};
  if (attrs.resetVector !== undefined) {
    const v = readCircHex(attrs.resetVector);
    if (v === undefined) warn(t('circ.badResetVector', { value: attrs.resetVector }));
    else patch.resetVector = v;
  }
  if (attrs.plicBaseAddress !== undefined) {
    const v = readCircHex(attrs.plicBaseAddress);
    // evo rounds the address down to a word as well
    if (v === undefined) warn(t('circ.badPlicBase', { value: attrs.plicBaseAddress, used: hex(PLIC_DEFAULT_BASE) }));
    else patch.plicBase = (v & ~3) >>> 0;
  }
  // evo's boolean attribute: "true" (any case) is on, anything else off
  if (attrs.stateVisible !== undefined) patch.stateVisible = attrs.stateVisible.trim().toLowerCase() === 'true';
  const id = readCircBusId(attrs.SocBusSelection);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else patch.busId = id ?? '';
  let made = withCpuState(comp, patch);
  if (attrs.irqWidth !== undefined) {
    const n = readCircWidth(attrs.irqWidth, 0, MAX_IRQS);
    if (n === undefined) warn(t('circ.badIrqWidth', { value: attrs.irqWidth, max: MAX_IRQS }));
    else made = withIrqWidth(made, n).comp;
  }
  return made;
}

export const rv32imCirc: PartCirc = {
  lib: '#Soc',
  name: 'Rv32im',
  labelled: true,
  exportAttrs: (comp) => {
    const s = cpuState(comp);
    const busId = circBusId(s.busId);
    return {
      resetVector: circHex(s.resetVector),
      irqWidth: String(s.irqWidth),
      plicBaseAddress: circHex(s.plicBase),
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
  // the pins sit where evo has them already (the part's own pin places are evo's)
  ports: (comp) => pinPoints(comp),
  box: () => ({ x0: 0, y0: 0, x1: BODY_WIDTH, y1: BODY_HEIGHT }),
  importAttrs,
};
