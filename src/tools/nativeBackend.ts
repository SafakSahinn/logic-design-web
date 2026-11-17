// Native backend (Aşama 6.0c): runs installed programs through the desktop app's lds-tool:* IPC.
// Exists only in the desktop app (window.ldsTool from electron/preload.cjs); on the web it is never registered.
import { isToolId } from './registry';
import {
  DEFAULT_TIMEOUT_MS,
  ToolError,
  type ToolBackend,
  type ToolErrorKind,
  type ToolId,
  type ToolProgress,
  type ToolRunRequest,
  type ToolRunResult,
  type ToolUnavailableReason,
} from './types';

interface NativeProbe {
  available: boolean;
  version?: string;
  reason?: ToolUnavailableReason;
}

interface NativeRunResponse {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  files?: Record<string, Uint8Array>;
  durationMs?: number;
  error?: { kind: ToolErrorKind; message: string };
}

interface NativeProgress {
  phase: 'run';
  lines?: { stream: 'stdout' | 'stderr'; line: string }[];
}

/** The bridge exposed by electron/preload.cjs */
interface LdsToolBridge {
  probe(tool: string): Promise<NativeProbe>;
  run(req: {
    runId: string;
    tool: string;
    args: string[];
    files: Record<string, string | Uint8Array>;
    outputs: string[];
    timeoutMs: number;
  }): Promise<NativeRunResponse>;
  cancel(runId: string): Promise<boolean>;
  onProgress(cb: (runId: string, progress: NativeProgress) => void): () => void;
}

export function getLdsTool(): LdsToolBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as unknown as { ldsTool?: LdsToolBridge }).ldsTool;
  return bridge && typeof bridge.run === 'function' ? bridge : null;
}

let runCounter = 0;

export function createNativeBackend(bridge: LdsToolBridge): ToolBackend {
  const progressListeners = new Map<string, (p: ToolProgress) => void>();
  bridge.onProgress((runId, progress) => {
    const listener = progressListeners.get(runId);
    if (!listener || !progress?.lines) return;
    for (const { stream, line } of progress.lines) listener({ phase: 'run', stream, line });
  });

  return {
    kind: 'native',

    async probe(tool: ToolId) {
      if (!isToolId(tool)) return { available: false, reason: 'not-installed' };
      const r = await bridge.probe(tool);
      return { available: r.available === true, version: r.version, reason: r.reason };
    },

    async run(request: ToolRunRequest): Promise<ToolRunResult> {
      const runId = `run-${Date.now()}-${++runCounter}`;
      if (request.onProgress) progressListeners.set(runId, request.onProgress);
      const onAbort = () => void bridge.cancel(runId);
      request.signal?.addEventListener('abort', onAbort);
      try {
        const r = await bridge.run({
          runId,
          tool: request.tool,
          args: request.args,
          files: request.files ?? {},
          outputs: request.outputs ?? [],
          timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        });
        if (r.error) {
          const reason = r.error.kind === 'unavailable' ? 'not-installed' : undefined;
          throw new ToolError(r.error.kind, r.error.message, request.tool, reason);
        }
        return {
          exitCode: r.exitCode ?? -1,
          stdout: r.stdout ?? '',
          stderr: r.stderr ?? '',
          files: r.files ?? {},
          backend: 'native',
          durationMs: r.durationMs ?? 0,
        };
      } finally {
        request.signal?.removeEventListener('abort', onAbort);
        progressListeners.delete(runId);
      }
    },
  };
}
