/**
 * Duration editor of a programmable generator (Logisim-evolution's ProgrammableGeneratorState.editWindow): one row per
 * state with its high and low duration in ticks. As in evolution only the digits of a field count and a field left
 * empty or 0 keeps the old value; "Temizle" sets every duration to 1 and, once saved, starts the generator over at
 * its first state (evolution's Clear). A strip under the table draws one round through every state.
 */
import { useEffect, useRef, useState } from 'react';
import { Eraser, Activity, X } from 'lucide-react';
import type { CircuitComponentInstance } from '../types/circuit';
import { pgDecode, pgStateCount } from '../utils/circuitEngine';

export interface PgEditorProps {
  comp: CircuitComponentInstance;
  dark: boolean;
  /** cleared: the editor's Clear was used (the generator starts over) */
  onSave: (high: number[], low: number[], cleared: boolean) => void;
  onClose: () => void;
}

/** evolution's saveValues: the digits of the text as a number; undefined when it gives no value of 1 or more */
export function pgFieldValue(text: string): number | undefined {
  const digits = text.replace(/\D/g, '');
  if (!digits) return undefined;
  const v = Number(digits);
  return v >= 1 && v <= 2147483647 ? v : undefined;
}

const PREVIEW_TICKS = 400;

export default function PgEditor({ comp, dark, onSave, onClose }: PgEditorProps) {
  const n = pgStateCount(comp);
  const saved = pgDecode(comp.state.pgContents, n);
  const [high, setHigh] = useState<string[]>(() => saved.high.map(String));
  const [low, setLow] = useState<string[]>(() => saved.low.map(String));
  const [base, setBase] = useState(saved);
  const [cleared, setCleared] = useState(false);
  const [dirty, setDirty] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  // the durations a save would give: a field with no usable value keeps the value it started from
  const valueOf = (list: string[], old: number[], i: number) => pgFieldValue(list[i]) ?? old[i];
  const outHigh = Array.from({ length: n }, (_, i) => valueOf(high, base.high, i));
  const outLow = Array.from({ length: n }, (_, i) => valueOf(low, base.low, i));

  const clear = () => {
    const ones = new Array<number>(n).fill(1);
    setBase({ high: ones, low: ones });
    setHigh(ones.map(String));
    setLow(ones.map(String));
    setCleared(true);
    setDirty(true);
  };

  // one round through every state (cut at PREVIEW_TICKS ticks); 0 / negative durations from a file count as 0
  const segs: { state: number; from: number; hi: number; lo: number }[] = [];
  let total = 0;
  for (let i = 0; i < n && total < PREVIEW_TICKS; i++) {
    const hi = Math.max(0, outHigh[i]);
    const lo = Math.max(0, outLow[i]);
    segs.push({ state: i, from: total, hi, lo });
    total += hi + lo;
  }
  const shown = Math.min(total, PREVIEW_TICKS);
  const tickW = shown > 0 ? Math.max(1, Math.min(16, 640 / shown)) : 16;
  let wave = '';
  let level: 0 | 1 | null = null;
  const yOf = (l: 0 | 1) => (l ? 8 : 32);
  for (const s of segs) {
    for (const [len, l] of [[s.hi, 1], [s.lo, 0]] as [number, 0 | 1][]) {
      const start = s.from + (l ? 0 : s.hi);
      if (len <= 0 || start >= shown) continue;
      const x0 = 4 + start * tickW;
      const x1 = 4 + Math.min(start + len, shown) * tickW;
      wave += level === null ? `M${x0} ${yOf(l)}` : level !== l ? `V${yOf(l)}` : '';
      wave += `H${x1}`;
      level = l;
    }
  }
  const curState = comp.state.pgCur ?? 0;
  const ink = dark ? '#cbd5e1' : '#1e293b';

  const c = dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', sub: 'text-slate-400', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', field: 'bg-slate-800 text-slate-100', border: 'border-slate-600', canvas: 'bg-slate-950' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-gradient-to-r from-emerald-50 to-teal-50', sub: 'text-slate-600', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', field: 'bg-white text-slate-900', border: 'border-slate-300', canvas: 'bg-slate-50' };

  const field = (list: string[], set: (v: string[]) => void, i: number, what: string) => {
    const bad = pgFieldValue(list[i]) === undefined;
    return (
      <input
        value={list[i]}
        onChange={(e) => {
          set(list.map((v, k) => (k === i ? e.target.value : v)));
          setDirty(true);
        }}
        className={`w-24 px-2 py-1 rounded-lg border text-center font-mono text-xs outline-none focus:ring-2 focus:ring-emerald-400 ${c.field} ${bad ? 'border-amber-500 bg-amber-50/10' : c.border}`}
        title={bad ? `Geçerli bir sayı yok: kaydedince eski değer (${what === 'h' ? base.high[i] : base.low[i]}) kalır` : undefined}
        inputMode="numeric"
      />
    );
  };

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
        className={`rounded-3xl max-w-3xl w-full border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] outline-none animate-in fade-in zoom-in-95 duration-150 ${c.panel}`}
      >
        <div className={`p-4 border-b flex items-center justify-between ${c.head}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500 text-white rounded-2xl shadow-xs">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <span>{comp.label || 'Programlanabilir üreteç'} süreleri</span>
                <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold rounded-full">{n} durum</span>
              </h3>
              <p className={`text-xs mt-0.5 ${c.sub}`}>
                Her durumda çıkış önce "yüksek" süre kadar tik 1, sonra "düşük" süre kadar tik 0 olur, sonra sıradaki duruma geçilir (sondan sonra ilk). Süreler tik cinsinden, en az 1; alandaki rakam dışı karakterler yok sayılır. Durum sayısı öznitelik panelinden değişir.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 opacity-60 hover:opacity-100 rounded-xl cursor-pointer" title="Kapat (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-auto px-4 py-3">
          <table className="mx-auto text-xs">
            <thead>
              <tr className={c.sub}>
                <th className="px-3 py-1 text-right">Durum</th>
                <th className="px-3 py-1">Yüksek (tik)</th>
                <th className="px-3 py-1">Düşük (tik)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: n }, (_, i) => (
                <tr key={i}>
                  <td className="px-3 py-1 text-right font-bold text-base" title={!cleared && i === curState ? 'Üreteç şu an bu durumda' : undefined}>
                    {!cleared && i === curState && <span className="text-emerald-500 mr-1">▸</span>}
                    {i + 1}
                  </td>
                  <td className="px-3 py-1">{field(high, setHigh, i, 'h')}</td>
                  <td className="px-3 py-1">{field(low, setLow, i, 'l')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className={`px-4 py-2 border-t ${c.canvas} ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className={`text-[11px] mb-1 ${c.sub}`}>
            Bir tur: {total} tik{total > PREVIEW_TICKS ? ` (ilk ${PREVIEW_TICKS} tik çiziliyor)` : ''}
          </div>
          <svg width={8 + shown * tickW} height={40} className="block max-w-full" style={{ overflow: 'visible' }}>
            {segs.map((s) =>
              s.from > 0 && s.from < shown ? <line key={s.state} x1={4 + s.from * tickW} y1={2} x2={4 + s.from * tickW} y2={38} stroke={ink} strokeOpacity={0.25} strokeDasharray="3 3" /> : null
            )}
            {wave && <path d={wave} fill="none" stroke="#10b981" strokeWidth={2} />}
          </svg>
        </div>

        <div className={`p-4 border-t flex items-center justify-between gap-2 ${dark ? 'border-slate-700' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center gap-3">
            <button onClick={clear} className={`px-2.5 py-1 rounded-lg border font-semibold text-xs flex items-center gap-1 cursor-pointer ${c.btn}`} title="Bütün süreleri 1 yap; kaydedince üreteç ilk durumdan yeniden başlar (Logisim-evolution 'Clear')">
              <Eraser className="w-3.5 h-3.5" /> Temizle
            </button>
            <span className={`text-[11px] ${c.sub}`}>{cleared ? 'Kaydedince üreteç ilk durumdan başlar.' : 'Kaydetmek üretecin şimdiki durumunu ve tik sayısını değiştirmez.'}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={`px-4 py-2 font-semibold text-xs rounded-xl cursor-pointer ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}>
              İptal
            </button>
            <button
              onClick={() => onSave(outHigh, outLow, cleared)}
              disabled={!dirty}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl cursor-pointer"
            >
              Kaydet ve uygula
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
