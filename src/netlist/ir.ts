// Netlist intermediate representation (Aşama 6a).
//
// Every front end (BLIF in 6a, yosys JSON in 6b/6c) turns its input into a Netlist; compile.ts turns a
// Netlist into the flat arrays sim.ts runs. Nets are named by strings here; the compiler numbers them.
//
// This module and the rest of src/netlist must not import React, the old circuit engine or the registry,
// so they can be tested on their own and reused by any part.

/**
 * Signal level of one net bit inside the engine: 0 floating (Z), 1 low, 2 high, 3 unknown (X),
 * 4 error (E, two drivers disagree). levels.ts converts to and from the app's SignalValue.
 */
export type Level = 0 | 1 | 2 | 3 | 4;

export const LEV_Z = 0;
export const LEV_0 = 1;
export const LEV_1 = 2;
export const LEV_X = 3;
export const LEV_E = 4;

/** Net names every front end may use without driving them: constant 0, constant 1 and undefined */
export const NET_FALSE = '$false';
export const NET_TRUE = '$true';
export const NET_UNDEF = '$undef';

/** A port of the netlist's top module: its bits' net names, LSB first ('' = bit not connected) */
export interface NetlistPort {
  name: string;
  bits: string[];
}

/** A control input of a sequential cell, with the level that makes it active */
export interface NetlistCtl {
  net: string;
  activeHigh: boolean;
}

/** An asynchronous or synchronous reset/set: when active it loads `value` */
export interface NetlistLoad extends NetlistCtl {
  value: 0 | 1;
}

/**
 * Combinational cell given as a sum-of-products cover, as BLIF .names writes it. Each row has one character
 * per input: '1', '0' or '-' (either). With onSet the output is 1 when some row matches, otherwise 0;
 * without it the rows list where the output is 0. A cell with no inputs and one empty row is a constant.
 */
export interface NetlistLut {
  kind: 'lut';
  inputs: string[];
  output: string;
  rows: string[];
  onSet: boolean;
}

/** Tri-state buffer: drives `a` while `en` is active, floats (Z) otherwise */
export interface NetlistTbuf {
  kind: 'tbuf';
  a: string;
  en: NetlistCtl;
  output: string;
}

/**
 * Storage cell. With `clock` and edge it is a flip-flop (loads on the active edge), with `clock` and not
 * edge a latch (transparent while the clock is active), without `clock` only its async loads change it.
 * Priority, highest first: asyncLoads in order, then (on the clock) syncReset when syncResetOverEnable,
 * then enable, then syncReset, then d.
 */
export interface NetlistSeq {
  kind: 'seq';
  clock?: NetlistCtl;
  edge: boolean;
  d: string;
  q: string;
  enable?: NetlistCtl;
  syncReset?: NetlistLoad;
  syncResetOverEnable: boolean;
  asyncLoads: NetlistLoad[];
  /** Value at power-on */
  init: 0 | 1;
}

/** Weak pull of a net: the level it takes while nothing drives it */
export interface NetlistPull {
  kind: 'pull';
  net: string;
  high: boolean;
}

export type NetlistCell = NetlistLut | NetlistTbuf | NetlistSeq | NetlistPull;

export interface Netlist {
  /** Name of the top module */
  name: string;
  inputs: NetlistPort[];
  outputs: NetlistPort[];
  cells: NetlistCell[];
}

/**
 * Error of a front end or the compiler. `code` selects the translated text (key "netlistErrors.<code>" of
 * the part using the engine), `params` fills it; `message` is an English fallback for logs and tests.
 */
export class NetlistError extends Error {
  readonly code: string;
  readonly line: number | undefined;
  readonly params: Record<string, string | number>;

  constructor(code: string, message: string, params: Record<string, string | number> = {}, line?: number) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'NetlistError';
    this.code = code;
    this.line = line;
    this.params = params;
  }
}
