// Netlist compiler: numbers the nets and packs the cells into flat typed arrays for sim.ts.
//
// Combinational cells become "nodes" that each drive one net; storage cells become sequential elements.
// A net with more than one driver (tri-state buses, an input port also driven inside) gets a private net per
// driver and a RESOLVE node that merges them with the app's net rule (resolveDrivers in types/logic.ts).
import {
  LEV_0,
  LEV_1,
  LEV_X,
  LEV_Z,
  NET_FALSE,
  NET_TRUE,
  NET_UNDEF,
  NetlistError,
  type Level,
  type Netlist,
  type NetlistCtl,
  type NetlistLoad,
  type NetlistPort,
} from './ir';

export const NODE_LUT = 0;
export const NODE_TBUF = 1;
export const NODE_RESOLVE = 2;

/** Cover row characters as stored in lutRows */
export const ROW_0 = 0;
export const ROW_1 = 1;
export const ROW_ANY = 2;

/** A control input of a sequential element: net index (-1 = none) and the level that makes it active */
export interface SeqCtl {
  net: number;
  active: Level;
}

export interface SeqLoad extends SeqCtl {
  value: Level;
}

export interface SeqElement {
  /** -1 = no clock */
  clock: SeqCtl;
  edge: boolean;
  d: number;
  /** Net the element drives */
  q: number;
  enable: SeqCtl;
  /** net -1 = none */
  syncReset: SeqLoad;
  syncResetOverEnable: boolean;
  asyncLoads: SeqLoad[];
  init: Level;
}

export interface CompiledPort {
  name: string;
  width: number;
  /** Net of each bit, LSB first; -1 = not connected */
  nets: Int32Array;
}

export interface CompiledNetlist {
  name: string;
  netCount: number;
  /** Level a net takes while nothing drives it: Z, a pull, or the constant of $false/$true/$undef */
  netRest: Uint8Array;
  /** Power-on level of every net */
  netInit: Uint8Array;
  nodeCount: number;
  nodeType: Uint8Array;
  /** Inputs of node i are nodeIn[nodeInStart[i] .. nodeInStart[i + 1]) */
  nodeInStart: Int32Array;
  nodeIn: Int32Array;
  nodeOut: Int32Array;
  /** LUT: index into the lut tables; TBUF: active level of the enable (its second input) */
  nodeAux: Int32Array;
  /** Cover of LUT k: lutRowCount[k] rows of (its input count) ROW_* codes from lutRowStart[k]; lutOnSet[k] */
  lutRowStart: Int32Array;
  lutRowCount: Int32Array;
  lutRows: Uint8Array;
  lutOnSet: Uint8Array;
  /** Nodes reading net n are fan[fanStart[n] .. fanStart[n + 1]) */
  fanStart: Int32Array;
  fan: Int32Array;
  seqs: SeqElement[];
  inputs: CompiledPort[];
  outputs: CompiledPort[];
  /** Largest LUT input count (scratch size for the simulator) */
  maxLutInputs: number;
  stats: { cells: number; nets: number; nodes: number; seqs: number };
}

type Driver = { kind: 'node'; node: number } | { kind: 'seq'; seq: number } | { kind: 'input' };

const NO_CTL: SeqCtl = { net: -1, active: LEV_1 };
const NO_LOAD: SeqLoad = { net: -1, active: LEV_1, value: LEV_0 };

