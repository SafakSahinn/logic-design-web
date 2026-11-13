/**
 * HDL models of the TTL chips (Aşama 4e). Every chip type becomes one Verilog module / VHDL entity named
 * ttl<number>, written from a small expression tree so both languages come from the same model:
 * - ports are the physical pins in order (NC and power pins left out), named p<pin>_<datasheet name>; an in/out
 *   pin (7447 BI'/RBO') is an input p<pin>_<name>_i plus an output p<pin>_<name>_o on the same net, its built-in
 *   pull-up sits on that net in the parent module;
 * - two more inputs vcc / gnd: unless vcc = 1 and gnd = 0 every output floats (the chip's "VCC/GND pins"
 *   setting); with the setting off the instance ties them to 1 / 0;
 * - open-collector outputs drive 0 or float (Z), never 1.
 * The logic is the simulator's (ttlChips.ts eval) for defined inputs; `evalTtlModel` evaluates a model the same
 * way for the test rigs.
 */
import { COUNT_DOWN_190, COUNT_UP_190, ttlChipOf, ttlPorts, type TtlChip } from './ttlChips';

type Lang = 'verilog' | 'vhdl';

/** Expression tree: a physical pin (number), a named intermediate wire, a constant or an operator */
export type TExpr =
  | number
  | { k: 'w'; n: string }
  | { k: 'c'; v: 0 | 1 | 'z' }
  | { k: 'not'; a: TExpr }
  | { k: 'and' | 'or' | 'xor'; xs: TExpr[] }
  | { k: 'mux'; s: TExpr; a: TExpr; b: TExpr } // s = 1 -> a, s = 0 -> b
  | { k: 'pick'; sel: TExpr[]; data: TExpr[] } // sel MSB first, data[index]
  | { k: 'gt'; a: TExpr[]; b: TExpr[] } // unsigned a > b, MSB first
  | { k: 'is'; v: 0 | 1; a: TExpr }; // 1 while a is exactly v (evolution's == TRUE / == FALSE; x, z read as neither)

export interface TtlModel {
  /** Intermediate wires in order (each may use the earlier ones) */
  wires?: [string, TExpr][];
  /** Output pin -> its value */
  out: Record<number, TExpr>;
}

// ---- Builders ----------------------------------------------------------------------------------------------
const C0: TExpr = { k: 'c', v: 0 };
const C1: TExpr = { k: 'c', v: 1 };
const CZ: TExpr = { k: 'c', v: 'z' };
const W = (n: string): TExpr => ({ k: 'w', n });
const not = (a: TExpr): TExpr => ({ k: 'not', a });
const and = (...xs: TExpr[]): TExpr => ({ k: 'and', xs });
const or = (...xs: TExpr[]): TExpr => ({ k: 'or', xs });
const xor = (...xs: TExpr[]): TExpr => ({ k: 'xor', xs });
const nand = (...xs: TExpr[]) => not(and(...xs));
const nor = (...xs: TExpr[]) => not(or(...xs));
const xnor = (...xs: TExpr[]) => not(xor(...xs));
const mux = (s: TExpr, a: TExpr, b: TExpr): TExpr => ({ k: 'mux', s, a, b });
const pick = (sel: TExpr[], data: TExpr[]): TExpr => ({ k: 'pick', sel, data });
const gt = (a: TExpr[], b: TExpr[]): TExpr => ({ k: 'gt', a, b });
const is1 = (a: TExpr): TExpr => ({ k: 'is', v: 1, a });
const is0 = (a: TExpr): TExpr => ({ k: 'is', v: 0, a });
/** Open-collector output: pulls low while `low` is 1, floats otherwise */
const oc = (low: TExpr): TExpr => mux(low, C0, CZ);

type Gate = (...xs: TExpr[]) => TExpr;
const gates = (op: Gate, list: [number[], number][]): TtlModel => ({ out: Object.fromEntries(list.map(([ins, o]) => [o, op(...ins)])) });
/** 7400 pinout: 1A 1B -> 1Y (3), 2A 2B -> 2Y (6), 3A 3B -> 3Y (8), 4A 4B -> 4Y (11) */
const QUAD: [number[], number][] = [[[1, 2], 3], [[4, 5], 6], [[9, 10], 8], [[12, 13], 11]];
/** 7404 pinout */
const HEX: [number[], number][] = [[[1], 2], [[3], 4], [[5], 6], [[9], 8], [[11], 10], [[13], 12]];
/** 7410 pinout */
const TRIPLE: [number[], number][] = [[[1, 2, 13], 12], [[3, 4, 5], 6], [[9, 10, 11], 8]];
/** 7420 pinout */
const DUAL4: [number[], number][] = [[[1, 2, 4, 5], 6], [[9, 10, 12, 13], 8]];
const buf: Gate = (a) => a;

/** 7447 segment patterns a..g per digit, 1 = output high (segment off): evolution's DisplayDecoder */
const SEG7_OFF = [
  '0000001', '1001111', '0010010', '0000110', '1001100', '0100100', '1100000', '0001111',
  '0000000', '0001100', '1110010', '1100110', '1011100', '0110100', '1110000', '1111111',
];

/** 7442 / 7443 / 7444: output k (pins 1-7, 9-11) goes low for address code(k) on A3..A0 = 12 13 14 15 */
const DEC10_OUT = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11];
const decimal = (code: (k: number) => number): TtlModel => ({
  out: Object.fromEntries(DEC10_OUT.map((pin, k) => [pin, nand(...[15, 14, 13, 12].map((a, i) => ((code(k) >> i) & 1 ? a : not(a))))])),
});

/** Evolution's pal32L1 as gates: active-low sum of products, bit j of a product picks ins[j] */
const palT = (ins: TExpr[], products: number[]): TExpr =>
  nor(...products.map((p) => and(...ins.filter((_, j) => (p & (1 << j)) !== 0))));

/** 74240 / 74241 / 74244 channels: [enable pin, [A, Y] pairs] */
const OCT1: [number, number][] = [[2, 18], [4, 16], [6, 14], [8, 12]];
const OCT2: [number, number][] = [[11, 9], [13, 7], [15, 5], [17, 3]];
const octal = (invert: boolean, en2High: boolean): TtlModel => ({
  out: Object.fromEntries([
    ...OCT1.map(([a, y]) => [y, mux(1, CZ, invert ? not(a) : a)]),
    ...OCT2.map(([a, y]) => [y, en2High ? mux(19, a, CZ) : mux(19, CZ, invert ? not(a) : a)]),
  ]),
});
/** 74245 / 74640: A1..A8 on 2..9, B1..B8 on 18..11; DIR 1, OE' 19 */
const BUS_A = [2, 3, 4, 5, 6, 7, 8, 9];
const BUS_B = [18, 17, 16, 15, 14, 13, 12, 11];
// The direction / enable conditions are exact levels like the simulator's (74245: only OE' = 1 disables, DIR not 1
// means B -> A; 74640: enabled only by OE' = 0, a direction only for DIR = 0 / 1). With an x / z control the two
// directions never both open, so the two buses do not form a zero-delay loop in Verilog simulation.
const transceiver = (invert: boolean): TtlModel => ({
  wires: invert
    ? [['ab', and(is0(19), is1(1))], ['ba', and(is0(19), is0(1))]]
    : [['ab', and(not(is1(19)), is1(1))], ['ba', and(not(is1(19)), not(is1(1)))]],
  out: Object.fromEntries(
    BUS_A.flatMap((a, k) => {
      const b = BUS_B[k];
      const f = (x: number) => (invert ? not(x) : x);
      return [
        [a, mux(W('ba'), f(b), CZ)],
        [b, mux(W('ab'), f(a), CZ)],
      ];
    })
  ),
});

/** 74181: A0..A3 2 23 21 19, B0..B3 1 22 20 18, S0..S3 6 5 4 3, Cn 7, M 8; F0..F3 9 10 11 13, A=B 14, P' 15, Cn+4 16, G' 17 */
function alu181(): TtlModel {
  const l1: TExpr[] = [2, 23, 21, 19, 1, 22, 20, 18, not(1), not(22), not(20), not(18), 6, 5, 4, 3];
  const xs = [[0x8011, 0x4101], [0x8022, 0x4202], [0x8044, 0x4404], [0x8088, 0x4808]];
  const ys = [[0x2100, 0x1010, 0x1], [0x2200, 0x1020, 0x2], [0x2400, 0x1040, 0x4], [0x2800, 0x1080, 0x8]];
  const wires: [string, TExpr][] = [
    ...xs.map((t, i): [string, TExpr] => [`x${i}`, palT(l1, t)]),
    ...ys.map((t, i): [string, TExpr] => [`y${i}`, palT(l1, t)]),
  ];
  const l2: TExpr[] = [W('x0'), W('x1'), W('x2'), W('x3'), W('y0'), W('y1'), W('y2'), W('y3'), not(8), 7];
  const zs = [[0x300], [0x301, 0x110], [0x303, 0x112, 0x120], [0x307, 0x116, 0x124, 0x140]];
  wires.push(...zs.map((t, i): [string, TExpr] => [`z${i}`, palT(l2, t)]));
  wires.push(['g', palT(l2, [0x80, 0x48, 0x2c, 0x1e])]);
  wires.push(...[0, 1, 2, 3].map((i): [string, TExpr] => [`f${i}`, xor(W(`x${i}`), W(`y${i}`), W(`z${i}`))]));
  return {
    wires,
    out: {
      9: W('f0'), 10: W('f1'), 11: W('f2'), 13: W('f3'),
      14: mux(and(W('f0'), W('f1'), W('f2'), W('f3')), CZ, C0), // open collector: floats while F = 1111
      15: palT(l2, [0xf]),
      16: or(not(palT(l2, [0x20f])), not(W('g'))),
      17: W('g'),
    },
  };
}

