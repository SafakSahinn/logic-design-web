// Chronogram (timing diagram) panel, after Logisim-evolution's gui/chrono: a signal name column with the
// current values on the left, the waveforms of every selected signal on one shared time axis on the right.
import { useLayoutEffect, useRef } from 'react';
import { Activity, Download, Pause, Play, RotateCcw, X } from 'lucide-react';
import { bitsToString, formatBits, type SignalValue } from '../types/logic';
import type { WaveformSample } from '../utils/vcdGenerator';
import { CHRONO_LIMITS, waveKey, waveSymbol, type ChronoSignal } from '../utils/chronogram';

// Segment colours for non-binary values, as in evolution's chronogram (x / z: orange box, E: red box)
const WAVE_UNKNOWN_FILL = '#eaaa6c';
const WAVE_ERROR_FILL = '#f97676';
// A wide sample as one value: its hex text (x / E digits as Logisim shows them) and the colour class of the bus
// segment: E if any bit is E, x if any bit is undefined / floating, else a normal value
const waveBusText = (bits: SignalValue[]): string => formatBits(bits, '16').toUpperCase().replace(/X/g, 'x');
const waveBusKind = (bits: SignalValue[]): 'E' | 'X' | 'ok' =>
  bits.includes('E') ? 'E' : bits.some((b) => b !== 0 && b !== 1) ? 'X' : 'ok';

/** pixels per time slot (evolution RightPanel: tickWidth 20 at the default zoom) */
const TICK_WIDTH = 20;
/** room after the last slot (evolution RightPanel.EXTRA_SPACE) */
const EXTRA_SPACE = 40;
const ROW_H = 40;
const Y_HIGH = 8;
const Y_LOW = 32;

export interface ChronoClockOption {
  key: string;
  name: string;
}

export interface ChronogramPanelProps {
  signals: ChronoSignal[];
  samples: WaveformSample[];
  paused: boolean;
  /** clocks that can be the time source */
  clocks: ChronoClockOption[];
  /** the time source in use: a clock key, or null for step mode */
  clockKey: string | null;
  limit: number;
  onTogglePause: () => void;
  onClear: () => void;
  onExportVCD: () => void;
  onClose: () => void;
  /** a clock key, or null for step mode */
  onClockChange: (key: string | null) => void;
  onLimitChange: (limit: number) => void;
}

type Seg = { v: SignalValue; bits?: SignalValue[]; key: string; x0: number; x1: number };

// Runs of equal values of one signal; 0/1 runs form the step line, x / z / E runs and bus values are boxes
function segmentsOf(samples: WaveformSample[], key: string, t0: number): Seg[] {
  const segs: Seg[] = [];
  samples.forEach((smp) => {
    const raw = smp.values[key];
    const k = waveKey(raw);
    const x0 = (smp.time - t0) * TICK_WIDTH;
    const x1 = x0 + TICK_WIDTH;
    const last = segs[segs.length - 1];
    if (last && last.key === k) last.x1 = x1;
    else if (Array.isArray(raw)) segs.push({ v: 0, bits: raw, key: k, x0, x1 });
    else segs.push({ v: raw ?? 0, key: k, x0, x1 });
  });
  return segs;
}

