// SoC Memory (Aşama 6e), as Logisim-evolution's SoC "Socmem": a slave that answers the transactions of its bus in
// [start address, start + 2^size). It has no pins; its Bus attribute names the bus. The contents are kept outside
// the circuit (not saved, as in evo) and forgotten on a simulation reset; unwritten words read as random values.
import { registerNamespace } from '../../i18n';
import { MEM_SIZE_MAX_BITS, MEM_SIZE_MIN_BITS, memSizeText } from '../../soc';
import { partNamespace, registerPart } from '../registry';
import { peekSocMemory, socBusOptions, socManager, syncSocMemories } from '../shared/socRuntime';
import { socMemoryCirc } from './circ';
import { drawSocMemory } from './draw';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { BODY_HEIGHT, BODY_WIDTH, memoryEntry, memoryState, newMemory, withMemoryState, type SocMemoryPartState } from './model';
import { hex, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  inputs: [],
  outputs: [],
  attributes: [
    {
      key: 'bus',
      kind: 'select',
      options: (comp) => socBusOptions(memoryState(comp).busId, 'attributes.bus.none', 'attributes.bus.missing'),
      get: (comp) => memoryState(comp).busId,
      set: (comp, value) => (memoryState(comp).busId === String(value) ? null : { comp: withMemoryState(comp, { busId: String(value) }), stateOnly: true }),
    },
    {
      key: 'startAddress',
      kind: 'hex',
      get: (comp) => memoryState(comp).startAddress,
      set: (comp, value) => {
        // 32 bits, rounded down to a word as evo's memory does
        const n = Number(value);
        if (!Number.isFinite(n)) return null;
        const start = ((n % 2 ** 32) & ~3) >>> 0;
        return memoryState(comp).startAddress === start ? null : { comp: withMemoryState(comp, { startAddress: start }), stateOnly: true };
      },
    },
    {
      key: 'memSize',
      kind: 'select',
      options: range(MEM_SIZE_MIN_BITS, MEM_SIZE_MAX_BITS).map((n) => ({ value: n, label: memSizeText(n) })),
      get: (comp) => memoryState(comp).sizeBits,
      set: (comp, value) => (memoryState(comp).sizeBits === Number(value) ? null : { comp: withMemoryState(comp, { sizeBits: Number(value) }), stateOnly: true }),
    },
    {
      key: 'status',
      kind: 'info',
      get: (comp) => {
        const s = memoryState(comp);
        if (!s.busId || !socManager.getBus(s.busId)) return t('status.notConnected');
        const end = s.startAddress + 2 ** s.sizeBits - 1;
        return t('status.range', { start: hex(s.startAddress), end: hex(Math.min(end, 0xffffffff)), words: peekSocMemory(comp.id)?.writtenWords ?? 0 });
      },
    },
  ],
  circ: socMemoryCirc,
  draw: drawSocMemory,
  create: newMemory,
  // a memory copied together with its bus stays on the bus copy
  relink(comp, renamed) {
    const busId = renamed.get(memoryState(comp).busId);
    return busId ? withMemoryState(comp, { busId }) : comp;
  },
  // a copy answers on the same bus with its own (empty) contents: its new component id gives it a new memory
  syncRun(comps) {
    syncSocMemories(comps.map(memoryEntry));
  },
  resetState(comp) {
    const s = memoryState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies SocMemoryPartState;
  },
});
