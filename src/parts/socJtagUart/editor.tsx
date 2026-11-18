// The JTAG UART's "Terminal" attribute row and window. The window shows the characters the UART put on its TTY pins
// (also when no TTY part is wired to them) and queues what is typed into the read FIFO, as if a keyboard on the
// keyboard pins had sent it: the stand-in for the host side of evo's JTAG link. It reads the run-time object, which
// the simulation changes outside React, so it refreshes on a timer while open.
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Eraser, SquareTerminal, X } from 'lucide-react';
import type { CircuitComponentInstance } from '../../types/circuit';
import { keyToTelnetBytes, terminalScreen, textToTelnetBytes } from '../../utils/telnetNet';
import type { PartEditorProps } from '../registry';
import { jtagUartName } from './model';
import { jtagUartEntry, jtagUartObject, peekJtagUart, type JtagUartRuntime } from './runtime';
import { NS, t } from './text';

const REFRESH_MS = 100;

function colors(dark: boolean) {
  return dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', field: 'bg-slate-800 text-slate-200 border-slate-600 focus:border-blue-500', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', sub: 'text-slate-400', warn: 'text-amber-400' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-slate-50', field: 'bg-white text-slate-800 border-slate-300 focus:border-blue-500', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', sub: 'text-slate-500', warn: 'text-amber-700' };
}

/** The part's UART, made when the circuit has not been simulated yet (typing before the first run is kept) */
function uartOf(comp: CircuitComponentInstance): JtagUartRuntime {
  return peekJtagUart(comp.id) ?? jtagUartObject(jtagUartEntry(comp));
}

function TerminalDialog(props: { comp: CircuitComponentInstance; dark: boolean; onClose(): void }): ReactNode {
  const { comp, dark } = props;
  useTranslation(NS);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const [dropped, setDropped] = useState(0);
  const screenRef = useRef<HTMLPreElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const c = colors(dark);
  const uart = uartOf(comp);
  const cfg = uart.config;
  const fifos = uart.fifos();
  // rebuilt only when the log changed, not on every refresh tick (the log array is changed in place, so its
  // version is the dependency)
  const logVersion = uart.logVersion;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const text = useMemo(() => terminalScreen([...uart.sent()]).join('\n'), [uart, logVersion]);
  /** Whether the screen was scrolled to the bottom: only then does new output keep it there */
  const atBottom = useRef(true);

  useEffect(() => {
    const id = setInterval(tick, REFRESH_MS);
    inputRef.current?.focus();
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const el = screenRef.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [text]);

  const type = (bytes: number[]) => {
    let lost = 0;
    for (const b of bytes) if (!uart.receive(b)) lost++;
    if (lost) setDropped((n) => n + lost);
    tick();
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={t('terminal.title', { name: jtagUartName(comp) })} className={`rounded-2xl w-full max-w-2xl border shadow-2xl overflow-hidden flex flex-col text-xs ${c.panel}`}>
        <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${c.head}`}>
          <SquareTerminal size={16} className="text-blue-500 shrink-0" />
          <h2 className="font-semibold text-sm truncate flex-1">{t('terminal.title', { name: jtagUartName(comp) })}</h2>
          <button type="button" data-socjtag="clear" className={`p-1.5 rounded-lg border cursor-pointer ${c.btn}`} onClick={() => (uart.clearLog(), tick())} aria-label={t('terminal.clear')} title={t('terminal.clear')}>
            <Eraser size={16} />
          </button>
          <button type="button" data-socjtag="close" className={`p-1.5 rounded-lg border cursor-pointer ${c.btn}`} onClick={props.onClose} aria-label={t('terminal.close')} title={t('terminal.close')}>
            <X size={16} />
          </button>
        </div>
        <pre
          ref={screenRef}
          data-socjtag="screen"
          onClick={() => inputRef.current?.focus()}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
          }}
          className="m-0 h-72 overflow-y-auto px-3 py-2 font-mono text-[12px] leading-[1.35] whitespace-pre-wrap break-all bg-slate-950 text-emerald-300 select-text cursor-text"
          title={t('terminal.screenTitle')}
        >
          {text}
          <span className="inline-block w-[0.6em] bg-emerald-300/70 animate-pulse">&nbsp;</span>
        </pre>
        <div className="px-4 pt-2 pb-3 flex flex-col gap-1.5">
          <input
            ref={inputRef}
            data-socjtag="input"
            value=""
            onChange={() => {}}
            onKeyDown={(e) => {
              if (e.key === 'Escape') return;
              const bytes = keyToTelnetBytes(e);
              if (!bytes) return;
              e.preventDefault();
              e.stopPropagation();
              type(bytes);
            }}
            onPaste={(e) => {
              e.preventDefault();
              const bytes = textToTelnetBytes(e.clipboardData.getData('text'));
              if (bytes.length) type(bytes);
            }}
            placeholder={t('terminal.placeholder')}
            className={`w-full text-[11px] font-mono rounded-md px-2 py-1.5 border outline-none ${c.field}`}
            spellCheck={false}
            autoComplete="off"
          />
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] ${c.sub}`}>
            <span data-socjtag="read-fifo" title={t('terminal.readFifoTitle')}>
              {t('terminal.readFifo', { used: fifos.read.length, size: cfg.readFifoSize })}
            </span>
            <span data-socjtag="write-fifo" title={t('terminal.writeFifoTitle')}>
              {t('terminal.writeFifo', { used: fifos.write.length, size: cfg.writeFifoSize })}
            </span>
            {dropped > 0 && (
              <span data-socjtag="dropped" className={c.warn}>
                {t('terminal.dropped', { count: dropped })}
              </span>
            )}
          </div>
          <p className={`text-[11px] ${c.sub}`}>{t('terminal.hint')}</p>
        </div>
      </div>
    </div>
  );
}

export function SocJtagUartTerminalRow({ comp, dark }: PartEditorProps): ReactNode {
  const [open, setOpen] = useState(false);
  const btn = colors(dark).btn;
  return (
    <>
      <button type="button" data-socjtag="open" className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-xs cursor-pointer ${btn}`} onClick={() => setOpen(true)} title={t('attributes.terminal.title')}>
        <SquareTerminal size={14} />
        {t('terminal.open')}
      </button>
      {open && createPortal(<TerminalDialog comp={comp} dark={dark} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
