import type { CircuitComponentInstance, CircuitPin, CircuitWire, CustomSubcircuit } from '../types/circuit';
import { numberToBits } from '../types/logic';
import { getLogicalConnections } from './wiringEngine';
import {
  ALU_OP_BITS,
  ARITH_PINS,
  GATE_WIDTH_TYPES,
  HEX_7SEG_MAP,
  OUTPUT_MODE_TYPES,
  PLEXER_TYPES,
  bitAdderOutBits,
  bitFinderOutBits,
  getArithConfig,
  getArithMode,
  getGateWidth,
  getPlexerConfig,
  FLIP_FLOP_TYPES,
  flipFlopDataKeys,
  getCounterMax,
  getMemConfig,
  getSplitterConfig,
  getTrigger,
  memPinKeys,
  shifterDistBits,
  splitterThreads,
} from './circuitEngine';
import { getSubcircuitDefinition, subcircuitPortWidth } from './subcircuitManager';

/*
 * Verilog / VHDL export.
 *
 * Both languages share one netlist pass (nets, drivers, floating inputs, names) and one
 * per-component description whose behaviour mirrors simulateCircuit():
 *  - multi-input gates ignore unconnected inputs, a gate with no connected input outputs 0
 *  - an unconnected decoder EN / register / RAM WE counts as enabled; carry / borrow-in, clock, reset,
 *    S/R and priority encoder inputs read 0, as in the simulator
 *  - any other floating input is x (or E) in the simulator; here it is tied to 0 so the code stays
 *    synthesizable, and a comment under the part lists those inputs. A register / RAM whose D is
 *    partly open never loads (the simulator skips undefined data), so its write is turned off; a
 *    RAM / ROM with an open address bit keeps its power-up output 0 and never writes, as there.
 *  - several drivers on one net share a signal (tri-state buses resolve through 'z')
 *  - registers start at the simulator's reset state (Q=0, RAM = 0..15, ROM = its contents)
 *  - flip-flops, register, counter, shift register follow stepMem: asynchronous clear / preset, rising /
 *    falling edge (posedge / negedge, rising_edge / falling_edge) or a level trigger as a latch; open
 *    enable / count / shift / up-down count as on, open load / clear / preset as off
 *  - custom ICs (subcircuits) are emitted as their own module / entity
 *  - multi-bit nets become vectors; like the simulator (and Logisim-evolution's netlist) every bit of
 *    a net is traced through splitters to its driver, so a splitter emits no code and needs no inout.
 *    A net whose pins have different widths reads x in the simulator and 0 here (with a warning)
 */

type Lang = 'verilog' | 'vhdl';

const RESERVED = new Set(
  (
    // Verilog
    'always and assign begin buf case casex casez default defparam disable edge else end endcase endfunction endmodule ' +
    'endtask for force forever fork function if initial inout input integer join module nand negedge nor not or output ' +
    'parameter posedge real reg repeat signed supply0 supply1 task time tri wait while wire xnor xor logic bit ' +
    // VHDL
    'abs access after alias all architecture array assert attribute block body buffer bus component configuration ' +
    'constant disconnect downto elsif entity exit file generate generic group guarded impure in inertial is label ' +
    'library linkage literal loop map mod new next null of on open others out package port postponed procedure process ' +
    'pure range record register reject rem report return rol ror select severity shared sla sll sra srl subtype then to ' +
    'transport type unaffected units until use variable when with std_logic std_logic_vector unsigned ieee work clk_in'
  ).split(' ')
);

const TR_MAP: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', i̇: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

// Identifier legal in both languages: [a-z][a-z0-9_]*, no "__", no trailing "_", not a keyword
function baseIdentifier(raw: string, fallback: string): string {
  let s = (raw || '')
    .replace(/'/g, '_n')
    .replace(/>=/g, '_ge_')
    .replace(/<=/g, '_le_')
    .replace(/>/g, '_gt_')
    .replace(/</g, '_lt_')
    .replace(/=/g, '_eq_')
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]|i̇/g, (ch) => TR_MAP[ch] || '_')
    .normalize('NFKD')
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `u_${s}`;
  if (s.length > 60) s = s.slice(0, 60).replace(/_$/, '');
  if (RESERVED.has(s)) s = `${s}_s`;
  return s;
}

class NameTable {
  private used = new Set<string>();
  constructor(reserved: string[] = []) {
    reserved.forEach((r) => this.used.add(r));
  }
  reserve(name: string) {
    this.used.add(name);
  }
  make(raw: string, fallback = 'sig'): string {
    const base = baseIdentifier(raw, fallback);
    let name = base;
    for (let i = 2; this.used.has(name); i++) name = `${base}_${i}`;
    this.used.add(name);
    return name;
  }
}

// ---------------------------------------------------------------------------
// Language helpers for 1-bit expressions
// ---------------------------------------------------------------------------
interface LangOps {
  zero: string;
  one: string;
  hiZ: string;
  not: (a: string) => string;
  and: (xs: string[]) => string;
  or: (xs: string[]) => string;
  xor: (xs: string[]) => string;
  mux: (sel: string, whenOne: string, whenZero: string) => string;
  assign: (lhs: string, rhs: string) => string;
  comment: (text: string) => string;
}

const VERILOG: LangOps = {
  zero: "1'b0",
  one: "1'b1",
  hiZ: "1'bz",
  not: (a) => `~${wrap(a)}`,
  and: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' & ')),
  or: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' | ')),
  xor: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' ^ ')),
  mux: (sel, a, b) => `${wrap(sel)} ? ${wrap(a)} : ${wrap(b)}`,
  assign: (l, r) => `  assign ${l} = ${r};`,
  comment: (t) => `  // ${t}`,
};

const VHDL: LangOps = {
  zero: "'0'",
  one: "'1'",
  hiZ: "'Z'",
  not: (a) => `not ${wrap(a)}`,
  and: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' and ')),
  or: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' or ')),
  xor: (xs) => (xs.length === 1 ? xs[0] : xs.map(wrap).join(' xor ')),
  // VHDL-93 has no conditional operator inside expressions, so mux is emitted via helper below
  mux: (sel, a, b) => `__MUX__(${sel}|${a}|${b})`,
  assign: (l, r) => `  ${l} <= ${r};`,
  comment: (t) => `  -- ${t}`,
};

// VHDL condition "x = '1'" / "x = '0'". Comparing two literals ('0' = '1') is ambiguous in VHDL
// (character vs std_logic), so constant inputs (VCC/GND/floating) fold to true/false.
function is1(x: string): string {
  return x === "'1'" ? 'true' : x === "'0'" ? 'false' : `${x} = '1'`;
}
function is0(x: string): string {
  return x === "'0'" ? 'true' : x === "'1'" ? 'false' : `${x} = '0'`;
}

