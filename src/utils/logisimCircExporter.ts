import type { CircuitComponentInstance, CircuitWire, ComponentType, CustomSubcircuit } from '../types/circuit';
import { getLogicalConnections } from './wiringEngine';
import {
  ALU_OP_BITS,
  ARITH_PINS,
  ARITH_TYPES,
  FLIP_FLOP_TYPES,
  HEX_7SEG_MAP,
  MEM_TYPES,
  RAM_TYPES,
  bitSelectorSelectWidth,
  getArithConfig,
  getArithMode,
  getCounterMax,
  getGateWidth,
  getMemConfig,
  getPlexerConfig,
  getRamConfig,
  getSplitterConfig,
  getTrigger,
  getIoConfig,
  pinKey,
  ramPinWidth,
  splitterThreads,
} from './circuitEngine';
import { getSubcircuitDefinition, subcircuitPortWidth } from './subcircuitManager';
import { solveKMap } from './kmapSolver';
import { memToRawText } from './memImage';
import {
  ARITH_MODE_PARTS,
  EVO_ONLY_ARITH,
  LOGISIM_ARITH_MODE,
  LOGISIM_ARITH_NAME,
  LOGISIM_MEM_NAME,
  LOGISIM_RAM_NAME,
  LOGISIM_IO_NAME,
  logisimIoPorts,
  logisimArithPorts,
  logisimMemPorts,
  logisimDefaultPortOffsets,
  logisimPlexerPortKeys,
  logisimPlexerPorts,
  logisimRamPorts,
  logisimSplitterEnds,
  type LogisimPlexer,
  type LogisimRamLook,
} from './logisimCircImporter';
import type { LogicValue } from '../types/logic';
import { isTtlType, ttlChipOf, ttlEvoOffset, ttlEvoPin, ttlEvoRemapped, ttlInKey, ttlPorts } from './ttlChips';
import { getTtlConfig } from './circuitEngine';

/** Library number of evolution's #TTL in the exported file */
const TTL_LIB = 6;

/*
 * Logisim 2.7 (.circ) export.
 *
 * Every part is first expanded into Logisim primitives (gates, NOT, controlled buffer, flip-flops,
 * constants, pins, clocks, splitters, bit extenders / selectors, subcircuits); blocks Logisim has no
 * exact equivalent for (adders, plexers, decoders, ALU, registers, ...) become small gate / flip-flop
 * networks with the same behaviour as our simulator. Primitives are laid out on a grid and connected
 * with Logisim tunnels named after their net, so no wire can accidentally touch another part's pin.
 * Pin offsets were measured in Logisim 2.7.1 (gates: output at loc, inputs at -(size+bubble+xor) with
 * the AbstractGate spacing; flip-flops: Q (0,0), Q' (0,20), D/T (-40,20), clock (-40,0) or (-40,10) for
 * J-K, reset (-10,30), preset (-30,30)). Open inputs follow the simulator's Logisim rules: on primitives
 * they stay unconnected, on gate networks they become x (or the fixed level the simulator reads for
 * them). Checked in Logisim 2.7.1: primitives, presets and ICs match exactly; a gate network cannot
 * always reproduce a block's x (AND(0, x) = 0, a per-bit register still loads the defined bits of a
 * partly open word).
 *
 * Bit widths: every tunnel carries the width of the pin it stands for, so a net whose pins disagree on
 * the width is a width error in Logisim too (same-named tunnels of different widths). Parts whose width
 * follows their net (probe, pull resistor) take the net's width. Every IC definition becomes its own
 * <circuit> (ports = Pins in port order, Logisim's default appearance) used as a subcircuit.
 */

type GateKind = 'AND' | 'OR' | 'NAND' | 'NOR' | 'XOR' | 'XNOR';
type OutMode = '01' | '0Z' | 'Z1';
type Prim =
  // width: data bits (1 unless a canvas gate is wider); negated: input slots from 0; xor: multi-input XOR rule
  | { kind: 'gate'; type: GateKind; ins: string[]; out: string; mode?: OutMode; width?: number; negated?: number[]; xor?: 'odd' | 'one' }
  | { kind: 'not'; in: string; out: string; mode?: OutMode; width?: number }
  | { kind: 'buf'; in: string; out: string; mode?: OutMode; width?: number }
  | { kind: 'tri'; in: string; en: string; out: string; inv?: boolean; width?: number }
  | { kind: 'ff'; type: 'D' | 'T' | 'JK'; a?: string; b?: string; clk?: string; q?: string; qn?: string; reset?: string; preset?: string }
  | { kind: 'const'; value: number; out: string; width?: number }
  | { kind: 'inpin'; label: string; out: string; width?: number; tristate?: boolean }
  | { kind: 'clock'; label: string; out: string }
  // width undefined: the width of the net (a probe follows it)
  | { kind: 'outpin'; label: string; in: string; width?: number }
  | { kind: 'pull'; value: 0 | 1 | 'X'; at: string }
  | { kind: 'splitter'; combined: string; ends: string[]; bitEnd: number[]; appear: 'left' | 'right' | 'center'; endWidth: number[] }
  | { kind: 'extender'; in: string; ext: string | null; out: string; inW: number; outW: number; type: string }
  | { kind: 'selector'; data: string; sel: string; out: string; dataW: number; groupW: number }
  | { kind: 'sub'; circuit: string; ins: string[]; outs: string[]; inW: number[]; outW: number[]; inOff: Pt[]; outOff: Pt[] }
  // A real Logisim plexer (facing east, select bottom-left); nets / widths / sinks in Logisim's port order
  | {
      kind: 'plexer';
      part: LogisimPlexer;
      select: number;
      width: number;
      enable: boolean;
      disabled: '0' | 'Z';
      tristate: boolean;
      nets: string[];
      widths: number[];
      sinks: boolean[];
    }
  // A real Logisim arithmetic part (always east); nets / widths / sinks in logisimArithPorts order
  | { kind: 'arith'; part: ComponentType; attrs: string; inputs: number; nets: string[]; widths: number[]; sinks: boolean[] }
  // A real Logisim memory part (classic look); nets / widths / sinks in memPorts order
  | { kind: 'mem'; part: ComponentType; attrs: string; length: number; parallel: boolean; nets: string[]; widths: number[]; sinks: boolean[] }
  // A real Logisim RAM / ROM / random generator; its connection points relative to loc
  | { kind: 'ram'; part: ComponentType; attrs: string; ports: Array<{ off: Pt; net: string; width: number; sink: boolean }>; lib?: number; name?: string };

interface Pt {
  x: number;
  y: number;
}

export interface CircExportResult {
  xml: string;
  warnings: string[];
  // For tests / UI: which Logisim pin stands for which canvas pin
  inputs: { label: string; compId: string; pinIndex: number }[];
  outputs: { label: string; compId: string; pinId: string }[];
}

// Logisim 2.7.1 memory pins (classic look); the counter's up/down pin is evolution's, written too so evolution
// connects it (Logisim 2.7.1 has no pin there and leaves the tunnel alone)
const memPorts = (part: ComponentType, length: number, parallel: boolean) =>
  logisimMemPorts(part, { width: 1, length, parallel, appearance: 'classic', hasEnable: true, hasUpDown: true });

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Where the port Pins of an IC's own circuit go: inputs facing east (west edge of the box), outputs
// facing west (east edge), each column ordered by y, so Logisim's default appearance keeps port order
const PORT_IN_X = 40;
const PORT_OUT_X = 80;
const portY = (i: number) => 100 + 20 * i;

