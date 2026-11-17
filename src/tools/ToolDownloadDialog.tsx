// Download consent for WASM tool builds (Aşama 6.0c).
//
// Shown by useToolDownloadConsent (see there for how features use it).
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, X } from 'lucide-react';
import { TOOLS_NAMESPACE } from './runner';
import type { DownloadRequest } from './runner';

interface ToolDownloadDialogProps {
  request: DownloadRequest;
  dark: boolean;
  onAnswer: (agreed: boolean) => void;
}

export function ToolDownloadDialog({ request, dark, onAnswer }: ToolDownloadDialogProps) {
  const { t } = useTranslation(TOOLS_NAMESPACE);
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => boxRef.current?.focus(), []);
  const vars = { tool: request.displayName, size: request.downloadMB };
  const c = dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', sub: 'text-slate-400', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-gradient-to-r from-cyan-50 to-sky-50', sub: 'text-slate-600', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300' };

  return (
    <div
      className="fixed inset-0 z-[95] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onAnswer(false);
      }}
    >
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lds-tool-download-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onAnswer(false);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            onAnswer(true);
          }
        }}
        className={`rounded-3xl max-w-md w-full border shadow-2xl overflow-hidden flex flex-col outline-none animate-in fade-in zoom-in-95 duration-150 ${c.panel}`}
      >
        <div className={`p-4 border-b flex items-center justify-between ${c.head}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500 text-white rounded-2xl shadow-xs">
              <Download size={18} />
            </div>
            <h2 id="lds-tool-download-title" className="font-semibold">
              {t('download.title', vars)}
            </h2>
          </div>
          <button type="button" className={`p-1.5 rounded-xl border ${c.btn}`} onClick={() => onAnswer(false)} aria-label={t('download.cancel')}>
            <X size={16} />
          </button>
        </div>
        <p className={`p-4 text-sm leading-relaxed ${c.sub}`}>{t('download.body', vars)}</p>
        <div className="px-4 pb-4 flex justify-end gap-2">
          <button type="button" className={`px-4 py-2 rounded-xl border text-sm ${c.btn}`} onClick={() => onAnswer(false)}>
            {t('download.cancel')}
          </button>
          <button type="button" className="px-4 py-2 rounded-xl text-sm bg-sky-600 hover:bg-sky-500 text-white font-medium" onClick={() => onAnswer(true)}>
            {t('download.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
