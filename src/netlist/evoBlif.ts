// Writes a Netlist as BLIF that Logisim-evolution's BLIF Circuit (std/hdl/BlifParser) can load.
//
// Evo knows only its own gate cells: the binary gates AND OR XOR NAND NOR NXOR ANDNOT ORNOT TRIS TRISI, and
// BUF NOT MUX DFF DFFSR DLATCH PULLUP PULLDOWN, all with active-high controls. It takes .names only as the
// constants $true / $false / $undef. So every cell is rebuilt from those:
// - a cover becomes a sum of products of 2-input gates (common covers map to one gate);
// - a flip-flop's clock polarity, enable and sync reset become gates in front of DFF; async loads become
//   DFFSR's S and R, masked so their priority does not depend on evo's (R wins there);
// - a latch's async loads open the latch and steer its data (evo's DLATCH has none).
// Evo powers flip-flops and latches up at 0.
//
// Ports are written as evo reads them: a 1-bit port by its name, a wider one as name[0] .. name[w-1].
// Every internal net is renamed, so no net name can collide with a port name.
import { NET_FALSE, NET_TRUE, NET_UNDEF, type Netlist, type NetlistCtl, type NetlistLoad, type NetlistLut, type NetlistSeq } from './ir';

/** A port as the written BLIF declares it */
export interface EvoBlifPort {
  name: string;
  width: number;
}

export interface EvoBlifResult {
  text: string;
  /** Storage cells whose power-on value is 1 (evo starts them at 0) */
  initOnes: number;
}

/** BLIF names of a port's bits, as evo's BlifParser reads them back */
export const evoBitNames = (port: EvoBlifPort): string[] =>
  port.width === 1 ? [port.name] : Array.from({ length: port.width }, (_, i) => `${port.name}[${i}]`);

/**
 * The ports evo's BlifParser makes of .inputs / .outputs names, in its order (its parseNameSet): a name in
 * both lists is an output; single names first, sorted; then buses "p[i]" sorted by prefix, as wide as their
 * highest bit + 1; a one-bit bus keeps its "[0]" name.
 */
export function evoBlifPorts(inputs: string[], outputs: string[]): { inputs: EvoBlifPort[]; outputs: EvoBlifPort[] } {
  const group = (names: Iterable<string>): EvoBlifPort[] => {
    const singles: string[] = [];
    const buses = new Map<string, number>();
    for (const name of new Set(names)) {
      const m = /^(.*)\[(\d+)\]$/.exec(name);
      if (m) buses.set(m[1], Math.max(buses.get(m[1]) ?? 0, Number(m[2])));
      else singles.push(name);
    }
    // Java's String order is UTF-16 code unit order, which is what the default sort uses
    return [
      ...singles.sort().map((name) => ({ name, width: 1 })),
      ...[...buses.keys()].sort().map((prefix) => {
        const width = buses.get(prefix)! + 1;
        return width === 1 ? { name: `${prefix}[0]`, width } : { name: prefix, width };
      }),
    ];
  };
  const outSet = new Set(outputs);
  return { inputs: group(inputs.filter((n) => !outSet.has(n))), outputs: group(outputs) };
}

const CONSTANTS = new Set([NET_FALSE, NET_TRUE, NET_UNDEF]);

/** Covers that are one evo gate, by input count, sorted rows and on-set flag */
const ONE_GATE: Record<string, string> = {
  '1:1:1': 'BUF',
  '1:0:1': 'NOT',
  '1:1:0': 'NOT',
  '1:0:0': 'BUF',
  '2:11:1': 'AND',
  '2:11:0': 'NAND',
  '2:-1,1-:1': 'OR',
  '2:-1,1-:0': 'NOR',
  '2:01,10:1': 'XOR',
  '2:00,11:1': 'NXOR',
  '2:01,10:0': 'NXOR',
  '2:00,11:0': 'XOR',
  '2:10:1': 'ANDNOT',
  '2:-0,1-:1': 'ORNOT',
  '3:-11,1-0:1': 'MUX',
};

const PIN_NAMES = ['A', 'B', 'S'];

class Writer {
  readonly lines: string[] = [];
  private readonly names = new Map<string, string>();
  private readonly taken: Set<string>;
  private next = 0;
  private readonly nots = new Map<string, string>();

  constructor(taken: Set<string>, ports: Map<string, string>) {
    this.taken = taken;
    for (const [net, symbol] of ports) this.names.set(net, symbol);
  }

