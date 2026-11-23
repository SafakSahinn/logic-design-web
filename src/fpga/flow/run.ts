// Runs a planned flow stage by stage. Each stage gets only the files it needs (project files and earlier
// outputs); a stage that exits non-zero or leaves out an expected file stops the flow.
import type { ToolFileData } from '../../tools/types';
import type { FlowPlan, FlowResult, FlowRunOptions, FlowStageResult, FlowToolRun } from './model';

export async function runFlow(plan: FlowPlan, run: FlowToolRun, options: FlowRunOptions = {}): Promise<FlowResult> {
  const available = new Map<string, ToolFileData>(Object.entries(plan.files));
  const results: FlowStageResult[] = [];
  for (let i = 0; i < plan.stages.length; i++) {
    const stage = plan.stages[i];
    options.onStage?.(stage, i, plan.stages.length);
    const files: Record<string, ToolFileData> = {};
    for (const name of stage.needs) {
      const data = available.get(name);
      if (data === undefined) return { ok: false, failure: { kind: 'toolFailed', stage: stage.id, exitCode: -1, missing: name }, stages: results };
      files[name] = data;
    }
    const started = Date.now();
    let r: Awaited<ReturnType<FlowToolRun>>;
    try {
      r = await run({
        tool: stage.tool,
        args: stage.args,
        files,
        outputs: stage.outputs,
        timeoutMs: stage.timeoutMs,
        signal: options.signal,
        onProgress: options.onLine ? (p) => p.phase === 'run' && p.line !== undefined && options.onLine!(stage, p.line, p.stream ?? 'stdout') : undefined,
      });
    } catch (error) {
      return { ok: false, failure: { kind: 'runError', stage: stage.id, error }, stages: results };
    }
    results.push({ id: stage.id, tool: stage.tool, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, durationMs: Date.now() - started });
    if (r.exitCode !== 0) return { ok: false, failure: { kind: 'toolFailed', stage: stage.id, exitCode: r.exitCode }, stages: results };
    if (stage.stdoutTo) available.set(stage.stdoutTo, r.stdout);
    for (const name of stage.outputs) {
      const data = r.files[name];
      if (!data) return { ok: false, failure: { kind: 'toolFailed', stage: stage.id, exitCode: r.exitCode, missing: name }, stages: results };
      available.set(name, data);
    }
  }
  const bit = available.get(plan.bitstream);
  if (!(bit instanceof Uint8Array)) {
    const last = plan.stages[plan.stages.length - 1];
    return { ok: false, failure: { kind: 'toolFailed', stage: last.id, exitCode: 0, missing: plan.bitstream }, stages: results };
  }
  return { ok: true, bitstream: bit, stages: results };
}

/** The ERROR / Error lines of a failed stage's output, for the summary (the full log stays available) */
export function flowErrorLines(result: FlowStageResult, max = 8): string[] {
  const lines = `${result.stderr}\n${result.stdout}`.split(/\r?\n/);
  return lines.filter((l) => /^\s*(ERROR|Error|error)\b|:\s*error:/.test(l)).slice(0, max);
}
