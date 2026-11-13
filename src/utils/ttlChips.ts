/**
 * 7400-series TTL chips (Logisim-evolution std/ttl, Aşama 4). Each chip is a DIP package with its real pin
 * numbering: pin 1 bottom-left, counting anticlockwise, so the last pin is top-left (notch on the left when
 * facing east). Like evolution's AbstractTtlGate:
 * - the ports are the physical pins in order, without the unused (NC) pins and without VCC / GND;
 * - with "VCC/GND pins" on, GND and VCC are two extra inputs; unless GND reads 0 and VCC reads 1 every output
 *   floats;
 * - the body is pins x 10 wide and 60 high, pins 20px apart on the top and bottom edges.
 * The chip logic is evolution's propagateTtl, written over the same port indices. Sequential chips (Aşama 4c)
 * keep their stored values and last clock levels in a TtlSeqState (evolution TtlRegisterData / ShiftRegisterData
 * + ClockState), which the engine keeps in the part's state.
 */
import type { SignalValue } from '../types/logic';
import { TTL_CHIP_IDS, type TtlChipId, type TtlType } from '../types/circuit';

export type TtlGroup = 'gates' | 'plexers' | 'arith' | 'sequential' | 'drivers';

export const TTL_GROUP_TITLES: Record<TtlGroup, string> = {
  gates: 'TTL: Kapılar',
  plexers: 'TTL: Kod Çözücü / Seçici',
  arith: 'TTL: Aritmetik / Karşılaştırıcı',
  sequential: 'TTL: Flip-Flop / Sayaç / Yazmaç',
  drivers: 'TTL: Tampon / Sürücü',
};

/** Stored values and last clock levels of a sequential chip (both start at 0 like evolution's) */
export interface TtlSeqState {
  v: SignalValue[];
  clk: SignalValue[];
  /**
   * The previous evaluation had no power, so the outputs still float (evolution's 74164 reads its own output
   * pins when it shifts: on the first powered evaluation they read unknown)
   */
  off?: boolean;
}

/**
 * Port values in evolution's port order; the chip returns the values of the output ports it sets. A sequential
 * chip also gets its state, which it updates in place.
 */
export type TtlEval = (p: SignalValue[], st: TtlSeqState) => (SignalValue | undefined)[];

export interface TtlChip {
  /** Evolution tool id, also the .circ element name ("7400") */
  id: TtlChipId;
  pins: number;
  /** Output pins (physical numbers) */
  out: number[];
  /** Not connected pins */
  unused?: number[];
  vcc: number;
  gnd: number;
  /** Port names in port order (datasheet names) */
  names: string[];
  /** Short title, e.g. "Dörtlü 2 girişli NAND" */
  title: string;
  description: string;
  group: TtlGroup;
  /** Package height (evolution's height argument); unset = 60 */
  height?: number;
  /** Open-collector outputs: they pull low or float, never drive 1 */
  openCollector?: boolean;
  /** Some outputs float (Z) for defined inputs: tri-state enables, an open-collector pin (74181 A=B) */
  triState?: boolean;
  /**
   * In/out pins (evolution Port.INOUT, e.g. 7447 BI/RBO): the chip may drive them and reads back the net, so
   * the part has an output (key p<n>) and an input (key p<n>in) on the same point
   */
  inout?: number[];
  /** Pins with a built-in pull-up (evolution setPullPorts): an undriven net there reads 1 */
  pullUp?: number[];
  /** Short labels for the "internal structure" view, port order (default: names) */
  labels?: string[];
  /** Sequential chip: number of stored values and of clock inputs; `init` = power-up values (default all 0) */
  seq?: { v: number; clk: number; init?: SignalValue[] };
  eval: TtlEval;
}

// ---- Logisim Value rules for one bit (Value.and / or / not / xor) ----------------------------------------
const lvl = (v: SignalValue): v is 0 | 1 => v === 0 || v === 1;
const not = (a: SignalValue): SignalValue => (lvl(a) ? (a === 1 ? 0 : 1) : 'E');
const and = (...xs: SignalValue[]): SignalValue => xs.reduce((a, b) => (a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 'E'));
const or = (...xs: SignalValue[]): SignalValue => xs.reduce((a, b) => (a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 'E'));
const xor = (a: SignalValue, b: SignalValue): SignalValue => (lvl(a) && lvl(b) ? ((a ^ b) as 0 | 1) : 'E');
const nand = (...xs: SignalValue[]) => not(and(...xs));
const nor = (...xs: SignalValue[]) => not(or(...xs));
const buf = (a: SignalValue): SignalValue => a;
/** Evolution's floating output (Value.UNKNOWN) */
const FLOAT: SignalValue = 'Z';

type Op2 = (a: SignalValue, b: SignalValue) => SignalValue;
type Op1 = (a: SignalValue) => SignalValue;

const QUAD_NAMES = ['1A', '1B', '1Y', '2A', '2B', '2Y', '3Y', '3A', '3B', '4Y', '4A', '4B'];
const HEX_NAMES = ['1A', '1Y', '2A', '2Y', '3A', '3Y', '4Y', '4A', '5Y', '5A', '6Y', '6A'];

interface Info {
  title: string;
  description: string;
}

/** Quad 2-input gate, outputs on pins 3, 6, 8, 11 (7400 pinout) */
function quad(id: TtlChipId, op: Op2, info: Info, extra: Partial<TtlChip> = {}): TtlChip {
  return {
    id, pins: 14, out: [3, 6, 8, 11], vcc: 14, gnd: 7, names: QUAD_NAMES, group: 'gates', ...info, ...extra,
    eval: (p) => {
      const o: SignalValue[] = [];
      for (const i of [2, 5]) o[i] = op(p[i - 1], p[i - 2]);
      for (const i of [6, 9]) o[i] = op(p[i + 1], p[i + 2]);
      return o;
    },
  };
}

/** Hex 1-input gate, outputs on pins 2, 4, 6, 8, 10, 12 (7404 pinout) */
function hex(id: TtlChipId, op: Op1, info: Info, extra: Partial<TtlChip> = {}): TtlChip {
  return {
    id, pins: 14, out: [2, 4, 6, 8, 10, 12], vcc: 14, gnd: 7, names: HEX_NAMES, group: 'gates', ...info, ...extra,
    eval: (p) => {
      const o: SignalValue[] = [];
      for (const i of [1, 3, 5]) o[i] = op(p[i - 1]);
      for (const i of [6, 8, 10]) o[i] = op(p[i + 1]);
      return o;
    },
  };
}

/** Triple 3-input gate (7410 pinout: 1Y on pin 12, 2Y pin 6, 3Y pin 8) */
function triple(id: TtlChipId, op: (...xs: SignalValue[]) => SignalValue, info: Info): TtlChip {
  return {
    id, pins: 14, out: [6, 8, 12], vcc: 14, gnd: 7, group: 'gates', ...info,
    names: ['1A', '1B', '2A', '2B', '2C', '2Y', '3Y', '3A', '3B', '3C', '1Y', '1C'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = op(p[2], p[3], p[4]);
      o[10] = op(p[0], p[1], p[11]);
      o[6] = op(p[7], p[8], p[9]);
      return o;
    },
  };
}

/** Dual 4-input gate (7420 pinout, pins 3 and 11 not connected) */
function dual4(id: TtlChipId, op: (...xs: SignalValue[]) => SignalValue, info: Info): TtlChip {
  return {
    id, pins: 14, out: [6, 8], unused: [3, 11], vcc: 14, gnd: 7, group: 'gates', ...info,
    names: ['1A', '1B', '1C', '1D', '1Y', '2Y', '2A', '2B', '2C', '2D'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[4] = op(p[0], p[1], p[2], p[3]);
      o[5] = op(p[6], p[7], p[8], p[9]);
      return o;
    },
  };
}

/** Evolution 7405 / 74266: pulls low, releases (floats) for a high, E for an undefined value */
const ocLow = (high: SignalValue): SignalValue => (high === 1 ? FLOAT : high === 0 ? 0 : 'E');

// ---- MSI chips (Aşama 4b): written over physical pin numbers like evolution's pinNrToPortNr helpers ------

type PinGet = (pin: number) => SignalValue;
type PinSet = (pin: number, v: SignalValue) => void;
type MsiDef = Omit<TtlChip, 'eval' | 'group'> & { group?: TtlGroup };

/** A chip whose logic reads / writes physical pins; the pin -> port index map skips NC and power pins */
function msi(def: MsiDef, logic: (g: PinGet, s: PinSet, st: TtlSeqState) => void): TtlChip {
  const idx = new Map<number, number>();
  let k = 0;
  for (let pin = 1; pin <= def.pins; pin++) {
    if (def.unused?.includes(pin) || pin === def.vcc || pin === def.gnd) continue;
    idx.set(pin, k++);
  }
  return {
    group: 'plexers',
    ...def,
    eval: (p, st) => {
      const o: SignalValue[] = [];
      logic((pin) => p[idx.get(pin)!], (pin, v) => { o[idx.get(pin)!] = v; }, st);
      return o;
    },
  };
}

/** Evolution's `getPortValue(..) == Value.TRUE` (x, floating and E all read as false) */
const hi = (v: SignalValue) => v === 1;
/** Evolution's `== Value.FALSE` */
const lo = (v: SignalValue) => v === 0;
const lvlOf = (b: boolean): SignalValue => (b ? 1 : 0);
/** Evolution Value.UNKNOWN: an open input or a floating net (E is Value.ERROR) */
const unknown = (v: SignalValue) => v === 'X' || v === 'Z';

/**
 * Evolution ClockState.updateClock: stores the new level of clock `i` and tells whether it was an edge (a clean
 * 0 -> 1 step, or 1 -> 0 for a falling edge; the stored level starts at 0)
 */
function clockEdge(st: TtlSeqState, i: number, clk: SignalValue, falling = false): boolean {
  const old = st.clk[i] ?? 0;
  st.clk[i] = clk;
  return falling ? old === 1 && clk === 0 : old === 0 && clk === 1;
}

/** A stored value on an output pin: evolution drives an unknown value as floating, 0 / 1 / E as they are */
const drive = (v: SignalValue): SignalValue => (unknown(v) ? FLOAT : v);
/** Evolution Value.toLongValue of one bit: 0 / 1, anything else -1 */
const toLong = (v: SignalValue): number => (v === 0 ? 0 : v === 1 ? 1 : -1);

/** Evolution Value identity of one bit: x and floating are both Value.UNKNOWN */
const same = (a: SignalValue, b: SignalValue) => a === b || (unknown(a) && unknown(b));

/**
 * Evolution's pal32L1 (74181 / 74381): an active-low sum of products; bit j of a product picks in[j]
 */
function pal(ins: boolean[], products: number[]): boolean {
  const any = products.some((p) => ins.every((v, j) => !(p & (1 << j)) || v));
  return !any;
}

/**
 * Evolution Ttl74190's Choice: `f` maps a bit mask of the sources (bit i = source i) to a `width`-bit result.
 * Every mask the sources allow is tried (0 / 1 pin the bit; x, floating and E allow both); a result bit that
 * differs between them reads 'X', or 'E' when a source is E.
 */
function choose(src: SignalValue[], width: number, f: (mask: number) => number): SignalValue[] {
  const free = src.flatMap((v, i) => (lvl(v) ? [] : [i]));
  const base = src.reduce<number>((m, v, i) => (v === 1 ? m | (1 << i) : m), 0);
  const err = src.includes('E');
  let first = -1;
  let diff = 0;
  for (let k = 0; k < 1 << free.length; k++) {
    let mask = base;
    free.forEach((i, j) => {
      if ((k >> j) & 1) mask |= 1 << i;
    });
    const r = f(mask);
    if (first < 0) first = r;
    else diff |= r ^ first;
  }
  return Array.from({ length: width }, (_, i) => ((diff >> i) & 1 ? (err ? 'E' : 'X') : (((first >> i) & 1) as 0 | 1)));
}

/** Evolution Ttl74190 COUNT_UP / COUNT_DOWN: the next BCD code (codes 10-15 as the real chip leaves them) */
export const COUNT_UP_190 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 9, 4, 9, 0, 9, 0];
export const COUNT_DOWN_190 = [9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 3, 4, 5, 6];

/** Evolution 74393 / 744060 nextCount: +1 of a binary word; an E bit makes it all E, an unknown bit all unknown */
function countUp(bits: SignalValue[]): SignalValue[] {
  if (bits.includes('E')) return bits.map(() => 'E');
  if (!bits.every(lvl)) return bits.map(() => 'X');
  const n = bits.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0) + 1;
  return bits.map((_, i) => ((n >> i) & 1) as 0 | 1);
}

/**
 * 74192 / 74193 (evolution Ttl74192, UpDownCounterData): counts on a rising UP / DOWN while the other input
 * stays 1 (both compared with their values at the previous evaluation); CO' / BO' go low on the falling edge at
 * the end value / 0 and stay until the next action. v = Q0..Q3, CO', BO' (CO' / BO' start at 1); clk = DOWN, UP.
 */
function upDown(id: TtlChipId, max: number, title: string, description: string): TtlChip {
  return msi({
    id, pins: 16, out: [2, 3, 6, 7, 12, 13], vcc: 16, gnd: 8, group: 'sequential',
    seq: { v: 6, clk: 2, init: [0, 0, 0, 0, 1, 1] },
    title,
    description,
    names: ['B', 'QB', 'QA', 'DOWN', 'UP', 'QC', 'QD', 'D', 'C', 'LOAD\'', 'CO\'', 'BO\'', 'CLR', 'A'],
    labels: ['B', 'QB', 'QA', 'DN', 'UP', 'QC', 'QD', 'D', 'C', 'LD', 'CO', 'BO', 'CLR', 'A'],
  }, (g, s, st) => {
    const [downPrev, upPrev] = st.clk;
    const [down, up] = [g(4), g(5)];
    const downHeld = downPrev === 1 && down === 1;
    const upHeld = upPrev === 1 && up === 1;
    let n = st.v.slice(0, 4).reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0);
    let carry: SignalValue = 1;
    let borrow: SignalValue = 1;
    if (hi(g(14))) n = 0;
    else if (lo(g(11))) {
      const x = toLong(g(15)) + (toLong(g(1)) << 1) + (toLong(g(10)) << 2) + (toLong(g(9)) << 3);
      n = x > max ? 0 : x;
    } else if (downPrev === 0 && down === 1 && upHeld) n = n === 0 ? max : n - 1;
    else if (upPrev === 0 && up === 1 && downHeld) n = n + 1 > max ? 0 : n + 1;
    else if (upPrev === 1 && up === 0 && downHeld) {
      if (n === max) carry = 0;
    } else if (downPrev === 1 && down === 0 && upHeld) {
      if (n === 0) borrow = 0;
    } else {
      carry = st.v[4];
      borrow = st.v[5];
    }
    n &= 15;
    st.clk = [down, up];
    st.v = [...[0, 1, 2, 3].map((i) => ((n >> i) & 1) as 0 | 1), carry, borrow];
    [3, 2, 6, 7].forEach((pin, i) => s(pin, st.v[i]));
    s(12, carry);
    s(13, borrow);
  });
}

