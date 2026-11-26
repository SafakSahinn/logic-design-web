// Logisim .circ export / import of the SoC VGA part (evo's Soc library, "SocVga").
//
// evo's attributes: StartAddress and BufferAddress (hex integers, not aligned), DisplayMode (options "160x120" ..
// "1024x768"), soft160x120 .. soft1024x768 (booleans "true" / "false"), SocBusSelection (the id of the bus it answers
// on and sniffs), label. It has no pins. Its bounds are the size of the mode in use with loc at the top left; in a
// file that is the initial mode (DisplayMode). The picture is run-time state and is not written: evo does not save
// it either.
import { VGA_MODES, VGA_SOFT_KEYS, vgaModeByName, vgaPartSize } from '../../../soc';
import type { CircuitComponentInstance } from '../../../types/circuit';
import type { PartCirc } from '../partCirc';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex } from '../socCirc';
import { vgaState, withVgaState, type SocVgaPartState } from '../../../parts/socVga/model';
import { t } from '../../../parts/socVga/text';

/** Each address attribute's evo name and the warning for an unreadable value */
const ADDRESSES: readonly [key: 'startAddress' | 'bufferAddress', name: string, warning: string][] = [
  ['startAddress', 'StartAddress', 'circ.badStartAddress'],
  ['bufferAddress', 'BufferAddress', 'circ.badBufferAddress'],
];

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const defaults = vgaState(comp);
  const patch: Partial<SocVgaPartState> = {};
  for (const [key, name, warning] of ADDRESSES) {
    const raw = attrs[name];
    if (raw === undefined) continue;
    const v = readCircHex(raw);
    if (v === undefined) warn(t(warning, { value: raw }));
    else patch[key] = v;
  }
  if (attrs.DisplayMode !== undefined) {
    // evo matches the option's name, spaces around it ignored
    const mode = vgaModeByName(attrs.DisplayMode.trim());
    if (mode === undefined) warn(t('circ.badDisplayMode', { value: attrs.DisplayMode, used: VGA_MODES[defaults.displayMode].name }));
    else patch.displayMode = mode;
  }
  // evo's boolean attribute: "true" (any case) is on, anything else off
  for (const key of VGA_SOFT_KEYS) if (attrs[key] !== undefined) patch[key] = attrs[key].trim().toLowerCase() === 'true';
  const id = readCircBusId(attrs.SocBusSelection);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else patch.busId = id ?? '';
  return withVgaState(comp, patch).comp;
}

export const socVgaCirc: PartCirc = {
  lib: '#Soc',
  name: 'SocVga',
  labelled: true,
  exportAttrs: (comp) => {
    const s = vgaState(comp);
    const busId = circBusId(s.busId);
    const out: Record<string, string> = {
      StartAddress: circHex(s.startAddress),
      DisplayMode: VGA_MODES[s.displayMode].name,
      BufferAddress: circHex(s.bufferAddress),
    };
    for (const key of VGA_SOFT_KEYS) out[key] = String(s[key]);
    return busId ? { ...out, SocBusSelection: busId } : out;
  },
  // no pins
  ports: () => ({ inputs: [], outputs: [] }),
  // the body of the initial mode: the mode a file opens with
  box: (comp) => {
    const { width, height } = vgaPartSize(vgaState(comp).displayMode);
    return { x0: 0, y0: 0, x1: width, y1: height };
  },
  importAttrs,
};
