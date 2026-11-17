// Logisim .circ export / import of the VHDL Entity part (evo's HDL-IP / "VHDL Entity").
//
// Evo keeps only the text ("content"). The generics and the stored netlist go into two more attributes that
// evo ignores when it opens the file (and drops when it saves it), so a file written here opens here with its
// netlist and simulates without the tools.
import { isStoredNetlist, type StoredNetlist } from '../../hdl';
import type { CircuitComponentInstance } from '../../types/circuit';
import type { PartCirc } from '../registry';
import { evoPorts, pinsFor, type PortShape } from '../shared/netlistPart';
import { evoIssues, readEvoVhdl, type EvoIssue } from './evo';
import { currentKey, netlistEntry, partState, wantedPorts, type VhdlPartState } from './model';
import { errorText, t } from './text';

/** LDS-only attributes (evo ignores attribute names it does not know) */
export const ATTR_GENERICS = 'lds-generics';
export const ATTR_NETLIST = 'lds-netlist';

/** What ATTR_NETLIST holds */
interface NetlistAttr {
  netlistOf: string;
  netlist: StoredNetlist;
}

const shapes = (pins: CircuitComponentInstance['inputs']): PortShape[] => pins.map((p) => ({ name: p.name, width: p.width ?? 1 }));

function issueText(issue: EvoIssue): string {
  if (issue.code === 'unreadable') {
    return t('evo.unreadable', { reason: t(`evo.reason.${issue.failure.code}`, issue.failure) });
  }
  return t(`evo.${issue.code}`, issue);
}

function exportWarnings(comp: CircuitComponentInstance): string[] {
  const s = partState(comp);
  const out = evoIssues(s.vhdl, s.generics, { inputs: shapes(comp.inputs), outputs: shapes(comp.outputs) }).map(issueText);
  if (!s.netlist) out.push(t('evo.notSynthesized'));
  out.push(t('evo.simulation'));
  return out;
}

/** The stored netlist of a file, or why it cannot be used */
function readNetlistAttr(raw: string): NetlistAttr | undefined {
  try {
    const v = JSON.parse(raw) as Partial<NetlistAttr> | null;
    if (v && typeof v.netlistOf === 'string' && isStoredNetlist(v.netlist)) return { netlistOf: v.netlistOf, netlist: v.netlist };
  } catch {
    // reported by the caller
  }
  return undefined;
}

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  if (attrs.content === undefined) return comp;
  const vhdl = attrs.content.replace(/\r\n?/g, '\n');
  const generics = (attrs[ATTR_GENERICS] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 400);
  const state: VhdlPartState = { vhdl, generics };
  const raw = attrs[ATTR_NETLIST];
  if (raw === undefined) {
    warn(t('evo.importNoNetlist'));
  } else {
    const stored = readNetlistAttr(raw);
    if (!stored) {
      warn(t('evo.importNetlistBroken'));
    } else {
      state.netlist = stored.netlist;
      state.netlistOf = stored.netlistOf;
      const entry = netlistEntry(stored.netlist);
      if (!entry.ok) warn(t('evo.importNetlistUnusable', { message: errorText(entry.error) }));
      else if (stored.netlistOf !== currentKey(state)) warn(t('evo.importStale'));
    }
  }
  // the pins: the netlist's or the text's (wantedPorts), else the old netlist's, else what evo reads
  let ports = wantedPorts(state);
  if (!ports && state.netlist) ports = { inputs: state.netlist.inputs, outputs: state.netlist.outputs };
  if (!ports) {
    const evo = readEvoVhdl(vhdl);
    if (evo.ok) ports = { inputs: evo.inputs, outputs: evo.outputs };
  }
  if (!ports) {
    warn(t('evo.importNoPorts'));
    ports = { inputs: [], outputs: [] };
  }
  const shape = (list: PortShape[]) => list.map((p) => ({ name: p.name, width: p.width }));
  const pins = pinsFor(comp, shape(ports.inputs), shape(ports.outputs));
  return { ...comp, state: { ...comp.state, part: state }, inputs: pins.inputs, outputs: pins.outputs };
}

export const vhdlEntityCirc: PartCirc = {
  lib: '#HDL-IP',
  name: 'VHDL Entity',
  labelled: true,
  exportAttrs: (comp) => {
    const s = partState(comp);
    const attrs: Record<string, string> = { content: s.vhdl };
    if (s.generics !== '') attrs[ATTR_GENERICS] = s.generics;
    if (s.netlist) attrs[ATTR_NETLIST] = JSON.stringify({ netlistOf: s.netlistOf ?? '', netlist: s.netlist } satisfies NetlistAttr);
    return attrs;
  },
  exportWarnings,
  // evo's GenericInterfaceComponent, as for the BLIF Circuit
  ports: evoPorts,
  importAttrs,
};