function SignalTrace({ signal, samples, t0 }: { signal: ChronoSignal; samples: WaveformSample[]; t0: number }) {
  const isBus = signal.width > 1;
  const segs = segmentsOf(samples, signal.key, t0);
  let pathD = '';
  let prevBinary = false;
  segs.forEach((sg) => {
    if (isBus || (sg.v !== 0 && sg.v !== 1)) {
      prevBinary = false;
      return;
    }
    const y = sg.v === 1 ? Y_HIGH : Y_LOW;
    pathD += prevBinary ? ` V ${y} H ${sg.x1}` : ` M ${sg.x0},${y} H ${sg.x1}`;
    prevBinary = true;
  });
  const yMid = (Y_HIGH + Y_LOW) / 2;
  return (
    <>
      {/* fill under the 1 runs */}
      {!isBus &&
        segs
          .filter((sg) => sg.v === 1)
          .map((sg, k) => (
            <rect key={`a${k}`} x={sg.x0} y={Y_HIGH} width={sg.x1 - sg.x0} height={Y_LOW - Y_HIGH} fill={signal.color} opacity={0.15} />
          ))}

      {/* bus rows: one hexagon per run of equal values with its hex text; E red, x orange */}
      {isBus &&
        segs.map((sg, k) => {
          const bits = sg.bits ?? [];
          const kind = waveBusKind(bits);
          const col = kind === 'E' ? WAVE_ERROR_FILL : kind === 'X' ? WAVE_UNKNOWN_FILL : signal.color;
          const slope = Math.min(4, (sg.x1 - sg.x0) / 2);
          const text = waveBusText(bits);
          return (
            <g key={`b${k}`}>
              <polygon
                points={`${sg.x0},${yMid} ${sg.x0 + slope},${Y_HIGH} ${sg.x1 - slope},${Y_HIGH} ${sg.x1},${yMid} ${sg.x1 - slope},${Y_LOW} ${sg.x0 + slope},${Y_LOW}`}
                fill={col}
                fillOpacity={kind === 'ok' ? 0.15 : 0.55}
                stroke={col}
                strokeWidth={1.5}
              />
              {sg.x1 - sg.x0 >= text.length * 6.5 + 8 && (
                <text
                  x={(sg.x0 + sg.x1) / 2}
                  y={yMid + 3.5}
                  textAnchor="middle"
                  className={`text-[10px] font-mono font-extrabold select-none ${kind === 'ok' ? 'fill-slate-100' : 'fill-slate-950'}`}
                >
                  {text}
                </text>
              )}
              <title>{`${signal.name}: ${bitsToString(bits)} = 0x${text}`}</title>
            </g>
          );
        })}

      {/* x / z / E runs */}
      {!isBus &&
        segs
          .filter((sg) => sg.v !== 0 && sg.v !== 1)
          .map((sg, k) => (
            <g key={`u${k}`}>
              <rect
                x={sg.x0}
                y={Y_HIGH}
                width={sg.x1 - sg.x0}
                height={Y_LOW - Y_HIGH}
                fill={sg.v === 'E' ? WAVE_ERROR_FILL : WAVE_UNKNOWN_FILL}
                fillOpacity={0.55}
                stroke={sg.v === 'E' ? WAVE_ERROR_FILL : WAVE_UNKNOWN_FILL}
                strokeWidth={1.5}
              />
              {sg.x1 - sg.x0 >= 14 && (
                <text x={(sg.x0 + sg.x1) / 2} y={yMid + 3.5} textAnchor="middle" className="text-[10px] font-mono font-extrabold fill-slate-950 select-none">
                  {waveSymbol(sg.v)}
                </text>
              )}
            </g>
          ))}

      {pathD && (
        <path d={pathD} fill="none" stroke={signal.color} strokeWidth={2.2} strokeLinecap="square" strokeLinejoin="miter" />
      )}
    </>
  );
}

