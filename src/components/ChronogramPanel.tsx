// Chronogram (timing diagram) panel, after Logisim-evolution's gui/chrono: a signal name column with the
// current values on the left, the waveforms of every selected signal on one shared time axis on the right.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, GripVertical, ListChecks, Maximize2, Pause, Play, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react';
import { bitsToString, type Radix, type SignalValue } from '../types/logic';
import type { WaveformSample, WaveformValue } from '../utils/vcdGenerator';
import {
  CHRONO_LIMITS,
  chronoValueText,
  CHRONO_ZOOM_DEFAULT,
  CHRONO_ZOOM_MAX,
  CHRONO_ZOOM_MIN,
  chronoRulerStep,
  chronoTickWidth,
  chronoWidth,
  fitChronoZoom,
  moveChronoKey,
  stepChronoZoom,
  waveKey,
  waveSymbol,
  type ChronoSignal,
  type ChronoTreeNode,
} from '../utils/chronogram';

// Segment colours for non-binary values, as in evolution's chronogram (x / z: orange box, E: red box)
const WAVE_UNKNOWN_FILL = '#eaaa6c';
const WAVE_ERROR_FILL = '#f97676';
// A wide sample as one value: its hex text (x / E digits as Logisim shows them) and the colour class of the bus
// segment: E if any bit is E, x if any bit is undefined / floating, else a normal value
const waveBusText = (bits: SignalValue[], radix: Radix = '16'): string => chronoValueText(bits, radix);

// Display bases of wide signals (evolution RadixOption), as named in the signal's right-click menu
const RADIX_OPTIONS: [Radix, string][] = [
  ['2', 'İkilik (2)'],
  ['8', 'Sekizlik (8)'],
  ['10s', 'Onluk, işaretli'],
  ['10u', 'Onluk, işaretsiz'],
  ['16', 'Onaltılık (16)'],
];
const RADIX_PREFIX: Record<Radix, string> = { '2': '0b', '8': '0o', '10s': '', '10u': '', '16': '0x' };
const waveBusKind = (bits: SignalValue[]): 'E' | 'X' | 'ok' =>
  bits.includes('E') ? 'E' : bits.some((b) => b !== 0 && b !== 1) ? 'X' : 'ok';

const ROW_H = 40;
/** height of the time ruler above the waveforms (evolution's timeline header) */
const RULER_H = 22;
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
  /** every loggable signal: the top-level circuit and its subcircuit instances */
  tree: ChronoTreeNode;
  /** new selection (keys in display order), or null for the automatic one */
  onSelectionChange: (keys: string[] | null) => void;
  /** display base of wide signals by key; unset = hexadecimal */
  radix: Record<string, Radix>;
  onRadixChange: (key: string, radix: Radix) => void;
}

type Seg = { v: SignalValue; bits?: SignalValue[]; key: string; x0: number; x1: number };

// Runs of equal values of one signal; 0/1 runs form the step line, x / z / E runs and bus values are boxes
function segmentsOf(samples: WaveformSample[], key: string, t0: number, tick: number): Seg[] {
  const segs: Seg[] = [];
  samples.forEach((smp) => {
    const raw = smp.values[key];
    const x0 = (smp.time - t0) * tick;
    const x1 = x0 + tick;
    if (raw === undefined) return;
    const k = waveKey(raw);
    const last = segs[segs.length - 1];
    if (last && last.key === k && last.x1 === x0) last.x1 = x1;
    else if (Array.isArray(raw)) segs.push({ v: 0, bits: raw, key: k, x0, x1 });
    else segs.push({ v: raw ?? 0, key: k, x0, x1 });
  });
  return segs;
}

