// A processor's attribute row, shared by the processor parts: the run controls (evo's start / pause button, plus step
// and reset), "Load ELF…" (evo's Read ELF file), "Assembler…" (evo's assembler window: write, assemble and load a
// program) and "Program…" (the loaded program as a listing with the current pc and breakpoints, evo's breakpoint
// panel). The part describes itself with a CpuPartUi; its texts come from the part's own namespace.
//
// The core lives outside the circuit; after acting on it the row asks the canvas to simulate again, which redraws the
// body. The assembler source is kept with the part through PartEditorProps.apply.
import { useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Bug, Code2, FileUp, ListOrdered, Pause, Play, RotateCcw, StepForward, X } from 'lucide-react';
import { MAX_ELF_FILE_BYTES, buildListing, type AsmDiagnostic } from '../../../soc';
import type { CircuitComponentInstance } from '../../../types/circuit';
import { requestSimulation, type PartEditorProps } from '../../registry';
import { socHex as hex } from '../socRuntime';
import { assembleAndLoad, diagnosticText, elfTooLarge, loadElf, peekBusByte, type LoadOutcome } from './program';
import { MAX_ASM_SOURCE, type CpuEditorCommand, type CpuPartUi, type CpuRuntimeLike } from './types';

const LINE_HEIGHT = 18;
const REFRESH_MS = 250;

function colors(dark: boolean) {
  return dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', field: 'bg-slate-950 border-slate-600 text-slate-100', gutter: 'bg-slate-900 text-slate-500 border-slate-700', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', sub: 'text-slate-400', ok: 'text-emerald-400', err: 'text-red-400', pcRow: 'bg-blue-900/60', bp: 'text-red-400', hover: 'hover:bg-slate-800' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-slate-50', field: 'bg-white border-slate-300 text-slate-900', gutter: 'bg-slate-50 text-slate-400 border-slate-200', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', sub: 'text-slate-500', ok: 'text-emerald-700', err: 'text-red-600', pcRow: 'bg-blue-100', bp: 'text-red-600', hover: 'hover:bg-slate-100' };
}

/** The data-* test hook of a control */
const hook = (ui: CpuPartUi, name: string) => ({ [`data-${ui.tag}`]: name });

/** Re-renders every REFRESH_MS while mounted (the core runs outside React) */
function useTicker(): void {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, []);
}

