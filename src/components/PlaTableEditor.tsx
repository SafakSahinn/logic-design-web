/**
 * Program editor of a PLA (Logisim-evolution's PlaTable.EditorDialog): one row per line, the input bits (most
 * significant first) cycle 0 -> 1 -> x on a click, the output bits 0 <-> 1, each row has a comment. Rows are tried
 * top to bottom, so they can be moved. The program can be read from and written to evolution's text files.
 * Edits are kept in a draft until saved.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Download, FolderOpen, Plus, Table2, Trash2, X } from 'lucide-react';
import type { CircuitComponentInstance, PlaRow } from '../types/circuit';
import { getPlaConfig, parsePlaTable, plaTableText } from '../utils/circuitEngine';

export interface PlaTableEditorProps {
  comp: CircuitComponentInstance;
  dark: boolean;
  onSave: (rows: PlaRow[]) => void;
  onClose: () => void;
  onToast: (message: string) => void;
}

const nextIn = (ch: string) => (ch === '0' ? '1' : ch === '1' ? 'x' : '0');

export default function PlaTableEditor({ comp, dark, onSave, onClose, onToast }: PlaTableEditorProps) {
  const cfg = getPlaConfig(comp);
  const [rows, setRows] = useState<PlaRow[]>(() => cfg.rows.map((r) => ({ ...r })));
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // The row the circuit selects now (only meaningful while the draft has the saved rows)
  const hit = dirty ? -1 : comp.state.plaHit ?? -1;

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const change = (next: PlaRow[]) => {
    setRows(next);
    setDirty(true);
  };
  const setRow = (i: number, patch: Partial<PlaRow>) => change(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const flip = (s: string, j: number, f: (ch: string) => string) => s.slice(0, j) + f(s[j]) + s.slice(j + 1);
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };

  const exportText = () => {
    // (evolution's file: a comment line, then the rows)
    const blob = new Blob(['# PLA program table\n' + plaTableText(rows)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(comp.label || 'pla').replace(/[^a-z0-9_-]/gi, '_')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importText = (file: File) => {
    file.text().then((text) => {
      const res = parsePlaTable(text);
      if (!res) {
        onToast('Dosyada PLA satırı bulunamadı.');
        return;
      }
      // Like evolution the widths must be the part's own (they are set in the attribute panel)
      if (res.inWidth !== cfg.inWidth || res.outWidth !== cfg.outWidth) {
        onToast(`Dosyadaki tablo ${res.inWidth} giriş / ${res.outWidth} çıkış bitlik; bu PLA ${cfg.inWidth} / ${cfg.outWidth} bitlik.`);
        return;
      }
      change(res.rows);
      onToast(res.errors.length ? `${res.rows.length} satır okundu; ${res.errors.length} satır atlandı (${res.errors[0]}).` : `${res.rows.length} satır okundu.`);
    });
  };

  const c = dark
    ? {
        panel: 'bg-slate-900 border-slate-700 text-slate-100',
        head: 'border-slate-700 bg-slate-800/60',
        sub: 'text-slate-400',
        btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600',
        bit0: 'bg-slate-800 text-slate-300 border-slate-600',
        bit1: 'bg-emerald-600 text-white border-emerald-500',
        bitx: 'bg-indigo-900 text-indigo-200 border-indigo-600',
        row: 'border-slate-800',
        hit: 'bg-amber-500/15',
        input: 'bg-slate-800 border-slate-600 text-slate-100',
      }
    : {
        panel: 'bg-white border-slate-200 text-slate-900',
        head: 'border-slate-200 bg-gradient-to-r from-cyan-50 to-sky-50',
        sub: 'text-slate-600',
        btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300',
        bit0: 'bg-white text-slate-600 border-slate-300',
        bit1: 'bg-emerald-500 text-white border-emerald-600',
        bitx: 'bg-indigo-50 text-indigo-700 border-indigo-300',
        row: 'border-slate-100',
        hit: 'bg-amber-50',
        input: 'bg-white border-slate-300 text-slate-900',
      };
  const bitCls = (ch: string) => (ch === '1' ? c.bit1 : ch === 'x' ? c.bitx : c.bit0);
  const bitBtn = 'w-6 h-6 shrink-0 rounded border font-mono text-[11px] font-bold cursor-pointer select-none';
  // bit numbers over the columns, most significant first
  const numbers = (w: number) => Array.from({ length: w }, (_, j) => w - 1 - j);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => e.stopPropagation()}>
      <div
        ref={boxRef}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        className={`rounded-3xl max-w-5xl w-full border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] outline-none animate-in fade-in zoom-in-95 duration-150 ${c.panel}`}
      >
        <div className={`p-4 border-b flex items-center justify-between ${c.head}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500 text-white rounded-2xl shadow-xs">
              <Table2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <span>{comp.label || 'PLA'} programı</span>
                <span className="px-2 py-0.5 bg-sky-100 text-sky-800 text-[10px] font-mono font-bold rounded-full">
                  {cfg.inWidth} giriş × {cfg.outWidth} çıkış bit
                </span>
              </h3>
              <p className={`text-xs mt-0.5 ${c.sub}`}>
                Satırlar yukarıdan aşağı denenir; girişe uyan ilk satırın çıkışı verilir, hiçbiri uymazsa çıkış 0. Giriş bitine tıklamak 0 → 1 → x (fark etmez), çıkış bitine tıklamak 0 ↔ 1 yapar. Bit genişlikleri öznitelik panelinden değişir.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 opacity-60 hover:opacity-100 rounded-xl cursor-pointer" title="Kapat (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`px-4 py-2.5 border-b flex flex-wrap items-center gap-2 text-xs ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <button
            onClick={() => change([...rows, { in: '0'.repeat(cfg.inWidth), out: '0'.repeat(cfg.outWidth) }])}
            className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${c.btn}`}
            title="Tablonun sonuna yeni satır ekle"
          >
            <Plus className="w-3.5 h-3.5" /> Satır ekle
          </button>
          <div className="flex-1" />
          <button onClick={() => fileRef.current?.click()} className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${c.btn}`} title="PLA program dosyası aç">
            <FolderOpen className="w-3.5 h-3.5" /> Dosyadan aç
          </button>
          <button onClick={exportText} className={`px-2.5 py-1 rounded-lg border font-semibold flex items-center gap-1 cursor-pointer ${c.btn}`} title="Programı PLA dosyası olarak indir">
            <Download className="w-3.5 h-3.5" /> Dosyaya kaydet
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.pla,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importText(f);
              e.target.value = '';
            }}
          />
        </div>

        <div className="px-4 py-3 overflow-auto">
          {rows.length === 0 ? (
            <p className={`text-xs py-6 text-center ${c.sub}`}>Tabloda satır yok: çıkış her girişte 0. “Satır ekle” ile başlayın.</p>
          ) : (
            <table className="text-xs border-separate border-spacing-0">
              <thead>
                <tr className={c.sub}>
                  <th className="pr-2 text-right font-semibold">#</th>
                  <th className="px-2 text-left font-semibold">
                    giriş
                    <div className="flex gap-0.5 font-mono text-[9px] font-normal">
                      {numbers(cfg.inWidth).map((n) => (
                        <span key={n} className="w-6 text-center">{n}</span>
                      ))}
                    </div>
                  </th>
                  <th className="px-2 text-left font-semibold">
                    çıkış
                    <div className="flex gap-0.5 font-mono text-[9px] font-normal">
                      {numbers(cfg.outWidth).map((n) => (
                        <span key={n} className="w-6 text-center">{n}</span>
                      ))}
                    </div>
                  </th>
                  <th className="px-2 text-left font-semibold">yorum</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={i === hit ? c.hit : ''} title={i === hit ? 'Devredeki giriş bu satıra uyuyor' : undefined}>
                    <td className={`pr-2 text-right font-mono border-t ${c.row} ${c.sub}`}>{i + 1}</td>
                    <td className={`px-2 py-1 border-t ${c.row}`}>
                      <div className="flex gap-0.5">
                        {[...r.in].map((ch, j) => (
                          <button key={j} className={`${bitBtn} ${bitCls(ch)}`} onClick={() => setRow(i, { in: flip(r.in, j, nextIn) })} title={`Giriş biti ${cfg.inWidth - 1 - j}`}>
                            {ch}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className={`px-2 py-1 border-t ${c.row}`}>
                      <div className="flex gap-0.5">
                        {[...r.out].map((ch, j) => (
                          <button key={j} className={`${bitBtn} ${bitCls(ch)}`} onClick={() => setRow(i, { out: flip(r.out, j, (b) => (b === '1' ? '0' : '1')) })} title={`Çıkış biti ${cfg.outWidth - 1 - j}`}>
                            {ch}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className={`px-2 py-1 border-t ${c.row}`}>
                      <input
                        value={r.comment ?? ''}
                        onChange={(e) => setRow(i, { comment: e.target.value })}
                        className={`w-48 px-2 py-0.5 rounded-md border outline-none focus:border-sky-500 ${c.input}`}
                        placeholder="—"
                        title="Bu satır seçiliyken PLA gövdesinde gösterilir (# işaretinden sonrası gösterilmez)"
                      />
                    </td>
                    <td className={`pl-1 py-1 border-t whitespace-nowrap ${c.row}`}>
                      <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 opacity-60 hover:opacity-100 disabled:opacity-20 cursor-pointer" title="Yukarı taşı (önce denenir)">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="p-1 opacity-60 hover:opacity-100 disabled:opacity-20 cursor-pointer" title="Aşağı taşı">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => change(rows.filter((_, k) => k !== i))} className="p-1 opacity-60 hover:opacity-100 hover:text-rose-500 cursor-pointer" title="Satırı sil">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className={`p-4 border-t flex items-center justify-between gap-2 ${dark ? 'border-slate-700' : 'border-slate-200 bg-slate-50'}`}>
          <span className={`text-[11px] font-mono ${c.sub}`}>
            {rows.length} satır
            {!dirty && <span className="ml-3 text-amber-600">{hit >= 0 ? `Devredeki giriş: ${hit + 1}. satır` : 'Devredeki girişe uyan satır yok (çıkış 0)'}</span>}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={`px-4 py-2 font-semibold text-xs rounded-xl cursor-pointer ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}>
              İptal
            </button>
            <button
              onClick={() => onSave(rows)}
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
