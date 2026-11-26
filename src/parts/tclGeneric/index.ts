// TCL Generic (Aşama 6d): a part whose pins come from a VHDL entity and whose behaviour is a Tcl script, as
// Logisim-evolution's TCL / "TCL Generic". evo runs the script in an external tclsh; here it runs in a sandboxed
// in-process Tcl (wacl, src/tools/tcl), on the desktop and on the web alike. See engine.ts for the protocol.
import { registerNamespace } from '../../i18n';
import { currentTclRuntime } from '../../tools/tcl';
import type { CircuitComponentInstance } from '../../types/circuit';
import { partNamespace, registerPart } from '../registry';
import { BODY_WIDTH, bodyHeight, bodySize, pinPoints } from '../shared/netlistPart';
import vhdlEn from '../vhdlEntity/locales/en.json';
import vhdlTr from '../vhdlEntity/locales/tr.json';
import { drawTclGeneric } from './draw';
import { TclEditorRow } from './editor';
import { simulateTcl } from './engine';
import { PART_ID } from './id';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { applyEditorCommand, defaultPins, partState, powerOn, readInterface, type TclPartState } from './model';
import { interfaceErrorText, scriptErrorText, t } from './text';

// The interface is read by the VHDL Entity's reader, so its error texts are shared
registerNamespace(partNamespace(PART_ID), { en: { ...en, hdlErrors: vhdlEn.hdlErrors }, tr: { ...tr, hdlErrors: vhdlTr.hdlErrors } });

/** The status row: what runs now */
function statusText(comp: CircuitComponentInstance): string {
  const s = partState(comp);
  const iface = readInterface(s.vhdl);
  if (!iface.ok) return t('status.interface', { message: interfaceErrorText(iface.error) });
  if (s.error) return scriptErrorText(s.error);
  if (!currentTclRuntime()) return s.out ? t('status.heldNoRuntime') : t('status.noRuntime');
  return t('status.running', { inputs: comp.inputs.length, outputs: comp.outputs.length });
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
  draw: drawTclGeneric,
  attributes: [
    {
      key: 'tcl',
      kind: 'editor',
      singleOnly: true,
      editor: TclEditorRow,
      get: (comp) => partState(comp).script,
      set: (comp, value) => applyEditorCommand(comp, value),
    },
    {
      key: 'status',
      kind: 'info',
      get: statusText,
    },
  ],
  simulate: simulateTcl,
  resetState(comp) {
    // a simulation reset starts the script again (a new epoch gets a new interpreter), as evo restarts its tclsh
    const state = comp.state.part as TclPartState | undefined;
    if (!state || typeof state.script !== 'string') return;
    comp.state.part = { ...powerOn(state), epoch: (state.epoch ?? 0) + 1 } satisfies TclPartState;
  },
});