function Dialog(props: { ui: CpuPartUi; title: string; dark: boolean; wide?: boolean; onClose(): void; children: ReactNode; footer?: ReactNode }): ReactNode {
  const c = colors(props.dark);
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={props.title} className={`rounded-2xl w-full ${props.wide ? 'max-w-4xl' : 'max-w-2xl'} h-[85vh] border shadow-2xl overflow-hidden flex flex-col ${c.panel}`}>
        <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${c.head}`}>
          <h2 className="font-semibold text-sm truncate flex-1">{props.title}</h2>
          <button type="button" className={`p-1.5 rounded-lg border cursor-pointer ${c.btn}`} onClick={props.onClose} aria-label={props.ui.t('dialog.close')} title={props.ui.t('dialog.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{props.children}</div>
        {props.footer && <div className={`px-4 py-2 border-t flex flex-wrap items-center gap-2 ${c.head}`}>{props.footer}</div>}
      </div>
    </div>
  );
}

function RunControls(props: { ui: CpuPartUi; rt: CpuRuntimeLike; dark: boolean; small?: boolean }): ReactNode {
  const { ui, rt } = props;
  const { t } = ui;
  const core = rt.core;
  const c = colors(props.dark);
  const cls = props.small
    ? `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${props.dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`
    : `inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${c.btn}`;
  const size = props.small ? 10 : 13;
  const act = (f: () => void) => () => {
    f();
    requestSimulation();
  };
  const running = core.runState === 'running';
  return (
    <>
      <button type="button" {...hook(ui, 'toggle')} className={cls} onClick={act(() => core.toggleRun())} title={t(running ? 'editor.pauseTitle' : 'editor.startTitle')}>
        {running ? <Pause size={size} /> : <Play size={size} />} {t(running ? 'editor.pause' : 'editor.start')}
      </button>
      <button type="button" {...hook(ui, 'step')} className={`${cls} disabled:opacity-40 disabled:cursor-default`} disabled={running} onClick={act(() => core.step())} title={t('editor.stepTitle')}>
        <StepForward size={size} /> {t('editor.step')}
      </button>
      <button type="button" {...hook(ui, 'reset')} className={cls} onClick={act(() => core.reset())} title={t('editor.resetTitle')}>
        <RotateCcw size={size} /> {t('editor.reset')}
      </button>
    </>
  );
}

function Notice(props: { ui: CpuPartUi; outcome: LoadOutcome | null; dark: boolean }): ReactNode {
  if (!props.outcome) return null;
  const c = colors(props.dark);
  return (
    <span {...hook(props.ui, 'notice')} className={`text-[11px] ${props.outcome.ok ? c.ok : c.err}`}>
      {props.outcome.message}
    </span>
  );
}

function AssemblerDialog(props: { ui: CpuPartUi; comp: CircuitComponentInstance; rt: CpuRuntimeLike; dark: boolean; onSave(text: string): void; onClose(): void }): ReactNode {
  const { ui, comp, rt, dark } = props;
  const { t } = ui;
  useTranslation(ui.ns);
  const c = colors(dark);
  const [text, setText] = useState(() => ui.asmSource(comp) ?? t('asm.template'));
  const [diags, setDiags] = useState<AsmDiagnostic[]>([]);
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null);
  const [loadError, setLoadError] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const lines = useMemo(() => text.split('\n').length, [text]);
  const errorLines = useMemo(() => new Set(diags.map((d) => d.line)), [diags]);

  useEffect(() => area.current?.focus(), []);

  const run = () => {
    const src = text.slice(0, MAX_ASM_SOURCE);
    props.onSave(src);
    const r = assembleAndLoad(ui, rt, src);
    setDiags(r.diagnostics);
    setOutcome(r.outcome);
    requestSimulation();
  };

  const goTo = (d: AsmDiagnostic) => {
    const el = area.current;
    if (!el) return;
    const starts = text.split('\n');
    let pos = 0;
    for (let i = 0; i < d.line && i < starts.length; i++) pos += starts[i].length + 1;
    el.focus();
    el.setSelectionRange(pos + d.col, pos + d.col + Math.max(1, d.length));
    el.scrollTop = Math.max(0, d.line * LINE_HEIGHT - el.clientHeight / 2);
  };

  const footer = (
    <>
      <button type="button" {...hook(ui, 'assemble')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer bg-blue-600 hover:bg-blue-500 text-white" onClick={run} title={t('asm.runTitle')}>
        <Code2 size={13} /> {t('asm.run')}
      </button>
      <button type="button" className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${c.btn}`} onClick={() => fileRef.current?.click()}>
        <FileUp size={13} /> {t('asm.openFile')}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".s,.S,.asm,.txt,text/plain"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > MAX_ASM_SOURCE) return setLoadError(true);
          try {
            setText((await file.text()).replace(/\r\n?/g, '\n'));
            setLoadError(false);
          } catch {
            setLoadError(true);
          }
        }}
      />
      {loadError && <span className={`text-[11px] ${c.err}`}>{t('asm.fileError', { max: MAX_ASM_SOURCE })}</span>}
      <Notice ui={ui} outcome={outcome} dark={dark} />
    </>
  );

  return (
    <Dialog ui={ui} title={t('asm.title', { name: ui.name(comp) })} dark={dark} onClose={props.onClose} footer={footer}>
      <div className="flex-1 min-h-0 flex font-mono text-xs">
        <div ref={gutter} className={`overflow-hidden select-none text-right border-r py-2 ${c.gutter}`} style={{ lineHeight: `${LINE_HEIGHT}px`, minWidth: '3.5em' }}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={`px-2 ${errorLines.has(i) ? c.err + ' font-bold' : ''}`}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={area}
          {...hook(ui, 'source')}
          className={`flex-1 resize-none outline-none p-2 whitespace-pre ${c.field}`}
          style={{ lineHeight: `${LINE_HEIGHT}px` }}
          spellCheck={false}
          value={text}
          maxLength={MAX_ASM_SOURCE}
          onChange={(e) => setText(e.target.value)}
          onScroll={(e) => {
            if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop;
          }}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.currentTarget;
              const { selectionStart: a, selectionEnd: b } = el;
              setText(text.slice(0, a) + '    ' + text.slice(b));
              requestAnimationFrame(() => el.setSelectionRange(a + 4, a + 4));
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              run();
            }
          }}
        />
      </div>
      {diags.length > 0 && (
        <div {...hook(ui, 'diagnostics')} className={`max-h-32 overflow-y-auto border-t px-3 py-1.5 flex flex-col gap-0.5 ${c.head}`}>
          {diags.map((d, i) => (
            <button key={i} type="button" className={`text-left font-mono text-[11px] cursor-pointer ${c.err} ${c.hover}`} onClick={() => goTo(d)}>
              {t('asm.diagnostic', { line: d.line + 1, message: diagnosticText(d) })}
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

function ProgramDialog(props: { ui: CpuPartUi; comp: CircuitComponentInstance; rt: CpuRuntimeLike; dark: boolean; onClose(): void }): ReactNode {
  const { ui, comp, rt, dark } = props;
  const { t } = ui;
  useTranslation(ui.ns);
  useTicker();
  const c = colors(dark);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const core = rt.core;
  const pcRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const { program, version, busId } = rt;
  const isa = ui.assembler;
  const listing = useMemo(() => {
    // re-read when another program is loaded (version) into the same image object
    void version;
    return program ? buildListing(program, (a) => peekBusByte(busId, a), isa) : [];
  }, [program, version, busId, isa]);
  const pc = core.pc;

  useEffect(() => {
    if (follow) pcRef.current?.scrollIntoView({ block: 'nearest' });
  }, [pc, follow]);

  const toggle = (address: number) => {
    if (core.breakpoints.has(address)) core.breakpoints.delete(address);
    else core.breakpoints.add(address);
    bump();
  };

  const footer = (
    <>
      <RunControls ui={ui} rt={rt} dark={dark} />
      <label className={`inline-flex items-center gap-1 text-[11px] ${c.sub}`}>
        <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {t('listing.follow')}
      </label>
      <span className={`text-[11px] font-mono ${c.sub}`}>
        {t('listing.state', { pc: hex(pc), state: t(`run.${core.runState}`) })}
      </span>
      {core.halt && <span className={`text-[11px] ${core.runState === 'error' ? c.err : c.sub}`}>{ui.haltText(core.halt)}</span>}
    </>
  );

  return (
    <Dialog ui={ui} title={t('listing.title', { name: ui.name(comp) })} dark={dark} wide onClose={props.onClose} footer={footer}>
      {listing.length === 0 ? (
        <div className={`p-4 text-xs ${c.sub}`}>{t('listing.empty')}</div>
      ) : (
        <div {...hook(ui, 'listing')} className="flex-1 min-h-0 overflow-y-auto font-mono text-xs py-1">
          <div className={`px-3 pb-1 text-[11px] ${c.sub}`}>{t('listing.hint')}</div>
          {listing.map((l, i) => {
            const at = l.address;
            const isPc = at !== null && at === pc;
            const bp = at !== null && core.breakpoints.has(at);
            return (
              <div
                key={i}
                ref={isPc ? pcRef : undefined}
                data-address={at ?? undefined}
                className={`flex gap-2 px-2 whitespace-pre ${isPc ? c.pcRow : ''} ${at !== null ? `cursor-pointer ${c.hover}` : ''}`}
                style={{ lineHeight: `${LINE_HEIGHT}px` }}
                onClick={at !== null ? () => toggle(at) : undefined}
                title={at !== null ? t('listing.toggleTitle') : undefined}
              >
                <span className={`w-3 text-center ${c.bp}`}>{bp ? '●' : ''}</span>
                <span className={`w-24 ${c.sub}`}>{at !== null ? hex(at) : ''}</span>
                <span>{l.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </Dialog>
  );
}

export function CpuEditorRow({ comp, apply, dark, ui }: PartEditorProps & { ui: CpuPartUi }): ReactNode {
  useTranslation(ui.ns);
  useTicker();
  const { t } = ui;
  const [open, setOpen] = useState<'asm' | 'listing' | null>(null);
  const [outcome, setOutcome] = useState<LoadOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const rt = ui.runtimeOf(comp);
  const small = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
    dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  }`;
  const command = (cmd: CpuEditorCommand) => apply(JSON.stringify(cmd));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <RunControls ui={ui} rt={rt} dark={dark} small />
      </div>
      <div className="flex flex-wrap gap-1">
        <button type="button" {...hook(ui, 'elf')} className={small} onClick={() => fileRef.current?.click()} title={t('editor.elfTitle')}>
          <FileUp size={10} /> {t('editor.elf')}
        </button>
        <button type="button" {...hook(ui, 'asm')} className={small} onClick={() => setOpen('asm')} title={t('editor.asmTitle')}>
          <Bug size={10} /> {t('editor.asm')}
        </button>
        <button type="button" {...hook(ui, 'listing')} className={small} onClick={() => setOpen('listing')} title={t('editor.listingTitle')}>
          <ListOrdered size={10} /> {t('editor.listing')}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        {...hook(ui, 'elf-input')}
        accept=".elf,.out,application/x-elf,application/octet-stream"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          if (file.size > MAX_ELF_FILE_BYTES) {
            setOutcome(elfTooLarge());
            return;
          }
          try {
            setOutcome(loadElf(ui, rt, new Uint8Array(await file.arrayBuffer())));
          } catch (err) {
            setOutcome({ ok: false, message: err instanceof Error ? err.message : String(err) });
          }
          requestSimulation();
        }}
      />
      <Notice ui={ui} outcome={outcome} dark={dark} />
      {open === 'asm' && createPortal(<AssemblerDialog ui={ui} comp={comp} rt={rt} dark={dark} onSave={(text) => command({ op: 'asm', text })} onClose={() => setOpen(null)} />, document.body)}
      {open === 'listing' && createPortal(<ProgramDialog ui={ui} comp={comp} rt={rt} dark={dark} onClose={() => setOpen(null)} />, document.body)}
    </div>
  );
}
