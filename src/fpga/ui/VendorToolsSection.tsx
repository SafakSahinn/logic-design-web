// "Vendor tools" (Aşama 6k-5): the Vivado, Quartus and ISE installs the desktop app found, a check that starts
// one (it shows a broken install, such as ISE hanging at start-up, before a build does), and the "where is it"
// folder setting. A collapsible section at the bottom of the build panel, desktop only.
//
// The page never sends a path: "Choose folder" asks the main process to open its own folder dialog, and only a
// folder holding a known vendor program is stored (electron/main.cjs lds-tool:vendor-choose). "Forget folder"
// removes the stored folder of one kind; the installs found on their own stay.
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, FolderOpen, Loader2, Stethoscope, X } from 'lucide-react';
import { VENDOR_KINDS, checkVendorInstall, chooseVendorFolder, clearVendorFolder, vendorStatus, type VendorKind, type VendorStatus } from '../../tools';

export interface VendorToolsSectionProps {
  dark: boolean;
  /** A run is in progress: the buttons wait */
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The kinds the current board's flow uses: listed first and marked */
  relevant: readonly VendorKind[];
  /** Called with the new status after it was read or changed */
  onStatus: (status: VendorStatus | null) => void;
}

type Note = { kind: 'ok' | 'error' | 'info'; text: string };

/** Long tool output is cut for the one-line note (the full text is not needed there) */
const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

