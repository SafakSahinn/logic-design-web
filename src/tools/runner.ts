// ToolRunner (Aşama 6.0c): picks a backend per tool and runs it.
//
// Choice per tool: the native backend when it can run the tool (desktop with the program installed),
// otherwise the WASM backend when the tool has a WASM build and the user agreed to its download.
// Backends register themselves (registerToolBackend) so this module has no Electron or Worker code.
import i18n, { registerNamespace } from '../i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { getToolDefinition, isSafeRelativePath, isToolId } from './registry';
import {
  ToolError,
  type ToolBackend,
  type ToolBackendKind,
  type ToolId,
  type ToolRunRequest,
  type ToolRunResult,
  type ToolStatus,
} from './types';

export const TOOLS_NAMESPACE = 'tools';
registerNamespace(TOOLS_NAMESPACE, { en, tr });

const backends = new Map<ToolBackendKind, ToolBackend>();

export function registerToolBackend(backend: ToolBackend): void {
  backends.set(backend.kind, backend);
}

// --- WASM download consent ------------------------------------------------------------------------
// Remembered per package (one consent covers nextpnr-ecp5 and ecppack). Browser storage is fine here:
// losing it only means the question is asked again.
const CONSENT_KEY = 'lds.tools.wasmConsent';

function readConsent(): Set<string> {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

export function hasDownloadConsent(tool: ToolId): boolean {
  const wasm = getToolDefinition(tool).wasm;
  return !!wasm && readConsent().has(wasm.pkg);
}

export function grantDownloadConsent(tool: ToolId): void {
  const wasm = getToolDefinition(tool).wasm;
  if (!wasm) return;
  const consent = readConsent();
  consent.add(wasm.pkg);
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify([...consent]));
  } catch {
    // ignore: asked again next time
  }
}

// --- Status ---------------------------------------------------------------------------------------

export async function toolStatus(tool: ToolId): Promise<ToolStatus> {
  if (!isToolId(tool)) throw new ToolError('bad-request', `Unknown tool: ${String(tool)}`);
  const def = getToolDefinition(tool);

  const native = backends.get('native');
  if (def.native && native) {
    const probe = await native.probe(tool);
    if (probe.available) return { tool, available: true, backend: 'native', version: probe.version };
  }

  const wasm = backends.get('wasm');
  if (def.wasm && wasm) {
    // The WASM probe never downloads, so it runs before the consent check: a build that is not wired up yet
    // must not ask for a download.
    const probe = await wasm.probe(tool);
    if (!probe.available) return { tool, available: false, reason: probe.reason ?? 'no-backend' };
    if (!hasDownloadConsent(tool)) {
      return { tool, available: false, backend: 'wasm', reason: 'download-required', downloadMB: def.wasm.downloadMB };
    }
    return { tool, available: true, backend: 'wasm', version: probe.version };
  }

  // A desktop program that is missing can be installed; otherwise the build lacks the needed backend.
  if (def.native && native) return { tool, available: false, reason: 'not-installed' };
  return { tool, available: false, reason: def.wasm ? 'no-backend' : 'web-unsupported' };
}

/** The status as one sentence in the UI language */
export function describeToolStatus(status: ToolStatus): string {
  const def = getToolDefinition(status.tool);
  const vars = { tool: def.displayName, size: status.downloadMB ?? 0 };
  const t = (key: string, extra: Record<string, unknown> = {}) => i18n.t(`${TOOLS_NAMESPACE}:${key}`, { ...vars, ...extra });
  if (status.available) return t('status.available', { backend: t(`backend.${status.backend ?? 'native'}`) });
  switch (status.reason) {
    case 'web-unsupported':
      return t('status.webUnsupported');
    case 'download-required':
      return t('status.downloadRequired');
    case 'not-installed':
      return t('status.notInstalled');
    default:
      return t('status.noBackend');
  }
}

/** What the consent dialog shows */
export interface DownloadRequest {
  tool: ToolId;
  displayName: string;
  downloadMB: number;
}

/**
 * The tool's status after asking for a pending WASM download: when the status is "download-required", confirm()
 * is called (normally the dialog from useToolDownloadConsent) and an agreement is remembered.
 */
export async function prepareTool(tool: ToolId, confirm: (request: DownloadRequest) => Promise<boolean>): Promise<ToolStatus> {
  const status = await toolStatus(tool);
  if (status.available || status.reason !== 'download-required') return status;
  const def = getToolDefinition(tool);
  const agreed = await confirm({ tool, displayName: def.displayName, downloadMB: status.downloadMB ?? def.wasm?.downloadMB ?? 0 });
  if (!agreed) return status;
  grantDownloadConsent(tool);
  return toolStatus(tool);
}

// --- Run ------------------------------------------------------------------------------------------

function validate(request: ToolRunRequest): void {
  if (!isToolId(request.tool)) throw new ToolError('bad-request', `Unknown tool: ${String(request.tool)}`);
  if (!Array.isArray(request.args) || request.args.some((a) => typeof a !== 'string' || a.includes('\0'))) {
    throw new ToolError('bad-request', 'Arguments must be strings without NUL', request.tool);
  }
  for (const path of [...Object.keys(request.files ?? {}), ...(request.outputs ?? [])]) {
    if (!isSafeRelativePath(path)) throw new ToolError('bad-request', `Unsafe file path: ${path}`, request.tool);
  }
}

export async function runTool(request: ToolRunRequest): Promise<ToolRunResult> {
  validate(request);
  if (request.signal?.aborted) throw new ToolError('cancelled', 'Cancelled before start', request.tool);

  let kind = request.backend;
  if (!kind) {
    const status = await toolStatus(request.tool);
    if (!status.available || !status.backend) {
      throw new ToolError('unavailable', describeToolStatus(status), request.tool, status.reason);
    }
    kind = status.backend;
  }
  const backend = backends.get(kind);
  if (!backend) throw new ToolError('unavailable', `No ${kind} backend in this build`, request.tool, 'no-backend');
  return backend.run(request);
}
