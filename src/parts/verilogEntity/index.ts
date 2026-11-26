// Verilog Entity (Aşama 6c): a Verilog / SystemVerilog design synthesized to a gate netlist by Yosys (src/hdl)
// and simulated by the netlist engine.
//
// Logisim-evolution has no Verilog component (its HDL-IP library has only VHDL Entity and BLIF Circuit).
// Here Yosys runs when the user asks: the installed program on the desktop, its WebAssembly build on the web.
// The netlist is stored in the part, so a file opens and simulates without running Yosys again.
import { registerNamespace } from '../../i18n';
import { levelOf, readNetlistOutputs, signalOf, stepNetlist } from '../../netlist';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partNamespace, registerPart } from '../registry';
import { BODY_WIDTH, bodyHeight, bodySize, decodeRun, encodeRun, pinPoints, pinsMatch } from '../shared/netlistPart';
import { drawVerilogEntity } from './draw';
import { VerilogEditorRow } from './editor';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { errorText, t } from './text';
import { applyEditorCommand, defaultPins, netlistEntry, newPartState, partState, setParameters, synthStatus, type VerilogPartState } from './model';

registerNamespace(partNamespace(PART_ID), { en, tr });

/** The netlist row: what simulates now */
function statusText(comp: CircuitComponentInstance): string {
  const s = partState(comp);
  const status = synthStatus(s);
  const errors = (s.diagnostics ?? []).filter((d) => d.severity === 'error').length;
  if (!s.netlist) return status === 'failed' ? t('status.failed', { count: errors }) : t('status.none');
  const entry = netlistEntry(s.netlist);
  if (!entry.ok) return t('status.broken', { message: errorText(entry.error) });
  const runs = pinsMatch(comp, entry.compiled);
  if (status === 'failed') return runs ? t('status.failedRunning', { count: errors }) : t('status.failed', { count: errors });
  if (status === 'stale') return runs ? t('status.stale') : t('status.staleMismatch');
  return t('status.ok', { top: s.netlist.top, inputs: s.netlist.inputs.length, outputs: s.netlist.outputs.length, cells: entry.compiled.stats.cells });
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
  draw: drawVerilogEntity,
  attributes: [
    {
      key: 'verilog',
      kind: 'editor',
      singleOnly: true,
      editor: VerilogEditorRow,
      get: (comp) => partState(comp).verilog,
      set: (comp, value) => applyEditorCommand(comp, value),
    },
    {
      key: 'parameters',
      kind: 'text',
      maxLength: 400,
      get: (comp) => partState(comp).parameters,
      set: (comp, value) => setParameters(comp, value),
    },
    {
      key: 'status',
      kind: 'info',
      get: statusText,
    },
  ],
  simulate(comp, ctx) {
    const state = partState(comp);
    const entry = state.netlist && netlistEntry(state.netlist);
    if (!entry || !entry.ok || !pinsMatch(comp, entry.compiled)) {
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
    if (encoded !== state.run) comp.state.part = { ...(comp.state.part as VerilogPartState | undefined ?? newPartState()), run: encoded } satisfies VerilogPartState;
  },
  resetState(comp) {
    const state = comp.state.part as VerilogPartState | undefined;
    if (state?.run !== undefined) {
      const { run: _run, ...rest } = state;
      comp.state.part = rest satisfies VerilogPartState;
    }
  },
});
