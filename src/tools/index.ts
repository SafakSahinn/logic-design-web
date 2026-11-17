// Public entry of the ToolRunner (Aşama 6.0c). Import from 'src/tools', not from the inner files.
export * from './types';
export { TOOL_DEFINITIONS, TOOL_IDS, getToolDefinition, isToolId } from './registry';
export {
  TOOLS_NAMESPACE,
  describeToolStatus,
  grantDownloadConsent,
  hasDownloadConsent,
  prepareTool,
  registerToolBackend,
  runTool,
  toolStatus,
} from './runner';

export type { DownloadRequest } from './runner';
export { stopWasmWorkers } from './wasmBackend';
export { ToolDownloadDialog } from './ToolDownloadDialog';
export { useToolDownloadConsent } from './useToolDownloadConsent';

import { createNativeBackend, getLdsTool } from './nativeBackend';
import { registerToolBackend } from './runner';
import { createWasmBackend } from './wasmBackend';

// The desktop app exposes window.ldsTool; the web build has no native backend.
const ldsTool = getLdsTool();
if (ldsTool) registerToolBackend(createNativeBackend(ldsTool));
// WASM builds run wherever workers exist: the web, and the desktop as the fallback for missing programs.
if (typeof Worker !== 'undefined') registerToolBackend(createWasmBackend());
