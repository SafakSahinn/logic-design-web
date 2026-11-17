// Shared types of the HDL synthesis glue (Aşama 6b): VHDL (6b) and Verilog (6c) parts turn their text into a
// netlist with external tools, keep the result as a StoredNetlist, and simulate it with src/netlist.
//
// This folder must not import React, the registry or the parts, so it can be tested on its own. Tools are
// reached only through the HdlToolRun function the caller passes in (normally runTool from src/tools).
import type { ToolRunRequest, ToolRunResult } from '../tools/types';

/** Runs one external tool; the parts pass src/tools runTool, tests pass a stub or a node runner */
export type HdlToolRun = (request: ToolRunRequest) => Promise<ToolRunResult>;

/** One message of a tool, with its place in the user's text when the tool gave one */
export interface HdlDiagnostic {
  severity: 'error' | 'warning' | 'note';
  /** Which tool said it */
  source: 'ghdl' | 'yosys' | 'lds';
  message: string;
  /** 1-based line and column in the user's text */
  line?: number;
  column?: number;
}

/** A port of a stored netlist, in the order the HDL declares it */
export interface StoredPort {
  name: string;
  width: number;
}

/**
 * Result of a successful synthesis, kept in the part state and in .circ files so a design opens and
 * simulates without the tools (also on the web). JSON-safe.
 */
export interface StoredNetlist {
  /** BLIF text as yosys `write_blif -icells` wrote it */
  blif: string;
  /** Top module name */
  top: string;
  /** Inputs in declaration order */
  inputs: StoredPort[];
  /** Outputs in declaration order; an inout port is listed here and only driven by the design */
  outputs: (StoredPort & { inout?: boolean })[];
}

/**
 * Error of the HDL glue. `code` selects the translated text (key "hdlErrors.<code>" of the part), `params`
 * fills it; `message` is an English fallback for logs and tests.
 */
export class HdlError extends Error {
  readonly code: string;
  readonly line: number | undefined;
  readonly params: Record<string, string | number>;

  constructor(code: string, message: string, params: Record<string, string | number> = {}, line?: number) {
    super(line === undefined ? message : `line ${line}: ${message}`);
    this.name = 'HdlError';
    this.code = code;
    this.line = line;
    this.params = params;
  }
}