/** Evolution Ttl74107 complement: unlike Value.not, an unknown bit stays unknown (E stays E) */
const complement = (v: SignalValue): SignalValue => (v === 1 ? 0 : v === 0 ? 1 : v === 'E' ? 'E' : 'X');

/** 74273 / 74374 / 74377 D and Q pins, bit 0 = D1 / Q1 */
const OCTAL_D = [3, 4, 7, 8, 13, 14, 17, 18];
const OCTAL_Q = [2, 5, 6, 9, 12, 15, 16, 19];

/**
 * 74273 / 74377 (evolution AbstractOctalFlops, 80 high): the clock is sampled first; pin 1 is CLR' (74273, clears
 * while 0) or E' (74377, the edge loads only while it is 0)
 */
function octalFlops(id: TtlChipId, enable: boolean, title: string, description: string) {
  const first = enable ? 'E\'' : 'CLR\'';
  return msi({
    id, pins: 20, out: OCTAL_Q, vcc: 20, gnd: 10, group: 'sequential', seq: { v: 8, clk: 1 }, height: 80, title, description,
    names: [first, 'Q1', 'D1', 'D2', 'Q2', 'Q3', 'D3', 'D4', 'Q4', 'CLK', 'Q5', 'D5', 'D6', 'Q6', 'Q7', 'D7', 'D8', 'Q8'],
    labels: [enable ? 'E' : 'CLR', 'Q1', 'D1', 'D2', 'Q2', 'Q3', 'D3', 'D4', 'Q4', 'CK', 'Q5', 'D5', 'D6', 'Q6', 'Q7', 'D7', 'D8', 'Q8'],
  }, (g, s, st) => {
    const triggered = clockEdge(st, 0, g(11));
    if (enable) {
      if (triggered && lo(g(1))) st.v = OCTAL_D.map(g);
    } else if (lo(g(1))) st.v = Array<SignalValue>(8).fill(0);
    else if (triggered) st.v = OCTAL_D.map(g);
    OCTAL_Q.forEach((pin, i) => s(pin, drive(st.v[i])));
  });
}

/**
 * 74594 / 74595 (evolution Ttl74594 / Ttl74595): QB..QH 1..7, QH' 9, SRCLR' 10, SRCLK 11, RCLK 12, pin 13 = RCLR'
 * (74594) or OE' (74595), SER 14, QA 15. Both clocks are sampled first; a store edge together with a shift edge
 * copies the stages from before the shift. v[0..7] = shift stages QA..QH, v[8..15] = the output register.
 */
function shiftStore(id: TtlChipId, oe: boolean, title: string, description: string) {
  const ctl = oe ? 'OE\'' : 'RCLR\'';
  return msi({
    id, pins: 16, out: [1, 2, 3, 4, 5, 6, 7, 9, 15], vcc: 16, gnd: 8, group: 'sequential', triState: oe || undefined,
    seq: { v: 16, clk: 2 }, title, description,
    names: ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'QH\'', 'SRCLR\'', 'SRCLK', 'RCLK', ctl, 'SER', 'QA'],
    labels: ['QB', 'QC', 'QD', 'QE', 'QF', 'QG', 'QH', 'QH\'', 'SCLR', 'SCK', 'RCK', oe ? 'OE' : 'RCLR', 'SER', 'QA'],
  }, (g, s, st) => {
    const shiftEdge = clockEdge(st, 0, g(11));
    const storeEdge = clockEdge(st, 1, g(12));
    const cleared = lo(g(10));
    const before = st.v.slice(0, 8);
    if (cleared) st.v.fill(0, 0, 8);
    else if (shiftEdge) st.v.splice(0, 8, g(14), ...before.slice(0, 7));
    if (!oe && lo(g(13))) st.v.fill(0, 8, 16);
    else if (storeEdge) st.v.splice(8, 8, ...(shiftEdge && !cleared ? before : st.v.slice(0, 8)));
    const enabled = !oe || lo(g(13));
    [15, 1, 2, 3, 4, 5, 6, 7].forEach((pin, i) => s(pin, enabled ? drive(st.v[8 + i]) : FLOAT));
    s(9, drive(st.v[7]));
  });
}

/** 7442 / 7443 / 7444: BCD (excess-3, excess-3 Gray) -> one of ten active-low outputs */
function decimalDecoder(id: TtlChipId, title: string, description: string, code: (d: number) => number) {
  return msi({
    id, pins: 16, out: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11], vcc: 16, gnd: 8, title, description,
    names: ['Y0\'', 'Y1\'', 'Y2\'', 'Y3\'', 'Y4\'', 'Y5\'', 'Y6\'', 'Y7\'', 'Y8\'', 'Y9\'', 'A3', 'A2', 'A1', 'A0'],
    labels: ['Y0', 'Y1', 'Y2', 'Y3', 'Y4', 'Y5', 'Y6', 'Y7', 'Y8', 'Y9', 'A3', 'A2', 'A1', 'A0'],
  }, (g, s) => {
    // Evolution Ttl7442: any x / floating / E address bit leaves every output floating
    const bits = [15, 14, 13, 12].map(g);
    const outs = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11];
    if (bits.some((b) => !lvl(b))) return outs.forEach((pin) => s(pin, FLOAT));
    const n = code(bits.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0));
    outs.forEach((pin, k) => s(pin, lvlOf(n !== k)));
  });
}

/** 74240 / 74241 / 74244 pin pairs (A -> Y): channel 1 enabled by pin 1, channel 2 by pin 19 */
const OCTAL_CH1 = [[2, 18], [4, 16], [6, 14], [8, 12]];
const OCTAL_CH2 = [[11, 9], [13, 7], [15, 5], [17, 3]];
/** Evolution AbstractOctalBuffers: a channel is off only while its enable reads exactly its inactive level */
function octalBuffer(id: TtlChipId, invert: boolean, en2High: boolean, title: string, description: string) {
  const y = invert ? 'Y\'' : 'Y';
  return msi({
    id, pins: 20, out: [3, 5, 7, 9, 12, 14, 16, 18], vcc: 20, gnd: 10, group: 'drivers', triState: true, title, description,
    names: [
      '1OE\'', '1A1', `2${y}4`, '1A2', `2${y}3`, '1A3', `2${y}2`, '1A4', `2${y}1`,
      '2A1', `1${y}4`, '2A2', `1${y}3`, '2A3', `1${y}2`, '2A4', `1${y}1`, en2High ? '2OE' : '2OE\'',
    ],
    labels: ['1OE', '1A1', '2Y4', '1A2', '2Y3', '1A3', '2Y2', '1A4', '2Y1', '2A1', '1Y4', '2A2', '1Y3', '2A3', '1Y2', '2A4', '1Y1', '2OE'],
  }, (g, s) => {
    const channel = (en: number, off: SignalValue, pairs: number[][]) => {
      const disabled = g(en) === off;
      for (const [a, o] of pairs) s(o, disabled ? FLOAT : invert ? not(g(a)) : g(a));
    };
    channel(1, 1, OCTAL_CH1);
    channel(19, en2High ? 0 : 1, OCTAL_CH2);
  });
}

/** 74245 / 74640 bus pins: A1..A8 on 2..9, B1..B8 on 18..11 */
const BUS_A = [2, 3, 4, 5, 6, 7, 8, 9];
const BUS_B = [18, 17, 16, 15, 14, 13, 12, 11];
const TRANSCEIVER_NAMES = ['DIR', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'B8', 'B7', 'B6', 'B5', 'B4', 'B3', 'B2', 'B1', 'OE\''];
const TRANSCEIVER_LABELS = [...TRANSCEIVER_NAMES.slice(0, 17), 'OE'];

/** Evolution DisplayDecoder.computeDisplayDecoderOutputs: segments a..g per digit, 1 = segment output high (off) */
const SEG7_OFF = [
  '0000001', '1001111', '0010010', '0000110', '1001100', '0100100', '1100000', '0001111',
  '0000000', '0001100', '1110010', '1100110', '1011100', '0110100', '1110000', '1111111',
];