// Parenthesise anything that is not a plain identifier / literal / index
function wrap(e: string): string {
  return /^[A-Za-z0-9_'\\[\]().]+$/.test(e) && !/\s/.test(e) ? e : `(${e})`;
}

// ---------------------------------------------------------------------------
// Netlist
// ---------------------------------------------------------------------------
const INPUT_TYPES = ['switch', 'pushbutton', 'clock', 'vcc', 'gnd', 'constant', 'dipSwitch4', 'asciiKeyboard'];
const OUTPUT_TYPES = ['led', 'probe', 'buzzer', 'sevenSegment', 'hexDisplay', 'ledBar4', 'dotMatrix8x8', 'rgbMatrix16x16'];
const PASSIVE_TYPES = ['tunnel', 'textLabel', 'pullResistor'];
const TRI_TYPES = ['triState', 'controlledInverter'];
// Plexers whose outputs can float: a floating disabled output (with an enable input; the priority
// encoder always has one) or three-state unselected outputs
const plexerFloats = (c: CircuitComponentInstance) =>
  PLEXER_TYPES.has(c.type) &&
  ((c.state.plexDisabled === 'Z' && getPlexerConfig(c).enable) || ((c.type === 'demultiplexer' || c.type === 'decoder') && !!c.state.plexTristate));
// Parts that can leave their output net floating: tri-state parts, open collector / emitter gates, plexers
const canFloat = (c?: CircuitComponentInstance) =>
  !!c &&
  (TRI_TYPES.includes(c.type) || (OUTPUT_MODE_TYPES.includes(c.type) && !!c.state.outputMode && c.state.outputMode !== '01') || plexerFloats(c));

export interface PortDecl {
  name: string;
  dir: 'in' | 'out';
  width: number; // 1 = scalar
  // Canvas part behind a top-level port (used by the FPGA pin constraints)
  source?: { compId: string; type: string; group?: string };
}

interface ModuleSpec {
  name: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  // subcircuit modules: explicit ports bound to internal pins
  subPorts?: CustomSubcircuit['ports'];
  subDef?: CustomSubcircuit;
}

// Parts whose pins take the width of the net they sit on (as in the simulator)
const WIDTH_FOLLOWERS = ['tunnel', 'probe', 'pullResistor'];

// One bit of a reader's value: a constant, bit i of a vector signal, or a 1-bit expression
type Bit = { k: 'lit'; v: 0 | 1 } | { k: 'idx'; sig: string; i: number } | { k: 'sig'; e: string };

interface BuiltModule {
  name: string;
  ports: PortDecl[];
  signals: { name: string; width: number; init?: string }[];
  body: string[];
  extraDecls: string[]; // VHDL types/arrays, Verilog memories
  warnings: string[];
}

function buildModule(
  spec: ModuleSpec,
  lang: Lang,
  subModules: Map<string, { def: CustomSubcircuit; moduleName: string }>,
  moduleNames: NameTable
): BuiltModule {
  const L = lang === 'verilog' ? VERILOG : VHDL;
  const names = new NameTable();
  const ports: PortDecl[] = [];
  const signals: BuiltModule['signals'] = [];
  const body: string[] = [];
  const extraDecls: string[] = [];
  const warnings: string[] = [];

  const subNames = spec.subPorts ? subPortNames(spec.subPorts) : null;
  if (subNames) [...subNames.inputs, ...subNames.outputs].forEach((n) => names.reserve(n));

  const comps = spec.components;
  const compById = new Map(comps.map((c) => [c.id, c]));
  const pinOwner = new Map<string, CircuitComponentInstance>();
  const pinIsOutput = new Map<string, boolean>();
  for (const c of comps) {
    for (const p of c.inputs) {
      pinOwner.set(p.id, c);
      pinIsOutput.set(p.id, false);
    }
    for (const p of c.outputs) {
      pinOwner.set(p.id, c);
      pinIsOutput.set(p.id, true);
    }
  }

  // Nets from the logical connections: driver pin + every other pin of the net
  const conns = getLogicalConnections(comps, spec.wires);
  const netOfPin = new Map<string, string[]>();
  const byDriver = new Map<string, string[]>();
  for (const w of conns) {
    if (!byDriver.has(w.fromPinId)) byDriver.set(w.fromPinId, [w.fromPinId]);
    byDriver.get(w.fromPinId)!.push(w.toPinId);
  }
  for (const pins of byDriver.values()) for (const p of pins) netOfPin.set(p, pins);
  const isConnected = (pinId: string) => (netOfPin.get(pinId)?.length || 0) > 1;

  // Real drivers of a net: output pins of non-passive, non-sink parts (a splitter only joins bits)
  const isDriverPin = (id: string): boolean => {
    const owner = pinOwner.get(id);
    return !!pinIsOutput.get(id) && !!owner && !PASSIVE_TYPES.includes(owner.type) && !OUTPUT_TYPES.includes(owner.type) && owner.type !== 'splitter';
  };
  const netDrivers = (pinId: string): string[] => (netOfPin.get(pinId) || []).filter(isDriverPin);

  // --- multi-bit nets: widths, splitter bit links and bit threads (as simulateCircuitStep) ---------
  const pinById = new Map<string, CircuitPin>();
  for (const c of comps) for (const p of [...c.inputs, ...c.outputs]) pinById.set(p.id, p);
  const netKey = (pinId: string) => netOfPin.get(pinId)?.[0] ?? pinId;
  const keyPins = (key: string) => netOfPin.get(key) ?? [key];
  const widthInfo = new Map<string, { width: number; list: number[] }>();
  // 0 = pins of different widths meet on the net (the simulator reads every bit x)
  const netWidthInfo = (key: string) => {
    let info = widthInfo.get(key);
    if (!info) {
      const ws = new Set<number>();
      for (const id of keyPins(key)) {
        const owner = pinOwner.get(id);
        if (owner && WIDTH_FOLLOWERS.includes(owner.type)) continue;
        const w = pinById.get(id)?.width ?? 1;
        if (w > 0) ws.add(w);
      }
      const list = [...ws].sort((a, b) => a - b);
      info = { width: ws.size > 1 ? 0 : ws.size === 1 ? list[0] : 1, list };
      widthInfo.set(key, info);
    }
    return info;
  };
  const netWidth = (pinId: string) => netWidthInfo(netKey(pinId)).width;
  const bitParent = new Map<string, string>();
  const bitFind = (k: string): string => {
    let r = k;
    while (bitParent.has(r) && bitParent.get(r) !== r) r = bitParent.get(r)!;
    if (r !== k) bitParent.set(k, r);
    return r;
  };
  const linkedKeys = new Set<string>();
  for (const c of comps) {
    if (c.type !== 'splitter' || !c.inputs[0]) continue;
    const { fanout, bitEnd } = getSplitterConfig(c);
    const { thread } = splitterThreads(bitEnd, fanout);
    const a = netKey(c.inputs[0].id);
    bitEnd.forEach((e, i) => {
      const end = e > 0 ? c.outputs[e - 1] : undefined;
      if (!end) return;
      const b = netKey(end.id);
      linkedKeys.add(a);
      linkedKeys.add(b);
      // Links into a net of the wrong width are dropped, as in the simulator
      if (netWidthInfo(a).width <= i || netWidthInfo(b).width <= thread[i]) return;
      const ra = bitFind(`${a}#${i}`);
      const rb = bitFind(`${b}#${thread[i]}`);
      if (ra !== rb) bitParent.set(ra, rb);
    });
  }
  // 1-bit nets no splitter touches keep the scalar path below
  const isScalarNet = (pinId: string) => {
    const k = netKey(pinId);
    return netWidthInfo(k).width === 1 && !linkedKeys.has(k);
  };

  // Expression for every output pin (ports, constants, internal signals)
  const pinExpr = new Map<string, string>();
  const declared = new Set<string>();
  const sigWidth = new Map<string, number>(); // declared signals and ports
  const declare = (name: string, width = 1, init?: string) => {
    if (declared.has(name)) return;
    declared.add(name);
    sigWidth.set(name, width);
    signals.push({ name, width, init });
  };
  const addPort = (p: PortDecl) => {
    ports.push(p);
    sigWidth.set(p.name, p.width);
  };
  const vecIndex = (name: string, i: number) => (lang === 'verilog' ? `${name}[${i}]` : `${name}(${i})`);
  // Constant bits LSB-first as a literal: Verilog 8'ha5, VHDL x"A5" (or "0101" when not whole nibbles)
  const bitLiteral = (bits: (0 | 1)[]): string => {
    const msb = [...bits].reverse().join('');
    if (bits.length === 1) return bits[0] ? L.one : L.zero;
    if (lang === 'verilog') {
      return bits.length % 4 === 0 ? `${bits.length}'h${parseInt(msb, 2).toString(16)}` : `${bits.length}'b${msb}`;
    }
    if (bits.length % 4 !== 0) return `"${msb}"`;
    let hex = '';
    for (let i = 0; i < msb.length; i += 4) hex += parseInt(msb.slice(i, i + 4), 2).toString(16).toUpperCase();
    return `x"${hex}"`;
  };
  // Wide constant outputs: a literal, and its bits for readers that take only some of them
  const constBits = new Map<string, (0 | 1)[]>();
  const setWideConstant = (pinId: string, value: number, width: number) => {
    const bits = numberToBits(value, width).map((b) => (b === 1 ? 1 : 0)) as (0 | 1)[];
    constBits.set(pinId, bits);
    pinExpr.set(pinId, bitLiteral(bits));
  };

  const portBound = new Map<string, string>(); // internal pin id -> port expression (subcircuits)
  const portBoundWidth = new Map<string, number>();
  const subInPorts = (spec.subPorts || []).filter((p) => p.type === 'input');
  const subOutPorts = (spec.subPorts || []).filter((p) => p.type === 'output');

  // --- input ports ---------------------------------------------------------
  if (spec.subPorts) {
    subInPorts.forEach((p, i) => {
      const pn = subNames!.inputs[i];
      const width = spec.subDef ? subcircuitPortWidth(spec.subDef, p) : 1;
      addPort({ name: pn, dir: 'in', width });
      const target = compById.get(p.targetCompId);
      if (target && (target.type === 'switch' || target.type === 'pushbutton')) {
        if (target.outputs[0]) pinExpr.set(target.outputs[0].id, pn);
      } else {
        portBound.set(p.targetPinId, pn);
        portBoundWidth.set(p.targetPinId, width);
        if (pinIsOutput.get(p.targetPinId)) pinExpr.set(p.targetPinId, pn);
      }
    });
  }

  for (const c of comps) {
    if (!INPUT_TYPES.includes(c.type)) continue;
    if (c.type === 'vcc') {
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, L.one);
      continue;
    }
    if (c.type === 'gnd') {
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, L.zero);
      continue;
    }
    const outW = c.outputs[0]?.width ?? 1;
    if (c.type === 'constant') {
      if (outW > 1) setWideConstant(c.outputs[0].id, c.state.constValue ?? 1, outW);
      else if (c.outputs[0]) pinExpr.set(c.outputs[0].id, (c.state.constValue ?? 1) % 2 === 1 ? L.one : L.zero);
      continue;
    }
    if (spec.subPorts && (c.type === 'switch' || c.type === 'pushbutton')) {
      // Inside an IC an unbound switch is a constant at its current position
      if (c.outputs[0] && !pinExpr.has(c.outputs[0].id)) {
        if (outW > 1) setWideConstant(c.outputs[0].id, c.state.inputValue ?? 0, outW);
        else pinExpr.set(c.outputs[0].id, c.state.on ? L.one : L.zero);
      }
      continue;
    }
    const label = c.label || c.type;
    if (c.type === 'clock') {
      const pn = names.make(/clk|saat|clock/i.test(label) ? label : `clk_${label}`, 'clk');
      addPort({ name: pn, dir: 'in', width: 1, source: { compId: c.id, type: c.type } });
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, pn);
    } else if (c.type === 'dipSwitch4') {
      const pn = names.make(`in_${label}`, 'in_dip');
      addPort({ name: pn, dir: 'in', width: 4, source: { compId: c.id, type: c.type } });
      c.outputs.forEach((p, i) => pinExpr.set(p.id, vecIndex(pn, i)));
    } else if (c.type === 'asciiKeyboard') {
      const pd = names.make(`kbd_${label}_data`, 'kbd_data');
      const ps = names.make(`kbd_${label}_strobe`, 'kbd_strobe');
      addPort({ name: pd, dir: 'in', width: 7, source: { compId: c.id, type: c.type, group: 'data' } });
      addPort({ name: ps, dir: 'in', width: 1, source: { compId: c.id, type: c.type, group: 'strobe' } });
      c.outputs.slice(0, 7).forEach((p, i) => pinExpr.set(p.id, vecIndex(pd, i)));
      if (c.outputs[7]) pinExpr.set(c.outputs[7].id, ps);
    } else {
      // switch (also a multi-bit one), push button
      const pn = names.make(`in_${label}`, 'in_sig');
      addPort({ name: pn, dir: 'in', width: c.type === 'switch' ? outW : 1, source: { compId: c.id, type: c.type } });
      if (c.outputs[0]) pinExpr.set(c.outputs[0].id, pn);
    }
  }

  // --- internal signals for every block output pin ------------------------
  const internalComps = comps.filter(
    (c) => !INPUT_TYPES.includes(c.type) && !OUTPUT_TYPES.includes(c.type) && !PASSIVE_TYPES.includes(c.type) && c.type !== 'splitter'
  );
  const compNames = new Map<string, string>();
  // Short block prefix so pin suffixes (_q0, _cout ...) survive in the signal names
  for (const c of internalComps) compNames.set(c.id, baseIdentifier(c.label || c.type, c.type.toLowerCase()).slice(0, 24).replace(/_$/, ''));

  // A bus bit (splitter thread) driven only by 1-bit tri-state outputs that sit on different wires: like
  // a 1-bit tri-state net, they all drive one shared signal (otherwise only the first would be read)
  const threadOfTriDriver = new Map<string, string>();
  {
    const byRoot = new Map<string, Set<string>>();
    for (const id of pinById.keys()) {
      if (!isDriverPin(id) && !portBound.has(id)) continue;
      const key = netKey(id);
      if (!linkedKeys.has(key)) continue;
      const w = netWidthInfo(key).width;
      for (let b = 0; b < w; b++) {
        const root = bitFind(`${key}#${b}`);
        if (!byRoot.has(root)) byRoot.set(root, new Set());
        byRoot.get(root)!.add(id);
      }
    }
    for (const [root, ids] of byRoot) {
      const list = [...ids];
      const nets = new Set(list.map(netKey));
      if (nets.size < 2) continue;
      const allTri = list.every((id) => {
        const owner = pinOwner.get(id);
        return !portBound.has(id) && (pinById.get(id)?.width ?? 1) === 1 && canFloat(owner) && internalComps.includes(owner!);
      });
      if (allTri) for (const id of list) threadOfTriDriver.set(id, root);
    }
  }
  const threadSignal = new Map<string, string>();

  // Nets with several drivers share one signal (tri-state bus)
  const busSignal = new Map<string, string>();
  for (const c of internalComps) {
    for (const p of c.outputs) {
      if (pinExpr.has(p.id)) continue;
      const root = threadOfTriDriver.get(p.id);
      if (root !== undefined) {
        if (!threadSignal.has(root)) {
          const bn = names.make(`bus_${compNames.get(c.id)}_${p.name}`, 'bus');
          threadSignal.set(root, bn);
          declare(bn, 1);
        }
        pinExpr.set(p.id, threadSignal.get(root)!);
        continue;
      }
      const drivers = netDrivers(p.id);
      if (drivers.length > 1) {
        const key = drivers.slice().sort().join('|');
        if (!busSignal.has(key)) {
          const bn = names.make(`bus_${compNames.get(c.id)}_${p.name}`, 'bus');
          busSignal.set(key, bn);
          declare(bn, p.width ?? 1);
          const allTri = drivers.every((d) => canFloat(pinOwner.get(d)));
          if (!allTri) warnings.push(`${bn}: birden fazla sürücü var (çakışma); simülatörde bu hat E (çakışma) olur.`);
        }
        pinExpr.set(p.id, busSignal.get(key)!);
      } else {
        const sn = names.make(`${compNames.get(c.id)}_${p.name}`, 's');
        declare(sn, p.width ?? 1);
        pinExpr.set(p.id, sn);
      }
    }
  }

  // An input pin no part drives (and no IC port feeds)
  // Pull resistors on a net: the level the simulator pulls it to when nothing drives it
  // (differing pulls or an X pull give E there)
  const pullOf = (pinId: string): 0 | 1 | 'E' | undefined => {
    const levels = new Set<0 | 1 | 'E'>();
    for (const id of netOfPin.get(pinId) || []) {
      const owner = pinOwner.get(id);
      if (owner?.type === 'pullResistor') levels.add(owner.state.pullValue === 1 ? 1 : owner.state.pullValue === 'X' ? 'E' : 0);
    }
    return levels.size === 0 ? undefined : levels.size === 1 ? levels.values().next().value : 'E';
  };
  const pulledLevel = (pinId: string) => {
    const p = pullOf(pinId);
    return p === 0 ? L.zero : p === 1 ? L.one : undefined;
  };
  const isFloating = (pinId: string): boolean => {
    if (!isScalarNet(pinId)) {
      const r = readBits(pinId, pinById.get(pinId)?.width ?? 1);
      return r.floating || r.mismatch;
    }
    return (
      !portBound.has(pinId) &&
      netDrivers(pinId).length === 0 &&
      !(netOfPin.get(pinId) || []).some((id) => portBound.has(id)) &&
      pulledLevel(pinId) === undefined
    );
  };

  // A tri-state signal with a pull resistor: Verilog pullup / pulldown primitive (Yosys does not read
  // tri0 / tri1 nets), VHDL weak 'L' / 'H' driver read
  // through to_X01 (a plain "= '1'" test would miss 'H')
  const readAs = new Map<string, string>();
  const pulledSigs = new Set<string>();
  const emitPull = (sig: string, level: 0 | 1 | 'E') => {
    if (pulledSigs.has(sig)) return;
    pulledSigs.add(sig);
    if (level === 'E') {
      body.push(L.comment(`${sig}: çakışan pull dirençleri, simülatörde sürülmeyince E; burada pull yok`));
      return;
    }
    body.push(L.comment(`${sig}: pull direnci, sürülmeyince ${level} okunur (FPGA içinde pull yoktur, sentez aracı desteklemeyebilir)`));
    if (lang === 'verilog') body.push(`  ${level === 1 ? 'pullup' : 'pulldown'} ${names.make(`pull_${sig}`, 'pull')} (${sig});`);
    else {
      body.push(`  ${sig} <= ${level === 1 ? "'H'" : "'L'"};`);
      readAs.set(sig, `to_X01(${sig})`);
    }
  };
  for (const c of comps) {
    if (c.type !== 'pullResistor' || !c.inputs[0] || !isScalarNet(c.inputs[0].id)) continue;
    const drivers = netDrivers(c.inputs[0].id);
    const level = pullOf(c.inputs[0].id);
    if (level === undefined || drivers.length === 0 || !drivers.every((d) => canFloat(pinOwner.get(d)))) continue;
    const sig = pinExpr.get(drivers[0]);
    if (sig) emitPull(sig, level);
  }
  const floatingParts: string[] = [];

  // --- bit threads: the source of every bit of every multi-bit / splitter-linked net ---------------
  // A driver pin's bit b: constant bit, bit of its vector signal, or its 1-bit signal
  const driverBit = (pinId: string, b: number): Bit | undefined => {
    const cb = constBits.get(pinId);
    if (cb) return { k: 'lit', v: cb[b] ?? 0 };
    const bound = portBound.get(pinId);
    const e = bound ?? pinExpr.get(pinId);
    if (!e) return undefined;
    const w = bound !== undefined ? portBoundWidth.get(pinId) ?? 1 : pinById.get(pinId)?.width ?? 1;
    if (w > 1) return { k: 'idx', sig: e, i: b };
    if (e === L.one || e === L.zero) return { k: 'lit', v: e === L.one ? 1 : 0 };
    return { k: 'sig', e };
  };
  const bitKey = (bit: Bit) => (bit.k === 'lit' ? `${bit.v}` : bit.k === 'idx' ? `${bit.sig}#${bit.i}` : bit.e);
  type ThreadSource = { bit?: Bit; floating: boolean };
  const threadSource = new Map<string, ThreadSource>();
  {
    const members = new Map<string, [string, number][]>();
    const seenKeys = new Set<string>();
    for (const id of pinById.keys()) {
      const key = netKey(id);
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      const w = netWidthInfo(key).width;
      if (w === 0 || (w === 1 && !linkedKeys.has(key))) continue;
      for (let b = 0; b < w; b++) {
        const root = bitFind(`${key}#${b}`);
        if (!members.has(root)) members.set(root, []);
        members.get(root)!.push([key, b]);
      }
    }
    for (const [root, mem] of members) {
      const drivers: { id: string; b: number }[] = [];
      const pulls = new Set<0 | 1 | 'E'>();
      for (const [key, b] of mem) {
        for (const id of keyPins(key)) {
          if (isDriverPin(id) || portBound.has(id)) drivers.push({ id, b });
          const owner = pinOwner.get(id);
          if (owner?.type === 'pullResistor') pulls.add(owner.state.pullValue === 1 ? 1 : owner.state.pullValue === 'X' ? 'E' : 0);
        }
      }
      const pull = pulls.size === 0 ? undefined : pulls.size === 1 ? pulls.values().next().value! : 'E';
      const bits = drivers.map((d) => driverBit(d.id, d.b)).filter((x): x is Bit => !!x);
      if (bits.length === 0) {
        threadSource.set(root, pull === 0 || pull === 1 ? { bit: { k: 'lit', v: pull }, floating: false } : { floating: true });
        continue;
      }
      const distinct = [...new Map(bits.map((x) => [bitKey(x), x])).values()];
      if (distinct.length > 1) {
        const shown = distinct.map((x) => (x.k === 'lit' ? `${x.v}` : x.k === 'idx' ? vecIndex(x.sig, x.i) : x.e));
        warnings.push(`bir veri yolu biti birden fazla kaynaktan sürülüyor (${shown.join(', ')}): simülatörde E (çakışma), burada ilki okundu.`);
      }
      const first = bits[0];
      // A tri-state bit with a pull resistor, as on a 1-bit net
      if (pull !== undefined && drivers.every((d) => canFloat(pinOwner.get(d.id))) && first.k === 'sig') emitPull(first.e, pull);
      threadSource.set(root, { bit: first.k === 'sig' && readAs.has(first.e) ? { k: 'sig', e: readAs.get(first.e)! } : first, floating: false });
    }
  }
  const mismatchNoted = new Set<string>();
  // Bits (LSB first) a w-bit reader pin sees; floating and mismatched bits read 0
  function readBits(pinId: string, w: number): { bits: Bit[]; floating: boolean; mismatch: boolean } {
    const key = netKey(pinId);
    const info = netWidthInfo(key);
    const zeros = (): Bit[] => Array.from({ length: w }, () => ({ k: 'lit', v: 0 }) as Bit);
    if (info.width === 0) {
      if (!mismatchNoted.has(key)) {
        mismatchNoted.add(key);
        const owner = pinOwner.get(pinId);
        warnings.push(
          `${owner?.label || owner?.type || pinId}.${pinById.get(pinId)?.name ?? ''}: genişlikleri uyumsuz pinler (${info.list.join(' / ')} bit) aynı hatta; simülatörde x okunur, burada 0 bağlandı.`
        );
      }
      return { bits: zeros(), floating: false, mismatch: true };
    }
    if (isScalarNet(pinId)) {
      const e = inputExpr(pinId);
      const bit: Bit = e === L.one || e === L.zero ? { k: 'lit', v: e === L.one ? 1 : 0 } : { k: 'sig', e };
      return { bits: [bit], floating: isFloating(pinId), mismatch: false };
    }
    let floating = false;
    const bits: Bit[] = [];
    for (let b = 0; b < w; b++) {
      const src = b < info.width ? threadSource.get(bitFind(`${key}#${b}`)) : undefined;
      if (!src || !src.bit) {
        floating = true;
        bits.push({ k: 'lit', v: 0 });
      } else bits.push(src.bit);
    }
    return { bits, floating, mismatch: false };
  }
  const bitExpr = (bit: Bit): string => (bit.k === 'lit' ? (bit.v ? L.one : L.zero) : bit.k === 'idx' ? vecIndex(bit.sig, bit.i) : bit.e);
  // LSB-first bits as one expression: consecutive bits of a signal become a slice, constants a literal
  const compose = (bits: Bit[]): string => {
    if (bits.length === 1) return bitExpr(bits[0]);
    const parts: string[] = [];
    for (let hi = bits.length - 1; hi >= 0; ) {
      const top = bits[hi];
      let lo = hi;
      if (top.k === 'lit') {
        while (lo > 0 && bits[lo - 1].k === 'lit') lo--;
        const run = bits.slice(lo, hi + 1).map((x) => (x as { v: 0 | 1 }).v);
        parts.push(bitLiteral(run));
      } else if (top.k === 'idx') {
        while (lo > 0) {
          const nx = bits[lo - 1];
          if (nx.k !== 'idx' || nx.sig !== top.sig || nx.i !== top.i - (hi - lo + 1)) break;
          lo--;
        }
        const iHi = top.i;
        const iLo = top.i - (hi - lo);
        parts.push(
          iHi === iLo
            ? vecIndex(top.sig, iHi)
            : iLo === 0 && iHi === (sigWidth.get(top.sig) ?? -1) - 1
              ? top.sig
              : lang === 'verilog'
                ? `${top.sig}[${iHi}:${iLo}]`
                : `${top.sig}(${iHi} downto ${iLo})`
        );
      } else parts.push(top.e);
      hi = lo - 1;
    }
    if (parts.length === 1) return parts[0];
    return lang === 'verilog' ? `{${parts.join(', ')}}` : parts.join(' & ');
  };
  // VHDL needs a plain name (or slice) in port maps and selectors: give anything else its own signal
  const asName = (expr: string, width: number, hint: string): string => {
    if (/^[a-z][a-z0-9_]*(\(\d+( downto \d+)?\)|\[\d+(:\d+)?\])?$/.test(expr)) return expr;
    const n = names.make(hint, 'v');
    declare(n, width);
    emit(n, expr);
    return n;
  };

  // Value seen by an input pin
  function inputExpr(pinId: string | undefined, floating: string = L.zero): string {
    if (!pinId) return floating;
    if (!isScalarNet(pinId)) {
      // A 1-bit reader on a splitter end or on a net of the wrong width
      const r = readBits(pinId, 1);
      return r.floating || r.mismatch ? floating : bitExpr(r.bits[0]);
    }
    if (portBound.has(pinId)) return portBound.get(pinId)!;
    const drivers = netDrivers(pinId);
    if (drivers.length === 0) {
      // A net driven only by an IC input port bound to another of its pins
      const bound = (netOfPin.get(pinId) || []).find((id) => portBound.has(id));
      return bound ? portBound.get(bound)! : pulledLevel(pinId) ?? floating;
    }
    const sig = pinExpr.get(drivers[0]);
    return sig ? readAs.get(sig) ?? sig : floating;
  }

  const emit = (lhs: string, rhs: string) => {
    if (lang === 'vhdl' && rhs.includes('__MUX__')) {
      body.push(`  ${lhs} <= ${vhdlMux(rhs)};`);
    } else {
      body.push(L.assign(lhs, rhs));
    }
  };

  // --- component behaviour ------------------------------------------------
  for (const c of internalComps) {
    const nm = compNames.get(c.id)!;
    const out = c.outputs.map((p) => pinExpr.get(p.id)!);
    // Inputs read without a fixed level are x in the simulator when open: note them under the part
    const openIns = new Set<string>();
    const inp = (i: number, floating?: string) => {
      const pin = c.inputs[i];
      if (pin && floating === undefined && isFloating(pin.id)) openIns.add(pin.name);
      return inputExpr(pin?.id, floating);
    };
    // Gate output value: open collector drives only 0 (a 1 floats), open emitter only 1
    // (VHDL tests the select as "sel = '1'", so a compound one needs its own parentheses)
    // Gates wider than 1 bit work on vectors: the operators are bitwise in both languages
    const gateW = GATE_WIDTH_TYPES.includes(c.type) ? getGateWidth(c) : 1;
    const emitGate = (f: string) => {
      if (gateW > 1 && c.state.outputMode && c.state.outputMode !== '01') {
        // Open collector / emitter on a vector: every bit floats on its own
        const v = asName(f, gateW, `${nm}_f`);
        for (let b = 0; b < gateW; b++) {
          const sel = vecIndex(v, b);
          emit(vecIndex(out[0], b), c.state.outputMode === '0Z' ? L.mux(sel, L.hiZ, L.zero) : L.mux(sel, L.one, L.hiZ));
        }
        return;
      }
      const sel = lang === 'vhdl' ? wrap(f) : f;
      emit(out[0], c.state.outputMode === '0Z' ? L.mux(sel, L.hiZ, L.zero) : c.state.outputMode === 'Z1' ? L.mux(sel, L.one, L.hiZ) : f);
    };
    // All-0 / all-Z value of the gate's width
    const zeroW = gateW > 1 ? bitLiteral(new Array<0 | 1>(gateW).fill(0)) : L.zero;
    const hiZW = gateW > 1 ? (lang === 'verilog' ? `${gateW}'bz` : "(others => 'Z')") : L.hiZ;
    // All bits of input pin i (multi-bit readers); open or mismatched bits are 0 and noted like inp()
    const wideBits = (i: number): Bit[] => {
      const pin = c.inputs[i];
      if (!pin) return [{ k: 'lit', v: 0 }];
      const r = readBits(pin.id, pin.width ?? 1);
      if (r.floating || r.mismatch) openIns.add(pin.name);
      return r.bits;
    };
    const connectedIns = c.inputs.filter((p) => isConnected(p.id) || portBound.has(p.id)).map((p) => inputExpr(p.id));
    // Data input i of a gate: a vector for a wide gate (open bits 0, noted)
    const gateIn = (i: number) => (gateW > 1 ? compose(wideBits(i)) : inp(i));
    // Open pins of a 4-bit data / address group: the simulator never stores an undefined word and
    // a RAM / ROM ignores an undefined address
    const openNibble = (from: number) =>
      [0, 1, 2, 3].map((i) => c.inputs[from + i]).filter((p) => p && isFloating(p.id)).map((p) => p.name);
    body.push(L.comment(`${c.label || c.type} (${c.type})`));
    const noteAt = body.length;

    switch (c.type) {
      case 'not':
        emitGate(L.not(gateIn(0)));
        break;
      case 'buffer':
        emitGate(gateIn(0));
        break;
      case 'and':
      case 'or':
      case 'nand':
      case 'nor':
      case 'xor':
      case 'xnor': {
        // Open inputs are left out like in the simulator; a negated input is inverted first
        const negated = c.state.negated ?? [];
        const ins =
          gateW > 1 || negated.length
            ? c.inputs.flatMap((p, i) => {
                if (!isConnected(p.id) && !portBound.has(p.id)) return [];
                const e = gateW > 1 ? compose(wideBits(i)) : inputExpr(p.id);
                return [negated.includes(i) ? L.not(e) : e];
              })
            : connectedIns;
        if (ins.length === 0) {
          body.push(L.comment('hiçbir girişi bağlı değil: simülatörde çıkış E, burada 0'));
          floatingParts.push(c.label || c.type);
          emit(out[0], zeroW);
          break;
        }
        let base: string;
        if (c.type === 'and' || c.type === 'nand') base = L.and(ins);
        else if (c.type === 'or' || c.type === 'nor') base = L.or(ins);
        else if (c.state.xorMode === 'one' && ins.length > 2) {
          // Exactly one 1: some input is 1 while every other one is 0
          base = L.or(ins.map((_, i) => L.and(ins.map((y, j) => (i === j ? y : L.not(y))))));
        } else base = L.xor(ins);
        emitGate(c.type === 'nand' || c.type === 'nor' || c.type === 'xnor' ? L.not(base) : base);
        break;
      }
      case 'triState':
        emit(out[0], L.mux(inp(1), gateIn(0), hiZW));
        break;
      case 'controlledInverter':
        emit(out[0], L.mux(inp(1), L.not(gateIn(0)), hiZW));
        break;
      case 'splitter4':
        for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], inp(i));
        break;
      case 'halfAdder':
        emit(out[0], L.xor([inp(0), inp(1)]));
        emit(out[1], L.and([inp(0), inp(1)]));
        break;
      case 'fullAdder': {
        const [a, b, ci] = [inp(0), inp(1), inp(2, L.zero)];
        emit(out[0], L.xor([a, b, ci]));
        emit(out[1], L.or([L.and([a, b]), L.and([ci, L.xor([a, b])])]));
        break;
      }
      case 'halfSubtractor':
        emit(out[0], L.xor([inp(0), inp(1)]));
        emit(out[1], L.and([L.not(inp(0)), inp(1)]));
        break;
      case 'fullSubtractor': {
        const [a, b, bi] = [inp(0), inp(1), inp(2, L.zero)];
        emit(out[0], L.xor([a, b, bi]));
        emit(out[1], L.or([L.and([L.not(a), b]), L.and([L.not(L.xor([a, b])), bi])]));
        break;
      }
      case 'mux2':
        emit(out[0], L.mux(inp(2), inp(1), inp(0)));
        break;
      case 'mux4':
        emit(out[0], L.mux(inp(5), L.mux(inp(4), inp(3), inp(2)), L.mux(inp(4), inp(1), inp(0))));
        break;
      case 'mux8': {
        const d = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => inp(i));
        const [s0, s1, s2] = [inp(8), inp(9), inp(10)];
        const m2 = (i: number) => L.mux(s0, d[i + 1], d[i]);
        const m4 = (i: number) => L.mux(s1, m2(i + 2), m2(i));
        const y = names.make(`${nm}_sel`, 'sel');
        declare(y);
        emit(y, L.mux(s2, m4(4), m4(0)));
        if (out[0]) emit(out[0], y);
        if (out[1]) emit(out[1], L.not(y));
        break;
      }
      case 'demux2':
        emit(out[0], L.and([inp(0), L.not(inp(1))]));
        emit(out[1], L.and([inp(0), inp(1)]));
        break;
      case 'demux4': {
        const [dd, s0, s1] = [inp(0), inp(1), inp(2)];
        for (let i = 0; i < 4; i++) {
          if (out[i]) emit(out[i], L.and([dd, i & 1 ? s0 : L.not(s0), i & 2 ? s1 : L.not(s1)]));
        }
        break;
      }
      case 'decoder2to4':
      case 'decoder3to8': {
        const bits = c.type === 'decoder2to4' ? 2 : 3;
        const en = inp(0, L.one); // unconnected enable = enabled
        for (let i = 0; i < 1 << bits; i++) {
          const lits = [en];
          for (let b = 0; b < bits; b++) lits.push(i & (1 << b) ? inp(1 + b) : L.not(inp(1 + b)));
          if (out[i]) emit(out[i], L.and(lits));
        }
        break;
      }
      case 'priorityEncoder4to2': {
        const [d0, d1, d2, d3] = [inp(0, L.zero), inp(1, L.zero), inp(2, L.zero), inp(3, L.zero)];
        if (out[0]) emit(out[0], L.or([d3, d2])); // Y1
        if (out[1]) emit(out[1], L.or([d3, L.and([L.not(d2), d1])])); // Y0
        if (out[2]) emit(out[2], L.or([d0, d1, d2, d3])); // V
        break;
      }
      case 'bcdTo7Seg':
      case 'rom16x4': {
        if (c.type === 'rom16x4' && openNibble(0).length > 0) {
          body.push(L.comment(`boştaki adres girişi ${openNibble(0).join(', ')}: simülatörde çıkış başlangıçtaki 0'da kalır, burada da 0`));
          out.forEach((o) => o && emit(o, L.zero));
          break;
        }
        // Constant lookup tables as sum-of-minterms over the 4 address bits (bit 0 = LSB)
        const addr = [inp(0), inp(1), inp(2), inp(3)];
        const table: number[] =
          c.type === 'bcdTo7Seg'
            ? Array.from({ length: 16 }, (_, k) => {
                const m = HEX_7SEG_MAP[k];
                return (['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const).reduce((acc, s, i) => acc | ((m[s] ? 1 : 0) << i), 0);
              })
            : Array.isArray(c.state.romData) && c.state.romData.length === 16
              ? c.state.romData
              : [0, 1, 4, 9, 3, 7, 15, 12, 8, 5, 10, 2, 6, 11, 14, 13];
        const nOut = c.type === 'bcdTo7Seg' ? 7 : 4;
        for (let bit = 0; bit < nOut; bit++) {
          if (!out[bit]) continue;
          const terms: string[] = [];
          for (let k = 0; k < 16; k++) {
            if ((table[k] >> bit) & 1) terms.push(L.and(addr.map((a, i) => ((k >> i) & 1 ? a : L.not(a)))));
          }
          emit(out[bit], terms.length === 0 ? L.zero : terms.length === 16 ? L.one : L.or(terms));
        }
        break;
      }
      case 'comparator4': {
        const a = [inp(3), inp(2), inp(1), inp(0)];
        const b = [inp(7), inp(6), inp(5), inp(4)];
        if (lang === 'verilog') {
          const av = `{${a.join(', ')}}`;
          const bv = `{${b.join(', ')}}`;
          if (out[0]) emit(out[0], `${av} > ${bv}`);
          if (out[1]) emit(out[1], `${av} == ${bv}`);
          if (out[2]) emit(out[2], `${av} < ${bv}`);
        } else {
          const av = names.make(`${nm}_a`, 'a');
          const bv = names.make(`${nm}_b`, 'b');
          declare(av, 4);
          declare(bv, 4);
          body.push(`  ${av} <= ${a.join(' & ')};`, `  ${bv} <= ${b.join(' & ')};`);
          if (out[0]) body.push(`  ${out[0]} <= '1' when unsigned(${av}) > unsigned(${bv}) else '0';`);
          if (out[1]) body.push(`  ${out[1]} <= '1' when ${av} = ${bv} else '0';`);
          if (out[2]) body.push(`  ${out[2]} <= '1' when unsigned(${av}) < unsigned(${bv}) else '0';`);
        }
        break;
      }
      case 'alu4': {
        const a = [inp(3), inp(2), inp(1), inp(0)];
        const b = [inp(8), inp(7), inp(6), inp(5)];
        const cin = inp(4, L.zero);
        const [s0, s1] = [inp(9), inp(10)];
        const r = names.make(`${nm}_result`, 'result');
        if (lang === 'verilog') {
          // 5-bit sum/difference: bit 4 is the carry, or NOT borrow for A - B - Cin (Cout = A >= B + Cin)
          declare(r, 5);
          const sum = names.make(`${nm}_sum`, 'sum');
          const diff = names.make(`${nm}_diff`, 'diff');
          declare(sum, 5);
          declare(diff, 5);
          const av = `{1'b0, ${a.join(', ')}}`;
          const bv = `{1'b0, ${b.join(', ')}}`;
          body.push(
            `  assign ${sum} = ${av} + ${bv} + ${cin};`,
            `  assign ${diff} = ${av} - ${bv} - ${cin};`,
            `  assign ${r} = ({${s1}, ${s0}} == 2'b00) ? ${sum} :`,
            `                ({${s1}, ${s0}} == 2'b01) ? {(${av} >= ${bv} + ${cin}), ${diff}[3:0]} :`,
            `                ({${s1}, ${s0}} == 2'b10) ? (${av} & ${bv}) : (${av} | ${bv});`
          );
          for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], `${r}[${i}]`);
          if (out[4]) emit(out[4], `${r}[4]`);
          if (out[5]) emit(out[5], `${r}[3:0] == 4'b0000`);
        } else {
          declare(r, 5);
          const av = names.make(`${nm}_a`, 'a');
          const bv = names.make(`${nm}_b`, 'b');
          declare(av, 4);
          declare(bv, 4);
          body.push(
            `  ${av} <= ${a.join(' & ')};`,
            `  ${bv} <= ${b.join(' & ')};`,
            `  process (${[av, bv, cin, s0, s1].filter(isSignalName).join(', ')})`,
            `    variable va, vb, vc : unsigned(4 downto 0);`,
            `  begin`,
            `    va := unsigned('0' & ${av});`,
            `    vb := unsigned('0' & ${bv});`,
            `    if ${is1(cin)} then vc := to_unsigned(1, 5); else vc := to_unsigned(0, 5); end if;`,
            `    if ${is0(s1)} and ${is0(s0)} then`,
            `      ${r} <= std_logic_vector(va + vb + vc);`,
            `    elsif ${is0(s1)} and ${is1(s0)} then`,
            `      ${r}(3 downto 0) <= std_logic_vector(resize(va - vb - vc, 4));`,
            `      if va >= vb + vc then ${r}(4) <= '1'; else ${r}(4) <= '0'; end if;`,
            `    elsif ${is1(s1)} and ${is0(s0)} then`,
            `      ${r} <= '0' & (${av} and ${bv});`,
            `    else`,
            `      ${r} <= '0' & (${av} or ${bv});`,
            `    end if;`,
            `  end process;`
          );
          for (let i = 0; i < 4; i++) if (out[i]) body.push(`  ${out[i]} <= ${r}(${i});`);
          if (out[4]) body.push(`  ${out[4]} <= ${r}(4);`);
          if (out[5]) body.push(`  ${out[5]} <= '1' when ${r}(3 downto 0) = "0000" else '0';`);
        }
        break;
      }
      case 'dFlipFlop':
      case 'jkFlipFlop':
      case 'tFlipFlop': {
        const q = names.make(`${nm}_q_reg`, 'q_reg');
        declare(q, 1, '0');
        const clk = inp(1, L.zero);
        const rst = c.type === 'tFlipFlop' ? inp(2, L.zero) : L.zero;
        const next =
          c.type === 'dFlipFlop'
            ? inp(0)
            : c.type === 'tFlipFlop'
              ? L.xor([q, inp(0)])
              : // JK: Q+ = J·Q' + K'·Q
                L.or([L.and([inp(0), L.not(q)]), L.and([L.not(inp(2)), q])]);
        body.push(...seqBlock(lang, clk, rst, [[q, next]], [[q, L.zero]], L));
        if (out[0]) emit(out[0], q);
        if (out[1]) emit(out[1], L.not(q));
        break;
      }
      case 'srLatch': {
        const q = names.make(`${nm}_q_reg`, 'q_reg');
        declare(q, 1, '0');
        const [s, r] = [inp(0, L.zero), inp(1, L.zero)];
        if (lang === 'verilog') {
          body.push(
            `  always @(*) begin`,
            `    if (${s} && !${r}) ${q} = 1'b1;`,
            `    else if (!${s} && ${r}) ${q} = 1'b0;`,
            `  end`
          );
        } else if (![s, r].some(isSignalName)) {
          // Both inputs constant: the latch never changes from set / its initial 0 (no empty process, VHDL-93)
          body.push(`  ${q} <= ${s === L.one && r === L.zero ? "'1'" : "'0'"};`);
        } else {
          body.push(
            `  process (${[s, r].filter(isSignalName).join(', ')})`,
            `  begin`,
            `    if ${is1(s)} and ${is0(r)} then ${q} <= '1';`,
            `    elsif ${is0(s)} and ${is1(r)} then ${q} <= '0';`,
            `    end if;`,
            `  end process;`
          );
        }
        if (out[0]) emit(out[0], q);
        if (out[1]) emit(out[1], L.not(q));
        break;
      }
      case 'counter4':
      case 'register4':
      case 'shiftRegister4': {
        const r = names.make(`${nm}_q_reg`, 'q_reg');
        declare(r, 4, '0000');
        const bit = (i: number) => vecIndex(r, i);
        let clk: string;
        let rst: string;
        let updates: [string, string][];
        if (c.type === 'counter4') {
          clk = inp(0, L.zero);
          rst = inp(1, L.zero);
          updates = [[r, lang === 'verilog' ? `${r} + 4'd1` : `std_logic_vector(unsigned(${r}) + 1)`]];
        } else if (c.type === 'register4') {
          clk = inp(4, L.zero);
          rst = inp(6, L.zero);
          const dOpen = openNibble(0);
          let we = inp(5, L.one); // unconnected write enable = enabled
          if (dOpen.length > 0) {
            body.push(L.comment(`boştaki veri girişi ${dOpen.join(', ')}: simülatör tanımsız veriyi yüklemez, burada yükleme kapalı`));
            we = L.zero;
          }
          const dIn = (i: number) => inputExpr(c.inputs[i]?.id);
          const d = lang === 'verilog' ? `{${dIn(3)}, ${dIn(2)}, ${dIn(1)}, ${dIn(0)}}` : `${dIn(3)} & ${dIn(2)} & ${dIn(1)} & ${dIn(0)}`;
          updates = [[r, lang === 'verilog' ? `${wrap(we)} ? ${d} : ${r}` : `__WE__(${we}|${d}|${r})`]];
        } else {
          clk = inp(0, L.zero);
          rst = inp(1, L.zero);
          const [sl, sr, s0, s1] = [inp(2), inp(3), inp(4), inp(5)];
          // 74HC194: mode 1 (S1S0=01) shifts right, SR enters Q0 and data moves toward Q3;
          // mode 2 (10) shifts left, SL enters Q3 and data moves toward Q0; else hold
          const right = lang === 'verilog' ? `{${bit(2)}, ${bit(1)}, ${bit(0)}, ${sr}}` : `${r}(2 downto 0) & ${sr}`;
          const left = lang === 'verilog' ? `{${sl}, ${bit(3)}, ${bit(2)}, ${bit(1)}}` : `${sl} & ${r}(3 downto 1)`;
          updates = [
            [
              r,
              lang === 'verilog'
                ? `({${s1}, ${s0}} == 2'b01) ? ${right} : ({${s1}, ${s0}} == 2'b10) ? ${left} : ${r}`
                : `__SHIFT__(${s1}|${s0}|${right}|${left}|${r})`,
            ],
          ];
        }
        body.push(...seqBlock(lang, clk, rst, updates, [[r, lang === 'verilog' ? "4'b0000" : '"0000"']], L));
        for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], bit(i));
        break;
      }
      case 'ram16x4': {
        if (openNibble(0).length > 0) {
          body.push(L.comment(`boştaki adres girişi ${openNibble(0).join(', ')}: simülatörde bellek yazılmaz, çıkış başlangıçtaki 0'da kalır; burada da öyle`));
          out.forEach((o) => o && emit(o, L.zero));
          break;
        }
        const mem = names.make(`${nm}_mem`, 'mem');
        const init = Array.isArray(c.state.ramData) && c.state.ramData.length === 16 ? c.state.ramData : Array.from({ length: 16 }, (_, i) => i);
        const clk = inp(8, L.zero);
        let we = inp(9, L.one); // unconnected write enable = enabled, as in the simulator
        const dOpen = openNibble(4);
        if (dOpen.length > 0) {
          body.push(L.comment(`boştaki veri girişi ${dOpen.join(', ')}: simülatör tanımsız veriyi yazmaz, burada yazma kapalı`));
          we = L.zero;
        }
        const dIn = (i: number) => inputExpr(c.inputs[i]?.id);
        if (lang === 'verilog') {
          const addr = `{${inp(3)}, ${inp(2)}, ${inp(1)}, ${inp(0)}}`;
          const din = `{${dIn(7)}, ${dIn(6)}, ${dIn(5)}, ${dIn(4)}}`;
          extraDecls.push(`  reg [3:0] ${mem} [0:15];`, `  initial begin`, ...init.map((v, i) => `    ${mem}[${i}] = 4'd${v & 15};`), `  end`);
          if (isSignalName(clk)) {
            body.push(`  always @(posedge ${clk}) begin`, `    if (${we}) ${mem}[${addr}] <= ${din};`, `  end`);
          }
          const rd = names.make(`${nm}_rdata`, 'rdata');
          declare(rd, 4);
          body.push(`  assign ${rd} = ${mem}[${addr}];`);
          for (let i = 0; i < 4; i++) if (out[i]) emit(out[i], `${rd}[${i}]`);
        } else {
          const typ = names.make(`${nm}_mem_t`, 'mem_t');
          const addrSig = names.make(`${nm}_addr`, 'addr');
          declare(addrSig, 4);
          extraDecls.push(
            `  type ${typ} is array (0 to 15) of std_logic_vector(3 downto 0);`,
            `  signal ${mem} : ${typ} := (${init.map((v) => `"${(v & 15).toString(2).padStart(4, '0')}"`).join(', ')});`
          );
          body.push(`  ${addrSig} <= ${inp(3)} & ${inp(2)} & ${inp(1)} & ${inp(0)};`);
          if (isSignalName(clk)) {
            body.push(
              `  process (${clk})`,
              `  begin`,
              `    if rising_edge(${clk}) then`,
              `      if ${is1(we)} then ${mem}(to_integer(unsigned(${addrSig}))) <= ${dIn(7)} & ${dIn(6)} & ${dIn(5)} & ${dIn(4)}; end if;`,
              `    end if;`,
              `  end process;`
            );
          }
          const rd = names.make(`${nm}_rdata`, 'rdata');
          declare(rd, 4);
          body.push(`  ${rd} <= ${mem}(to_integer(unsigned(${addrSig})));`);
          for (let i = 0; i < 4; i++) if (out[i]) body.push(`  ${out[i]} <= ${rd}(${i});`);
        }
        break;
      }
      case 'flipFlopD':
      case 'flipFlopT':
      case 'flipFlopJK':
      case 'flipFlopSR':
      case 'register':
      case 'counter':
      case 'shiftRegister': {
        // As stepMem: clear (0) / preset (1) act at once while 1, clear first; the clock acts on its edge
        // (falling: negedge) or, for a level trigger, while high / low (a latch); enable / count / shift block
        // only at 0, so open ones count as on; load needs 1. Open data bits read 0 here (x in the simulator)
        const v = lang === 'verilog';
        const { width: w, length: len, parallel } = getMemConfig(c);
        const keys = memPinKeys(c.type, len, parallel).inputs;
        const at = (k: string) => keys.indexOf(k);
        const isFF = FLIP_FLOP_TYPES.has(c.type);
        const trig = getTrigger(c);
        const level = trig === 'high' || trig === 'low';
        const reads: string[] = [];
        // 1-bit control: a constant, or a plain signal (edge lists and VHDL sensitivity lists need names)
        const ctl = (k: string, open: string): string => {
          const i = at(k);
          if (i < 0) return open;
          const e = inp(i, open);
          if (e === L.one || e === L.zero) return e;
          const n = asName(e, 1, `${nm}_${k}`);
          reads.push(n);
          return n;
        };
        const data = (k: string): string => {
          const i = at(k);
          const pw = c.inputs[i]?.width ?? 1;
          const e = pw > 1 ? compose(wideBits(i)) : inp(i);
          if (e === L.one || e === L.zero) return e;
          const n = asName(e, pw, `${nm}_${k}`);
          reads.push(n);
          return n;
        };
        const W = c.type === 'shiftRegister' ? w * len : isFF ? 1 : w;
        const lit = (n: number, k: number) =>
          bitLiteral(Array.from({ length: k }, (_, i) => (Math.floor(n / 2 ** i) % 2 === 1 ? 1 : 0)) as (0 | 1)[]);
        const zeros = lit(0, W);
        // Conditions: 'true' / 'false' fold away
        const c1 = (x: string) => (x === L.one ? 'true' : x === L.zero ? 'false' : v ? x : `${x} = '1'`);
        // Enable-like pins: open ones are tied on above; a driven one acts at 1 (x / U never enable, as Verilog's if)
        const cnz = c1;
        const cAnd = (a: string, b: string) => (a === 'false' || b === 'false' ? 'false' : a === 'true' ? b : b === 'true' ? a : v ? `(${a}) && (${b})` : `(${a}) and (${b})`);
        const ind = (ls: string[]) => ls.map((l) => `  ${l}`);
        const ifs = (cond: string, then: string[], els: string[] = []): string[] => {
          if (cond === 'true') return then;
          if (cond === 'false') return els;
          // An else branch that is itself one if chain continues it (else if / elsif)
          const chained = els.length > 0 && els[0].startsWith('if ');
          if (v) {
            if (!els.length) return [`if (${cond}) begin`, ...ind(then), 'end'];
            return [`if (${cond}) begin`, ...ind(then), ...(chained ? [`end else ${els[0]}`, ...els.slice(1)] : ['end else begin', ...ind(els), 'end'])];
          }
          if (chained) return [`if ${cond} then`, ...ind(then), `els${els[0]}`, ...els.slice(1)];
          return [`if ${cond} then`, ...ind(then), ...(els.length ? ['else', ...ind(els)] : []), 'end if;'];
        };
        const r = names.make(`${nm}_q_reg`, 'q_reg');
        const set = (rhs: string) => `${r} <= ${rhs};`;
        const clkPin = c.inputs[at('clk')];
        const clkOpen = !clkPin || isFloating(clkPin.id);
        const clk = clkOpen ? L.zero : ctl('clk', L.zero);
        const clr = ctl('clr', L.zero);
        const pre = isFF ? ctl('pre', L.zero) : L.zero;
        const notes: string[] = [];

        // Next value when the clock acts (and the enable allows it)
        let act: string[] = [];
        let en = isFF || c.type === 'register' ? ctl('en', L.one) : L.one;
        if (isFF) {
          const dataKeys = flipFlopDataKeys(c.type);
          const openData = dataKeys.filter((k) => c.type !== 'flipFlopT' && isFloating(c.inputs[at(k)].id));
          if (openData.length) {
            // An undefined next value is never stored
            notes.push(`boştaki ${openData.map((k) => k.toUpperCase()).join(', ')}: simülatörde x, flip-flop hiç yüklenmez; burada da yüklenmez`);
            en = L.zero;
          } else if (c.type === 'flipFlopD') act = [set(data('d'))];
          else if (c.type === 'flipFlopT') act = ifs(c1(ctl('t', L.zero)), [set(L.not(r))]);
          else {
            const [a, b] = dataKeys.map((k) => ctl(k, L.zero));
            const na = c1(a) === 'true' ? 'false' : c1(a) === 'false' ? 'true' : v ? `!${a}` : `${a} = '0'`;
            const nb = c1(b) === 'true' ? 'false' : c1(b) === 'false' ? 'true' : v ? `!${b}` : `${b} = '0'`;
            act = ifs(cAnd(c1(a), nb), [set(L.one)], ifs(cAnd(na, c1(b)), [set(L.zero)], c.type === 'flipFlopJK' ? ifs(cAnd(c1(a), c1(b)), [set(L.not(r))]) : []));
          }
        } else if (c.type === 'register') {
          act = [set(data('d'))];
        } else if (c.type === 'counter') {
          // evolution's rules: load first, up unless U/D is 0; at the goal (max up, 0 down) wrap / stay / step on / load
          const max = getCounterMax(c);
          const mask = w >= 32 ? 0xffffffff : 2 ** w - 1;
          const MAX = lit(max, w);
          const ld = ctl('ld', L.zero);
          const ct = ctl('ct', L.one);
          const ud = ctl('ud', L.one);
          const goal = c.state.counterGoal ?? 'wrap';
          const needD = ld !== L.zero || goal === 'load';
          const d = needD ? data('d') : zeros;
          const loadVal = (): string[] => {
            if (max === mask) return [set(d)];
            if (w === 1) return [set(L.zero)]; // max 0: every value above it masks to 0
            const gt = v ? `${d} > ${MAX}` : `unsigned(${d}) > unsigned'(${MAX})`;
            return ifs(gt, [set(v ? `${d} & ${MAX}` : `${d} and ${MAX}`)], [set(d)]);
          };
          const inc = w === 1 ? L.not(r) : v ? `${r} + 1'b1` : `std_logic_vector(unsigned(${r}) + 1)`;
          const dec = w === 1 ? L.not(r) : v ? `${r} - 1'b1` : `std_logic_vector(unsigned(${r}) - 1)`;
          const eq = (k: string) => (v ? `${r} == ${k}` : `${r} = ${k}`);
          const dir = (up: string[], down: string[]) => ifs(c1(ud), up, down);
          const atGoal =
            goal === 'wrap' ? dir([set(zeros)], [set(MAX)]) : goal === 'stay' ? [] : goal === 'load' ? loadVal() : dir([set(inc)], [set(dec)]);
          act = ifs(c1(ld), loadVal(), ifs(cnz(ct), dir(ifs(eq(MAX), atGoal, [set(inc)]), ifs(eq(zeros), atGoal, [set(dec)]))));
          // Carry: the value sits at the goal of the current direction; 0 while cleared
          if (out[1]) {
            const upC = v ? `(${r} == ${MAX})` : `${r} = ${MAX}`;
            const dnC = v ? `(${r} == ${zeros})` : `${r} = ${zeros}`;
            const sel = ud === L.one ? upC : ud === L.zero ? dnC : v ? `(${ud} ? ${upC} : ${dnC})` : `((${ud} = '1' and ${upC}) or (${ud} = '0' and ${dnC}))`;
            if (clr === L.one) emit(out[1], L.zero);
            else if (v) emit(out[1], clr === L.zero ? sel : `~${clr} & ${sel}`);
            else body.push(`  ${out[1]} <= '1' when ${clr === L.zero ? sel : `${clr} = '0' and ${sel}`} else '0';`);
          }
        } else {
          // Shift register: stage i in bits i*w .. i*w+w-1, stage 0 takes the serial input, the last one is OUT
          const ld = parallel ? ctl('ld', L.zero) : L.zero;
          const sh = ctl('sh', L.one);
          const din = data('in');
          const lowStages = len === 1 ? '' : (len - 1) * w === 1 ? vecIndex(r, 0) : v ? `${r}[${(len - 1) * w - 1}:0]` : `${r}(${(len - 1) * w - 1} downto 0)`;
          const shifted = len === 1 ? din : v ? `{${lowStages}, ${din}}` : `${lowStages} & ${din}`;
          const shiftAct = ifs(cnz(sh), [set(shifted)]);
          if (ld !== L.zero) {
            const ds = Array.from({ length: len }, (_, i) => data(`d${i}`)).reverse();
            act = ifs(c1(ld), [set(len === 1 ? ds[0] : v ? `{${ds.join(', ')}}` : ds.join(' & '))], shiftAct);
          } else act = shiftAct;
        }

        // Stored value forced by a clear / preset tied to 1: no storage at all
        const held = clr === L.one ? (isFF ? L.zero : zeros) : pre === L.one ? (clr === L.zero ? L.one : L.not(clr)) : null;
        const state = held ?? r;
        if (held === null) {
          declare(r, W, '0'.repeat(W));
          const acts = clkOpen ? 'false' : level ? c1(trig === 'high' ? clk : clk === L.one ? L.zero : clk === L.zero ? L.one : L.not(clk)) : null;
          const asyncs: [string, string][] = [];
          if (clr !== L.zero) asyncs.push([clr, zeros]);
          if (pre !== L.zero) asyncs.push([pre, L.one]);
          const actBody = ifs(cnz(en), act);
          if (acts === null && isSignalName(clk)) {
            // Edge-triggered with asynchronous clear / preset
            if (v) {
              const edges = [`${trig === 'falling' ? 'negedge' : 'posedge'} ${clk}`, ...asyncs.map(([s]) => `posedge ${s}`)];
              let chain = actBody;
              for (const [s, val] of [...asyncs].reverse()) chain = ifs(s, [set(val)], chain);
              body.push(`  always @(${edges.join(' or ')}) begin`, ...ind(ind(chain)), '  end');
              if (asyncs.length === 2) notes.push('CLR 1 iken PRE de 1 ise, CLR bırakılınca simülatör hemen 1 olur; Verilog bunu bir sonraki saat kenarında yapar');
            } else {
              const sens = [clk, ...asyncs.map(([s]) => s)].map((s) => s.replace(/\(.*$/, ''));
              const lines = [`  process (${[...new Set(sens)].join(', ')})`, '  begin'];
              const arms = asyncs.map(([s, val], i) => `    ${i ? 'elsif' : 'if'} ${s} = '1' then\n      ${set(val)}`);
              const edge = `${trig === 'falling' ? 'falling_edge' : 'rising_edge'}(${clk})`;
              lines.push(...arms.flatMap((a) => a.split('\n')), `    ${asyncs.length ? 'elsif' : 'if'} ${edge} then`, ...ind(ind(ind(actBody))), '    end if;', '  end process;');
              body.push(...lines);
            }
          } else {
            // Level trigger (a latch), or a clock that never acts: only clear / preset change the value
            const actsCond = acts ?? 'false';
            let chain = ifs(actsCond, actBody);
            for (const [s, val] of [...asyncs].reverse()) chain = ifs(c1(s), [set(val)], chain);
            const sens = [...new Set(reads.map((s) => s.replace(/[[(].*$/, '')))];
            if (chain.length === 0 || sens.length === 0) {
              body.push(L.comment(clkOpen ? 'saat girişi boşta: değer hiç değişmez' : 'değer hiç değişmez'));
            } else if (v) {
              body.push('  always @(*) begin', ...ind(ind(chain)), '  end');
            } else {
              body.push(`  process (${sens.join(', ')})`, '  begin', ...ind(ind(chain)), '  end process;');
            }
          }
        }
        for (const n of notes) body.push(L.comment(n));

        // Outputs
        const stage = (i: number) => (W === 1 ? state : w === 1 ? vecIndex(state, i) : v ? `${state}[${i * w + w - 1}:${i * w}]` : `${state}(${i * w + w - 1} downto ${i * w})`);
        if (isFF) {
          if (out[0]) emit(out[0], state);
          if (out[1]) emit(out[1], L.not(state));
        } else if (c.type === 'shiftRegister') {
          const sv = held !== null ? null : state;
          if (out[0]) emit(out[0], sv === null ? lit(0, w) : stage(len - 1));
          if (parallel) for (let i = 0; i < len; i++) if (out[1 + i]) emit(out[1 + i], sv === null ? lit(0, w) : stage(i));
        } else if (out[0]) emit(out[0], state);
        break;
      }
      case 'subcircuit': {
        const subId = c.state.subcircuitId as string | undefined;
        const def = subId ? getSubcircuitDefinition(subId) : undefined;
        if (!def) {
          warnings.push(`${c.label || c.id}: alt devre tanımı bulunamadı, çıkışlar 0 kabul edildi.`);
          out.forEach((o) => o && emit(o, L.zero));
          break;
        }
        if (!subModules.has(def.id)) {
          subModules.set(def.id, { def, moduleName: moduleNames.make(def.chipCode || def.name, 'custom_ic') });
        }
        const sub = subModules.get(def.id)!;
        const portNames = subPortNames(def.ports);
        // A multi-bit port takes the bits of its net as one vector (VHDL-93 port maps need a name)
        const actual = (i: number) => {
          const w = c.inputs[i].width ?? 1;
          if (w === 1) return inp(i);
          const e = compose(wideBits(i));
          return lang === 'vhdl' ? asName(e, w, `${nm}_${c.inputs[i].name}`) : e;
        };
        const maps = [
          ...c.inputs.map((_p, i) => [portNames.inputs[i], actual(i)] as const),
          ...c.outputs.map((_p, i) => [portNames.outputs[i], out[i]] as const),
        ].filter(([pn]) => !!pn);
        const inst = names.make(`u_${nm}`, 'u_ic');
        if (lang === 'verilog') {
          body.push(`  ${sub.moduleName} ${inst} (`, maps.map(([pn, sig]) => `    .${pn}(${sig})`).join(',\n'), `  );`);
        } else {
          body.push(`  ${inst} : entity work.${sub.moduleName}`, `    port map (`, maps.map(([pn, sig]) => `      ${pn} => ${sig}`).join(',\n'), `    );`);
        }
        break;
      }
      case 'bitExtender': {
        // Lower bits pass, the rest are filled (0, 1, the top input bit or the extension input);
        // a narrower output keeps only the low bits
        if (!out[0]) break;
        const src = wideBits(0);
        const outW = c.outputs[0].width ?? 1;
        const type = c.state.extendType ?? 'zero';
        let fill: Bit = { k: 'lit', v: type === 'one' ? 1 : 0 };
        if (type === 'sign') fill = src[src.length - 1];
        if (type === 'input') {
          const e = inp(1);
          fill = e === L.one || e === L.zero ? { k: 'lit', v: e === L.one ? 1 : 0 } : { k: 'sig', e };
        }
        emit(out[0], compose(Array.from({ length: outW }, (_, b) => (b < src.length ? src[b] : fill))));
        break;
      }
      case 'multiplexer':
      case 'demultiplexer':
      case 'decoder': {
        // As in the simulator: enable 0 gives the disabled value (0, or Z for a floating one), otherwise the
        // select picks the input (MUX) / the output that gets the data or 1 (the others 0, or Z when
        // three-state). An open enable counts as enabled; an open select reads 0 here (x in the simulator)
        const { select: s, width: w, enable } = getPlexerConfig(c);
        const n = 1 << s;
        const isMux = c.type === 'multiplexer';
        const dw = c.type === 'decoder' ? 1 : w;
        const selIdx = isMux ? n : c.type === 'demultiplexer' ? 1 : 0;
        const zeroOf = (k: number) => (k > 1 ? bitLiteral(new Array<0 | 1>(k).fill(0)) : L.zero);
        const hiZOf = (k: number) => (k > 1 ? (lang === 'verilog' ? `${k}'bz` : "(others => 'Z')") : L.hiZ);
        const dataOf = (i: number) => (w > 1 ? compose(wideBits(i)) : inp(i));
        const selExpr = s > 1 ? compose(wideBits(selIdx)) : inp(selIdx);
        const sel = lang === 'vhdl' ? asName(selExpr, s, `${nm}_sel`) : selExpr;
        const en = enable ? inp(selIdx + 1, L.one) : null;
        const dis = c.state.plexDisabled === 'Z' ? hiZOf(dw) : zeroOf(dw);
        const lit = (k: number) => bitLiteral(numberToBits(k, s).map((b) => (b === 1 ? 1 : 0)) as (0 | 1)[]);
        const selIs = (k: number) => (lang === 'verilog' ? (s === 1 ? (k ? wrap(sel) : `~${wrap(sel)}`) : `(${sel} == ${lit(k)})`) : `${sel} = ${lit(k)}`);
        // Verilog nested conditionals / VHDL when-else chain over the conditions, the last value as default
        const chain = (lhs: string, arms: Array<[string, string]>, last: string) => {
          if (lang === 'verilog') {
            emit(lhs, arms.reduceRight((acc, [cond, v]) => `${cond} ? ${wrap(v)} : ${wrap(acc)}`, last));
          } else {
            body.push(`  ${lhs} <= ${arms.map(([cond, v]) => `${v} when ${cond} else `).join('')}${last};`);
          }
        };
        const enArm = (): Array<[string, string]> =>
          en === null ? [] : [[lang === 'verilog' ? `(${en} == 1'b0)` : is0(en), dis]];
        if (isMux) {
          const arms: Array<[string, string]> = [...enArm()];
          for (let k = 0; k < n - 1; k++) arms.push([selIs(k), dataOf(k)]);
          chain(out[0], arms, dataOf(n - 1));
          break;
        }
        const data = c.type === 'decoder' ? L.one : dataOf(0);
        const others = c.state.plexTristate ? hiZOf(dw) : zeroOf(dw);
        for (let k = 0; k < n; k++) {
          if (!out[k]) continue;
          chain(out[k], [...enArm(), [selIs(k), data]], others);
        }
        break;
      }
      case 'priorityEncoder': {
        // Enabled unless EN_IN is 0 (open = enabled); only inputs at 1 count, so open ones read 0. With no
        // input at 1 the code is x in the simulator, 0 here
        const { select: s } = getPlexerConfig(c);
        const n = 1 << s;
        const ins = Array.from({ length: n }, (_, i) => inp(i, L.zero));
        const en = inp(n, L.one);
        const lit = (k: number) => bitLiteral(numberToBits(k, s).map((b) => (b === 1 ? 1 : 0)) as (0 | 1)[]);
        const dis = c.state.plexDisabled === 'Z' ? (s > 1 ? (lang === 'verilog' ? `${s}'bz` : "(others => 'Z')") : L.hiZ) : lit(0);
        const any = L.or(ins);
        if (out[0]) {
          body.push(L.comment('hiçbir giriş 1 değilken kod simülatörde x, burada 0'));
          if (lang === 'verilog') {
            let e = lit(0);
            for (let k = 0; k < n; k++) e = `${wrap(ins[k])} ? ${lit(k)} : ${wrap(e)}`;
            emit(out[0], `(${en} == 1'b0) ? ${wrap(dis)} : ${wrap(e)}`);
          } else {
            const arms = [`${dis} when ${is0(en)} else `];
            for (let k = n - 1; k >= 0; k--) arms.push(`${lit(k)} when ${is1(ins[k])} else `);
            body.push(`  ${out[0]} <= ${arms.join('')}${lit(0)};`);
          }
        }
        if (out[1]) emit(out[1], L.and([en, L.not(any)])); // EN_OUT
        if (out[2]) emit(out[2], L.and([en, any])); // GS
        break;
      }
      case 'adder':
      case 'subtractor':
      case 'multiplier':
      case 'divider':
      case 'negator':
      case 'absolute':
      case 'comparator':
      case 'minMax':
      case 'shifter':
      case 'squareRoot':
      case 'exponentiator':
      case 'bitAdder':
      case 'bitFinder':
      case 'alu': {
        // Data inputs read like any multi-bit reader (open bits 0, noted); an open carry / borrow in, the
        // multiplier's carry in and an open upper half count as 0 in the simulator too, so no note for them
        const keys = c.type === 'bitAdder' ? c.inputs.map((_, i) => `in${i}`) : ARITH_PINS[c.type]!.inputs;
        const quietBits = (i: number): { bits: Bit[]; floating: boolean } => {
          const pin = c.inputs[i];
          if (!pin) return { bits: [{ k: 'lit', v: 0 }], floating: true };
          const r = readBits(pin.id, pin.width ?? 1);
          return r.mismatch ? { bits: wideBits(i), floating: false } : r;
        };
        const upperIdx = keys.indexOf('upper');
        const hasUpper = upperIdx >= 0 && !quietBits(upperIdx).floating;
        const m = arithModel(lang, c, hasUpper);
        const fname = names.make(`${nm}_f`, 'f');
        extraDecls.push(...m.decl(fname));
        const args = m.params.map((pw, i) => {
          const quiet = keys[i] === 'cin' || keys[i] === 'bin' || keys[i] === 'upper';
          const e = compose(quiet ? quietBits(i).bits : wideBits(i));
          return lang === 'vhdl' && pw === 1 ? `(0 => ${e})` : e;
        });
        if (c.type === 'divider') body.push(L.comment('bölen 0 ise 1 ile bölünür (simülatördeki gibi)'));
        const R = m.outWidths.reduce((a, b) => a + b, 0);
        const res = names.make(`${nm}_res`, 'res');
        declare(res, R);
        const call = `${fname}(${args.join(', ')})`;
        emit(res, lang === 'vhdl' && R === 1 ? `${call}(0)` : call);
        let lo = 0;
        m.outWidths.forEach((ow, k) => {
          if (out[k]) {
            const hi = lo + ow - 1;
            emit(
              out[k],
              R === 1 ? res : ow === 1 ? vecIndex(res, lo) : lang === 'verilog' ? `${res}[${hi}:${lo}]` : `${res}(${hi} downto ${lo})`
            );
          }
          lo += ow;
        });
        break;
      }
      case 'bitSelector': {
        // Group k of the data (bits k*g .. k*g+g-1); bits past the data read 0, as in the simulator
        if (!out[0]) break;
        const data = wideBits(0);
        const selW = c.inputs[1]?.width ?? 1;
        const sel = compose(wideBits(1));
        const g = c.outputs[0].width ?? 1;
        const n = (1 << selW) * g;
        const ext = names.make(`${nm}_ext`, 'ext');
        declare(ext, n);
        emit(ext, compose(Array.from({ length: n }, (_, b) => (b < data.length ? data[b] : ({ k: 'lit', v: 0 } as Bit)))));
        if (lang === 'verilog') {
          emit(out[0], g === 1 ? `${ext}[${sel}]` : `${ext}[${wrap(sel)} * ${g} +: ${g}]`);
        } else {
          const s = asName(sel, selW, `${nm}_sel`);
          const slice = (k: number) => (g === 1 ? `${ext}(${k})` : `${ext}(${k * g + g - 1} downto ${k * g})`);
          const choice = (k: number) => (selW === 1 ? `'${k}'` : `"${k.toString(2).padStart(selW, '0')}"`);
          body.push(
            `  with ${s} select ${out[0]} <=`,
            ...Array.from({ length: 1 << selW }, (_, k) => `    ${slice(k)} when ${choice(k)},`),
            `    ${g === 1 ? "'X'" : "(others => 'X')"} when others;`
          );
        }
        break;
      }
      default:
        warnings.push(`${c.label || c.type}: '${c.type}' bileşeni HDL'e çevrilemiyor, çıkışları 0 bırakıldı.`);
        out.forEach((o) => o && emit(o, L.zero));
        break;
    }
    if (openIns.size > 0) {
      body.splice(noteAt, 0, L.comment(`boştaki giriş(ler) ${[...openIns].join(', ')}: simülatörde x, burada 0'a bağlandı`));
      floatingParts.push(c.label || c.type);
    }
  }
  if (floatingParts.length > 0) {
    warnings.push(
      `boşta girişi olan parçalar (${[...new Set(floatingParts)].join(', ')}): simülatörde x/E görünen bu girişler sentezlenebilirlik için 0'a bağlandı, sonuç simülatörden farklı olabilir.`
    );
  }

  // --- output ports ---------------------------------------------------------
  if (spec.subPorts) {
    subOutPorts.forEach((p, i) => {
      const pn = subNames!.outputs[i];
      const width = spec.subDef ? subcircuitPortWidth(spec.subDef, p) : 1;
      addPort({ name: pn, dir: 'out', width });
      const target = compById.get(p.targetCompId);
      if (width > 1) {
        const readPin = target && OUTPUT_TYPES.includes(target.type) ? target.inputs[0]?.id : p.targetPinId;
        emit(pn, pinIsOutput.get(p.targetPinId) ? pinExpr.get(p.targetPinId) || bitLiteral(new Array(width).fill(0)) : compose(readBits(readPin ?? '', width).bits));
        return;
      }
      const expr =
        target && OUTPUT_TYPES.includes(target.type)
          ? inputExpr(target.inputs[0]?.id)
          : pinIsOutput.get(p.targetPinId)
            ? pinExpr.get(p.targetPinId) || L.zero
            : inputExpr(p.targetPinId);
      emit(pn, expr);
    });
  } else {
    for (const c of comps) {
      if (!OUTPUT_TYPES.includes(c.type)) continue;
      const label = c.label || c.type;
      const groups: { suffix: string; pins: typeof c.inputs }[] =
        c.type === 'dotMatrix8x8'
          ? [
              { suffix: 'rows', pins: c.inputs.slice(0, 8) },
              { suffix: 'cols', pins: c.inputs.slice(8, 16) },
            ]
          : c.type === 'rgbMatrix16x16'
            ? [
                { suffix: 'x', pins: c.inputs.slice(0, 4) },
                { suffix: 'y', pins: c.inputs.slice(4, 8) },
                { suffix: 'rgb', pins: c.inputs.slice(8, 11) },
                { suffix: 'we', pins: c.inputs.slice(11, 12) },
              ]
            : c.type === 'buzzer'
              ? [
                  { suffix: 'en', pins: c.inputs.slice(0, 1) },
                  { suffix: 'note', pins: c.inputs.slice(1, 5) },
                ]
              : [{ suffix: '', pins: c.inputs }];
      for (const g of groups) {
        if (g.pins.length === 0) continue;
        const prefix = c.type === 'sevenSegment' ? 'out_seg' : c.type === 'hexDisplay' ? 'out_hex' : 'out';
        const pn = names.make(`${prefix}_${label}${g.suffix ? `_${g.suffix}` : ''}`, 'out_sig');
        // A multi-bit LED has its own width, a probe takes the width of its net
        const busWidth = c.type === 'led' ? (g.pins[0].width ?? 1) : c.type === 'probe' ? Math.max(1, netWidth(g.pins[0].id)) : 0;
        const width = c.type === 'led' || c.type === 'probe' ? busWidth : g.pins.length;
        addPort({ name: pn, dir: 'out', width, source: { compId: c.id, type: c.type, group: g.suffix || undefined } });
        if (busWidth > 1) emit(pn, compose(readBits(g.pins[0].id, busWidth).bits));
        else g.pins.slice(0, width).forEach((pin, i) => emit(width === 1 ? pn : vecIndex(pn, i), inputExpr(pin.id)));
      }
    }
  }

  return { name: spec.name, ports, signals, body, extraDecls, warnings };
}

