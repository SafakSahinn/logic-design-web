// Pure parts of the "build and program" panel (FpgaBuildPanel), kept apart so they can be tested without React:
// which message a failed tool run shows, and which plan a built bitstream belongs to.
import { ToolError } from '../../tools';
import type { FlowPlan } from '../flow';

export interface BuildMessage {
  kind: 'ok' | 'error' | 'info';
  text: string;
  details?: string[];
}

/** The translation function the panel uses (react-i18next's t for the "fpga" namespace) */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** How the desktop runner reports a flash write the user did not confirm (electron/toolRunner.cjs) */
export const DECLINED_MESSAGE = 'Declined by the user';

/**
 * The message for a run the tool runner refused or broke off. `stage` is the step's display name, `programming`
 * tells whether the step was openFPGALoader (program or detect), `aborted` whether the panel itself cancelled it.
 */
export function runErrorMessage(t: Translate, error: unknown, stage: string, programming: boolean, aborted: boolean): BuildMessage {
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
        return { kind: 'error', text: t('build.error.busy') };
      case 'unavailable':
        if (programming && error.reason === 'not-installed') return { kind: 'error', text: t('build.error.noProgrammer') };
        return { kind: 'error', text: t('build.error.toolUnavailable', { message: error.message }) };
      default:
        return { kind: 'error', text: t('build.error.internal', { stage, message: error.message }) };
    }
  }
  return { kind: 'error', text: t('build.error.internal', { stage, message: error instanceof Error ? error.message : String(error) }) };
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
