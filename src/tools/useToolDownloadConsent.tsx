// Download consent for WASM tool builds (Aşama 6.0c).
//
// Features call prepareTool(tool, confirm) before runTool(). When a WASM build has not been agreed to yet, the
// confirm function shows the dialog and resolves with the user's answer. Usage in a component:
//
//   const { confirmDownload, downloadDialog } = useToolDownloadConsent(dark);
//   const status = await prepareTool('yosys', confirmDownload);
//   if (status.available) await runTool({ tool: 'yosys', ... });
//   ...
//   return <>{...}{downloadDialog}</>;
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DownloadRequest } from './runner';
import { ToolDownloadDialog } from './ToolDownloadDialog';

/** A confirm function for prepareTool() plus the dialog element the component must render */
export function useToolDownloadConsent(dark: boolean): {
  confirmDownload: (request: DownloadRequest) => Promise<boolean>;
  downloadDialog: ReactNode;
} {
  const [pending, setPending] = useState<{ request: DownloadRequest; resolve: (agreed: boolean) => void } | null>(null);
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // An unmounted component answers "no" so a waiting feature does not hang.
  useEffect(() => () => pendingRef.current?.resolve(false), []);

  const confirmDownload = useCallback(
    (request: DownloadRequest) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        setPending({ request, resolve });
      }),
    [],
  );

  const downloadDialog = pending ? (
    <ToolDownloadDialog
      request={pending.request}
      dark={dark}
      onAnswer={(agreed) => {
        pending.resolve(agreed);
        setPending(null);
      }}
    />
  ) : null;

  return { confirmDownload, downloadDialog };
}
