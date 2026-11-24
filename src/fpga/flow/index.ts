// Public entry of the open-source FPGA flow (Aşama 6j).
import type { BoardDefinition } from '../board/model';
import type { DrcIssue } from '../drc/issue';
import { buildFpgaProject, type FpgaProject, type FpgaProjectInput } from '../hdl/project';
import { isEcp5Board, planEcp5Flow } from './ecp5';
import { isXc7Board, planXc7Flow } from './xc7';
import type { FlowPlan, OpenFlowFamily } from './model';

export * from './model';
export { ECP5_FILES, ecp5Device, isEcp5Board, planEcp5Flow } from './ecp5';
export { XC7_FILES, isXc7Board, planXc7Flow, xc7Device } from './xc7';
export { flowErrorLines, runFlow } from './run';
export { vendorHint, type VendorFailure, type VendorHintKey, type VendorTool } from './vendorHints';
export {
  canWriteFlash,
  classifyProgramOutput,
  planDetect,
  planProgram,
  programmerArgs,
  PROGRAM_FILE,
  runProgram,
  saveBitstream,
  type ProgramProblem,
  type ProgramRequest,
  type ProgramResult,
  type ProgramTarget,
  type ProgramToolRun,
} from './program';

/** The open flow that can build for a board, or null (vendor flows: Aşama 6k) */
export function openFlowFamily(board: BoardDefinition): OpenFlowFamily | null {
  if (isEcp5Board(board)) return 'ecp5';
  if (isXc7Board(board)) return 'xc7';
  return null;
}

export type OpenFlowPlanResult =
  | {
      ok: true;
      plan: FlowPlan;
      project: Extract<FpgaProject, { ok: true }>;
      /** The language synthesized: the chosen one, or Verilog when VHDL was chosen but ghdl cannot run here */
      synthLang: 'verilog' | 'vhdl';
    }
  | { ok: false; reason: 'drc'; issues: DrcIssue[] }
  | { ok: false; reason: 'notSupported' | 'unknownPart' | 'badPackage' };

/**
 * Builds the project (design rule check first, as evo) and plans the flow. VHDL is synthesized through ghdl only
 * where ghdl runs (the desktop with ghdl installed); elsewhere the same circuit is written in Verilog for the
 * flow, which the HDL tests keep equivalent to the VHDL.
 */
export function planOpenFlow(input: FpgaProjectInput, options: { canRunGhdl: boolean; writeRouted?: boolean }): OpenFlowPlanResult {
  const family = openFlowFamily(input.board);
  if (!family) return { ok: false, reason: 'notSupported' };
  const synthLang: 'verilog' | 'vhdl' = input.lang === 'vhdl' && options.canRunGhdl ? 'vhdl' : 'verilog';
  const project = buildFpgaProject({ ...input, lang: synthLang });
  if (!project.ok) return { ok: false, reason: 'drc', issues: project.issues };
  const flowInput = {
    board: input.board,
    top: project.plan.name,
    sources: [project.design, project.topLevel],
    lang: synthLang,
    constraints: project.constraints,
    writeRouted: options.writeRouted,
  };
  const planned = family === 'ecp5' ? planEcp5Flow(flowInput) : planXc7Flow(flowInput);
  if (!planned.ok) return { ok: false, reason: planned.reason === 'notEcp5' || planned.reason === 'notXc7' ? 'notSupported' : planned.reason };
  return { ok: true, plan: planned.plan, project, synthLang };
}