// Port names of a custom IC module, shared by the module itself and every instance of it
function subPortNames(ports: CustomSubcircuit['ports']): { inputs: string[]; outputs: string[] } {
  const names = new NameTable();
  const inputs = ports.filter((p) => p.type === 'input').map((p, i) => names.make(p.name, `in_${i}`));
  const outputs = ports.filter((p) => p.type === 'output').map((p, i) => names.make(p.name, `out_${i}`));
  return { inputs, outputs };
}

function isSignalName(e: string): boolean {
  return /^[a-z][a-z0-9_]*(\[\d+\]|\(\d+\))?$/.test(e);
}

// Clocked process/always block with asynchronous active-high reset (as the simulator: reset wins)
function seqBlock(
  lang: Lang,
  clk: string,
  rst: string,
  updates: [string, string][],
  resets: [string, string][],
  L: LangOps
): string[] {
  const hasClk = isSignalName(clk);
  const hasRst = rst !== L.zero && rst !== L.one;
  const lines: string[] = [];
  if (rst === L.one) {
    // Reset tied high: the register is held cleared
    if (lang === 'verilog') lines.push(...resets.map(([r, v]) => `  always @(*) ${r} = ${v};`));
    else lines.push(...resets.map(([r, v]) => `  ${r} <= ${v};`));
    return lines;
  }
  if (!hasClk) {
    lines.push(L.comment(`saat girişi bağlı değil (${clk}); kayıtçı başlangıç değerinde kalır`));
    return lines;
  }
  if (lang === 'verilog') {
    lines.push(`  always @(posedge ${clk}${hasRst ? ` or posedge ${rst}` : ''}) begin`);
    if (hasRst) {
      lines.push(`    if (${rst}) begin`, ...resets.map(([r, v]) => `      ${r} <= ${v};`), `    end else begin`);
      lines.push(...updates.map(([r, v]) => `      ${r} <= ${v};`), `    end`);
    } else {
      lines.push(...updates.map(([r, v]) => `    ${r} <= ${v};`));
    }
    lines.push('  end');
  } else {
    const vhdlValue = (v: string) =>
      v.includes('__WE__') ? vhdlWe(v) : v.includes('__SHIFT__') ? vhdlShift(v) : v.includes('__MUX__') ? vhdlMuxSeq(v) : `@${v};`;
    lines.push(`  process (${clk}${hasRst && isSignalName(rst) ? `, ${rst}` : ''})`, `  begin`);
    if (hasRst) {
      lines.push(`    if ${is1(rst)} then`, ...resets.map(([r, v]) => `      ${r} <= ${v};`), `    elsif rising_edge(${clk}) then`);
    } else {
      lines.push(`    if rising_edge(${clk}) then`);
    }
    for (const [r, v] of updates) lines.push(...vhdlValue(v).split('\n').map((l) => `      ${l.replace(/^(\s*)@/, `$1${r} <= `)}`));
    lines.push('    end if;', '  end process;');
  }
  return lines;
}

