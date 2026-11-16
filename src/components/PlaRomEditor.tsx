/**
 * Matrix editor of a PLA ROM (Logisim-evolution's PlaRomPanel): the inputs come down from the top, each as its own
 * line and its inverse (through a NOT); every AND gate is a row, every output an OR at the bottom. A click on a
 * crossing puts or takes a dot: on the AND side a dot on a bit takes the dot off its inverse, as in evolution. The
 * lines show the live values the drawn matrix gives for the circuit's input. Edits are kept in a draft until saved.
 */
import { useEffect, useRef, useState } from 'react';
import { Eraser, Grid3x3, X } from 'lucide-react';
import type { CircuitComponentInstance } from '../types/circuit';
import type { SignalValue } from '../types/logic';
import { getPlaRomConfig, plaRomOutputValues, plaRomSelected, plaRomTermValues, type PlaRomConfig } from '../utils/circuitEngine';

export interface PlaRomEditorProps {
  comp: CircuitComponentInstance;
  dark: boolean;
  onSave: (and: string[], or: string[]) => void;
  onClose: () => void;
}

// Drawing grid (evolution's panel: 40 per input, 40 per AND gate, 40 per output, a 20 border)
const B = 20;
const TOP = 100;
const ZOOM = 1.25;
const nx = (c: number) => B + 40 * c + 10; // inverse line of input column c (most significant first)
const tx = (c: number) => B + 40 * c + 30; // the input's own line
const ay = (r: number) => TOP + 40 * r; // AND gate r
const show = (v: SignalValue | undefined) => (v === 0 ? '0' : v === 1 ? '1' : v === 'E' ? 'E' : 'x');