const CHIPS: TtlChip[] = [
  quad('7400', nand, { title: 'Dörtlü 2 girişli NAND', description: 'Dört adet 2 girişli VE DEĞİL kapısı.' }),
  {
    id: '7402', pins: 14, out: [1, 4, 10, 13], vcc: 14, gnd: 7, group: 'gates',
    title: 'Dörtlü 2 girişli NOR', description: 'Dört adet 2 girişli VEYA DEĞİL kapısı; çıkışlar 1, 4, 10, 13 numaralı bacaklarda.',
    names: ['1Y', '1A', '1B', '2Y', '2A', '2B', '3A', '3B', '3Y', '4A', '4B', '4Y'],
    eval: (p) => {
      const o: SignalValue[] = [];
      for (const i of [0, 3]) o[i] = nor(p[i + 1], p[i + 2]);
      for (const i of [8, 11]) o[i] = nor(p[i - 1], p[i - 2]);
      return o;
    },
  },
  hex('7404', not, { title: 'Altılı DEĞİL (evirici)', description: 'Altı adet evirici.' }),
  // Evolution openDrain(input): 1 pulls low, 0 floats, anything else E
  hex('7405', (a) => ocLow(not(a)), {
    title: 'Altılı açık kollektörlü evirici',
    description: 'Altı adet açık kollektörlü evirici: giriş 1 iken çıkışı 0\'a çeker, giriş 0 iken çıkış boşta kalır (pull-up direnci gerekir).',
  }, { openCollector: true }),
  quad('7408', (a, b) => and(a, b), { title: 'Dörtlü 2 girişli AND', description: 'Dört adet 2 girişli VE kapısı.' }),
  triple('7410', nand, { title: 'Üçlü 3 girişli NAND', description: 'Üç adet 3 girişli VE DEĞİL kapısı.' }),
  triple('7411', and, { title: 'Üçlü 3 girişli AND', description: 'Üç adet 3 girişli VE kapısı.' }),
  dual4('7413', nand, { title: 'Çift 4 girişli Schmitt NAND', description: 'İki adet 4 girişli Schmitt tetiklemeli VE DEĞİL kapısı (mantık olarak 7420 ile aynı).' }),
  hex('7414', not, { title: 'Altılı Schmitt evirici', description: 'Altı adet Schmitt tetiklemeli evirici (mantık olarak 7404 ile aynı).' }),
  dual4('7418', nand, { title: 'Çift 4 girişli Schmitt NAND', description: 'İki adet 4 girişli Schmitt tetiklemeli VE DEĞİL kapısı.' }),
  hex('7419', not, { title: 'Altılı Schmitt evirici', description: 'Altı adet Schmitt tetiklemeli evirici.' }),
  dual4('7420', nand, { title: 'Çift 4 girişli NAND', description: 'İki adet 4 girişli VE DEĞİL kapısı; 3 ve 11 numaralı bacaklar boş.' }),
  dual4('7421', and, { title: 'Çift 4 girişli AND', description: 'İki adet 4 girişli VE kapısı; 3 ve 11 numaralı bacaklar boş.' }),
  quad('7424', nand, { title: 'Dörtlü 2 girişli Schmitt NAND', description: 'Dört adet 2 girişli Schmitt tetiklemeli VE DEĞİL kapısı.' }),
  triple('7427', nor, { title: 'Üçlü 3 girişli NOR', description: 'Üç adet 3 girişli VEYA DEĞİL kapısı.' }),
  {
    id: '7430', pins: 14, out: [8], unused: [9, 10, 13], vcc: 14, gnd: 7, group: 'gates',
    title: '8 girişli NAND', description: 'Tek bir 8 girişli VE DEĞİL kapısı; 9, 10 ve 13 numaralı bacaklar boş.',
    names: ['A', 'B', 'C', 'D', 'E', 'F', 'Y', 'G', 'H'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[6] = not(and(and(p[0], p[1], p[2], p[3]), and(p[4], p[5], p[7], p[8])));
      return o;
    },
  },
  quad('7432', (a, b) => or(a, b), { title: 'Dörtlü 2 girişli OR', description: 'Dört adet 2 girişli VEYA kapısı.' }),
  hex('7434', buf, { title: 'Altılı tampon', description: 'Altı adet tampon (girişi aynen çıkışa verir).' }),
  quad('7436', nor, { title: 'Dörtlü 2 girişli NOR', description: 'Dört adet 2 girişli VEYA DEĞİL kapısı, 7400 bacak dizilimiyle.' }),
  {
    ...quad('7438', nand, {
      title: 'Dörtlü 2 girişli açık kollektörlü NAND',
      description: 'Dört adet açık kollektörlü VE DEĞİL tamponu: iki giriş de 1 iken çıkışı 0\'a çeker, aksi halde çıkış boşta kalır (pull-up gerekir).',
    }),
    openCollector: true,
    // Evolution reads each input as "is it 1", so an undefined input counts as 0 (the output floats)
    eval: (p) => {
      const o: SignalValue[] = [];
      const gate = (a: SignalValue, b: SignalValue) => (a === 1 && b === 1 ? 0 : FLOAT);
      for (const i of [2, 5]) o[i] = gate(p[i - 2], p[i - 1]);
      for (const i of [6, 9]) o[i] = gate(p[i + 1], p[i + 2]);
      return o;
    },
  },
  {
    id: '7451', pins: 14, out: [6, 8], unused: [11, 12], vcc: 14, gnd: 7, group: 'gates',
    title: 'Çift 2-2 girişli AND-OR-DEĞİL', description: 'İki adet VE-VEYA-DEĞİL (AOI) kapısı: Y = (A·B + C·D)\'.',
    names: ['1A', '2A', '2B', '2C', '2D', '2Y', '1Y', '1C', '1D', '1B'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = nor(and(p[1], p[2]), and(p[3], p[4]));
      o[6] = nor(and(p[0], p[9]), and(p[7], p[8]));
      return o;
    },
  },
  {
    id: '7454', pins: 14, out: [8], unused: [6, 11, 12], vcc: 14, gnd: 7, group: 'gates',
    title: '4 gruplu AND-OR-DEĞİL', description: 'Dört adet 2 girişli VE grubunun VEYA DEĞİL\'i: Y = (A·B + C·D + E·F + G·H)\'.',
    names: ['A', 'C', 'D', 'E', 'F', 'Y', 'G', 'H', 'B'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = nor(and(p[0], p[8]), and(p[1], p[2]), and(p[3], p[4]), and(p[6], p[7]));
      return o;
    },
  },
  {
    id: '7458', pins: 14, out: [6, 8], vcc: 14, gnd: 7, group: 'gates',
    title: 'Çift AND-OR', description: 'İki adet VE-VEYA kapısı: 2Y = 2A·2B + 2C·2D, 1Y = 1A·1B·1C + 1D·1E·1F.',
    names: ['1A', '2A', '2B', '2C', '2D', '2Y', '1Y', '1D', '1E', '1F', '1B', '1C'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = or(and(p[1], p[2]), and(p[3], p[4]));
      o[6] = or(and(p[0], p[11], p[10]), and(p[9], p[8], p[7]));
      return o;
    },
  },
  {
    id: '7464', pins: 14, out: [8], vcc: 14, gnd: 7, group: 'gates', height: 70,
    title: '4-2-3-2 girişli AND-OR-DEĞİL', description: 'Dört VE grubunun (2, 3, 2 ve 4 girişli) VEYA DEĞİL\'i.',
    names: ['A', 'E', 'F', 'G', 'H', 'I', 'Y', 'J', 'K', 'B', 'C', 'D'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[6] = nor(and(p[1], p[2]), and(p[3], p[4], p[5]), and(p[7], p[8]), and(p[9], p[10], p[11], p[0]));
      return o;
    },
  },
  quad('7486', xor, { title: 'Dörtlü 2 girişli XOR', description: 'Dört adet 2 girişli ÖZEL VEYA kapısı.' }),
  {
    id: '7487', pins: 14, out: [3, 6, 9, 12], unused: [4, 11], vcc: 14, gnd: 7, group: 'gates',
    title: '4 bit doğru/tümleyen, 0/1 birimi',
    description: 'B = 1 iken dört çıkış da C\'nin tersi; B = 0, C = 1 iken Y = A; B = 0, C = 0 iken Y = A\'nın tersi.',
    names: ['C', 'A1', 'Y1', 'A2', 'Y2', 'B', 'Y3', 'A3', 'Y4', 'A4'],
    eval: (p) => {
      const o: SignalValue[] = [];
      const ys = [2, 4, 6, 8];
      const as = [1, 3, 7, 9];
      const b = p[5];
      const c = p[0];
      ys.forEach((y, k) => {
        if (b === 1) o[y] = not(c);
        else if (b === 0) o[y] = c === 1 ? p[as[k]] : c === 0 ? not(p[as[k]]) : 'E';
        else o[y] = 'E';
      });
      return o;
    },
  },
  quad('74132', nand, { title: 'Dörtlü 2 girişli Schmitt NAND', description: 'Dört adet 2 girişli Schmitt tetiklemeli VE DEĞİL kapısı.' }),
  {
    ...quad('74266', xor, {
      title: 'Dörtlü 2 girişli açık kollektörlü XNOR',
      description: 'Dört adet açık kollektörlü ÖZEL VEYA DEĞİL kapısı: girişler eşitse çıkış boşta kalır, farklıysa 0\'a çeker (pull-up gerekir).',
    }),
    openCollector: true,
    // Evolution: XNOR true floats, anything else (also E) pulls low
    eval: (p) => {
      const o: SignalValue[] = [];
      const gate = (a: SignalValue, b: SignalValue) => (not(xor(a, b)) === 1 ? FLOAT : 0);
      for (const i of [2, 5]) o[i] = gate(p[i - 1], p[i - 2]);
      for (const i of [6, 9]) o[i] = gate(p[i + 1], p[i + 2]);
      return o;
    },
  },

  // ---- 4b: combinational MSI ----------------------------------------------------------------------------
  msi({
    id: '7447', pins: 16, out: [9, 10, 11, 12, 13, 14, 15], inout: [4], pullUp: [4], vcc: 16, gnd: 8,
    title: 'BCD → 7 parça kod çözücü/sürücü',
    description:
      'DCBA girişindeki BCD sayıyı ortak anotlu 7 parçalı gösterge için aktif-düşük a..g çıkışlarına çevirir (10-15 Logisim\'deki özel şekiller). '
      + 'LT\' = 0 tüm parçaları yakar; BI\'/RBO\' (4. bacak, iç pull-up\'lı) dışarıdan 0 yapılırsa göstergeyi söndürür, '
      + 'RBI\' = 0 iken giriş 0 ise göstergeyi söndürüp RBO\' bacağını 0\'a çeker (baştaki sıfırları silme zinciri).',
    names: ['B', 'C', 'LT\'', 'BI\'/RBO\'', 'RBI\'', 'D', 'A', 'e', 'd', 'c', 'b', 'a', 'g', 'f'],
    labels: ['B', 'C', 'LT', 'BI', 'RBI', 'D', 'A', 'e', 'd', 'c', 'b', 'a', 'g', 'f'],
  }, (g, s) => {
    // Evolution Ttl7447.propagateTtl + DisplayDecoder (x / floating digit bit -> no digit, E reads as 0)
    const bits = [7, 1, 2, 6].map(g);
    const digit = bits.some(unknown) ? -1 : bits.reduce<number>((n, v, i) => n | (hi(v) ? 1 << i : 0), 0);
    const blankZero = lo(g(5)) && digit === 0;
    let shown = digit;
    if (lo(g(4))) shown = 15;
    else if (lo(g(3))) shown = 8;
    else if (lo(g(5)) && shown === 0) shown = 15;
    [13, 12, 11, 10, 9, 15, 14].forEach((pin, k) => s(pin, shown < 0 ? FLOAT : SEG7_OFF[shown][k] === '1' ? 1 : 0));
    s(4, blankZero && !lo(g(3)) ? 0 : FLOAT);
  }),
  msi({
    id: '7485', pins: 16, out: [5, 6, 7], vcc: 16, gnd: 8, group: 'arith',
    title: '4 bit büyüklük karşılaştırıcı',
    description:
      'A3..A0 ile B3..B0\'ı karşılaştırır; A>B, A=B, A<B çıkışları. Sayılar eşitse sonuç kademe girişlerinden gelir '
      + '(tek çip için I(A=B) girişi 1, diğerleri 0 bağlanır; birden fazla çip zincirlenirken alt çipin çıkışları üstteki çipin kademe girişlerine gider).',
    names: ['B3', 'I(A<B)', 'I(A=B)', 'I(A>B)', 'A>B', 'A=B', 'A<B', 'B0', 'A0', 'B1', 'A1', 'A2', 'B2', 'A3'],
    labels: ['B3', 'I<', 'I=', 'I>', 'A>B', 'A=B', 'A<B', 'B0', 'A0', 'B1', 'A1', 'A2', 'B2', 'A3'],
  }, (g, s) => {
    // Evolution Ttl7485: every input reads as "is it 1"
    const num = (pins: number[]) => pins.reduce((n, pin, i) => n | (hi(g(pin)) ? 1 << i : 0), 0);
    const a = num([10, 12, 13, 15]);
    const b = num([9, 11, 14, 1]);
    let r: [boolean, boolean, boolean];
    if (a > b) r = [true, false, false];
    else if (a < b) r = [false, false, true];
    else if (hi(g(3))) r = [false, true, false];
    else if (hi(g(2)) && hi(g(4))) r = [false, false, false];
    else if (hi(g(2))) r = [false, false, true];
    else if (hi(g(4))) r = [true, false, false];
    else r = [true, false, true];
    s(5, lvlOf(r[0]));
    s(6, lvlOf(r[1]));
    s(7, lvlOf(r[2]));
  }),
  msi({
    id: '74138', pins: 16, out: [7, 9, 10, 11, 12, 13, 14, 15], vcc: 16, gnd: 8,
    title: '3 → 8 kod çözücü (aktif-düşük)',
    description:
      'A2 A1 A0 adresine göre Y0\'..Y7\' çıkışlarından yalnız biri 0 olur. Çip ancak E3 = 1, E1\' = 0, E2\' = 0 iken çalışır; '
      + 'aksi halde tüm çıkışlar 1.',
    names: ['A0', 'A1', 'A2', 'E1\'', 'E2\'', 'E3', 'Y7\'', 'Y6\'', 'Y5\'', 'Y4\'', 'Y3\'', 'Y2\'', 'Y1\'', 'Y0\''],
    labels: ['A0', 'A1', 'A2', 'E1', 'E2', 'E3', 'Y7', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'Y0'],
  }, (g, s) => {
    const en = hi(g(6)) && lo(g(4)) && lo(g(5));
    const sel = (hi(g(1)) ? 1 : 0) + (hi(g(2)) ? 2 : 0) + (hi(g(3)) ? 4 : 0);
    [15, 14, 13, 12, 11, 10, 9, 7].forEach((pin, i) => s(pin, lvlOf(!(en && i === sel))));
  }),
  msi({
    id: '74139', pins: 16, out: [4, 5, 6, 7, 9, 10, 11, 12], vcc: 16, gnd: 8,
    title: 'Çift 2 → 4 kod çözücü (aktif-düşük)',
    description: 'İki bağımsız 2 → 4 kod çözücü: E\' = 0 iken A1 A0 adresine göre Y0\'..Y3\' çıkışlarından biri 0 olur, E\' = 1 iken hepsi 1.',
    names: ['1E\'', '1A0', '1A1', '1Y0\'', '1Y1\'', '1Y2\'', '1Y3\'', '2Y3\'', '2Y2\'', '2Y1\'', '2Y0\'', '2A1', '2A0', '2E\''],
    labels: ['1E', '1A0', '1A1', '1Y0', '1Y1', '1Y2', '1Y3', '2Y3', '2Y2', '2Y1', '2Y0', '2A1', '2A0', '2E'],
  }, (g, s) => {
    const half = (en: number, a: number, b: number, ys: number[]) => {
      const on = lo(g(en));
      const sel = (hi(g(a)) ? 1 : 0) + (hi(g(b)) ? 2 : 0);
      ys.forEach((pin, i) => s(pin, lvlOf(!(on && i === sel))));
    };
    half(1, 2, 3, [4, 5, 6, 7]);
    half(15, 14, 13, [12, 11, 10, 9]);
  }),
  msi({
    id: '74148', pins: 16, out: [6, 7, 9, 14, 15], vcc: 16, gnd: 8,
    title: '8 → 3 öncelik kodlayıcı (aktif-düşük)',
    description:
      'EI\' = 0 iken 0 olan en yüksek numaralı I\' girişinin numarasını A2\'A1\'A0\' çıkışına ters olarak yazar ve GS\' = 0 yapar. '
      + 'Hiçbir giriş 0 değilse EO\' = 0 olur (sonraki çipi etkinleştirmek için).',
    names: ['I4\'', 'I5\'', 'I6\'', 'I7\'', 'EI\'', 'A2\'', 'A1\'', 'A0\'', 'I0\'', 'I1\'', 'I2\'', 'I3\'', 'GS\'', 'EO\''],
    labels: ['I4', 'I5', 'I6', 'I7', 'EI', 'A2', 'A1', 'A0', 'I0', 'I1', 'I2', 'I3', 'GS', 'EO'],
  }, (g, s) => {
    // Evolution Ttl74148: an input is asserted only when it reads 0
    const enabled = lo(g(5));
    let code = -1;
    if (enabled) {
      const ins = [10, 11, 12, 13, 1, 2, 3, 4];
      for (let c = 7; c >= 0; c--) if (lo(g(ins[c]))) { code = c; break; }
    }
    const enc = code >= 0;
    s(9, lvlOf(!(enc && (code & 1) !== 0)));
    s(7, lvlOf(!(enc && (code & 2) !== 0)));
    s(6, lvlOf(!(enc && (code & 4) !== 0)));
    s(14, lvlOf(!enc));
    s(15, lvlOf(!(enabled && !enc)));
  }),
  msi({
    id: '74151', pins: 16, out: [5, 6], vcc: 16, gnd: 8,
    title: '8 → 1 veri seçici (çoklayıcı)',
    description: 'S2 S1 S0 seçme girişine göre D0..D7\'den birini Y çıkışına, tersini W çıkışına verir. E\' = 1 iken Y = 0, W = 1.',
    names: ['D3', 'D2', 'D1', 'D0', 'Y', 'W', 'E\'', 'S2', 'S1', 'S0', 'D7', 'D6', 'D5', 'D4'],
    labels: ['D3', 'D2', 'D1', 'D0', 'Y', 'W', 'E', 'S2', 'S1', 'S0', 'D7', 'D6', 'D5', 'D4'],
  }, (g, s) => {
    const data = [4, 3, 2, 1, 15, 14, 13, 12];
    const sel = (hi(g(9)) ? 4 : 0) + (hi(g(10)) ? 2 : 0) + (hi(g(11)) ? 1 : 0);
    const d = hi(g(data[sel]));
    const strobe = hi(g(7));
    s(5, lvlOf(!strobe && d));
    s(6, lvlOf(strobe || !d));
  }),
  msi({
    id: '74153', pins: 16, out: [7, 9], vcc: 16, gnd: 8, height: 80,
    title: 'Çift 4 → 1 veri seçici (çoklayıcı)',
    description: 'Ortak S1 S0 seçme girişli iki adet 4 → 1 veri seçici (veri girişleri 1I0..1I3, 2I0..2I3); her birinin kendi aktif-düşük etkinleştirme girişi (1E\', 2E\') var, E\' = 1 iken o çıkış 0.',
    names: ['1E\'', 'S1', '1I3', '1I2', '1I1', '1I0', '1Y', '2Y', '2I0', '2I1', '2I2', '2I3', 'S0', '2E\''],
    labels: ['1E', 'S1', '1I3', '1I2', '1I1', '1I0', '1Y', '2Y', '2I0', '2I1', '2I2', '2I3', 'S0', '2E'],
  }, (g, s) => {
    const sel = (hi(g(2)) ? 2 : 0) + (hi(g(14)) ? 1 : 0);
    s(7, lvlOf(!hi(g(1)) && hi(g([6, 5, 4, 3][sel]))));
    s(9, lvlOf(!hi(g(15)) && hi(g([10, 11, 12, 13][sel]))));
  }),
  msi({
    id: '74157', pins: 16, out: [4, 7, 9, 12], vcc: 16, gnd: 8,
    title: 'Dörtlü 2 → 1 veri seçici (çoklayıcı)',
    description: 'Dört adet 2 → 1 veri seçici: S = 0 iken nY = nI0, S = 1 iken nY = nI1. E\' = 1 iken tüm çıkışlar 0.',
    names: ['S', '1I0', '1I1', '1Y', '2I0', '2I1', '2Y', '3Y', '3I1', '3I0', '4Y', '4I1', '4I0', 'E\''],
    labels: ['S', '1I0', '1I1', '1Y', '2I0', '2I1', '2Y', '3Y', '3I1', '3I0', '4Y', '4I1', '4I0', 'E'],
  }, (g, s) => {
    const strobe = hi(g(15));
    const sel = hi(g(1));
    for (const [a, b, y] of [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]]) s(y, lvlOf(!strobe && hi(g(sel ? b : a))));
  }),
  msi({
    id: '74283', pins: 16, out: [1, 4, 9, 10, 13], vcc: 16, gnd: 8, group: 'arith',
    title: '4 bit tam toplayıcı (hızlı elde)',
    description: 'A3..A0 + B3..B0 + C0 toplamını Σ3..Σ0 çıkışlarına, eldeyi C4 çıkışına verir (içte ileri bakan elde üreteci).',
    names: ['Σ1', 'B1', 'A1', 'Σ0', 'A0', 'B0', 'C0', 'C4', 'Σ3', 'B3', 'A3', 'Σ2', 'A2', 'B2'],
  }, (g, s) => {
    // Evolution Ttl74283: every input reads as "is it 1"
    const num = (pins: number[]) => pins.reduce((n, pin, i) => n | (hi(g(pin)) ? 1 << i : 0), 0);
    const sum = num([5, 3, 14, 12]) + num([6, 2, 15, 11]) + (hi(g(7)) ? 1 : 0);
    [4, 1, 13, 10, 9].forEach((pin, i) => s(pin, ((sum >> i) & 1) as 0 | 1));
  }),

  // ---- 4g: remaining combinational chips -----------------------------------------------------------------
  quad('747266', (a, b) => not(xor(a, b)), { title: 'Dörtlü 2 girişli XNOR', description: 'Dört adet 2 girişli ÖZEL VEYA DEĞİL kapısı (74HC7266), 7400 bacak dizilimi; çıkışlar normal (açık kollektör değil).' }),
  msi({
    id: '744075', pins: 14, out: [6, 9, 10], vcc: 14, gnd: 7, group: 'gates',
    title: 'Üçlü 3 girişli OR', description: 'Üç adet 3 girişli VEYA kapısı (74HC4075).',
    names: ['2A', '2B', '1A', '1B', '1C', '1Y', '2C', '2Y', '3Y', '3A', '3B', '3C'],
  }, (g, s) => {
    s(6, or(g(3), g(4), g(5)));
    s(9, or(g(1), g(2), g(8)));
    s(10, or(g(11), g(12), g(13)));
  }),
  decimalDecoder('7442', 'BCD → onluk kod çözücü (aktif-düşük)',
    'A3..A0 girişindeki BCD sayıya (0-9) karşılık gelen Y0\'..Y9\' çıkışını 0 yapar; 10-15 için tüm çıkışlar 1. '
    + 'Adres bitlerinden biri tanımsızsa çıkışlar boşta kalır.', (d) => d),
  decimalDecoder('7443', 'Fazlalık-3 → onluk kod çözücü (aktif-düşük)',
    'A3..A0 girişindeki fazlalık-3 kodlu rakama (3-12) karşılık gelen Y0\'..Y9\' çıkışını 0 yapar; diğer kodlarda tüm çıkışlar 1.',
    (d) => d - 3),
  decimalDecoder('7444', 'Fazlalık-3 Gray → onluk kod çözücü (aktif-düşük)',
    'A3..A0 girişindeki fazlalık-3 Gray kodlu rakama karşılık gelen Y0\'..Y9\' çıkışını 0 yapar; diğer kodlarda tüm çıkışlar 1.',
    (d) => [2, 6, 7, 5, 4, 12, 13, 15, 14, 10].indexOf(d)),
  msi({
    id: '74158', pins: 16, out: [4, 7, 9, 12], vcc: 16, gnd: 8,
    title: 'Dörtlü 2 → 1 veri seçici (ters çıkışlı)',
    description: 'Dört adet 2 → 1 veri seçici, çıkışlar ters: S = 0 iken nY\' = nI0\'nın tersi, S = 1 iken nI1\'in tersi. E\' = 1 iken tüm çıkışlar 1.',
    names: ['S', '1I0', '1I1', '1Y\'', '2I0', '2I1', '2Y\'', '3Y\'', '3I1', '3I0', '4Y\'', '4I1', '4I0', 'E\''],
    labels: ['S', '1I0', '1I1', '1Y', '2I0', '2I1', '2Y', '3Y', '3I1', '3I0', '4Y', '4I1', '4I0', 'E'],
  }, (g, s) => {
    const strobe = hi(g(15));
    const sel = hi(g(1));
    for (const [a, b, y] of [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]]) s(y, lvlOf(!(!strobe && hi(g(sel ? b : a)))));
  }),
  msi({
    id: '74257', pins: 16, out: [4, 7, 9, 12], vcc: 16, gnd: 8, triState: true,
    title: 'Dörtlü 2 → 1 veri seçici (3 durumlu)',
    description: 'Dört adet 2 → 1 veri seçici: S = 0 iken nY = nI0, S = 1 iken nY = nI1. OE\' = 1 iken çıkışlar boşta (Z), böylece veri yoluna bağlanabilir.',
    names: ['S', '1I0', '1I1', '1Y', '2I0', '2I1', '2Y', '3Y', '3I1', '3I0', '4Y', '4I1', '4I0', 'OE\''],
    labels: ['S', '1I0', '1I1', '1Y', '2I0', '2I1', '2Y', '3Y', '3I1', '3I0', '4Y', '4I1', '4I0', 'OE'],
  }, (g, s) => {
    // Evolution Ttl74257.channelOutput / selected
    const oe = g(15);
    const sel = g(1);
    for (const [a, b, y] of [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]]) {
      const s0 = g(a);
      const s1 = g(b);
      let d: SignalValue;
      if (sel === 1) d = s1;
      else if (sel === 0) d = s0;
      else if (same(s0, s1)) d = s0;
      else d = sel === 'E' || s0 === 'E' || s1 === 'E' ? 'E' : FLOAT;
      let v: SignalValue;
      if (oe === 1) v = FLOAT;
      else if (oe === 0) v = d;
      else if (unknown(d) && unknown(oe)) v = FLOAT;
      else v = oe === 'E' || d === 'E' ? 'E' : FLOAT;
      s(y, v);
    }
  }),
  msi({
    id: '74125', pins: 14, out: [3, 6, 8, 11], vcc: 14, gnd: 7, group: 'drivers', triState: true,
    title: 'Dörtlü 3 durumlu tampon (aktif-düşük OE)',
    description: 'Dört adet tampon: nOE\' = 0 iken nY = nA, nOE\' = 1 iken çıkış boşta (Z).',
    names: ['1OE\'', '1A', '1Y', '2OE\'', '2A', '2Y', '3Y', '3A', '3OE\'', '4Y', '4A', '4OE\''],
    labels: ['1OE', '1A', '1Y', '2OE', '2A', '2Y', '3Y', '3A', '3OE', '4Y', '4A', '4OE'],
  }, (g, s) => {
    // Evolution Ttl74125: only an enable reading 1 turns the buffer off
    for (const [oe, a, y] of [[1, 2, 3], [4, 5, 6], [10, 9, 8], [13, 12, 11]]) s(y, hi(g(oe)) ? FLOAT : g(a));
  }),
  msi({
    id: '74365', pins: 16, out: [3, 5, 7, 9, 11, 13], vcc: 16, gnd: 8, group: 'drivers', triState: true,
    title: 'Altılı 3 durumlu tampon (ortak OE)',
    description: 'Altı adet tampon: OE1\' = OE2\' = 0 iken nY = nA, aksi halde tüm çıkışlar boşta (Z).',
    names: ['OE1\'', '1A', '1Y', '2A', '2Y', '3A', '3Y', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'OE2\''],
    labels: ['OE1', '1A', '1Y', '2A', '2Y', '3A', '3Y', '4Y', '4A', '5Y', '5A', '6Y', '6A', 'OE2'],
  }, (g, s) => {
    const on = lo(g(1)) && lo(g(15));
    for (const [a, y] of [[2, 3], [4, 5], [6, 7], [10, 9], [12, 11], [14, 13]]) s(y, on ? g(a) : FLOAT);
  }),
  octalBuffer('74240', true, false, 'Sekizli 3 durumlu evirici tampon',
    'İki grup dörtlü evirici tampon: 1OE\' = 0 iken 1Yn\' = 1An\'nin tersi, 2OE\' = 0 iken 2Yn\' = 2An\'nin tersi; OE\' = 1 olan grubun çıkışları boşta (Z).'),
  octalBuffer('74241', false, true, 'Sekizli 3 durumlu tampon (zıt OE)',
    'İki grup dörtlü tampon: 1. grup 1OE\' = 0 iken, 2. grup 2OE = 1 iken çalışır (1Yn = 1An, 2Yn = 2An); kapalı grubun çıkışları boşta (Z).'),
  octalBuffer('74244', false, false, 'Sekizli 3 durumlu tampon',
    'İki grup dörtlü tampon: 1OE\' = 0 iken 1Yn = 1An, 2OE\' = 0 iken 2Yn = 2An; OE\' = 1 olan grubun çıkışları boşta (Z).'),
  msi({
    id: '74541', pins: 20, out: [11, 12, 13, 14, 15, 16, 17, 18], vcc: 20, gnd: 10, group: 'drivers', triState: true,
    title: 'Sekizli 3 durumlu tampon (akış dizilimli)',
    description: 'Sekiz tampon, girişler bir yanda çıkışlar karşı yanda: OE1\' = OE2\' = 0 iken Yn = An, aksi halde tüm çıkışlar boşta (Z).',
    names: ['OE1\'', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Y8', 'Y7', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'OE2\''],
    labels: ['OE1', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'Y8', 'Y7', 'Y6', 'Y5', 'Y4', 'Y3', 'Y2', 'Y1', 'OE2'],
  }, (g, s) => {
    const on = lo(g(1)) && lo(g(19));
    BUS_A.forEach((a, k) => s(BUS_B[k], on ? g(a) : FLOAT));
  }),
  msi({
    id: '74245', pins: 20, out: [], inout: [...BUS_A, ...BUS_B], vcc: 20, gnd: 10, group: 'drivers',
    title: 'Sekizli çift yönlü veri yolu alıcı-vericisi',
    description:
      'OE\' = 0 iken DIR = 1 A yolunu B\'ye (Bn = An), DIR = 0 B yolunu A\'ya (An = Bn) aktarır; karşı taraf boşta kalır. '
      + 'OE\' = 1 iken iki yol da boşta (Z). Bütün A ve B bacakları hem giriş hem çıkıştır.',
    names: TRANSCEIVER_NAMES, labels: TRANSCEIVER_LABELS,
  }, (g, s) => {
    // Evolution Ttl74245: only OE' reading 1 disables; DIR not reading 1 means B -> A
    const off = hi(g(19));
    const aToB = hi(g(1));
    BUS_A.forEach((a, k) => {
      const b = BUS_B[k];
      s(a, off || aToB ? FLOAT : g(b));
      s(b, off || !aToB ? FLOAT : g(a));
    });
  }),
  msi({
    id: '74640', pins: 20, out: [], inout: [...BUS_A, ...BUS_B], vcc: 20, gnd: 10, group: 'drivers',
    title: 'Sekizli çift yönlü alıcı-verici (evirici)',
    description:
      'OE\' = 0 iken DIR = 1 A yolunu ters olarak B\'ye, DIR = 0 B yolunu ters olarak A\'ya aktarır; karşı taraf boşta kalır. '
      + 'OE\' = 1 ya da DIR tanımsızken iki yol da boşta (Z).',
    names: TRANSCEIVER_NAMES, labels: TRANSCEIVER_LABELS,
  }, (g, s) => {
    // Evolution Ttl74640: enabled only with OE' reading 0, direction only when DIR reads 0 / 1
    const on = lo(g(19));
    const dir = g(1);
    BUS_A.forEach((a, k) => {
      const b = BUS_B[k];
      s(b, on && dir === 1 ? not(g(a)) : FLOAT);
      s(a, on && dir === 0 ? not(g(b)) : FLOAT);
    });
  }),
  msi({
    id: '74688', pins: 20, out: [19], vcc: 20, gnd: 10, group: 'arith',
    title: '8 bit eşitlik karşılaştırıcı',
    description: 'E\' = 0 iken P7..P0 ile Q7..Q0 bit bit aynıysa P=Q\' çıkışı 0, aksi halde 1. Tanımsız bir bit eşit sayılmaz.',
    names: ['E\'', 'P0', 'Q0', 'P1', 'Q1', 'P2', 'Q2', 'P3', 'Q3', 'P4', 'Q4', 'P5', 'Q5', 'P6', 'Q6', 'P7', 'Q7', 'P=Q\''],
    labels: ['E', 'P0', 'Q0', 'P1', 'Q1', 'P2', 'Q2', 'P3', 'Q3', 'P4', 'Q4', 'P5', 'Q5', 'P6', 'Q6', 'P7', 'Q7', 'P=Q'],
  }, (g, s) => {
    const pairs = [[2, 3], [4, 5], [6, 7], [8, 9], [11, 12], [13, 14], [15, 16], [17, 18]];
    const match = pairs.every(([p, q]) => lvl(g(p)) && g(p) === g(q));
    s(19, lvlOf(!(lo(g(1)) && match)));
  }),
  msi({
    id: '74181', pins: 24, out: [9, 10, 11, 13, 14, 15, 16, 17], vcc: 24, gnd: 12, group: 'arith', triState: true,
    title: '4 bit aritmetik-mantık birimi (ALU)',
    description:
      'S3..S0 ve M ile 16 mantık (M = 1) ya da 16 aritmetik (M = 0) işlemden birini A3..A0, B3..B0 üzerinde yapar (aktif-yüksek veri); '
      + 'Cn elde girişi aktif-düşüktür (Cn = 1: elde yok). Cn+4 elde çıkışı, P\' / G\' 74182 ile hızlı elde için; '
      + 'A=B açık kollektör çıkışı F = 1111 iken boşta kalır (pull-up gerekir), aksi halde 0.',
    names: ['B0', 'A0', 'S3', 'S2', 'S1', 'S0', 'Cn', 'M', 'F0', 'F1', 'F2', 'F3', 'A=B', 'P\'', 'Cn+4', 'G\'', 'B3', 'A3', 'B2', 'A2', 'B1', 'A1'],
    labels: ['B0', 'A0', 'S3', 'S2', 'S1', 'S0', 'Cn', 'M', 'F0', 'F1', 'F2', 'F3', 'A=B', 'P', 'Cn4', 'G', 'B3', 'A3', 'B2', 'A2', 'B1', 'A1'],
  }, (g, s) => {
    // Evolution Ttl74181 (PAL form of the datasheet logic); every input reads as "is it 1"
    const a = [2, 23, 21, 19].map((p) => hi(g(p)));
    const b = [1, 22, 20, 18].map((p) => hi(g(p)));
    const sel = [6, 5, 4, 3].map((p) => hi(g(p)));
    const l1 = [...a, ...b, ...b.map((x) => !x), ...sel];
    const x = [
      [0x8011, 0x4101], [0x8022, 0x4202], [0x8044, 0x4404], [0x8088, 0x4808],
    ].map((t) => pal(l1, t));
    const y = [
      [0x2100, 0x1010, 0x1], [0x2200, 0x1020, 0x2], [0x2400, 0x1040, 0x4], [0x2800, 0x1080, 0x8],
    ].map((t) => pal(l1, t));
    const l2 = [...x, ...y, !hi(g(8)), hi(g(7))];
    const z = [
      pal(l2, [0x300]),
      pal(l2, [0x301, 0x110]),
      pal(l2, [0x303, 0x112, 0x120]),
      pal(l2, [0x307, 0x116, 0x124, 0x140]),
    ];
    const p = pal(l2, [0xf]);
    const gg = pal(l2, [0x80, 0x48, 0x2c, 0x1e]);
    const co = !pal(l2, [0x20f]) || !gg;
    const f = [0, 1, 2, 3].map((i) => x[i] !== y[i] !== z[i]);
    s(15, lvlOf(p));
    s(17, lvlOf(gg));
    s(16, lvlOf(co));
    s(14, f.every(Boolean) ? FLOAT : 0);
    [9, 10, 11, 13].forEach((pin, i) => s(pin, lvlOf(f[i])));
  }),
  msi({
    id: '74182', pins: 16, out: [7, 9, 10, 11, 12], vcc: 16, gnd: 8, group: 'arith',
    title: 'İleri bakan elde üreteci',
    description:
      'Dört ALU\'nun (74181) aktif-düşük P0\'..P3\' ve G0\'..G3\' çıkışlarından Cn girişiyle ara eldeleri (Cn+x, Cn+y, Cn+z) '
      + 've grup P\' / G\' çıkışlarını tek kademede üretir.',
    names: ['G1\'', 'P1\'', 'G0\'', 'P0\'', 'G3\'', 'P3\'', 'P\'', 'Cn+z', 'G\'', 'Cn+y', 'Cn+x', 'Cn', 'G2\'', 'P2\''],
    labels: ['G1', 'P1', 'G0', 'P0', 'G3', 'P3', 'P', 'Cnz', 'G', 'Cny', 'Cnx', 'Cn', 'G2', 'P2'],
  }, (g, s) => {
    const p = [4, 2, 15, 6].map((pin) => !hi(g(pin)));
    const gn = [3, 1, 14, 5].map((pin) => !hi(g(pin)));
    const ci = hi(g(13));
    const po = p[3] && p[2] && p[1] && p[0];
    const go = gn[3] || (p[3] && gn[2]) || (p[3] && p[2] && gn[1]) || (p[3] && p[2] && p[1] && gn[0]);
    const cx = gn[0] || (p[0] && ci);
    const cy = gn[1] || (p[1] && gn[0]) || (p[1] && p[0] && ci);
    const cz = gn[2] || (p[2] && gn[1]) || (p[2] && p[1] && gn[0]) || (p[2] && p[1] && p[0] && ci);
    s(7, lvlOf(!po));
    s(10, lvlOf(!go));
    s(12, lvlOf(cx));
    s(11, lvlOf(cy));
    s(9, lvlOf(cz));
  }),
  msi({
    id: '74381', pins: 20, out: [8, 9, 11, 12, 13, 14], vcc: 20, gnd: 10, group: 'arith',
    title: '4 bit ALU / fonksiyon üreteci',
    description:
      'S2 S1 S0 ile 8 işlemden birini yapar: 000 F = 0000, 001 B eksi A, 010 A eksi B, 011 A artı B, 100 A XOR B, 101 A OR B, 110 A AND B, 111 F = 1111. '
      + 'Cn elde girişi; P\' / G\' 74182 ile hızlı elde için.',
    names: ['A1', 'B1', 'A0', 'B0', 'S0', 'S1', 'S2', 'F0', 'F1', 'F2', 'F3', 'G\'', 'P\'', 'Cn', 'B3', 'A3', 'B2', 'A2'],
    labels: ['A1', 'B1', 'A0', 'B0', 'S0', 'S1', 'S2', 'F0', 'F1', 'F2', 'F3', 'G', 'P', 'Cn', 'B3', 'A3', 'B2', 'A2'],
  }, (g, s) => {
    // Evolution Ttl74381 (PAL form); every input reads as "is it 1"
    const a = [3, 1, 19, 17].map((p) => hi(g(p)));
    const b = [4, 2, 18, 16].map((p) => hi(g(p)));
    const [s0, s1, s2] = [5, 6, 7].map((p) => hi(g(p)));
    const ci = hi(g(15));
    const u = s0 || s1;
    const v = s1 || s2;
    const w = s0 || !s1;
    const xx = !(s0 && s1) || s2;
    const yy = (s0 && s1) || !s2;
    const zz = !s2 && u;
    const l1 = [...a, ...a.map((q) => !q), ...b, ...b.map((q) => !q), yy, xx, w, v, u];
    const j = [
      [0x000c1010, 0x00161001, 0x000a0110],
      [0x000c2020, 0x00162002, 0x000a0220],
      [0x000c4040, 0x00164004, 0x000a0440],
      [0x000c8080, 0x00168008, 0x000a0880],
    ].map((t) => pal(l1, t));
    const k = [
      [0x00131010, 0x000c1001, 0x000c0110, 0x00120101],
      [0x00132020, 0x000c2002, 0x000c0220, 0x00120202],
      [0x00134040, 0x000c4004, 0x000c0440, 0x00120404],
      [0x00138080, 0x000c8008, 0x000c0880, 0x00120808],
    ].map((t) => pal(l1, t));
    const l2 = [...j, ...k, zz, ci];
    const l = [
      pal(l2, [0x300]),
      pal(l2, [0x301, 0x111]),
      pal(l2, [0x303, 0x113, 0x122]),
      pal(l2, [0x307, 0x117, 0x126, 0x144]),
    ];
    const p = pal(l2, [0xf]);
    const gg = pal(l2, [0x88, 0x4c, 0x2e, 0x1f]);
    s(14, lvlOf(p));
    s(13, lvlOf(gg));
    [8, 9, 11, 12].forEach((pin, i) => s(pin, lvlOf(l[i] !== k[i])));
  }),

  // ---- 4c: sequential (flip-flops, counter, shift register) ---------------------------------------------
  msi({
    id: '7474', pins: 14, out: [5, 6, 8, 9], vcc: 14, gnd: 7, group: 'sequential', seq: { v: 2, clk: 2 },
    title: 'Çift D flip-flop (preset/clear)',
    description:
      'İki adet yükselen kenar tetiklemeli D flip-flop: CLK 0 → 1 olurken Q = D. CLR\' = 0 Q\'yu hemen 0, PRE\' = 0 hemen 1 yapar '
      + '(saatten bağımsız); ikisi birden 0 iken durum belirsizdir.',
    names: ['1CLR\'', '1D', '1CLK', '1PRE\'', '1Q', '1Q\'', '2Q\'', '2Q', '2PRE\'', '2CLK', '2D', '2CLR\''],
    labels: ['1CLR', '1D', '1CK', '1PRE', '1Q', '1Q\'', '2Q\'', '2Q', '2PRE', '2CK', '2D', '2CLR'],
  }, (g, s, st) => {
    // Evolution Ttl7474: both clocks are sampled first; clear and preset act while they read 0
    const t = [clockEdge(st, 0, g(3)), clockEdge(st, 1, g(11))];
    const ff = (i: number, clr: number, pre: number, d: number) => {
      if (lo(g(clr)) && lo(g(pre))) st.v[i] = 'X';
      else if (lo(g(clr))) st.v[i] = 0;
      else if (lo(g(pre))) st.v[i] = 1;
      else if (t[i]) st.v[i] = g(d);
    };
    ff(0, 1, 4, 2);
    ff(1, 13, 10, 12);
    s(5, drive(st.v[0]));
    s(6, not(st.v[0]));
    s(8, not(st.v[1]));
    s(9, drive(st.v[1]));
  }),
  msi({
    // Real 7476 pinout (VCC pin 5, GND pin 13); evolution's 7476 keeps the default VCC 16 / GND 8 and so shifts pins 8-16
    id: '7476', pins: 16, out: [10, 11, 14, 15], vcc: 5, gnd: 13, group: 'sequential', seq: { v: 2, clk: 2 },
    title: 'Çift JK flip-flop (preset/clear)',
    description:
      'İki adet düşen kenar tetiklemeli JK flip-flop: CLK 1 → 0 olurken J = 1, K = 0 → Q = 1; J = 0, K = 1 → Q = 0; '
      + 'J = K = 1 → Q tersine döner; J = K = 0 → değişmez. PRE\' = 0 / CLR\' = 0 saatten bağımsız kurar / sıfırlar. '
      + 'Besleme bacakları gerçek çipteki gibi 5 (VCC) ve 13 (GND).',
    names: ['1CLK', '1PRE\'', '1CLR\'', '1J', '2CLK', '2PRE\'', '2CLR\'', '2J', '2Q\'', '2Q', '2K', '1Q\'', '1Q', '1K'],
    labels: ['1CK', '1PRE', '1CLR', '1J', '2CK', '2PRE', '2CLR', '2J', '2Q\'', '2Q', '2K', '1Q\'', '1Q', '1K'],
  }, (g, s, st) => {
    // Evolution Ttl7476 (falling edges; J / K count only when they read 1 / 0)
    const t = [clockEdge(st, 0, g(1), true), clockEdge(st, 1, g(6), true)];
    const ff = (i: number, pre: number, clr: number, j: number, k: number) => {
      if (lo(g(pre)) && lo(g(clr))) st.v[i] = 'X';
      else if (lo(g(pre))) st.v[i] = 1;
      else if (lo(g(clr))) st.v[i] = 0;
      else if (t[i]) {
        if (hi(g(j)) && hi(g(k))) st.v[i] = not(st.v[i]);
        else if (hi(g(j)) && lo(g(k))) st.v[i] = 1;
        else if (lo(g(j)) && hi(g(k))) st.v[i] = 0;
      }
    };
    ff(0, 2, 3, 4, 16);
    ff(1, 7, 8, 9, 12);
    s(10, not(st.v[1]));
    s(11, drive(st.v[1]));
    s(14, not(st.v[0]));
    s(15, drive(st.v[0]));
  }),
  msi({
    id: '74161', pins: 16, out: [11, 12, 13, 14, 15], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 4, clk: 1 },
    title: '4 bit senkron ikili sayaç',
    description:
      'Yükselen kenarda sayar: SPE\' = 0 ise D3..D0 yüklenir, değilse CEP = CET = 1 iken bir artar (15\'ten sonra 0). '
      + 'MR\' = 0 sayacı saatten bağımsız sıfırlar. TC = CET · Q3·Q2·Q1·Q0 (sayaçları zincirlemek için).',
    names: ['MR\'', 'CLK', 'D0', 'D1', 'D2', 'D3', 'CEP', 'SPE\'', 'CET', 'Q3', 'Q2', 'Q1', 'Q0', 'TC'],
    labels: ['MR', 'CK', 'D0', 'D1', 'D2', 'D3', 'CEP', 'SPE', 'CET', 'Q3', 'Q2', 'Q1', 'Q0', 'TC'],
  }, (g, s, st) => {
    // Evolution Ttl74161: the count is a 4-bit number (an undefined D bit loads as -1, i.e. all ones above it)
    const triggered = clockEdge(st, 0, g(2));
    let n = st.v.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0);
    if (toLong(g(1)) === 0) n = 0;
    else if (triggered) {
      if (toLong(g(9)) === 0) n = (toLong(g(3)) + (toLong(g(4)) << 1) + (toLong(g(5)) << 2) + (toLong(g(6)) << 3)) & 15;
      else if (and(g(7), g(10)) === 1) n = (n + 1) & 15;
    }
    st.v = [0, 1, 2, 3].map((i) => ((n >> i) & 1) as 0 | 1);
    [14, 13, 12, 11].forEach((pin, i) => s(pin, st.v[i]));
    s(15, and(g(10), st.v[0], st.v[1], st.v[2], st.v[3]));
  }),
  msi({
    id: '74194', pins: 16, out: [12, 13, 14, 15], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 4, clk: 1 },
    title: '4 bit evrensel kaydırmalı yazmaç',
    description:
      'Yükselen kenarda S1 S0 kipine göre çalışır: 00 bekle, 01 sağa kaydır (DSR → Q0 → Q1 → Q2 → Q3), '
      + '10 sola kaydır (DSL → Q3 → Q2 → Q1 → Q0), 11 D0..D3\'ü paralel yükle. MR\' = 0 saatten bağımsız sıfırlar.',
    names: ['MR\'', 'DSR', 'D0', 'D1', 'D2', 'D3', 'DSL', 'S0', 'S1', 'CLK', 'Q3', 'Q2', 'Q1', 'Q0'],
    labels: ['MR', 'DSR', 'D0', 'D1', 'D2', 'D3', 'DSL', 'S0', 'S1', 'CK', 'Q3', 'Q2', 'Q1', 'Q0'],
  }, (g, s, st) => {
    // Evolution Ttl74194: while MR' reads 0 the register clears and the clock is not sampled; v[0] = Q0 .. v[3] = Q3
    const q = st.v;
    if (lo(g(1))) st.v = [0, 0, 0, 0];
    else if (clockEdge(st, 0, g(11))) {
      const mode = (hi(g(10)) ? 2 : 0) + (hi(g(9)) ? 1 : 0);
      if (mode === 3) st.v = [3, 4, 5, 6].map(g);
      else if (mode === 1) st.v = [g(2), q[0], q[1], q[2]];
      else if (mode === 2) st.v = [q[1], q[2], q[3], g(7)];
    }
    [15, 14, 13, 12].forEach((pin, i) => s(pin, drive(st.v[i])));
  }),

  // ---- 4h: counters ------------------------------------------------------------------------------------
  msi({
    // Evolution keeps the real 7493 supply pins (VCC 5, GND 10)
    id: '7493', pins: 14, out: [8, 9, 11, 12], unused: [4, 6, 7, 13], vcc: 5, gnd: 10, group: 'sequential',
    seq: { v: 4, clk: 2 },
    title: '4 bit ikili dalgalı sayaç (÷2 ve ÷8)',
    description:
      'İki bağımsız bölüm, ikisi de düşen kenarda sayar: CKA QA\'yı tersine çevirir (÷2), CKB QB-QC-QD üçlüsünü bir artırır (÷8). '
      + 'QA\'yı CKB\'ye bağlayınca 4 bitlik ÷16 sayaç olur. R0(1) = R0(2) = 1 iken saatten bağımsız sıfırlanır. '
      + 'Besleme bacakları gerçek çipteki gibi 5 (VCC) ve 10 (GND).',
    names: ['CKB', 'R0(1)', 'R0(2)', 'QC', 'QB', 'QD', 'QA', 'CKA'],
    labels: ['CKB', 'R1', 'R2', 'QC', 'QB', 'QD', 'QA', 'CKA'],
  }, (g, s, st) => {
    // Evolution Ttl7493: both clocks are sampled first; v[0] = QA .. v[3] = QD
    const ta = clockEdge(st, 0, g(14), true);
    const tb = clockEdge(st, 1, g(1), true);
    if (hi(g(2)) && hi(g(3))) st.v = [0, 0, 0, 0];
    else {
      const v = [...st.v];
      if (ta) v[0] = not(v[0]);
      if (tb) {
        let carry: SignalValue = 1;
        for (let i = 1; i < 4; i++) {
          const old = v[i];
          v[i] = xor(old, carry);
          carry = and(old, carry);
        }
      }
      st.v = v;
    }
    [12, 9, 8, 11].forEach((pin, i) => s(pin, drive(st.v[i])));
  }),
  msi({
    id: '74163', pins: 16, out: [11, 12, 13, 14, 15], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 4, clk: 1 },
    title: '4 bit senkron ikili sayaç (senkron sıfırlama)',
    description:
      'Yükselen kenarda çalışır: MR\' = 0 ise sıfırlanır, değilse SPE\' = 0 iken D3..D0 yüklenir, değilse CEP = CET = 1 iken bir artar '
      + '(15\'ten sonra 0). 74161\'den farkı: sıfırlama da saatle olur. TC = CET · Q3·Q2·Q1·Q0.',
    names: ['MR\'', 'CLK', 'D0', 'D1', 'D2', 'D3', 'CEP', 'SPE\'', 'CET', 'Q3', 'Q2', 'Q1', 'Q0', 'TC'],
    labels: ['MR', 'CK', 'D0', 'D1', 'D2', 'D3', 'CEP', 'SPE', 'CET', 'Q3', 'Q2', 'Q1', 'Q0', 'TC'],
  }, (g, s, st) => {
    // Evolution Ttl74163: MR', SPE' and the enables count only on the edge (an undefined D bit loads as -1)
    const triggered = clockEdge(st, 0, g(2));
    let n = st.v.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0);
    if (triggered) {
      if (toLong(g(1)) === 0) n = 0;
      else if (toLong(g(9)) === 0) n = (toLong(g(3)) + (toLong(g(4)) << 1) + (toLong(g(5)) << 2) + (toLong(g(6)) << 3)) & 15;
      else if (and(g(7), g(10)) === 1) n = (n + 1) & 15;
    }
    st.v = [0, 1, 2, 3].map((i) => ((n >> i) & 1) as 0 | 1);
    [14, 13, 12, 11].forEach((pin, i) => s(pin, st.v[i]));
    s(15, and(g(10), st.v[0], st.v[1], st.v[2], st.v[3]));
  }),
  msi({
    id: '74190', pins: 16, out: [2, 3, 6, 7, 12, 13], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 4, clk: 1 },
    title: 'İleri/geri BCD (onlu) sayaç',
    description:
      'Yükselen kenarda CE\' = 0 iken sayar: U\'/D = 0 ileri (9\'dan sonra 0), 1 geri (0\'dan sonra 9). PL\' = 0 D3..D0\'ı saatten '
      + 'bağımsız yükler. TC (MAX/MIN) ileride 9\'da, geride 0\'da 1 olur; RC\' = 0 ise TC = 1, CE\' = 0 ve saat 0 iken '
      + '(sayaçları zincirlemek için).',
    names: ['D1', 'Q1', 'Q0', 'CE\'', 'U\'/D', 'Q2', 'Q3', 'D3', 'D2', 'PL\'', 'TC', 'RC\'', 'CP', 'D0'],
    labels: ['D1', 'Q1', 'Q0', 'CE', 'U/D', 'Q2', 'Q3', 'D3', 'D2', 'PL', 'TC', 'RC', 'CP', 'D0'],
  }, (g, s, st) => {
    // Evolution Ttl74190: every value an unknown input (or stored bit) could have is tried; bits that differ
    // read unknown (E if an input is E). The load is asynchronous.
    const triggered = clockEdge(st, 0, g(14));
    const cnt = choose([g(11), g(4), g(5), g(15), g(1), g(10), g(9), ...st.v], 4, (m) => {
      if (!(m & 1)) return (m >> 3) & 15;
      if (triggered && !(m & 2)) return (m & 4 ? COUNT_DOWN_190 : COUNT_UP_190)[(m >> 7) & 15];
      return (m >> 7) & 15;
    });
    st.v = cnt;
    const flags = choose([g(4), g(5), g(14), ...cnt], 2, (m) => {
      const code = (m >> 3) & 15;
      const terminal = m & 2 ? code === 0 : (code & 9) === 9;
      const rippleHigh = !(terminal && !(m & 1) && !(m & 4));
      return (terminal ? 1 : 0) | (rippleHigh ? 2 : 0);
    });
    [3, 2, 6, 7].forEach((pin, i) => s(pin, drive(cnt[i])));
    s(12, drive(flags[0]));
    s(13, drive(flags[1]));
  }),
  upDown('74192', 9, 'İleri/geri BCD (onlu) sayaç, çift saatli',
    'İki saat girişi: DOWN = 1 iken UP 0 → 1 olunca bir artar (9\'dan sonra 0), UP = 1 iken DOWN 0 → 1 olunca bir azalır '
    + '(0\'dan sonra 9). CLR = 1 sıfırlar, LOAD\' = 0 D..A\'yı yükler (ikisi de saatten bağımsız; 9\'dan büyük değer 0 yüklenir). '
    + 'CO\' 9\'dayken UP\'un düşen kenarında, BO\' 0\'dayken DOWN\'un düşen kenarında 0 olur.'),
  upDown('74193', 15, 'İleri/geri 4 bit ikili sayaç, çift saatli',
    'İki saat girişi: DOWN = 1 iken UP 0 → 1 olunca bir artar (15\'ten sonra 0), UP = 1 iken DOWN 0 → 1 olunca bir azalır '
    + '(0\'dan sonra 15). CLR = 1 sıfırlar, LOAD\' = 0 D..A\'yı yükler (ikisi de saatten bağımsız). '
    + 'CO\' 15\'teyken UP\'un düşen kenarında, BO\' 0\'dayken DOWN\'un düşen kenarında 0 olur.'),
  msi({
    id: '74390', pins: 16, out: [3, 5, 6, 7, 9, 10, 11, 13], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 8, clk: 4 },
    title: 'Çift onlu dalgalı sayaç (÷2 ve ÷5)',
    description:
      'İki bağımsız sayaç, her biri iki bölüm, düşen kenarda sayar: CP0 Q0\'ı tersine çevirir (÷2), CP1 Q1-Q2-Q3\'ü 0..4 arasında '
      + 'sayar (÷5). Q0\'ı CP1\'e bağlayınca BCD (÷10) sayaç olur. MR = 1 saatten bağımsız sıfırlar.',
    names: ['1CP0', '1MR', '1Q0', '1CP1', '1Q1', '1Q2', '1Q3', '2Q3', '2Q2', '2Q1', '2CP1', '2Q0', '2MR', '2CP0'],
  }, (g, s, st) => {
    // Evolution Ttl74390: v[4h + i] = bit i of half h; clocks CP0, CP1 of half h are 2h, 2h + 1
    ([[1, 4, 2, [3, 5, 6, 7]], [15, 12, 14, [13, 11, 10, 9]]] as const).forEach(([cp0, cp1, mr, q], h) => {
      const div2 = clockEdge(st, 2 * h, g(cp0), true);
      const div5 = clockEdge(st, 2 * h + 1, g(cp1), true);
      let bits = st.v.slice(4 * h, 4 * h + 4);
      if (hi(g(mr))) bits = [0, 0, 0, 0];
      else {
        if (div2) bits[0] = bits[0] === 1 ? 0 : bits[0] === 0 ? 1 : bits[0] === 'E' ? 'E' : 'X';
        if (div5) {
          const hiBits = bits.slice(1);
          let next: SignalValue[];
          if (hiBits.includes('E')) next = ['E', 'E', 'E'];
          else if (!hiBits.every(lvl)) next = ['X', 'X', 'X'];
          else {
            const code = hiBits.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0);
            next = code > 4 ? ['X', 'X', 'X'] : [0, 1, 2].map((i) => (((code === 4 ? 0 : code + 1) >> i) & 1) as 0 | 1);
          }
          bits = [bits[0], ...next];
        }
      }
      st.v.splice(4 * h, 4, ...bits);
      q.forEach((pin, i) => s(pin, drive(bits[i])));
    });
  }),
  msi({
    id: '74393', pins: 14, out: [3, 4, 5, 6, 8, 9, 10, 11], vcc: 14, gnd: 7, group: 'sequential', seq: { v: 8, clk: 2 },
    title: 'Çift 4 bit ikili sayaç',
    description:
      'İki bağımsız 4 bit sayaç: CP\'nin düşen kenarında bir artar (15\'ten sonra 0), MR = 1 saatten bağımsız sıfırlar. '
      + 'Birinin Q3\'ünü ötekinin CP\'sine bağlayınca 8 bitlik sayaç olur.',
    names: ['1CP', '1MR', '1Q0', '1Q1', '1Q2', '1Q3', '2Q3', '2Q2', '2Q1', '2Q0', '2MR', '2CP'],
  }, (g, s, st) => {
    // Evolution Ttl74393: v[4h + i] = bit i of counter h; both clocks are sampled first
    const t = [clockEdge(st, 0, g(1), true), clockEdge(st, 1, g(13), true)];
    ([[2, [3, 4, 5, 6]], [12, [11, 10, 9, 8]]] as const).forEach(([mr, q], h) => {
      let bits = st.v.slice(4 * h, 4 * h + 4);
      if (hi(g(mr))) bits = [0, 0, 0, 0];
      else if (t[h]) bits = countUp(bits);
      st.v.splice(4 * h, 4, ...bits);
      q.forEach((pin, i) => s(pin, drive(bits[i])));
    });
  }),
  msi({
    id: '744017', pins: 16, out: [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 4, clk: 2 },
    title: 'Onlu Johnson sayacı (10 çıkışlı)',
    description:
      'CP1\' = 0 iken CP0\'ın yükselen kenarında ya da CP0 = 1 iken CP1\'in düşen kenarında bir sonraki adıma geçer; Q0..Q9\'dan '
      + 'yalnız sıradaki 1 olur (9\'dan sonra Q0). Q5-9\' adım 0-4\'te 1, 5-9\'da 0 olur. MR = 1 saatten bağımsız Q0\'a döndürür.',
    names: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'Q8', 'Q4', 'Q9', 'Q5-9\'', 'CP1\'', 'CP0', 'MR'],
    labels: ['Q5', 'Q1', 'Q0', 'Q2', 'Q6', 'Q7', 'Q3', 'Q8', 'Q4', 'Q9', 'Q59', 'CP1', 'CP0', 'MR'],
  }, (g, s, st) => {
    // Evolution Ttl744017: the step is a 4-bit number; anything but 0..9 makes every output unknown
    const cp0 = g(14);
    const cp1 = g(13);
    const rising0 = clockEdge(st, 0, cp0);
    const falling1 = clockEdge(st, 1, cp1, true);
    const next = (bits: SignalValue[]): SignalValue[] => {
      if (bits.includes('E')) return ['E', 'E', 'E', 'E'];
      const n = bits.every(lvl) ? bits.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0) : 99;
      return n > 9 ? ['X', 'X', 'X', 'X'] : [0, 1, 2, 3].map((i) => ((((n + 1) % 10) >> i) & 1) as 0 | 1);
    };
    if (hi(g(15))) st.v = [0, 0, 0, 0];
    else if ((rising0 && lo(cp1)) || (falling1 && hi(cp0))) st.v = next(st.v);
    const decoded = [3, 2, 4, 7, 10, 1, 5, 6, 9, 11];
    const n = st.v.every(lvl) ? st.v.reduce<number>((acc, b, i) => acc | (b === 1 ? 1 << i : 0), 0) : 99;
    if (n > 9) {
      const bad: SignalValue = st.v.includes('E') ? 'E' : FLOAT;
      [...decoded, 12].forEach((pin) => s(pin, bad));
    } else {
      decoded.forEach((pin, k) => s(pin, lvlOf(k === n)));
      s(12, lvlOf(n < 5));
    }
  }),
  msi({
    id: '744060', pins: 16, out: [1, 2, 3, 4, 5, 6, 7, 13, 14, 15], unused: [9, 10], vcc: 16, gnd: 8, group: 'sequential',
    seq: { v: 14, clk: 1 },
    title: '14 basamaklı ikili sayaç / bölücü',
    description:
      'RS\'nin düşen kenarında 14 bitlik sayaç bir artar; Q4..Q14 basamaklarının bir kısmı dışarı çıkar (Qn = girişin 2ⁿ\'e '
      + 'bölümü; Q1-Q3 ve Q11 yok). MR = 1 saatten bağımsız sıfırlar. Osilatör bacakları (9, 10) bağlı değildir.',
    names: ['Q12', 'Q13', 'Q14', 'Q6', 'Q5', 'Q7', 'Q4', 'RS', 'MR', 'Q9', 'Q8', 'Q10'],
  }, (g, s, st) => {
    // Evolution Ttl744060: v[i] = stage Q(i + 1)
    const clocked = clockEdge(st, 0, g(11), true);
    if (hi(g(12))) st.v = Array<SignalValue>(14).fill(0);
    else if (clocked) st.v = countUp(st.v);
    ([[1, 12], [2, 13], [3, 14], [4, 6], [5, 5], [6, 7], [7, 4], [13, 9], [14, 8], [15, 10]] as const).forEach(([pin, q]) =>
      s(pin, drive(st.v[q - 1]))
    );
  }),

  // ---- 4i: registers, latches, flip-flops ----------------------------------------------------------------
  msi({
    id: '74107', pins: 14, out: [2, 3, 5, 6], vcc: 14, gnd: 7, group: 'sequential', seq: { v: 2, clk: 2 },
    title: 'Çift JK flip-flop (clear)',
    description:
      'İki adet düşen kenar tetiklemeli JK flip-flop: CLK 1 → 0 olurken J = 1, K = 0 → Q = 1; J = 0, K = 1 → Q = 0; '
      + 'J = K = 1 → Q tersine döner; J = K = 0 → değişmez. CLR\' = 0 Q\'yu saatten bağımsız 0 yapar (preset yok).',
    names: ['1J', '1Q\'', '1Q', '1K', '2Q', '2Q\'', '2J', '2CLK', '2CLR\'', '2K', '1CLK', '1CLR\''],
    labels: ['1J', '1Q\'', '1Q', '1K', '2Q', '2Q\'', '2J', '2CK', '2CLR', '2K', '1CK', '1CLR'],
  }, (g, s, st) => {
    // Evolution Ttl74107: an unknown CLR' makes the state unknown (E: error); an unknown J / K matters only when
    // its two values give different results
    const t = [clockEdge(st, 0, g(12), true), clockEdge(st, 1, g(9), true)];
    const levels = (v: SignalValue): boolean[] => (v === 1 ? [true] : v === 0 ? [false] : [false, true]);
    const next = (q: SignalValue, j: boolean, k: boolean): SignalValue => (j && k ? complement(q) : j ? 1 : k ? 0 : q);
    const ff = (i: number, clr: number, j: number, k: number) => {
      const r = g(clr);
      if (r === 0) st.v[i] = 0;
      else if (r === 'E') st.v[i] = 'E';
      else if (r !== 1) st.v[i] = 'X';
      else if (t[i]) {
        const [J, K, q] = [g(j), g(k), st.v[i]];
        const agreed = next(q, levels(J)[0], levels(K)[0]);
        const differs = levels(J).some((jh) => levels(K).some((kh) => !same(next(q, jh, kh), agreed)));
        st.v[i] = differs ? (J === 'E' || K === 'E' ? 'E' : 'X') : agreed;
      }
    };
    ff(0, 13, 1, 4);
    ff(1, 10, 8, 11);
    s(3, drive(st.v[0]));
    s(2, drive(complement(st.v[0])));
    s(5, drive(st.v[1]));
    s(6, drive(complement(st.v[1])));
  }),
  msi({
    id: '74173', pins: 16, out: [3, 4, 5, 6], vcc: 16, gnd: 8, group: 'sequential', triState: true, seq: { v: 4, clk: 1 },
    title: '4 bit D yazmacı (3 durumlu çıkış)',
    description:
      'G1\' = G2\' = 0 iken CLK 0 → 1 olunca D1..D4 yüklenir, değilse yazmaç değerini korur. CLR = 1 saatten bağımsız sıfırlar. '
      + 'Çıkışlar yalnız M\' = N\' = 0 iken sürülür, değilse boşta (Z) kalır; yazmaç bundan etkilenmez.',
    names: ['M\'', 'N\'', 'Q1', 'Q2', 'Q3', 'Q4', 'CLK', 'G1\'', 'G2\'', 'D4', 'D3', 'D2', 'D1', 'CLR'],
    labels: ['M', 'N', 'Q1', 'Q2', 'Q3', 'Q4', 'CK', 'G1', 'G2', 'D4', 'D3', 'D2', 'D1', 'CLR'],
  }, (g, s, st) => {
    // Evolution Ttl74173: the clock is sampled only while loading (CLR not 1, G1' = G2' = 0); v[i] = Q(i + 1)
    if (hi(g(15))) st.v = [0, 0, 0, 0];
    else if (lo(g(9)) && lo(g(10)) && clockEdge(st, 0, g(7))) st.v = [14, 13, 12, 11].map(g);
    const enabled = lo(g(1)) && lo(g(2));
    [3, 4, 5, 6].forEach((pin, i) => s(pin, enabled ? drive(st.v[i]) : FLOAT));
  }),
  msi({
    id: '74175', pins: 16, out: [2, 3, 6, 7, 10, 11, 14, 15], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 4, clk: 1 },
    title: 'Dörtlü D flip-flop (clear)',
    description:
      'Ortak saatli dört D flip-flop: CLK 0 → 1 olurken Q1..Q4 = D1..D4; her birinin Q\' çıkışı da var. '
      + 'CLR\' = 0 saatten bağımsız sıfırlar.',
    names: ['CLR\'', 'Q1', 'Q1\'', 'D1', 'D2', 'Q2\'', 'Q2', 'CLK', 'Q3', 'Q3\'', 'D3', 'D4', 'Q4\'', 'Q4'],
    labels: ['CLR', 'Q1', 'Q1\'', 'D1', 'D2', 'Q2\'', 'Q2', 'CK', 'Q3', 'Q3\'', 'D3', 'D4', 'Q4\'', 'Q4'],
  }, (g, s, st) => {
    // Evolution Ttl74175: the clock is sampled first; Q' is Value.not (an unknown bit gives E)
    const triggered = clockEdge(st, 0, g(9));
    if (lo(g(1))) st.v = [0, 0, 0, 0];
    else if (triggered) st.v = [4, 5, 12, 13].map(g);
    ([[2, 3], [7, 6], [10, 11], [15, 14]] as const).forEach(([q, qn], i) => {
      s(q, drive(st.v[i]));
      s(qn, not(st.v[i]));
    });
  }),
  msi({
    id: '74259', pins: 16, out: [4, 5, 6, 7, 9, 10, 11, 12], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 8, clk: 0 },
    title: '8 bit adreslenebilir mandal',
    description:
      'A2..A0 adresli çıkışa D yazılır (saat yok, mandal). LE\' = 0, MR\' = 1: seçili çıkış D\'yi izler, ötekiler korunur; '
      + 'LE\' = 0, MR\' = 0: seçili çıkış D, ötekiler 0 (1-8 kod çözücü); LE\' = 1, MR\' = 0: hepsi 0; LE\' = MR\' = 1: hepsi korunur.',
    names: ['A0', 'A1', 'A2', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'D', 'LE\'', 'MR\''],
    labels: ['A0', 'A1', 'A2', 'Q0', 'Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'D', 'LE', 'MR'],
  }, (g, s, st) => {
    // Evolution Ttl74259: with an unknown address bit the outputs it may select merge D with their idle value
    const [mr, le, d] = [g(15), g(14), g(13)];
    const a = [1, 2, 3].map(g);
    const level = (k: number, idle: SignalValue): SignalValue => {
      const excluded = a.some((b, j) => ((k >> j) & 1 ? b === 0 : b === 1));
      if (excluded) return idle;
      if (a.every(lvl)) return d;
      if (same(d, idle)) return d;
      if (d === 'E' || idle === 'E' || (lvl(d) && lvl(idle))) return 'E';
      return 'X';
    };
    if (lo(mr) && hi(le)) st.v = Array<SignalValue>(8).fill(0);
    else if (lo(le) && (lo(mr) || hi(mr))) st.v = st.v.map((q, k) => level(k, lo(mr) ? 0 : q));
    [4, 5, 6, 7, 9, 10, 11, 12].forEach((pin, k) => s(pin, drive(st.v[k])));
  }),
  octalFlops('74273', false, 'Sekizli D flip-flop (clear)',
    'Ortak saatli sekiz D flip-flop: CLK 0 → 1 olurken Q1..Q8 = D1..D8. CLR\' = 0 saatten bağımsız sıfırlar.'),
  msi({
    id: '74374', pins: 20, out: [2, 5, 6, 9, 12, 15, 16, 19], vcc: 20, gnd: 10, group: 'sequential', triState: true,
    seq: { v: 8, clk: 1 },
    title: 'Sekizli D flip-flop (3 durumlu çıkış)',
    description:
      'Ortak saatli sekiz D flip-flop: CLK 0 → 1 olurken D1..D8 saklanır. Çıkışlar yalnız OE\' = 0 iken sürülür, değilse '
      + 'boşta (Z) kalır; saklanan değer bundan etkilenmez.',
    names: ['OE\'', 'Q1', 'D1', 'D2', 'Q2', 'Q3', 'D3', 'D4', 'Q4', 'CLK', 'Q5', 'D5', 'D6', 'Q6', 'Q7', 'D7', 'D8', 'Q8'],
    labels: ['OE', 'Q1', 'D1', 'D2', 'Q2', 'Q3', 'D3', 'D4', 'Q4', 'CK', 'Q5', 'D5', 'D6', 'Q6', 'Q7', 'D7', 'D8', 'Q8'],
  }, (g, s, st) => {
    // Evolution Ttl74374
    if (clockEdge(st, 0, g(11))) st.v = OCTAL_D.map(g);
    const enabled = lo(g(1));
    OCTAL_Q.forEach((pin, i) => s(pin, enabled ? drive(st.v[i]) : FLOAT));
  }),
  octalFlops('74377', true, 'Sekizli D flip-flop (saat izinli)',
    'Ortak saatli sekiz D flip-flop: E\' = 0 iken CLK 0 → 1 olunca Q1..Q8 = D1..D8; E\' = 1 iken değer korunur.'),
  msi({
    id: '74670', pins: 16, out: [6, 7, 9, 10], vcc: 16, gnd: 8, group: 'sequential', triState: true, seq: { v: 16, clk: 0 },
    title: '4 x 4 yazmaç dosyası (3 durumlu çıkış)',
    description:
      'Dört adet 4 bitlik sözcük; yazma ve okuma ayrı adreslidir. WE\' = 0 iken D1..D4, WA1 WA0 adresli sözcüğe yazılır (saat yok, '
      + 'WE\' = 0 boyunca izler). Q1..Q4, RA1 RA0 adresli sözcüğü OE\' = 0 iken gösterir, değilse boşta (Z) kalır.',
    names: ['D2', 'D3', 'D4', 'RA1', 'RA0', 'Q4', 'Q3', 'Q2', 'Q1', 'OE\'', 'WE\'', 'WA1', 'WA0', 'D1'],
    labels: ['D2', 'D3', 'D4', 'RA1', 'RA0', 'Q4', 'Q3', 'Q2', 'Q1', 'OE', 'WE', 'WA1', 'WA0', 'D1'],
  }, (g, s, st) => {
    // Evolution Ttl74670: an address bit counts as 1 only when it reads 1; v[4w + i] = bit D(i + 1) of word w
    const addr = (msb: number, lsb: number) => (hi(g(msb)) ? 2 : 0) + (hi(g(lsb)) ? 1 : 0);
    if (lo(g(12))) st.v.splice(4 * addr(13, 14), 4, ...[15, 1, 2, 3].map(g));
    const r = addr(4, 5);
    const enabled = lo(g(11));
    [10, 9, 7, 6].forEach((pin, i) => s(pin, enabled ? drive(st.v[4 * r + i]) : FLOAT));
  }),

  // ---- 4j: shift registers -------------------------------------------------------------------------------
  msi({
    id: '74164', pins: 14, out: [3, 4, 5, 6, 10, 11, 12, 13], vcc: 14, gnd: 7, group: 'sequential', seq: { v: 8, clk: 1 },
    title: '8 bit seri giriş, paralel çıkış kaydırmalı yazmaç',
    description:
      'CLK 0 → 1 olurken A·B QA\'ya girer, QA..QG bir basamak kayar (QA → QB → … → QH). '
      + 'CLR\' = 0 saatten bağımsız sıfırlar.',
    names: ['A', 'B', 'QA', 'QB', 'QC', 'QD', 'CLK', 'CLR\'', 'QE', 'QF', 'QG', 'QH'],
    labels: ['A', 'B', 'QA', 'QB', 'QC', 'QD', 'CK', 'CLR', 'QE', 'QF', 'QG', 'QH'],
  }, (g, s, st) => {
    // Evolution Ttl74164: the clock is sampled first; the shift reads the chip's own output pins (the stored
    // values, unknown while they still float after a power-up); v[0] = QA .. v[7] = QH
    const triggered = clockEdge(st, 0, g(8));
    if (lo(g(9))) st.v = Array<SignalValue>(8).fill(0);
    else if (triggered) st.v = [lvlOf(hi(g(1)) && hi(g(2))), ...st.v.slice(0, 7).map((q) => (st.off ? 'X' : q))];
    [3, 4, 5, 6, 10, 11, 12, 13].forEach((pin, i) => s(pin, drive(st.v[i])));
  }),
  msi({
    id: '74165', pins: 16, out: [7, 9], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 8, clk: 1 },
    title: '8 bit paralel giriş, seri çıkış kaydırmalı yazmaç',
    description:
      'SH/LD\' = 0 iken P0..P7 saatten bağımsız yüklenir. SH/LD\' = 1 ve CLK INH = 0 iken CLK 0 → 1 olunca '
      + 'SER P0 basamağına girer, değerler P7\'ye doğru kayar; Q7 son basamağı, Q7\' tersini gösterir.',
    names: ['SH/LD\'', 'CLK', 'P4', 'P5', 'P6', 'P7', 'Q7\'', 'Q7', 'SER', 'P0', 'P1', 'P2', 'P3', 'CLK INH'],
    labels: ['SL', 'CK', 'P4', 'P5', 'P6', 'P7', 'Q7\'', 'Q7', 'SER', 'P0', 'P1', 'P2', 'P3', 'INH'],
  }, (g, s, st) => {
    // Evolution Ttl74165: the clock is sampled first; v[0] = the Q7 stage .. v[7] = the P0 stage
    const triggered = clockEdge(st, 0, g(2));
    if (lo(g(1))) st.v = [6, 5, 4, 3, 14, 13, 12, 11].map(g);
    else if (triggered && lo(g(15))) st.v = [...st.v.slice(1), g(10)];
    s(7, not(st.v[0]));
    s(9, drive(st.v[0]));
  }),
  msi({
    id: '74166', pins: 16, out: [13], vcc: 16, gnd: 8, group: 'sequential', seq: { v: 8, clk: 1 },
    title: '8 bit paralel/seri giriş, seri çıkış kaydırmalı yazmaç',
    description:
      'CLK INH = 0 iken CLK 0 → 1 olunca: SH/LD\' = 0 ise P0..P7 yüklenir, SH/LD\' = 1 ise SER P0 basamağına girer ve '
      + 'değerler P7\'ye doğru kayar. Q7 son basamağı gösterir. CLR\' = 0 saatten bağımsız sıfırlar.',
    names: ['SER', 'P0', 'P1', 'P2', 'P3', 'CLK INH', 'CLK', 'CLR\'', 'P4', 'P5', 'P6', 'Q7', 'P7', 'SH/LD\''],
    labels: ['SER', 'P0', 'P1', 'P2', 'P3', 'INH', 'CK', 'CLR', 'P4', 'P5', 'P6', 'Q7', 'P7', 'SL'],
  }, (g, s, st) => {
    // Evolution Ttl74166: the clock is sampled first; only CLK INH reading 1 inhibits; v[0] = the Q7 stage
    const triggered = clockEdge(st, 0, g(7));
    if (lo(g(9))) st.v = Array<SignalValue>(8).fill(0);
    else if (triggered && !hi(g(6))) {
      if (lo(g(15))) st.v = [14, 12, 11, 10, 5, 4, 3, 2].map(g);
      else if (hi(g(15))) st.v = [...st.v.slice(1), g(1)];
    }
    s(13, drive(st.v[0]));
  }),
  msi({
    id: '74299', pins: 20, out: [8, 17], inout: [4, 5, 6, 7, 13, 14, 15, 16], vcc: 20, gnd: 10, group: 'sequential',
    triState: true, seq: { v: 8, clk: 1 },
    title: '8 bit evrensel kaydırmalı yazmaç (ortak G/Ç yolu)',
    description:
      'Yükselen kenarda S1 S0 kipine göre: 00 bekle, 01 sağa kaydır (SR → A → B → … → H), 10 sola kaydır '
      + '(SL → H → G → … → A), 11 A..H bacaklarından paralel yükle. A..H hem giriş hem 3 durumlu çıkıştır: '
      + 'OE1\' = OE2\' = 0 ve kip 11 değilken yazmacı sürer, değilse boşta (Z). QA ve QH uç basamakların seri çıkışlarıdır. '
      + 'CLR\' = 0 saatten bağımsız sıfırlar.',
    names: ['S0', 'OE1\'', 'OE2\'', 'G', 'E', 'C', 'A', 'QA', 'CLR\'', 'SR', 'CLK', 'B', 'D', 'F', 'H', 'QH', 'SL', 'S1'],
    labels: ['S0', 'OE1', 'OE2', 'G', 'E', 'C', 'A', 'QA', 'CLR', 'SR', 'CK', 'B', 'D', 'F', 'H', 'QH', 'SL', 'S1'],
  }, (g, s, st) => {
    // Evolution Ttl74299: while CLR' reads 0 the register clears and the clock is not sampled; v[7] = A .. v[0] = H
    const io = [16, 4, 15, 5, 14, 6, 13, 7];
    if (lo(g(9))) st.v = Array<SignalValue>(8).fill(0);
    else if (clockEdge(st, 0, g(12))) {
      const mode = (hi(g(19)) ? 2 : 0) + (hi(g(1)) ? 1 : 0);
      if (mode === 3) st.v = io.map(g);
      else if (mode === 2) st.v = [g(18), ...st.v.slice(0, 7)];
      else if (mode === 1) st.v = [...st.v.slice(1), g(11)];
    }
    s(8, drive(st.v[7]));
    s(17, drive(st.v[0]));
    const enabled = lo(g(2)) && lo(g(3)) && (lo(g(1)) || lo(g(19)));
    io.forEach((pin, i) => s(pin, enabled ? drive(st.v[i]) : FLOAT));
  }),
  shiftStore('74594', false, '8 bit kaydırmalı yazmaç + çıkış yazmacı (iki clear)',
    'SRCLK 0 → 1 olurken SER QA basamağına girer, kaydırma yazmacı QH\'ye doğru kayar; QH\' son basamağı gösterir. '
    + 'RCLK 0 → 1 olurken kaydırma yazmacı çıkış yazmacına (QA..QH) kopyalanır; iki kenar birlikteyse kaymadan önceki değer '
    + 'kopyalanır. SRCLR\' = 0 kaydırma yazmacını, RCLR\' = 0 çıkış yazmacını saatten bağımsız sıfırlar.'),
  shiftStore('74595', true, '8 bit kaydırmalı yazmaç + çıkış yazmacı (3 durumlu çıkış)',
    'SRCLK 0 → 1 olurken SER QA basamağına girer, kaydırma yazmacı QH\'ye doğru kayar; QH\' son basamağı gösterir. '
    + 'RCLK 0 → 1 olurken kaydırma yazmacı çıkış yazmacına kopyalanır; iki kenar birlikteyse kaymadan önceki değer '
    + 'kopyalanır. SRCLR\' = 0 kaydırma yazmacını sıfırlar. QA..QH yalnız OE\' = 0 iken sürülür, değilse boşta (Z).'),
  msi({
    id: '744094', pins: 16, out: [4, 5, 6, 7, 9, 10, 11, 12, 13, 14], vcc: 16, gnd: 8, group: 'sequential', triState: true,
    seq: { v: 17, clk: 1 },
    title: '8 bit kaydırmalı yazmaç + mandal (3 durumlu çıkış)',
    description:
      'CP 0 → 1 olurken D QP0 basamağına girer, kaydırma yazmacı QP7\'ye doğru kayar; QS1 son basamağı gösterir, QS2 onu '
      + 'CP 1 → 0 olurken alır (yavaş saatli bir sonraki çipe zincir için). STR = 1 iken mandal kaydırma yazmacını izler, '
      + 'STR = 0 iken tutar. QP0..QP7 yalnız OE = 1 iken sürülür, değilse boşta (Z).',
    names: ['STR', 'D', 'CP', 'QP0', 'QP1', 'QP2', 'QP3', 'QS1', 'QS2', 'QP7', 'QP6', 'QP5', 'QP4', 'OE'],
    labels: ['STR', 'D', 'CP', 'QP0', 'QP1', 'QP2', 'QP3', 'QS1', 'QS2', 'QP7', 'QP6', 'QP5', 'QP4', 'OE'],
  }, (g, s, st) => {
    // Evolution Ttl744094: one remembered CP level gives both edges; v[0..7] = shift stages QP0..QP7, v[8..15] =
    // the latch, v[16] = QS2
    const old = st.clk[0];
    const cp = g(3);
    st.clk[0] = cp;
    if (old === 0 && cp === 1) st.v.splice(0, 8, g(2), ...st.v.slice(0, 7));
    if (old === 1 && cp === 0) st.v[16] = st.v[7];
    if (hi(g(1))) st.v.splice(8, 8, ...st.v.slice(0, 8));
    const enabled = hi(g(15));
    [4, 5, 6, 7, 14, 13, 12, 11].forEach((pin, i) => s(pin, enabled ? drive(st.v[8 + i]) : FLOAT));
    s(9, drive(st.v[7]));
    s(10, drive(st.v[16]));
  }),
];