/** 74381: A0..A3 3 1 19 17, B0..B3 4 2 18 16, S0..S2 5 6 7, Cn 15; F0..F3 8 9 11 12, G' 13, P' 14 */
function alu381(): TtlModel {
  const a = [3, 1, 19, 17];
  const b = [4, 2, 18, 16];
  const wires: [string, TExpr][] = [
    ['u', or(5, 6)],
    ['v', or(6, 7)],
    ['w', or(5, not(6))],
    ['xs', or(not(and(5, 6)), 7)],
    ['ys', or(and(5, 6), not(7))],
    ['zs', and(not(7), or(5, 6))],
  ];
  const l1: TExpr[] = [...a, ...a.map(not), ...b, ...b.map(not), W('ys'), W('xs'), W('w'), W('v'), W('u')];
  const js = [
    [0x000c1010, 0x00161001, 0x000a0110], [0x000c2020, 0x00162002, 0x000a0220],
    [0x000c4040, 0x00164004, 0x000a0440], [0x000c8080, 0x00168008, 0x000a0880],
  ];
  const ks = [
    [0x00131010, 0x000c1001, 0x000c0110, 0x00120101], [0x00132020, 0x000c2002, 0x000c0220, 0x00120202],
    [0x00134040, 0x000c4004, 0x000c0440, 0x00120404], [0x00138080, 0x000c8008, 0x000c0880, 0x00120808],
  ];
  wires.push(...js.map((t, i): [string, TExpr] => [`j${i}`, palT(l1, t)]));
  wires.push(...ks.map((t, i): [string, TExpr] => [`k${i}`, palT(l1, t)]));
  const l2: TExpr[] = [W('j0'), W('j1'), W('j2'), W('j3'), W('k0'), W('k1'), W('k2'), W('k3'), W('zs'), 15];
  const ls = [[0x300], [0x301, 0x111], [0x303, 0x113, 0x122], [0x307, 0x117, 0x126, 0x144]];
  wires.push(...ls.map((t, i): [string, TExpr] => [`l${i}`, palT(l2, t)]));
  return {
    wires,
    out: {
      8: xor(W('l0'), W('k0')), 9: xor(W('l1'), W('k1')), 11: xor(W('l2'), W('k2')), 12: xor(W('l3'), W('k3')),
      13: palT(l2, [0x88, 0x4c, 0x2e, 0x1f]),
      14: palT(l2, [0xf]),
    },
  };
}

