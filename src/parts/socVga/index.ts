// SoC VGA screen (Aşama 6h), as Logisim-evolution's SoC "SocVga": a display with no pins. On its SoC bus it is a
// 4-byte mode register (read: the modes software may select, write: a one-hot mask selects one), it sniffs every
// write into its frame buffer (one 0xRRGGBB word per pixel, row by row) and redraws that pixel, and it reads the whole
// buffer again when the picture must be rebuilt. Its body grows and shrinks with the mode in use. "C header" writes
// a driver (.h + .c) with the mode masks, sizes and addresses.
import { registerNamespace } from '../../i18n';
import { VGA_MODES, VGA_REGISTER_SIZE, VGA_SOFT_KEYS, clampVgaMode, vgaPartSize, type SocVgaConfig } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partNamespace, registerPart, type PartAttribute } from '../registry';
import { parseU32 as u32, socBusOptions, socManager } from '../shared/socRuntime';
import { drawSocVga } from './draw';
import { SocVgaExportRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { newVga, vgaState, withVgaState, type SocVgaPartState } from './model';
import { peekVga, syncVgas, vgaEntry, vgaShownMode } from './runtime';
import { hex, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

/** Edit of one attribute; null when the value does not change */
const change = <K extends keyof SocVgaPartState>(comp: CircuitComponentInstance, key: K, value: SocVgaPartState[K]) =>
  vgaState(comp)[key] === value ? null : withVgaState(comp, { [key]: value } as Partial<SocVgaPartState>);

/** A 32-bit address attribute (evo aligns neither the register nor the buffer) */
function address(key: 'startAddress' | 'bufferAddress'): PartAttribute {
  return {
    key,
    kind: 'hex',
    get: (comp) => vgaState(comp)[key],
    set: (comp, value) => {
      const v = u32(value);
      return v === null ? null : change(comp, key, v);
    },
  };
}

/** "May software select this mode?" as two buttons */
function softMode(key: (typeof VGA_SOFT_KEYS)[number]): PartAttribute {
  return {
    key,
    kind: 'buttons',
    options: [
      { value: 1, labelKey: 'options.on' },
      { value: 0, labelKey: 'options.off' },
    ],
    get: (comp) => (vgaState(comp)[key] ? 1 : 0),
    set: (comp, value) => change(comp, key, Number(value) === 1),
  };
}

const last = (start: number, bytes: number) => hex(Math.min(start + bytes - 1, 0xffffffff));

function statusText(comp: CircuitComponentInstance): string {
  const s = vgaState(comp);
  if (!s.busId || !socManager.getBus(s.busId)) return t('status.notConnected');
  const vga = peekVga(comp.id);
  const mode = VGA_MODES[clampVgaMode(vgaShownMode(comp))];
  const parts = [
    t('status.register', { start: hex(s.startAddress), end: last(s.startAddress, VGA_REGISTER_SIZE) }),
    t('status.buffer', { start: hex(s.bufferAddress), end: last(s.bufferAddress, mode.width * mode.height * 4) }),
  ];
  if (!vga) parts.push(t('status.notRun'));
  else parts.push(t(vga.modeSetBySoftware ? 'status.softMode' : 'status.initialMode', { mode: mode.name }));
  return parts.join(', ');
}

const initial = vgaPartSize(0);

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: initial.width,
  height: initial.height,
  inputs: [],
  outputs: [],
  // the body follows the mode in use, which software may change while the simulation runs
  size: (comp) => vgaPartSize(vgaShownMode(comp)),
  attributes: [
    {
      key: 'bus',
      kind: 'select',
      options: (comp) => socBusOptions(vgaState(comp).busId, 'attributes.bus.none', 'attributes.bus.missing'),
      get: (comp) => vgaState(comp).busId,
      set: (comp, value) => change(comp, 'busId', String(value)),
    },
    address('startAddress'),
    {
      key: 'displayMode',
      kind: 'select',
      options: VGA_MODES.map((m, i) => ({ value: i, label: m.name })),
      get: (comp) => vgaState(comp).displayMode,
      set: (comp, value) => {
        const n = Number(value);
        return Number.isInteger(n) && n >= 0 && n < VGA_MODES.length ? change(comp, 'displayMode', n as SocVgaConfig['displayMode']) : null;
      },
    },
    address('bufferAddress'),
    ...VGA_SOFT_KEYS.map(softMode),
    {
      key: 'cExport',
      kind: 'editor',
      singleOnly: true,
      editor: SocVgaExportRow,
      get: () => '',
    },
    {
      key: 'status',
      kind: 'info',
      get: statusText,
    },
  ],
  draw: drawSocVga,
  create: newVga,
  // a VGA copied together with its bus answers on the bus copy
  relink(comp, renamed) {
    const busId = renamed.get(vgaState(comp).busId);
    return busId ? withVgaState(comp, { busId }).comp : comp;
  },
  // a copy has its own picture (its new component id gives it a new VGA)
  syncRun(comps) {
    syncVgas(comps.map(vgaEntry));
  },
  resetState(comp) {
    const s = vgaState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies SocVgaPartState;
  },
});
