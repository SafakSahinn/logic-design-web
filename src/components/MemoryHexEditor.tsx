/**
 * Hex editor of a parametric RAM / ROM (Logisim's memory editor): every word of a memory up to 2^24 words in hex,
 * a few words per row, scrolled virtually (only the rows in view are drawn). Typing hex digits shifts them into the
 * selected word like Logisim; arrows, Page Up / Down, Home / End move. Contents can be read from and written to
 * Logisim's "v2.0 raw" image files. Edits are kept in a draft until saved.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Binary, Download, Eraser, FolderOpen, X } from 'lucide-react';
import type { CircuitComponentInstance } from '../types/circuit';
import { MEM_PAGE_SIZE, getRamConfig } from '../utils/circuitEngine';
import { memToRawText, rawTextToMem } from '../utils/memImage';

export interface MemoryHexEditorProps {
  comp: CircuitComponentInstance;
  dark: boolean;
  onSave: (pages: Record<string, number[]>) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}

const ROW_H = 22;
const VIEW_ROWS = 16;
/** Tallest scroll area used; bigger memories map the scroll bar onto their rows */
const MAX_SCROLL_PX = 1_000_000;

export default function MemoryHexEditor({ comp, dark, onSave, onClose, onToast }: MemoryHexEditorProps) {
  const cfg = getRamConfig(comp);
  const words = 2 ** cfg.addrWidth;
  const w = cfg.dataWidth;
  const mask = w >= 32 ? 0xffffffff : 2 ** w - 1;
  const digits = Math.ceil(w / 4);
  const addrDigits = Math.ceil(cfg.addrWidth / 4);
  const cols = digits <= 2 ? 16 : digits <= 4 ? 8 : 4;
  const rows = Math.ceil(words / cols);
  const viewRows = Math.min(VIEW_ROWS, rows);
  const viewH = viewRows * ROW_H;
  const maxTop = rows - viewRows;
  const spacerH = Math.min(rows * ROW_H, MAX_SCROLL_PX);
  const scaled = rows * ROW_H > MAX_SCROLL_PX;

  const [pages, setPages] = useState<Record<string, number[]>>(() => ({ ...(comp.state.memPages ?? {}) }));
  const [cursor, setCursor] = useState(() => Math.max(0, Math.min(words - 1, comp.state.memCurrent ?? 0)));
  const [typed, setTyped] = useState(0);
  const [top, setTop] = useState(() => Math.max(0, Math.min(maxTop, Math.floor(Math.max(0, comp.state.memCurrent ?? 0) / cols) - 2)));
  const [dirty, setDirty] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const expectedScroll = useRef(0);
  const running = comp.state.memCurrent ?? -1;

  const read = (a: number) => ((pages[Math.floor(a / MEM_PAGE_SIZE)]?.[a % MEM_PAGE_SIZE] ?? 0) & mask) >>> 0;
  const write = (a: number, v: number) => {
    setPages((prev) => {
      const k = String(Math.floor(a / MEM_PAGE_SIZE));
      const page = prev[k] ? [...prev[k]] : new Array<number>(MEM_PAGE_SIZE).fill(0);
      page[a % MEM_PAGE_SIZE] = (v & mask) >>> 0;
      return { ...prev, [k]: page };
    });
    setDirty(true);
  };

  // Scroll bar position of a top row (scaled memories map rows onto MAX_SCROLL_PX)
  const scrollOf = (t: number) => (scaled ? (maxTop ? (t / maxTop) * (spacerH - viewH) : 0) : t * ROW_H);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const s = scrollOf(top);
    if (Math.abs(el.scrollTop - s) > 1) {
      expectedScroll.current = s;
      el.scrollTop = s;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  // Wheel moves three rows at a time (a scaled scroll bar would skip thousands)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !scaled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setTop((t) => Math.max(0, Math.min(maxTop, t + Math.sign(e.deltaY) * 3)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scaled, maxTop]);

  useEffect(() => {
    gridRef.current?.focus();
  }, []);

  const moveTo = (a: number) => {
    const next = Math.max(0, Math.min(words - 1, a));
    setCursor(next);
    setTyped(0);
    const r = Math.floor(next / cols);
    setTop((t) => (r < t ? r : r >= t + viewRows ? r - viewRows + 1 : t));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const k = e.key;
    if (/^[0-9a-f]$/i.test(k) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      const d = parseInt(k, 16);
      // Logisim: a typed digit shifts in from the right; a full word moves on to the next one
      const base = typed === 0 ? 0 : read(cursor);
      write(cursor, base * 16 + d);
      if (typed + 1 >= digits) moveTo(cursor + 1);
      else setTyped(typed + 1);
      return;
    }
    const step: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -cols,
      ArrowDown: cols,
      PageUp: -cols * viewRows,
      PageDown: cols * viewRows,
    };
    if (k in step) {
      e.preventDefault();
      moveTo(cursor + step[k]);
    } else if (k === 'Home') {
      e.preventDefault();
      moveTo(e.ctrlKey ? 0 : cursor - (cursor % cols));
    } else if (k === 'End') {
      e.preventDefault();
      moveTo(e.ctrlKey ? words - 1 : cursor - (cursor % cols) + cols - 1);
    } else if (k === 'Backspace' || k === 'Delete') {
      e.preventDefault();
      write(cursor, 0);
      setTyped(0);
    } else if (k === 'Enter' || k === ' ' || k === 'Tab') {
      e.preventDefault();
      moveTo(cursor + (e.shiftKey ? -1 : 1));
    } else if (k === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const hex = (n: number, len: number) => (n >>> 0).toString(16).toUpperCase().padStart(len, '0');
  const sizeText = useMemo(() => {
    const b = cfg.addrWidth;
    return b >= 20 ? `${2 ** (b - 20)}M` : b >= 10 ? `${2 ** (b - 10)}K` : String(2 ** b);
  }, [cfg.addrWidth]);

  const exportRaw = () => {
    const blob = new Blob([memToRawText(pages, words)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(comp.label || comp.type).replace(/[^a-z0-9_-]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importRaw = (file: File) => {
    file.text().then((text) => {
      const res = rawTextToMem(text, words, mask);
      if (typeof res === 'string') {
        onToast(res);
        return;
      }
      setPages(res.pages);
      setDirty(true);
      onToast(res.count > words ? `${words} kelime okundu; fazlası belleğe sığmadı.` : `${res.count} kelime okundu.`);
    });
  };

  const c = dark
    ? {
        panel: 'bg-slate-900 border-slate-700 text-slate-100',
        head: 'border-slate-700 bg-slate-800/60',
        sub: 'text-slate-400',
        btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600',
        addr: 'text-slate-500',
        cell: 'text-slate-200 hover:bg-slate-800',
        sel: 'bg-sky-500 text-white',
        run: 'ring-1 ring-amber-400',
        input: 'bg-slate-800 border-slate-600 text-slate-100',
      }
    : {
        panel: 'bg-white border-slate-200 text-slate-900',
        head: 'border-slate-200 bg-gradient-to-r from-cyan-50 to-sky-50',
        sub: 'text-slate-600',
        btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300',
        addr: 'text-slate-400',
        cell: 'text-slate-800 hover:bg-sky-50',
        sel: 'bg-sky-600 text-white',
        run: 'ring-1 ring-amber-500',
        input: 'bg-white border-slate-300 text-slate-900',
      };

  const visible: React.ReactNode[] = [];
  for (let r = top; r < top + viewRows && r < rows; r++) {
    const rowAddr = r * cols;
    visible.push(
      <div key={r} className="flex items-center" style={{ height: ROW_H }}>
        <span className={`w-20 shrink-0 pr-3 text-right ${c.addr}`}>{hex(rowAddr, addrDigits)}</span>
        {Array.from({ length: cols }, (_, i) => {
          const a = rowAddr + i;
          if (a >= words) return null;
          const isSel = a === cursor;
          return (
            <span
              key={i}
              onMouseDown={(e) => {
                e.preventDefault();
                gridRef.current?.focus();
                setCursor(a);
                setTyped(0);
              }}
              className={`text-center rounded cursor-pointer select-none ${isSel ? c.sel : c.cell} ${a === running && !isSel ? c.run : ''}`}
              style={{ width: `${digits + 1.5}ch`, marginRight: (i + 1) % 4 === 0 ? '0.75ch' : '0.25ch' }}
              title={`Adres ${hex(a, addrDigits)}`}
            >
              {hex(read(a), digits)}
            </span>
          );
        })}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => e.stopPropagation()}>
      <div className={`rounded-3xl max-w-3xl w-full border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150 ${c.panel}`}>
        <div className={`p-4 border-b flex items-center justify-between ${c.head}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500 text-white rounded-2xl shadow-xs">
              <Binary className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <span>{comp.label || (comp.type === 'rom' ? 'ROM' : 'RAM')} içeriği</span>
                <span className="px-2 py-0.5 bg-sky-100 text-sky-800 text-[10px] font-mono font-bold rounded-full">
                  {sizeText} × {w} bit
                </span>
              </h3>
              <p className={`text-xs mt-0.5 ${c.sub}`}>
                Bir kelimeye tıklayıp onaltılı haneleri yazın; haneler sağdan kayarak girer. Oklar, Page Up / Down ve Home / End ile gezinin.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 opacity-60 hover:opacity-100 rounded-xl cursor-pointer" title="Kapat (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`px-4 py-2.5 border-b flex flex-wrap items-center gap-2 text-xs ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <label className="flex items-center gap-1.5">
            <span className={c.sub}>Adrese git</span>
            <input
              className={`w-24 px-2 py-1 rounded-lg border font-mono outline-none focus:border-sky-500 ${c.input}`}
              placeholder={hex(0, addrDigits)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                const t = (e.target as HTMLInputElement).value.trim().replace(/^0x/i, '');
                if (!/^[0-9a-f]+$/i.test(t) || parseInt(t, 16) >= words) {
                  onToast(`Adres 0 ile ${hex(words - 1, addrDigits)} arasında olmalı.`);
                  return;
                }
                moveTo(parseInt(t, 16));
                gridRef.current?.focus();
              }}
            />
          </label>
          <div className="flex-1" />
          <button onClick={() => fileRef.current?.click()} className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${c.btn}`} title='Logisim "v2.0 raw" bellek dosyası aç'>
            <FolderOpen className="w-3.5 h-3.5" /> Dosyadan aç
          </button>
          <button onClick={exportRaw} className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${c.btn}`} title='İçeriği Logisim "v2.0 raw" dosyası olarak indir'>
            <Download className="w-3.5 h-3.5" /> Dosyaya kaydet
          </button>
          <button
            onClick={() => {
              setPages({});
              setDirty(true);
            }}
            className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${c.btn}`}
            title="Bütün kelimeleri 0 yap"
          >
            <Eraser className="w-3.5 h-3.5" /> Temizle
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.hex,.raw,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importRaw(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="px-4 py-3">
          <div
            ref={scrollRef}
            className={`overflow-y-auto overflow-x-auto rounded-xl border ${dark ? 'border-slate-700' : 'border-slate-200'}`}
            style={{ height: viewH + 2 }}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (Math.abs(el.scrollTop - expectedScroll.current) <= 1) return;
              expectedScroll.current = el.scrollTop;
              const t = scaled ? Math.round((el.scrollTop / Math.max(1, spacerH - viewH)) * maxTop) : Math.round(el.scrollTop / ROW_H);
              setTop(Math.max(0, Math.min(maxTop, t)));
            }}
          >
            <div style={{ height: spacerH, position: 'relative' }}>
              <div
                ref={gridRef}
                tabIndex={0}
                onKeyDown={onKeyDown}
                className="absolute left-0 right-0 font-mono text-xs outline-none px-1"
                style={{ top: scrollOf(top) }}
              >
                {visible}
              </div>
            </div>
          </div>
        </div>

        <div className={`p-4 border-t flex items-center justify-between gap-2 ${dark ? 'border-slate-700' : 'border-slate-200 bg-slate-50'}`}>
          <span className={`text-[11px] font-mono ${c.sub}`}>
            Adres {hex(cursor, addrDigits)} = {hex(read(cursor), digits)}
            {running >= 0 && <span className="ml-3 text-amber-600">Devredeki adres: {hex(running, addrDigits)}</span>}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={`px-4 py-2 font-semibold text-xs rounded-xl cursor-pointer ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}>
              İptal
            </button>
            <button
              onClick={() => onSave(pages)}
              disabled={!dirty}
              className="px-4 py-2 bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
            >
              Kaydet ve uygula
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
