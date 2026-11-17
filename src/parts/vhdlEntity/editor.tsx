// The VHDL Entity's attribute row: "Edit…" (a large monospace editor with line numbers, file loading and the
// synthesis messages) and "Synthesize" (GHDL + Yosys through the ToolRunner, asynchronously).
//
// Results reach the part through PartEditorProps.apply as an EditorCommand, so a synthesis that finishes
// after the user moved on still lands on the newest state (and is dropped if the text changed meanwhile).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { FileUp, Play, Square, X } from 'lucide-react';
import { parseGenericSettings, synthesizeVhdl, type HdlDiagnostic } from '../../hdl';
import { ToolError, describeToolStatus, prepareTool, runTool, toolStatus, useToolDownloadConsent } from '../../tools';
import type { PartEditorProps } from '../registry';
import { currentKey, partState, preview, synthKey, type EditorCommand } from './model';
import { NS, errorText } from './text';
const LINE_HEIGHT = 18;

/** A message of the row; `key` is translated when shown, so it follows a language switch */
type Notice = { kind: 'ok' | 'info' | 'error'; key: string; params?: Record<string, unknown> };

const command = (cmd: EditorCommand): string => JSON.stringify(cmd);

/** Runs the synthesis of one text; one at a time per row */
function useSynthesis(dark: boolean) {
  const { confirmDownload, downloadDialog } = useToolDownloadConsent(dark);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const start = async (vhdl: string, generics: string, apply: (value: string) => void) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setBusy(true);
    setNotice(null);
    try {
      let settings;
      try {
        settings = parseGenericSettings(generics);
      } catch (e) {
        setNotice({ kind: 'error', key: 'editor.genericsInvalid', params: { message: e instanceof Error ? errorText(e) : String(e) } });
        return;
      }
      for (const tool of ['ghdl', 'yosys'] as const) {
        const status = await prepareTool(tool, confirmDownload);
        if (!status.available) {
          setNotice(status.reason === 'web-unsupported' ? { kind: 'info', key: 'editor.webNotice' } : { kind: 'error', key: 'editor.toolError', params: { message: describeToolStatus(status) } });
          return;
        }
      }
      const result = await synthesizeVhdl(runTool, vhdl, { generics: settings, signal: ac.signal });
      apply(command({ op: 'synth', key: synthKey(vhdl, generics), netlist: result.ok ? result.netlist : undefined, diagnostics: result.diagnostics }));
      if (result.ok) setNotice({ kind: 'ok', key: 'editor.done', params: { inputs: result.netlist.inputs.length, outputs: result.netlist.outputs.length } });
    } catch (e) {
      if (e instanceof ToolError && e.kind === 'cancelled') setNotice(null);
      else setNotice({ kind: 'error', key: 'editor.toolError', params: { message: e instanceof Error ? e.message : String(e) } });
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null;
        setBusy(false);
      }
    }
  };

  const cancel = () => abortRef.current?.abort();
  return { busy, notice, start, cancel, downloadDialog };
}

function noticeClass(kind: Notice['kind'], dark: boolean): string {
  if (kind === 'ok') return dark ? 'text-emerald-400' : 'text-emerald-700';
  if (kind === 'error') return dark ? 'text-red-400' : 'text-red-600';
  return dark ? 'text-amber-300' : 'text-amber-700';
}

function severityClass(d: HdlDiagnostic, dark: boolean): string {
  if (d.severity === 'error') return dark ? 'text-red-400' : 'text-red-600';
  if (d.severity === 'warning') return dark ? 'text-amber-300' : 'text-amber-700';
  return dark ? 'text-slate-400' : 'text-slate-500';
}

/** One message as "line:col  error  text" */
function DiagnosticLine({ d, dark, onGo }: { d: HdlDiagnostic; dark: boolean; onGo?: (line: number, column?: number) => void }) {
  const { t } = useTranslation(NS);
  const place = d.line !== undefined ? `${d.line}:${d.column ?? 1}` : d.source;
  const clickable = d.line !== undefined && onGo;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onGo(d.line!, d.column)}
      className={`w-full text-left font-mono text-[11px] leading-4 px-1 rounded ${clickable ? (dark ? 'hover:bg-slate-700 cursor-pointer' : 'hover:bg-slate-100 cursor-pointer') : 'cursor-default'}`}
    >
      <span className={dark ? 'text-slate-500' : 'text-slate-400'}>{place}</span> <span className={severityClass(d, dark)}>{t(`severity.${d.severity}`)}</span>{' '}
      <span className={dark ? 'text-slate-200' : 'text-slate-700'}>{d.message}</span>
    </button>
  );
}

