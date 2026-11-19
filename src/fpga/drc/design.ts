// Design rules for an FPGA build (after evo designrulecheck/Netlist.java and CorrectLabel.java): the top level
// has I/O, the I/O parts have labels the board map and the HDL can use, the clocks come straight from clock
// parts, and what the HDL export warns about.
import type { CircuitComponentInstance, CircuitWire } from '../../types/circuit';
import { pinKey } from '../../utils/circuitEngine';
import { getHdlWarnings, getTopLevelPorts } from '../../utils/hdlGenerator';
import { getLogicalConnections } from '../../utils/wiringEngine';
import { ownLabel } from '../map/model';
import type { DrcIssue } from './issue';

// evo CorrectLabel: letters a-z (any case), digits, space, '-' and '_'
const LABEL_CHARS = /^[a-z0-9 _-]$/i;

// evo Vhdl.VHDL_KEYWORDS (IEEE 1076-2008) and CorrectLabel.VERILOG_KEYWORDS (IEEE 1364-2005)
const VHDL_KEYWORDS = new Set(
  (
    'abs access after alias all and architecture array assert assume assume_guarantee attribute begin block body ' +
    'buffer bus case component configuration constant context cover default disconnect downto else elsif end entity ' +
    'exit fairness file for force function generate generic group guarded if impure in inertial inout is label ' +
    'library linkage literal loop map mod nand new next nor not null of on open or others out package parameter port ' +
    'postponed procedure process property protected pure range record register reject release rem report restrict ' +
    'restrict_guarantee return rol ror select sequence severity shared signal sla sll sra srl strong subtype then to ' +
    'transport type unaffected units until use variable vmode vprop vunit wait when while with xnor xor'
  ).split(' ')
);
const VERILOG_KEYWORDS = new Set(
  (
    'always and assign automatic begin buf bufif0 bufif1 case casex casez cell cmos config deassign default defparam ' +
    'design disable edge else end endcase endconfig endfunction endgenerate endmodule endprimitive endspecify endtable ' +
    'endtask event for force forever fork function generate genvar highz0 highz1 if ifnone incdir include initial ' +
    'inout input instance integer join large liblist library localparam macromodule medium module nand negedge nmos ' +
    'nor noshowcancelled not notif0 notif1 or output parameter pmos posedge primitive pull0 pull1 pulldown pullup ' +
    'pulsestyle_onevent pulsestyle_ondetect rcmos real realtime reg release repeat rnmos rpmos rtran rtranif0 rtranif1 ' +
    'scalared showcancelled signed small specify specparam strong0 strong1 supply0 supply1 table task time tran ' +
    'tranif0 tranif1 tri tri0 tri1 triand trior trireg unsigned use uwire vectored wait wand weak0 weak1 while wire ' +
    'wor xnor xor'
  ).split(' ')
);

/** Why a label cannot be an HDL name as it is (evo CorrectLabel.nameErrors), or undefined if it can */
export function labelProblem(label: string): { reason: 'char'; char: string } | { reason: 'vhdlKeyword' | 'verilogKeyword' } | undefined {
  for (const ch of label) if (!LABEL_CHARS.test(ch)) return { reason: 'char', char: ch };
  if (VHDL_KEYWORDS.has(label.toLowerCase())) return { reason: 'vhdlKeyword' };
  if (VERILOG_KEYWORDS.has(label)) return { reason: 'verilogKeyword' };
  return undefined;
}

// A clock input of a part: its pin key is clk, clk1 ... (flip-flops, registers, counters, memories, I/O parts)
const isClockInput = (key: string) => /^clk\d*$/.test(key);

// Parts a clock goes through without being gated (a splitter only regroups bits)
const PASS_THROUGH = new Set(['splitter']);