interface SubcircuitInfo {
  circuit: string;
  inOff: Pt[];
  outOff: Pt[];
}

export function exportLogisimCirc(circuitName: string, components: CircuitComponentInstance[], wires: CircuitWire[]): CircExportResult {
  const warnings: string[] = [];
  // Evolution's TTL library is declared only when a chip uses it (Logisim 2.7.1 cannot load it)
  let usesTtl = false;
  const inputs: CircExportResult['inputs'] = [];
  const outputs: CircExportResult['outputs'] = [];

  // Circuit names of the file: the canvas first, then one per IC definition
  const circuitNames = new Set<string>();
  const uniqueCircuitName = (base: string) => {
    const b = base.trim() || 'main';
    let n = b;
    for (let i = 2; circuitNames.has(n); i++) n = `${b} (${i})`;
    circuitNames.add(n);
    return n;
  };
  const topName = uniqueCircuitName(circuitName || 'main');
  const circuitXml: string[] = [];
  const subInfo = new Map<string, SubcircuitInfo>();
  const building = new Set<string>();

  // The <circuit> of an IC definition (built once, inner ICs first)
  const subcircuitFor = (def: CustomSubcircuit, depth: number): SubcircuitInfo | null => {
    const known = subInfo.get(def.id);
    if (known) return known;
    if (building.has(def.id) || depth > 8) return null;
    building.add(def.id);
    const name = uniqueCircuitName(def.name || def.id);
    const inPorts = def.ports.filter((p) => p.type === 'input');
    const outPorts = def.ports.filter((p) => p.type === 'output');
    const offsets = logisimDefaultPortOffsets([
      ...inPorts.map((_, i) => ({ loc: { x: PORT_IN_X, y: portY(i) }, facing: 'east' })),
      ...outPorts.map((_, i) => ({ loc: { x: PORT_OUT_X, y: portY(i) }, facing: 'west' })),
    ]);
    const info = { circuit: name, inOff: offsets.slice(0, inPorts.length), outOff: offsets.slice(inPorts.length) };
    const body = buildCircuit(def.components, def.wires, def, depth + 1);
    circuitXml.push(`  <circuit name="${xmlEsc(name)}">\n${body}\n  </circuit>`);
    building.delete(def.id);
    subInfo.set(def.id, info);
    return info;
  };

  // Builds the parts of one circuit (the canvas, or an IC definition with its ports as Pins)
  const buildCircuit = (comps: CircuitComponentInstance[], levelWires: CircuitWire[], def: CustomSubcircuit | null, depth: number): string => {
    const blocks: { prims: Prim[] }[] = [];
    const fixed: Array<{ x: number; y: number; prim: Prim }> = [];

    // --- nets (union-find over net names so aliases like splitter outputs collapse) -------------
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

    // Inside an IC the port pins are bound to the nets of the circuit's own port Pins
    const inScope = def !== null;
    const alias = new Map<string, string>();
    if (def) {
      const inPorts = def.ports.filter((p) => p.type === 'input');
      const outPorts = def.ports.filter((p) => p.type === 'output');
      inPorts.forEach((p, i) => {
        const net = `_port_in${i}`;
        alias.set(p.targetPinId, net);
        const tristate = !!def.components.find((c) => c.id === p.targetCompId)?.state.pinTristate;
        fixed.push({ x: PORT_IN_X, y: portY(i), prim: { kind: 'inpin', label: p.name, out: net, width: subcircuitPortWidth(def, p), tristate } });
      });
      outPorts.forEach((p, i) => {
        const net = `_port_out${i}`;
        const target = def.components.find((x) => x.id === p.targetCompId);
        const pinId = target && ['led', 'probe', 'buzzer'].includes(target.type) ? target.inputs[0]?.id : p.targetPinId;
        if (pinId) alias.set(pinId, net);
        fixed.push({ x: PORT_OUT_X, y: portY(i), prim: { kind: 'outpin', label: p.name, in: net, width: subcircuitPortWidth(def, p) } });
      });
    }

    const conns = getLogicalConnections(comps, levelWires);
    const netOfPin = new Map<string, string>();
    const connected = new Set<string>();
    for (const w of conns) {
      netOfPin.set(w.fromPinId, w.fromPinId);
      netOfPin.set(w.toPinId, w.fromPinId);
      connected.add(w.fromPinId);
      connected.add(w.toPinId);
    }
    for (const [pinId, outer] of alias) {
      const n = netOfPin.get(pinId) || pinId;
      netOfPin.set(pinId, n);
      connected.add(pinId);
      union(outer, n);
    }
    // Output pins always get a net; an unconnected input reads `floating` (undefined: x)
    const outNet = (pinId?: string) => (pinId ? netOfPin.get(pinId) || pinId : newNet());
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
      const w0 = (p?: { width?: number }) => p?.width ?? 1;

      switch (c.type) {
        case 'switch':
        case 'pushbutton': {
          // Inside an IC: a switch bound to a port is driven from outside, any other one is a constant
          if (inScope && c.outputs[0] && alias.has(c.outputs[0].id)) break;
          const width = w0(c.outputs[0]);
          const value = width > 1 ? (c.state.inputValue ?? 0) : c.state.on ? 1 : 0;
          if (inScope) P.push({ kind: 'const', value, out: out(0), width });
          else {
            P.push({ kind: 'inpin', label, out: out(0), width, tristate: !!c.state.pinTristate });
            inputs.push({ label, compId: c.id, pinIndex: 0 });
          }
          break;
        }
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
        case 'constant': {
          const width = w0(c.outputs[0]);
          const v = c.state.constValue ?? 1;
          P.push({ kind: 'const', value: width >= 32 ? v >>> 0 : v % 2 ** width, out: out(0), width });
          break;
        }
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
        case 'rgbMatrix16x16':
          if (inScope) break; // an IC's outputs reach the outside through its ports
          c.inputs.forEach((p, i) => {
            const l = c.inputs.length === 1 ? label : `${label}_${p.name}`;
            // A probe follows its net's width; every other display has a fixed width
            P.push({ kind: 'outpin', label: l, in: pin(i), width: c.type === 'probe' ? undefined : w0(p) });
            outputs.push({ label: l, compId: c.id, pinId: p.id });
          });
          break;
        case 'tunnel':
        case 'textLabel':
          break;
        case 'sevenSegment':
        case 'hexDigit':
        case 'dotMatrix':
        case 'ledBar':
        case 'dipSwitch': {
          // The same Logisim part (lib 5 I/O) on its own connection points. Matrices / LED bars go with their
          // inputs bottom-left (the side is only a drawing choice here, and 2.7.1 knows no other); a hex digit's
          // DP gets a tunnel on 2.7.1's point and on evolution's
          const cfg = getIoConfig(c);
          const a = (name: string, val: string | number | boolean) => `<a name="${name}" val="${val}"/>`;
          let attrs = '';
          const facing = (['east', 'south', 'west', 'north'] as const)[((c.rotation ?? 0) / 90) % 4];
          if (c.type === 'sevenSegment' || c.type === 'hexDigit') {
            if (c.type === 'sevenSegment' && c.state.ioActiveLow) attrs += a('active', false);
            if (!cfg.dp) attrs += a('decimalPoint', false);
          } else if (c.type === 'dipSwitch') {
            attrs += a('facing', facing) + a('number', cfg.size);
          } else if (c.type === 'ledBar') {
            attrs += a('matrixcols', cfg.size) + a('inputtype', cfg.ledBarMode === 'oneWire' ? 'row' : 'column');
          } else {
            const shape = { square: 'square', circle: 'circle', padded: 'clusterSegment' }[c.state.dotShape ?? 'square'];
            attrs += a('inputtype', cfg.matrixInput) + a('matrixcols', cfg.cols) + a('matrixrows', cfg.rows) + a('dotshape', shape);
            if (c.state.ioPersist) attrs += a('persist', c.state.ioPersist);
          }
          if (c.state.ioOnColor) attrs += a('color', c.state.ioOnColor);
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
          const flat = { ...cfg, selectLoc: 'bl' as const };
          const sets =
            c.type === 'hexDigit'
              ? [logisimIoPorts(c.type, flat, { evolution: false }), logisimIoPorts(c.type, flat, { evolution: true }).filter((q) => q.key === 'dp')]
              : [logisimIoPorts(c.type, flat, { evolution: true, facing })];
          for (const set of sets) {
            for (const { key, off } of set) {
              const p = byKey.get(key);
              const isIn = !!p && c.inputs.includes(p);
              const net = !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN;
              ports.push({ off, net, width: p?.width ?? 1, sink: isIn });
            }
          }
          P.push({ kind: 'ram', part: c.type, attrs, ports, lib: 5, name: LOGISIM_IO_NAME[c.type] });
          if (c.type === 'dipSwitch' || c.type === 'ledBar')
            warnings.push(`${label}: Logisim-evolution parçası (${LOGISIM_IO_NAME[c.type]}); Logisim 2.7.1'de yok, 2.7.1 bu dosyayı açamaz.`);
          if (c.type === 'dipSwitch' && (c.state.dipBits ?? 0) !== 0)
            warnings.push(`${label}: anahtar konumları dosyaya yazılmadı (Logisim saklamaz), dosya açılınca hepsi kapalı.`);
          if (c.type === 'dotMatrix' && c.state.dotShape === 'padded')
            warnings.push(`${label}: boşluklu kare nokta şekli yalnız Logisim-evolution'da var; Logisim 2.7.1 bu dosyayı açamaz.`);
          if (c.type === 'dotMatrix' && cfg.matrixInput === 'select' && (cfg.rows === 1 || cfg.cols === 1))
            warnings.push(`${label}: tek satırlı / tek sütunlu seçim girişli matris Logisim-evolution düzeninde yazıldı; Logisim 2.7.1'de tek girişi var.`);
          break;
        }
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
          P.push({
            kind: 'gate',
            type: c.type.toUpperCase() as GateKind,
            ins: gIns,
            out: out(0),
            mode: c.state.outputMode,
            width: getGateWidth(c),
            negated: c.state.negated,
            xor: c.state.xorMode ?? 'odd',
          });
          break;
        }
        case 'not':
          P.push({ kind: 'not', in: pin(0), out: out(0), mode: c.state.outputMode, width: getGateWidth(c) });
          break;
        case 'buffer':
          P.push({ kind: 'buf', in: pin(0), out: out(0), mode: c.state.outputMode, width: getGateWidth(c) });
          break;
        case 'triState':
          P.push({ kind: 'tri', in: pin(0), en: pin(1), out: out(0), width: getGateWidth(c) });
          break;
        case 'pullResistor':
          if (isConn(c.inputs[0]?.id)) P.push({ kind: 'pull', value: c.state.pullValue ?? 0, at: pin(0) });
          break;
        case 'controlledInverter':
          P.push({ kind: 'tri', in: pin(0), en: pin(1), out: out(0), inv: true, width: getGateWidth(c) });
          break;
        case 'splitter4':
          // An open bit leaves its output undriven: x in Logisim, as in the simulator
          for (let i = 0; i < 4; i++) if (c.outputs[i] && isConn(c.inputs[i]?.id)) union(pin(i), out(i));
          break;
        case 'splitter': {
          // Logisim splitter: passive and bidirectional like ours, so every end is just a connection
          const { fanout, bitEnd, appear } = getSplitterConfig(c);
          const { endWidth } = splitterThreads(bitEnd, fanout);
          const end = (i: number) => (isConn(c.outputs[i]?.id) ? netOfPin.get(c.outputs[i].id)! : OPEN);
          P.push({ kind: 'splitter', combined: pin(0), ends: Array.from({ length: fanout }, (_, i) => end(i)), bitEnd, appear, endWidth });
          break;
        }
        case 'bitExtender':
          P.push({
            kind: 'extender',
            in: pin(0),
            ext: c.inputs[1] ? pin(1) : null,
            out: out(0),
            inW: w0(c.inputs[0]),
            outW: w0(c.outputs[0]),
            type: c.state.extendType ?? 'zero',
          });
          break;
        case 'bitSelector':
          P.push({ kind: 'selector', data: pin(0), sel: pin(1), out: out(0), dataW: w0(c.inputs[0]), groupW: w0(c.outputs[0]) });
          break;
        case 'multiplexer':
        case 'demultiplexer':
        case 'decoder':
        case 'priorityEncoder': {
          // Logisim has the same part, so it is written as is; open inputs stay open (read as x by both)
          const { select, width, enable } = getPlexerConfig(c);
          const keys = logisimPlexerPortKeys(c.type, select, enable);
          const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
          const nets: string[] = [];
          const widths: number[] = [];
          const sinks: boolean[] = [];
          for (const k of keys) {
            const p = byKey.get(k);
            const isIn = !!p && c.inputs.includes(p);
            nets.push(!p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN);
            widths.push(p?.width ?? 1);
            sinks.push(isIn);
          }
          P.push({
            kind: 'plexer',
            part: c.type,
            select,
            width,
            enable,
            disabled: c.state.plexDisabled ?? '0',
            tristate: !!c.state.plexTristate,
            nets,
            widths,
            sinks,
          });
          break;
        }
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
        case 'bcdTo7Seg': {
          // Constant tables: minimal sum of products per output bit (address bit 0 = LSB)
          const table: number[] = Array.from({ length: 16 }, (_, k) =>
            (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).reduce((acc, s, i) => acc | ((HEX_7SEG_MAP[k][s] ? 1 : 0) << i), 0)
          );
          const addr = [ins(0), ins(1), ins(2), ins(3)];
          const lit: Record<string, string> = { A: addr[3], B: addr[2], C: addr[1], D: addr[0] };
          const negCache: Record<string, string> = {};
          const neg = (v: string) => (negCache[v] ||= not(lit[v]));
          for (let bit = 0; bit < 7; bit++) {
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
        case 'srLatch': {
          // Level-sensitive latch = flip-flop driven only by its asynchronous set / reset;
          // S=R=1 holds like the simulator, so each only acts while the other is low
          const [s, r] = [ins(0, 0), ins(1, 0)]; // open S / R holds, as 0 does
          P.push({ kind: 'ff', type: 'D', preset: g('AND', [s, not(r)]), reset: g('AND', [r, not(s)]), q: out(0), qn: out(1) });
          break;
        }
        case 'subcircuit': {
          const sdef = c.state.subcircuitId ? getSubcircuitDefinition(c.state.subcircuitId) : undefined;
          const info = sdef ? subcircuitFor(sdef, depth) : null;
          if (!sdef || !info) {
            warnings.push(`${label}: alt devre tanımı ${sdef ? 'kendi içinde kendini kullanıyor' : 'bulunamadı'}, aktarılmadı.`);
            break;
          }
          // An open IC input stays unconnected: the inner Pin floats (x), like the simulator's open port
          const inPorts = sdef.ports.filter((p) => p.type === 'input');
          const outPorts = sdef.ports.filter((p) => p.type === 'output');
          P.push({
            kind: 'sub',
            circuit: info.circuit,
            ins: inPorts.map((_, i) => pin(i)),
            outs: outPorts.map((_, i) => (c.outputs[i] ? out(i) : OPEN)),
            inW: inPorts.map((p) => subcircuitPortWidth(sdef, p)),
            outW: outPorts.map((p) => subcircuitPortWidth(sdef, p)),
            inOff: info.inOff,
            outOff: info.outOff,
          });
          break;
        }
        case 'alu': {
          // No Logisim counterpart: built from Logisim's own parts, so the file opens in 2.7.1 too. Adder and
          // Subtractor (A, B, carry-in) give ADD / SUB with C, wide gates the logic operations, a signed
          // Comparator's A<B zero-extended SLT, and an 8-way Multiplexer on op picks Y; the flags come from gates
          const { width: w } = getArithConfig(c);
          const [a, b, op] = [ins(0), ins(1), ins(2)];
          const cin = ins(3, 0); // open carry-in = 0, like Logisim's adder
          const arith = (part: ComponentType, net: Record<string, string>, width: (k: string) => number, attrs = '') => {
            const ports = logisimArithPorts(part, 1);
            const inKeys = new Set(ARITH_PINS[part]!.inputs);
            P.push({
              kind: 'arith',
              part,
              attrs: `<a name="width" val="${w}"/>${attrs}`,
              inputs: 1,
              nets: ports.map(({ key }) => net[key] ?? OPEN),
              widths: ports.map(({ key }) => width(key)),
              sinks: ports.map(({ key }) => inKeys.has(key)),
            });
          };
          const dataW = (k: string) => (k === 'a' || k === 'b' || k === 'out' ? w : 1);
          const [sum, cout, diff, bout, lt] = [newNet(), newNet(), newNet(), newNet(), newNet()];
          arith('adder', { a, b, cin, out: sum, cout }, dataW);
          arith('subtractor', { a, b, bin: cin, out: diff, bout }, dataW);
          arith('comparator', { a, b, lt }, dataW, `<a name="mode" val="${LOGISIM_ARITH_MODE.signed}"/>`);
          const wide = (type: GateKind, x: string, y: string) => {
            const o = newNet();
            P.push({ kind: 'gate', type, ins: [x, y], out: o, width: w });
            return o;
          };
          let slt = lt;
          if (w > 1) {
            slt = newNet();
            P.push({ kind: 'extender', in: lt, ext: null, out: slt, inW: 1, outW: w, type: 'zero' });
          }
          const y = out(0);
          const data = [sum, diff, wide('AND', a, b), wide('OR', a, b), wide('XOR', a, b), wide('NOR', a, b), slt, b];
          const muxKeys = logisimPlexerPortKeys('multiplexer', ALU_OP_BITS, false);
          const muxNet: Record<string, string> = { sel: op, out: y };
          data.forEach((d, k) => (muxNet[`in${k}`] = d));
          P.push({
            kind: 'plexer',
            part: 'multiplexer',
            select: ALU_OP_BITS,
            width: w,
            enable: false,
            disabled: '0',
            tristate: false,
            nets: muxKeys.map((k) => muxNet[k]),
            widths: muxKeys.map((k) => (k === 'sel' ? ALU_OP_BITS : w)),
            sinks: muxKeys.map((k) => k !== 'out'),
          });
          // Bits of a bus: every bit, or just the top one
          const split = (bus: string, n: number) => {
            const ends = Array.from({ length: n }, () => newNet());
            P.push({ kind: 'splitter', combined: bus, ends, bitEnd: ends.map((_, i) => i + 1), appear: 'left', endWidth: ends.map(() => 1) });
            return ends;
          };
          const msb = (bus: string) => {
            if (w === 1) return bus;
            const top = newNet();
            P.push({
              kind: 'splitter',
              combined: bus,
              ends: [OPEN, top],
              bitEnd: Array.from({ length: w }, (_, i) => (i === w - 1 ? 2 : 1)),
              appear: 'left',
              endWidth: [w - 1, 1],
            });
            return top;
          };
          const yBits = w === 1 ? [y] : split(y, w);
          if (c.outputs[1]) {
            if (w === 1) not(y, out(1));
            else g('NOR', yBits, out(1));
          }
          if (c.outputs[2]) union(out(2), yBits[w - 1]);
          if (c.outputs[3] || c.outputs[4]) {
            const [o0, o1, o2] = split(op, ALU_OP_BITS);
            const [n1, n2] = [not(o1), not(o2)];
            const isAdd = g('AND', [not(o0), n1, n2]);
            const isSub = g('AND', [o0, n1, n2]);
            if (c.outputs[3]) g('OR', [g('AND', [isAdd, cout]), g('AND', [isSub, bout])], out(3));
            if (c.outputs[4]) {
              const [sa, sb] = [msb(a), msb(b)];
              const vAdd = g('AND', [g('XNOR', [sa, sb]), g('XOR', [msb(sum), sa])]);
              const vSub = g('AND', [g('XOR', [sa, sb]), g('XOR', [msb(diff), sa])]);
              g('OR', [g('AND', [isAdd, vAdd]), g('AND', [isSub, vSub])], out(4));
            }
          }
          warnings.push(
            `${label}: ALU'nun Logisim'de karşılığı yok; toplayıcı, çıkarıcı, karşılaştırıcı, kapılar ve çoklayıcıdan kurulmuş bir devre olarak aktarıldı (geri içe aktarılınca tek ALU değil, bu parçalar gelir).`
          );
          break;
        }
        default:
          if (isTtlType(c.type)) {
            // Evolution's TTL library (2.7.1 has none): written facing east with its settings, a tunnel on
            // each wired pin's evolution point (7476: evolution's pin of the same name). The flip-flop / counter
            // contents are not stored (evolution keeps no such attribute).
            const chip = ttlChipOf(c.type)!;
            const vccGnd = getTtlConfig(c).vccGnd;
            usesTtl = true;
            const a = (name: string, val: string | boolean) => `<a name="${name}" val="${val}"/>`;
            let attrs = a('VccGndPorts', vccGnd) + a('ShowInternalStructure', c.state.ttlInternal === true);
            if (c.label?.trim()) attrs += a('label', xmlEsc(c.label.trim()));
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
            for (const tp of ttlPorts(chip, vccGnd)) {
              const o = byKey.get(tp.key);
              const inp = tp.dir === 'inout' ? byKey.get(ttlInKey(tp.pin)) : tp.dir === 'input' ? o : undefined;
              const outp = tp.dir === 'input' ? undefined : o;
              // An in/out pin's two halves share the point and the net
              const net = outp && isConn(outp.id) ? out(c.outputs.indexOf(outp)) : inp ? pinNet(inp.id) : OPEN;
              ports.push({ off: ttlEvoOffset(chip, tp.pin), net, width: 1, sink: tp.dir === 'input' });
            }
            P.push({ kind: 'ram', part: c.type, attrs, ports, lib: TTL_LIB, name: chip.id });
            if (ttlEvoRemapped(chip))
              warnings.push(`${label}: Logisim-evolution'ın ${chip.id}'sı VCC/GND'yi varsayılan bacaklarda (${ttlEvoPin(chip, chip.vcc)}/${ttlEvoPin(chip, chip.gnd)}) tutuyor; bağlantılar evolution'daki aynı isimli bacaklara yazıldı.`);
            if (chip.seq && c.state.ttlSeq)
              warnings.push(`${label}: çipin içindeki saklı değerler dosyaya yazılmadı (Logisim saklamaz); dosya açılınca hepsi 0.`);
            break;
          }
          if (RAM_TYPES.has(c.type)) {
            // Logisim has the same part. A 2.7.1-rule RAM / ROM is written in the 2.7.1 layout; a ROM and the
            // random generator get tunnels on evolution's points too (evolution opens a file without an
            // appearance in its own look and reads them alike). An evolution-rule memory is written with its
            // evolution attributes and the classic appearance, on evolution's points only.
            const cfg = getRamConfig(c);
            const evo = c.type !== 'random' && cfg.flavor === 'evolution';
            const a = (name: string, val: string | number | boolean) => `<a name="${name}" val="${val}"/>`;
            let attrs = '';
            let looks: LogisimRamLook[];
            if (c.type === 'random') {
              attrs = a('width', cfg.dataWidth) + a('seed', c.state.randomSeed ?? 0) + a('trigger', getTrigger(c) === 'falling' ? 'falling' : 'rising');
              looks = ['logisim', 'evolution'];
            } else {
              attrs = a('addrWidth', cfg.addrWidth) + a('dataWidth', cfg.dataWidth);
              if (c.type === 'ram' && !evo) attrs += a('bus', cfg.bus);
              if ((c.type === 'ram' || c.type === 'dualRam') && evo) {
                const edge = cfg.trigger === 'rising' || cfg.trigger === 'falling';
                attrs += a('enables', 'byte') + a('databus', { bidir: 'bidir', separate: 'bibus', controlled: 'bibusControlled' }[cfg.dataBus]);
                attrs += a('trigger', cfg.trigger) + a('clearpin', cfg.clearPin);
                if (edge) attrs += a('asyncread', !!c.state.ramAsyncRead) + a('readbehav', c.state.ramReadBehavior ?? 'raw');
                if (edge && cfg.dataWidth > 8) attrs += a('byteenables', cfg.byteEnables ? 'byteEnables' : 'NobyteEnables');
              }
              if (evo) attrs += a('appearance', 'classic');
              if (c.type === 'rom') {
                const body = memToRawText(c.state.memPages ?? {}, 2 ** cfg.addrWidth).replace(/^v2\.0 raw\n/, '');
                attrs += `<a name="contents">addr/data: ${cfg.addrWidth} ${cfg.dataWidth}\n${body}</a>`;
              }
              looks = evo ? ['classic'] : c.type === 'rom' ? ['logisim', 'evolution'] : ['logisim'];
            }
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const ports: Array<{ off: Pt; net: string; width: number; sink: boolean }> = [];
            for (const look of looks) {
              for (const { key, off } of logisimRamPorts(c.type, cfg, look)) {
                // The bus read-back 'dio' shares the data point (and net) with 'd'
                if (key === 'dio') continue;
                const p = byKey.get(key);
                const isIn = !!p && c.inputs.includes(p);
                const net = !p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN;
                ports.push({ off, net, width: ramPinWidth(c.type, key, cfg), sink: isIn });
              }
            }
            P.push({ kind: 'ram', part: c.type, attrs, ports });
            const wired = (k: string) => isConn(byKey.get(k)?.id);
            if ((c.type === 'ram' || c.type === 'dualRam') && Object.values(c.state.memPages ?? {}).some((pg) => pg.some((v) => v)))
              warnings.push(`${label}: RAM içeriği dosyaya yazılmadı (Logisim RAM içeriğini .circ'te saklamaz); gerekiyorsa içerik düzenleyicisinden v2.0 raw dosyası olarak kaydedin.`);
            if (c.type === 'dualRam')
              warnings.push(`${label}: Logisim-evolution 5'in çift portlu RAM'i (DualRAM) olarak yazıldı; Logisim 2.7.1'de ve evolution'ın 5'ten eski sürümlerinde bu parça yok.`);
            else if (evo)
              warnings.push(`${label}: Logisim-evolution kurallı ${c.type === 'ram' ? 'RAM' : 'ROM'} olarak yazıldı; Logisim 2.7.1 bu parçayı kendi düzeniyle açar, bağlantıları tutmaz.`);
            else if (c.type === 'ram')
              warnings.push(`${label}: Logisim 2.7.1 RAM'i olarak yazıldı; Logisim-evolution bu RAM'i kendi düzenine çevirir (veri yolu ayarını okumaz), bağlantıları tutmaz.`);
            else if (c.type === 'rom' && wired('cs'))
              warnings.push(`${label}: Logisim-evolution'ın ROM'unda seçim (sel) girişi yok; orada ROM hep seçilidir.`);
            if (c.type === 'random')
              warnings.push(`${label}: Logisim-evolution aynı bağlantılarla açar ama başka bir sayı dizisi üretir (Xoshiro256++); dizi Logisim 2.7.1'de tutar.`);
            break;
          }
          if (MEM_TYPES.has(c.type)) {
            // Logisim has the same part: written with every attribute explicit (the defaults differ between
            // versions and parts) and the classic look; open inputs stay open (read alike by both)
            const { width, length, parallel } = getMemConfig(c);
            const trigger = getTrigger(c);
            let attrs = '';
            if (!FLIP_FLOP_TYPES.has(c.type)) attrs += `<a name="width" val="${width}"/>`;
            if (c.type === 'counter') attrs += `<a name="max" val="0x${getCounterMax(c).toString(16)}"/><a name="ongoal" val="${c.state.counterGoal ?? 'wrap'}"/>`;
            if (c.type === 'shiftRegister') attrs += `<a name="length" val="${length}"/><a name="parallel" val="${parallel}"/>`;
            attrs += `<a name="trigger" val="${trigger}"/><a name="appearance" val="classic"/>`;
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const ports = memPorts(c.type, length, parallel);
            const nets: string[] = [];
            const widths: number[] = [];
            const sinks: boolean[] = [];
            for (const { key } of ports) {
              const p = byKey.get(key);
              const isIn = !!p && c.inputs.includes(p);
              nets.push(!p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN);
              widths.push(p?.width ?? 1);
              sinks.push(isIn);
            }
            P.push({ kind: 'mem', part: c.type, attrs, length, parallel, nets, widths, sinks });
            // What one of the two Logisim versions reads differently
            const wired = (k: string) => isConn(byKey.get(k)?.id);
            if (FLIP_FLOP_TYPES.has(c.type) && wired('en'))
              warnings.push(`${label}: flip-flop'un EN girişi yalnız Logisim 2.7.1'de var; Logisim-evolution bu bağlantıyı yok sayar (hep etkin).`);
            if (c.type === 'counter' && wired('ud'))
              warnings.push(`${label}: sayacın yukarı/aşağı (UD) girişi yalnız Logisim-evolution'da var; Logisim 2.7.1 hep yukarı sayar.`);
            if (c.type === 'counter' && wired('ld'))
              warnings.push(`${label}: Logisim 2.7.1'de LD = 1 iken CT de 0 değilse sayaç yüklemek yerine geri sayar; Logisim-evolution burada olduğu gibi yükler.`);
            break;
          }
          if (ARITH_TYPES.has(c.type)) {
            // Logisim has the same part: written as is with every attribute explicit; open inputs stay open
            const { width, inputs: n } = getArithConfig(c);
            const mode = getArithMode(c);
            let attrs = `<a name="width" val="${width}"/>`;
            if (c.type === 'bitAdder') attrs += `<a name="inputs" val="${n}"/>`;
            if (ARITH_MODE_PARTS.has(c.type)) attrs += `<a name="mode" val="${LOGISIM_ARITH_MODE[mode]}"/>`;
            if (c.type === 'shifter') attrs += `<a name="shift" val="${c.state.shiftType ?? 'll'}"/>`;
            if (c.type === 'bitFinder') attrs += `<a name="type" val="${c.state.findType ?? 'low1'}"/>`;
            const byKey = new Map([...c.inputs, ...c.outputs].map((p) => [pinKey(c, p), p]));
            const nets: string[] = [];
            const widths: number[] = [];
            const sinks: boolean[] = [];
            for (const { key } of logisimArithPorts(c.type, n)) {
              const p = byKey.get(key);
              const isIn = !!p && c.inputs.includes(p);
              nets.push(!p ? OPEN : isIn ? pinNet(p.id) : isConn(p.id) ? out(c.outputs.indexOf(p)) : OPEN);
              widths.push(p?.width ?? 1);
              sinks.push(isIn);
            }
            P.push({ kind: 'arith', part: c.type, attrs, inputs: n, nets, widths, sinks });
            // What Logisim 2.7.1 cannot reproduce (Logisim-evolution reads all of it)
            const name = LOGISIM_ARITH_NAME[c.type];
            if (EVO_ONLY_ARITH.has(c.type)) warnings.push(`${label}: ${name} yalnız Logisim-evolution'da var; Logisim 2.7.1 bu parçayı tanımaz.`);
            else if ((c.type === 'multiplier' || c.type === 'divider') && mode !== 'unsigned' && !(c.type === 'multiplier' && width === 32 && mode === 'signed'))
              warnings.push(`${label}: ${name} modu (${mode === 'signed' ? 'işaretli' : 'işaretli × işaretsiz'}) yalnız Logisim-evolution'da var; Logisim 2.7.1 işaretsiz hesaplar.`);
            if (c.type === 'multiplier' && width === 32 && mode === 'unsigned')
              warnings.push(`${label}: Logisim 2.7.1 32 bitlik çarpıcıyı işaretli hesaplar; işaretsiz sonuç Logisim-evolution'da tutar.`);
            if (c.type === 'divider' && width === 32 && mode === 'unsigned')
              warnings.push(`${label}: Logisim 2.7.1'in 32 bitlik bölücüsü, üst girişin en yüksek biti 1 iken farklı sonuç verir; Logisim-evolution'da tutar.`);
            break;
          }
          warnings.push(`${label}: '${c.type}' Logisim'e aktarılamadı.`);
      }
      if (openInputs)
        warnings.push(`${label}: boştaki giriş(ler)i Logisim'e x (sürücüsüz OPEN tüneli) olarak aktarıldı; kapılarla kurulan karşılığı bazı çıkışlarda simülatörden farklı sonuç verebilir.`);
      if (P.length) blocks.push({ prims: P });
    }

    const constPrims: Prim[] = [];
    if (usesC0) constPrims.push({ kind: 'const', value: 0, out: C0 });
    if (usesC1) constPrims.push({ kind: 'const', value: 1, out: C1 });
    if (constPrims.length) blocks.unshift({ prims: constPrims });

    // --- readable tunnel names: pins keep their label, the rest are numbered ------------------
    const netName = new Map<string, string>();
    const used = new Set<string>();
    const claim = (base: string) => {
      let n = base.replace(/\s+/g, '_') || 'n';
      for (let i = 2; used.has(n); i++) n = `${base}_${i}`;
      used.add(n);
      return n;
    };
    for (const p of [...fixed.map((f) => f.prim), ...blocks.flatMap((b) => b.prims)]) {
      if (p.kind === 'inpin' || p.kind === 'clock') netName.set(find(p.out), netName.get(find(p.out)) || claim(p.label));
    }
    let counter = 0;
    const openRoots = new Set(openNets.map(find));
    const nameOf = (net: string) => {
      const r = find(net);
      if (!netName.has(r)) netName.set(r, claim(r === find(C0) ? 'GND' : r === find(C1) ? 'VCC' : openRoots.has(r) ? 'OPEN' : `n${counter++}`));
      return netName.get(r)!;
    };

    // --- layout -----------------------------------------------------------------------------
    const xml: string[] = [];
    // Tunnels are written last: one whose width follows its net (probe, pull resistor) needs the widths
    // of all the other tunnels of that net
    const tunnels: Array<{ x: number; y: number; net: string; sink: boolean; width?: number }> = [];
    const tunnel = (x: number, y: number, net: string, sink: boolean, width?: number) => {
      if (net !== OPEN) tunnels.push({ x, y, net, sink, width });
    };
    const widthAttr = (w?: number) => (w && w > 1 ? `<a name="width" val="${w}"/>` : '');
    // Logisim gate "Output Value" ('out'); the default 0/1 is left out like Logisim does
    const outAttr = (m?: OutMode) => (m && m !== '01' ? `<a name="out" val="${m}"/>` : '');
    const CELL_W = 220;
    const CELL_H = 110;
    const PER_ROW = 8;
    let cell = 0;
    const gateOffsets = (n: number) => {
      // Logisim AbstractGate input spacing for size 50
      const [ss, sd, sl] = n <= 3 ? [-10, 20, 20] : [-5, 10, 10];
      return Array.from({ length: n }, (_, i) => (n % 2 ? ss * (n - 1) + sd * i : ss * n + sd * i + (i >= n / 2 ? sl : 0)));
    };
    const emit = (p: Prim, x: number, y: number) => {
      switch (p.kind) {
        case 'gate': {
          const neg = p.type === 'NAND' || p.type === 'NOR' || p.type === 'XNOR' ? 10 : 0;
          const xorBonus = p.type === 'XOR' || p.type === 'XNOR' ? 10 : 0;
          const dx = 50 + neg + xorBonus;
          const w = p.width ?? 1;
          const negated = p.negated ?? [];
          // A negated input (Logisim 'negateN') sits 10 further out, behind its bubble
          const negAttrs = negated.map((i) => `<a name="negate${i}" val="true"/>`).join('');
          xml.push(
            `    <comp lib="1" loc="(${x},${y})" name="${p.type} Gate">${widthAttr(w)}<a name="inputs" val="${p.ins.length}"/><a name="size" val="50"/>${xorBonus ? `<a name="xor" val="${p.xor === 'one' ? '1' : 'odd'}"/>` : ''}${outAttr(p.mode)}${negAttrs}</comp>`
          );
          gateOffsets(p.ins.length).forEach((dy, i) => tunnel(x - dx - (negated.includes(i) ? 10 : 0), y + dy, p.ins[i], true, w));
          tunnel(x, y, p.out, false, w);
          break;
        }
        case 'not':
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="NOT Gate">${widthAttr(p.width)}${outAttr(p.mode)}</comp>`);
          tunnel(x - 30, y, p.in, true, p.width ?? 1);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'buf':
          xml.push(`    <comp lib="1" loc="(${x},${y})" name="Buffer">${widthAttr(p.width)}${outAttr(p.mode)}</comp>`);
          tunnel(x - 20, y, p.in, true, p.width ?? 1);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'tri':
          // Logisim's (wide) controlled inverter is 10 longer than the buffer; the control stays 1 bit
          xml.push(
            p.width && p.width > 1
              ? `    <comp lib="1" loc="(${x},${y})" name="${p.inv ? 'Controlled Inverter' : 'Controlled Buffer'}">${widthAttr(p.width)}</comp>`
              : `    <comp lib="1" loc="(${x},${y})" name="${p.inv ? 'Controlled Inverter' : 'Controlled Buffer'}"/>`
          );
          tunnel(x - (p.inv ? 30 : 20), y, p.in, true, p.width ?? 1);
          tunnel(x - (p.inv ? 20 : 10), y + 10, p.en, true, 1);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'ff': {
          const name = p.type === 'D' ? 'D Flip-Flop' : p.type === 'T' ? 'T Flip-Flop' : 'J-K Flip-Flop';
          // Classic look: Logisim-evolution would otherwise open it with its own pin layout (2.7.1 ignores it)
          xml.push(`    <comp lib="4" loc="(${x},${y})" name="${name}"><a name="appearance" val="classic"/></comp>`);
          if (p.type === 'JK') {
            if (p.a) tunnel(x - 40, y, p.a, true, 1);
            if (p.b) tunnel(x - 40, y + 20, p.b, true, 1);
            if (p.clk) tunnel(x - 40, y + 10, p.clk, true, 1);
          } else {
            if (p.a) tunnel(x - 40, y + 20, p.a, true, 1);
            if (p.clk) tunnel(x - 40, y, p.clk, true, 1);
          }
          if (p.reset) tunnel(x - 10, y + 30, p.reset, true, 1);
          if (p.preset) tunnel(x - 30, y + 30, p.preset, true, 1);
          if (p.q) tunnel(x, y, p.q, false, 1);
          if (p.qn) tunnel(x, y + 20, p.qn, false, 1);
          break;
        }
        case 'const':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Constant">${widthAttr(p.width)}<a name="value" val="0x${p.value.toString(16)}"/></comp>`);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'inpin':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Pin">${widthAttr(p.width)}<a name="tristate" val="${!!p.tristate}"/><a name="label" val="${xmlEsc(p.label)}"/></comp>`);
          tunnel(x, y, p.out, false, p.width ?? 1);
          break;
        case 'clock':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Clock"><a name="label" val="${xmlEsc(p.label)}"/></comp>`);
          tunnel(x, y, p.out, false, 1);
          break;
        case 'outpin': {
          // The width is filled in with the tunnels (a probe's follows its net)
          const at = xml.length;
          xml.push('');
          tunnel(x, y, p.in, true, p.width);
          const t = tunnels[tunnels.length - 1];
          pendingPins.push({ at, x, y, label: p.label, width: p.width, tunnel: p.in !== OPEN ? t : undefined });
          break;
        }
        case 'pull':
          xml.push(`    <comp lib="0" loc="(${x},${y})" name="Pull Resistor"><a name="pull" val="${p.value}"/></comp>`);
          tunnel(x, y, p.at, true);
          break;
        case 'splitter': {
          // Logisim's bitN attribute: end index from 0, 'none' = not mapped (ours: end from 1, 0 = none)
          const fanout = p.ends.length;
          const bits = p.bitEnd.map((e, i) => `<a name="bit${i}" val="${e > 0 ? e - 1 : 'none'}"/>`).join('');
          const appear = p.appear === 'left' ? '' : `<a name="appear" val="${p.appear}"/>`;
          xml.push(
            `    <comp lib="0" loc="(${x},${y})" name="Splitter"><a name="fanout" val="${fanout}"/><a name="incoming" val="${p.bitEnd.length}"/>${appear}${bits}</comp>`
          );
          tunnel(x, y, p.combined, false, p.bitEnd.length);
          logisimSplitterEnds('east', p.appear, fanout).forEach((o, i) => {
            if (p.endWidth[i] > 0) tunnel(x + o.x, y + o.y, p.ends[i], true, p.endWidth[i]);
          });
          break;
        }
        case 'extender':
          xml.push(
            `    <comp lib="0" loc="(${x},${y})" name="Bit Extender"><a name="in_width" val="${p.inW}"/><a name="out_width" val="${p.outW}"/><a name="type" val="${p.type}"/></comp>`
          );
          tunnel(x - 40, y, p.in, true, p.inW);
          if (p.ext !== null) tunnel(x - 20, y - 20, p.ext, true, 1);
          tunnel(x, y, p.out, false, p.outW);
          break;
        case 'selector':
          xml.push(`    <comp lib="2" loc="(${x},${y})" name="BitSelector">${widthAttr(p.dataW)}<a name="group" val="${p.groupW}"/></comp>`);
          tunnel(x - 30, y, p.data, true, p.dataW);
          tunnel(x - 10, y + 10, p.sel, true, bitSelectorSelectWidth(p.dataW, p.groupW));
          tunnel(x, y, p.out, false, p.groupW);
          break;
        case 'plexer': {
          // Every attribute is written out: the defaults differ between Logisim versions
          const name = { multiplexer: 'Multiplexer', demultiplexer: 'Demultiplexer', decoder: 'Decoder', priorityEncoder: 'Priority Encoder' }[p.part];
          let attrs = `<a name="select" val="${p.select}"/>`;
          if (p.part === 'multiplexer' || p.part === 'demultiplexer') attrs += widthAttr(p.width);
          if (p.part === 'demultiplexer' || p.part === 'decoder') attrs += `<a name="tristate" val="${p.tristate}"/>`;
          attrs += `<a name="disabled" val="${p.disabled}"/>`;
          if (p.part !== 'priorityEncoder') attrs += `<a name="enable" val="${p.enable}"/>`;
          xml.push(`    <comp lib="2" loc="(${x},${y})" name="${name}">${attrs}</comp>`);
          logisimPlexerPorts(p.part, 'east', 'bl', p.select, p.enable).forEach((o, k) => tunnel(x + o.x, y + o.y, p.nets[k], p.sinks[k], p.widths[k]));
          break;
        }
        case 'arith':
          xml.push(`    <comp lib="3" loc="(${x},${y})" name="${LOGISIM_ARITH_NAME[p.part]}">${p.attrs}</comp>`);
          logisimArithPorts(p.part, p.inputs).forEach(({ off }, k) => tunnel(x + off.x, y + off.y, p.nets[k], p.sinks[k], p.widths[k]));
          break;
        case 'mem':
          xml.push(`    <comp lib="4" loc="(${x},${y})" name="${LOGISIM_MEM_NAME[p.part]}">${p.attrs}</comp>`);
          memPorts(p.part, p.length, p.parallel).forEach(({ off }, k) => tunnel(x + off.x, y + off.y, p.nets[k], p.sinks[k], p.widths[k]));
          break;
        case 'ram':
          xml.push(`    <comp lib="${p.lib ?? 4}" loc="(${x},${y})" name="${xmlEsc(p.name ?? LOGISIM_RAM_NAME[p.part] ?? '')}">${p.attrs}</comp>`);
          for (const q of p.ports) tunnel(x + q.off.x, y + q.off.y, q.net, q.sink, q.width);
          break;
        case 'sub':
          xml.push(`    <comp loc="(${x},${y})" name="${xmlEsc(p.circuit)}"/>`);
          p.inOff.forEach((o, i) => tunnel(x + o.x, y + o.y, p.ins[i], true, p.inW[i]));
          p.outOff.forEach((o, i) => tunnel(x + o.x, y + o.y, p.outs[i], false, p.outW[i]));
          break;
      }
    };
    const pendingPins: Array<{ at: number; x: number; y: number; label: string; width?: number; tunnel?: (typeof tunnels)[number] }> = [];

    for (const f of fixed) emit(f.prim, f.x, f.y);
    // Rows a primitive needs: wide gates and tall subcircuit boxes take more than one
    const rowsOf = (p: Prim) => {
      if (p.kind === 'gate') return 1 + (p.ins.length > 8 ? Math.ceil((p.ins.length - 8) / 10) : 0);
      if (p.kind === 'sub') {
        const ys = [...p.inOff, ...p.outOff].map((o) => o.y);
        return ys.length ? Math.ceil((Math.max(...ys) - Math.min(...ys, 0) + 40) / CELL_H) : 1;
      }
      if (p.kind === 'splitter') return Math.ceil((10 * p.ends.length + 40) / CELL_H);
      if (p.kind === 'plexer') {
        const ys = logisimPlexerPorts(p.part, 'east', 'bl', p.select, p.enable).map((o) => o.y);
        return Math.ceil((Math.max(...ys, 0) - Math.min(...ys, 0) + 40) / CELL_H);
      }
      if (p.kind === 'arith') {
        const ys = logisimArithPorts(p.part, p.inputs).map((o) => o.off.y);
        return Math.ceil((Math.max(...ys, 0) - Math.min(...ys, 0) + 40) / CELL_H);
      }
      if (p.kind === 'ram') {
        const ys = p.ports.map((q) => q.off.y);
        return Math.ceil((Math.max(...ys, 0) - Math.min(...ys, 0) + 40) / CELL_H);
      }
      return 1;
    };
    // A RAM / ROM / random generator: its rightmost point goes on the x of its last cell, as many cells as its
    // width needs (an ordinary part reaches up to 150 left of its cell's x)
    const ramSpan = (p: Prim) => {
      if (p.kind !== 'ram') return { cols: 1, shift: 0 };
      const xs = p.ports.map((q) => q.off.x);
      const right = Math.max(...xs, 0);
      const span = right - Math.min(...xs, 0);
      const cols = 1 + Math.ceil(Math.max(0, span - 150) / CELL_W);
      return { cols, shift: (cols - 1) * CELL_W - right };
    };
    // A shift register reaches right of its loc: it starts SHIFT_LEFT before its cell and takes as many cells
    // as its length needs, so no tunnel lands on another part's pin
    const SHIFT_LEFT = 150;
    const colsOf = (p: Prim) => {
      if (p.kind === 'ram') return ramSpan(p).cols;
      if (p.kind !== 'mem' || p.part !== 'shiftRegister') return 1;
      const w = Math.max(...memPorts(p.part, p.length, p.parallel).map((o) => o.off.x));
      return Math.max(1, Math.ceil((w - 50 + 1) / CELL_W));
    };
    for (const b of blocks) {
      // each block starts on a fresh row when it would not fit, so its parts stay together
      if (cell % PER_ROW !== 0 && (cell % PER_ROW) + b.prims.length > PER_ROW && b.prims.length <= PER_ROW) cell += PER_ROW - (cell % PER_ROW);
      for (const p of b.prims) {
        const extraRows = rowsOf(p) - 1;
        // A primitive reaching above its loc (gate inputs, splitter ends, subcircuit ports) is moved down
        const up =
          p.kind === 'sub'
            ? -Math.min(0, ...p.inOff.map((o) => o.y), ...p.outOff.map((o) => o.y))
            : p.kind === 'splitter'
              ? -Math.min(0, ...logisimSplitterEnds('east', p.appear, p.ends.length).map((o) => o.y))
              : p.kind === 'plexer'
                ? -Math.min(0, ...logisimPlexerPorts(p.part, 'east', 'bl', p.select, p.enable).map((o) => o.y)) + 10
                : p.kind === 'arith'
                  ? -Math.min(0, ...logisimArithPorts(p.part, p.inputs).map((o) => o.off.y)) + 10
                  : p.kind === 'mem'
                    ? -Math.min(0, ...memPorts(p.part, p.length, p.parallel).map((o) => o.off.y)) + 10
                    : p.kind === 'ram'
                      ? -Math.min(0, ...p.ports.map((q) => q.off.y)) + 10
                      : extraRows * 50;
        const cols = colsOf(p);
        if (cols > 1 && (cell % PER_ROW) + cols > PER_ROW) cell += PER_ROW - (cell % PER_ROW);
        const x = 200 + (cell % PER_ROW) * CELL_W - (p.kind === 'mem' && p.part === 'shiftRegister' ? SHIFT_LEFT : 0) + ramSpan(p).shift;
        const y = 120 + Math.floor(cell / PER_ROW) * CELL_H + Math.ceil(up / 10) * 10;
        cell += cols + extraRows * PER_ROW;
        emit(p, x, y);
      }
    }

    // Net widths from the tunnels of a fixed width; the others follow
    const netWidth = new Map<string, number>();
    for (const t of tunnels) if (t.width !== undefined && !netWidth.has(find(t.net))) netWidth.set(find(t.net), t.width);
    for (const t of tunnels) {
      const w = t.width ?? netWidth.get(find(t.net)) ?? 1;
      xml.push(
        `    <comp lib="0" loc="(${t.x},${t.y})" name="Tunnel"><a name="facing" val="${t.sink ? 'east' : 'west'}"/>${widthAttr(w)}<a name="label" val="${xmlEsc(nameOf(t.net))}"/></comp>`
      );
    }
    for (const p of pendingPins) {
      const w = p.width ?? (p.tunnel ? (netWidth.get(find(p.tunnel.net)) ?? 1) : 1);
      xml[p.at] =
        `    <comp lib="0" loc="(${p.x},${p.y})" name="Pin"><a name="facing" val="west"/><a name="output" val="true"/>${widthAttr(w)}<a name="label" val="${xmlEsc(p.label)}"/></comp>`;
    }
    return xml.join('\n');
  };

  const top = buildCircuit(components, wires, null, 0);
  const circuit = xmlEsc(topName);
  if (usesTtl)
    warnings.unshift(
      "TTL çipleri Logisim-evolution'ın TTL kütüphanesiyle yazıldı; Logisim 2.7.1'de bu kütüphane yok, dosyayı yalnız Logisim-evolution açar."
    );
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<project source="2.7.1" version="1.0">
  This file was exported by LogicDesign Studio.
  <lib desc="#Wiring" name="0"/>
  <lib desc="#Gates" name="1"/>
  <lib desc="#Plexers" name="2"/>
  <lib desc="#Arithmetic" name="3"/>
  <lib desc="#Memory" name="4"/>
  <lib desc="#I/O" name="5"/>${usesTtl ? `\n  <lib desc="#TTL" name="${TTL_LIB}"/>` : ''}
  <main name="${circuit}"/>
  <circuit name="${circuit}">
${top}
  </circuit>
${circuitXml.join('\n')}
</project>
`;
  return { xml: doc, warnings, inputs, outputs };
}
