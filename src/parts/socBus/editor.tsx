// The SoC Bus's attribute row: "Transaction…" opens a dialog that sends one transaction over the bus by hand (evo's
// BusTransactionInsertionGui), so a memory can be tried without a processor; "Clear trace" empties the trace.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Send, Trash2, X } from 'lucide-react';
import { ATOMIC_TRANSACTION, READ_TRANSACTION, SocBusError, WORD_ACCESS, WRITE_TRANSACTION, type SocAccess } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { requestSimulation, type PartEditorProps } from '../registry';
import { peekSocBus, socManager } from '../shared/socRuntime';
import { busIdOf, busName } from './model';
import { NS, busErrorText, hex, t } from './text';
import { ACCESS_OPTIONS, digitsOf, parseHex, sendTransaction } from './transact';

/** Result of one transaction sent from the dialog */
interface Sent {
  n: number;
  address: number;
  access: SocAccess;
  type: number;
  writeData: number;
  readData: number;
  error: number;
  responder: string | null;
}

function TransactionDialog(props: { comp: CircuitComponentInstance; dark: boolean; onClose(): void }): ReactNode {
  const { comp, dark } = props;
  useTranslation(NS);
  const [address, setAddress] = useState('00000000');
  const [data, setData] = useState('00000000');
  const [access, setAccess] = useState<SocAccess>(WORD_ACCESS);
  const [read, setRead] = useState(true);
  const [write, setWrite] = useState(false);
  const [atomic, setAtomic] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const addressRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  useEffect(() => addressRef.current?.focus(), []);

  const bus = socManager.getBus(busIdOf(comp)) ?? peekSocBus(busIdOf(comp));
  const slaves = bus ? [...bus.getSlaves()] : [];

  const run = () => {
    const a = parseHex(address, 8);
    if (a === undefined) return setProblem(t('dialog.badAddress'));
    const d = write ? parseHex(data, digitsOf(access)) : 0;
    if (d === undefined) return setProblem(t('dialog.badData'));
    if (!read && !write) return setProblem(t('dialog.noType'));
    setProblem(null);
    const type = (read ? READ_TRANSACTION : 0) | (write ? WRITE_TRANSACTION : 0) | (atomic ? ATOMIC_TRANSACTION : 0);
    const tr = sendTransaction(comp, type, a, d, access, t('dialog.master'));
    counter.current++;
    setSent((old) => [{ n: counter.current, address: tr.address, access, type, writeData: tr.writeData, readData: tr.readData, error: tr.error, responder: tr.responder }, ...old].slice(0, 12));
    // the bus body shows the new trace row
    requestSimulation();
  };

  const c = dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', field: 'bg-slate-950 border-slate-600 text-slate-100', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', on: 'bg-blue-600 text-white border-blue-500', sub: 'text-slate-400', ok: 'text-emerald-400', err: 'text-red-400' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-slate-50', field: 'bg-white border-slate-300 text-slate-900', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', on: 'bg-blue-600 text-white border-blue-600', sub: 'text-slate-500', ok: 'text-emerald-700', err: 'text-red-600' };
  const toggle = (on: boolean) => `px-2 py-1 rounded-lg border text-xs font-semibold cursor-pointer ${on ? c.on : c.btn}`;
  const field = `w-full px-2 py-1 rounded-lg border font-mono text-xs outline-none focus:ring-2 focus:ring-blue-500/40 ${c.field}`;
  const label = `text-[11px] font-semibold ${c.sub}`;
  const title = t('dialog.title', { name: busName(comp) });

  const resultText = (s: Sent): string => {
    if (s.error !== SocBusError.none) return t('dialog.failed', { message: busErrorText(s.error) });
    if (s.type & READ_TRANSACTION) return t('dialog.okRead', { value: hex(s.readData, digitsOf(s.access)), name: s.responder ?? '' });
    return t('dialog.ok', { name: s.responder ?? '' });
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') props.onClose();
        else if (e.key === 'Enter') {
          e.preventDefault();
          run();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={title} className={`rounded-2xl w-full max-w-xl max-h-[85vh] border shadow-2xl overflow-hidden flex flex-col ${c.panel}`}>
        <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${c.head}`}>
          <h2 className="font-semibold text-sm truncate flex-1">{title}</h2>
          <button type="button" className={`p-1.5 rounded-lg border cursor-pointer ${c.btn}`} onClick={props.onClose} aria-label={t('dialog.close')} title={t('dialog.close')}>
            <X size={16} />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={label}>{t('dialog.address')}</span>
              <input ref={addressRef} data-soc="address" className={field} value={address} spellCheck={false} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={label}>{t('dialog.data')}</span>
              <input data-soc="data" className={`${field} disabled:opacity-40`} value={data} disabled={!write} spellCheck={false} onChange={(e) => setData(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-col gap-1">
            <span className={label}>{t('dialog.width')}</span>
            <div className="flex flex-wrap gap-1">
              {ACCESS_OPTIONS.map((o) => (
                <button key={o.key} type="button" data-soc={`width-${o.key}`} className={toggle(access === o.access)} onClick={() => setAccess(o.access)}>
                  {t(`dialog.widths.${o.key}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className={label}>{t('dialog.type')}</span>
            <div className="flex flex-wrap gap-1">
              <button type="button" data-soc="read" className={toggle(read)} onClick={() => setRead(!read)}>
                {t('dialog.read')}
              </button>
              <button type="button" data-soc="write" className={toggle(write)} onClick={() => setWrite(!write)}>
                {t('dialog.write')}
              </button>
              <button type="button" data-soc="atomic" className={toggle(atomic)} onClick={() => setAtomic(!atomic)} title={t('dialog.atomicTitle')}>
                {t('dialog.atomic')}
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" data-soc="run" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer bg-blue-600 hover:bg-blue-500 text-white" onClick={run} title={t('dialog.runTitle')}>
              <Send size={13} /> {t('dialog.run')}
            </button>
            {problem && <span className={`text-[11px] ${c.err}`}>{problem}</span>}
          </div>
          {sent.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className={label}>{t('dialog.history')}</span>
              <div data-soc="history" className="flex flex-col gap-0.5">
                {sent.map((s) => (
                  <div key={s.n} className="font-mono text-[11px] leading-4 flex gap-2">
                    <span className={c.sub}>
                      {s.type & READ_TRANSACTION ? 'R' : '-'}
                      {s.type & WRITE_TRANSACTION ? 'W' : '-'}
                      {s.type & ATOMIC_TRANSACTION ? 'A' : '-'} {hex(s.address)}
                      {s.type & WRITE_TRANSACTION ? ` ← ${hex(s.writeData, digitsOf(s.access))}` : ''}
                    </span>
                    <span className={s.error === SocBusError.none ? c.ok : c.err}>{resultText(s)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className={label}>{t('dialog.slaves')}</span>
            {slaves.length === 0 ? (
              <span className={`text-[11px] ${c.sub}`}>{t('dialog.noSlaves')}</span>
            ) : (
              slaves.map((s) => (
                <div key={s.key} className="font-mono text-[11px] leading-4 flex gap-2">
                  <span className="truncate">{s.name()}</span>
                  <span className={c.sub}>{t('dialog.range', { start: hex(s.startAddress()), end: hex(s.startAddress() + s.sizeInBytes() - 1) })}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SocBusEditorRow({ comp, dark }: PartEditorProps): ReactNode {
  useTranslation(NS);
  const [open, setOpen] = useState(false);
  const small = `inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
    dark ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
  }`;
  return (
    <div className="flex flex-wrap gap-1">
      <button type="button" data-soc="open" className={small} onClick={() => setOpen(true)} title={t('editor.openTitle')}>
        <Send size={10} /> {t('editor.open')}
      </button>
      <button
        type="button"
        className={small}
        onClick={() => {
          peekSocBus(busIdOf(comp))?.trace.clear();
          requestSimulation();
        }}
        title={t('editor.clearTitle')}
      >
        <Trash2 size={10} /> {t('editor.clear')}
      </button>
      {open && createPortal(<TransactionDialog comp={comp} dark={dark} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
