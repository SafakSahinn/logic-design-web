// SoC Bus (Aşama 6e), as Logisim-evolution's SoC "SocBus": the bus a SoC's processors, memories and peripherals
// share. Nothing is wired to it except its Reset input; the other SoC parts name its bus id in their Bus attribute.
// The body shows the newest transactions; Reset high clears the trace.
import { registerNamespace } from '../../i18n';
import { partNamespace, registerPart } from '../registry';
import { peekSocBus, syncSocBuses } from '../shared/socRuntime';
import { drawSocBus } from './draw';
import { SocBusEditorRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import {
  BODY_WIDTH,
  ROW_HEIGHT,
  TRACE_SIZE_DEFAULT,
  TRACE_SIZE_MAX,
  TRACE_SIZE_MIN,
  busIdOf,
  busName,
  busSize,
  busState,
  newBus,
  withBusState,
  type SocBusPartState,
} from './model';
import { t } from './text';
import { newSocBusId } from '../../soc';

registerNamespace(partNamespace(PART_ID), { en, tr });

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

registerPart({
  id: PART_ID,
  category: 'sequential',
  group: 'soc',
  width: BODY_WIDTH,
  height: (TRACE_SIZE_DEFAULT + 1) * ROW_HEIGHT,
  inputs: [{ id: 'reset', name: 'Reset', type: 'input', relX: 0, relY: 10 }],
  outputs: [],
  size: busSize,
  attributes: [
    {
      key: 'traceSize',
      kind: 'select',
      options: range(TRACE_SIZE_MIN, TRACE_SIZE_MAX).map((n) => ({ value: n, label: String(n) })),
      get: (comp) => busState(comp).traceSize,
      set: (comp, value) => (busState(comp).traceSize === Number(value) ? null : { comp: withBusState(comp, { traceSize: Number(value) }), stateOnly: true }),
    },
    {
      key: 'traceVisible',
      kind: 'buttons',
      options: [
        { value: 1, labelKey: 'attributes.traceVisible.options.on' },
        { value: 0, labelKey: 'attributes.traceVisible.options.off' },
      ],
      get: (comp) => (busState(comp).traceVisible ? 1 : 0),
      set: (comp, value) => {
        const on = Number(value) === 1;
        return busState(comp).traceVisible === on ? null : { comp: withBusState(comp, { traceVisible: on }), stateOnly: true };
      },
    },
    {
      key: 'bus',
      kind: 'editor',
      singleOnly: true,
      editor: SocBusEditorRow,
      get: (comp) => busIdOf(comp),
    },
    {
      key: 'status',
      kind: 'info',
      get: (comp) => {
        const bus = peekSocBus(busIdOf(comp));
        return t('status.summary', { slaves: bus?.getSlaves().length ?? 0, count: bus ? bus.trace.firstIndex + bus.trace.size : 0 });
      },
    },
  ],
  draw: drawSocBus,
  simulate(comp, ctx) {
    // evo: Reset high clears the trace
    if (ctx.raw[0] === 1) peekSocBus(busIdOf(comp))?.trace.clear();
  },
  create: newBus,
  // evo's copyInto: a copy of a bus still in the circuit is a new bus (slaves copied with it follow it, the others
  // stay with the original); an id no other bus holds any more (cut and paste) is kept
  copied(comp, ctx) {
    const old = busIdOf(comp);
    if (!ctx.others.some((c) => c.type === comp.type && busIdOf(c) === old)) return comp;
    const busId = newSocBusId();
    ctx.renamed.set(old, busId);
    return withBusState(comp, { busId });
  },
  syncRun(comps) {
    syncSocBuses(comps.map((c) => ({ id: busIdOf(c), owner: c.id, name: busName(c), epoch: busState(c).epoch ?? 0 })));
  },
  resetState(comp) {
    // a simulation reset clears the trace (the next run sees the new epoch)
    const s = busState(comp);
    comp.state.part = { ...s, epoch: (s.epoch ?? 0) + 1 } satisfies SocBusPartState;
  },
});