// ---- Parametric arithmetic parts -------------------------------------------
// One function per part computes all of its outputs packed LSB first (in ARITH_PINS output order). The
// operands are read in the part's mode with plain unsigned arithmetic on sign- or zero-extended values (and
// magnitudes for the signed divider), so Verilog and VHDL give the bits computeArith gives for defined inputs.
interface ArithModel {
  params: number[]; // widths of the function's inputs p0, p1, ...
  outWidths: number[]; // packed outputs, LSB first
  decl: (fname: string) => string[];
}

function arithModel(lang: Lang, c: CircuitComponentInstance, hasUpper: boolean): ArithModel {
  const { width: w, inputs: nIn } = getArithConfig(c);
  const W2 = 2 * w;
  const mode = getArithMode(c);
  const v = lang === 'verilog';
  const zx = (p: string, pw: number, n: number) =>
    v ? (n === pw ? p : `{${n - pw}'b0, ${p}}`) : `resize(unsigned(${p}), ${n})`;
  const sx = (p: string, pw: number, n: number) =>
    v ? (n === pw ? p : `{{${n - pw}{${p}[${pw - 1}]}}, ${p}}`) : `unsigned(resize(signed(${p}), ${n}))`;
  const ext = (signed: boolean, p: string, n: number) => (signed ? sx(p, w, n) : zx(p, w, n));
  const vec = (n: number) => `unsigned(${n - 1} downto 0)`;
  // Verilog: '$R = x;' assigns the function's result; VHDL: 'return x;'
  const make = (params: number[], outWidths: number[], vLocals: string[], vBody: string[], hLocals: string[], hBody: string[]): ArithModel => ({
    params,
    outWidths,
    decl: (f) => {
      const R = outWidths.reduce((a, b) => a + b, 0);
      if (v) {
        return [
          `  function [${R - 1}:0] ${f};`,
          ...params.map((pw, i) => `    input [${pw - 1}:0] p${i};`),
          ...vLocals.map((l) => `    ${l};`),
          '    begin',
          ...vBody.map((l) => `      ${l.replace('$R', f)}`),
          '    end',
          '  endfunction',
        ];
      }
      return [
        `  function ${f}(${params.map((pw, i) => `p${i} : std_logic_vector(${pw - 1} downto 0)`).join('; ')}) return std_logic_vector is`,
        ...hLocals.map((l) => `    variable ${l};`),
        '  begin',
        ...hBody.map((l) => `    ${l}`),
        `  end function ${f};`,
      ];
    },
  });
  const sg = mode !== 'unsigned';
  switch (c.type) {
    case 'adder':
    case 'subtractor': {
      // w+1 bits: the top one is the carry, or the borrow (A - B - Bin below zero)
      const op = c.type === 'adder' ? '+' : '-';
      const r = (p: string) => `resize(unsigned(${p}), ${w + 1})`;
      return make(
        [w, w, 1],
        [w, 1],
        [`reg [${w}:0] s`],
        [`s = p0 ${op} p1 ${op} p2;`, '$R = s;'],
        [`s : ${vec(w + 1)}`],
        [`s := ${r('p0')} ${op} ${r('p1')} ${op} ${r('p2')};`, 'return std_logic_vector(s);']
      );
    }
    case 'multiplier': {
      // A * B + Cin over 2w bits (low half = product, high half = carry out); signed operands sign-extended
      const ua = mode === 'unsigned';
      const ub = mode !== 'signed';
      const [ea, eb, ec] = [ext(!ua, 'p0', W2), ext(!ub, 'p1', W2), ext(!(ua && ub), 'p2', W2)];
      return make(
        [w, w, w],
        [w, w],
        [`reg [${W2 - 1}:0] p`],
        [`p = ${ea} * ${eb} + ${ec};`, '$R = p;'],
        [`p : ${vec(W2)}`],
        [`p := resize(${ea} * ${eb}, ${W2}) + ${ec};`, 'return std_logic_vector(p);']
      );
    }
    case 'divider': {
      // (upper:A) / B and its remainder, a divisor of 0 counts as 1. Signed: divide the magnitudes, the
      // quotient negative when the signs differ, the remainder takes the dividend's sign (both truncate
      // toward zero like the simulator); an open upper half sign-extends A
      const num = v ? (sg && !hasUpper ? sx('p0', w, W2) : '{p2, p0}') : sg && !hasUpper ? sx('p0', w, W2) : 'unsigned(p2 & p0)';
      const den = ext(sg, 'p1', W2);
      const vSign = sg
        ? ['sn = n[' + (W2 - 1) + '];', `sd = d[${W2 - 1}];`, 'if (sn) n = -n;', 'if (sd) d = -d;']
        : [];
      const vFix = sg ? ['if (sn ^ sd) q = -q;', 'if (sn) r = -r;'] : [];
      const hSign = sg
        ? [`sn := n(${W2 - 1});`, `sd := d(${W2 - 1});`, "if sn = '1' then n := 0 - n; end if;", "if sd = '1' then d := 0 - d; end if;"]
        : [];
      const hFix = sg ? ["if (sn xor sd) = '1' then q := 0 - q; end if;", "if sn = '1' then r := 0 - r; end if;"] : [];
      return make(
        [w, w, w],
        [w, w],
        [`reg [${W2 - 1}:0] n, d, q, r`, ...(sg ? ['reg sn, sd'] : [])],
        [`n = ${num};`, `d = ${den};`, 'if (d == 0) d = 1;', ...vSign, 'q = n / d;', 'r = n % d;', ...vFix, `$R = {r[${w - 1}:0], q[${w - 1}:0]};`],
        [`n, d, q, r : ${vec(W2)}`, ...(sg ? ['sn, sd : std_logic'] : [])],
        [
          `n := ${num};`,
          `d := ${den};`,
          `if d = 0 then d := to_unsigned(1, ${W2}); end if;`,
          ...hSign,
          'q := n / d;',
          'r := n rem d;',
          ...hFix,
          `return std_logic_vector(r(${w - 1} downto 0)) & std_logic_vector(q(${w - 1} downto 0));`,
        ]
      );
    }
    case 'negator':
      return make([w], [w], [], ['$R = -p0;'], [], ['return std_logic_vector(0 - unsigned(p0));']);
    case 'absolute':
      // |A| (the most negative value stays itself); overflow = the result's top bit
      return make(
        [w],
        [w, 1],
        [`reg [${w - 1}:0] a`],
        [`a = p0[${w - 1}] ? -p0 : p0;`, `$R = {a[${w - 1}], a};`],
        [`a : ${vec(w)}`],
        ['a := unsigned(p0);', `if a(${w - 1}) = '1' then a := 0 - a; end if;`, `return a(${w - 1}) & std_logic_vector(a);`]
      );
    case 'comparator':
    case 'minMax': {
      // Signed: inverting both sign bits turns the signed order into the unsigned one
      const vFlip = sg ? [`x[${w - 1}] = ~x[${w - 1}];`, `y[${w - 1}] = ~y[${w - 1}];`] : [];
      const hFlip = sg ? [`x(${w - 1}) := not x(${w - 1});`, `y(${w - 1}) := not y(${w - 1});`] : [];
      if (c.type === 'comparator') {
        return make(
          [w, w],
          [1, 1, 1],
          [`reg [${w - 1}:0] x, y`],
          ['x = p0;', 'y = p1;', ...vFlip, '$R = {x < y, x == y, x > y};'],
          [`x, y : ${vec(w)}`, 'r : std_logic_vector(2 downto 0)'],
          [
            'x := unsigned(p0);',
            'y := unsigned(p1);',
            ...hFlip,
            'r := "000";',
            "if x > y then r(0) := '1'; elsif x = y then r(1) := '1'; else r(2) := '1'; end if;",
            'return r;',
          ]
        );
      }
      // Min (low part) = A when A <= B
      return make(
        [w, w],
        [w, w],
        [`reg [${w - 1}:0] x, y`],
        ['x = p0;', 'y = p1;', ...vFlip, '$R = (x <= y) ? {p1, p0} : {p0, p1};'],
        [`x, y : ${vec(w)}`],
        ['x := unsigned(p0);', 'y := unsigned(p1);', ...hFlip, 'if x <= y then return p1 & p0; else return p0 & p1; end if;']
      );
    }
    case 'shifter': {
      // Logical shifts past the width give 0, arithmetic right fills the top bit; rotations wrap a distance
      // past the width once (the distance is below 2w), numeric_std rotates modulo the length
      const s = shifterDistBits(w);
      const t = c.state.shiftType ?? 'll';
      const vBody: Record<string, string[]> = {
        ll: ['$R = p0 << p1;'],
        lr: ['$R = p0 >> p1;'],
        ar: [`k = (p1 >= ${w}) ? ${w} : p1;`, `t = {{${w}{p0[${w - 1}]}}, p0} >> k;`, `$R = t[${w - 1}:0];`],
        rl: [`k = (p1 >= ${w}) ? p1 - ${w} : p1;`, 't = {p0, p0} << k;', `$R = t[${W2 - 1}:${w}];`],
        rr: [`k = (p1 >= ${w}) ? p1 - ${w} : p1;`, 't = {p0, p0} >> k;', `$R = t[${w - 1}:0];`],
      };
      const hCall: Record<string, string> = {
        ll: 'shift_left(unsigned(p0), n)',
        lr: 'shift_right(unsigned(p0), n)',
        ar: 'shift_right(signed(p0), n)',
        rl: 'rotate_left(unsigned(p0), n)',
        rr: 'rotate_right(unsigned(p0), n)',
      };
      return make(
        [w, s],
        [w],
        t === 'll' || t === 'lr' ? [] : [`reg [${W2 - 1}:0] t`, `reg [${s}:0] k`],
        vBody[t] ?? vBody.ll,
        ['n : natural'],
        ['n := to_integer(unsigned(p1));', `return std_logic_vector(${hCall[t] ?? hCall.ll});`]
      );
    }
    case 'squareRoot':
      // Bit by bit from the top: keep each root bit whose square still fits; remainder = (upper:A) - root^2
      return make(
        [w, w],
        [w, w],
        [`reg [${W2 - 1}:0] n, r, t`, 'integer i'],
        [
          'n = {p1, p0};',
          'r = 0;',
          `for (i = ${w - 1}; i >= 0; i = i - 1) begin`,
          '  t = r | (1 << i);',
          '  if (t * t <= n) r = t;',
          'end',
          't = n - r * r;',
          `$R = {t[${w - 1}:0], r[${w - 1}:0]};`,
        ],
        [`n, r, t : ${vec(W2)}`],
        [
          'n := unsigned(p1 & p0);',
          "r := (others => '0');",
          `for i in ${w - 1} downto 0 loop`,
          '  t := r;',
          "  t(i) := '1';",
          `  if resize(t * t, ${W2}) <= n then r := t; end if;`,
          'end loop;',
          `t := n - resize(r * r, ${W2});`,
          `return std_logic_vector(t(${w - 1} downto 0)) & std_logic_vector(r(${w - 1} downto 0));`,
        ]
      );
    case 'exponentiator': {
      // Square and multiply over 2w bits (low half = result, high half = upper). Signed: A = 1 gives 1,
      // otherwise a negative exponent gives 0
      const vSpecial = sg ? [`if (p0 == 1) r = 1; else if (p1[${w - 1}]) r = 0;`] : [];
      const hSpecial = sg
        ? [`if unsigned(p0) = 1 then r := to_unsigned(1, ${W2}); elsif p1(${w - 1}) = '1' then r := (others => '0'); end if;`]
        : [];
      return make(
        [w, w],
        [w, w],
        [`reg [${W2 - 1}:0] r, b`, 'integer i'],
        [
          `b = ${ext(sg, 'p0', W2)};`,
          'r = 1;',
          `for (i = 0; i < ${w}; i = i + 1) begin`,
          '  if (p1[i]) r = r * b;',
          '  b = b * b;',
          'end',
          ...vSpecial,
          '$R = r;',
        ],
        [`r, b : ${vec(W2)}`],
        [
          `b := ${ext(sg, 'p0', W2)};`,
          `r := to_unsigned(1, ${W2});`,
          `for i in 0 to ${w - 1} loop`,
          `  if p1(i) = '1' then r := resize(r * b, ${W2}); end if;`,
          `  b := resize(b * b, ${W2});`,
          'end loop;',
          ...hSpecial,
          'return std_logic_vector(r);',
        ]
      );
    }
    case 'bitAdder': {
      // Number of 1 bits over every input
      const ow = bitAdderOutBits(w, nIn);
      const ins = Array.from({ length: nIn }, (_, j) => j);
      return make(
        ins.map(() => w),
        [ow],
        [`reg [${ow - 1}:0] s`, 'integer i'],
        ['s = 0;', `for (i = 0; i < ${w}; i = i + 1) s = s + ${ins.map((j) => `p${j}[i]`).join(' + ')};`, '$R = s;'],
        [`s : ${vec(ow)}`],
        [
          "s := (others => '0');",
          `for i in 0 to ${w - 1} loop`,
          ...ins.map((j) => `  if p${j}(i) = '1' then s := s + 1; end if;`),
          'end loop;',
          'return std_logic_vector(s);',
        ]
      );
    }
    case 'bitFinder': {
      // Index of the lowest / highest bit at the wanted value (the last match of the scan wins); none: 0, present 0
      const ow = bitFinderOutBits(w);
      const t = c.state.findType ?? 'low1';
      const want = t === 'low1' || t === 'high1' ? 1 : 0;
      const high = t === 'high1' || t === 'high0';
      return make(
        [w],
        [ow, 1],
        [`reg [${ow - 1}:0] k`, 'reg f', 'integer i'],
        [
          'k = 0;',
          'f = 0;',
          high ? `for (i = 0; i < ${w}; i = i + 1)` : `for (i = ${w - 1}; i >= 0; i = i - 1)`,
          `  if (p0[i] == 1'b${want}) begin k = i; f = 1; end`,
          '$R = {f, k};',
        ],
        [`k : ${vec(ow)}`, 'f : std_logic'],
        [
          "k := (others => '0');",
          "f := '0';",
          `for i in ${high ? `0 to ${w - 1}` : `${w - 1} downto 0`} loop`,
          `  if p0(i) = '${want}' then k := to_unsigned(i, ${ow}); f := '1'; end if;`,
          'end loop;',
          'return f & std_logic_vector(k);',
        ]
      );
    }
    case 'alu': {
      // p0 = A, p1 = B, p2 = op, p3 = carry-in; packed {V, C, N, Z, Y}. ADD / SUB over w+1 bits (the top bit
      // is the carry, or the borrow of A - B - Cin), V from the sign bits; C and V are 0 for the other operations
      const t = w - 1;
      const r = (p: string) => `resize(unsigned(${p}), ${w + 1})`;
      const vOvf = (eq: string) => `v = (p0[${t}] ${eq} p1[${t}]) && (y[${t}] != p0[${t}]);`;
      const hOvf = (eq: string) => `if p0(${t}) ${eq} p1(${t}) and y(${t}) /= p0(${t}) then v := '1'; end if;`;
      return make(
        [w, w, ALU_OP_BITS, 1],
        [w, 1, 1, 1, 1],
        [`reg [${w}:0] s`, `reg [${t}:0] y`, 'reg c, v'],
        [
          'c = 0;',
          'v = 0;',
          'case (p2)',
          `  3'd0: begin s = p0 + p1 + p3; y = s[${t}:0]; c = s[${w}]; ${vOvf('==')} end`,
          `  3'd1: begin s = p0 - p1 - p3; y = s[${t}:0]; c = s[${w}]; ${vOvf('!=')} end`,
          "  3'd2: y = p0 & p1;",
          "  3'd3: y = p0 | p1;",
          "  3'd4: y = p0 ^ p1;",
          "  3'd5: y = ~(p0 | p1);",
          "  3'd6: y = ($signed(p0) < $signed(p1)) ? 1 : 0;",
          '  default: y = p1;',
          'endcase',
          `$R = {v, c, y[${t}], y == 0, y};`,
        ],
        [`s : ${vec(w + 1)}`, `y : ${vec(w)}`, 'c, v, z : std_logic'],
        [
          "c := '0';",
          "v := '0';",
          'case p2 is',
          `  when "000" => s := ${r('p0')} + ${r('p1')} + ${r('p3')}; y := s(${t} downto 0); c := s(${w}); ${hOvf('=')}`,
          `  when "001" => s := ${r('p0')} - ${r('p1')} - ${r('p3')}; y := s(${t} downto 0); c := s(${w}); ${hOvf('/=')}`,
          '  when "010" => y := unsigned(p0 and p1);',
          '  when "011" => y := unsigned(p0 or p1);',
          '  when "100" => y := unsigned(p0 xor p1);',
          '  when "101" => y := unsigned(p0 nor p1);',
          `  when "110" => y := (others => '0'); if signed(p0) < signed(p1) then y(0) := '1'; end if;`,
          '  when others => y := unsigned(p1);',
          'end case;',
          "if y = 0 then z := '1'; else z := '0'; end if;",
          `return v & c & y(${t}) & z & std_logic_vector(y);`,
        ]
      );
    }
    default:
      return make([], [], [], [], [], []);
  }
}