  /** A fresh internal net */
  fresh(): string {
    let name: string;
    do name = `_n${this.next++}`;
    while (this.taken.has(name));
    return name;
  }

  /** The written name of a netlist net */
  net(net: string): string {
    if (net === '') return NET_UNDEF;
    if (CONSTANTS.has(net)) return net;
    let name = this.names.get(net);
    if (name === undefined) {
      name = this.fresh();
      this.names.set(net, name);
    }
    return name;
  }

  cell(type: string, pins: Record<string, string>): void {
    this.lines.push(`.subckt ${type} ${Object.entries(pins).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }

  /** A gate (MUX also takes `s`); returns its output (`y`, or a fresh net) */
  gate(type: string, a: string, b?: string, y?: string, s?: string): string {
    const out = y ?? this.fresh();
    const pins: Record<string, string> = { A: a };
    if (b !== undefined) pins.B = b;
    if (s !== undefined) pins.S = s;
    pins.Y = out;
    this.cell(type, pins);
    return out;
  }

  not(a: string): string {
    if (a === NET_TRUE) return NET_FALSE;
    if (a === NET_FALSE) return NET_TRUE;
    let y = this.nots.get(a);
    if (y === undefined) {
      y = this.gate('NOT', a);
      this.nots.set(a, y);
    }
    return y;
  }

  /** A balanced tree of a 2-input gate; `empty` when there is nothing to combine */
  tree(type: 'AND' | 'OR', nets: string[], empty: string): string {
    if (nets.length === 0) return empty;
    let level = nets;
    while (level.length > 1) {
      const up: string[] = [];
      for (let i = 0; i < level.length; i += 2) up.push(i + 1 < level.length ? this.gate(type, level[i], level[i + 1]) : level[i]);
      level = up;
    }
    return level[0];
  }

  /** A control input as an active-high net */
  ctl(c: NetlistCtl): string {
    const net = this.net(c.net);
    return c.activeHigh ? net : this.not(net);
  }

  /** `d`, forced to the load's value while the load is active */
  force(d: string, load: NetlistLoad): string {
    const active = this.ctl(load);
    return load.value ? this.gate('OR', d, active) : this.gate('ANDNOT', d, active);
  }

  /** S ? b : a */
  mux(a: string, b: string, s: string): string {
    return this.gate('MUX', a, b, undefined, s);
  }

  lut(c: NetlistLut): void {
    // yosys declares the constants with .names; evo builds them itself and refuses a driver on them
    if (CONSTANTS.has(c.output)) return;
    const y = this.net(c.output);
    const ins = c.inputs.map((n) => this.net(n));
    const key = `${ins.length}:${[...c.rows].sort().join(',')}:${c.onSet ? 1 : 0}`;
    const one = ONE_GATE[key];
    if (one) {
      const pins: Record<string, string> = {};
      ins.forEach((n, i) => (pins[PIN_NAMES[i]] = n));
      pins.Y = y;
      this.cell(one, pins);
      return;
    }
    const terms = c.rows.map((row) =>
      this.tree(
        'AND',
        [...row].flatMap((ch, i) => (ch === '1' ? [ins[i]] : ch === '0' ? [this.not(ins[i])] : [])),
        NET_TRUE,
      ),
    );
    const sum = this.tree('OR', terms, NET_FALSE);
    this.gate(c.onSet ? 'BUF' : 'NOT', sum, undefined, y);
  }

  seq(c: NetlistSeq): void {
    const q = this.net(c.q);
    let d = this.net(c.d);
    if (c.clock && c.edge) {
      const en = c.enable ? this.ctl(c.enable) : undefined;
      if (c.syncReset && c.syncResetOverEnable) {
        if (en) d = this.mux(q, d, en);
        d = this.force(d, c.syncReset);
      } else {
        if (c.syncReset) d = this.force(d, c.syncReset);
        if (en) d = this.mux(q, d, en);
      }
      const clock = this.ctl(c.clock);
      if (c.asyncLoads.length === 0) {
        this.cell('DFF', { C: clock, D: d, Q: q });
        return;
      }
      // each load is masked by the higher-priority loads of the other value
      const sets: string[] = [];
      const resets: string[] = [];
      const higher: { 0: string[]; 1: string[] } = { 0: [], 1: [] };
      for (const load of c.asyncLoads) {
        const active = this.ctl(load);
        const other = higher[load.value ? 0 : 1];
        const eff = other.length > 0 ? this.gate('ANDNOT', active, this.tree('OR', other, NET_FALSE)) : active;
        (load.value ? sets : resets).push(eff);
        higher[load.value].push(active);
      }
      this.cell('DFFSR', { C: clock, D: d, S: this.tree('OR', sets, NET_FALSE), R: this.tree('OR', resets, NET_FALSE), Q: q });
      return;
    }
    // latch (or a cell only its async loads change): open while enabled, async loads open it and steer d
    let e = c.clock ? this.ctl(c.clock) : NET_FALSE;
    if (c.clock && c.enable) e = this.gate('AND', e, this.ctl(c.enable));
    if (c.syncReset) d = this.force(d, c.syncReset);
    for (const load of [...c.asyncLoads].reverse()) {
      const active = this.ctl(load);
      d = this.mux(d, load.value ? NET_TRUE : NET_FALSE, active);
      e = e === NET_FALSE ? active : this.gate('OR', e, active);
    }
    this.cell('DLATCH', { D: d, E: e, Q: q });
  }
}

/**
 * Evo BLIF of a netlist whose ports are `inputs` / `outputs` (names and widths as the netlist's, in any
 * order). A port bit the netlist leaves unconnected reads nothing / drives $undef.
 */
export function writeEvoBlif(netlist: Netlist, inputs: EvoBlifPort[] = netlist.inputs.map((p) => ({ name: p.name, width: p.bits.length })), outputs: EvoBlifPort[] = netlist.outputs.map((p) => ({ name: p.name, width: p.bits.length }))): EvoBlifResult {
  const inSymbols = inputs.flatMap(evoBitNames);
  const outSymbols = outputs.flatMap(evoBitNames);
  const taken = new Set([...inSymbols, ...outSymbols]);
  // the input bits' nets are named after the bits, then each net an output bit alone takes is named after it
  const portNets = new Map<string, string>();
  const bitsOf = (list: Netlist['inputs'], name: string) => list.find((p) => p.name === name)?.bits ?? [];
  for (const port of inputs) {
    const bits = bitsOf(netlist.inputs, port.name);
    evoBitNames(port).forEach((symbol, i) => {
      const net = bits[i] ?? '';
      if (net !== '' && !CONSTANTS.has(net) && !portNets.has(net)) portNets.set(net, symbol);
    });
  }
  const direct = new Set<string>();
  for (const port of outputs) {
    const bits = bitsOf(netlist.outputs, port.name);
    evoBitNames(port).forEach((symbol, i) => {
      const net = bits[i] ?? '';
      if (net === '' || CONSTANTS.has(net) || portNets.has(net)) return;
      portNets.set(net, symbol);
      direct.add(symbol);
    });
  }
  const w = new Writer(taken, portNets);
  let initOnes = 0;
  for (const cell of netlist.cells) {
    if (cell.kind === 'lut') w.lut(cell);
    else if (cell.kind === 'tbuf') w.cell(cell.en.activeHigh ? 'TRIS' : 'TRISI', { A: w.net(cell.a), B: w.net(cell.en.net), Y: w.net(cell.output) });
    else if (cell.kind === 'pull') w.cell(cell.high ? 'PULLUP' : 'PULLDOWN', { Y: w.net(cell.net) });
    else {
      if (cell.init === 1) initOnes++;
      w.seq(cell);
    }
  }
  // the other output bits (an input, a constant, a net another output took, or unconnected) through a buffer
  for (const port of outputs) {
    const bits = bitsOf(netlist.outputs, port.name);
    evoBitNames(port).forEach((symbol, i) => {
      if (!direct.has(symbol)) w.gate('BUF', w.net(bits[i] ?? ''), undefined, symbol);
    });
  }
  const header = [`.model ${netlist.name || 'top'}`];
  if (inSymbols.length > 0) header.push(`.inputs ${inSymbols.join(' ')}`);
  if (outSymbols.length > 0) header.push(`.outputs ${outSymbols.join(' ')}`);
  // evo builds the constants itself; yosys declares them, so do we
  header.push(`.names ${NET_FALSE}`, `.names ${NET_TRUE}`, '1', `.names ${NET_UNDEF}`);
  return { text: [...header, ...w.lines, '.end', ''].join('\n'), initOnes };
}
