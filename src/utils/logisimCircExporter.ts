import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { getLogicalConnections } from './wiringEngine';
import { HEX_7SEG_MAP } from './circuitEngine';
import { getSubcircuitDefinition } from './subcircuitManager';
import { solveKMap } from './kmapSolver';
import type { LogicValue } from '../types/logic';

/*
 * Logisim 2.7 (.circ) export.
 *
 * Every part is first expanded into Logisim primitives (gates, NOT, controlled buffer, flip-flops,
 * constants, pins, clocks); blocks Logisim has no exact equivalent for (adders, plexers, decoders,
 * ALU, registers, ...) become small gate / flip-flop networks with the same behaviour as our
 * simulator. Primitives are laid out on a grid and connected with Logisim tunnels named after their
 * net, so no wire can accidentally touch another part's pin. Pin offsets were measured in Logisim
 * 2.7.1 (gates: output at loc, inputs at -(size+bubble+xor) with the AbstractGate spacing; flip-flops:
 * Q (0,0), Q' (0,20), D/T (-40,20), clock (-40,0) or (-40,10) for J-K, reset (-10,30), preset (-30,30)).
 * Open inputs follow the simulator's Logisim rules: on primitives they stay unconnected, on gate
 * networks they become x (or the fixed level the simulator reads for them). Checked in Logisim 2.7.1:
 * primitives, presets and ICs match exactly; a gate network cannot always reproduce a block's x
 * (AND(0, x) = 0, a per-bit register still loads the defined bits of a partly open word).
 */

type GateKind = 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR';
type Prim =
  | { kind: 'gate'; type: GateKind; ins: string[]; out: string }
  | { kind: 'not'; in: string; out: string }
  | { kind: 'buf'; in: string; out: string }
  | { kind: 'tri'; in: string; en: string; out: string; inv?: boolean }
  | { kind: 'ff'; type: 'D' | 'T' | 'JK'; a?: string; b?: string; clk?: string; q?: string; qn?: string; reset?: string; preset?: string }
  | { kind: 'const'; value: 0 | 1; out: string }
  | { kind: 'inpin'; label: string; out: string }
  | { kind: 'clock'; label: string; out: string }
  | { kind: 'outpin'; label: string; in: string }
  | { kind: 'pull'; value: 0 | 1 | 'X'; at: string };

