// Open-source FPGA flow (Aşama 6j): the stages from the project files to a bitstream, as tool runs.
//
// A flow is planned first (pure: which tool, which arguments, which files) and then run stage by stage through
// an injected runner (src/tools runTool in the app, the native runner in tests). Every stage runs in its own
// empty folder, so the files a stage needs from earlier stages are carried over explicitly.
import type { ToolFileData, ToolId, ToolProgress } from '../../tools/types';

/** Families the open flow can build */
export type OpenFlowFamily = 'ecp5' | 'xc7';

/** Families a vendor flow builds (Aşama 6k, desktop only) */
export type VendorFlowFamily = 'vivado';

export type FlowFamily = OpenFlowFamily | VendorFlowFamily;

/** vendorBuild: a vendor tool's whole build in one run (synthesis to bitstream) */
export type FlowStageId = 'vhdlToVerilog' | 'synth' | 'placeRoute' | 'frames' | 'pack' | 'vendorBuild';

export interface FlowStage {
  id: FlowStageId;
  tool: ToolId;
  args: string[];
  /** Files of the flow (project files and earlier outputs) this stage reads */
  needs: string[];
  /** Files this stage writes and later stages read */
  outputs: string[];
  /** The tool writes its result to stdout (ghdl --synth); it is kept as this file */
  stdoutTo?: string;
  timeoutMs: number;
}

export interface FlowPlan {
  family: FlowFamily;
  /** The project files, keyed by file name */
  files: Record<string, string>;
  stages: FlowStage[];
  /** File name of the bitstream the last stage writes */
  bitstream: string;
  /** Intermediate outputs handed back with the result (the routed netlist for the post-route check ...) */
  keep?: string[];
}

/** The part of src/tools runTool a flow uses */
export type FlowToolRun = (request: {
  tool: ToolId;
  args: string[];
  files: Record<string, ToolFileData>;
  outputs: string[];
  timeoutMs: number;
  signal?: AbortSignal;
  onProgress?: (progress: ToolProgress) => void;
}) => Promise<{ exitCode: number; stdout: string; stderr: string; files: Record<string, Uint8Array> }>;

export interface FlowStageResult {
  id: FlowStageId;
  tool: ToolId;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export type FlowFailure =
  /** The tool ran and failed (exit code, or an expected output is missing) */
  | { kind: 'toolFailed'; stage: FlowStageId; exitCode: number; missing?: string }
  /** The runner refused or broke off the run (tool unavailable, cancelled, timeout ...) */
  | { kind: 'runError'; stage: FlowStageId; error: unknown };

export type FlowResult =
  | { ok: true; bitstream: Uint8Array; stages: FlowStageResult[]; kept: Record<string, ToolFileData> }
  | { ok: false; failure: FlowFailure; stages: FlowStageResult[] };

export interface FlowRunOptions {
  signal?: AbortSignal;
  /** Called when a stage starts */
  onStage?: (stage: FlowStage, index: number, count: number) => void;
  /** One line a tool printed */
  onLine?: (stage: FlowStage, line: string, stream: 'stdout' | 'stderr') => void;
}
