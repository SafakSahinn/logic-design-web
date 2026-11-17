// Event-driven simulator of a compiled netlist.
//
// One step, as in Logisim-evolution's DenseLogicCircuit: apply the input ports, settle the combinational
// nodes, update the sequential elements once, settle again. Only nodes whose inputs changed are evaluated.
// The state is two small typed arrays, so a part can copy it each step (undo, stepping) cheaply.
import {
  NODE_LUT,
  NODE_RESOLVE,
  NODE_TBUF,
  ROW_0,
  ROW_1,
  ROW_ANY,
  type CompiledNetlist,
  type SeqCtl,
} from './compile';
import { LEV_0, LEV_1, LEV_E, LEV_X, LEV_Z, type Level } from './ir';

export interface NetlistState {
  /** Level of every net */
  levels: Uint8Array;
  /** Clock level each sequential element saw in the previous step (edge detection) */
  prevClock: Uint8Array;
  /** No step has run yet: the first one evaluates every node and detects no clock edge */
  fresh: boolean;
}

export function newNetlistState(c: CompiledNetlist): NetlistState {
  return { levels: c.netInit.slice(), prevClock: new Uint8Array(c.seqs.length), fresh: true };
}

export function cloneNetlistState(s: NetlistState): NetlistState {
  return { levels: s.levels.slice(), prevClock: s.prevClock.slice(), fresh: s.fresh };
}

/** Unknown cover inputs enumerated exactly up to this count; beyond it the cover is evaluated pessimistically */
const MAX_EXACT_UNKNOWNS = 8;

/** Work buffers of one compiled netlist, shared by its states (steps never run concurrently) */
interface Scratch {
  queue: Int32Array;
  queued: Uint8Array;
  bits: Uint8Array;
  unknownAt: Int32Array;
}
const scratches = new WeakMap<CompiledNetlist, Scratch>();
function scratchOf(c: CompiledNetlist): Scratch {
  let s = scratches.get(c);
  if (!s) {
    s = {
      queue: new Int32Array(Math.max(1, c.nodeCount)),
      queued: new Uint8Array(c.nodeCount),
      bits: new Uint8Array(c.maxLutInputs),
      unknownAt: new Int32Array(c.maxLutInputs),
    };
    scratches.set(c, s);
  }
  return s;
}

