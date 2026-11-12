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
import { ttlChipOf, ttlPorts, type TtlChip } from './ttlChips';

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
  | { k: 'gt'; a: TExpr[]; b: TExpr[] }; // unsigned a > b, MSB first

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
    // A loaded D bit that is neither 0 nor 1 counts as -1 (evolution's toLongValue), the sum taken mod 16. A
    // function read inside the process: a signal in between would lag the clock by a delta in VHDL
    if (c.v) {
      const fn = ['  function [3:0] dv;', '    input b;', "    dv = (b === 1'b1) ? 4'd1 : (b === 1'b0) ? 4'd0 : 4'd15;", '  endfunction'];
      c.syn.decls.push(...fn);
      c.sim.decls.push(...fn);
    } else {
      c.decls.push(
        '  function dv(b : std_logic) return unsigned is',
        '  begin',
        "    if b = '1' then",
        '      return "0001";',
        "    elsif b = '0' then",
        '      return "0000";',
        '    end if;',
        '    return "1111";',
        '  end function;'
      );
    }
    const [d0, d1, d2, d3] = [3, 4, 5, 6].map((pin) => `dv(${c.i(pin)})`);
    const ld = c.v ? `${d0} + (${d1} << 1) + (${d2} << 2) + (${d3} << 3)` : `${d0} + shift_left(${d1}, 1) + shift_left(${d2}, 2) + shift_left(${d3}, 3)`;
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
};

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
    }
  };
  for (const [n, e] of model.wires ?? []) wires.set(n, ev(e));
  const res = new Map<number, 0 | 1 | 'Z'>();
  for (const [pin, e] of Object.entries(model.out)) res.set(Number(pin), ev(e));
  return res;
}
