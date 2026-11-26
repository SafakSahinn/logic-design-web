// Logisim .circ export / import of the SoC Memory part (evo's Soc library, "Socmem").
//
// evo's attributes: StartAddress (hex integer, word aligned), MemSize (a bit width 10..26: 2^n bytes),
// SocBusSelection (the id of the bus it answers on), label. Its body is 320 x 60 with loc at the top left and it
// has no pins. The contents are not written: evo does not save them either.
import type { CircuitComponentInstance } from '../../../types/circuit';
import { MEM_SIZE_DEFAULT_BITS, MEM_SIZE_MAX_BITS, MEM_SIZE_MIN_BITS } from '../../../soc';
import type { PartCirc } from '../partCirc';
import { peekSocMemory } from '../../../parts/shared/socRuntime';
import { MAX_BUS_ID_LENGTH, circBusId, circHex, readCircBusId, readCircHex, readCircWidth } from '../socCirc';
import { BODY_HEIGHT, BODY_WIDTH, memoryState, withMemoryState, type SocMemoryPartState } from '../../../parts/socMemory/model';
import { t } from '../../../parts/socMemory/text';

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const patch: Partial<SocMemoryPartState> = {};
  if (attrs.StartAddress !== undefined) {
    const start = readCircHex(attrs.StartAddress);
    // evo rounds the address down to a word as well
    if (start === undefined) warn(t('circ.badStartAddress', { value: attrs.StartAddress }));
    else patch.startAddress = (start & ~3) >>> 0;
  }
  if (attrs.MemSize !== undefined) {
    const bits = readCircWidth(attrs.MemSize, MEM_SIZE_MIN_BITS, MEM_SIZE_MAX_BITS);
    if (bits === undefined) warn(t('circ.badMemSize', { value: attrs.MemSize, min: MEM_SIZE_MIN_BITS, max: MEM_SIZE_MAX_BITS, used: MEM_SIZE_DEFAULT_BITS }));
    else patch.sizeBits = bits;
  }
  const id = readCircBusId(attrs.SocBusSelection);
  if (id === 'tooLong') warn(t('circ.idTooLong', { max: MAX_BUS_ID_LENGTH }));
  else patch.busId = id ?? '';
  return withMemoryState(comp, patch);
}

export const socMemoryCirc: PartCirc = {
  lib: '#Soc',
  name: 'Socmem',
  labelled: true,
  exportAttrs: (comp) => {
    const s = memoryState(comp);
    const busId = circBusId(s.busId);
    return { StartAddress: circHex(s.startAddress), MemSize: String(s.sizeBits), ...(busId ? { SocBusSelection: busId } : {}) };
  },
  exportWarnings: (comp) => {
    const words = peekSocMemory(comp.id)?.writtenWords ?? 0;
    return words > 0 ? [t('circ.contents', { words })] : [];
  },
  ports: () => ({ inputs: [], outputs: [] }),
  box: () => ({ x0: 0, y0: 0, x1: BODY_WIDTH, y1: BODY_HEIGHT }),
  importAttrs,
};