const MODELS: Record<string, TtlModel> = {
  '7400': gates(nand, QUAD),
  '7402': gates(nor, [[[2, 3], 1], [[5, 6], 4], [[8, 9], 10], [[11, 12], 13]]),
  '7404': gates(not, HEX),
  '7405': gates((a) => oc(a), HEX), // input 1 pulls low, 0 floats
  '7408': gates(and, QUAD),
  '7410': gates(nand, TRIPLE),
  '7411': gates(and, TRIPLE),
  '7413': gates(nand, DUAL4),
  '7414': gates(not, HEX),
  '7418': gates(nand, DUAL4),
  '7419': gates(not, HEX),
  '7420': gates(nand, DUAL4),
  '7421': gates(and, DUAL4),
  '7424': gates(nand, QUAD),
  '7427': gates(nor, TRIPLE),
  '7430': gates(nand, [[[1, 2, 3, 4, 5, 6, 11, 12], 8]]),
  '7432': gates(or, QUAD),
  '7434': gates(buf, HEX),
  '7436': gates(nor, QUAD),
  '7438': gates((a, b) => oc(and(a, b)), QUAD),
  '7451': { out: { 6: nor(and(2, 3), and(4, 5)), 8: nor(and(1, 13), and(9, 10)) } },
  '7454': { out: { 8: nor(and(1, 13), and(2, 3), and(4, 5), and(9, 10)) } },
  '7458': { out: { 6: or(and(2, 3), and(4, 5)), 8: or(and(1, 13, 12), and(11, 10, 9)) } },
  '7464': { out: { 8: nor(and(2, 3), and(4, 5, 6), and(9, 10), and(11, 12, 13, 1)) } },
  '7486': gates(xor, QUAD),
  // B = 1: Y = C'; B = 0: Y = A when C = 1, A' when C = 0
  '7487': { out: Object.fromEntries([[2, 3], [5, 6], [10, 9], [13, 12]].map(([a, y]) => [y, mux(8, not(1), xnor(a, 1))])) },
  '74132': gates(nand, QUAD),
  '74266': gates((a, b) => oc(xor(a, b)), QUAD), // equal inputs float, differing pull low

  // 7447: A 7, B 1, C 2, D 6, LT' 3, BI'/RBO' 4 (in/out), RBI' 5; a..g on 13 12 11 10 9 15 14
  '7447': {
    wires: [
      ['zero', nor(7, 1, 2, 6)],
      ['blank_zero', and(not(5), W('zero'))],
    ],
    out: {
      ...Object.fromEntries(
        [13, 12, 11, 10, 9, 15, 14].map((pin, k) => [
          pin,
          // BI' = 0 blanks, LT' = 0 lights every segment, RBI' = 0 blanks a 0
          mux(not(4), C1, mux(not(3), C0, mux(W('blank_zero'), C1, pick([6, 2, 1, 7], SEG7_OFF.map((s) => (s[k] === '1' ? C1 : C0)))))),
        ])
      ),
      // RBO' pulls low while a 0 is blanked by RBI' (and LT' is not testing the lamps)
      4: mux(and(W('blank_zero'), 3), C0, CZ),
    },
  },
  // 7485: A 10 12 13 15, B 9 11 14 1 (bit 0..3); cascade I(A<B) 2, I(A=B) 3, I(A>B) 4; A>B 5, A=B 6, A<B 7
  '7485': {
    wires: [
      ['a_gt_b', gt([15, 13, 12, 10], [1, 14, 11, 9])],
      ['a_lt_b', gt([1, 14, 11, 9], [15, 13, 12, 10])],
    ],
    out: {
      5: mux(W('a_gt_b'), C1, mux(W('a_lt_b'), C0, and(not(3), not(2)))),
      6: and(not(W('a_gt_b')), not(W('a_lt_b')), 3),
      7: mux(W('a_lt_b'), C1, mux(W('a_gt_b'), C0, and(not(3), not(4)))),
    },
  },
  // 74138: A0 1, A1 2, A2 3, E1' 4, E2' 5, E3 6; Y0'..Y7' on 15 14 13 12 11 10 9 7
  '74138': {
    wires: [['en', and(6, not(4), not(5))]],
    out: Object.fromEntries(
      [15, 14, 13, 12, 11, 10, 9, 7].map((pin, i) => [pin, nand(W('en'), i & 4 ? 3 : not(3), i & 2 ? 2 : not(2), i & 1 ? 1 : not(1))])
    ),
  },
  // 74139: 1E' 1, 1A0 2, 1A1 3 -> 1Y0'..1Y3' 4..7; 2E' 15, 2A0 14, 2A1 13 -> 2Y0'..2Y3' 12 11 10 9
  '74139': {
    out: Object.fromEntries(
      ([[1, 2, 3, [4, 5, 6, 7]], [15, 14, 13, [12, 11, 10, 9]]] as [number, number, number, number[]][]).flatMap(([en, a0, a1, ys]) =>
        ys.map((pin, i) => [pin, nand(not(en), i & 2 ? a1 : not(a1), i & 1 ? a0 : not(a0))])
      )
    ),
  },
  // 74148: I0'..I7' on 10 11 12 13 1 2 3 4, EI' 5; A2' 6, A1' 7, A0' 9, GS' 14, EO' 15 (inputs active low)
  '74148': {
    wires: [
      ['en', not(5)],
      ['any', or(...[10, 11, 12, 13, 1, 2, 3, 4].map(not))],
      ['code2', or(not(4), not(3), not(2), not(1))],
      ['code1', or(not(4), not(3), and(2, 1, or(not(13), not(12))))],
      ['code0', or(not(4), and(3, not(2)), and(3, 1, not(13)), and(3, 1, 12, not(11)))],
    ],
    out: {
      6: nand(W('en'), W('code2')),
      7: nand(W('en'), W('code1')),
      9: nand(W('en'), W('code0')),
      14: nand(W('en'), W('any')),
      15: nand(W('en'), not(W('any'))),
    },
  },
  // 74151: D0..D7 on 4 3 2 1 15 14 13 12, S2 9, S1 10, S0 11, E' 7; Y 5, W 6
  '74151': {
    wires: [['d', pick([9, 10, 11], [4, 3, 2, 1, 15, 14, 13, 12])]],
    out: { 5: and(not(7), W('d')), 6: or(7, not(W('d'))) },
  },
  // 74153: S1 2, S0 14; 1E' 1, 1I0..1I3 6 5 4 3 -> 1Y 7; 2E' 15, 2I0..2I3 10 11 12 13 -> 2Y 9
  '74153': {
    out: {
      7: and(not(1), pick([2, 14], [6, 5, 4, 3])),
      9: and(not(15), pick([2, 14], [10, 11, 12, 13])),
    },
  },
  // 74157: S 1, E' 15; (I0, I1 -> Y): (2, 3 -> 4) (5, 6 -> 7) (11, 10 -> 9) (14, 13 -> 12)
  '74157': {
    out: Object.fromEntries(
      [[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].map(([a, b, y]) => [y, and(not(15), mux(1, b, a))])
    ),
  },
  // 74283: A0..A3 5 3 14 12, B0..B3 6 2 15 11, C0 7; S0..S3 4 1 13 10, C4 9 (ripple form of the same sum)
  '74283': {
    wires: [
      ['c1', or(and(5, 6), and(7, xor(5, 6)))],
      ['c2', or(and(3, 2), and(W('c1'), xor(3, 2)))],
      ['c3', or(and(14, 15), and(W('c2'), xor(14, 15)))],
    ],
    out: {
      4: xor(5, 6, 7),
      1: xor(3, 2, W('c1')),
      13: xor(14, 15, W('c2')),
      10: xor(12, 11, W('c3')),
      9: or(and(12, 11), and(W('c3'), xor(12, 11))),
    },
  },

  // ---- 4g ----
  '747266': gates(xnor, QUAD),
  // 1A 1B 1C 3 4 5 -> 1Y 6; 2A 2B 2C 1 2 8 -> 2Y 9; 3A 3B 3C 11 12 13 -> 3Y 10
  '744075': { out: { 6: or(3, 4, 5), 9: or(1, 2, 8), 10: or(11, 12, 13) } },
  '7442': decimal((k) => k),
  '7443': decimal((k) => k + 3),
  '7444': decimal((k) => [2, 6, 7, 5, 4, 12, 13, 15, 14, 10][k]),
  // 74158: S 1, E' 15; (I0, I1 -> Y'): (2, 3 -> 4) (5, 6 -> 7) (11, 10 -> 9) (14, 13 -> 12)
  '74158': { out: Object.fromEntries([[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].map(([a, b, y]) => [y, nand(not(15), mux(1, b, a))])) },
  // 74257: as 74158 without inversion, OE' 15 = 1 floats the outputs
  '74257': { out: Object.fromEntries([[2, 3, 4], [5, 6, 7], [11, 10, 9], [14, 13, 12]].map(([a, b, y]) => [y, mux(15, CZ, mux(1, b, a))])) },
  // 74125: (OE', A -> Y): (1, 2 -> 3) (4, 5 -> 6) (10, 9 -> 8) (13, 12 -> 11)
  '74125': { out: Object.fromEntries([[1, 2, 3], [4, 5, 6], [10, 9, 8], [13, 12, 11]].map(([oe, a, y]) => [y, mux(oe, CZ, a)])) },
  // 74365: OE1' 1, OE2' 15; (A -> Y): (2 3) (4 5) (6 7) (10 9) (12 11) (14 13)
  '74365': {
    wires: [['en', nor(1, 15)]],
    out: Object.fromEntries([[2, 3], [4, 5], [6, 7], [10, 9], [12, 11], [14, 13]].map(([a, y]) => [y, mux(W('en'), a, CZ)])),
  },
  '74240': octal(true, false),
  '74241': octal(false, true),
  '74244': octal(false, false),
  // 74541: OE1' 1, OE2' 19; A1..A8 2..9 -> Y1..Y8 18..11
  '74541': {
    wires: [['en', nor(1, 19)]],
    out: Object.fromEntries(BUS_A.map((a, k) => [BUS_B[k], mux(W('en'), a, CZ)])),
  },
  '74245': transceiver(false),
  '74640': transceiver(true),
  // 74688: E' 1; P0..P7 2 4 6 8 11 13 15 17, Q0..Q7 3 5 7 9 12 14 16 18; P=Q' 19
  '74688': {
    out: { 19: nand(not(1), ...[[2, 3], [4, 5], [6, 7], [8, 9], [11, 12], [13, 14], [15, 16], [17, 18]].map(([p, q]) => xnor(p, q))) },
  },
  '74181': alu181(),
  // 74182: G0'..G3' 3 1 14 5, P0'..P3' 4 2 15 6, Cn 13; P' 7, G' 10, Cn+x 12, Cn+y 11, Cn+z 9
  '74182': {
    wires: [
      ['p0', not(4)], ['p1', not(2)], ['p2', not(15)], ['p3', not(6)],
      ['g0', not(3)], ['g1', not(1)], ['g2', not(14)], ['g3', not(5)],
    ],
    out: {
      7: nand(W('p3'), W('p2'), W('p1'), W('p0')),
      10: nor(W('g3'), and(W('p3'), W('g2')), and(W('p3'), W('p2'), W('g1')), and(W('p3'), W('p2'), W('p1'), W('g0'))),
      12: or(W('g0'), and(W('p0'), 13)),
      11: or(W('g1'), and(W('p1'), W('g0')), and(W('p1'), W('p0'), 13)),
      9: or(W('g2'), and(W('p2'), W('g1')), and(W('p2'), W('p1'), W('g0')), and(W('p2'), W('p1'), W('p0'), 13)),
    },
  },
  '74381': alu381(),
};

// ---- Sequential chips (Aşama 4e-2) -------------------------------------------------------------------------
//
// Both languages follow the simulator (ttlChips.ts, evolution's chips) step by step:
// - power is exactly vcc = 1 and gnd = 0; without it nothing changes (state and clock tracking frozen);
// - an input counts as 1 / 0 only when it is exactly 1 / 0 (evolution's == TRUE / == FALSE; x, z read as neither);
// - the clock edge is a clean 0 -> 1 (7476: 1 -> 0) step of the level the chip last sampled (it starts at 0). The
//   chip samples its clock only while powered (74194: also while MR' is not 0), so power returning, or the 74194's
//   MR' going high, with the clock already at 1 is an edge, as in the simulator.
//
// VHDL (and Verilog under SYNTHESIS): the sampled clock is a latch of the clock pin, open while the chip samples
// it; every asynchronous outcome is a clean 0 / 1 flag of its own (releasing one of two active controls lets the
// other act at once), all written straight from the pins, so delta cycles never see a stale mix.
// Verilog simulation: zero-delay nets settle in no fixed order, so flags built from several pins glitch when those
// pins change together. There the chip is one process that waits for its inputs to settle (#0) and then does
// the simulator's evaluation.

interface SeqCtx {
  v: boolean;
  /** Input / output port name of a physical pin */
  i: (pin: number) => string;
  o: (pin: number) => string;
  /** Input port names (pins, vcc, gnd) */
  ins: string[];
  /** Shared declarations and statements (state, outputs) */
  decls: string[];
  body: string[];
  /** The structural model: VHDL, Verilog synthesis */
  syn: { decls: string[]; body: string[] };
  /** Verilog simulation model */
  sim: { decls: string[]; body: string[] };
}

/** Condition that a pin / signal is exactly (`eq`) or not exactly (`!eq`) 0 / 1 */
const isv = (c: SeqCtx, x: string, val: 0 | 1, eq = true) =>
  c.v ? `(${x} ${eq ? '===' : '!=='} 1'b${val})` : `${x} ${eq ? '=' : '/='} '${val}'`;
/** Conditions that all hold: a clean 1-bit value in Verilog (&), a boolean in VHDL */
const allOf = (c: SeqCtx, xs: string[]) => xs.join(c.v ? ' & ' : ' and ');
/** The same as a Verilog if condition (&&) */
const allIf = (c: SeqCtx, xs: string[]) => xs.join(c.v ? ' && ' : ' and ');
/** The power condition written from the pins */
const powered = (c: SeqCtx) => [isv(c, 'vcc', 1), isv(c, 'gnd', 0)];
const bit = (c: SeqCtx, x: 0 | 1 | 'x') => (c.v ? `1'b${x}` : `'${x === 'x' ? 'X' : x}'`);

/** A stored signal starting at 0 (shared by both models) */
function seqReg(c: SeqCtx, name: string, width = 1, vhdlType?: string) {
  if (c.v) c.decls.push(`  reg ${width > 1 ? `[${width - 1}:0] ` : ''}${name} = ${width}'b0;`);
  else c.decls.push(`  signal ${name} : ${vhdlType ?? (width > 1 ? `std_logic_vector(${width - 1} downto 0)` : 'std_logic')} := ${width > 1 ? "(others => '0')" : "'0'"};`);
}

/** Structural model: a clean 0 / 1 flag, 1 while every condition holds */
function seqFlag(c: SeqCtx, name: string, conds: string[]) {
  const all = allOf(c, [...powered(c), ...conds]);
  if (c.v) {
    c.syn.decls.push(`  wire ${name};`);
    c.syn.body.push(`  assign ${name} = ${all};`);
  } else {
    c.syn.decls.push(`  signal ${name} : std_logic;`);
    c.syn.body.push(`  ${name} <= '1' when ${all} else '0';`);
  }
}

/** Structural model: the clock level the chip samples, following pin `clk` while powered and `en` holds */
function seqClock(c: SeqCtx, name: string, clk: string, en: string[] = []) {
  const all = c.v ? allIf(c, [...powered(c), ...en]) : allOf(c, [...powered(c), ...en]);
  if (c.v) {
    c.syn.decls.push(`  reg ${name} = 1'b0;`);
    c.syn.body.push(`  always @(*) if (${all}) ${name} = ${clk};`);
  } else {
    c.syn.decls.push(`  signal ${name} : std_logic := '0';`);
    c.syn.body.push(`  ${name} <= ${clk} when ${all} else ${name};`);
  }
}

const indent = (ls: string[], n: number) => ls.map((l) => ' '.repeat(n) + l);

/** Structural model: one clocked process, the asynchronous flags in priority order, else the clock edge statements */
function seqProc(c: SeqCtx, ck: string, falling: boolean, asyncs: [string, string[]][], edge: string[]) {
  const lines: string[] = [];
  if (c.v) {
    const events = [`${falling ? 'negedge' : 'posedge'} ${ck}`, ...asyncs.map(([f]) => `posedge ${f}`)];
    asyncs.forEach(([f, st], k) => lines.push(`${k ? 'end else ' : ''}if (${f}) begin`, ...indent(st, 2)));
    if (asyncs.length) lines.push('end else begin', ...indent(edge, 2), 'end');
    else lines.push(...edge);
    c.syn.body.push(`  always @(${events.join(' or ')}) begin`, ...indent(lines, 4), '  end');
  } else {
    asyncs.forEach(([f, st], k) => lines.push(`${k ? 'elsif' : 'if'} ${f} = '1' then`, ...indent(st, 2)));
    lines.push(`${asyncs.length ? 'elsif' : 'if'} ${falling ? 'falling_edge' : 'rising_edge'}(${ck}) then`, ...indent(edge, 2), 'end if;');
    c.syn.body.push(`  process (${[ck, ...asyncs.map(([f]) => f)].join(', ')})`, '  begin', ...indent(lines, 4), '  end process;');
  }
}

/**
 * Verilog simulation model: after any input change and once the nets have settled, the simulator's evaluation
 * (`lines`, blocking assignments) runs while the chip is powered; `regs` are its sampled clock levels / temporaries
 */
function seqSim(c: SeqCtx, regs: string[], lines: string[]) {
  if (!c.v) return;
  c.sim.decls.push(...regs.map((r) => `  reg ${r};`));
  c.sim.body.push(
    `  always @(${c.ins.join(' or ')}) begin`,
    '    #0; // girişler otursun',
    `    if (${allIf(c, powered(c))}) begin`,
    ...indent(lines, 6),
    '    end',
    '  end'
  );
}

/** An output pin: `e` while powered, floating otherwise */
function seqOut(c: SeqCtx, pin: number, e: string) {
  c.body.push(c.v ? `  assign ${c.o(pin)} = pwr ? ${e} : 1'bz;` : `  ${c.o(pin)} <= ${e} when pwr = '1' else 'Z';`);
}

/** If-chain over [condition, statements]; conditions written with isv / allIf */
function seqIfs(c: SeqCtx, arms: [string, string[]][], els?: string[]): string[] {
  const out: string[] = [];
  arms.forEach(([cond, st], k) => {
    if (c.v) out.push(`${k ? 'end else ' : ''}if ${/^\([^()]*\)$/.test(cond) ? cond : `(${cond})`} begin`, ...indent(st, 2));
    else out.push(`${k ? 'elsif' : 'if'} ${cond} then`, ...indent(st, 2));
  });
  if (els) out.push(c.v ? 'end else begin' : 'else', ...indent(els, 2));
  out.push(c.v ? 'end' : 'end if;');
  return out;
}

/** Verilog simulation model: `e` = a clean step of clock `clk` from the sampled level `s`, which then follows it */
const simEdge = (c: SeqCtx, e: string, s: string, clk: string, falling = false) => [
  `${e} = ${isv(c, s, falling ? 1 : 0)} && ${isv(c, clk, falling ? 0 : 1)};`,
  `${s} = ${clk};`,
];

/** Shared part of the two flip-flop chips: Q / Q' outputs, the async flags and the sim model's async chain */
function flipFlop(
  c: SeqCtx,
  n: number,
  pins: { clk: number; pre: number; clr: number; q: number; qn: number },
  falling: boolean,
  edge: (op: '<=' | '=') => string[]
) {
  const [clk, pre, clr] = [c.i(pins.clk), c.i(pins.pre), c.i(pins.clr)];
  const q = `q${n}`;
  seqReg(c, q);
  seqClock(c, `ck${n}`, clk);
  // Both PRE' and CLR' at 0: unknown (in the simulator Q floats, Q' is E)
  seqFlag(c, `both${n}`, [isv(c, clr, 0), isv(c, pre, 0)]);
  seqFlag(c, `clr${n}`, [isv(c, clr, 0), isv(c, pre, 0, false)]);
  seqFlag(c, `set${n}`, [isv(c, pre, 0), isv(c, clr, 0, false)]);
  seqProc(
    c,
    `ck${n}`,
    falling,
    [
      [`both${n}`, [`${q} <= ${bit(c, 'x')};`]],
      [`clr${n}`, [`${q} <= ${bit(c, 0)};`]],
      [`set${n}`, [`${q} <= ${bit(c, 1)};`]],
    ],
    edge('<=')
  );
  seqSim(c, [`s_ck${n} = 1'b0`, `e${n}`], [
    ...simEdge(c, `e${n}`, `s_ck${n}`, clk, falling),
    ...seqIfs(c, [
      [allIf(c, [isv(c, clr, 0), isv(c, pre, 0)]), [`${q} = 1'bx;`]],
      [isv(c, clr, 0), [`${q} = 1'b0;`]],
      [isv(c, pre, 0), [`${q} = 1'b1;`]],
      [`e${n}`, edge('=')],
    ]),
  ]);
  seqOut(c, pins.q, q);
  seqOut(c, pins.qn, c.v ? `~${q}` : `not ${q}`);
}

/** A function both models use (Verilog: declared in each branch; VHDL: in the architecture) */
function seqFn(c: SeqCtx, verilog: string[], vhdl: string[]) {
  if (c.v) {
    c.syn.decls.push(...verilog);
    c.sim.decls.push(...verilog);
  } else c.decls.push(...vhdl);
}

/**
 * 74161 / 74163 parallel load D3..D0 (pins 6..3): a D bit that is neither 0 nor 1 counts as -1 (evolution's
 * toLongValue), the sum taken mod 16. A function read inside the process: a signal in between would lag the
 * clock by a delta in VHDL
 */
function loadSum(c: SeqCtx): string {
  seqFn(
    c,
    ['  function [3:0] dv;', '    input b;', "    dv = (b === 1'b1) ? 4'd1 : (b === 1'b0) ? 4'd0 : 4'd15;", '  endfunction'],
    [
      '  function dv(b : std_logic) return unsigned is',
      '  begin',
      "    if b = '1' then",
      '      return "0001";',
      "    elsif b = '0' then",
      '      return "0000";',
      '    end if;',
      '    return "1111";',
      '  end function;',
    ]
  );
  const [d0, d1, d2, d3] = [3, 4, 5, 6].map((pin) => `dv(${c.i(pin)})`);
  return c.v ? `${d0} + (${d1} << 1) + (${d2} << 2) + (${d3} << 3)` : `${d0} + shift_left(${d1}, 1) + shift_left(${d2}, 2) + shift_left(${d3}, 3)`;
}

/** A stored bit of the structural model only (the Verilog simulation model keeps its own state) */
function synReg(c: SeqCtx, name: string) {
  if (c.v) c.syn.decls.push(`  reg ${name} = 1'b0;`);
  else c.decls.push(`  signal ${name} : std_logic := '0';`);
}

/** A net both models drive (Verilog: declared once, assigned in each branch) */
function seqWire(c: SeqCtx, name: string, width = 1) {
  if (c.v) c.decls.push(`  wire ${width > 1 ? `[${width - 1}:0] ` : ''}${name};`);
  else c.decls.push(`  signal ${name} : ${width > 1 ? `std_logic_vector(${width - 1} downto 0)` : 'std_logic'};`);
}
/** Continuous assignment of the structural model / of the Verilog simulation model */
const synSet = (c: SeqCtx, lhs: string, rhs: string) => c.syn.body.push(c.v ? `  assign ${lhs} = ${rhs};` : `  ${lhs} <= ${rhs};`);
const simSet = (c: SeqCtx, lhs: string, rhs: string) => {
  if (c.v) c.sim.body.push(`  assign ${lhs} = ${rhs};`);
};

const idx = (c: SeqCtx, x: string, k: number) => (c.v ? `${x}[${k}]` : `${x}(${k})`);
const zero = (c: SeqCtx, x: string, width: number, op: '<=' | '=' = '<=') =>
  c.v ? `${x} ${op} ${width}'d0;` : `${x} <= (others => '0');`;

/** n-bit binary counter `r` (unsigned), one step on the falling edge of pin `cp`, cleared while pin `mr` is 1 */
function binCounter(c: SeqCtx, r: string, width: number, cp: number, mr: number) {
  const [CP, MR] = [c.i(cp), c.i(mr)];
  seqReg(c, r, width, `unsigned(${width - 1} downto 0)`);
  seqClock(c, `ck_${r}`, CP);
  seqFlag(c, `rst_${r}`, [isv(c, MR, 1)]);
  seqProc(c, `ck_${r}`, true, [[`rst_${r}`, [zero(c, r, width)]]], [c.v ? `${r} <= ${r} + ${width}'d1;` : `${r} <= ${r} + 1;`]);
  seqSim(c, [`s_${r} = 1'b0`, `e_${r}`], [
    ...simEdge(c, `e_${r}`, `s_${r}`, CP, true),
    ...seqIfs(c, [
      [isv(c, MR, 1), [zero(c, r, width, '=')]],
      [`e_${r}`, [`${r} = ${r} + ${width}'d1;`]],
    ]),
  ]);
}

const SEQ: Partial<Record<string, (c: SeqCtx) => void>> = {
  // Two D flip-flops: (CLR', D, CLK, PRE', Q, Q') = (1, 2, 3, 4, 5, 6) and (13, 12, 11, 10, 9, 8)
  '7474': (c) => {
    ([[1, 2, 3, 4, 5, 6], [13, 12, 11, 10, 9, 8]] as const).forEach(([clr, d, clk, pre, q, qn], k) =>
      flipFlop(c, k + 1, { clk, pre, clr, q, qn }, false, (op) => [`q${k + 1} ${op} ${c.i(d)};`])
    );
  },
  // Two JK flip-flops, falling edge: (CLK, PRE', CLR', J, K, Q, Q') = (1, 2, 3, 4, 16, 15, 14) and (6, 7, 8, 9, 12, 11, 10)
  '7476': (c) => {
    ([[1, 2, 3, 4, 16, 15, 14], [6, 7, 8, 9, 12, 11, 10]] as const).forEach(([clk, pre, clr, j, kk, q, qn], k) => {
      const [J, K, Q] = [c.i(j), c.i(kk), `q${k + 1}`];
      // J / K count only when exactly 1 / 0; J = K = 0 (or an unknown) keeps Q
      const edge = (op: '<=' | '=') =>
        seqIfs(c, [
          [allIf(c, [isv(c, J, 1), isv(c, K, 1)]), [`${Q} ${op} ${c.v ? '~' : 'not '}${Q};`]],
          [allIf(c, [isv(c, J, 1), isv(c, K, 0)]), [`${Q} ${op} ${bit(c, 1)};`]],
          [allIf(c, [isv(c, J, 0), isv(c, K, 1)]), [`${Q} ${op} ${bit(c, 0)};`]],
        ]);
      flipFlop(c, k + 1, { clk, pre, clr, q, qn }, true, edge);
    });
  },
  // 4-bit counter: MR' 1, CLK 2, D0..D3 3..6, CEP 7, SPE' 9, CET 10; Q3..Q0 11..14, TC 15
  '74161': (c) => {
    const [mr, clk, cep, spe, cet] = [1, 2, 7, 9, 10].map(c.i);
    seqReg(c, 'cnt', 4, 'unsigned(3 downto 0)');
    const ld = loadSum(c);
    const count = (op: '<=' | '=') =>
      seqIfs(c, [
        [isv(c, spe, 0), [`cnt ${op} ${ld};`]],
        [allIf(c, [isv(c, cep, 1), isv(c, cet, 1)]), [c.v ? `cnt ${op} cnt + 4'd1;` : 'cnt <= cnt + 1;']],
      ]);
    seqClock(c, 'ck', clk);
    seqFlag(c, 'clr', [isv(c, mr, 0)]);
    seqProc(c, 'ck', false, [['clr', [c.v ? "cnt <= 4'd0;" : "cnt <= (others => '0');"]]], count('<='));
    seqSim(c, ["s_ck = 1'b0", 'e'], [
      ...simEdge(c, 'e', 's_ck', clk),
      ...seqIfs(c, [
        [isv(c, mr, 0), ["cnt = 4'd0;"]],
        ['e', count('=')],
      ]),
    ]);
    [14, 13, 12, 11].forEach((pin, k) => seqOut(c, pin, c.v ? `cnt[${k}]` : `cnt(${k})`));
    seqOut(c, 15, c.v ? `${cet} & (&cnt)` : `${cet} and cnt(0) and cnt(1) and cnt(2) and cnt(3)`);
  },
  // 4-bit shift register: MR' 1, DSR 2, D0..D3 3..6, DSL 7, S0 9, S1 10, CLK 11; Q3..Q0 12..15 (q[0] = Q0)
  '74194': (c) => {
    const [mr, dsr, dsl, s0, s1, clk] = [1, 2, 7, 9, 10, 11].map(c.i);
    const d = [3, 4, 5, 6].map(c.i);
    seqReg(c, 'q', 4);
    const shift = (op: '<=' | '=') =>
      seqIfs(c, [
        [allIf(c, [isv(c, s1, 1), isv(c, s0, 1)]), [c.v ? `q ${op} {${[...d].reverse().join(', ')}};` : `q <= ${[...d].reverse().join(' & ')};`]],
        [allIf(c, [isv(c, s1, 1, false), isv(c, s0, 1)]), [c.v ? `q ${op} {q[2:0], ${dsr}};` : `q <= q(2 downto 0) & ${dsr};`]],
        [allIf(c, [isv(c, s1, 1), isv(c, s0, 1, false)]), [c.v ? `q ${op} {${dsl}, q[3:1]};` : `q <= ${dsl} & q(3 downto 1);`]],
      ]);
    // While MR' is 0 the register clears and the clock is not sampled
    seqClock(c, 'ck', clk, [isv(c, mr, 0, false)]);
    seqFlag(c, 'clr', [isv(c, mr, 0)]);
    seqProc(c, 'ck', false, [['clr', [c.v ? "q <= 4'b0000;" : "q <= (others => '0');"]]], shift('<='));
    seqSim(c, ["s_ck = 1'b0", 'e'], [
      ...seqIfs(c, [
        [isv(c, mr, 0), ["q = 4'b0000;"]],
      ], [...simEdge(c, 'e', 's_ck', clk), ...seqIfs(c, [['e', shift('=')]])]),
    ]);
    [15, 14, 13, 12].forEach((pin, k) => seqOut(c, pin, c.v ? `q[${k}]` : `q(${k})`));
  },

  // ---- 4h: counters ----------------------------------------------------------------------------------------
  // 7493: CKB 1, R0(1) 2, R0(2) 3; QC 8, QB 9, QD 11, QA 12; CKA 14. QA toggles on CKA's falling edge, QB..QD
  // (qh[0] = QB) count on CKB's; R0(1) = R0(2) = 1 clears both
  '7493': (c) => {
    const [ckb, r1, r2, cka] = [1, 2, 3, 14].map(c.i);
    seqReg(c, 'qa');
    seqReg(c, 'qh', 3, 'unsigned(2 downto 0)');
    seqClock(c, 'ca', cka);
    seqClock(c, 'cb', ckb);
    seqFlag(c, 'rst', [isv(c, r1, 1), isv(c, r2, 1)]);
    seqProc(c, 'ca', true, [['rst', [`qa <= ${bit(c, 0)};`]]], [c.v ? 'qa <= ~qa;' : 'qa <= not qa;']);
    seqProc(c, 'cb', true, [['rst', [zero(c, 'qh', 3)]]], [c.v ? "qh <= qh + 3'd1;" : 'qh <= qh + 1;']);
    seqSim(c, ["s_ca = 1'b0", "s_cb = 1'b0", 'ea', 'eb'], [
      ...simEdge(c, 'ea', 's_ca', cka, true),
      ...simEdge(c, 'eb', 's_cb', ckb, true),
      ...seqIfs(c, [[allIf(c, [isv(c, r1, 1), isv(c, r2, 1)]), ["qa = 1'b0;", "qh = 3'd0;"]]], [
        ...seqIfs(c, [['ea', ['qa = ~qa;']]]),
        ...seqIfs(c, [['eb', ["qh = qh + 3'd1;"]]]),
      ]),
    ]);
    seqOut(c, 12, 'qa');
    [9, 8, 11].forEach((pin, k) => seqOut(c, pin, idx(c, 'qh', k)));
  },
  // 74161 with a synchronous MR': everything happens on the clock edge
  '74163': (c) => {
    const [mr, clk, cep, spe, cet] = [1, 2, 7, 9, 10].map(c.i);
    seqReg(c, 'cnt', 4, 'unsigned(3 downto 0)');
    const ld = loadSum(c);
    const count = (op: '<=' | '=') =>
      seqIfs(c, [
        [isv(c, mr, 0), [zero(c, 'cnt', 4, op)]],
        [isv(c, spe, 0), [`cnt ${op} ${ld};`]],
        [allIf(c, [isv(c, cep, 1), isv(c, cet, 1)]), [c.v ? `cnt ${op} cnt + 4'd1;` : 'cnt <= cnt + 1;']],
      ]);
    seqClock(c, 'ck', clk);
    seqProc(c, 'ck', false, [], count('<='));
    seqSim(c, ["s_ck = 1'b0", 'e'], [...simEdge(c, 'e', 's_ck', clk), ...seqIfs(c, [['e', count('=')]])]);
    [14, 13, 12, 11].forEach((pin, k) => seqOut(c, pin, idx(c, 'cnt', k)));
    seqOut(c, 15, c.v ? `${cet} & (&cnt)` : `${cet} and cnt(0) and cnt(1) and cnt(2) and cnt(3)`);
  },
  // 74190: D1 1, Q1 2, Q0 3, CE' 4, U'/D 5, Q2 6, Q3 7, D3 9, D2 10, PL' 11, TC 12, RC' 13, CP 14, D0 15.
  // The simulator (evolution) tries every value its unknown inputs and stored bits could have and makes the bits
  // that differ unknown. Verilog simulation: the same search. Structural model: one flip-flop per bit, PL' = 0
  // sets / clears it at once (an unknown D or PL' leaves it x), counting on the clock edge while CE' is 0.
  '74190': (c) => {
    const [ce, du, pl, cp] = [4, 5, 11, 14].map(c.i);
    const D = [15, 1, 10, 9].map(c.i);
    const Q = [3, 2, 6, 7];
    const tabV = (name: string, body: string[]) => ['  function [3:0] ' + name + ';', '    input [3:0] q;', '    input d;', ...body, '  endfunction'];
    const nxV = tabV('nx190', [
      '    case (q)',
      ...COUNT_UP_190.map((u, k) => `      4'd${k}: nx190 = d ? 4'd${COUNT_DOWN_190[k]} : 4'd${u};`),
      "      default: nx190 = 4'bxxxx;",
      '    endcase',
    ]);
    seqWire(c, 'cq', 4);
    seqWire(c, 'fl', 2);
    if (c.v) {
      c.syn.decls.push(...nxV, '  wire [3:0] nxt;');
      c.sim.decls.push(
        ...nxV,
        // {Q3..Q0, D3..D0, U'/D, CE', PL'}: bit k of the mask m is the value tried for source k
        '  function [3:0] cnt190;',
        '    input [10:0] s;',
        '    input t;',
        '    integer m, k;',
        '    reg ok, any;',
        '    reg [3:0] r, first, diff;',
        '    begin',
        "      any = 1'b0; first = 4'd0; diff = 4'd0;",
        '      for (m = 0; m < 2048; m = m + 1) begin',
        "        ok = 1'b1;",
        '        for (k = 0; k < 11; k = k + 1)',
        "          if ((s[k] === 1'b1 && !m[k]) || (s[k] === 1'b0 && m[k])) ok = 1'b0;",
        '        if (ok) begin',
        '          if (!m[0]) r = m[6:3];',
        '          else if (t && !m[1]) r = nx190(m[10:7], m[2]);',
        '          else r = m[10:7];',
        '          if (!any) first = r; else diff = diff | (r ^ first);',
        "          any = 1'b1;",
        '        end',
        '      end',
        "      for (k = 0; k < 4; k = k + 1) if (diff[k]) first[k] = 1'bx;",
        '      cnt190 = first;',
        '    end',
        '  endfunction',
        // {Q3..Q0, CP, U'/D, CE'} -> {RC', TC}
        '  function [1:0] fl190;',
        '    input [6:0] s;',
        '    integer m, k;',
        '    reg ok, any, tm;',
        '    reg [1:0] r, first, diff;',
        '    begin',
        "      any = 1'b0; first = 2'd0; diff = 2'd0;",
        '      for (m = 0; m < 128; m = m + 1) begin',
        "        ok = 1'b1;",
        '        for (k = 0; k < 7; k = k + 1)',
        "          if ((s[k] === 1'b1 && !m[k]) || (s[k] === 1'b0 && m[k])) ok = 1'b0;",
        '        if (ok) begin',
        "          tm = m[1] ? (m[6:3] == 4'd0) : (m[3] && m[6]);",
        '          r = {~(tm && !m[0] && !m[2]), tm};',
        '          if (!any) first = r; else diff = diff | (r ^ first);',
        "          any = 1'b1;",
        '        end',
        '      end',
        "      for (k = 0; k < 2; k = k + 1) if (diff[k]) first[k] = 1'bx;",
        '      fl190 = first;',
        '    end',
        '  endfunction',
        "  reg [3:0] qs = 4'd0;"
      );
    } else {
      c.decls.push(
        '  type tab190 is array (0 to 15) of natural;',
        `  constant UP190 : tab190 := (${COUNT_UP_190.join(', ')});`,
        `  constant DN190 : tab190 := (${COUNT_DOWN_190.join(', ')});`,
        '  -- m is a value the sources s could have: bit k of m stands for s(k), a 0 / 1 source must match it',
        '  function fits(s : std_logic_vector; m : natural) return boolean is',
        '  begin',
        "    for k in s'range loop",
        "      if (s(k) = '1' and (m / 2 ** k) mod 2 = 0) or (s(k) = '0' and (m / 2 ** k) mod 2 = 1) then",
        '        return false;',
        '      end if;',
        '    end loop;',
        '    return true;',
        '  end function;',
        '  function mrg(a, b : std_logic) return std_logic is',
        '  begin',
        "    if a = b and (a = '0' or a = '1') then",
        '      return a;',
        '    end if;',
        "    return 'X';",
        '  end function;',
        "  -- next count; an unknown U'/D or stored bit: every value is tried, bits that differ read X",
        '  function nxc(q : std_logic_vector(3 downto 0); d : std_logic) return std_logic_vector is',
        '    variable s : std_logic_vector(4 downto 0);',
        '    variable r, first, diff : std_logic_vector(3 downto 0);',
        '    variable any : boolean;',
        '  begin',
        '    s := d & q;',
        '    any := false;',
        '    first := "0000";',
        '    diff := "0000";',
        '    for m in 0 to 31 loop',
        '      if fits(s, m) then',
        '        if m >= 16 then',
        '          r := std_logic_vector(to_unsigned(DN190(m mod 16), 4));',
        '        else',
        '          r := std_logic_vector(to_unsigned(UP190(m mod 16), 4));',
        '        end if;',
        '        if any then',
        '          diff := diff or (r xor first);',
        '        else',
        '          first := r;',
        '          any := true;',
        '        end if;',
        '      end if;',
        '    end loop;',
        '    for k in 0 to 3 loop',
        "      if diff(k) = '1' then",
        "        first(k) := 'X';",
        '      end if;',
        '    end loop;',
        '    return first;',
        '  end function;',
        "  -- (RC', TC), the same search",
        '  function fl190(q : std_logic_vector(3 downto 0); ce, d, cp : std_logic) return std_logic_vector is',
        '    variable s : std_logic_vector(6 downto 0);',
        '    variable r, first, diff : std_logic_vector(1 downto 0);',
        '    variable any, tm : boolean;',
        '    variable code : natural;',
        '  begin',
        '    s := q & cp & d & ce;',
        '    any := false;',
        '    first := "00";',
        '    diff := "00";',
        '    for m in 0 to 127 loop',
        '      if fits(s, m) then',
        '        code := m / 8;',
        '        if (m / 2) mod 2 = 1 then',
        '          tm := code = 0;',
        '        else',
        '          tm := code mod 2 = 1 and code >= 8;',
        '        end if;',
        "        r := \"10\";",
        '        if tm then',
        "          r(0) := '1';",
        '          if m mod 2 = 0 and (m / 4) mod 2 = 0 then',
        "            r(1) := '0';",
        '          end if;',
        '        end if;',
        '        if any then',
        '          diff := diff or (r xor first);',
        '        else',
        '          first := r;',
        '          any := true;',
        '        end if;',
        '      end if;',
        '    end loop;',
        '    for k in 0 to 1 loop',
        "      if diff(k) = '1' then",
        "        first(k) := 'X';",
        '      end if;',
        '    end loop;',
        '    return first;',
        '  end function;',
        '  signal nxt : std_logic_vector(3 downto 0);'
      );
    }
    // Structural model
    const b = [0, 1, 2, 3].map((k) => `b${k}`);
    b.forEach((n) => synReg(c, n));
    synSet(c, 'cq', c.v ? `{b3, b2, b1, b0}` : 'b3 & b2 & b1 & b0');
    seqClock(c, 'ck', cp);
    synSet(c, 'nxt', c.v ? `nx190(cq, ${du})` : `nxc(cq, ${du})`);
    const neither = (x: string) => [isv(c, x, 0, false), isv(c, x, 1, false)];
    b.forEach((n, k) => {
      const d = D[k];
      const nk = idx(c, 'nxt', k);
      seqFlag(c, `s${k}`, [isv(c, pl, 0), isv(c, d, 1)]);
      seqFlag(c, `r${k}`, [isv(c, pl, 0), isv(c, d, 0)]);
      if (c.v) {
        // Synthesis has no x: PL' = 0 sets / clears at once, else the clock edge counts while CE' is 0
        seqProc(c, 'ck', false, [[`s${k}`, [`${n} <= 1'b1;`]], [`r${k}`, [`${n} <= 1'b0;`]]], [`if (${ce} === 1'b0) ${n} <= ${nk};`]);
        return;
      }
      // PL' = 0 with D neither 0 nor 1 loads x. PL' unknown: the bit becomes the merge of D with the bit (no
      // edge) or with the counted value (edge); CE' unknown merges counting with holding.
      seqFlag(c, `z${k}`, [isv(c, pl, 0), ...neither(d)]);
      const count = (hold: string) => seqIfs(c, [[`${ce} = '0'`, [`${n} <= ${hold === n ? nk : `mrg(${d}, ${nk})`};`]], [`${ce} = '1'`, hold === n ? [] : [`${n} <= mrg(${d}, ${n});`]]], [`${n} <= ${hold === n ? `mrg(${n}, ${nk})` : `mrg(${d}, mrg(${n}, ${nk}))`};`]);
      c.syn.body.push(
        `  process (ck, z${k}, s${k}, r${k}, vcc, gnd, ${pl}, ${d})`,
        '  begin',
        `    if z${k} = '1' then`,
        `      ${n} <= 'X';`,
        `    elsif s${k} = '1' then`,
        `      ${n} <= '1';`,
        `    elsif r${k} = '1' then`,
        `      ${n} <= '0';`,
        // read from the pins like D (a flag would lag D by a delta)
        `    elsif ${allIf(c, [...powered(c), ...neither(pl)])} then`,
        '      if rising_edge(ck) then',
        ...indent(count(d), 8),
        '      else',
        `        ${n} <= mrg(${d}, ${n});`,
        '      end if;',
        '    elsif rising_edge(ck) then',
        ...indent(count(n), 6),
        '    end if;',
        '  end process;'
      );
    });
    if (c.v) {
      synSet(c, 'fl[0]', `(${du} === 1'b1) ? (cq == 4'd0) : (cq[3] & cq[0])`);
      synSet(c, 'fl[1]', `~(fl[0] & ~${ce} & ~${cp})`);
    } else synSet(c, 'fl', `fl190(cq, ${ce}, ${du}, ${cp})`);
    // Verilog simulation model
    seqSim(c, ["s_ck = 1'b0", 'e'], [...simEdge(c, 'e', 's_ck', cp), `qs = cnt190({qs, ${[...D].reverse().join(', ')}, ${du}, ${ce}, ${pl}}, e);`]);
    simSet(c, 'cq', 'qs');
    simSet(c, 'fl', `fl190({cq, ${cp}, ${du}, ${ce}})`);
    Q.forEach((pin, k) => seqOut(c, pin, idx(c, 'cq', k)));
    seqOut(c, 12, idx(c, 'fl', 0));
    seqOut(c, 13, idx(c, 'fl', 1));
  },
  '74192': (c) => upDownHdl(c, 9),
  '74193': (c) => upDownHdl(c, 15),
  // 74390: two halves (CP0, CP1, MR, Q0..Q3) = (1, 4, 2, 3 5 6 7) and (15, 12, 14, 13 11 10 9); falling edges, Q0
  // toggles on CP0, Q1..Q3 (a code 0..4) count on CP1
  '74390': (c) => {
    ([[1, 4, 2, [3, 5, 6, 7]], [15, 12, 14, [13, 11, 10, 9]]] as const).forEach(([p0, p1, pm, q], h) => {
      const n = h + 1;
      const [cp0, cp1, mr] = [p0, p1, pm].map(c.i);
      const [a, b] = [`a${n}`, `b${n}`];
      seqReg(c, a);
      seqReg(c, b, 3, 'unsigned(2 downto 0)');
      seqClock(c, `c0_${n}`, cp0);
      seqClock(c, `c1_${n}`, cp1);
      seqFlag(c, `rst${n}`, [isv(c, mr, 1)]);
      const five = (op: '<=' | '=') =>
        c.v
          ? [`${b} ${op} (${b} == 3'd4) ? 3'd0 : (${b} < 3'd4) ? ${b} + 3'd1 : 3'bxxx;`]
          : seqIfs(c, [[`${b} = 4`, [`${b} <= "000";`]], [`${b} < 4`, [`${b} <= ${b} + 1;`]]], [`${b} <= "XXX";`]);
      seqProc(c, `c0_${n}`, true, [[`rst${n}`, [`${a} <= ${bit(c, 0)};`]]], [c.v ? `${a} <= ~${a};` : `${a} <= not ${a};`]);
      seqProc(c, `c1_${n}`, true, [[`rst${n}`, [zero(c, b, 3)]]], five('<='));
      seqSim(c, [`s0_${n} = 1'b0`, `s1_${n} = 1'b0`, `e0_${n}`, `e1_${n}`], [
        ...simEdge(c, `e0_${n}`, `s0_${n}`, cp0, true),
        ...simEdge(c, `e1_${n}`, `s1_${n}`, cp1, true),
        ...seqIfs(c, [[isv(c, mr, 1), [`${a} = 1'b0;`, `${b} = 3'd0;`]]], [
          ...seqIfs(c, [[`e0_${n}`, [`${a} = ~${a};`]]]),
          ...seqIfs(c, [[`e1_${n}`, five('=')]]),
        ]),
      ]);
      seqOut(c, q[0], a);
      [1, 2, 3].forEach((k) => seqOut(c, q[k], idx(c, b, k - 1)));
    });
  },
  // 74393: two 4-bit counters (CP, MR, Q0..Q3) = (1, 2, 3..6) and (13, 12, 11..8), falling edges
  '74393': (c) => {
    ([[1, 2, [3, 4, 5, 6]], [13, 12, [11, 10, 9, 8]]] as const).forEach(([cp, mr, q], h) => {
      binCounter(c, `cnt${h + 1}`, 4, cp, mr);
      q.forEach((pin, k) => seqOut(c, pin, idx(c, `cnt${h + 1}`, k)));
    });
  },
  // 744017: Q0..Q9 on pins 3 2 4 7 10 1 5 6 9 11, Q5-9' 12, CP1' 13, CP0 14, MR 15. A step on CP0 rising while
  // CP1' is 0 or on CP1' falling while CP0 is 1, i.e. a clean rising edge of CP0 · CP1'' (unknown unless one of
  // them decides it)
  '744017': (c) => {
    const [cp1, cp0, mr] = [13, 14, 15].map(c.i);
    seqReg(c, 'cnt', 4, 'unsigned(3 downto 0)');
    if (c.v) {
      c.syn.decls.push('  wire g;');
      c.syn.body.push(`  assign g = (${cp0} === 1'b1 && ${cp1} === 1'b0) ? 1'b1 : (${cp0} === 1'b0 || ${cp1} === 1'b1) ? 1'b0 : 1'bx;`);
    } else {
      c.syn.decls.push('  signal g : std_logic;');
      c.syn.body.push(`  g <= '1' when ${cp0} = '1' and ${cp1} = '0' else '0' when ${cp0} = '0' or ${cp1} = '1' else 'X';`);
    }
    seqClock(c, 'ck', 'g');
    seqFlag(c, 'rst', [isv(c, mr, 1)]);
    const next = (op: '<=' | '=') =>
      c.v
        ? [`cnt ${op} (cnt == 4'd9) ? 4'd0 : (cnt < 4'd9) ? cnt + 4'd1 : 4'bxxxx;`]
        : seqIfs(c, [['cnt = 9', ['cnt <= "0000";']], ['cnt < 9', ['cnt <= cnt + 1;']]], ['cnt <= "XXXX";']);
    seqProc(c, 'ck', false, [['rst', [zero(c, 'cnt', 4)]]], next('<='));
    seqSim(c, ["s0 = 1'b0", "s1 = 1'b0", 'e0', 'e1'], [
      ...simEdge(c, 'e0', 's0', cp0),
      ...simEdge(c, 'e1', 's1', cp1, true),
      ...seqIfs(c, [
        [isv(c, mr, 1), ["cnt = 4'd0;"]],
        [`(e0 && ${isv(c, cp1, 0)}) || (e1 && ${isv(c, cp0, 1)})`, next('=')],
      ]),
    ]);
    [3, 2, 4, 7, 10, 1, 5, 6, 9, 11].forEach((pin, k) => {
      if (c.v) seqOut(c, pin, `(cnt == 4'd${k})`);
      else {
        c.decls.push(`  signal d${k} : std_logic;`);
        c.body.push(`  d${k} <= '1' when cnt = ${k} else '0';`);
        seqOut(c, pin, `d${k}`);
      }
    });
    if (c.v) seqOut(c, 12, "(cnt < 4'd5)");
    else {
      c.decls.push('  signal lo5 : std_logic;');
      c.body.push("  lo5 <= '1' when cnt < 5 else '0';");
      seqOut(c, 12, 'lo5');
    }
  },
  // 744060: 14-bit counter, RS 11 (falling edge), MR 12; outputs (pin, stage Qn = cnt[n - 1])
  '744060': (c) => {
    binCounter(c, 'cnt', 14, 11, 12);
    ([[1, 12], [2, 13], [3, 14], [4, 6], [5, 5], [6, 7], [7, 4], [13, 9], [14, 8], [15, 10]] as const).forEach(([pin, q]) =>
      seqOut(c, pin, idx(c, 'cnt', q - 1))
    );
  },
};

/**
 * 74192 / 74193: B 1, QB 2, QA 3, DOWN 4, UP 5, QC 6, QD 7, D 9, C 10, LOAD' 11, CO' 12, BO' 13, CLR 14, A 15.
 * The simulator (evolution) counts on a rising UP while DOWN was and stays 1 (or the other way round), compares
 * each with its value at the previous evaluation, and keeps CO' / BO' low from the falling edge at the end value
 * / 0 until the next action. Structural model: see below (one register domain per input edge, no clock derived
 * from both inputs). Verilog simulation: the simulator's step.
 */
function upDownHdl(c: SeqCtx, max: number) {
  const [dn, up, ld, clr] = [4, 5, 11, 14].map(c.i);
  const [A, B, C, D] = [15, 1, 10, 9].map(c.i);
  seqWire(c, 'cq', 4);
  seqWire(c, 'co');
  seqWire(c, 'bo');
  // The loaded value: an undefined D bit counts as -1 (evolution's toLongValue), a sum above the end value loads 0
  seqFn(
    c,
    [
      '  function integer tl;',
      '    input b;',
      "    tl = (b === 1'b1) ? 1 : (b === 1'b0) ? 0 : -1;",
      '  endfunction',
      '  function [3:0] ldv;',
      '    input a, b, c, d;',
      '    integer s;',
      '    begin',
      '      s = tl(a) + 2 * tl(b) + 4 * tl(c) + 8 * tl(d);',
      `      ldv = (s > ${max}) ? 4'd0 : s[3:0];`,
      '    end',
      '  endfunction',
      '  function [3:0] ud;',
      '    input [3:0] q;',
      '    input u;',
      `    ud = u ? ((q >= 4'd${max}) ? 4'd0 : q + 4'd1) : ((q == 4'd0) ? 4'd${max} : q - 4'd1);`,
      '  endfunction',
    ],
    [
      '  function tl(b : std_logic) return integer is',
      '  begin',
      "    if b = '1' then",
      '      return 1;',
      "    elsif b = '0' then",
      '      return 0;',
      '    end if;',
      '    return -1;',
      '  end function;',
      '  function ldv(a, b, c, d : std_logic) return std_logic_vector is',
      '    variable s : integer;',
      '  begin',
      '    s := tl(a) + 2 * tl(b) + 4 * tl(c) + 8 * tl(d);',
      `    if s > ${max} then`,
      '      s := 0;',
      '    end if;',
      '    return std_logic_vector(to_unsigned(s mod 16, 4));',
      '  end function;',
      '  function ud(q : std_logic_vector(3 downto 0); u : std_logic) return std_logic_vector is',
      '    variable n : natural;',
      '  begin',
      '    n := to_integer(unsigned(q));',
      "    if u = '1' then",
      `      if n >= ${max} then`,
      '        n := 0;',
      '      else',
      '        n := n + 1;',
      '      end if;',
      '    elsif n = 0 then',
      `      n := ${max};`,
      '    else',
      '      n := n - 1;',
      '    end if;',
      '    return std_logic_vector(to_unsigned(n, 4));',
      '  end function;',
    ]
  );
  // Structural model. Every register is clocked by one edge of one input and reads only what does not change at
  // that edge (registers of the other domains, the other input, which a count requires to stay put):
  // - UP rising (DOWN 1 before and after) counts up into qa, DOWN rising (UP held) counts down into qb; the newer
  //   of the two is the count: qa while ta /= tb (an up count sets ta /= tb, a down count tb = ta);
  // - UP falling (DOWN held) sets cf = (count = end value), DOWN falling (UP held) bf = (count = 0); CLR / LOAD'
  //   clear them. A flag stands until the next count or the other input's falling-edge action: the falling edge
  //   copies the tags of those three domains (ua <= pa, ub <= pb, uc <= pc), each of them sets its own apart (pa <=
  //   not ua), so the flag is valid while all three pairs are equal.
  // - "held": the other input is 1 now and was 1 a moment before (VHDL: a copy one delta behind; synthesis: the
  //   input itself), so a simultaneous change does nothing, as in the simulator.
  const qa = [0, 1, 2, 3].map((k) => `qa${k}`);
  const qb = [0, 1, 2, 3].map((k) => `qb${k}`);
  [...qa, ...qb, 'ta', 'tb', 'pa', 'pa2', 'pb', 'pb2', 'pc', 'pc2', 'cf', 'bf', 'ua', 'ub', 'uc', 'da', 'db', 'dc'].forEach((n) => synReg(c, n));
  seqClock(c, 'su', up);
  seqClock(c, 'sd', dn);
  const vec = (xs: string[]) => (c.v ? `{${[...xs].reverse().join(', ')}}` : [...xs].reverse().join(' & '));
  if (c.v) {
    c.syn.decls.push('  wire [3:0] lv, nu, nd;', '  wire sud, sdd;');
    c.syn.body.push('  assign sud = su;', '  assign sdd = sd;', `  assign cq = (ta != tb) ? ${vec(qa)} : ${vec(qb)};`);
  } else {
    c.syn.decls.push('  signal lv, nu, nd : std_logic_vector(3 downto 0);', "  signal sud, sdd : std_logic := '0';");
    c.syn.body.push('  sud <= su;', '  sdd <= sd;', `  cq <= ${vec(qa)} when ta /= tb else ${vec(qb)};`);
  }
  synSet(c, 'lv', `ldv(${A}, ${B}, ${C}, ${D})`);
  synSet(c, 'nu', `ud(cq, ${bit(c, 1)})`);
  synSet(c, 'nd', `ud(cq, ${bit(c, 0)})`);
  const or = c.v ? ' | ' : ' or ';
  const not = (x: string) => (c.v ? `~${x}` : `not ${x}`);
  const downHeld = allIf(c, [isv(c, 'sdd', 1), isv(c, 'sd', 1)]);
  const upHeld = allIf(c, [isv(c, 'sud', 1), isv(c, 'su', 1)]);
  seqFlag(c, 'act', [`(${isv(c, clr, 1)}${or}${isv(c, ld, 0)})`]);
  [0, 1, 2, 3].forEach((k) => {
    const lvk = idx(c, 'lv', k);
    seqFlag(c, `s${k}`, [isv(c, clr, 1, false), isv(c, ld, 0), isv(c, lvk, 1)]);
    seqFlag(c, `r${k}`, [`(${isv(c, clr, 1)}${or}(${allOf(c, [isv(c, ld, 0), isv(c, lvk, 0)])}))`]);
    const async = (n: string): [string, string[]][] => [[`r${k}`, [`${n} <= ${bit(c, 0)};`]], [`s${k}`, [`${n} <= ${bit(c, 1)};`]]];
    seqProc(c, 'su', false, async(qa[k]), seqIfs(c, [[downHeld, [`${qa[k]} <= ${idx(c, 'nu', k)};`]]]));
    seqProc(c, 'sd', false, async(qb[k]), seqIfs(c, [[upHeld, [`${qb[k]} <= ${idx(c, 'nd', k)};`]]]));
  });
  // Tags (no asynchronous branch: during CLR / LOAD' the count halves hold the same value and the flags are clear)
  seqProc(c, 'su', false, [], seqIfs(c, [[downHeld, [`ta <= ${not('tb')};`, `pa <= ${not('ua')};`, `pa2 <= ${not('da')};`]]]));
  seqProc(c, 'sd', false, [], seqIfs(c, [[upHeld, ['tb <= ta;', `pb <= ${not('ub')};`, `pb2 <= ${not('db')};`]]]));
  const at = (v: number) => (c.v ? `(cq == 4'd${v})` : `cq = "${v.toString(2).padStart(4, '0')}"`);
  const flag = (f: string, v: number) => (c.v ? [`${f} <= ${at(v)};`] : seqIfs(c, [[at(v), [`${f} <= '1';`]]], [`${f} <= '0';`]));
  seqProc(c, 'su', true, [['act', [`cf <= ${bit(c, 0)};`]]], seqIfs(c, [[downHeld, flag('cf', max)]]));
  seqProc(c, 'sd', true, [['act', [`bf <= ${bit(c, 0)};`]]], seqIfs(c, [[upHeld, flag('bf', 0)]]));
  seqProc(c, 'su', true, [], seqIfs(c, [[downHeld, ['ua <= pa;', 'ub <= pb;', 'uc <= pc;', `pc2 <= ${not('dc')};`]]]));
  seqProc(c, 'sd', true, [], seqIfs(c, [[upHeld, ['da <= pa2;', 'db <= pb2;', 'dc <= pc2;', `pc <= ${not('uc')};`]]]));
  if (c.v) {
    synSet(c, 'co', '~(cf & (ua == pa) & (ub == pb) & (uc == pc))');
    synSet(c, 'bo', '~(bf & (da == pa2) & (db == pb2) & (dc == pc2))');
  } else {
    synSet(c, 'co', "'0' when cf = '1' and ua = pa and ub = pb and uc = pc else '1'");
    synSet(c, 'bo', "'0' when bf = '1' and da = pa2 and db = pb2 and dc = pc2 else '1'");
  }
  // Verilog simulation model: v = previous DOWN / UP levels, the count, CO' / BO'
  const pd = 'pd';
  const pu = 'pu';
  seqSim(c, ["pd = 1'b0", "pu = 1'b0", "[3:0] qs = 4'd0", "car = 1'b1", "bor = 1'b1", 'c1', 'b1'], [
    "c1 = 1'b1;",
    "b1 = 1'b1;",
    ...seqIfs(
      c,
      [
        [isv(c, clr, 1), ["qs = 4'd0;"]],
        [isv(c, ld, 0), [`qs = ldv(${A}, ${B}, ${C}, ${D});`]],
        [allIf(c, [isv(c, pd, 0), isv(c, dn, 1), isv(c, pu, 1), isv(c, up, 1)]), ["qs = ud(qs, 1'b0);"]],
        [allIf(c, [isv(c, pu, 0), isv(c, up, 1), isv(c, pd, 1), isv(c, dn, 1)]), ["qs = ud(qs, 1'b1);"]],
        [allIf(c, [isv(c, pu, 1), isv(c, up, 0), isv(c, pd, 1), isv(c, dn, 1)]), [`if (qs == 4'd${max}) c1 = 1'b0;`]],
        [allIf(c, [isv(c, pd, 1), isv(c, dn, 0), isv(c, pu, 1), isv(c, up, 1)]), ["if (qs == 4'd0) b1 = 1'b0;"]],
      ],
      ['c1 = car;', 'b1 = bor;']
    ),
    'car = c1;',
    'bor = b1;',
    `pd = ${dn};`,
    `pu = ${up};`,
  ]);
  simSet(c, 'cq', 'qs');
  simSet(c, 'co', 'car');
  simSet(c, 'bo', 'bor');
  [3, 2, 6, 7].forEach((pin, k) => seqOut(c, pin, idx(c, 'cq', k)));
  seqOut(c, 12, 'co');
  seqOut(c, 13, 'bo');
}

/** The chip types that have an HDL model */
export const hasTtlHdl = (type: string): boolean => {
  const chip = ttlChipOf(type);
  return !!chip && (!!MODELS[chip.id] || !!SEQ[chip.id]);
};

// ---- Ports -------------------------------------------------------------------------------------------------

/** HDL-safe port name of a datasheet pin name: LT' -> LTn, BI'/RBO' -> BIn_RBOn, Σ1 -> S1, I(A<B) -> I_AltB */
function cleanName(name: string): string {
  const s = name
    .replace(/'/g, 'n')
    .replace(/Σ/g, 'S')
    .replace(/</g, 'lt')
    .replace(/>/g, 'gt')
    .replace(/=/g, 'eq')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return s.replace(/_+/g, '_');
}

export interface TtlHdlPort {
  name: string;
  dir: 'in' | 'out';
  /** Physical pin; 0 = the vcc / gnd supply inputs */
  pin: number;
  /** The part's pin key it binds to: p<n> (input or output), p<n>in (input half of an in/out pin); vcc / gnd */
  key: string;
}

/** Module ports in order: physical pins, then vcc and gnd */
export function ttlHdlPorts(chip: TtlChip): TtlHdlPort[] {
  const list: TtlHdlPort[] = [];
  for (const p of ttlPorts(chip, false)) {
    const base = `p${p.pin}_${cleanName(p.name)}`;
    if (p.dir === 'inout') {
      list.push({ name: `${base}_i`, dir: 'in', pin: p.pin, key: `p${p.pin}in` });
      list.push({ name: `${base}_o`, dir: 'out', pin: p.pin, key: `p${p.pin}` });
    } else list.push({ name: base, dir: p.dir === 'output' ? 'out' : 'in', pin: p.pin, key: `p${p.pin}` });
  }
  list.push({ name: 'vcc', dir: 'in', pin: 0, key: 'vcc' }, { name: 'gnd', dir: 'in', pin: 0, key: 'gnd' });
  return list;
}

// ---- Rendering ---------------------------------------------------------------------------------------------

const wrap = (e: string) => (/^[A-Za-z0-9_'()[\]]+$/.test(e) ? e : `(${e})`);

/** Verilog module / VHDL entity text of one chip type */
export function renderTtlModule(lang: Lang, chip: TtlChip, moduleName: string): string {
  const model = MODELS[chip.id];
  const ports = ttlHdlPorts(chip);
  const inName = new Map<number, string>();
  const outName = new Map<number, string>();
  for (const p of ports) if (p.pin) (p.dir === 'in' ? inName : outName).set(p.pin, p.name);
  const v = lang === 'verilog';
  const decls: string[] = [];
  const body: string[] = [];
  let tmp = 0;
  const lit = (x: 0 | 1 | 'z') => (v ? `1'b${x}` : `'${x === 'z' ? 'Z' : x}'`);
  const sig = (name: string, width = 1) => {
    if (v) decls.push(`  wire ${width > 1 ? `[${width - 1}:0] ` : ''}${name};`);
    else decls.push(`  signal ${name} : ${width > 1 ? `std_logic_vector(${width - 1} downto 0)` : 'std_logic'};`);
  };
  const assign = (lhs: string, rhs: string) => body.push(v ? `  assign ${lhs} = ${rhs};` : `  ${lhs} <= ${rhs};`);
  // A vector of 1-bit expressions, MSB first (VHDL gets its own signal so it can be indexed / compared)
  const vector = (xs: TExpr[], hint: string): string => {
    const parts = xs.map(r);
    if (v) return `{${parts.join(', ')}}`;
    const n = `${hint}${++tmp}`;
    sig(n, xs.length);
    assign(n, parts.join(' & '));
    return n;
  };
  const r = (e: TExpr): string => {
    if (typeof e === 'number') {
      const n = inName.get(e);
      if (!n) throw new Error(`ttl${chip.id}: pin ${e} is not an input`);
      return n;
    }
    switch (e.k) {
      case 'w':
        return e.n;
      case 'c':
        return lit(e.v);
      case 'not':
        return v ? `~${wrap(r(e.a))}` : `not ${wrap(r(e.a))}`;
      case 'and':
      case 'or':
      case 'xor': {
        const op = v ? { and: ' & ', or: ' | ', xor: ' ^ ' }[e.k] : ` ${e.k} `;
        return e.xs.length === 1 ? r(e.xs[0]) : e.xs.map((x) => wrap(r(x))).join(op);
      }
      case 'mux': {
        const t = `t${++tmp}`;
        sig(t);
        const s = r(e.s);
        assign(t, v ? `${wrap(s)} ? ${wrap(r(e.a))} : ${wrap(r(e.b))}` : `${r(e.a)} when ${wrap(s)} = '1' else ${r(e.b)}`);
        return t;
      }
      case 'pick': {
        const tab = vector([...e.data].reverse(), 'tab');
        const sel = vector(e.sel, 'sel');
        if (v) {
          const n = `tab${++tmp}`;
          sig(n, e.data.length);
          assign(n, tab);
          const t = `t${++tmp}`;
          sig(t);
          assign(t, `${n}[${sel}]`);
          return t;
        }
        const t = `t${++tmp}`;
        sig(t);
        assign(t, `${tab}(to_integer(unsigned(${sel})))`);
        return t;
      }
      case 'gt': {
        const t = `t${++tmp}`;
        sig(t);
        const a = vector(e.a, 'va');
        const b = vector(e.b, 'vb');
        assign(t, v ? `${a} > ${b}` : `'1' when unsigned(${a}) > unsigned(${b}) else '0'`);
        return t;
      }
      case 'is': {
        const t = `t${++tmp}`;
        sig(t);
        const a = r(e.a);
        if (v) {
          // Synthesis has no x / z: the pin itself; simulation: case equality (=== is not synthesizable everywhere)
          body.push('`ifdef SYNTHESIS', `  assign ${t} = ${e.v ? a : `~${wrap(a)}`};`, '`else', `  assign ${t} = (${a} === 1'b${e.v});`, '`endif');
        } else assign(t, `'1' when ${a} = '${e.v}' else '0'`);
        return t;
      }
    }
  };

  const seq = SEQ[chip.id];
  if (seq) {
    const syn = v ? { decls: [] as string[], body: [] as string[] } : { decls, body };
    const sim = { decls: [] as string[], body: [] as string[] };
    const shared = { decls: [] as string[], body: [] as string[] };
    const ins = ports.filter((p) => p.dir === 'in').map((p) => p.name);
    seq({ v, i: (pin) => inName.get(pin)!, o: (pin) => outName.get(pin)!, ins, ...shared, syn, sim });
    decls.push(...shared.decls);
    if (v) {
      // Synthesis has no x / z to tell apart: case equality becomes plain equality (same meaning for 0 / 1,
      // and some vendor tools reject === / !== in synthesis)
      const eq = (ls: string[]) => ls.map((l) => l.replace(/!==/g, '!=').replace(/===/g, '=='));
      decls.push('`ifdef SYNTHESIS', ...eq(syn.decls), '`else', ...sim.decls, '`endif');
      body.push(
        '`ifdef SYNTHESIS',
        "  assign pwr = vcc & ~gnd;",
        ...eq(syn.body),
        '`else',
        "  assign pwr = (vcc === 1'b1) & (gnd === 1'b0);",
        ...sim.body,
        '`endif'
      );
    }
    body.push(...shared.body);
  }
  for (const [n, e] of model?.wires ?? []) {
    sig(n);
    assign(n, r(e));
  }
  for (const pin of seq ? [] : chip.out.concat(chip.inout ?? [])) {
    const e = model.out[pin];
    const o = outName.get(pin)!;
    if (e === undefined) {
      assign(o, lit('z'));
      continue;
    }
    const f = r(e);
    // Without power (vcc / gnd not 1 / 0) every output floats
    assign(o, v ? `pwr ? ${wrap(f)} : 1'bz` : `${f} when pwr = '1' else 'Z'`);
  }

  const title = `${chip.id}: ${chip.title}${chip.openCollector ? ' (açık kollektör çıkışlar: 0 ya da Z)' : ''}`;
  const portDecl = ports.map((p) => (v ? `  ${p.dir === 'in' ? 'input' : 'output'} wire ${p.name}` : `    ${p.name} : ${p.dir} std_logic`));
  const seqNote = seq
    ? [
        'besleme yokken durum ve saat izlemesi korunur; girişler yalnız tam 0 / 1 iken 0 / 1 sayılır (simülatördeki gibi x ikisi de değildir)',
        'kenar: çipin son örneklediği saat seviyesinin temiz değişimi (açılışta 0)',
        ...(v
          ? ['simülasyonda (SYNTHESIS tanımsız) çip, girişleri oturduktan sonra simülatörün adımını uygulayan tek süreçtir; sentezde aynı davranışın yapısal modeli']
          : []),
      ]
    : [];
  if (v) {
    return [
      `// TTL ${title}`,
      '// vcc / gnd: çipin besleme bacakları (parçada VCC/GND bacakları yoksa 1 / 0\'a bağlanır); besleme yoksa tüm çıkışlar boşta (Z)',
      ...seqNote.map((n) => `// ${n}`),
      `module ${moduleName} (`,
      portDecl.join(',\n'),
      ');',
      '  wire pwr;',
      ...decls,
      ...(seq ? [] : ['  assign pwr = vcc & ~gnd;']),
      ...body,
      'endmodule',
    ].join('\n');
  }
  return [
    `-- TTL ${title}`,
    '-- vcc / gnd: çipin besleme bacakları (parçada VCC/GND bacakları yoksa 1 / 0\'a bağlanır); besleme yoksa tüm çıkışlar boşta (Z)',
    ...seqNote.map((n) => `-- ${n}`),
    'library IEEE;',
    'use IEEE.STD_LOGIC_1164.ALL;',
    'use IEEE.NUMERIC_STD.ALL;',
    '',
    `entity ${moduleName} is`,
    '  port (',
    portDecl.join(';\n'),
    '  );',
    `end entity ${moduleName};`,
    '',
    `architecture Behavioral of ${moduleName} is`,
    '  signal pwr : std_logic;',
    ...decls,
    'begin',
    seq ? "  pwr <= '1' when vcc = '1' and gnd = '0' else '0';" : '  pwr <= vcc and not gnd;',
    ...body,
    'end architecture Behavioral;',
  ].join('\n');
}

// ---- Evaluation (test rigs) --------------------------------------------------------------------------------

/** Outputs (pin -> 0 / 1 / 'Z') of a chip's model for defined input pin levels (power on) */
export function evalTtlModel(chip: TtlChip, ins: Map<number, 0 | 1>): Map<number, 0 | 1 | 'Z'> {
  const model = MODELS[chip.id];
  const wires = new Map<string, 0 | 1 | 'Z'>();
  const num = (xs: TExpr[]) => xs.reduce<number>((n, x) => n * 2 + (ev(x) === 1 ? 1 : 0), 0);
  const ev = (e: TExpr): 0 | 1 | 'Z' => {
    if (typeof e === 'number') return ins.get(e) ?? 0;
    switch (e.k) {
      case 'w':
        return wires.get(e.n)!;
      case 'c':
        return e.v === 'z' ? 'Z' : e.v;
      case 'not':
        return ev(e.a) === 1 ? 0 : 1;
      case 'and':
        return e.xs.every((x) => ev(x) === 1) ? 1 : 0;
      case 'or':
        return e.xs.some((x) => ev(x) === 1) ? 1 : 0;
      case 'xor':
        return (e.xs.filter((x) => ev(x) === 1).length % 2) as 0 | 1;
      case 'mux':
        return ev(e.s) === 1 ? ev(e.a) : ev(e.b);
      case 'pick':
        return ev(e.data[num(e.sel)]);
      case 'gt':
        return num(e.a) > num(e.b) ? 1 : 0;
      case 'is':
        return ev(e.a) === e.v ? 1 : 0;
    }
  };
  for (const [n, e] of model.wires ?? []) wires.set(n, ev(e));
  const res = new Map<number, 0 | 1 | 'Z'>();
  for (const [pin, e] of Object.entries(model.out)) res.set(Number(pin), ev(e));
  return res;
}
