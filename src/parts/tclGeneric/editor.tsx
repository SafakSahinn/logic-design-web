// The TCL Generic's attribute row: "Script…" and "Interface…" (a large monospace editor with line numbers and file
// loading), "Restart", and "Load Tcl" while the Tcl runtime is not loaded (it needs the download consent).
//
// Edits reach the part through PartEditorProps.apply as an EditorCommand (see model.ts).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Download, FileDown, FileUp, RotateCcw, X } from 'lucide-react';
import { describeToolStatus, prepareTool, useToolDownloadConsent } from '../../tools';
import { currentTclRuntime, loadTclRuntime, onTclRuntimeLoaded } from '../../tools/tcl';
import type { PartEditorProps } from '../registry';
import { partState, readInterface, scriptFileName, type EditorCommand, type TclPartState } from './model';
import { NS, interfaceErrorText, scriptErrorText } from './text';

const LINE_HEIGHT = 18;

/** A message of the row; `key` is translated when shown, so it follows a language switch */
type Notice = { kind: 'ok' | 'info' | 'error'; key: string; params?: Record<string, unknown> };

const command = (cmd: EditorCommand): string => JSON.stringify(cmd);

function noticeClass(kind: Notice['kind'], dark: boolean): string {
  if (kind === 'ok') return dark ? 'text-emerald-400' : 'text-emerald-700';
  if (kind === 'error') return dark ? 'text-red-400' : 'text-red-600';
  return dark ? 'text-amber-300' : 'text-amber-700';
}

/** The page's Tcl runtime: whether it is loaded, and loading it after the download consent */
function useTclRuntime(dark: boolean) {
  const { confirmDownload, downloadDialog } = useToolDownloadConsent(dark);
  const [ready, setReady] = useState(() => currentTclRuntime() !== null);
  const [progress, setProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => onTclRuntimeLoaded(() => setReady(true)), []);

  const load = async () => {
    setNotice(null);
    try {
      const status = await prepareTool('tcl', confirmDownload);
      if (!status.available) {
        setNotice(status.reason === 'download-required' ? { kind: 'info', key: 'runtime.declined' } : { kind: 'error', key: 'runtime.failed', params: { message: describeToolStatus(status) } });
        return;
      }
      setProgress(0);
      await loadTclRuntime({ onProgress: (loaded, total) => setProgress(total > 0 ? Math.round((100 * loaded) / total) : 0) });
      setReady(true);
    } catch (e) {
      setNotice({ kind: 'error', key: 'runtime.failed', params: { message: e instanceof Error ? e.message : String(e) } });
    } finally {
      setProgress(null);
    }
  };

  return { ready: ready && currentTclRuntime() !== null, progress, notice, load, downloadDialog };
}

type DialogMode = 'script' | 'vhdl';