export function VendorToolsSection({ dark, disabled, open, onOpenChange, relevant, onStatus }: VendorToolsSectionProps) {
  const { t } = useTranslation('fpga');
  const [status, setStatus] = useState<VendorStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [checking, setChecking] = useState<VendorKind | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [notes, setNotes] = useState<Partial<Record<VendorKind, Note>>>({});
  const [topNote, setTopNote] = useState<Note | null>(null);

  const apply = useCallback(
    (s: VendorStatus | null) => {
      setStatus(s);
      setLoadFailed(!s);
      onStatus(s);
    },
    [onStatus],
  );
  const reload = useCallback(() => vendorStatus().then(apply, () => apply(null)), [apply]);
  useEffect(() => {
    let live = true;
    vendorStatus().then(
      (s) => live && apply(s),
      () => live && apply(null),
    );
    return () => {
      live = false;
    };
  }, [apply]);

  const kindName = (k: VendorKind) => t(`build.vendorTools.kind.${k}`);

  const check = async (kind: VendorKind) => {
    setChecking(kind);
    setNotes((n) => ({ ...n, [kind]: undefined }));
    try {
      const r = await checkVendorInstall(kind);
      let note: Note;
      if (r.ok) note = { kind: 'ok', text: t('build.vendorTools.checkOk', { line: clip(r.output ?? r.version ?? '') }) };
      else if (r.notInstalled) note = { kind: 'info', text: t('build.vendorTools.checkNotInstalled') };
      else if (r.stalled) note = { kind: 'error', text: t(kind === 'ise' ? 'build.vendorHint.iseStartupHang' : 'build.vendorHint.stalled') };
      else if (r.message) note = { kind: 'error', text: t('build.vendorTools.checkError', { message: clip(r.message) }) };
      else note = { kind: 'error', text: t('build.vendorTools.checkFailed', { code: r.exitCode ?? '?', output: clip(r.output ?? '') }) };
      setNotes((n) => ({ ...n, [kind]: note }));
    } catch (e) {
      setNotes((n) => ({ ...n, [kind]: { kind: 'error', text: t('build.vendorTools.checkError', { message: clip(e instanceof Error ? e.message : String(e)) }) } }));
    } finally {
      setChecking(null);
    }
  };

  const choose = async () => {
    setChoosing(true);
    setTopNote(null);
    try {
      const r = await chooseVendorFolder();
      if ('cancelled' in r) return;
      if ('notFound' in r) {
        setTopNote({ kind: 'error', text: t('build.vendorTools.chooseNotFound') });
        return;
      }
      setTopNote({ kind: 'ok', text: t('build.vendorTools.chosen', { tool: `${kindName(r.kind)}${r.version ? ` ${r.version}` : ''}`, exe: r.exe }) });
      setNotes((n) => ({ ...n, [r.kind]: undefined }));
      await reload();
    } catch (e) {
      setTopNote({ kind: 'error', text: t('build.vendorTools.checkError', { message: clip(e instanceof Error ? e.message : String(e)) }) });
    } finally {
      setChoosing(false);
    }
  };

  const clear = async (kind: VendorKind) => {
    setTopNote(null);
    if (await clearVendorFolder(kind).catch(() => false)) {
      setTopNote({ kind: 'info', text: t('build.vendorTools.cleared', { tool: kindName(kind) }) });
      setNotes((n) => ({ ...n, [kind]: undefined }));
    }
    await reload();
  };

  const c = dark
    ? { card: 'bg-slate-900 border-slate-700', sub: 'text-slate-400', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', mark: 'bg-indigo-900/60 text-indigo-200' }
    : { card: 'bg-white border-slate-200', sub: 'text-slate-500', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', mark: 'bg-indigo-50 text-indigo-700' };
  const btn = `px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${c.btn}`;
  const noteClass = (n: Note) => (n.kind === 'ok' ? 'text-emerald-600' : n.kind === 'error' ? 'text-rose-600' : c.sub);
  const kinds = [...relevant.filter((k) => VENDOR_KINDS.includes(k)), ...VENDOR_KINDS.filter((k) => !relevant.includes(k))];
  const busy = disabled || choosing || checking !== null;

  return (
    <section className={`rounded-xl border text-xs ${c.card}`} data-fpga-vendor-tools data-open={open ? 'true' : 'false'}>
      <button className="w-full px-3 py-2 flex items-center gap-1.5 font-bold cursor-pointer text-left" onClick={() => onOpenChange(!open)} aria-expanded={open} data-fpga-vendor-toggle>
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        {t('build.vendorTools.title')}
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-col gap-2">
          <div className="flex flex-wrap items-start gap-2">
            <p className={`text-[11px] flex-1 min-w-[16rem] ${c.sub}`}>{t('build.vendorTools.intro')}</p>
            <button className={btn} disabled={busy} onClick={() => void choose()} data-fpga-vendor-choose>
              {choosing ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />}
              {t('build.vendorTools.choose')}
            </button>
          </div>
          {topNote && (
            <p className={`text-[11px] font-semibold break-all ${noteClass(topNote)}`} data-fpga-vendor-note={topNote.kind}>
              {topNote.text}
            </p>
          )}
          {loadFailed && <p className="text-[11px] font-semibold text-rose-600">{t('build.vendorTools.loadFailed')}</p>}
          <ul className="flex flex-col gap-1.5">
            {kinds.map((kind) => {
              const installs = status?.[kind] ?? [];
              const chosen = installs.some((i) => i.source === 'settings');
              const note = notes[kind];
              return (
                <li key={kind} className="flex flex-col gap-0.5" data-fpga-vendor-kind={kind} data-found={installs.length > 0 ? 'true' : 'false'}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold px-1.5 py-0.5 rounded-md ${relevant.includes(kind) ? c.mark : ''}`}>{kindName(kind)}</span>
                    {installs.length === 0 && <span className={c.sub}>{t('build.vendorTools.notFound')}</span>}
                    <span className="ml-auto flex items-center gap-1.5">
                      <button className={btn} disabled={busy || installs.length === 0} onClick={() => void check(kind)} data-fpga-vendor-check={kind}>
                        {checking === kind ? <Loader2 className="w-3 h-3 animate-spin" /> : <Stethoscope className="w-3 h-3" />}
                        {checking === kind ? t('build.vendorTools.checking') : t('build.vendorTools.check')}
                      </button>
                      {chosen && (
                        <button className={btn} disabled={busy} onClick={() => void clear(kind)} data-fpga-vendor-clear={kind}>
                          <X className="w-3 h-3" />
                          {t('build.vendorTools.clear')}
                        </button>
                      )}
                    </span>
                  </div>
                  {installs.map((inst, i) => (
                    <div key={inst.exe} className={`pl-2 font-mono text-[10.5px] break-all ${i === 0 ? '' : c.sub}`} data-fpga-vendor-install={inst.source}>
                      {inst.version ?? '?'} · {t(`build.vendorTools.source.${inst.source}`)}
                      {i === 0 && installs.length > 1 ? ` · ${t('build.vendorTools.inUse')}` : ''} · {inst.exe}
                    </div>
                  ))}
                  {note && (
                    <p className={`pl-2 text-[11px] break-all whitespace-pre-wrap ${noteClass(note)}`} data-fpga-vendor-check-note={note.kind}>
                      {note.text}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