function SignalTrace({
  signal,
  samples,
  t0,
  tick,
  radix,
}: {
  signal: ChronoSignal;
  samples: WaveformSample[];
  t0: number;
  tick: number;
  radix: Radix;
}) {
  const isBus = signal.width > 1;
  const segs = segmentsOf(samples, signal.key, t0, tick);
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
          const text = waveBusText(bits, radix);
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
              <title>{`${signal.name}: ${bitsToString(bits)}${radix === '2' ? '' : ` = ${RADIX_PREFIX[radix]}${text}`}`}</title>
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
function ValueBadge({ raw, radix = '16' }: { raw: SignalValue | SignalValue[] | undefined; radix?: Radix }) {
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
      {bits ? waveBusText(bits, radix) : waveSymbol(v)}
    </span>
  );
}

// Value table (Logisim 2.7.1 log TablePanel; evolution 5.0.0 has none): one row per time slot of the chronogram, a
// column per selected signal in its display base. Rows are windowed, so an unlimited history stays fast.
const TABLE_ROW_H = 24;
const TABLE_HEAD_H = 28;
const TABLE_VIEW_H = 360;

const cellClass = (v: WaveformValue | undefined): string => {
  const kind = v === undefined ? 'none' : Array.isArray(v) ? waveBusKind(v) : v === 'E' ? 'E' : v === 0 || v === 1 ? 'ok' : 'X';
  if (kind === 'E') return 'text-red-400 font-bold';
  if (kind === 'X') return 'text-orange-300';
  if (kind === 'none') return 'text-slate-600';
  return v === 1 ? 'text-emerald-400' : 'text-slate-200';
};

