// The PIO's "C header" attribute row: evo's "Export C" menu item. It writes <NAME>.h and <NAME>.c as two file
// downloads (the desktop app asks where to save each).
import { useState, type ReactNode } from 'react';
import { FileCode2 } from 'lucide-react';
import type { PartEditorProps } from '../registry';
import { pioCExport } from './cExport';
import { pioConfig, pioName } from './model';
import { t } from './text';

/** Hands the text to the browser as a file download */
function saveText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function SocPioExportRow({ comp, dark }: PartEditorProps): ReactNode {
  const [done, setDone] = useState<string | null>(null);
  const btn = dark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300';
  const sub = dark ? 'text-slate-400' : 'text-slate-500';
  const exportC = () => {
    const files = pioCExport(pioName(comp), pioConfig(comp));
    saveText(files.header, files.headerName);
    // a second download right after the first is dropped by some browsers
    setTimeout(() => saveText(files.source, files.sourceName), 300);
    setDone(t('cExport.done', { header: files.headerName, source: files.sourceName }));
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" data-socpio="export-c" className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer ${btn}`} onClick={exportC} title={t('attributes.cExport.title')}>
        <FileCode2 size={14} />
        {t('cExport.button')}
      </button>
      {done && (
        <span data-socpio="export-done" className={`text-[11px] ${sub}`}>
          {done}
        </span>
      )}
    </div>
  );
}
