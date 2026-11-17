// Cell library of the netlist front ends: maps a named cell (BLIF .subckt/.gate type, yosys JSON cell type)
// and its pin connections to netlist cells.
//
// Two families are known:
// - yosys internal gate cells ($_AND_, $_DFF_P_, ...), written by `write_blif -icells` / `-gates`, by the
//   default `write_blif` for flip-flops, and found in yosys JSON netlists. Semantics follow yosys simcells.v.
// - the cell names Logisim-evolution's BLIF component accepts (yosys examples/cmos style: AND, NOT, MUX,
//   DFF, DFFSR, DLATCH, PULLUP, ...), so BLIF files written for evo load here too.
import type { NetlistCell, NetlistCtl, NetlistLoad, NetlistSeq } from './ir';

/** Pin connections of one cell instance: formal pin name -> net name */
export type CellPins = ReadonlyMap<string, string>;

/** Thrown through by the caller as a NetlistError with its line number */
export interface CellIssue {
  code: 'missingPin' | 'unknownPin';
  pin: string;
}

interface CombSpec {
  inputs: string[];
  output: string;
  rows: string[];
  onSet: boolean;
}

const comb = (inputs: string[], rows: string[], onSet = true, output = 'Y'): CombSpec => ({ inputs, output, rows, onSet });

/** Combinational cells as covers (see NetlistLut) */
const COMB_CELLS: Record<string, CombSpec> = {
  // yosys simcells
  $_BUF_: comb(['A'], ['1']),
  $_NOT_: comb(['A'], ['0']),
  $_AND_: comb(['A', 'B'], ['11']),
  $_NAND_: comb(['A', 'B'], ['11'], false),
  $_OR_: comb(['A', 'B'], ['1-', '-1']),
  $_NOR_: comb(['A', 'B'], ['1-', '-1'], false),
  $_XOR_: comb(['A', 'B'], ['10', '01']),
  $_XNOR_: comb(['A', 'B'], ['00', '11']),
  $_ANDNOT_: comb(['A', 'B'], ['10']), // A & ~B
  $_ORNOT_: comb(['A', 'B'], ['1-', '-0']), // A | ~B
  $_MUX_: comb(['A', 'B', 'S'], ['1-0', '-11']), // S ? B : A
  $_NMUX_: comb(['A', 'B', 'S'], ['1-0', '-11'], false),
  $_AOI3_: comb(['A', 'B', 'C'], ['11-', '--1'], false), // ~((A & B) | C)
  $_OAI3_: comb(['A', 'B', 'C'], ['1-1', '-11'], false), // ~((A | B) & C)
  $_AOI4_: comb(['A', 'B', 'C', 'D'], ['11--', '--11'], false), // ~((A & B) | (C & D))
  $_OAI4_: comb(['A', 'B', 'C', 'D'], ['1-1-', '1--1', '-11-', '-1-1'], false), // ~((A | B) & (C | D))
  // Logisim-evolution BLIF names
  BUF: comb(['A'], ['1']),
  NOT: comb(['A'], ['0']),
  AND: comb(['A', 'B'], ['11']),
  NAND: comb(['A', 'B'], ['11'], false),
  OR: comb(['A', 'B'], ['1-', '-1']),
  NOR: comb(['A', 'B'], ['1-', '-1'], false),
  XOR: comb(['A', 'B'], ['10', '01']),
  NXOR: comb(['A', 'B'], ['00', '11']),
  ANDNOT: comb(['A', 'B'], ['10']),
  ORNOT: comb(['A', 'B'], ['1-', '-0']),
  MUX: comb(['A', 'B', 'S'], ['1-0', '-11']),
};

const P = (c: string): boolean => c === 'P';

/** Collects a cell's pins, reporting missing and unexpected ones */
class PinReader {
  private readonly pins: CellPins;
  private readonly used = new Set<string>();
  issue: CellIssue | undefined;

  constructor(pins: CellPins) {
    this.pins = pins;
  }

  net(pin: string): string {
    this.used.add(pin);
    const net = this.pins.get(pin);
    if (net === undefined) {
      this.issue ??= { code: 'missingPin', pin };
      return '';
    }
    return net;
  }

  ctl(pin: string, polarity: string): NetlistCtl {
    return { net: this.net(pin), activeHigh: P(polarity) };
  }

  load(pin: string, polarity: string, value: number): NetlistLoad {
    return { ...this.ctl(pin, polarity), value: value ? 1 : 0 };
  }

  /** Reports the first issue, or a pin the cell does not have */
  finish(): CellIssue | undefined {
    if (this.issue) return this.issue;
    for (const pin of this.pins.keys()) if (!this.used.has(pin)) return { code: 'unknownPin', pin };
    return undefined;
  }
}

function seq(r: PinReader, s: Omit<NetlistSeq, 'kind' | 'syncResetOverEnable' | 'asyncLoads' | 'init' | 'd' | 'q'> & Partial<NetlistSeq>): NetlistSeq {
  return {
    kind: 'seq',
    d: s.d ?? r.net('D'),
    q: s.q ?? r.net('Q'),
    syncResetOverEnable: true,
    asyncLoads: [],
    init: 0,
    ...s,
  };
}

type SeqBuilder = (m: RegExpExecArray, r: PinReader) => NetlistSeq;