export const TTL_CHIPS: Record<TtlChipId, TtlChip> = Object.fromEntries(CHIPS.map((c) => [c.id, c])) as Record<TtlChipId, TtlChip>;

export const TTL_TYPES = new Set<string>(TTL_CHIP_IDS.map((id) => `ttl${id}`));
export const isTtlType = (t: string): t is TtlType => TTL_TYPES.has(t);
/** Sequential TTL chips (they keep state between evaluations) */
export const TTL_SEQ_TYPES = new Set<string>(CHIPS.filter((c) => c.seq).map((c) => `ttl${c.id}`));
export const ttlChipOf = (t: string): TtlChip | undefined => (isTtlType(t) ? TTL_CHIPS[t.slice(3) as TtlChipId] : undefined);

// ---- Ports and geometry ------------------------------------------------------------------------------------

export interface TtlPort {
  /** Physical pin number */
  pin: number;
  key: string;
  name: string;
  /** 'inout' = evolution Port.INOUT: an output with key p<n> plus an input with key p<n>in (ttlInKey) */
  dir: 'input' | 'output' | 'inout';
}

export const ttlPinKey = (pin: number) => `p${pin}`;
/** Input half of an in/out pin */
export const ttlInKey = (pin: number) => `p${pin}in`;
/** Physical pin number of a pin key (p4, p4in) */
export const ttlPinOfKey = (key: string) => parseInt(key.slice(1), 10);