/** Bits of the cover rows a LUT input pattern (bits: 0/1) matches */
function coverMatches(c: CompiledNetlist, k: number, n: number, bits: Uint8Array): boolean {
  const rows = c.lutRows;
  const count = c.lutRowCount[k];
  let at = c.lutRowStart[k];
  for (let r = 0; r < count; r++, at += n) {
    let ok = true;
    for (let i = 0; i < n; i++) {
      const ch = rows[at + i];
      if (ch !== ROW_ANY && ch !== bits[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }
  return false;
}

function evalLut(c: CompiledNetlist, node: number, levels: Uint8Array, sc: Scratch): Level {
  const k = c.nodeAux[node];
  const start = c.nodeInStart[node];
  const n = c.nodeInStart[node + 1] - start;
  const on = c.lutOnSet[k] === 1;
  const bits = sc.bits;
  let unknowns = 0;
  for (let i = 0; i < n; i++) {
    const lev = levels[c.nodeIn[start + i]];
    if (lev === LEV_0) bits[i] = ROW_0;
    else if (lev === LEV_1) bits[i] = ROW_1;
    else {
      bits[i] = ROW_0;
      sc.unknownAt[unknowns++] = i;
    }
  }
  if (unknowns === 0) return coverMatches(c, k, n, bits) === on ? LEV_1 : LEV_0;
  if (unknowns <= MAX_EXACT_UNKNOWNS) {
    // the output is known only if every value of the unknown inputs gives the same result
    let first = -1;
    for (let combo = 0; combo < 1 << unknowns; combo++) {
      for (let u = 0; u < unknowns; u++) bits[sc.unknownAt[u]] = (combo >> u) & 1 ? ROW_1 : ROW_0;
      const m = coverMatches(c, k, n, bits) ? 1 : 0;
      if (first < 0) first = m;
      else if (m !== first) return LEV_X;
    }
    return (first === 1) === on ? LEV_1 : LEV_0;
  }
  // pessimistic: a row surely matches (no unknown input it cares about), or no row can match
  const unknown = new Set<number>();
  for (let u = 0; u < unknowns; u++) unknown.add(sc.unknownAt[u]);
  const rows = c.lutRows;
  let possible = false;
  let at = c.lutRowStart[k];
  for (let r = 0; r < c.lutRowCount[k]; r++, at += n) {
    let sure = true;
    let can = true;
    for (let i = 0; i < n; i++) {
      const ch = rows[at + i];
      if (ch === ROW_ANY) continue;
      if (unknown.has(i)) sure = false;
      else if (ch !== bits[i]) {
        can = false;
        break;
      }
    }
    if (can && sure) return on ? LEV_1 : LEV_0;
    possible ||= can;
  }
  return possible ? LEV_X : on ? LEV_0 : LEV_1;
}

function evalNode(c: CompiledNetlist, node: number, levels: Uint8Array, sc: Scratch): Level {
  switch (c.nodeType[node]) {
    case NODE_LUT:
      return evalLut(c, node, levels, sc);
    case NODE_TBUF: {
      const start = c.nodeInStart[node];
      const en = levels[c.nodeIn[start + 1]];
      const a = levels[c.nodeIn[start]] as Level;
      if (en === c.nodeAux[node]) return a;
      if (en === LEV_0 || en === LEV_1) return LEV_Z;
      return a === LEV_Z ? LEV_Z : LEV_X;
    }
    case NODE_RESOLVE: {
      // the app's net rule: Z and X drivers don't count, differing driven values give E
      let driven: number = LEV_Z;
      let unknown = false;
      for (let i = c.nodeInStart[node]; i < c.nodeInStart[node + 1]; i++) {
        const lev = levels[c.nodeIn[i]];
        if (lev === LEV_Z) continue;
        if (lev === LEV_X) {
          unknown = true;
          continue;
        }
        if (driven === LEV_Z) driven = lev;
        else if (driven !== lev) return LEV_E;
      }
      return (driven !== LEV_Z ? driven : unknown ? LEV_X : LEV_Z) as Level;
    }
    default:
      throw new Error(`invalid node type ${c.nodeType[node]}`);
  }
}

/** Sets a net and queues the nodes reading it */
function setNet(c: CompiledNetlist, levels: Uint8Array, net: number, lev: number, sc: Scratch, q: { tail: number }): void {
  if (levels[net] === lev) return;
  levels[net] = lev;
  const qlen = sc.queue.length;
  for (let f = c.fanStart[net]; f < c.fanStart[net + 1]; f++) {
    const node = c.fan[f];
    if (sc.queued[node]) continue;
    sc.queued[node] = 1;
    sc.queue[q.tail % qlen] = node;
    q.tail++;
  }
}

/**
 * Evaluates queued nodes until nothing changes. Returns false when the iteration limit is hit (the netlist
 * oscillates); the remaining queue is dropped.
 */
function settle(c: CompiledNetlist, levels: Uint8Array, sc: Scratch, q: { head: number; tail: number }): boolean {
  let budget = c.nodeCount * 64 + 1024;
  const qlen = sc.queue.length;
  while (q.head < q.tail) {
    if (budget-- <= 0) {
      sc.queued.fill(0);
      q.head = q.tail = 0;
      return false;
    }
    const node = sc.queue[q.head % qlen];
    q.head++;
    sc.queued[node] = 0;
    let lev: number = evalNode(c, node, levels, sc);
    const out = c.nodeOut[node];
    if (lev === LEV_Z) lev = c.netRest[out];
    setNet(c, levels, out, lev, sc, q);
  }
  q.head = q.tail = 0;
  return true;
}

const isActive = (levels: Uint8Array, ctl: SeqCtl): boolean => ctl.net >= 0 && levels[ctl.net] === ctl.active;

/** Updates every sequential element once from the settled levels */
function stepSequential(c: CompiledNetlist, s: NetlistState, sc: Scratch, q: { head: number; tail: number }): void {
  const levels = s.levels;
  for (let i = 0; i < c.seqs.length; i++) {
    const e = c.seqs[i];
    let next = -1;
    for (const l of e.asyncLoads) {
      if (isActive(levels, l)) {
        next = l.value;
        break;
      }
    }
    if (next < 0 && e.clock.net >= 0) {
      const clk = levels[e.clock.net];
      const prev = s.prevClock[i];
      const fires = e.edge ? !s.fresh && clk === e.clock.active && prev !== e.clock.active : clk === e.clock.active;
      if (fires) {
        const enabled = e.enable.net < 0 || isActive(levels, e.enable);
        if (isActive(levels, e.syncReset) && (e.syncResetOverEnable || enabled)) next = e.syncReset.value;
        else if (enabled) next = levels[e.d] === LEV_1 ? LEV_1 : LEV_0; // as evo: anything not high loads 0
      }
    }
    if (e.clock.net >= 0) s.prevClock[i] = levels[e.clock.net];
    if (next >= 0) setNet(c, levels, e.q, next, sc, q);
  }
}

/**
 * Runs one step with the given input port values (one level per bit, LSB first; a missing port or bit
 * floats). Returns false when the combinational part did not settle (oscillation).
 */
export function stepNetlist(c: CompiledNetlist, s: NetlistState, inputs: readonly (ArrayLike<number> | undefined)[]): boolean {
  const sc = scratchOf(c);
  const q = { head: 0, tail: 0 };
  const levels = s.levels;
  if (s.fresh) {
    for (let i = 0; i < c.nodeCount; i++) {
      sc.queued[i] = 1;
      sc.queue[i] = i;
    }
    q.tail = c.nodeCount;
  }
  c.inputs.forEach((p, i) => {
    const bits = inputs[i];
    for (let b = 0; b < p.width; b++) {
      const n = p.nets[b];
      if (n < 0) continue;
      const lev = bits && b < bits.length ? bits[b] : LEV_Z;
      setNet(c, levels, n, lev === LEV_Z ? c.netRest[n] : lev, sc, q);
    }
  });
  let ok = settle(c, levels, sc, q);
  stepSequential(c, s, sc, q);
  ok = settle(c, levels, sc, q) && ok;
  s.fresh = false;
  return ok;
}

/** Levels of the output ports, one array per port, LSB first */
export function readNetlistOutputs(c: CompiledNetlist, s: NetlistState): Level[][] {
  return c.outputs.map((p) => Array.from(p.nets, (n) => (n < 0 ? LEV_Z : (s.levels[n] as Level))));
}
