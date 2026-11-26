// Logisim .circ export / import of the Verilog Entity part.
//
// Logisim-evolution has no Verilog component, so the part is written as its HDL-IP "BLIFCircuit" whose text is
// the stored netlist rewritten in evo's own cells (netlist/evoBlif): evo opens it and simulates it. The
// Verilog text, the parameters and the stored netlist go into LDS-only attributes that evo ignores when it
// opens the file and drops when it saves it. On import a BLIFCircuit with the Verilog attribute comes back as
// this part; without it (e.g. after evo saved the file) it stays a plain BLIF Circuit.
import { isStoredNetlist, type StoredNetlist } from '../../../hdl';
import { evoBitNames, evoBlifPorts, writeEvoBlif, type EvoBlifPort, type Netlist } from '../../../netlist';
import type { CircuitComponentInstance } from '../../../types/circuit';
import type { PartCirc } from '../partCirc';
import { EVO_PIN_GAP, EVO_PIN_TOP, EVO_WIDTH, pinsFor, pinsSame, type PortShape } from '../../../parts/shared/netlistPart';
import { currentKey, netlistEntry, partState, preview, wantedPorts, type VerilogPartState } from '../../../parts/verilogEntity/model';
import { errorText, t } from '../../../parts/verilogEntity/text';

/** LDS-only attributes (evo ignores attribute names it does not know) */
export const ATTR_VERILOG = 'lds-verilog';
export const ATTR_PARAMETERS = 'lds-parameters';
export const ATTR_NETLIST = 'lds-netlist';

/** What ATTR_NETLIST holds */
interface NetlistAttr {
  netlistOf: string;
  netlist: StoredNetlist;
}

const pinPorts = (pins: CircuitComponentInstance['inputs']): EvoBlifPort[] => pins.map((p) => ({ name: p.name, width: p.width ?? 1 }));

/** Why the written BLIF is not the stored netlist, or that it is an older one */
type ExportCase = { code: 'ok' | 'stale' | 'notSynthesized' | 'staleMismatch' } | { code: 'unusable'; message: string };

interface EvoExport {
  blif: string;
  case: ExportCase;
  initOnes: number;
}

const EMPTY: Netlist = { name: '', inputs: [], outputs: [], cells: [] };

// written BLIF per compiled netlist (parts with one netlist share it) and pin set
const written = new WeakMap<Netlist, Map<string, { text: string; initOnes: number }>>();

function writeFor(netlist: Netlist, inputs: EvoBlifPort[], outputs: EvoBlifPort[]): { text: string; initOnes: number } {
  const key = JSON.stringify([inputs, outputs]);
  let byPins = written.get(netlist);
  if (!byPins) written.set(netlist, (byPins = new Map()));
  let hit = byPins.get(key);
  if (!hit) {
    hit = writeEvoBlif(netlist, inputs, outputs);
    byPins.set(key, hit);
    if (byPins.size > 8) byPins.delete(byPins.keys().next().value!);
  }
  return hit;
}

/**
 * The BLIF written for the part. Its ports are always the part's pins; when no stored netlist can drive them
 * the outputs are left undefined, so the pins and their wires still open in evo.
 */
function evoExport(comp: CircuitComponentInstance): EvoExport {
  const s = partState(comp);
  const inputs = pinPorts(comp.inputs);
  const outputs = pinPorts(comp.outputs);
  const placeholder = (c: ExportCase): EvoExport => {
    const p = preview(s);
    const name = s.netlist?.top ?? (p.ok ? p.module.name : '');
    return { blif: writeFor({ ...EMPTY, name }, inputs, outputs).text, case: c, initOnes: 0 };
  };
  if (!s.netlist) return placeholder({ code: 'notSynthesized' });
  const entry = netlistEntry(s.netlist);
  if (!entry.ok) return placeholder({ code: 'unusable', message: errorText(entry.error) });
  const shape = (list: StoredNetlist['inputs']): PortShape[] => list.map((p) => ({ name: p.name, width: p.width }));
  if (!pinsSame(comp, shape(s.netlist.inputs), shape(s.netlist.outputs))) return placeholder({ code: 'staleMismatch' });
  const w = writeFor(entry.netlist, inputs, outputs);
  return { blif: w.text, case: { code: s.netlistOf === currentKey(s) ? 'ok' : 'stale' }, initOnes: w.initOnes };
}