export function compileNetlist(netlist: Netlist): CompiledNetlist {
  const index = new Map<string, number>();
  const net = (name: string): number => {
    let i = index.get(name);
    if (i === undefined) {
      i = index.size;
      index.set(name, i);
    }
    return i;
  };

  // pass 1: cells with net indices, drivers per net
  interface PendingNode {
    type: number;
    inputs: number[];
    out: number;
    aux: number;
  }
  const nodes: PendingNode[] = [];
  const seqs: SeqElement[] = [];
  const luts: { rows: string[]; onSet: boolean }[] = [];
  const pulls = new Map<number, Level>();
  const drivers = new Map<number, Driver[]>();
  const drive = (n: number, d: Driver): void => {
    const list = drivers.get(n);
    if (list) list.push(d);
    else drivers.set(n, [d]);
  };
  const ctl = (c: NetlistCtl | undefined): SeqCtl => (c ? { net: net(c.net), active: c.activeHigh ? LEV_1 : LEV_0 } : NO_CTL);
  const load = (l: NetlistLoad | undefined): SeqLoad => (l ? { ...ctl(l), value: l.value ? LEV_1 : LEV_0 } : NO_LOAD);

  for (const cell of netlist.cells) {
    switch (cell.kind) {
      case 'lut':
        if (cell.inputs.length > 0 && cell.rows.some((r) => r.length !== cell.inputs.length))
          throw new NetlistError('badRow', 'cover row width differs from the input count');
        luts.push({ rows: cell.rows, onSet: cell.onSet });
        nodes.push({ type: NODE_LUT, inputs: cell.inputs.map(net), out: net(cell.output), aux: luts.length - 1 });
        drive(nodes[nodes.length - 1].out, { kind: 'node', node: nodes.length - 1 });
        break;
      case 'tbuf': {
        const en = ctl(cell.en);
        nodes.push({ type: NODE_TBUF, inputs: [net(cell.a), en.net], out: net(cell.output), aux: en.active });
        drive(nodes[nodes.length - 1].out, { kind: 'node', node: nodes.length - 1 });
        break;
      }
      case 'seq':
        seqs.push({
          clock: ctl(cell.clock),
          edge: cell.edge,
          d: net(cell.d),
          q: net(cell.q),
          enable: ctl(cell.enable),
          syncReset: load(cell.syncReset),
          syncResetOverEnable: cell.syncResetOverEnable,
          asyncLoads: cell.asyncLoads.map((l) => load(l)),
          init: cell.init ? LEV_1 : LEV_0,
        });
        drive(seqs[seqs.length - 1].q, { kind: 'seq', seq: seqs.length - 1 });
        break;
      case 'pull':
        pulls.set(net(cell.net), cell.high ? LEV_1 : LEV_0);
        break;
    }
  }

  const port = (p: NetlistPort): CompiledPort => ({
    name: p.name,
    width: p.bits.length,
    nets: Int32Array.from(p.bits, (b) => (b === '' ? -1 : net(b))),
  });
  const inputs = netlist.inputs.map(port);
  const outputs = netlist.outputs.map(port);
  for (const p of inputs) for (const n of p.nets) if (n >= 0) drive(n, { kind: 'input' });

  // pass 2: a private net per driver of a multi-driven net, merged by a RESOLVE node
  const namedNets = index.size;
  let netCount = namedNets;
  const inputNet = new Map<number, number>(); // named input net -> net the outside writes
  for (const [n, list] of drivers) {
    if (list.length < 2) continue;
    const privates: number[] = [];
    for (const d of list) {
      const p = netCount++;
      privates.push(p);
      if (d.kind === 'node') nodes[d.node].out = p;
      else if (d.kind === 'seq') seqs[d.seq].q = p;
      else inputNet.set(n, p);
    }
    nodes.push({ type: NODE_RESOLVE, inputs: privates, out: n, aux: 0 });
  }
  for (const p of inputs) p.nets = p.nets.map((n) => (n >= 0 ? (inputNet.get(n) ?? n) : n));

  // net levels at rest and at power-on
  const netRest = new Uint8Array(netCount).fill(LEV_Z);
  for (const [n, lev] of pulls) netRest[n] = lev;
  const constant = (name: string, lev: Level): void => {
    const n = index.get(name);
    if (n !== undefined && !drivers.has(n)) netRest[n] = lev;
  };
  constant(NET_FALSE, LEV_0);
  constant(NET_TRUE, LEV_1);
  constant(NET_UNDEF, LEV_X);
  const netInit = netRest.slice();
  for (const s of seqs) netInit[s.q] = s.init;

  // pack
  const nodeCount = nodes.length;
  const nodeType = new Uint8Array(nodeCount);
  const nodeInStart = new Int32Array(nodeCount + 1);
  const nodeOut = new Int32Array(nodeCount);
  const nodeAux = new Int32Array(nodeCount);
  let inTotal = 0;
  nodes.forEach((nd, i) => {
    nodeType[i] = nd.type;
    nodeOut[i] = nd.out;
    nodeAux[i] = nd.aux;
    nodeInStart[i] = inTotal;
    inTotal += nd.inputs.length;
  });
  nodeInStart[nodeCount] = inTotal;
  const nodeIn = new Int32Array(inTotal);
  nodes.forEach((nd, i) => nodeIn.set(nd.inputs, nodeInStart[i]));

  let rowTotal = 0;
  let maxLutInputs = 0;
  const lutRowStart = new Int32Array(luts.length);
  const lutRowCount = new Int32Array(luts.length);
  const lutOnSet = new Uint8Array(luts.length);
  luts.forEach((l, k) => {
    lutRowStart[k] = rowTotal;
    lutRowCount[k] = l.rows.length;
    lutOnSet[k] = l.onSet ? 1 : 0;
    rowTotal += l.rows.reduce((sum, r) => sum + r.length, 0);
    for (const r of l.rows) maxLutInputs = Math.max(maxLutInputs, r.length);
  });
  const lutRows = new Uint8Array(rowTotal);
  luts.forEach((l, k) => {
    let at = lutRowStart[k];
    for (const r of l.rows) for (const ch of r) lutRows[at++] = ch === '0' ? ROW_0 : ch === '1' ? ROW_1 : ROW_ANY;
  });

  // fan-out: which nodes read each net
  const fanCount = new Int32Array(netCount + 1);
  for (const n of nodeIn) fanCount[n + 1]++;
  for (let n = 0; n < netCount; n++) fanCount[n + 1] += fanCount[n];
  const fanStart = fanCount.slice();
  const fan = new Int32Array(inTotal);
  const fill = fanCount.slice();
  for (let i = 0; i < nodeCount; i++) for (let k = nodeInStart[i]; k < nodeInStart[i + 1]; k++) fan[fill[nodeIn[k]]++] = i;

  return {
    name: netlist.name,
    netCount,
    netRest,
    netInit,
    nodeCount,
    nodeType,
    nodeInStart,
    nodeIn,
    nodeOut,
    nodeAux,
    lutRowStart,
    lutRowCount,
    lutRows,
    lutOnSet,
    fanStart,
    fan,
    seqs,
    inputs,
    outputs,
    maxLutInputs,
    stats: { cells: netlist.cells.length, nets: namedNets, nodes: nodeCount, seqs: seqs.length },
  };
}