function ChronoTable({
  signals,
  samples,
  radixOf,
  cursor,
  onCursor,
  onRadixMenu,
}: {
  signals: ChronoSignal[];
  samples: WaveformSample[];
  radixOf: (key: string) => Radix;
  cursor: number | null;
  onCursor: (t: number) => void;
  /** right-click on the header of a wide signal: its display base menu */
  onRadixMenu: (key: string, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // follow the newest row while the view is at the bottom (like the chronogram follows the right end)
  const atEndRef = useRef(true);
  const [scrollTop, setScrollTop] = useState(0);
  const rows = samples.length;
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atEndRef.current) {
      el.scrollTop = el.scrollHeight;
      setScrollTop(el.scrollTop);
    }
  }, [rows, samples[0]?.time]);
  // keep a row picked on the chronogram in view
  const t0 = rows > 0 ? samples[0].time : 0;
  useEffect(() => {
    const el = ref.current;
    if (!el || cursor === null) return;
    const y = (cursor - t0) * TABLE_ROW_H;
    if (y < el.scrollTop || y + TABLE_ROW_H > el.scrollTop + el.clientHeight - TABLE_HEAD_H) {
      el.scrollTop = Math.max(0, y - (el.clientHeight - TABLE_HEAD_H) / 2);
      atEndRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    }
  }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    atEndRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4;
    setScrollTop(el.scrollTop);
  };
  const first = Math.max(0, Math.floor(scrollTop / TABLE_ROW_H) - 5);
  const last = Math.min(rows, first + Math.ceil(TABLE_VIEW_H / TABLE_ROW_H) + 10);
  // wide enough for the name (up to 220 px) and for the widest value (a wide signal in binary: one digit per bit)
  const colW = (s: ChronoSignal) => Math.max(64, Math.min(220, s.name.length * 7 + 28), s.width > 1 ? s.width * 8 + 20 : 0);
  const gridCols = `72px ${signals.map((s) => `${colW(s)}px`).join(' ')}`;
  return (
    <div
      ref={ref}
      onScroll={onScroll}
      className="overflow-auto bg-slate-950/70 rounded-2xl border border-slate-800/80"
      style={{ maxHeight: TABLE_VIEW_H }}
      id="chrono-table"
    >
      <div style={{ minWidth: 'max-content' }}>
        <div
          className="grid sticky top-0 z-10 bg-slate-900 border-b border-slate-700 text-[11px] font-bold text-slate-300"
          style={{ gridTemplateColumns: gridCols, height: TABLE_HEAD_H }}
        >
          <div className="px-2 flex items-center text-slate-500" title="Zaman dilimi (diyagramdaki cetvel numarası)">
            t
          </div>
          {signals.map((s) => (
            <div key={s.key} className="px-2 flex items-center gap-1.5 truncate font-mono" title={s.width > 1 ? `${s.name} (sağ tık: sayı tabanı)` : s.name}
              data-chrono-col={s.key}
              onContextMenu={(e) => {
                if (s.width <= 1) return;
                e.preventDefault();
                onRadixMenu(s.key, e.clientX, e.clientY);
              }}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="truncate">{s.name}</span>
            </div>
          ))}
        </div>
        {rows === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs font-mono">Henüz kayıt yok.</div>
        ) : (
          <div style={{ height: rows * TABLE_ROW_H, position: 'relative' }}>
            {samples.slice(first, last).map((smp, i) => {
              const at = cursor === smp.time;
              return (
                <div
                  key={smp.time}
                  onClick={() => onCursor(smp.time)}
                  className={`grid absolute left-0 right-0 font-mono text-xs cursor-pointer border-b border-slate-900 ${
                    at ? 'bg-cyan-950/80 outline outline-1 outline-cyan-600' : 'hover:bg-slate-800/60'
                  }`}
                  style={{ gridTemplateColumns: gridCols, top: (first + i) * TABLE_ROW_H, height: TABLE_ROW_H }}
                  data-chrono-trow={smp.time}
                  title="Tıkla: diyagram imlecini bu dilime taşı"
                >
                  <div className={`px-2 flex items-center ${at ? 'text-cyan-300 font-bold' : 'text-slate-500'}`}>{smp.time}</div>
                  {signals.map((s) => {
                    const v = smp.values[s.key];
                    return (
                      <div key={s.key} className={`px-2 flex items-center truncate ${cellClass(v)}`}>
                        {chronoValueText(v, radixOf(s.key))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TreeLevel({ node, selected, toggle, depth }: { node: ChronoTreeNode; selected: Set<string>; toggle: (k: string) => void; depth: number }) {
  const [open, setOpen] = useState(depth === 0);
  const count = node.signals.filter((s) => selected.has(s.key)).length;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1 px-1 py-1 text-xs font-bold text-slate-300 hover:bg-slate-800 rounded cursor-pointer"
        style={{ paddingLeft: depth * 12 + 4 }}
        data-chrono-node={node.id}
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        <span className="truncate">{depth === 0 ? node.name : node.name.split('/').pop()}</span>
        <span className="ml-auto text-[10px] text-slate-500 font-mono">
          {count}/{node.signals.length}
        </span>
      </button>
      {open && (
        <>
          {node.signals.map((s) => (
            <label
              key={s.key}
              className="flex items-center gap-2 py-0.5 text-xs text-slate-200 hover:bg-slate-800 rounded cursor-pointer"
              style={{ paddingLeft: depth * 12 + 24 }}
            >
              <input type="checkbox" checked={selected.has(s.key)} onChange={() => toggle(s.key)} data-chrono-key={s.key} className="accent-cyan-500" />
              <span className="font-mono truncate" title={s.name}>
                {depth === 0 ? s.name : s.name.slice(node.name.length + 1)}
              </span>
            </label>
          ))}
          {node.children.map((c) => (
            <TreeLevel key={c.id} node={c} selected={selected} toggle={toggle} depth={depth + 1} />
          ))}
        </>
      )}
    </div>
  );
}

function SignalPicker({
  tree,
  signals,
  onChange,
  onClose,
}: {
  tree: ChronoTreeNode;
  signals: ChronoSignal[];
  onChange: (keys: string[] | null) => void;
  onClose: () => void;
}) {
  const keys = signals.map((s) => s.key);
  const selected = new Set(keys);
  const toggle = (k: string) => onChange(selected.has(k) ? keys.filter((x) => x !== k) : [...keys, k]);
  const btn = 'p-1 rounded text-slate-400 hover:text-white hover:bg-slate-700 disabled:opacity-30 disabled:hover:bg-transparent cursor-pointer';
  return (
    <div id="chrono-picker" className="absolute right-0 top-full mt-2 z-30 w-[640px] max-w-[90vw] bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-extrabold text-white">Sinyal Seçimi</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChange(null)}
            className="px-2 py-1 text-[11px] rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
            title="Ana devredeki tüm sinyaller, varsayılan sırayla (saat kaynağı, girişler, diğerleri)"
          >
            Varsayılana dön
          </button>
          <button type="button" onClick={onClose} className={btn} title="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-xl p-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-1 pb-1">Devre ve alt devreler</div>
          <TreeLevel node={tree} selected={selected} toggle={toggle} depth={0} />
        </div>
        <div className="max-h-72 overflow-y-auto border border-slate-800 rounded-xl p-1">
          <div className="text-[10px] uppercase tracking-wide text-slate-500 px-1 pb-1">Seçili ({signals.length}) — gösterim sırası</div>
          {signals.length === 0 && <div className="text-xs text-slate-500 p-2">Hiç sinyal seçili değil.</div>}
          {signals.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1 px-1 py-0.5 text-xs hover:bg-slate-800 rounded" data-chrono-sel={s.key}>
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
              <span className="font-mono text-slate-200 truncate flex-1" title={s.name}>
                {s.name}
              </span>
              <button type="button" className={btn} disabled={i === 0} onClick={() => onChange(moveChronoKey(keys, i, i - 1))} title="Yukarı taşı">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" className={btn} disabled={i === signals.length - 1} onClick={() => onChange(moveChronoKey(keys, i, i + 1))} title="Aşağı taşı">
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" className={btn} onClick={() => toggle(s.key)} title="Çıkar">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChronogramPanel(props: ChronogramPanelProps) {
  const { signals, samples, paused, clocks, clockKey, limit } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  // Follow the newest slot while the view is at the right end (evolution RightPanel.updateSize)
  const atEndRef = useRef(true);
  const t0 = samples.length > 0 ? samples[0].time : 0;
  const slots = samples.length;
  const [zoom, setZoom] = useState(CHRONO_ZOOM_DEFAULT);
  const tick = chronoTickWidth(zoom);
  const width = chronoWidth(slots, zoom);
  const height = RULER_H + signals.length * ROW_H;
  // time and view x to keep in place across a zoom (evolution RightPanel.zoom keeps the time under the mouse)
  const anchorRef = useRef<{ t: number; vx: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const lastValues = samples.length > 0 ? samples[samples.length - 1].values : {};
  const [pickerOpen, setPickerOpen] = useState(false);
  // tab: the waveforms or the value table (both show the same selection and history)
  const [view, setView] = useState<'wave' | 'table'>('wave');
  // right-click menu of a wide signal: its display base
  const [radixMenu, setRadixMenu] = useState<{ key: string; x: number; y: number } | null>(null);
  const radixOf = (key: string): Radix => props.radix[key] ?? '16';
  // row drag: index being dragged and the row it would drop on
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const keys = signals.map((s) => s.key);
  const hasCandidates = props.tree.signals.length > 0 || props.tree.children.length > 0;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const a = anchorRef.current;
    if (a) {
      anchorRef.current = null;
      el.scrollLeft = Math.max(0, a.t * chronoTickWidth(zoom) - a.vx);
      atEndRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    } else if (atEndRef.current) el.scrollLeft = el.scrollWidth;
  }, [slots, t0, signals.length, zoom, view]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) atEndRef.current = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
  };

  // One zoom step, keeping the time at view x `vx` (default: the middle of the view) where it is
  const zoomBy = (sens: number, vx?: number) => {
    const z = zoomRef.current;
    const nz = stepChronoZoom(z, sens, slotsRef.current);
    if (nz === z) return;
    const el = scrollRef.current;
    // several steps before the next render (fast wheel) keep the first step's anchor time
    if (el && !anchorRef.current) {
      const x = vx ?? el.clientWidth / 2;
      anchorRef.current = { t: (el.scrollLeft + x) / chronoTickWidth(z), vx: x };
    }
    zoomRef.current = nz;
    setZoom(nz);
  };
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;
  const fit = () => {
    const el = scrollRef.current;
    atEndRef.current = true;
    setZoom(fitChronoZoom(slots, el ? el.clientWidth : 800));
  };

  // Ctrl + wheel zooms at the mouse (evolution ChronoPanel); a plain wheel scrolls as usual. Not a React handler:
  // those are passive, and the page must not zoom or scroll
  const hasBody = signals.length > 0 && view === 'wave';
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomByRef.current(e.deltaY > 0 ? -1 : 1, e.clientX - el.getBoundingClientRect().left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasBody]);

  // Time ruler: a label every `step` slots (slot numbers count from the last reset), grid lines through the rows
  const step = chronoRulerStep(tick);
  const marks: number[] = [];
  for (let m = Math.ceil(t0 / step) * step; m <= t0 + slots; m += step) marks.push(m);

  // Cursor (evolution RightPanel: click or drag on the waveforms; unset = pinned at the newest slot). Kept as a slot
  // time, so zooming keeps it on the same slot; a slot dropped from the history clears it.
  const [cursorT, setCursorT] = useState<number | null>(null);
  const cur = cursorT !== null && cursorT >= t0 && cursorT < t0 + slots ? cursorT : null;
  const shownValues = cur !== null ? samples[cur - t0].values : lastValues;
  const timeAt = (e: ReactPointerEvent<SVGSVGElement>): number => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    return t0 + Math.max(0, Math.min(slots - 1, Math.floor(x / tick)));
  };
  const onCursorDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 || slots === 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setCursorT(timeAt(e));
  };
  const onCursorMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if ((e.buttons & 1) === 0 || slots === 0) return;
    const tm = timeAt(e);
    if (tm !== cursorT) setCursorT(tm);
  };
  // Esc puts the cursor back on the newest slot (live values)
  useEffect(() => {
    if (cursorT === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (e.key === 'Escape' && !(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT'))) setCursorT(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cursorT]);

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

        <div className="relative flex flex-wrap items-center gap-2">
          <button
            id="chrono-signals"
            onClick={() => setPickerOpen(!pickerOpen)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 cursor-pointer transition-colors ${
              pickerOpen ? 'bg-cyan-900 text-white border-cyan-700' : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title="İzlenecek sinyalleri seç ve sırala (alt devrelerin içindekiler dahil)"
          >
            <ListChecks className="w-3.5 h-3.5" />
            <span>Sinyaller ({signals.length})</span>
          </button>
          {pickerOpen && <SignalPicker tree={props.tree} signals={signals} onChange={props.onSelectionChange} onClose={() => setPickerOpen(false)} />}
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
          {view === 'wave' && (
          <div className="flex items-center rounded-xl border border-slate-700 bg-slate-800 overflow-hidden" id="chrono-zoom">
            <button
              type="button"
              onClick={() => zoomBy(-1)}
              disabled={zoom <= CHRONO_ZOOM_MIN}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
              title="Uzaklaştır (Ctrl + tekerlek)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="px-1.5 text-[11px] font-mono text-slate-300 min-w-[3.5rem] text-center" title="Bir zaman diliminin genişliği" id="chrono-zoom-level">
              {tick >= 10 ? Math.round(tick) : tick.toFixed(1)} px
            </span>
            <button
              type="button"
              onClick={() => zoomBy(1)}
              disabled={zoom >= CHRONO_ZOOM_MAX}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 disabled:opacity-30 cursor-pointer"
              title="Yakınlaştır (Ctrl + tekerlek)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={fit}
              className="p-1.5 text-slate-300 hover:text-white hover:bg-slate-700 border-l border-slate-700 cursor-pointer"
              title="Tüm kaydı sığdır"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>
          )}
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

      {/* Tabs (evolution LogFrame: one window, a tab per view of the shared selection) */}
      <div className="flex items-center gap-1 -mt-1" role="tablist" id="chrono-tabs">
        {(
          [
            ['wave', 'Zamanlama'],
            ['table', 'Tablo'],
          ] as const
        ).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            data-chrono-tab={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
              view === v ? 'bg-cyan-900 text-white border border-cyan-700' : 'text-slate-400 hover:text-white hover:bg-slate-800 border border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
        {view === 'table' && cur !== null && (
          <button
            type="button"
            onClick={() => setCursorT(null)}
            className="ml-auto text-[11px] text-cyan-300 hover:text-white cursor-pointer"
            title="İmleci kaldır (Esc)"
          >
            t = {cur} seçili ✕
          </button>
        )}
      </div>

      {signals.length > 0 && view === 'table' ? (
        <ChronoTable signals={signals} samples={samples} radixOf={radixOf} cursor={cur} onCursor={setCursorT} onRadixMenu={(key, x, y) => setRadixMenu({ key, x, y })} />
      ) : signals.length === 0 ? (
        <div className="p-8 text-center text-slate-500 text-xs font-mono">
          {hasCandidates
            ? 'Hiç sinyal seçili değil. "Sinyaller" düğmesinden ekleyin.'
            : 'Tuval üzerinde izlenecek giriş veya çıkış elemanı (Anahtar, Saat, LED, Prob vb.) bulunamadı.'}
        </div>
      ) : (
        <div className="flex bg-slate-950/70 rounded-2xl border border-slate-800/80 overflow-hidden" id="chrono-body">
          {/* Signal names and current values */}
          <div className="w-56 shrink-0 border-r border-slate-800">
            <div className="flex items-center justify-between px-2 text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-800" style={{ height: RULER_H }}>
              <span>Sinyal</span>
              {cur === null ? (
                <span title="Dalgaya tıklayınca o dilimdeki değerler gösterilir">Değer (canlı)</span>
              ) : (
                <button
                  type="button"
                  id="chrono-cursor-clear"
                  onClick={() => setCursorT(null)}
                  className="normal-case tracking-normal text-cyan-300 hover:text-white cursor-pointer"
                  title="İmleci kaldır, canlı değerlere dön (Esc)"
                >
                  t = {cur} · canlı ✕
                </button>
              )}
            </div>
            {signals.map((s, i) => (
              <div
                key={s.key}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', s.key);
                  setDrag({ from: i, over: i });
                }}
                onDragOver={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  if (drag.over !== i) setDrag({ ...drag, over: i });
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (drag) props.onSelectionChange(moveChronoKey(keys, drag.from, i));
                  setDrag(null);
                }}
                onDragEnd={() => setDrag(null)}
                onContextMenu={(e) => {
                  if (s.width <= 1) return;
                  e.preventDefault();
                  setRadixMenu({ key: s.key, x: e.clientX, y: e.clientY });
                }}
                title={s.width > 1 ? 'Sağ tık: sayı tabanı' : undefined}
                className={`group flex items-center justify-between gap-1 pl-1 pr-2 border-b border-slate-900 cursor-grab ${
                  drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'border-b-2 border-b-cyan-400' : 'border-t-2 border-t-cyan-400') : ''
                } ${drag?.from === i ? 'opacity-50' : ''}`}
                style={{ height: ROW_H }}
                data-chrono-row={s.key}
              >
                <div className="flex items-center gap-1.5 truncate">
                  <GripVertical className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="font-mono text-xs font-bold text-slate-200 truncate" title={s.name}>
                    {s.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => props.onSelectionChange(keys.filter((k) => k !== s.key))}
                    className="p-0.5 rounded text-slate-500 hover:text-white hover:bg-slate-700 opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                    title="Diyagramdan çıkar"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  <ValueBadge raw={shownValues[s.key]} radix={radixOf(s.key)} />
                </div>
              </div>
            ))}
          </div>

          {/* Waveforms on one shared time axis */}
          <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-x-auto" id="chrono-scroll">
            <svg
              width={width}
              height={height}
              className="block cursor-crosshair touch-none"
              id="chrono-svg"
              onPointerDown={onCursorDown}
              onPointerMove={onCursorMove}
            >
              {/* time ruler */}
              <rect x={0} y={0} width={width} height={RULER_H} fill="#0f172a" />
              <line x1={0} y1={RULER_H - 0.5} x2={width} y2={RULER_H - 0.5} stroke="#1e293b" />
              {tick >= 6 &&
                Array.from({ length: slots + 1 }).map((_, i) => (
                  <line key={`m${i}`} x1={i * tick} y1={RULER_H - 4} x2={i * tick} y2={RULER_H} stroke="#334155" />
                ))}
              {marks.map((m) => {
                const x = (m - t0) * tick;
                return (
                  <g key={`r${m}`}>
                    <line x1={x} y1={RULER_H - 9} x2={x} y2={height} stroke="#1e293b" strokeWidth={1} />
                    <text x={x + 3} y={11} className="text-[10px] font-mono fill-slate-400 select-none" data-chrono-mark={m}>
                      {m}
                    </text>
                  </g>
                );
              })}
              {signals.map((s, r) => (
                <g key={s.key} transform={`translate(0 ${RULER_H + r * ROW_H})`}>
                  {s.width === 1 && <line x1={0} y1={Y_LOW} x2={width} y2={Y_LOW} stroke="#334155" strokeWidth={1} />}
                  <SignalTrace signal={s} samples={samples} t0={t0} tick={tick} radix={radixOf(s.key)} />
                </g>
              ))}
              {/* cursor: the slot band, a line through its middle and its time on the ruler */}
              {cur !== null && (
                <g pointerEvents="none" id="chrono-cursor" data-t={cur}>
                  <rect x={(cur - t0) * tick} y={RULER_H} width={tick} height={height - RULER_H} fill="#22d3ee" opacity={0.1} />
                  <line x1={(cur - t0 + 0.5) * tick} y1={0} x2={(cur - t0 + 0.5) * tick} y2={height} stroke="#22d3ee" strokeWidth={1.5} />
                  <rect x={(cur - t0 + 0.5) * tick - 18} y={2} width={36} height={RULER_H - 6} rx={4} fill="#0e7490" />
                  <text x={(cur - t0 + 0.5) * tick} y={RULER_H - 8} textAnchor="middle" className="text-[10px] font-mono font-bold fill-white select-none">
                    {cur}
                  </text>
                </g>
              )}
            </svg>
          </div>
        </div>
      )}

      {radixMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setRadixMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setRadixMenu(null);
            }}
          />
          <div
            id="chrono-radix-menu"
            className="fixed z-50 w-48 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 text-xs"
            style={{ left: Math.min(radixMenu.x, window.innerWidth - 200), top: Math.min(radixMenu.y, window.innerHeight - 210) }}
          >
            <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-slate-500">Sayı tabanı</div>
            {RADIX_OPTIONS.map(([r, label]) => (
              <button
                key={r}
                type="button"
                data-radix={r}
                onClick={() => {
                  props.onRadixChange(radixMenu.key, r);
                  setRadixMenu(null);
                }}
                className={`w-full text-left px-3 py-1.5 cursor-pointer hover:bg-slate-800 ${radixOf(radixMenu.key) === r ? 'text-cyan-300 font-bold' : 'text-slate-200'}`}
              >
                {radixOf(radixMenu.key) === r ? '● ' : ''}
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