export interface CircExportResult {
  xml: string;
  warnings: string[];
  // For tests / UI: which Logisim pin stands for which canvas pin
  inputs: { label: string; compId: string; pinIndex: number }[];
  outputs: { label: string; compId: string; pinId: string }[];
}

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function exportLogisimCirc(circuitName: string, components: CircuitComponentInstance[], wires: CircuitWire[]): CircExportResult {
  const warnings: string[] = [];
  const inputs: CircExportResult['inputs'] = [];
  const outputs: CircExportResult['outputs'] = [];
  const blocks: { prims: Prim[] }[] = [];

  // --- nets (union-find over net names so aliases like splitter outputs collapse) ---------------
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  let fresh = 0;
  const newNet = () => `_t${fresh++}`;
  const C0 = '_const0';
  const C1 = '_const1';
  let usesC0 = false;
  let usesC1 = false;
  const constNet = (v: 0 | 1) => {
    if (v) usesC1 = true;
    else usesC0 = true;
    return v ? C1 : C0;
  };
  // A Logisim part's own input that is open on the canvas stays unconnected in the file too (no
  // tunnel), so Logisim reads it exactly like the simulator does (gates ignore it, NOT gives E ...)
  const OPEN = '';
  // An open input of a block built from gates gets its own undriven net (an 'OPEN' tunnel, x in
  // Logisim) so the undefined value stays undefined; inputs the simulator reads as a fixed level
  // when open (carry-in, reset, enable ...) are tied to that constant instead
  const openNets: string[] = [];
  const openNet = () => {
    const n = newNet();
    openNets.push(n);
    return n;
  };

  // Builds the netlist of one circuit level; `scope` keeps nets of inlined ICs apart and `alias`
  // binds an IC's port pins to the nets of the level above
  const buildLevel = (comps: CircuitComponentInstance[], levelWires: CircuitWire[], scope: string, alias: Map<string, string>, depth: number) => {
    const conns = getLogicalConnections(comps, levelWires);
    const netOfPin = new Map<string, string>();
    const connected = new Set<string>();
    for (const w of conns) {
      const n = `${scope}${w.fromPinId}`;
      netOfPin.set(w.fromPinId, n);
      netOfPin.set(w.toPinId, n);
      connected.add(w.fromPinId);
      connected.add(w.toPinId);
    }
    for (const [pinId, outer] of alias) {
      const n = netOfPin.get(pinId) || `${scope}${pinId}`;
      netOfPin.set(pinId, n);
      connected.add(pinId);
      union(outer, n);
    }
    // Output pins always get a net; an unconnected input reads `floating` (undefined: x)
    const outNet = (pinId?: string) => (pinId ? netOfPin.get(pinId) || `${scope}${pinId}` : newNet());
    const inNet = (pinId: string | undefined, floating?: 0 | 1) =>
      pinId && connected.has(pinId) ? netOfPin.get(pinId)! : floating === undefined ? openNet() : constNet(floating);
    const isConn = (pinId?: string) => !!pinId && connected.has(pinId);
    const pinNet = (pinId?: string) => (isConn(pinId) ? netOfPin.get(pinId!)! : OPEN);

    for (const c of comps) {
      const P: Prim[] = [];
      const g = (type: GateKind, ins: string[], out = newNet()): string => {
        if (ins.length === 1 && (type === 'AND' || type === 'OR')) {
          union(ins[0], out);
          return out;
        }
        // At most 5 inputs per gate (our own gates' limit, so the file also re-imports cleanly):
        // wider ones become a tree of the base operation with the inversion on the last gate
        if (ins.length > 5) {
          const base: GateKind = type === 'NAND' ? 'AND' : type === 'NOR' ? 'OR' : type === 'XNOR' ? 'XOR' : type;
          const groups: string[] = [];
          for (let i = 0; i < ins.length; i += 5) {
            const part = ins.slice(i, i + 5);
            groups.push(part.length === 1 ? part[0] : g(base, part));
          }
          return g(type, groups, out);
        }
        P.push({ kind: 'gate', type, ins, out });
        return out;
      };
      const not = (a: string, out = newNet()) => {
        P.push({ kind: 'not', in: a, out });
        return out;
      };
      let openInputs = 0;
      const ins = (i: number, floating?: 0 | 1) => {
        if (floating === undefined && !isConn(c.inputs[i]?.id)) openInputs++;
        return inNet(c.inputs[i]?.id, floating);
      };
      // Input of a part that is a Logisim primitive itself: open stays open
      const pin = (i: number) => pinNet(c.inputs[i]?.id);
      const out = (i: number) => outNet(c.outputs[i]?.id);
      const label = (c.label || c.type).trim();
      const inScope = scope !== '';

      switch (c.type) {
        case 'switch':
        case 'pushbutton':
          // Inside an IC: a switch bound to a port is driven from outside, any other one is a constant
          if (inScope && c.outputs[0] && alias.has(c.outputs[0].id)) break;
          if (inScope) P.push({ kind: 'const', value: c.state.on ? 1 : 0, out: out(0) });
          else {
            P.push({ kind: 'inpin', label, out: out(0) });
            inputs.push({ label, compId: c.id, pinIndex: 0 });
          }
          break;
        case 'clock':
          if (inScope && c.outputs[0] && alias.has(c.outputs[0].id)) break;
          if (inScope) P.push({ kind: 'const', value: 0, out: out(0) });
          else {
            P.push({ kind: 'clock', label, out: out(0) });
            inputs.push({ label, compId: c.id, pinIndex: 0 });
          }
          break;
        case 'vcc':
        case 'gnd':
          P.push({ kind: 'const', value: c.type === 'vcc' ? 1 : 0, out: out(0) });
          break;
        case 'dipSwitch4':
        case 'asciiKeyboard':
          c.outputs.forEach((p, i) => {
            const l = `${label}_${p.name}`;
            if (inScope) P.push({ kind: 'const', value: 0, out: out(i) });
            else {
              P.push({ kind: 'inpin', label: l, out: out(i) });
              inputs.push({ label: l, compId: c.id, pinIndex: i });
            }
          });
          break;
        case 'led':
        case 'probe':
        case 'buzzer':
        case 'sevenSegment':
        case 'hexDisplay':
        case 'ledBar4':
        case 'dotMatrix8x8':
        case 'rgbMatrix16x16':
          if (inScope) break; // an IC's outputs reach the outside through its ports
          c.inputs.forEach((p, i) => {
            const l = c.inputs.length === 1 ? label : `${label}_${p.name}`;
            P.push({ kind: 'outpin', label: l, in: pin(i) });
            outputs.push({ label: l, compId: c.id, pinId: p.id });
          });
          break;
        case 'tunnel':
        case 'textLabel':
          break;
        case 'and':
        case 'or':
        case 'nand':
        case 'nor':
        case 'xor':
        case 'xnor': {
          // Open inputs stay unconnected: Logisim ignores them like the simulator (none connected
          // gives E, a single one passes through); a Logisim gate has at least 2 inputs
          const gIns = c.inputs.map((_, i) => pin(i));
          while (gIns.length < 2) gIns.push(OPEN);
          P.push({ kind: 'gate', type: c.type.toUpperCase() as GateKind, ins: gIns, out: out(0) });
          break;
        }
        case 'not':
          not(pin(0), out(0));
          break;
        case 'buffer':
          P.push({ kind: 'buf', in: pin(0), out: out(0) });
          break;
        case 'triState':
          P.push({ kind: 'tri', in: pin(0), en: pin(1), out: out(0) });
          break;
        case 'pullResistor':
          if (isConn(c.inputs[0]?.id)) P.push({ kind: 'pull', value: c.state.pullValue ?? 0, at: pin(0) });
          break;
        case 'controlledInverter':
          P.push({ kind: 'tri', in: pin(0), en: pin(1), out: out(0), inv: true });
          break;
        case 'splitter4':
          // An open bit leaves its output undriven: x in Logisim, as in the simulator
          for (let i = 0; i < 4; i++) if (c.outputs[i] && isConn(c.inputs[i]?.id)) union(pin(i), out(i));
          break;
        case 'halfAdder': {
          const [a, b] = [ins(0), ins(1)];
          g('XOR', [a, b], out(0));
          g('AND', [a, b], out(1));
          break;
        }
        case 'fullAdder': {
          const [a, b, cin] = [ins(0), ins(1), ins(2, 0)]; // open carry-in = 0, like Logisim's adder
          const x = g('XOR', [a, b]);
          g('XOR', [x, cin], out(0));
          g('OR', [g('AND', [a, b]), g('AND', [cin, x])], out(1));
          break;
        }
        case 'halfSubtractor': {
          const [a, b] = [ins(0), ins(1)];
          g('XOR', [a, b], out(0));
          g('AND', [not(a), b], out(1));
          break;
        }
        case 'fullSubtractor': {
          const [a, b, bin] = [ins(0), ins(1), ins(2, 0)]; // open borrow-in = 0
          const x = g('XOR', [a, b]);
          g('XOR', [x, bin], out(0));
          g('OR', [g('AND', [not(a), b]), g('AND', [not(x), bin])], out(1));
          break;
        }
        case 'mux2': {
          const s = ins(2);
          g('OR', [g('AND', [not(s), ins(0)]), g('AND', [s, ins(1)])], out(0));
          break;
        }
        case 'mux4':
        case 'mux8': {
          const bits = c.type === 'mux4' ? 2 : 3;
          const sel = Array.from({ length: bits }, (_, b) => ins((c.type === 'mux4' ? 4 : 8) + b));
          const nsel = sel.map((s) => not(s));
          const terms = Array.from({ length: 1 << bits }, (_, k) =>
            g('AND', [...sel.map((s, b) => ((k >> b) & 1 ? s : nsel[b])), ins(k)])
          );
          const y = g('OR', terms, c.type === 'mux4' ? out(0) : undefined);
          if (c.type === 'mux8') {
            union(y, out(0));
            if (c.outputs[1]) not(y, out(1));
          }
          break;
        }
        case 'demux2': {
          const [d, s] = [ins(0), ins(1)];
          g('AND', [d, not(s)], out(0));
          g('AND', [d, s], out(1));
          break;
        }
        case 'demux4': {
          const [d, s0, s1] = [ins(0), ins(1), ins(2)];
          const [n0, n1] = [not(s0), not(s1)];
          for (let k = 0; k < 4; k++) if (c.outputs[k]) g('AND', [d, k & 1 ? s0 : n0, k & 2 ? s1 : n1], out(k));
          break;
        }
        case 'decoder2to4':
        case 'decoder3to8': {
          const bits = c.type === 'decoder2to4' ? 2 : 3;
          const en = ins(0, 1); // unconnected enable = enabled
          const a = Array.from({ length: bits }, (_, b) => ins(1 + b));
          const na = a.map((x) => not(x));
          for (let k = 0; k < 1 << bits; k++) if (c.outputs[k]) g('AND', [en, ...a.map((x, b) => ((k >> b) & 1 ? x : na[b]))], out(k));
          break;
        }
        case 'priorityEncoder4to2': {
          // Only inputs at 1 count, so an open one is a 0
          const [d0, d1, d2, d3] = [ins(0, 0), ins(1, 0), ins(2, 0), ins(3, 0)];
          if (c.outputs[0]) g('OR', [d3, d2], out(0));
          if (c.outputs[1]) g('OR', [d3, g('AND', [not(d2), d1])], out(1));
          if (c.outputs[2]) g('OR', [d0, d1, d2, d3], out(2));
          break;
        }
        case 'comparator4': {
          const a = [ins(0), ins(1), ins(2), ins(3)];
          const b = [ins(4), ins(5), ins(6), ins(7)];
          const e = a.map((x, i) => g('XNOR', [x, b[i]]));
          const na = a.map((x) => not(x));
          const nb = b.map((x) => not(x));
          const chain = (bitTerm: (i: number) => string) =>
            [3, 2, 1, 0].map((i) => g('AND', [...[3, 2, 1].filter((j) => j > i).map((j) => e[j]), bitTerm(i)]));
          if (c.outputs[0]) g('OR', chain((i) => g('AND', [a[i], nb[i]])), out(0));
          if (c.outputs[1]) g('AND', e, out(1));
          if (c.outputs[2]) g('OR', chain((i) => g('AND', [na[i], b[i]])), out(2));
          break;
        }
        case 'bcdTo7Seg':
        case 'rom16x4': {
          // Constant tables: minimal sum of products per output bit (address bit 0 = LSB)
          const table: number[] =
            c.type === 'bcdTo7Seg'
              ? Array.from({ length: 16 }, (_, k) =>
                  (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).reduce((acc, s, i) => acc | ((HEX_7SEG_MAP[k][s] ? 1 : 0) << i), 0)
                )
              : Array.isArray(c.state.romData) && c.state.romData.length === 16
                ? c.state.romData
                : [0, 1, 4, 9, 3, 7, 15, 12, 8, 5, 10, 2, 6, 11, 14, 13];
          const addr = [ins(0), ins(1), ins(2), ins(3)];
          const lit: Record<string, string> = { A: addr[3], B: addr[2], C: addr[1], D: addr[0] };
          const negCache: Record<string, string> = {};
          const neg = (v: string) => (negCache[v] ||= not(lit[v]));
          const nOut = c.type === 'bcdTo7Seg' ? 7 : 4;
          for (let bit = 0; bit < nOut; bit++) {
            if (!c.outputs[bit]) continue;
            const values: Record<number, LogicValue> = {};
            // K-map index: A B C D = address bits 3 2 1 0
            for (let k = 0; k < 16; k++) values[k] = ((table[k] >> bit) & 1) as LogicValue;
            const sop = solveKMap(values, 4).simplifiedSOP.trim();
            if (sop === '0' || sop === '1') {
              union(constNet(sop === '1' ? 1 : 0), out(bit));
              continue;
            }
            const terms = sop.split('+').map((t) => {
              const lits = (t.trim().match(/[A-D]'?/g) || []).map((m) => (m.endsWith("'") ? neg(m[0]) : lit[m[0]]));
              return lits.length === 1 ? lits[0] : g('AND', lits);
            });
            if (terms.length === 1) union(terms[0], out(bit));
            else g('OR', terms, out(bit));
          }
          break;
        }
        case 'alu4': {
          const a = [ins(0), ins(1), ins(2), ins(3)];
          const b = [ins(5), ins(6), ins(7), ins(8)];
          const cin = ins(4, 0); // open carry-in = 0, like Logisim's adder
          const [s0, s1] = [ins(9), ins(10)];
          const adder = (x: string[], y: string[], c0: string) => {
            let carry = c0;
            const sum: string[] = [];
            for (let i = 0; i < 4; i++) {
              const t = g('XOR', [x[i], y[i]]);
              sum.push(g('XOR', [t, carry]));
              carry = g('OR', [g('AND', [x[i], y[i]]), g('AND', [carry, t])]);
            }
            return { sum, carry };
          };
          const add = adder(a, b, cin);
          // A - B - Cin = A + ~B + ~Cin; its carry out is "no borrow", i.e. A >= B + Cin (as the simulator)
          const sub = adder(a, b.map((x) => not(x)), not(cin));
          const [ns0, ns1] = [not(s0), not(s1)];
          const m = [g('AND', [ns1, ns0]), g('AND', [ns1, s0]), g('AND', [s1, ns0]), g('AND', [s1, s0])];
          const f = [0, 1, 2, 3].map((i) =>
            g(
              'OR',
              [g('AND', [m[0], add.sum[i]]), g('AND', [m[1], sub.sum[i]]), g('AND', [m[2], g('AND', [a[i], b[i]])]), g('AND', [m[3], g('OR', [a[i], b[i]])])],
              c.outputs[i] ? out(i) : undefined
            )
          );
          if (c.outputs[4]) g('OR', [g('AND', [m[0], add.carry]), g('AND', [m[1], sub.carry])], out(4));
          if (c.outputs[5]) g('NOR', f, out(5));
          break;
        }
        case 'dFlipFlop':
          P.push({ kind: 'ff', type: 'D', a: pin(0), clk: pin(1), q: out(0), qn: out(1) });
          break;
        case 'jkFlipFlop':
          P.push({ kind: 'ff', type: 'JK', a: pin(0), b: pin(2), clk: pin(1), q: out(0), qn: out(1) });
          break;
        case 'tFlipFlop':
          P.push({ kind: 'ff', type: 'T', a: pin(0), clk: pin(1), reset: pin(2), q: out(0), qn: out(1) });
          break;
        case 'srLatch': {
          // Level-sensitive latch = flip-flop driven only by its asynchronous set / reset;
          // S=R=1 holds like the simulator, so each only acts while the other is low
          const [s, r] = [ins(0, 0), ins(1, 0)]; // open S / R holds, as 0 does
          P.push({ kind: 'ff', type: 'D', preset: g('AND', [s, not(r)]), reset: g('AND', [r, not(s)]), q: out(0), qn: out(1) });
          break;
        }
        case 'counter4': {
          const clk = ins(0, 0);
          const rst = ins(1, 0);
          const q = [0, 1, 2, 3].map((i) => out(i));
          const t = [constNet(1), q[0], g('AND', [q[0], q[1]]), g('AND', [q[0], q[1], q[2]])];
          q.forEach((qi, i) => P.push({ kind: 'ff', type: 'T', a: t[i], clk, reset: rst, q: qi }));
          break;
        }
        case 'register4': {
          const clk = ins(4, 0);
          const we = ins(5, 1); // unconnected write enable = enabled
          const rst = ins(6, 0);
          const nwe = not(we);
          for (let i = 0; i < 4; i++) {
            const q = out(i);
            const d = g('OR', [g('AND', [we, ins(i)]), g('AND', [nwe, q])]);
            P.push({ kind: 'ff', type: 'D', a: d, clk, reset: rst, q });
          }
          break;
        }
        case 'shiftRegister4': {
          // 74HC194: 01 shifts right (SR into Q0), 10 shifts left (SL into Q3), else hold
          const [clk, rst, sl, sr, s0, s1] = [ins(0, 0), ins(1, 0), ins(2), ins(3), ins(4), ins(5)];
          const q = [0, 1, 2, 3].map((i) => out(i));
          const right = g('AND', [not(s1), s0]);
          const left = g('AND', [s1, not(s0)]);
          const hold = g('NOR', [right, left]);
          const fromRight = [sr, q[0], q[1], q[2]];
          const fromLeft = [q[1], q[2], q[3], sl];
          q.forEach((qi, i) => {
            const d = g('OR', [g('AND', [right, fromRight[i]]), g('AND', [left, fromLeft[i]]), g('AND', [hold, qi])]);
            P.push({ kind: 'ff', type: 'D', a: d, clk, reset: rst, q: qi });
          });
          break;
        }
        case 'ram16x4': {
          const addr = [ins(0), ins(1), ins(2), ins(3)];
          const din = [ins(4), ins(5), ins(6), ins(7)];
          const clk = ins(8, 0);
          const we = ins(9, 1); // unconnected write enable = enabled (only 0 blocks writing)
          const na = addr.map((x) => not(x));
          // Logisim flip-flops power up as 0, so a bit whose initial content is 1 is stored inverted:
          // written as NOT data and read back through a NOT, which keeps the contents exact
          const init = Array.isArray(c.state.ramData) && c.state.ramData.length === 16 ? c.state.ramData : Array.from({ length: 16 }, (_, i) => i);
          const ndin: Record<number, string> = {};
          const words: string[][] = [];
          const sel: string[] = [];
          for (let k = 0; k < 16; k++) {
            sel.push(g('AND', addr.map((x, b) => ((k >> b) & 1 ? x : na[b]))));
            const w = g('AND', [we, sel[k]]);
            const nw = not(w);
            words.push(
              [0, 1, 2, 3].map((b) => {
                const inverted = ((init[k] >> b) & 1) === 1;
                const data = inverted ? (ndin[b] ||= not(din[b])) : din[b];
                const q = newNet();
                P.push({ kind: 'ff', type: 'D', a: g('OR', [g('AND', [w, data]), g('AND', [nw, q])]), clk, q });
                return inverted ? not(q) : q;
              })
            );
          }
          for (let b = 0; b < 4; b++) if (c.outputs[b]) g('OR', words.map((w, k) => g('AND', [sel[k], w[b]])), out(b));
          break;
        }
        case 'subcircuit': {
          const def = c.state.subcircuitId ? getSubcircuitDefinition(c.state.subcircuitId) : undefined;
          if (!def || depth > 8) {
            warnings.push(`${label}: alt devre tanımı bulunamadı, aktarılmadı.`);
            break;
          }
          // Inline the IC: its port pins share the nets of this instance's pins
          const inner = new Map<string, string>();
          const inPorts = def.ports.filter((p) => p.type === 'input');
          const outPorts = def.ports.filter((p) => p.type === 'output');
          // An open IC input is an undriven net inside (x in Logisim, as the simulator's floating port)
          inPorts.forEach((p, i) => inner.set(p.targetPinId, isConn(c.inputs[i]?.id) ? netOfPin.get(c.inputs[i].id)! : newNet()));
          outPorts.forEach((p, i) => {
            const target = def.components.find((x) => x.id === p.targetCompId);
            const pinId = target && ['led', 'probe'].includes(target.type) ? target.inputs[0]?.id : p.targetPinId;
            if (pinId) inner.set(pinId, out(i));
          });
          buildLevel(def.components, def.wires, `${scope}${c.id}/`, inner, depth + 1);
          break;
        }
        default:
          warnings.push(`${label}: '${c.type}' Logisim'e aktarılamadı.`);
      }
      if (openInputs)
        warnings.push(`${label}: boştaki giriş(ler)i Logisim'e x (sürücüsüz OPEN tüneli) olarak aktarıldı; kapılarla kurulan karşılığı bazı çıkışlarda simülatörden farklı sonuç verebilir.`);
      if (P.length) blocks.push({ prims: P });
    }
  };

  buildLevel(components, wires, '', new Map(), 0);
  const constPrims: Prim[] = [];
  if (usesC0) constPrims.push({ kind: 'const', value: 0, out: C0 });
  if (usesC1) constPrims.push({ kind: 'const', value: 1, out: C1 });
  if (constPrims.length) blocks.unshift({ prims: constPrims });

  // --- readable tunnel names: pins keep their label, the rest are numbered --------------------
  const netName = new Map<string, string>();
  const used = new Set<string>();
  const claim = (base: string) => {
    let n = base.replace(/\s+/g, '_') || 'n';
    for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
    used.add(n);
    return n;
  };
  for (const b of blocks)
    for (const p of b.prims) {
      if (p.kind === 'inpin' || p.kind === 'clock') netName.set(find(p.out), netName.get(find(p.out)) || claim(p.label));
    }
  let counter = 0;
  const openRoots = new Set(openNets.map(find));
  const nameOf = (net: string) => {
    const r = find(net);
    if (!netName.has(r)) netName.set(r, claim(r === find(C0) ? 'GND' : r === find(C1) ? 'VCC' : openRoots.has(r) ? 'OPEN' : `n${counter++}`));
    return netName.get(r)!;
  };

  // --- layout -------------------------------------------------------------------------------
  const xml: string[] = [];
  const tunnel = (x: number, y: number, net: string, sink: boolean) =>
    net !== OPEN &&
    xml.push(`    <comp lib="0" loc="(${x},${y})" name="Tunnel"><a name="facing" val="${sink ? 'east' : 'west'}"/><a name="label" val="${xmlEsc(nameOf(net))}"/></comp>`);
  const CELL_W = 220;
  const CELL_H = 110;
  const PER_ROW = 8;
  let cell = 0;
  const gateOffsets = (n: number) => {
    // Logisim AbstractGate input spacing for size 50
    const [ss, sd, sl] = n <= 3 ? [-10, 20, 20] : [-5, 10, 10];
    return Array.from({ length: n }, (_, i) => (n % 2 ? ss * (n - 1) + sd * i : ss * n + sd * i + (i >= n / 2 ? sl : 0)));
  };
  for (const b of blocks) {
    // each block starts on a fresh row when it would not fit, so its parts stay together
    if (cell % PER_ROW !== 0 && (cell % PER_ROW) + b.prims.length > PER_ROW && b.prims.length <= PER_ROW) cell += PER_ROW - (cell % PER_ROW);
    for (const p of b.prims) {
      const n = p.kind === 'gate' ? p.ins.length : 0;
      const extraRows = n > 8 ? Math.ceil((n - 8) / 10) : 0;
      const x = 200 + (cell % PER_ROW) * CELL_W;
      const y = 120 + Math.floor(cell / PER_ROW) * CELL_H + (extraRows ? extraRows * 50 : 0);
      cell += 1 + extraRows * PER_ROW;
      switch (p.kind) {
        case 'gate': {
          const neg = p.type === 'NAND' || p.type === 'NOR' || p.type === 'XNOR' ? 10 : 0;
          const xorBonus = p.type === 'XOR' || p.type === 'XNOR' ? 10 : 0;
          const dx = 50 + neg + xorBonus;
          xml.push(
            `    <comp lib="1" loc="(${x},${y})" name="${p.type} Gate"><a name="inputs" val="${p.ins.length}"/><a name="size" val="50"/>${xorBonus ? '<a name="xor" val="odd"/>' : ''}</comp>`
          );
          gateOffsets(p.ins.length).forEach((dy, i) => tunnel(x - dx, y + dy, p.ins[i], true));
          tunnel(x, y, p.out, false);
          break;
        }
        case 'not':
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="NOT Gate"/>`);
          tunnel(x - 30, y, p.in, true);
          tunnel(x, y, p.out, false);
          break;
        case 'buf':
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="Buffer"/>`);
          tunnel(x - 20, y, p.in, true);
          tunnel(x, y, p.out, false);
          break;
        case 'tri':
          // Logisim's (wide) controlled inverter is 10 longer than the buffer
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="${p.inv ? 'Controlled Inverter' : 'Controlled Buffer'}"/>`);
          tunnel(x - (p.inv ? 30 : 20), y, p.in, true);
          tunnel(x - (p.inv ? 20 : 10), y + 10, p.en, true);
          tunnel(x, y, p.out, false);
          break;
        case 'ff': {
          const name = p.type === 'D' ? 'D Flip-Flop' : p.type === 'T' ? 'T Flip-Flop' : 'J-K Flip-Flop';
          xml.push(`    <comp lib="4" loc="(${x},${y})" name="${name}"/>`);
          if (p.type === 'JK') {
            if (p.a) tunnel(x - 40, y, p.a, true);
            if (p.b) tunnel(x - 40, y + 20, p.b, true);
            if (p.clk) tunnel(x - 40, y + 10, p.clk, true);
          } else {
            if (p.a) tunnel(x - 40, y + 20, p.a, true);
            if (p.clk) tunnel(x - 40, y, p.clk, true);
          }
          if (p.reset) tunnel(x - 10, y + 30, p.reset, true);
          if (p.preset) tunnel(x - 30, y + 30, p.preset, true);
          if (p.q) tunnel(x, y, p.q, false);
          if (p.qn) tunnel(x, y + 20, p.qn, false);
          break;
        }
        case 'const':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Constant"><a name="value" val="0x${p.value}"/></comp>`);
          tunnel(x, y, p.out, false);
          break;
        case 'inpin':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Pin"><a name="tristate" val="false"/><a name="label" val="${xmlEsc(p.label)}"/></comp>`);
          tunnel(x, y, p.out, false);
          break;
        case 'clock':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Clock"><a name="label" val="${xmlEsc(p.label)}"/></comp>`);
          tunnel(x, y, p.out, false);
          break;
        case 'outpin':
          xml.push(
            `    <comp lib="0" loc="(${x},${y})" name="Pin"><a name="facing" val="west"/><a name="output" val="true"/><a name="label" val="${xmlEsc(p.label)}"/></comp>`
          );
          tunnel(x, y, p.in, true);
          break;
        case 'pull':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Pull Resistor"><a name="pull" val="${p.value}"/></comp>`);
          tunnel(x, y, p.at, true);
          break;
      }
    }
  }

  const circuit = xmlEsc((circuitName || 'main').trim() || 'main');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="2.7.1" version="1.0">
  This file was exported by LogicDesign Studio.
  <lib desc="#Wiring" name="0"/>
  <lib desc="#Gates" name="1"/>
  <lib desc="#Plexers" name="2"/>
  <lib desc="#Arithmetic" name="3"/>
  <lib desc="#Memory" name="4"/>
  <lib desc="#I/O" name="5"/>
  <main name="${circuit}"/>
  <circuit name="${circuit}">
${xml.join('\n')}
  </circuit>
</project>
`;
  return { xml: doc, warnings, inputs, outputs };
}
