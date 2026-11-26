// BLIF Circuit (Aşama 6a): a gate-level netlist given as BLIF text, simulated by the netlist engine.
//
// Logisim-evolution's counterpart is HDL-IP / BLIFCircuit. Its pins come from the text's .inputs and
// .outputs in evo's order; a text that does not parse keeps the old pins, shows the error and drives X.
import i18n, { registerNamespace } from '../../i18n';
import { levelOf, readNetlistOutputs, signalOf, stepNetlist, type NetlistError } from '../../netlist';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partNamespace, registerPart, type PartAttrEdit } from '../registry';
import { drawBlifCircuit } from './draw';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import {
  BODY_WIDTH,
  blifEntry,
  blifText,
  bodyHeight,
  bodySize,
  decodeRun,
  defaultPins,
  encodeRun,
  partState,
  pinPoints,
  pinsFor,
  pinsMatch,
  type BlifPartState,
} from './model';

registerNamespace(partNamespace(PART_ID), { en, tr });

const t = (key: string, params: Record<string, unknown> = {}): string => i18n.t(`${partNamespace(PART_ID)}:${key}`, params);

/** The translated text of an engine error, with its line */
export function errorText(e: NetlistError): string {
  const key = `netlistErrors.${e.code}`;
  const message = i18n.exists(`${partNamespace(PART_ID)}:${key}`) ? t(key, e.params) : e.message;
  return e.line === undefined ? message : t('errorAt', { line: e.line, message });
}

/** evo's GenericInterfaceComponent geometry (Logisim pixels) */

const snap = (v: number): number => Math.round(v / 10) * 10;

function setBlif(comp: CircuitComponentInstance, value: string | number): PartAttrEdit | null {
  const text = String(value).replace(/\r\n?/g, '\n');
  if (text === blifText(comp)) return null;
  const part: BlifPartState = { blif: text };
  const next: CircuitComponentInstance = { ...comp, state: { ...comp.state, part } };
  const entry = blifEntry(text);
  // a text with an error keeps the pins, so its wires stay while the user fixes it
  if (!entry.ok) return { comp: next, stateOnly: true };
  const pins = pinsFor(comp, entry.netlist);
  const edited = { ...next, inputs: pins.inputs, outputs: pins.outputs };
  const kept = new Set([...pins.inputs, ...pins.outputs].map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of [...comp.inputs, ...comp.outputs]) remap.set(`${snap(p.x)},${snap(p.y)}`, kept.has(p.id) ? p.id : null);
  return { comp: edited, remap };
}

const defaults = defaultPins();

registerPart({
  id: PART_ID,
  category: 'combinational',
  group: 'hdl',
  width: BODY_WIDTH,
  height: bodyHeight(Math.max(defaults.inputs.length, defaults.outputs.length)),
  inputs: defaults.inputs,
  outputs: defaults.outputs,
  size: bodySize,
  pinPoints,
  draw: drawBlifCircuit,
  attributes: [
    {
      key: 'blif',
      kind: 'multiline',
      singleOnly: true,
      get: blifText,
      set: (comp, value) => setBlif(comp, value),
    },
    {
      key: 'summary',
      kind: 'info',
      get: (comp) => {
        const entry = blifEntry(blifText(comp));
        if (!entry.ok) return t('summary.error', { message: errorText(entry.error) });
        const { netlist, compiled } = entry;
        return t('summary.ok', {
          model: netlist.name || '—',
          inputs: netlist.inputs.length,
          outputs: netlist.outputs.length,
          cells: compiled.stats.cells,
        });
      },
    },
  ],
  simulate(comp, ctx) {
    const state = partState(comp);
    const entry = blifEntry(state.blif);
    if (!entry.ok || !pinsMatch(comp, entry.compiled)) {
      comp.outputs.forEach((p, i) => ctx.setBitsOut(i, Array.from({ length: p.width ?? 1 }, () => 'X' as const)));
      return;
    }
    const c = entry.compiled;
    const run = decodeRun(c, state.run);
    const inputs = comp.inputs.map((p, i) => {
      const bits = (p.width ?? 1) > 1 ? (p.bits ?? []) : [ctx.raw[i]];
      return Array.from({ length: p.width ?? 1 }, (_, b) => levelOf(bits[b] ?? 'Z'));
    });
    stepNetlist(c, run, inputs);
    readNetlistOutputs(c, run).forEach((levels, i) => ctx.setBitsOut(i, levels.map(signalOf)));
    const encoded = encodeRun(run);
    if (encoded !== state.run) comp.state.part = { ...state, run: encoded } satisfies BlifPartState;
  },
  resetState(comp) {
    const state = comp.state.part as BlifPartState | undefined;
    if (state?.run !== undefined) comp.state.part = { blif: state.blif } satisfies BlifPartState;
  },
});