/** Hands the text to the browser as a file download */
function saveText(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

interface DialogProps {
  mode: DialogMode;
  state: TclPartState;
  /** Name for "Save file" of the script (the file Logisim-evolution runs) */
  fileName: string;
  focusLine?: number;
  dark: boolean;
  onApply(mode: DialogMode, text: string): void;
  onClose(): void;
}

function EditorDialog(props: DialogProps): ReactNode {
  const { mode, state, focusLine, dark } = props;
  const { t } = useTranslation(NS);
  const initial = mode === 'script' ? state.script : state.vhdl;
  const [text, setText] = useState(initial);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [loadError, setLoadError] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const consoleRef = useRef<HTMLDivElement>(null);
  const dirty = text !== initial;
  const lineCount = text.split('\n').length;
  const iface = mode === 'vhdl' ? readInterface(text) : null;
  const errorLine = mode === 'script' ? state.error?.line : iface && !iface.ok ? iface.error.line : undefined;
  const log = useMemo(() => (mode === 'script' ? (state.log ?? []) : []), [mode, state.log]);

  // the text the part holds changed (applied here): start from it
  useEffect(() => setText(initial), [initial]);

  // keep the newest console line in view
  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [log]);

  const updateCursor = () => {
    const area = areaRef.current;
    if (!area) return;
    const before = area.value.slice(0, area.selectionStart);
    setCursor({ line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') });
  };

  const goTo = (line: number) => {
    const area = areaRef.current;
    if (!area) return;
    const lines = text.split('\n');
    const l = Math.min(Math.max(1, line), lines.length);
    let start = 0;
    for (let i = 0; i < l - 1; i++) start += lines[i].length + 1;
    area.focus();
    area.setSelectionRange(start, start + lines[l - 1].length);
    area.scrollTop = Math.max(0, (l - 1) * LINE_HEIGHT - area.clientHeight / 3);
    updateCursor();
  };

  useEffect(() => {
    if (focusLine !== undefined) goTo(focusLine);
    else areaRef.current?.focus();
    // only when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insert = (value: string) => {
    const area = areaRef.current;
    if (!area) return;
    const { selectionStart: a, selectionEnd: b } = area;
    setText(text.slice(0, a) + value + text.slice(b));
    requestAnimationFrame(() => {
      area.setSelectionRange(a + value.length, a + value.length);
      updateCursor();
    });
  };

  const c = dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', area: 'bg-slate-950 text-slate-100', gutter: 'bg-slate-900 text-slate-500 border-slate-700', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', sub: 'text-slate-400', box: 'border-slate-700 bg-slate-900', line: 'text-slate-200' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-slate-50', area: 'bg-white text-slate-900', gutter: 'bg-slate-50 text-slate-400 border-slate-200', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', sub: 'text-slate-500', box: 'border-slate-200 bg-slate-50', line: 'text-slate-700' };
  const btn = `inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${c.btn}`;
  const primary = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default';
  const title = mode === 'script' ? t('editor.scriptTitle') : t('editor.vhdlTitle', { name: iface?.ok ? iface.entity.name : '—' });
  const errorClass = dark ? 'text-red-400' : 'text-red-600';

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={`rounded-2xl w-full max-w-5xl h-[85vh] border shadow-2xl overflow-hidden flex flex-col ${c.panel}`}>
        <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${c.head}`}>
          <h2 className="font-semibold text-sm font-mono truncate flex-1">{title}</h2>
          {dirty && <span className={`text-[11px] ${dark ? 'text-amber-300' : 'text-amber-700'}`}>● {t('editor.unsaved')}</span>}
          <button type="button" className={btn} onClick={() => fileRef.current?.click()} title={mode === 'script' ? t('editor.loadScriptTitle') : t('editor.loadVhdlTitle')}>
            <FileUp size={14} /> {t('editor.load')}
          </button>
          <button type="button" className={btn} onClick={() => saveText(text, mode === 'script' ? props.fileName : `${iface?.ok ? iface.entity.name : 'interface'}.vhd`)} title={mode === 'script' ? t('editor.saveScriptTitle', { file: props.fileName }) : t('editor.saveVhdlTitle')}>
            <FileDown size={14} /> {t('editor.save')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={mode === 'script' ? '.tcl,.txt,text/plain' : '.vhd,.vhdl,.txt,text/plain'}
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                setText((await file.text()).replace(/\r\n?/g, '\n'));
                setLoadError(false);
              } catch {
                setLoadError(true);
              }
            }}
          />
          <button type="button" className={`p-1.5 rounded-lg border cursor-pointer ${c.btn}`} onClick={props.onClose} aria-label={t('editor.close')} title={dirty ? t('editor.discard') : t('editor.close')}>
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div ref={gutterRef} aria-hidden className={`select-none overflow-hidden border-r text-right font-mono text-[12px] px-2 pt-2 ${c.gutter}`} style={{ lineHeight: `${LINE_HEIGHT}px` }}>
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className={errorLine === i + 1 && !dirty ? `${errorClass} font-bold` : undefined}>
                {i + 1}
              </div>
            ))}
            <div style={{ height: 200 }} />
          </div>
          <textarea
            ref={areaRef}
            value={text}
            spellCheck={false}
            wrap="off"
            onChange={(e) => {
              setText(e.target.value);
              updateCursor();
            }}
            onSelect={updateCursor}
            onScroll={(e) => {
              if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                insert('  ');
              } else if ((e.key === 's' || e.key === 'Enter') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                props.onApply(mode, text);
              } else if (e.key === 'Escape' && !dirty) {
                e.preventDefault();
                props.onClose();
              }
            }}
            className={`flex-1 min-w-0 resize-none outline-none font-mono text-[12px] p-2 whitespace-pre overflow-auto ${c.area}`}
            style={{ lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
          />
        </div>

        <div ref={consoleRef} className={`border-t max-h-[30%] min-h-[4.5rem] overflow-y-auto px-3 py-2 ${c.box}`}>
          {mode === 'script' ? (
            <>
              <div className={`text-[11px] font-semibold mb-1 ${c.sub}`}>{t('editor.console')}</div>
              {state.error && (
                <button
                  type="button"
                  disabled={state.error.line === undefined}
                  onClick={() => state.error?.line !== undefined && goTo(state.error.line)}
                  className={`w-full text-left font-mono text-[11px] leading-4 px-1 rounded ${errorClass} ${state.error.line !== undefined ? (dark ? 'hover:bg-slate-700 cursor-pointer' : 'hover:bg-slate-100 cursor-pointer') : 'cursor-default'}`}
                >
                  {scriptErrorText(state.error)}
                </button>
              )}
              {log.length === 0 && !state.error ? (
                <div className={`text-[11px] ${c.sub}`}>{t('editor.noOutput')}</div>
              ) : (
                log.map((line, i) => (
                  <div key={i} className={`font-mono text-[11px] leading-4 px-1 whitespace-pre-wrap break-all ${c.line}`}>
                    {line}
                  </div>
                ))
              )}
            </>
          ) : iface && !iface.ok ? (
            <button type="button" onClick={() => iface.error.line !== undefined && goTo(iface.error.line)} className={`w-full text-left font-mono text-[11px] leading-4 px-1 ${errorClass}`}>
              {interfaceErrorText(iface.error)}
            </button>
          ) : (
            iface?.ok && (
              <div className={`font-mono text-[11px] leading-4 ${c.line}`}>
                {t('editor.ports', {
                  inputs: iface.inputs.map((p) => (p.width > 1 ? `${p.name}[${p.width}]` : p.name)).join(', ') || '—',
                  outputs: iface.outputs.map((p) => (p.width > 1 ? `${p.name}[${p.width}]` : p.name)).join(', ') || '—',
                })}
              </div>
            )
          )}
        </div>

        <div className={`px-4 py-2.5 border-t flex items-center gap-2 ${c.head}`}>
          <span className={`text-[11px] font-mono ${c.sub}`}>{t('editor.lineCol', cursor)}</span>
          <span className={`text-[11px] flex-1 truncate ${loadError ? noticeClass('error', dark) : c.sub}`}>
            {loadError ? t('editor.loadFailed') : mode === 'script' ? t('editor.scriptHint') : t('editor.vhdlHint')}
          </span>
          <button type="button" className={primary} onClick={() => props.onApply(mode, text)} disabled={!dirty} title={t('editor.applyTitle')}>
            {mode === 'script' ? t('editor.applyRestart') : t('editor.apply')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TclEditorRow({ comp, apply, dark }: PartEditorProps): ReactNode {
  const { t } = useTranslation(NS);
  const s = partState(comp);
  const runtime = useTclRuntime(dark);
  const [dialog, setDialog] = useState<{ mode: DialogMode; focusLine?: number } | null>(null);
  const iface = readInterface(s.vhdl);

  const small = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default ${
    dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  }`;
  const errorLink = `text-left text-[11px] leading-4 ${noticeClass('error', dark)}`;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex flex-wrap gap-1">
        <button type="button" className={small} onClick={() => setDialog({ mode: 'script' })} title={t('editor.scriptButtonTitle')}>
          {t('editor.scriptButton')}
        </button>
        <button type="button" className={small} onClick={() => setDialog({ mode: 'vhdl' })} title={t('editor.vhdlButtonTitle')}>
          {t('editor.vhdlButton')}
        </button>
        <button type="button" className={small} onClick={() => apply(command({ op: 'restart' }))} title={t('editor.restartTitle')}>
          <RotateCcw size={10} /> {t('editor.restart')}
        </button>
        {!runtime.ready && (
          <button type="button" className={small} onClick={() => void runtime.load()} disabled={runtime.progress !== null} title={t('runtime.loadTitle')}>
            <Download size={10} /> {t('runtime.load')}
          </button>
        )}
      </div>
      {runtime.progress !== null && <span className={`text-[11px] ${noticeClass('info', dark)}`}>{t('runtime.loading', { percent: runtime.progress })}</span>}
      {runtime.progress === null && runtime.notice && <span className={`text-[11px] leading-4 ${noticeClass(runtime.notice.kind, dark)}`}>{t(runtime.notice.key, runtime.notice.params ?? {})}</span>}
      {runtime.progress === null && !runtime.notice && !runtime.ready && <span className={`text-[11px] leading-4 ${noticeClass('info', dark)}`}>{t('runtime.needed')}</span>}
      {!iface.ok && (
        <button type="button" className={errorLink} onClick={() => setDialog({ mode: 'vhdl', focusLine: iface.error.line })}>
          {t('editor.interfaceError', { message: interfaceErrorText(iface.error) })}
        </button>
      )}
      {s.error && (
        <button type="button" className={errorLink} onClick={() => setDialog({ mode: 'script', focusLine: s.error?.line })}>
          {scriptErrorText(s.error)}
        </button>
      )}
      {dialog &&
        createPortal(
          <EditorDialog
            mode={dialog.mode}
            state={s}
            fileName={scriptFileName(comp)}
            focusLine={dialog.focusLine}
            dark={dark}
            onApply={(mode, text) => apply(command({ op: mode, text }))}
            onClose={() => setDialog(null)}
          />,
          document.body,
        )}
      {runtime.downloadDialog}
    </div>
  );
}