export default function PlaRomEditor({ comp, dark, onSave, onClose }: PlaRomEditorProps) {
  const saved = getPlaRomConfig(comp);
  const [and, setAnd] = useState<string[]>(() => [...saved.and]);
  const [or, setOr] = useState<string[]>(() => [...saved.or]);
  const [dirty, setDirty] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const { inputs: n, terms: t, outputs: m } = saved;
  const cfg: PlaRomConfig = { ...saved, and, or };
  // the circuit's input now, LSB first (open / floating bits read as x, as the engine reads them)
  const inPin = comp.inputs[0];
  const inBits: SignalValue[] = Array.from({ length: n }, (_, i) => {
    const v = n > 1 ? inPin?.bits?.[i] : inPin?.value;
    return v === 0 || v === 1 || v === 'E' ? v : 'X';
  });
  const termVals = plaRomTermValues(cfg, inBits);
  const outVals = plaRomOutputValues(cfg, termVals);
  const csVal = comp.inputs[1]?.value;
  const selected = plaRomSelected(saved.csHigh, csVal === 0 || csVal === 1 ? csVal : 'X');

  const setChar = (rows: string[], r: number, col: number, ch: string) => rows.map((s, k) => (k === r ? s.slice(0, col) + ch + s.slice(col + 1) : s));
  // AND side: the bit ('1') or its inverse ('0'); a dot on one takes the other's off
  const clickAnd = (r: number, c: number, lit: '0' | '1') => {
    setAnd(setChar(and, r, c, and[r][c] === lit ? '-' : lit));
    setDirty(true);
  };
  const clickOr = (r: number, k: number) => {
    setOr(setChar(or, r, k, or[r][k] === '1' ? '0' : '1'));
    setDirty(true);
  };
  const clear = () => {
    setAnd(and.map(() => '-'.repeat(n)));
    setOr(or.map(() => '0'.repeat(m)));
    setDirty(true);
  };

  const ink = dark ? '#cbd5e1' : '#1e293b';
  const valColor = (v: SignalValue | undefined) =>
    v === 1 ? '#16a34a' : v === 0 ? (dark ? '#166534' : '#14532d') : v === 'E' ? '#dc2626' : '#2563eb';
  const andX = B + 40 * n + 16; // left edge of the AND gates
  const ox = (k: number) => B + 40 * n + 80 + 40 * k; // OR column k (most significant first)
  const bottom = ay(t - 1);
  const W = ox(m - 1) + 20 + B;
  const H = bottom + 110;

  // product term of a gate as text: I3 · I1' ...
  const termText = (r: number) => {
    const lits = [...and[r]].flatMap((ch, c) => (ch === '1' ? [`I${n - 1 - c}`] : ch === '0' ? [`I${n - 1 - c}'`] : []));
    return lits.length ? lits.join('·') : 'E';
  };
  const outText = (k: number) => {
    const ts = or.flatMap((s, r) => (s[k] === '1' ? [r] : []));
    return ts.length ? ts.map((r) => (and[r].includes('0') || and[r].includes('1') ? termText(r) : `VE${r}(boş: E)`)).join(' + ') : 'E (bağlı VE kapısı yok)';
  };

  const ring = (key: string, x: number, y: number, onClick: () => void, title: string) => (
    <g key={key} onClick={onClick} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover((h) => (h === key ? null : h))} className="cursor-pointer">
      <title>{title}</title>
      <circle cx={x} cy={y} r={9} fill="transparent" />
      {hover === key && <circle cx={x} cy={y} r={6} fill="none" stroke="#0ea5e9" strokeWidth={2} />}
    </g>
  );
  const dot = (key: string, x: number, y: number) => <circle key={key} cx={x} cy={y} r={4} fill={dark ? '#0f172a' : '#ffffff'} stroke={ink} strokeWidth={1.5} pointerEvents="none" />;

  const c = dark
    ? { panel: 'bg-slate-900 border-slate-700 text-slate-100', head: 'border-slate-700 bg-slate-800/60', sub: 'text-slate-400', btn: 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-600', canvas: 'bg-slate-950' }
    : { panel: 'bg-white border-slate-200 text-slate-900', head: 'border-slate-200 bg-gradient-to-r from-cyan-50 to-sky-50', sub: 'text-slate-600', btn: 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300', canvas: 'bg-slate-50' };

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
        className={`rounded-3xl max-w-6xl w-full border shadow-2xl overflow-hidden flex flex-col max-h-[92vh] outline-none animate-in fade-in zoom-in-95 duration-150 ${c.panel}`}
      >
        <div className={`p-4 border-b flex items-center justify-between ${c.head}`}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-sky-500 text-white rounded-2xl shadow-xs">
              <Grid3x3 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base flex items-center gap-2">
                <span>{comp.label || 'PLA ROM'} matrisi</span>
                <span className="px-2 py-0.5 bg-sky-100 text-sky-800 text-[10px] font-mono font-bold rounded-full">
                  {n} giriş × {t} VE × {m} çıkış
                </span>
              </h3>
              <p className={`text-xs mt-0.5 ${c.sub}`}>
                Her VE kapısı üzerinde nokta olan giriş çizgilerini VE'ler (bitin kendisi ya da NOT'tan geçen tersi); her çıkış, sütununda nokta olan VE kapılarını VEYA'lar. Kesişime tıklamak noktayı koyar / kaldırır. Noktasız VE kapısı ve bağlantısız çıkış E verir. Boyutlar öznitelik panelinden değişir.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 opacity-60 hover:opacity-100 rounded-xl cursor-pointer" title="Kapat (Esc)">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className={`overflow-auto ${c.canvas}`}>
          <svg width={W * ZOOM} height={H * ZOOM} viewBox={`0 0 ${W} ${H}`} className="block mx-auto select-none" fontFamily="sans-serif">
            {/* inputs: bit number, live value, the line and its inverse through a NOT */}
            {Array.from({ length: n }, (_, col) => {
              const bit = n - 1 - col;
              const v = inBits[bit];
              const inv: SignalValue = v === 0 ? 1 : v === 1 ? 0 : v === 'E' ? 'E' : 'X';
              const mid = B + 40 * col + 20;
              return (
                <g key={`i${col}`}>
                  <text x={mid} y={14} textAnchor="middle" fontSize={11} fontWeight="bold" fill={ink}>{bit}</text>
                  <text x={mid} y={30} textAnchor="middle" fontSize={11} fontWeight="bold" fill={valColor(v)}>{show(v)}</text>
                  <g stroke={valColor(v)} strokeWidth={2} fill="none">
                    <line x1={mid} y1={36} x2={mid} y2={44} />
                    <line x1={nx(col)} y1={44} x2={tx(col)} y2={44} />
                    <line x1={nx(col)} y1={44} x2={nx(col)} y2={52} />
                    <line x1={tx(col)} y1={44} x2={tx(col)} y2={bottom + 10} />
                  </g>
                  <circle cx={mid} cy={44} r={3} fill={valColor(v)} />
                  <line x1={nx(col)} y1={72} x2={nx(col)} y2={bottom + 10} stroke={valColor(inv)} strokeWidth={2} />
                  <path d={`M ${nx(col) - 6} 52 L ${nx(col) + 6} 52 L ${nx(col)} 65 Z`} fill="none" stroke={ink} strokeWidth={1.5} />
                  <circle cx={nx(col)} cy={68.5} r={3} fill="none" stroke={ink} strokeWidth={1.5} />
                </g>
              );
            })}
            {/* AND gates: the row of input crossings, the gate, its output running through the OR columns */}
            {Array.from({ length: t }, (_, r) => (
              <g key={`a${r}`}>
                <title>{`VE ${r}: ${termText(r)} = ${show(termVals[r])}`}</title>
                <line x1={B} y1={ay(r)} x2={andX} y2={ay(r)} stroke={ink} strokeWidth={1.5} />
                <path d={`M ${andX} ${ay(r) - 14} h 16 a 14 14 0 0 1 0 28 h -16 Z`} fill={dark ? '#1e293b' : '#ffffff'} stroke={ink} strokeWidth={1.5} />
                <text x={andX + 13} y={ay(r) + 4} textAnchor="middle" fontSize={10} fill={ink}>&amp;</text>
                <line x1={andX + 30} y1={ay(r)} x2={ox(m - 1) + 10} y2={ay(r)} stroke={valColor(termVals[r])} strokeWidth={2} />
              </g>
            ))}
            {/* OR gates at the bottom of the output columns, with the live value and the bit number */}
            {Array.from({ length: m }, (_, k) => {
              const bit = m - 1 - k;
              const v = selected ? outVals[bit] : 'Z';
              const y0 = bottom + 24;
              const x = ox(k);
              return (
                <g key={`o${k}`}>
                  <title>{`Çıkış ${bit} = ${outText(k)}`}</title>
                  <line x1={x} y1={ay(0) - 20} x2={x} y2={y0 + 4} stroke={ink} strokeWidth={1.5} />
                  <path d={`M ${x - 14} ${y0} Q ${x} ${y0 + 8} ${x + 14} ${y0} Q ${x + 14} ${y0 + 18} ${x} ${y0 + 28} Q ${x - 14} ${y0 + 18} ${x - 14} ${y0} Z`} fill={dark ? '#1e293b' : '#ffffff'} stroke={ink} strokeWidth={1.5} />
                  <text x={x} y={y0 + 15} textAnchor="middle" fontSize={8} fill={ink}>≥1</text>
                  <line x1={x} y1={y0 + 28} x2={x} y2={y0 + 38} stroke={valColor(v)} strokeWidth={2} />
                  <text x={x} y={y0 + 52} textAnchor="middle" fontSize={11} fontWeight="bold" fill={valColor(v)}>{show(v)}</text>
                  <text x={x} y={y0 + 68} textAnchor="middle" fontSize={11} fontWeight="bold" fill={ink}>{bit}</text>
                </g>
              );
            })}
            <text x={B} y={bottom + 70} fontSize={12} fontWeight="bold" fill={ink}>← giriş</text>
            <text x={ox(0) - 30} y={bottom + 70} textAnchor="end" fontSize={12} fontWeight="bold" fill={ink}>çıkış →</text>
            {/* dots, then the click areas over every crossing */}
            {and.flatMap((s, r) => [...s].flatMap((ch, col) => (ch === '1' ? [dot(`d${r}_${col}`, tx(col), ay(r))] : ch === '0' ? [dot(`d${r}_${col}`, nx(col), ay(r))] : [])))}
            {or.flatMap((s, r) => [...s].flatMap((ch, k) => (ch === '1' ? [dot(`e${r}_${k}`, ox(k), ay(r))] : [])))}
            {Array.from({ length: t }, (_, r) =>
              Array.from({ length: n }, (_, col) => [
                ring(`n${r}_${col}`, nx(col), ay(r), () => clickAnd(r, col, '0'), `VE ${r} ← giriş ${n - 1 - col} tersi`),
                ring(`t${r}_${col}`, tx(col), ay(r), () => clickAnd(r, col, '1'), `VE ${r} ← giriş ${n - 1 - col}`),
              ])
            )}
            {Array.from({ length: t }, (_, r) => Array.from({ length: m }, (_, k) => ring(`o${r}_${k}`, ox(k), ay(r), () => clickOr(r, k), `VE ${r} → çıkış ${m - 1 - k}`)))}
          </svg>
        </div>

        <div className={`px-4 py-2 border-t text-[11px] font-mono max-h-32 overflow-auto ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          {Array.from({ length: m }, (_, k) => (
            <div key={k} className={c.sub}>
              <span className="font-bold">O{m - 1 - k}</span> = {outText(k)}
            </div>
          ))}
        </div>

        <div className={`p-4 border-t flex items-center justify-between gap-2 ${dark ? 'border-slate-700' : 'border-slate-200 bg-slate-50'}`}>
          <div className="flex items-center gap-3">
            <button onClick={clear} className={`px-2.5 py-1 rounded-lg border font-semibold text-xs flex items-center gap-1 cursor-pointer ${c.btn}`} title="Bütün noktaları kaldır (Logisim-evolution 'Clear')">
              <Eraser className="w-3.5 h-3.5" /> Temizle
            </button>
            <span className={`text-[11px] ${c.sub}`}>
              Değerler devrenin şimdiki girişiyle hesaplanır{selected ? '' : '; seçme girişi (sel) pasif, çıkış boşta'}.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className={`px-4 py-2 font-semibold text-xs rounded-xl cursor-pointer ${dark ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-200 hover:bg-slate-300 text-slate-700'}`}>
              İptal
            </button>
            <button
              onClick={() => onSave(and, or)}
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