// Current value badge: a bus shows its hex value and takes the colour of a 1 / E / x value
function ValueBadge({ raw }: { raw: SignalValue | SignalValue[] | undefined }) {
  const bits = Array.isArray(raw) ? raw : undefined;
  const busKind = bits ? waveBusKind(bits) : undefined;
  const v: SignalValue = bits
    ? busKind === 'E'
      ? 'E'
      : busKind === 'X'
        ? 'X'
        : bits.includes(1)
          ? 1
          : 0
    : (raw as SignalValue | undefined) ?? 0;
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-extrabold shrink-0 ${
        v === 1
          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
          : v === 'E'
            ? 'bg-red-950 text-red-400 border border-red-800'
            : v === 'X' || v === 'Z'
              ? 'bg-orange-950 text-orange-300 border border-orange-800'
              : 'bg-slate-900 text-slate-500 border border-slate-800'
      }`}
    >
      {bits ? waveBusText(bits) : waveSymbol(v)}
    </span>
  );
}

export function ChronogramPanel(props: ChronogramPanelProps) {
  const { signals, samples, paused, clocks, clockKey, limit } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the newest slot while the view is at the right end (evolution RightPanel.updateSize)
  const atEndRef = useRef(true);
  const t0 = samples.length > 0 ? samples[0].time : 0;
  const slots = samples.length;
  const width = slots * TICK_WIDTH + EXTRA_SPACE;
  const height = signals.length * ROW_H;
  const lastValues = samples.length > 0 ? samples[samples.length - 1].values : {};

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atEndRef.current) el.scrollLeft = el.scrollWidth;
  }, [slots, t0, signals.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) atEndRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
  };

  const selectCls = 'bg-slate-800 border border-slate-700 text-slate-200 rounded-lg text-xs px-2 py-1 cursor-pointer';

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 text-slate-100 shadow-xl space-y-4 animate-in fade-in slide-in-from-top-4 duration-200">
      {/* Header & controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-950/80 text-cyan-400 rounded-xl border border-cyan-800/60 shadow-2xs">
            <Activity className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-sm sm:text-base text-white tracking-wide">Zamanlama Diyagramı (Chronogram)</h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-800">
                {paused ? 'DURAKLATILDI' : 'KAYIT'}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Devre her değiştiğinde kaydedilir; saat kaynağı seçiliyse her kenar yeni bir zaman dilimidir
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            Zaman:
            <select
              id="chrono-clock"
              className={selectCls}
              value={clockKey ?? ''}
              onChange={(e) => props.onClockChange(e.target.value === '' ? null : e.target.value)}
              title="Zaman ekseninin kaynağı: bir saatin her kenarı (iki kenar) ya da devredeki her değişiklik (adım)"
            >
              {clocks.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} kenarları
                </option>
              ))}
              <option value="">Adım (her değişiklik)</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            Geçmiş:
            <select
              id="chrono-limit"
              className={selectCls}
              value={limit}
              onChange={(e) => props.onLimitChange(Number(e.target.value))}
              title="Saklanacak en fazla zaman dilimi; eskiler silinir"
            >
              {CHRONO_LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'Sınırsız' : `${n} dilim`}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={props.onTogglePause}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors ${
              paused ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            <span>{paused ? 'Kaydı Sürdür' : 'Duraklat'}</span>
          </button>
          <button
            onClick={props.onClear}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-xl text-xs font-semibold border border-slate-700 flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Kaydı sil ve şimdiki değerlerden yeniden başla"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Temizle</span>
          </button>
          <button
            onClick={props.onExportVCD}
            className="px-3 py-1.5 bg-cyan-950 hover:bg-cyan-900 text-cyan-300 hover:text-white rounded-xl text-xs font-semibold border border-cyan-800 flex items-center gap-1.5 cursor-pointer transition-colors"
            title="Seçili sinyallerin kaydını GTKWave / ModelSim ile açılan VCD dosyası olarak indir"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>VCD İndir (GTKWave)</span>
          </button>
          <button onClick={props.onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer transition-colors" title="Paneli Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {signals.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-xs font-mono">
          Tuval üzerinde izlenecek giriş veya çıkış elemanı (Anahtar, Saat, LED, Prob vb.) bulunamadı.
        </div>
      ) : (
        <div className="flex bg-slate-950/70 rounded-2xl border border-slate-800/80 overflow-hidden" id="chrono-body">
          {/* Signal names and current values */}
          <div className="w-48 shrink-0 border-r border-slate-800">
            {signals.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 px-3 border-b border-slate-900" style={{ height: ROW_H }}>
                <div className="flex items-center gap-2 truncate">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="font-mono text-xs font-bold text-slate-200 truncate" title={s.name}>
                    {s.name}
                  </span>
                </div>
                <ValueBadge raw={lastValues[s.key]} />
              </div>
            ))}
          </div>

          {/* Waveforms on one shared time axis */}
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-x-auto" id="chrono-scroll">
            <svg width={width} height={height} className="block">
              {Array.from({ length: slots + 1 }).map((_, i) => (
                <line key={i} x1={i * TICK_WIDTH} y1={0} x2={i * TICK_WIDTH} y2={height} stroke="#1e293b" strokeWidth={1} strokeDasharray="2,3" />
              ))}
              {signals.map((s, r) => (
                <g key={s.key} transform={`translate(0 ${r * ROW_H})`}>
                  {s.width === 1 && <line x1={0} y1={Y_LOW} x2={width} y2={Y_LOW} stroke="#334155" strokeWidth={1} />}
                  <SignalTrace signal={s} samples={samples} t0={t0} />
                </g>
              ))}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}
