// Logisim .circ export / import of the TCL Generic part (evo's TCL / "TclGeneric").
//
// evo keeps the interface (the VHDL entity, "content") in the file and runs the script from an external .tcl file
// ("filePath") in its own tclsh. The script text goes into one more attribute that evo ignores when it opens the
// file (and drops when it saves it), so a file written here opens here with its script. The run state (tick,
// outputs, console) is not written: an imported part starts from power-on.
import type { CircuitComponentInstance } from '../../types/circuit';
import type { PartCirc } from '../registry';
import { evoPorts, pinsFor, type PortShape } from '../shared/netlistPart';
import { readEvoVhdl } from '../vhdlEntity/evo';
import { defaultScriptFileName, partState, readInterface, scriptFileName, scriptFilePath, type TclPartState } from './model';
import { DEFAULT_SCRIPT } from './defaults';
import { t } from './text';

/** LDS-only attribute: the script text (evo ignores attribute names it does not know) */
export const ATTR_SCRIPT = 'lds-tcl';

const shapes = (pins: CircuitComponentInstance['inputs']): PortShape[] => pins.map((p) => ({ name: p.name, width: p.width ?? 1 }));

const samePorts = (a: PortShape[], b: PortShape[]) =>
  a.length === b.length && a.every((p, i) => p.width === b[i].width && p.name.toLowerCase() === b[i].name.toLowerCase());

function exportWarnings(comp: CircuitComponentInstance): string[] {
  const s = partState(comp);
  const out: string[] = [];
  // evo places the pins from its own reading of the interface (its VHDL Entity's reader)
  const read = readEvoVhdl(s.vhdl);
  if (!read.ok) {
    const { ok: _ok, ...failure } = read;
    out.push(t('evo.unreadable', { reason: t(`evo.reason.${failure.code}`, failure) }));
  } else if (!samePorts(read.inputs, shapes(comp.inputs)) || !samePorts(read.outputs, shapes(comp.outputs))) {
    out.push(t('evo.ports'));
  }
  out.push(t('evo.scriptFile', { path: scriptFilePath(comp), file: scriptFileName(comp) }));
  return out;
}

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const normalise = (text: string) => text.replace(/\r\n?/g, '\n');
  const state: TclPartState = { vhdl: attrs.content !== undefined ? normalise(attrs.content) : partState(comp).vhdl, script: DEFAULT_SCRIPT };
  const file = attrs.filePath ?? '';
  const script = attrs[ATTR_SCRIPT];
  if (script !== undefined) state.script = normalise(script);
  // keep evo's path unless it is the one export would write anyway (then it follows the label / entity)
  // (the label is set by the importer after this, so the comparison takes it from the file)
  const withFile = { ...comp, label: attrs.label ?? comp.label, state: { ...comp.state, part: state } };
  if (file !== '' && file !== defaultScriptFileName(withFile)) state.filePath = file;
  if (script === undefined) warn(t('evo.importNoScript', { path: file || '—' }));
  // the pins: the interface as read here, else as evo reads it
  const iface = readInterface(state.vhdl);
  let ports: { inputs: PortShape[]; outputs: PortShape[] } | undefined = iface.ok ? { inputs: iface.inputs, outputs: iface.outputs } : undefined;
  if (!ports) {
    const evo = readEvoVhdl(state.vhdl);
    if (evo.ok) ports = { inputs: evo.inputs, outputs: evo.outputs };
  }
  if (!ports) {
    warn(t('evo.importNoPorts'));
    ports = { inputs: [], outputs: [] };
  }
  const pins = pinsFor(comp, ports.inputs, ports.outputs);
  return { ...comp, state: { ...comp.state, part: state }, inputs: pins.inputs, outputs: pins.outputs };
}

export const tclGenericCirc: PartCirc = {
  lib: '#TCL',
  name: 'TclGeneric',
  labelled: true,
  exportAttrs: (comp) => {
    const s = partState(comp);
    return { filePath: scriptFilePath(comp), content: s.vhdl, [ATTR_SCRIPT]: s.script };
  },
  exportWarnings,
  // TclComponent's geometry is evo's GenericInterfaceComponent's: loc top-left, inputs west, outputs east
  ports: evoPorts,
  importAttrs,
};