/** Sequential yosys cells by name pattern; polarity letters are N (active low) / P (active high) */
const SEQ_CELLS: [RegExp, SeqBuilder][] = [
  [/^\$_DFF_([NP])_$/, (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true })],
  [/^\$_DFF_([NP])([NP])([01])_$/, (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true, asyncLoads: [r.load('R', m[2], +m[3])] })],
  [/^\$_DFFE_([NP])([NP])_$/, (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true, enable: r.ctl('E', m[2]) })],
  [
    /^\$_DFFE_([NP])([NP])([01])([NP])_$/,
    (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true, asyncLoads: [r.load('R', m[2], +m[3])], enable: r.ctl('E', m[4]) }),
  ],
  [
    // reset has priority over set (simcells.v)
    /^\$_DFFSR_([NP])([NP])([NP])_$/,
    (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true, asyncLoads: [r.load('R', m[3], 0), r.load('S', m[2], 1)] }),
  ],
  [
    /^\$_DFFSRE_([NP])([NP])([NP])([NP])_$/,
    (m, r) =>
      seq(r, { clock: r.ctl('C', m[1]), edge: true, asyncLoads: [r.load('R', m[3], 0), r.load('S', m[2], 1)], enable: r.ctl('E', m[4]) }),
  ],
  [/^\$_SDFF_([NP])([NP])([01])_$/, (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true, syncReset: r.load('R', m[2], +m[3]) })],
  [
    // sync reset regardless of enable
    /^\$_SDFFE_([NP])([NP])([01])([NP])_$/,
    (m, r) => seq(r, { clock: r.ctl('C', m[1]), edge: true, syncReset: r.load('R', m[2], +m[3]), enable: r.ctl('E', m[4]) }),
  ],
  [
    // sync reset only while enabled
    /^\$_SDFFCE_([NP])([NP])([01])([NP])_$/,
    (m, r) =>
      seq(r, {
        clock: r.ctl('C', m[1]),
        edge: true,
        syncReset: r.load('R', m[2], +m[3]),
        enable: r.ctl('E', m[4]),
        syncResetOverEnable: false,
      }),
  ],
  [/^\$_DLATCH_([NP])_$/, (m, r) => seq(r, { clock: r.ctl('E', m[1]), edge: false })],
  [/^\$_DLATCH_([NP])([NP])([01])_$/, (m, r) => seq(r, { clock: r.ctl('E', m[1]), edge: false, asyncLoads: [r.load('R', m[2], +m[3])] })],
  [
    /^\$_DLATCHSR_([NP])([NP])([NP])_$/,
    (m, r) => seq(r, { clock: r.ctl('E', m[1]), edge: false, asyncLoads: [r.load('R', m[3], 0), r.load('S', m[2], 1)] }),
  ],
  [
    // SR latch: no clock, Q keeps its value while neither is active
    /^\$_SR_([NP])([NP])_$/,
    (m, r) => {
      const q = r.net('Q');
      return seq(r, { edge: false, d: q, q, asyncLoads: [r.load('R', m[2], 0), r.load('S', m[1], 1)] });
    },
  ],
  // Logisim-evolution names, all active high
  [/^DFF$/, (_m, r) => seq(r, { clock: r.ctl('C', 'P'), edge: true })],
  [/^DFFSR$/, (_m, r) => seq(r, { clock: r.ctl('C', 'P'), edge: true, asyncLoads: [r.load('R', 'P', 0), r.load('S', 'P', 1)] })],
  [/^DLATCH$/, (_m, r) => seq(r, { clock: r.ctl('E', 'P'), edge: false })],
];

/**
 * The netlist cells for a library cell, or undefined when `type` is not in the library.
 * Returns an issue instead when the instance's pins do not fit the cell.
 */
export function libraryCell(type: string, pins: CellPins): { cells: NetlistCell[] } | { issue: CellIssue } | undefined {
  const r = new PinReader(pins);
  let cells: NetlistCell[] | undefined;
  const spec = Object.hasOwn(COMB_CELLS, type) ? COMB_CELLS[type] : undefined;
  if (spec) {
    cells = [{ kind: 'lut', inputs: spec.inputs.map((p) => r.net(p)), output: r.net(spec.output), rows: spec.rows, onSet: spec.onSet }];
  } else if (type === '$_TBUF_') {
    cells = [{ kind: 'tbuf', a: r.net('A'), en: r.ctl('E', 'P'), output: r.net('Y') }];
  } else if (type === 'TRIS' || type === 'TRISI') {
    // evo's tri-state gates: Y = A while B is high (TRIS) / not high (TRISI)
    cells = [{ kind: 'tbuf', a: r.net('A'), en: r.ctl('B', type === 'TRIS' ? 'P' : 'N'), output: r.net('Y') }];
  } else if (type === 'PULLUP' || type === 'PULLDOWN') {
    cells = [{ kind: 'pull', net: r.net('Y'), high: type === 'PULLUP' }];
  } else {
    for (const [re, build] of SEQ_CELLS) {
      const m = re.exec(type);
      if (m) {
        cells = [build(m, r)];
        break;
      }
    }
  }
  if (!cells) return undefined;
  const issue = r.finish();
  return issue ? { issue } : { cells };
}