// ---- VHDL expression helpers (VHDL-93 has no ?: operator) -----------------
function splitArgs(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

function extractCall(expr: string, tag: string): { before: string; args: string[]; after: string } | null {
  const at = expr.indexOf(`${tag}(`);
  if (at < 0) return null;
  let depth = 0;
  for (let i = at + tag.length; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    if (expr[i] === ')') {
      depth--;
      if (depth === 0) return { before: expr.slice(0, at), args: splitArgs(expr.slice(at + tag.length + 1, i)), after: expr.slice(i + 1) };
    }
  }
  return null;
}

// Concurrent "x <= a when sel = '1' else b" chain; nested muxes go into the else branch or are flattened
function vhdlMux(expr: string): string {
  const call = extractCall(expr, '__MUX__');
  if (!call) return expr;
  const [sel, a, b] = call.args.map((x) => x.trim());
  if (call.before.trim() || call.after.trim()) {
    // mux used inside a larger expression: rewrite as and/or form
    return vhdlMux(`${call.before}((${vhdlMuxInline(sel)} and ${vhdlMuxInline(a)}) or (not ${vhdlMuxInline(sel)} and ${vhdlMuxInline(b)}))${call.after}`);
  }
  if (sel === "'1'") return vhdlMux(a);
  if (sel === "'0'") return vhdlMux(b);
  if (b === "'Z'") return `${vhdlMuxInline(a)} when ${is1(vhdlMuxInline(sel))} else 'Z'`;
  return `${vhdlMuxInline(a)} when ${is1(vhdlMuxInline(sel))} else ${vhdlMux(b)}`;
}

function vhdlMuxInline(expr: string): string {
  let e = expr;
  for (let call = extractCall(e, '__MUX__'); call; call = extractCall(e, '__MUX__')) {
    const [sel, a, b] = call.args.map((x) => vhdlMuxInline(x.trim()));
    e = `${call.before}((${wrap(sel)} and ${wrap(a)}) or (not ${wrap(sel)} and ${wrap(b)}))${call.after}`;
  }
  return e;
}

function vhdlMuxSeq(v: string): string {
  return `@${vhdlMuxInline(v)};`;
}

function vhdlWe(v: string): string {
  const call = extractCall(v, '__WE__')!;
  const [we, d] = call.args.map((x) => x.trim());
  return `if ${is1(we)} then\n  @${d};\nend if;`;
}

function vhdlShift(v: string): string {
  const call = extractCall(v, '__SHIFT__')!;
  const [s1, s0, right, left] = call.args.map((x) => x.trim());
  return `if ${is0(s1)} and ${is1(s0)} then\n  @${right};\nelsif ${is1(s1)} and ${is0(s0)} then\n  @${left};\nend if;`;
}

// ---------------------------------------------------------------------------
// Emitters
// ---------------------------------------------------------------------------
function header(lang: Lang, title: string, standard: string): string {
  const c = lang === 'verilog' ? '//' : '--';
  return [
    `${c} =============================================================================`,
    `${c} Generated by LogicDesign Studio HDL Synthesis Engine`,
    `${c} Project: Sıfırdan İşlemciye (From Zero to CPU)`,
    `${c} ${lang === 'verilog' ? 'Module' : 'Entity'}: ${title}`,
    `${c} Date: ${new Date().toISOString()}`,
    `${c} Standard: ${standard}`,
    `${c} =============================================================================`,
  ].join('\n');
}

function renderVerilog(m: BuiltModule): string {
  const portLines = m.ports.map(
    (p) => `  ${p.dir === 'in' ? 'input' : 'output'} wire ${p.width > 1 ? `[${p.width - 1}:0] ` : ''}${p.name}`
  );
  const sigLines = m.signals.map((s) => {
    const reg = s.init !== undefined;
    const width = s.width > 1 ? `[${s.width - 1}:0] ` : '';
    const init = reg && s.init !== undefined ? ` = ${s.width}'b${s.init}` : '';
    return `  ${reg ? 'reg' : 'wire'} ${width}${s.name}${init};`;
  });
  return [
    `module ${m.name} (`,
    portLines.length > 0 ? portLines.join(',\n') : '  // Devrede harici I/O portu yok',
    ');',
    '',
    ...(m.warnings.length ? [...m.warnings.map((w) => `  // UYARI: ${w}`), ''] : []),
    ...(sigLines.length ? ['  // Dahili sinyaller', ...sigLines, ''] : []),
    ...(m.extraDecls.length ? [...m.extraDecls, ''] : []),
    ...m.body,
    '',
    'endmodule',
  ].join('\n');
}

function renderVHDL(m: BuiltModule): string {
  const portLines = m.ports.map(
    (p) => `    ${p.name} : ${p.dir} ${p.width > 1 ? `std_logic_vector(${p.width - 1} downto 0)` : 'std_logic'}`
  );
  const sigLines = m.signals.map((s) => {
    const type = s.width > 1 ? `std_logic_vector(${s.width - 1} downto 0)` : 'std_logic';
    const init = s.init !== undefined ? (s.width > 1 ? ` := "${s.init}"` : ` := '${s.init}'`) : '';
    return `  signal ${s.name} : ${type}${init};`;
  });
  return [
    'library IEEE;',
    'use IEEE.STD_LOGIC_1164.ALL;',
    'use IEEE.NUMERIC_STD.ALL;',
    '',
    `entity ${m.name} is`,
    ...(portLines.length ? ['  port (', portLines.join(';\n'), '  );'] : []),
    `end entity ${m.name};`,
    '',
    `architecture Behavioral of ${m.name} is`,
    ...m.warnings.map((w) => `  -- UYARI: ${w}`),
    ...sigLines,
    ...m.extraDecls,
    'begin',
    ...m.body,
    'end architecture Behavioral;',
  ].join('\n');
}

function generate(lang: Lang, circuitName: string, components: CircuitComponentInstance[], wires: CircuitWire[]): string {
  const moduleNames = new NameTable();
  const topName = moduleNames.make(circuitName || 'digital_circuit', 'digital_circuit');
  const subModules = new Map<string, { def: CustomSubcircuit; moduleName: string }>();
  const top = buildModule({ name: topName, components, wires }, lang, subModules, moduleNames);

  // Sub-modules (custom ICs may themselves contain ICs: keep going until no new ones appear)
  const rendered: BuiltModule[] = [];
  const done = new Set<string>();
  for (let progress = true; progress; ) {
    progress = false;
    for (const [id, sub] of Array.from(subModules.entries())) {
      if (done.has(id)) continue;
      done.add(id);
      progress = true;
      rendered.push(
        buildModule(
          { name: sub.moduleName, components: sub.def.components, wires: sub.def.wires, subPorts: sub.def.ports, subDef: sub.def },
          lang,
          subModules,
          moduleNames
        )
      );
    }
  }

  const render = lang === 'verilog' ? renderVerilog : renderVHDL;
  const std = lang === 'verilog' ? 'IEEE 1364-2001 (Verilog HDL)' : 'IEEE 1076-2008 (VHDL)';
  const parts = [header(lang, topName, std), ''];
  if (lang === 'verilog') parts.push('`timescale 1ns / 1ps', '');
  for (const m of rendered.reverse()) parts.push(render(m), '');
  parts.push(render(top), '');
  return parts.join('\n');
}

// Top-level port list exactly as generateVerilog / generateVHDL name it
export function getTopLevelPorts(circuitName: string, components: CircuitComponentInstance[], canvasWires: CircuitWire[]): PortDecl[] {
  const moduleNames = new NameTable();
  const topName = moduleNames.make(circuitName || 'digital_circuit', 'digital_circuit');
  return buildModule({ name: topName, components, wires: canvasWires }, 'verilog', new Map(), moduleNames).ports;
}

export function generateVerilog(circuitName: string, components: CircuitComponentInstance[], canvasWires: CircuitWire[]): string {
  return generate('verilog', circuitName, components, canvasWires);
}

export function generateVHDL(circuitName: string, components: CircuitComponentInstance[], canvasWires: CircuitWire[]): string {
  return generate('vhdl', circuitName, components, canvasWires);
}