/** Evolution's ports: physical order without NC and power pins, then GND and VCC when they are shown */
export function ttlPorts(chip: TtlChip, vccGnd: boolean): TtlPort[] {
  const ports: TtlPort[] = [];
  let k = 0;
  for (let pin = 1; pin <= chip.pins; pin++) {
    if (chip.unused?.includes(pin) || pin === chip.vcc || pin === chip.gnd) continue;
    const dir = chip.out.includes(pin) ? 'output' : chip.inout?.includes(pin) ? 'inout' : 'input';
    ports.push({ pin, key: ttlPinKey(pin), name: chip.names[k] ?? String(pin), dir });
    k++;
  }
  if (vccGnd) {
    ports.push({ pin: chip.gnd, key: ttlPinKey(chip.gnd), name: 'GND', dir: 'input' });
    ports.push({ pin: chip.vcc, key: ttlPinKey(chip.vcc), name: 'VCC', dir: 'input' });
  }
  return ports;
}

export const TTL_HEIGHT = 60;

/** Package height: evolution's bounds are (0, -30, pins x 10, height) from the location */
export const ttlHeight = (chip: TtlChip) => chip.height ?? TTL_HEIGHT;

/**
 * Part box: the package rounded up to 20px (a 70 high package gets an 80 high box with the package at its
 * top) so the box centre, which the part rotates around, keeps every pin on the 10px grid
 */
