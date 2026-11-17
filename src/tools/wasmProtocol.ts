// Messages between the WASM backend and wasm.worker.ts (Aşama 6.0c).
import type { ToolErrorKind } from './types';

export type WorkerRequest =
  | { type: 'version'; id: number; url: string }
  | {
      type: 'run';
      id: number;
      /** ES module of the YoWASP package (from registry.ts) */
      url: string;
      /** Export that runs the tool, e.g. runYosys */
      entry: string;
      args: string[];
      files: Record<string, string | Uint8Array>;
      outputs: string[];
      streamLimitBytes: number;
    };

export type WorkerResponse =
  | { type: 'version'; id: number; version?: string }
  | { type: 'download'; id: number; loaded: number; total: number }
  | { type: 'lines'; id: number; stream: 'stdout' | 'stderr'; lines: string[] }
  | {
      type: 'done';
      id: number;
      exitCode: number;
      stdout: string;
      stderr: string;
      files: Record<string, Uint8Array>;
      durationMs: number;
    }
  | { type: 'error'; id: number; kind: ToolErrorKind; message: string };
