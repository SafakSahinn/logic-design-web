// The FPGA project files of a circuit on a board (Aşama 6i-4): the design module (hdlGenerator), the top level
// around it and the pin constraints. As in Logisim-evolution, nothing is generated while the design rule check
// reports an error; its warnings go into the files' headers.
import type { CircuitComponentInstance, CircuitWire } from '../../types/circuit';
import { generateVerilog, generateVHDL, getTopLevelPorts, getTopModuleName } from '../../utils/hdlGenerator';
import type { BoardDefinition } from '../board/model';
import { checkDesign } from '../drc/design';
import { hasErrors, sortIssues, type DrcIssue } from '../drc/issue';
import { checkBoard, checkMapping } from '../drc/mapping';
import { collectMappableParts, type BoardMapping } from '../map/model';
import { resolveMapping } from '../map/resolve';
import { writeConstraints, type ConstraintFile } from './constraints';
import type { HdlLang } from './drivers';
import { planTopLevel, type ClockOptions, type TopLevelPlan } from './plan';
import { writeTopLevel } from './wrapper';

export interface FpgaProjectInput {
  circuitName: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  board: BoardDefinition;
  mapping: BoardMapping;
  lang: HdlLang;
  clock: ClockOptions;
  /** Text of a finding for the file headers (the current language); the code when not given */
  describe?: (issue: DrcIssue) => string;
}

export interface FpgaProjectFile {
  fileName: string;
  text: string;
}

export type FpgaProject =
  | { ok: false; issues: DrcIssue[] }
  | {
      ok: true;
      /** Warnings and remarks of the design rule check */
      issues: DrcIssue[];
      plan: TopLevelPlan;
      design: FpgaProjectFile;
      topLevel: FpgaProjectFile;
      constraints: ConstraintFile;
    };

/** Runs the design rule check and, when it finds no error, makes the three files */
export function buildFpgaProject(input: FpgaProjectInput): FpgaProject {
  const { circuitName, components, wires, board, mapping, lang } = input;
  const ports = getTopLevelPorts(circuitName, components, wires);
  const parts = collectMappableParts(ports, components);
  const issues = sortIssues([...checkDesign(circuitName, components, wires), ...checkBoard(board), ...checkMapping(board, parts, mapping)]);
  if (hasErrors(issues)) return { ok: false, issues };

  const clockRates: Record<string, number | undefined> = {};
  for (const c of components) if (c.type === 'clock') clockRates[c.id] = c.state?.clockRateHz;
  const plan = planTopLevel({
    designName: getTopModuleName(circuitName),
    designPorts: ports,
    resolved: resolveMapping(board, parts, mapping),
    board,
    clockRates,
    clock: input.clock,
  });
  const planIssues: DrcIssue[] = plan.problems.map((p) => ({
    code: 'resourcePins',
    severity: 'error',
    values: { resource: p.io.label || `${p.io.kind} @ ${p.io.rect.x},${p.io.rect.y}`, expected: p.expected, actual: p.actual },
  }));
  if (planIssues.length) return { ok: false, issues: sortIssues([...issues, ...planIssues]) };

  const ext = lang === 'verilog' ? 'v' : 'vhd';
  const describe = input.describe ?? ((i: DrcIssue) => i.code);
  const notes = issues.filter((i) => i.severity === 'warning').map((i) => `Warning: ${describe(i)}`);
  const header = [`Board: ${board.name}`, ...notes];
  const design: FpgaProjectFile = {
    fileName: `${plan.designName}.${ext}`,
    text: (lang === 'verilog' ? generateVerilog : generateVHDL)(circuitName, components, wires),
  };
  const topLevel: FpgaProjectFile = { fileName: `${plan.name}.${ext}`, text: writeTopLevel(plan, lang, { header }) };
  const constraints = writeConstraints(plan, board, {
    header: notes,
    files: [
      { name: design.fileName, lang },
      { name: topLevel.fileName, lang },
    ],
  });
  return { ok: true, issues, plan, design, topLevel, constraints };
}