export function ttlSize(chip: TtlChip): { width: number; height: number } {
  return { width: chip.pins * 10, height: Math.ceil(ttlHeight(chip) / 20) * 20 };
}

/** Pin point (unrotated, from the top-left corner): pins 1..n/2 left to right on the bottom edge, the rest right to left on top */
export function ttlPinPoint(chip: TtlChip, pin: number): { x: number; y: number } {
  const half = chip.pins / 2;
  const w = chip.pins * 10;
  return pin <= half ? { x: (pin - 1) * 20 + 10, y: ttlHeight(chip) } : { x: w - (pin - half - 1) * 20 - 10, y: 0 };
}

/**
 * Evolution's physical pin for one of ours. Evolution's 7476 keeps the default VCC 16 / GND 8 (we use the real
 * VCC 5 / GND 13), so there the pins are matched by name: its pins 5-7 and 13-15 are our 6-8 and 14-16.
 */
const EVO_PIN: Partial<Record<TtlChipId, Record<number, number>>> = {
  '7476': { 5: 16, 6: 5, 7: 6, 8: 7, 13: 8, 14: 13, 15: 14, 16: 15 },
};
export const ttlEvoPin = (chip: TtlChip, pin: number) => EVO_PIN[chip.id]?.[pin] ?? pin;
/** The chip's pins sit elsewhere in evolution (7476) */
export const ttlEvoRemapped = (chip: TtlChip) => !!EVO_PIN[chip.id];