export function checkDesign(circuitName: string, components: CircuitComponentInstance[], wires: CircuitWire[]): DrcIssue[] {
  const issues: DrcIssue[] = [];
  const ports = getTopLevelPorts(circuitName, components, wires);
  const byId = new Map(components.map((c) => [c.id, c]));

  // evo TopLevelNoIO
  if (ports.length === 0) issues.push({ code: 'topLevelNoIo', severity: 'error', values: {} });

  // Labels of the parts behind the ports: the board map names them by label (evo .circ "mc key")
  const ioParts = [...new Set(ports.map((p) => p.source?.compId).filter((id): id is string => !!id))]
    .map((id) => byId.get(id))
    .filter((c): c is CircuitComponentInstance => !!c);
  const seen = new Map<string, CircuitComponentInstance>();
  for (const c of ioParts) {
    const label = ownLabel(c) ?? '';
    const port = ports.find((p) => p.source?.compId === c.id)?.name ?? c.type;
    if (!label) {
      // evo labels such parts itself; the .circ export (6i-5) does the same
      issues.push({ code: 'noLabel', severity: 'info', compId: c.id, values: { port } });
      continue;
    }
    const problem = labelProblem(label);
    if (problem) {
      const code = problem.reason === 'char' ? 'labelChar' : `label.${problem.reason}`;
      issues.push({ code, severity: 'warning', compId: c.id, values: { label, port, char: problem.reason === 'char' ? problem.char : '' } });
    }
    // VHDL is case-insensitive: evo compares labels upper-cased (CorrectLabel.hdlLabelKey)
    const key = label.toUpperCase();
    const first = seen.get(key);
    if (first) issues.push({ code: 'duplicateLabel', severity: 'error', compId: c.id, values: { label, other: first.label ?? '' } });
    else seen.set(key, c);
  }

  // Clocks: driven straight by a clock part, not through logic (evo NetList_GatedClock / PossibleGatedClock)
  const conns = getLogicalConnections(components, wires);
  const driverOf = new Map<string, string>();
  for (const w of conns) driverOf.set(w.toPinId, w.fromPinId);
  const ownerOf = new Map<string, CircuitComponentInstance>();
  for (const c of components) for (const p of [...c.inputs, ...c.outputs]) ownerOf.set(p.id, c);

  const clocks = components.filter((c) => c.type === 'clock');
  for (const c of components) {
    for (const p of c.inputs) {
      if (!isClockInput(pinKey(c, p))) continue;
      const verdict = traceClock(p.id, driverOf, ownerOf);
      if (verdict === 'gated') issues.push({ code: 'gatedClock', severity: 'warning', compId: c.id, values: { part: c.label || c.type } });
      else if (verdict === 'logic') issues.push({ code: 'clockFromLogic', severity: 'warning', compId: c.id, values: { part: c.label || c.type } });
    }
  }
  for (const c of clocks) {
    const out = c.outputs[0];
    if (!out || !conns.some((w) => w.fromPinId === out.id)) issues.push({ code: 'clockUnused', severity: 'warning', compId: c.id, values: { name: c.label || c.type } });
  }
  if (clocks.length > 1) issues.push({ code: 'multipleClocks', severity: 'info', values: { count: clocks.length } });

  // What the HDL export warns about (texts from the HDL generator)
  for (const w of getHdlWarnings(circuitName, components, wires)) {
    issues.push({ code: 'hdlWarning', severity: 'warning', values: { module: w.module, text: w.text } });
  }
  return issues;
}

/**
 * Where a clock input's signal comes from: 'clock' = a clock part (through splitters at most), 'gated' = a clock
 * part through gates, 'logic' = no clock part through gates (a switch, a button, a flip-flop output ...),
 * 'none' = not connected.
 */
function traceClock(pinId: string, driverOf: Map<string, string>, ownerOf: Map<string, CircuitComponentInstance>): 'clock' | 'gated' | 'logic' | 'none' {
  let driver = driverOf.get(pinId);
  if (!driver) return 'none';
  // Straight through splitters
  const seenDirect = new Set<string>();
  for (;;) {
    const owner = ownerOf.get(driver);
    if (!owner) return 'none';
    if (owner.type === 'clock') return 'clock';
    if (!PASS_THROUGH.has(owner.type) || seenDirect.has(owner.id)) break;
    seenDirect.add(owner.id);
    const next = owner.inputs.map((p) => driverOf.get(p.id)).find((d): d is string => !!d);
    if (!next) return 'logic';
    driver = next;
  }
  // Back through the logic in front of it, stopping at parts with a clock input (their outputs are new signals)
  const start = ownerOf.get(driver)!;
  const queue = [start];
  const seen = new Set([start.id]);
  while (queue.length) {
    const c = queue.shift()!;
    if (c.type === 'clock') return 'gated';
    // A flip-flop / counter output used as a clock is a derived clock, not a gated one (ripple counters)
    if (c.inputs.some((p) => isClockInput(pinKey(c, p)))) continue;
    for (const p of c.inputs) {
      const d = driverOf.get(p.id);
      const o = d ? ownerOf.get(d) : undefined;
      if (o && !seen.has(o.id)) {
        seen.add(o.id);
        queue.push(o);
      }
    }
  }
  return 'logic';
}
