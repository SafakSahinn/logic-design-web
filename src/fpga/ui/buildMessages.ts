// Pure parts of the "build and program" panel (FpgaBuildPanel), kept apart so they can be tested without React:
// which message a failed tool run shows, and which plan a built bitstream belongs to.
import { ToolError, type ToolId } from '../../tools';
import { vendorHint, type FlowPlan, type VendorTool } from '../flow';

export interface BuildMessage {
  kind: 'ok' | 'error' | 'info';
  text: string;
  details?: string[];
  /** What to do about a known vendor-tool failure (build.vendorHint.*) */
  hint?: string;
  /** The hint points to the panel's "Vendor tools" section: the panel opens it */
  openVendorTools?: boolean;
}

const VENDOR_TOOLS: readonly ToolId[] = ['vivado', 'quartus', 'ise'];

/**
 * Adds the hint for a known vendor-tool failure (no license, a hang at start-up ...) to a failure message. The
 * run either ended with an exit code and output, or the runner broke it off (error).
 */
export function withVendorHint(
  t: Translate,
  message: BuildMessage,
  tool: ToolId,
  failure: { exitCode?: number; log?: string; error?: unknown },
): BuildMessage {
  if (!VENDOR_TOOLS.includes(tool)) return message;
  const errorKind = failure.error instanceof ToolError ? failure.error.kind : undefined;
  const key = vendorHint({ tool: tool as VendorTool, exitCode: failure.exitCode, errorKind, log: failure.log });
  return key ? { ...message, hint: t(`build.vendorHint.${key}`) } : message;
}

/** The translation function the panel uses (react-i18next's t for the "fpga" namespace) */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** How the desktop runner reports a flash write the user did not confirm (electron/toolRunner.cjs) */
export const DECLINED_MESSAGE = 'Declined by the user';

/** The program a step runs, as the messages name it */
export interface StepTool {
  /** "openFPGALoader", "Vivado", "quartus_pgm", "iMPACT" ... */
  name: string;
  /** A vendor tool the user installs (Vivado, Quartus, ISE): set up under the panel's vendor tools */
  vendor: boolean;
}

const OPEN_PROGRAMMER: StepTool = { name: 'openFPGALoader', vendor: false };

/**
 * The message for a run the tool runner refused or broke off. `stage` is the step's display name, `programming`
 * tells whether the step was a programming one (program or detect), `aborted` whether the panel itself cancelled
 * it, `tool` which program the step ran (openFPGALoader when not given).
 */
export function runErrorMessage(
  t: Translate,
  error: unknown,
  stage: string,
  programming: boolean,
  aborted: boolean,
  tool: StepTool = OPEN_PROGRAMMER,
): BuildMessage {
  if (aborted) return { kind: 'info', text: t('build.result.cancelled') };
  if (error instanceof ToolError) {
    switch (error.kind) {
      case 'cancelled':
        // Not cancelled by the panel: the desktop's flash-write question was answered "no"
        return { kind: 'info', text: t(error.message === DECLINED_MESSAGE ? 'build.result.declined' : 'build.result.cancelled') };
      case 'timeout':
        return { kind: 'error', text: t('build.error.timeout', { stage }) };
      case 'stalled':
        return { kind: 'error', text: t('build.error.stalled', { stage }) };
      case 'output-limit':
        return { kind: 'error', text: t('build.error.outputLimit', { stage }) };
      case 'busy':
        return { kind: 'error', text: t('build.error.busy', { tool: tool.name }) };
      case 'unavailable':
        if (tool.vendor) return vendorMissingMessage(t, tool.name);
        if (programming && error.reason === 'not-installed') return { kind: 'error', text: t('build.error.noProgrammer') };
        return { kind: 'error', text: t('build.error.toolUnavailable', { message: error.message }) };
      default:
        return { kind: 'error', text: t('build.error.internal', { stage, message: error.message }) };
    }
  }
  return { kind: 'error', text: t('build.error.internal', { stage, message: error instanceof Error ? error.message : String(error) }) };
}

/** A vendor tool that is not installed (or not found): the hint points to the panel's vendor tools section */
export function vendorMissingMessage(t: Translate, toolName: string): BuildMessage {
  return { kind: 'error', text: t('build.error.vendorMissing', { tool: toolName }), hint: t('build.vendorHint.setFolder'), openVendorTools: true };
}

/**
 * openFPGALoader found no cable on a Xilinx board. Vivado leaves hw_server.exe (and cs_server.exe) running after
 * it exits, and hw_server keeps the JTAG cable open, so openFPGALoader cannot reach it. `running` is whether
 * hw_server runs now (null: not known). A hint the message already has is kept.
 */
export function withHwServerHint(t: Translate, message: BuildMessage, running: boolean | null): BuildMessage {
  if (running === false || message.hint) return message;
  return { ...message, hint: t(running ? 'build.vendorHint.hwServerRunning' : 'build.vendorHint.hwServerMaybe') };
}

/**
 * Identifies what a bitstream was built from: the project files and every tool's command line (the latter carry
 * the FPGA part and package, which a board edit can change without touching the files). A bitstream whose key
 * differs from the current plan's is stale and is not offered for download or programming.
 */
export function bitstreamKey(plan: Pick<FlowPlan, 'files' | 'stages'>): string {
  // The generated HDL carries a "Date:" header line that changes on every planning (the plan is redone whenever
  // the circuit's parts change, which a running simulation does all the time); it does not change the design
  const files = Object.entries(plan.files).map(([name, text]) => [name, text.replace(GENERATED_DATE, '')]);
  return JSON.stringify({ files, stages: plan.stages.map((s) => [s.id, s.tool, s.args]) });
}

/** The header line src/utils/hdlGenerator.ts writes ("// Date: ..." in Verilog, "-- Date: ..." in VHDL) */
const GENERATED_DATE = /^(?:\/\/|--) Date: .*$/gm;
