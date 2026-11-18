// Nios II processor (Aşama 6g), as Logisim-evolution's SoC "Nios2": a Nios II/s core that executes one instruction
// per rising clock edge, fetching and accessing data as transactions on its SoC bus. The IRQ pins feed ipending
// directly (no interrupt controller). Custom instructions drive the pins on the top edge (dataa, datab, start, n, a,
// readra, b, readrb, c, writerc) and wait for done; the result pin is written to rC. Reset high resets the core.
// Programs are loaded from an ELF file or the assembler window; the body shows the registers, pc, status registers,
// the execution trace and the IRQs.
import { registerNamespace } from '../../i18n';
import { NIOS2_MAX_IRQS } from '../../soc';
import { bitsToNumber, numberToBits, type SignalValue } from '../../types/logic';
import { partNamespace, registerPart } from '../registry';
import type { CpuEditorCommand } from '../shared/cpu/types';
import { socBusOptions, socManager } from '../shared/socRuntime';
import { nios2Circ } from './circ';
import { drawNios2 } from './draw';
import { Nios2EditorRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import {
  BODY_HEIGHT,
  BODY_WIDTH,
  CLOCK_Y,
  CUSTOM_OUTPUTS,
  DONE_X,
  FIXED_INPUTS,
  MAX_ASM_SOURCE,
  RESET_Y,
  RESULT_X,
  cpuState,
  newCpu,
  pinPoints,
  withCpuState,
  withIrqWidth,
  type Nios2PartState,
} from './model';
import { entryOf } from './program';
import { cpuRuntime, peekCpu, syncCpus } from './runtime';
import { haltText, hex, runStateText, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** A 32-bit unsigned value from an attribute edit, or null */
const u32 = (value: string | number): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n < 2 ** 32 ? Math.trunc(n) >>> 0 : null;
};

type VectorKey = 'resetVector' | 'exceptionVector' | 'breakVector';

const vectorAttribute = (key: VectorKey) => ({
  key,
  kind: 'hex' as const,
  get: (comp: Parameters<typeof cpuState>[0]) => cpuState(comp)[key],
  set: (comp: Parameters<typeof cpuState>[0], value: string | number) => {
    const v = u32(value);
    return v === null || cpuState(comp)[key] === v ? null : { comp: withCpuState(comp, { [key]: v }), stateOnly: true };
  },
});

const FLOATING: SignalValue = 'Z';

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  inputs: [
    { id: 'reset', name: 'Reset', type: 'input', relX: 0, relY: RESET_Y },
    { id: 'clock', name: 'Clock', type: 'input', relX: 0, relY: CLOCK_Y },
    { id: 'done', name: 'done', type: 'input', relX: DONE_X, relY: 0 },
    { id: 'result', name: 'result', type: 'input', relX: RESULT_X, relY: 0, width: 32 },
  ],
  outputs: CUSTOM_OUTPUTS.map((p) => ({ id: p.id, name: p.id, type: 'output' as const, relX: p.x, relY: 0, ...(p.width > 1 ? { width: p.width } : {}) })),
  pinPoints,
  attributes: [
    {
      key: 'bus',
      kind: 'select',
      options: (comp) => socBusOptions(cpuState(comp).busId, 'attributes.bus.none', 'attributes.bus.missing'),
      get: (comp) => cpuState(comp).busId,
      set: (comp, value) => (cpuState(comp).busId === String(value) ? null : { comp: withCpuState(comp, { busId: String(value) }), stateOnly: true }),
    },
    vectorAttribute('resetVector'),
    vectorAttribute('exceptionVector'),
    vectorAttribute('breakVector'),
    {
      key: 'irqWidth',
      kind: 'select',
      options: range(0, NIOS2_MAX_IRQS).map((n) => ({ value: n, label: String(n) })),
      get: (comp) => cpuState(comp).irqWidth,
      set: (comp, value) => (cpuState(comp).irqWidth === Number(value) ? null : withIrqWidth(comp, Number(value))),
    },
    {
      key: 'stateVisible',
      kind: 'buttons',
      options: [
        { value: 1, labelKey: 'attributes.stateVisible.options.on' },
        { value: 0, labelKey: 'attributes.stateVisible.options.off' },
      ],
      get: (comp) => (cpuState(comp).stateVisible ? 1 : 0),
      set: (comp, value) => {
        const on = Number(value) === 1;
        return cpuState(comp).stateVisible === on ? null : { comp: withCpuState(comp, { stateVisible: on }), stateOnly: true };
      },
    },
    {
      key: 'program',
      kind: 'editor',
      singleOnly: true,
      editor: Nios2EditorRow,
      get: (comp) => cpuState(comp).asm ?? '',
      set: (comp, value) => {
        let cmd: CpuEditorCommand;
        try {
          cmd = JSON.parse(String(value)) as CpuEditorCommand;
        } catch {
          return null;
        }
        if (cmd?.op !== 'asm' || typeof cmd.text !== 'string') return null;
        const text = cmd.text.slice(0, MAX_ASM_SOURCE);
        return cpuState(comp).asm === text ? null : { comp: withCpuState(comp, { asm: text }), stateOnly: true };
      },
    },
    {
      key: 'status',
      kind: 'info',
      get: (comp) => {
        const s = cpuState(comp);
        if (!s.busId || !socManager.getBus(s.busId)) return t('status.notConnected');
        const core = peekCpu(comp.id)?.core;
        if (!core) return t('status.notRun');
        const base = t('status.summary', { state: runStateText(core.runState), pc: hex(core.pc) });
        if (core.halt) return `${base} — ${haltText(core.halt)}`;
        return core.customBusy ? `${base} — ${t('body.customWait')}` : base;
      },
    },
  ],
  draw: drawNios2,
  circ: nios2Circ,
  simulate(comp, ctx) {
    const s = cpuState(comp);
    const reset = ctx.raw[0];
    const clk = ctx.raw[1];
    const prev = s.lastClk ?? clk;
    const rt = peekCpu(comp.id) ?? cpuRuntime(entryOf(comp));
    const core = rt.core;
    // the custom-instruction inputs the core reads on this edge
    const done = ctx.raw[2];
    rt.custom.done = done === 1 ? true : done === 0 ? false : null;
    const bits = comp.inputs[3]?.bits;
    rt.custom.result = bits?.length === 32 ? (bitsToNumber(bits) ?? null) : null;
    if (reset === 1) core.reset();
    else {
      // evo: ipending follows the IRQ pins on every evaluation; one instruction per rising clock edge
      let lines = 0;
      for (let i = 0; i < s.irqWidth; i++) if (ctx.raw[FIXED_INPUTS + i] === 1) lines |= 1 << i;
      core.irqLines = lines >>> 0;
      if (prev === 0 && clk === 1) core.tick();
    }
    // the custom-instruction outputs: floating until the first custom instruction (evo never drives them before)
    const out = core.customOut;
    CUSTOM_OUTPUTS.forEach((p, i) => {
      if (!out) {
        ctx.setBitsOut(i, Array.from({ length: p.width }, () => FLOATING));
        return;
      }
      const v =
        p.id === 'start' ? (core.customStart ? 1 : 0) : p.id === 'readra' || p.id === 'readrb' || p.id === 'writerc' ? (out[p.id] ? 1 : 0) : out[p.id];
      ctx.setBitsOut(i, numberToBits(v >>> 0, p.width));
    });
    if (s.lastClk !== clk) comp.state.part = { ...s, lastClk: clk } satisfies Nios2PartState;
  },
  create: newCpu,
  // a CPU copied together with its bus masters the bus copy
  relink(comp, renamed) {
    const busId = renamed.get(cpuState(comp).busId);
    return busId ? withCpuState(comp, { busId }) : comp;
  },
  // a copy has its own core (its new component id); its program is not copied (memory contents are not either)
  copied(comp) {
    const { lastClk: _clk, ...rest } = cpuState(comp);
    return { ...comp, state: { ...comp.state, part: rest satisfies Nios2PartState } };
  },
  syncRun(comps) {
    syncCpus(comps.map(entryOf));
  },
  resetState(comp) {
    const { lastClk: _clk, ...s } = cpuState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies Nios2PartState;
  },
});
