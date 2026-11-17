// WASM backend (Aşama 6.0c): runs YoWASP builds in Web Workers. Used on the web, and on the desktop when the
// native program is missing.
//
// One worker per npm package (nextpnr-ecp5 and ecppack share one), kept alive so the compiled WebAssembly is
// reused. Runs on the same package are queued. Cancelling or a timeout terminates that worker; the next run
// starts a fresh one (the downloaded files then come from the browser cache).
import { getToolDefinition, wasmModuleUrl } from './registry';
import type { WorkerRequest, WorkerResponse } from './wasmProtocol';
import { DEFAULT_TIMEOUT_MS, ToolError, type ToolBackend, type ToolId, type ToolRunRequest, type ToolRunResult } from './types';

const STREAM_LIMIT_BYTES = 16 * 1024 * 1024;

interface Slot {
  worker: Worker | null;
  /** Tail of the run queue of this package */
  queue: Promise<unknown>;
}

const slots = new Map<string, Slot>();
let messageCounter = 0;

function slotFor(pkg: string): Slot {
  let slot = slots.get(pkg);
  if (!slot) {
    slot = { worker: null, queue: Promise.resolve() };
    slots.set(pkg, slot);
  }
  return slot;
}

function workerOf(slot: Slot): Worker {
  if (!slot.worker) {
    slot.worker = new Worker(new URL('./wasm.worker.ts', import.meta.url), { type: 'module', name: 'lds-tool-wasm' });
  }
  return slot.worker;
}

function killWorker(slot: Slot): void {
  slot.worker?.terminate();
  slot.worker = null;
}

/** Runs one request on the slot's worker; the caller has already waited for its turn */
function runOnWorker(slot: Slot, request: ToolRunRequest, url: string, entry: string): Promise<ToolRunResult> {
  return new Promise<ToolRunResult>((resolve, reject) => {
    const worker = workerOf(slot);
    const id = ++messageCounter;
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let downloading = false;

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      request.signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    };
    const fail = (error: ToolError, kill: boolean) => {
      cleanup();
      if (kill) killWorker(slot);
      reject(error);
    };

    const onMessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.id !== id) return;
      switch (msg.type) {
        case 'download':
          downloading = msg.total > 0 && msg.loaded < msg.total;
          request.onProgress?.({ phase: 'download', loaded: msg.loaded, total: msg.total });
          break;
        case 'lines':
          for (const line of msg.lines) request.onProgress?.({ phase: 'run', stream: msg.stream, line });
          break;
        case 'done':
          cleanup();
          resolve({
            exitCode: msg.exitCode,
            stdout: msg.stdout,
            stderr: msg.stderr,
            files: msg.files,
            backend: 'wasm',
            durationMs: msg.durationMs,
          });
          break;
        case 'error':
          // A failed module import leaves the worker in an unknown state: start over next time.
          fail(new ToolError(msg.kind, msg.message, request.tool), msg.kind === 'internal');
          break;
      }
    };
    const onError = (event: ErrorEvent) => {
      event.preventDefault();
      fail(new ToolError('internal', event.message || 'Worker failed', request.tool), true);
    };
    const onAbort = () => fail(new ToolError('cancelled', 'Cancelled', request.tool), true);
    // The first run also downloads the build; a slow connection must not count against the tool's time.
    const onTimeout = () => {
      if (downloading) {
        timer = setTimeout(onTimeout, timeoutMs);
        return;
      }
      fail(new ToolError('timeout', `Stopped after ${timeoutMs} ms`, request.tool), true);
    };
    let timer = setTimeout(onTimeout, timeoutMs);

    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    request.signal?.addEventListener('abort', onAbort);

    const message: WorkerRequest = {
      type: 'run',
      id,
      url,
      entry,
      args: request.args,
      files: request.files ?? {},
      outputs: request.outputs ?? [],
      streamLimitBytes: STREAM_LIMIT_BYTES,
    };
    worker.postMessage(message);
  });
}

export function createWasmBackend(): ToolBackend {
  return {
    kind: 'wasm',

    async probe(tool: ToolId) {
      const wasm = getToolDefinition(tool).wasm;
      // Probing must not download anything: a pinned version is known to exist on the CDN.
      if (!wasm || !wasmModuleUrl(wasm)) return { available: false, reason: 'no-backend' };
      return { available: true, version: `${wasm.pkg}@${wasm.version}` };
    },

    async run(request: ToolRunRequest): Promise<ToolRunResult> {
      const wasm = getToolDefinition(request.tool).wasm;
      const url = wasm ? wasmModuleUrl(wasm) : null;
      if (!wasm || !url) throw new ToolError('unavailable', 'No WASM build for this tool', request.tool, 'no-backend');
      const slot = slotFor(wasm.pkg);
      const turn = slot.queue.catch(() => undefined).then(() => {
        if (request.signal?.aborted) throw new ToolError('cancelled', 'Cancelled', request.tool);
        return runOnWorker(slot, request, url, wasm.entry);
      });
      slot.queue = turn.catch(() => undefined);
      return turn;
    },
  };
}

/** Stops every WASM worker (e.g. when the page is closed) */
export function stopWasmWorkers(): void {
  for (const slot of slots.values()) killWorker(slot);
}