interface DialogProps {
  initial: string;
  title: string;
  diagnostics: HdlDiagnostic[];
  diagnosticsCurrent: boolean;
  focusLine?: number;
  dark: boolean;
  busy: boolean;
  notice: Notice | null;
  onApply(text: string): void;
  onApplySynthesize(text: string): void;
  onCancelSynthesis(): void;
  onClose(): void;
}

function EditorDialog(props: DialogProps): ReactNode {
  const { initial, title, diagnostics, diagnosticsCurrent, focusLine, dark, busy, notice } = props;
  const { t } = useTranslation(NS);
  const [text, setText] = useState(initial);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [loadError, setLoadError] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = text !== initial;
  const lineCount = text.split('\n').length;
  const errorLines = useMemo(() => new Set(diagnostics.filter((d) => d.severity === 'error' && d.line !== undefined).map((d) => d.line!)), [diagnostics]);

  // the text the part holds changed (applied here, or a file loaded): start from it
  useEffect(() => setText(initial), [initial]);

  const goTo = (line: number, column = 1) => {
    const area = areaRef.current;
    if (!area) return;
    const lines = text.split('\n');
    const l = Math.min(Math.max(1, line), lines.length);
    let start = 0;
    for (let i = 0; i < l - 1; i++) start += lines[i].length + 1;
    area.focus();
    area.setSelectionRange(start + Math.min(column - 1, lines[l - 1].length), start + lines[l - 1].length);
    area.scrollTop = Math.max(0, (l - 1) * LINE_HEIGHT - area.clientHeight / 3);
    updateCursor();
  };

  useEffect(() => {
    if (focusLine !== undefined) goTo(focusLine);
    else areaRef.current?.focus();
    // only when the dialog opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateCursor = () => {
    const area = areaRef.current;
    if (!area) return;
    const before = area.value.slice(0, area.selectionStart);
    const line = before.split('\n').length;
    setCursor({ line, column: before.length - before.lastIndexOf('\n') });
  };

  const insert = (value: string) => {
    const area = areaRef.current;
    if (!area) return;
    const { selectionStart: a, selectionEnd: b } = area;
    const next = text.slice(0, a) + value + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      area.setSelectionRange(a + value.length, a + value.length);
      updateCursor();
    });
  };

  const c = dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', area: 'bg-slate-950 text-slate-100', gutter: 'bg-slate-900 text-slate-500 border-slate-700', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', sub: 'text-slate-400', box: 'border-slate-700 bg-slate-900' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-slate-50', area: 'bg-white text-slate-900', gutter: 'bg-slate-50 text-slate-400 border-slate-200', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', sub: 'text-slate-500', box: 'border-slate-200 bg-slate-50' };
  const btn = `inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${c.btn}`;
  const primary = 'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 disabled:cursor-default';

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
          <button type="button" className={btn} onClick={() => fileRef.current?.click()} title={t('editor.loadTitle')}>
            <FileUp size={14} /> {t('editor.load')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".vhd,.vhdl,.txt,text/plain"
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
              <div key={i} className={errorLines.has(i + 1) ? (dark ? 'text-red-400 font-bold' : 'text-red-600 font-bold') : undefined}>
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
              } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                props.onApply(text);
              } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (!busy) props.onApplySynthesize(text);
              } else if (e.key === 'Escape' && !dirty) {
                e.preventDefault();
                props.onClose();
              }
            }}
            className={`flex-1 min-w-0 resize-none outline-none font-mono text-[12px] p-2 whitespace-pre overflow-auto ${c.area}`}
            style={{ lineHeight: `${LINE_HEIGHT}px`, tabSize: 2 }}
          />
        </div>

        <div className={`border-t max-h-[30%] min-h-[4.5rem] overflow-y-auto px-3 py-2 ${c.box}`}>
          <div className={`text-[11px] font-semibold mb-1 ${c.sub}`}>{diagnosticsCurrent ? t('editor.messagesOf') : t('editor.messagesOld')}</div>
          {diagnostics.length === 0 ? (
            <div className={`text-[11px] ${c.sub}`}>{t('editor.noMessages')}</div>
          ) : (
            diagnostics.map((d, i) => <DiagnosticLine key={i} d={d} dark={dark} onGo={goTo} />)
          )}
        </div>

        <div className={`px-4 py-2.5 border-t flex items-center gap-2 ${c.head}`}>
          <span className={`text-[11px] font-mono ${c.sub}`}>{t('editor.lineCol', cursor)}</span>
          <span className={`text-[11px] flex-1 truncate ${loadError ? noticeClass('error', dark) : notice ? noticeClass(notice.kind, dark) : c.sub}`}>
            {loadError ? t('editor.loadFailed') : busy ? t('editor.synthesizing') : notice && t(notice.key, notice.params ?? {})}
          </span>
          <button type="button" className={btn} onClick={() => props.onApply(text)} disabled={!dirty} title={t('editor.applyTitle')}>
            {t('editor.apply')}
          </button>
          {busy ? (
            <button type="button" className={btn} onClick={props.onCancelSynthesis}>
              <Square size={12} /> {t('editor.cancel')}
            </button>
          ) : (
            <button type="button" className={primary} onClick={() => props.onApplySynthesize(text)} title={t('editor.synthesizeTitle')}>
              <Play size={12} /> {dirty ? t('editor.applySynthesize') : t('editor.synthesize')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function VhdlEditorRow({ comp, apply, dark }: PartEditorProps): ReactNode {
  const { t } = useTranslation(NS);
  const s = partState(comp);
  const synthesis = useSynthesis(dark);
  const [dialog, setDialog] = useState<{ focusLine?: number } | null>(null);
  const [webOnly, setWebOnly] = useState(false);

  useEffect(() => {
    let live = true;
    toolStatus('ghdl')
      .then((st) => live && setWebOnly(!st.available && st.reason === 'web-unsupported'))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const diagnostics = s.diagnostics ?? [];
  const diagnosticsCurrent = s.diagnosticsOf === currentKey(s);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  const p = preview(s);
  const title = t('editor.dialogTitle', { name: p.ok ? p.entity.name : s.netlist?.top ?? '—' });

  const applyText = (text: string) => apply(command({ op: 'text', text }));
  const synthesize = (text: string) => void synthesis.start(text.replace(/\r\n?/g, '\n'), s.generics, (v) => apply(v));

  const small = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default ${
    dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  }`;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="flex flex-wrap gap-1">
        <button type="button" className={small} onClick={() => setDialog({})} title={t('editor.editTitle')}>
          {t('editor.edit')}
        </button>
        {synthesis.busy ? (
          <button type="button" className={small} onClick={synthesis.cancel}>
            <Square size={10} /> {t('editor.cancel')}
          </button>
        ) : (
          <button type="button" className={small} onClick={() => synthesize(s.vhdl)} disabled={webOnly} title={webOnly ? t('editor.webNotice') : t('editor.synthesizeTitle')}>
            <Play size={10} /> {t('editor.synthesize')}
          </button>
        )}
      </div>
      {synthesis.busy && <span className={`text-[11px] ${noticeClass('info', dark)}`}>{t('editor.synthesizing')}</span>}
      {!synthesis.busy && (synthesis.notice || webOnly) && (
        <span className={`text-[11px] leading-4 ${noticeClass(synthesis.notice?.kind ?? 'info', dark)}`}>{synthesis.notice ? t(synthesis.notice.key, synthesis.notice.params ?? {}) : t('editor.webNotice')}</span>
      )}
      {!p.ok && <span className={`text-[11px] leading-4 ${noticeClass('info', dark)}`}>{t('editor.previewError', { message: errorText(p.error) })}</span>}
      {diagnosticsCurrent && errors.length > 0 && (
        <div className="flex flex-col">
          {errors.slice(0, 3).map((d, i) => (
            <DiagnosticLine key={i} d={d} dark={dark} onGo={(line) => setDialog({ focusLine: line })} />
          ))}
        </div>
      )}
      {dialog &&
        createPortal(
          <EditorDialog
            initial={s.vhdl}
            title={title}
            diagnostics={diagnostics}
            diagnosticsCurrent={diagnosticsCurrent}
            focusLine={dialog.focusLine}
            dark={dark}
            busy={synthesis.busy}
            notice={synthesis.notice}
            onApply={applyText}
            onApplySynthesize={(text) => {
              applyText(text);
              synthesize(text);
            }}
            onCancelSynthesis={synthesis.cancel}
            onClose={() => setDialog(null)}
          />,
          document.body,
        )}
      {synthesis.downloadDialog}
    </div>
  );
}