/** Evolution connection point of one of our pins, relative to the .circ loc of an east-facing chip */
export function ttlEvoOffset(chip: TtlChip, pin: number): { x: number; y: number } {
  const p = ttlPinPoint(chip, ttlEvoPin(chip, pin));
  return { x: p.x, y: p.y - 30 };
}

// ---- Evaluation ------------------------------------------------------------------------------------------

/** A sequential chip's power-up state: stored values 0 (or `seq.init`), clock levels 0, outputs not driven yet */
export const ttlSeqInit = (chip: TtlChip): TtlSeqState => ({
  v: chip.seq?.init ? [...chip.seq.init] : Array<SignalValue>(chip.seq?.v ?? 0).fill(0),
  clk: Array<SignalValue>(chip.seq?.clk ?? 0).fill(0),
  off: true,
});

/**
 * Output values by pin key; `read` gives what an input pin reads (undriven = 'X'). A sequential chip updates `st`
 * in place; without power it keeps its state untouched (evolution skips propagateTtl).
 */
export function evalTtl(
  chip: TtlChip,
  vccGnd: boolean,
  read: (key: string) => SignalValue,
  st: TtlSeqState = ttlSeqInit(chip),
): Map<string, SignalValue> {
  const ports = ttlPorts(chip, false);
  const result = new Map<string, SignalValue>();
  if (vccGnd && (read(ttlPinKey(chip.gnd)) !== 0 || read(ttlPinKey(chip.vcc)) !== 1)) {
    for (const p of ports) if (p.dir !== 'input') result.set(p.key, FLOAT);
    if (chip.seq) st.off = true;
    return result;
  }
  // An in/out pin reads its net (the chip's own drive included, like evolution's getPortValue)
  const vals = ports.map((p) => read(p.dir === 'inout' ? ttlInKey(p.pin) : p.key));
  const outs = chip.eval(vals, st);
  delete st.off;
  ports.forEach((p, i) => {
    if (p.dir !== 'input' && outs[i] !== undefined) result.set(p.key, outs[i]!);
  });
  return result;
}
