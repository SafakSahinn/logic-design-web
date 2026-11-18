// The "C header" attribute row of the SoC peripherals (PIO, VGA): evo's "Export C" menu item. It writes <NAME>.h and
// <NAME>.c as two file downloads (the desktop app asks where to save each).
import { useState, type ReactNode } from 'react';
import { FileCode2 } from 'lucide-react';
import type { PartEditorProps } from '../registry';
import { saveCExport, type CExport } from './cExport';

export interface CExportRowProps extends PartEditorProps {
  /** The two files of this part */
  makeFiles: (comp: PartEditorProps['comp']) => CExport;
  /** The part's text lookup: needs cExport.button, cExport.done ({{header}}, {{source}}), attributes.cExport.title */
  t: (key: string, params?: Record<string, unknown>) => string;
  /** Name of the data-* test hook ("socpio" -> data-socpio="export-c" / "export-done") */
  hook: string;
}

export function CExportRow({ comp, dark, makeFiles, t, hook }: CExportRowProps): ReactNode {
  const [done, setDone] = useState<string | null>(null);
  const btn = dark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300';
  const sub = dark ? 'text-slate-400' : 'text-slate-500';
  const exportC = () => {
    const files = makeFiles(comp);
    saveCExport(files);
    setDone(t('cExport.done', { header: files.headerName, source: files.sourceName }));
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" {...{ [`data-${hook}`]: 'export-c' }} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer ${btn}`} onClick={exportC} title={t('attributes.cExport.title')}>
        <FileCode2 size={14} />
        {t('cExport.button')}
      </button>
      {done && (
        <span {...{ [`data-${hook}`]: 'export-done' }} className={`text-[11px] ${sub}`}>
          {done}
        </span>
      )}
    </div>
  );
}
