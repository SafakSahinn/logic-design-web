// RV32IM processor (Aşama 6f), as Logisim-evolution's SoC "Rv32im": a RISC-V RV32IM core that executes one
// instruction per rising clock edge, fetching and accessing data as transactions on its SoC bus, with a minimal PLIC
// (a slave on the same bus) whose sources are the IRQ pins. Reset high resets the core. Programs are loaded from an
// ELF file or the assembler window; the body shows the registers, the pc and the execution trace.
import { registerNamespace } from '../../i18n';
import { MAX_IRQS } from '../../soc';
import { partNamespace, registerPart } from '../registry';
import { parseU32 as u32, socBusOptions, socManager } from '../shared/socRuntime';
import { rv32imCirc } from './circ';
import { drawRv32im } from './draw';
import type { CpuEditorCommand as EditorCommand } from '../shared/cpu/types';
import { Rv32imEditorRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { BODY_HEIGHT, BODY_WIDTH, CLOCK_Y, MAX_ASM_SOURCE, RESET_Y, cpuName, cpuState, newCpu, pinPoints, withCpuState, withIrqWidth, type Rv32imPartState } from './model';
import { cpuRuntime, peekCpu, syncCpus } from './runtime';
import { haltText, hex, runStateText, t } from './text';

registerNamespace(partNamespace(PART_ID), { en, tr });

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

const entryOf = (comp: Parameters<typeof cpuState>[0]) => {
  const s = cpuState(comp);
  return { key: comp.id, busId: s.busId, name: cpuName(comp), resetVector: s.resetVector, plicBase: s.plicBase, irqWidth: s.irqWidth, epoch: s.epoch ?? 0 };
};

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: BODY_HEIGHT,
  inputs: [
    { id: 'reset', name: 'Reset', type: 'input', relX: 0, relY: RESET_Y },
    { id: 'clock', name: 'Clock', type: 'input', relX: 0, relY: CLOCK_Y },
  ],
  outputs: [],
  pinPoints,
  attributes: [
    {
      key: 'bus',
      kind: 'select',
      options: (comp) => socBusOptions(cpuState(comp).busId, 'attributes.bus.none', 'attributes.bus.missing'),
      get: (comp) => cpuState(comp).busId,
      set: (comp, value) => (cpuState(comp).busId === String(value) ? null : { comp: withCpuState(comp, { busId: String(value) }), stateOnly: true }),
    },
    {
      key: 'resetVector',
      kind: 'hex',
      get: (comp) => cpuState(comp).resetVector,
      set: (comp, value) => {
        const v = u32(value);
        return v === null || cpuState(comp).resetVector === v ? null : { comp: withCpuState(comp, { resetVector: v }), stateOnly: true };
      },
    },
    {
      key: 'irqWidth',
      kind: 'select',
      options: range(0, MAX_IRQS).map((n) => ({ value: n, label: String(n) })),
      get: (comp) => cpuState(comp).irqWidth,
      set: (comp, value) => (cpuState(comp).irqWidth === Number(value) ? null : withIrqWidth(comp, Number(value))),
    },
    {
      key: 'plicBase',
      kind: 'hex',
      get: (comp) => cpuState(comp).plicBase,
      set: (comp, value) => {
        const v = u32(value);
        if (v === null) return null;
        const base = (v & ~3) >>> 0;
        return cpuState(comp).plicBase === base ? null : { comp: withCpuState(comp, { plicBase: base }), stateOnly: true };
      },
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
      editor: Rv32imEditorRow,
      get: (comp) => cpuState(comp).asm ?? '',
      set: (comp, value) => {
        let cmd: EditorCommand;
        try {
          cmd = JSON.parse(String(value)) as EditorCommand;
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
        const base = t('status.summary', { state: runStateText(core.runState), pc: hex(core.pc), plic: hex(s.plicBase) });
        return core.halt ? `${base} — ${haltText(core.halt)}` : base;
      },
    },
  ],
  draw: drawRv32im,
  circ: rv32imCirc,
  simulate(comp, ctx) {
    const s = cpuState(comp);
    const reset = ctx.raw[0];
    const clk = ctx.raw[1];
    const prev = s.lastClk ?? clk;
    const rt = peekCpu(comp.id) ?? cpuRuntime(entryOf(comp));
    if (reset === 1) rt.core.reset();
    else {
      // evo: the PLIC follows the IRQ pins on every evaluation; one instruction per rising clock edge
      const levels: boolean[] = [];
      for (let i = 0; i < s.irqWidth; i++) levels.push(ctx.raw[2 + i] === 1);
      rt.plic.updateIrqs(levels);
      rt.core.csr.meip = rt.plic.interruptPending;
      if (prev === 0 && clk === 1) rt.core.tick();
    }
    if (s.lastClk !== clk) comp.state.part = { ...s, lastClk: clk } satisfies Rv32imPartState;
  },
  create: newCpu,
  // a CPU copied together with its bus masters the bus copy
  relink(comp, renamed) {
    const busId = renamed.get(cpuState(comp).busId);
    return busId ? withCpuState(comp, { busId }) : comp;
  },
  // a copy has its own core (its new component id); its program is not copied (memory contents are not either)
  copied(comp) {
    const s = cpuState(comp);
    const { lastClk: _clk, ...rest } = s;
    return { ...comp, state: { ...comp.state, part: rest satisfies Rv32imPartState } };
  },
  syncRun(comps) {
    syncCpus(comps.map(entryOf));
  },
  resetState(comp) {
    const { lastClk: _clk, ...s } = cpuState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies Rv32imPartState;
  },
});
