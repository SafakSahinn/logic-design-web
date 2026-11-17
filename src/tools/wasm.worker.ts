/// <reference lib="webworker" />
// WASM tool worker (Aşama 6.0c): runs YoWASP builds off the UI thread.
//
// One worker serves one package and runs one command at a time; the backend queues runs and terminates the
// worker to cancel. The package module is imported once and kept, so its compiled WebAssembly is reused.
// Files: the request's flat map ("src/top.v" -> data) becomes the YoWASP tree, and the requested outputs are
// picked back out of the tree the command returns.
import type { WorkerRequest, WorkerResponse } from './wasmProtocol';

type Tree = { [name: string]: Tree | string | Uint8Array };
type Command = (
  args: string[],
  files: Tree,
  options: {
    stdout?: (bytes: Uint8Array | null) => void;
    stderr?: (bytes: Uint8Array | null) => void;
    decodeASCII?: boolean;
    fetchProgress?: (event: { totalLength: number; doneLength: number }) => void;
  },
) => Promise<Tree | undefined> | Tree | undefined;

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (message: WorkerResponse, transfer: Transferable[] = []) => ctx.postMessage(message, transfer);

let loadedUrl: string | null = null;
let loadedModule: Record<string, unknown> | null = null;

async function loadModule(url: string): Promise<Record<string, unknown>> {
  if (loadedModule && loadedUrl === url) return loadedModule;
  // The URL comes from the app's own tool table (registry.ts), never from user input.
  loadedModule = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
  loadedUrl = url;
  return loadedModule;
}

function toTree(files: Record<string, string | Uint8Array>): Tree {
  const root: Tree = {};
  for (const [path, data] of Object.entries(files)) {
    const parts = path.split(/[\\/]/);
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      const next = node[dir];
      if (next === undefined || typeof next === 'string' || next instanceof Uint8Array) node[dir] = {};
      node = node[dir] as Tree;
    }
    node[parts[parts.length - 1]] = data;
  }
  return root;
}

function pick(tree: Tree | undefined, path: string): Uint8Array | null {
  let node: Tree | string | Uint8Array | undefined = tree;
  for (const part of path.split(/[\\/]/)) {
    if (!node || typeof node === 'string' || node instanceof Uint8Array) return null;
    node = node[part];
  }
  if (typeof node === 'string') return new TextEncoder().encode(node);
  return node instanceof Uint8Array ? node : null;
}

/** Collects one output stream: keeps the whole text and posts complete lines in small batches */
function streamCollector(id: number, stream: 'stdout' | 'stderr', limitBytes: number) {
  const decoder = new TextDecoder();
  let text = '';
  let partial = '';
  let bytes = 0;
  let overflow = false;
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    if (pending.length) post({ type: 'lines', id, stream, lines: pending });
    pending = [];
  };
  const onBytes = (chunk: Uint8Array | null) => {
    if (overflow) return;
    const piece = chunk ? decoder.decode(chunk, { stream: true }) : decoder.decode();
    bytes += chunk ? chunk.length : 0;
    if (bytes > limitBytes) {
      overflow = true;
      return;
    }
    text += piece;
    const lines = (partial + piece).split(/\r?\n/);
    partial = lines.pop() ?? '';
    for (const line of lines) pending.push(line.slice(0, 2000));
    if (!chunk && partial) {
      pending.push(partial.slice(0, 2000));
      partial = '';
    }
    if (pending.length && !timer) timer = setTimeout(flush, 100);
  };
  const finish = () => {
    if (partial) pending.push(partial.slice(0, 2000));
    partial = '';
    if (timer) clearTimeout(timer);
    flush();
    return text;
  };
  return { onBytes, finish, get overflow() {
    return overflow;
  } };
}

ctx.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === 'version') {
    try {
      const mod = await loadModule(req.url);
      post({ type: 'version', id: req.id, version: typeof mod.version === 'string' ? mod.version : undefined });
    } catch (err) {
      post({ type: 'error', id: req.id, kind: 'internal', message: String(err instanceof Error ? err.message : err) });
    }
    return;
  }
  if (req.type !== 'run') return;

  const started = performance.now();
  const out = streamCollector(req.id, 'stdout', req.streamLimitBytes);
  const err = streamCollector(req.id, 'stderr', req.streamLimitBytes);
  let exitCode = 0;
  let tree: Tree | undefined;
  try {
    const mod = await loadModule(req.url);
    const command = mod[req.entry];
    if (typeof command !== 'function') throw new Error(`${req.entry} is not exported by the package`);
    try {
      tree = await (command as Command)(req.args, toTree(req.files), {
        stdout: out.onBytes,
        stderr: err.onBytes,
        decodeASCII: false,
        fetchProgress: (p) => post({ type: 'download', id: req.id, loaded: p.doneLength, total: p.totalLength }),
      });
    } catch (e) {
      // YoWASP throws an Exit (with code and files) when the program exits with a non-zero code.
      const exit = e as { code?: unknown; files?: Tree };
      if (typeof exit?.code !== 'number') throw e;
      exitCode = exit.code;
      tree = exit.files;
    }
    const stdout = out.finish();
    const stderr = err.finish();
    if (out.overflow || err.overflow) {
      post({ type: 'error', id: req.id, kind: 'output-limit', message: 'Too much output' });
      return;
    }
    const files: Record<string, Uint8Array> = {};
    for (const path of req.outputs) {
      const data = pick(tree, path);
      if (data) files[path] = data.slice(); // own copy, so it can be transferred
    }
    post(
      { type: 'done', id: req.id, exitCode, stdout, stderr, files, durationMs: Math.round(performance.now() - started) },
      Object.values(files).map((f) => f.buffer as ArrayBuffer),
    );
  } catch (e) {
    out.finish();
    err.finish();
    post({ type: 'error', id: req.id, kind: 'internal', message: String(e instanceof Error ? e.message : e) });
  }
};