/** Evo's connection point of each pin; null for a pin evo would read under another name or width */
function ports(comp: CircuitComponentInstance): { inputs: ({ x: number; y: number } | null)[]; outputs: ({ x: number; y: number } | null)[] } {
  const inputs = pinPorts(comp.inputs);
  const outputs = pinPorts(comp.outputs);
  const evo = evoBlifPorts(inputs.flatMap(evoBitNames), outputs.flatMap(evoBitNames));
  const place = (list: EvoBlifPort[], read: EvoBlifPort[], x: number) =>
    list.map((p) => {
      const i = read.findIndex((r) => r.name === p.name && r.width === p.width);
      return i < 0 ? null : { x, y: EVO_PIN_TOP + EVO_PIN_GAP * i };
    });
  return { inputs: place(inputs, evo.inputs, 0), outputs: place(outputs, evo.outputs, EVO_WIDTH) };
}

function exportWarnings(comp: CircuitComponentInstance): string[] {
  const e = evoExport(comp);
  const out: string[] = [];
  if (e.case.code === 'unusable') out.push(t('evo.unusable', { message: e.case.message }));
  else if (e.case.code !== 'ok') out.push(t(`evo.${e.case.code}`));
  if (e.initOnes > 0) out.push(t('evo.initOne', { count: e.initOnes }));
  const p = ports(comp);
  const lost = [...comp.inputs.filter((_, i) => !p.inputs[i]), ...comp.outputs.filter((_, i) => !p.outputs[i])].map((pin) => pin.name);
  if (lost.length > 0) out.push(t('evo.pinsLost', { names: lost.join(', ') }));
  out.push(t('evo.blifOnly'));
  return out;
}

/** The stored netlist of a file, or undefined when it cannot be read */
function readNetlistAttr(raw: string): NetlistAttr | undefined {
  try {
    const v = JSON.parse(raw) as Partial<NetlistAttr> | null;
    if (v && typeof v.netlistOf === 'string' && isStoredNetlist(v.netlist)) return { netlistOf: v.netlistOf, netlist: v.netlist };
  } catch {
    // reported by the caller
  }
  return undefined;
}

/** The ports evo reads from a BLIF text's .inputs / .outputs lines */
function blifPorts(text: string): { inputs: EvoBlifPort[]; outputs: EvoBlifPort[] } {
  const inputs: string[] = [];
  const outputs: string[] = [];
  for (const raw of text.split('\n')) {
    const words = raw.trim().split(' ');
    if (words[0] === '.inputs') inputs.push(...words.slice(1).filter((w) => w !== ''));
    else if (words[0] === '.outputs') outputs.push(...words.slice(1).filter((w) => w !== ''));
  }
  return evoBlifPorts(inputs, outputs);
}

function importAttrs(comp: CircuitComponentInstance, attrs: Record<string, string>, warn: (text: string) => void): CircuitComponentInstance {
  const verilog = attrs[ATTR_VERILOG];
  if (verilog === undefined) return comp;
  const state: VerilogPartState = {
    verilog: verilog.replace(/\r\n?/g, '\n'),
    parameters: (attrs[ATTR_PARAMETERS] ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 400),
  };
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
  // the pins: the netlist's or the text's (wantedPorts), else the old netlist's, else the written BLIF's
  let pins: { inputs: PortShape[]; outputs: PortShape[] } | undefined = wantedPorts(state);
  if (!pins && state.netlist) pins = { inputs: state.netlist.inputs, outputs: state.netlist.outputs };
  if (!pins && attrs.content !== undefined) {
    const read = blifPorts(attrs.content.replace(/\r\n?/g, '\n'));
    if (read.inputs.length + read.outputs.length > 0) pins = read;
  }
  if (!pins) {
    warn(t('evo.importNoPorts'));
    pins = { inputs: [], outputs: [] };
  }
  const shape = (list: PortShape[]) => list.map((p) => ({ name: p.name, width: p.width }));
  const made = pinsFor(comp, shape(pins.inputs), shape(pins.outputs));
  return { ...comp, state: { ...comp.state, part: state }, inputs: made.inputs, outputs: made.outputs };
}

export const verilogEntityCirc: PartCirc = {
  lib: '#HDL-IP',
  // evo's BLIF Circuit; the BLIF Circuit part takes the components without the Verilog attribute
  name: 'BLIFCircuit',
  labelled: true,
  claims: (attrs) => attrs[ATTR_VERILOG] !== undefined,
  exportAttrs: (comp) => {
    const s = partState(comp);
    const attrs: Record<string, string> = { content: evoExport(comp).blif, [ATTR_VERILOG]: s.verilog };
    if (s.parameters !== '') attrs[ATTR_PARAMETERS] = s.parameters;
    if (s.netlist) attrs[ATTR_NETLIST] = JSON.stringify({ netlistOf: s.netlistOf ?? '', netlist: s.netlist } satisfies NetlistAttr);
    return attrs;
  },
  exportWarnings,
  ports,
  importAttrs,
};
