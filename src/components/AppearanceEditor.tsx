import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Anchor,
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Circle,
  Image as ImageIcon,
  Magnet,
  Minus,
  MousePointer2,
  Pentagon,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  Spline,
  Square,
  Trash2,
  Type,
  Undo2,
  Waypoints,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { AppearanceDynamicShape, AppearanceShape, CustomSubcircuit, SubcircuitAppearance } from '../types/circuit';
import { AppearanceShapeSvg } from './AppearanceShapes';
import { shapesBounds } from '../utils/subcircuitAppearance';
import { resolveDynamicTemplate } from '../utils/dynamicElements';
import {
  editorStartShapes,
  hitShape,
  moveHandle,
  portsOnTop,
  reorder,
  resetShapes,
  shapeBox,
  shapeHandles,
  translateShape,
} from '../utils/appearanceEdit';

/**
 * Modal appearance editor for one subcircuit, after Logisim-evolution's appearance view: the draw tools (text,
 * image, line, curve, polyline, rectangle, rounded rectangle, oval, polygon), the select tool (move, resize by
 * handles, rubber band), the shape attributes (paint type, stroke width and colour, fill colour, corner radius,
 * font, alignment), drawing order, the two reset buttons, and the ports and the anchor, which can only be moved
 * (the anchor also turned) and always stay above the drawing. Everything snaps to evolution's 10px grid (Alt
 * held = free).
 */

type Pt = { x: number; y: number };
type Tool = 'select' | 'text' | 'image' | 'line' | 'curve' | 'polyline' | 'rect' | 'rrect' | 'oval' | 'polygon';

const TOOLS: Array<{ id: Tool; label: string; icon: React.ReactNode }> = [
  { id: 'select', label: 'Seç / taşı', icon: <MousePointer2 className="w-4 h-4" /> },
  { id: 'text', label: 'Metin', icon: <Type className="w-4 h-4" /> },
  { id: 'image', label: 'Resim', icon: <ImageIcon className="w-4 h-4" /> },
  { id: 'line', label: 'Çizgi', icon: <Minus className="w-4 h-4" /> },
  { id: 'curve', label: 'Eğri (sürükle, sonra kontrol noktası için tıkla)', icon: <Spline className="w-4 h-4" /> },
  { id: 'polyline', label: 'Çoklu çizgi (tıklayarak köşe ekle, çift tık / Enter bitirir)', icon: <Waypoints className="w-4 h-4" /> },
  { id: 'rect', label: 'Dikdörtgen', icon: <Square className="w-4 h-4" /> },
  { id: 'rrect', label: 'Yuvarlak köşeli dikdörtgen', icon: <RectangleHorizontal className="w-4 h-4" /> },
  { id: 'oval', label: 'Elips', icon: <Circle className="w-4 h-4" /> },
  { id: 'polygon', label: 'Çokgen (tıklayarak köşe ekle, çift tık / Enter bitirir)', icon: <Pentagon className="w-4 h-4" /> },
];

const FONT_FAMILIES = ['SansSerif', 'Serif', 'Monospaced', 'Dialog', 'DialogInput', 'Courier 10 Pitch'];
const isElement = (s: AppearanceShape) => s.kind === 'port' || s.kind === 'anchor';

type Drag =
  | { mode: 'move'; start: Pt; base: AppearanceShape[]; moved: boolean }
  | { mode: 'handle'; index: number; handle: number; base: AppearanceShape }
  | { mode: 'band'; start: Pt; now: Pt; additive: boolean; before: Set<number> }
  | { mode: 'box'; index: number; start: Pt }
  | { mode: 'line'; index: number }
  | { mode: 'curveEnds'; index: number };

export interface AppearanceEditorProps {
  def: CustomSubcircuit;
  dark: boolean;
  onSave: (appearance: SubcircuitAppearance) => void;
  onClose: () => void;
}

export default function AppearanceEditor({ def, dark, onSave, onClose }: AppearanceEditorProps): React.ReactElement {
  const [shapes, setShapes] = useState<AppearanceShape[]>(() => portsOnTop(editorStartShapes(def)));
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<Tool>('select');
  const [zoom, setZoom] = useState(3);
  const [snapOn, setSnapOn] = useState(true);
  const [showPortNames, setShowPortNames] = useState(true);
  const [undo, setUndo] = useState<AppearanceShape[][]>([]);
  const [redo, setRedo] = useState<AppearanceShape[][]>([]);
  // A curve waiting for its control point, a polyline / polygon being clicked out
  const [pendingCurve, setPendingCurve] = useState<number | null>(null);
  const [pendingPoly, setPendingPoly] = useState<{ index: number; cursor: Pt } | null>(null);
  const [cursor, setCursor] = useState<Pt | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const [band, setBand] = useState<{ a: Pt; b: Pt } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageAtRef = useRef<Pt>({ x: 0, y: 0 });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  // Drawing area: the drawing plus a margin, grown (never shrunk) so the view doesn't jump while editing
  const [view, setView] = useState(() => {
    const b = shapesBounds(shapes);
    return { x: Math.floor((b.minX - 80) / 10) * 10, y: Math.floor((b.minY - 60) / 10) * 10, w: Math.max(360, Math.ceil((b.maxX - b.minX + 160) / 10) * 10), h: Math.max(240, Math.ceil((b.maxY - b.minY + 120) / 10) * 10) };
  });
  const growView = useCallback((list: AppearanceShape[]) => {
    const b = shapesBounds(list);
    setView((v) => {
      const x = Math.min(v.x, Math.floor((b.minX - 40) / 10) * 10);
      const y = Math.min(v.y, Math.floor((b.minY - 40) / 10) * 10);
      const r = Math.max(v.x + v.w, Math.ceil((b.maxX + 40) / 10) * 10);
      const bt = Math.max(v.y + v.h, Math.ceil((b.maxY + 40) / 10) * 10);
      return x === v.x && y === v.y && r === v.x + v.w && bt === v.y + v.h ? v : { x, y, w: r - x, h: bt - y };
    });
  }, []);

  const portName = useMemo(() => new Map(def.ports.map((p) => [p.id, p])), [def]);
  // Dynamic elements are drawn as without a simulation (evolution's editor paints them with no state)
  const editorDyn = useCallback((s: AppearanceDynamicShape) => ({ target: resolveDynamicTemplate(def, s.path), live: null }), [def]);

  /** One undo step: remember the drawing as it is now */
  const remember = useCallback(() => {
    setUndo((u) => [...u.slice(-60), shapesRef.current]);
    setRedo([]);
  }, []);
  const commit = useCallback(
    (next: AppearanceShape[], nextSel?: Set<number>) => {
      remember();
      setShapes(next);
      if (nextSel) setSel(nextSel);
      growView(next);
    },
    [remember, growView]
  );

  const snap = (v: number, free: boolean) => (snapOn && !free ? Math.round(v / 10) * 10 : Math.round(v));
  const snapPt = (p: Pt, free: boolean): Pt => ({ x: snap(p.x, free), y: snap(p.y, free) });
  const toDrawing = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };
  const tol = 4 / zoom;

  /** Topmost shape under the point (ports and the anchor first, they are drawn last) */
  const pick = (p: Pt): number => {
    for (let i = shapes.length - 1; i >= 0; i--) if (hitShape(shapes[i], p, tol)) return i;
    return -1;
  };
  const pickHandle = (p: Pt): { index: number; handle: number } | null => {
    if (sel.size !== 1) return null;
    const index = [...sel][0];
    const s = shapes[index];
    if (!s || isElement(s)) return null;
    const hs = shapeHandles(s);
    for (let h = 0; h < hs.length; h++) if (Math.abs(hs[h].x - p.x) <= 5 / zoom + 1 && Math.abs(hs[h].y - p.y) <= 5 / zoom + 1) return { index, handle: h };
    return null;
  };

  const finishPoly = useCallback(() => {
    if (!pendingPoly) return;
    const s = shapesRef.current[pendingPoly.index];
    const need = s && s.kind === 'poly' && s.closed ? 3 : 2;
    if (!s || s.kind !== 'poly' || s.points.length < need) {
      setShapes((list) => list.filter((_, i) => i !== pendingPoly.index));
      setSel(new Set());
    } else setSel(new Set([pendingPoly.index]));
    setPendingPoly(null);
  }, [pendingPoly]);

  const cancelPending = useCallback(() => {
    if (pendingPoly) {
      setShapes((list) => list.filter((_, i) => i !== pendingPoly.index));
      setPendingPoly(null);
      setSel(new Set());
      setUndo((u) => u.slice(0, -1));
      return true;
    }
    if (pendingCurve !== null) {
      setPendingCurve(null);
      setSel(new Set([pendingCurve]));
      return true;
    }
    return false;
  }, [pendingPoly, pendingCurve]);

  /** A new drawing shape goes on top of the drawing, under the ports */
  const insertShape = (s: AppearanceShape): { list: AppearanceShape[]; index: number } => {
    const nDraw = shapes.filter((q) => !isElement(q)).length;
    const list = [...shapes.slice(0, nDraw), s, ...shapes.slice(nDraw)];
    return { list, index: nDraw };
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const raw = toDrawing(e);
    const p = snapPt(raw, e.altKey);
    if (pendingCurve !== null) {
      // second click of the curve tool: the control point is set, done
      setPendingCurve(null);
      setSel(new Set([pendingCurve]));
      return;
    }
    if (tool === 'polyline' || tool === 'polygon') {
      if (pendingPoly) {
        const s = shapes[pendingPoly.index];
        if (s.kind !== 'poly') return;
        const first = s.points[0];
        // clicking the first point again closes the shape
        if (s.points.length >= 2 && first.x === p.x && first.y === p.y) {
          finishPoly();
          return;
        }
        const last = s.points[s.points.length - 1];
        if (last.x === p.x && last.y === p.y) return;
        setShapes(shapes.map((q, i) => (i === pendingPoly.index && q.kind === 'poly' ? { ...q, points: [...q.points, p] } : q)));
        return;
      }
      const { list, index } = insertShape({ kind: 'poly', closed: tool === 'polygon', points: [p] });
      commit(list, new Set([index]));
      setPendingPoly({ index, cursor: p });
      return;
    }
    if (tool === 'text') {
      const { list, index } = insertShape({ kind: 'text', x: p.x, y: p.y, text: 'Metin', fontFamily: 'SansSerif', fontSize: 12, halign: 'center', valign: 'baseline' });
      commit(list, new Set([index]));
      setTool('select');
      setTimeout(() => {
        textRef.current?.focus();
        textRef.current?.select();
      }, 0);
      return;
    }
    if (tool === 'image') {
      imageAtRef.current = p;
      fileRef.current?.click();
      return;
    }
    if (tool === 'rect' || tool === 'rrect' || tool === 'oval') {
      const base = { x: p.x, y: p.y, width: 0, height: 0 };
      const s: AppearanceShape = tool === 'oval' ? { kind: 'oval', ...base } : tool === 'rrect' ? { kind: 'rect', ...base, rx: 10 } : { kind: 'rect', ...base };
      const { list, index } = insertShape(s);
      commit(list, new Set([index]));
      dragRef.current = { mode: 'box', index, start: p };
      return;
    }
    if (tool === 'line') {
      const { list, index } = insertShape({ kind: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y });
      commit(list, new Set([index]));
      dragRef.current = { mode: 'line', index };
      return;
    }
    if (tool === 'curve') {
      const { list, index } = insertShape({ kind: 'curve', x0: p.x, y0: p.y, x1: p.x, y1: p.y, cx: p.x, cy: p.y });
      commit(list, new Set([index]));
      dragRef.current = { mode: 'curveEnds', index };
      return;
    }
    // select tool
    const h = pickHandle(raw);
    if (h) {
      remember();
      dragRef.current = { mode: 'handle', index: h.index, handle: h.handle, base: shapes[h.index] };
      return;
    }
    const hit = pick(raw);
    if (hit >= 0) {
      let next = sel;
      if (e.shiftKey) {
        next = new Set(sel);
        if (next.has(hit)) next.delete(hit);
        else next.add(hit);
        setSel(next);
        if (!next.has(hit)) return;
      } else if (!sel.has(hit)) {
        next = new Set([hit]);
        setSel(next);
      }
      dragRef.current = { mode: 'move', start: raw, base: shapes, moved: false };
      return;
    }
    const before = e.shiftKey ? new Set(sel) : new Set<number>();
    if (!e.shiftKey) setSel(new Set());
    dragRef.current = { mode: 'band', start: raw, now: raw, additive: e.shiftKey, before };
    setBand({ a: raw, b: raw });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const raw = toDrawing(e);
    const p = snapPt(raw, e.altKey);
    setCursor(p);
    if (pendingPoly) setPendingPoly({ ...pendingPoly, cursor: p });
    if (pendingCurve !== null) {
      setShapes((list) => list.map((s, i) => (i === pendingCurve && s.kind === 'curve' ? { ...s, cx: p.x, cy: p.y } : s)));
      return;
    }
    const d = dragRef.current;
    if (!d) return;
    if (d.mode === 'box') {
      setShapes((list) => list.map((s, i) => (i === d.index ? moveHandle({ ...(s as Extract<AppearanceShape, { kind: 'rect' }>), x: d.start.x, y: d.start.y, width: 0, height: 0 }, 2, p, e.shiftKey) : s)));
    } else if (d.mode === 'line') {
      setShapes((list) => list.map((s, i) => (i === d.index && s.kind === 'line' ? lineEnd(s, p, e.shiftKey) : s)));
    } else if (d.mode === 'curveEnds') {
      setShapes((list) => list.map((s, i) => (i === d.index && s.kind === 'curve' ? { ...s, x1: p.x, y1: p.y, cx: Math.round((s.x0 + p.x) / 2), cy: Math.round((s.y0 + p.y) / 2) } : s)));
    } else if (d.mode === 'handle') {
      setShapes((list) => list.map((s, i) => (i === d.index ? moveHandle(d.base, d.handle, p, e.shiftKey) : s)));
    } else if (d.mode === 'move') {
      const dx = snap(raw.x - d.start.x, e.altKey);
      const dy = snap(raw.y - d.start.y, e.altKey);
      if (!d.moved && dx === 0 && dy === 0) return;
      if (!d.moved) {
        remember();
        d.moved = true;
      }
      setShapes(d.base.map((s, i) => (sel.has(i) ? translateShape(s, dx, dy) : s)));
    } else if (d.mode === 'band') {
      d.now = raw;
      setBand({ a: d.start, b: raw });
      const minX = Math.min(d.start.x, raw.x);
      const maxX = Math.max(d.start.x, raw.x);
      const minY = Math.min(d.start.y, raw.y);
      const maxY = Math.max(d.start.y, raw.y);
      const next = new Set(d.before);
      shapes.forEach((s, i) => {
        const b = shapeBox(s);
        if (b.minX >= minX && b.maxX <= maxX && b.minY >= minY && b.maxY <= maxY) next.add(i);
      });
      setSel(next);
    }
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setBand(null);
    if (!d) return;
    if (d.mode === 'box' || d.mode === 'line') {
      // a click without dragging makes nothing (evolution needs a drag too)
      const s = shapesRef.current[d.index];
      const empty = s && (s.kind === 'line' ? s.x1 === s.x2 && s.y1 === s.y2 : (s.kind === 'rect' || s.kind === 'oval') && (s.width === 0 || s.height === 0));
      if (empty) {
        setShapes((list) => list.filter((_, i) => i !== d.index));
        setUndo((u) => u.slice(0, -1));
        setSel(new Set());
      } else growView(shapesRef.current);
    } else if (d.mode === 'curveEnds') {
      const s = shapesRef.current[d.index];
      if (s && s.kind === 'curve' && s.x0 === s.x1 && s.y0 === s.y1) {
        setShapes((list) => list.filter((_, i) => i !== d.index));
        setUndo((u) => u.slice(0, -1));
        setSel(new Set());
      } else setPendingCurve(d.index);
    } else if (d.mode === 'move' || d.mode === 'handle') growView(shapesRef.current);
  };

  const onDoubleClick = () => {
    if (pendingPoly) finishPoly();
  };

  const deleteSelected = useCallback(() => {
    const removable = [...sel].filter((i) => shapes[i] && !isElement(shapes[i]));
    if (!removable.length) return;
    const drop = new Set(removable);
    commit(
      shapes.filter((_, i) => !drop.has(i)),
      new Set()
    );
  }, [sel, shapes, commit]);

  const doUndo = useCallback(() => {
    if (!undo.length) return;
    setRedo((r) => [...r, shapesRef.current]);
    setShapes(undo[undo.length - 1]);
    setUndo(undo.slice(0, -1));
    setSel(new Set());
  }, [undo]);
  const doRedo = useCallback(() => {
    if (!redo.length) return;
    setUndo((u) => [...u, shapesRef.current]);
    setShapes(redo[redo.length - 1]);
    setRedo(redo.slice(0, -1));
    setSel(new Set());
  }, [redo]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (!sel.size) return;
      commit(shapes.map((s, i) => (sel.has(i) ? translateShape(s, dx, dy) : s)));
    },
    [sel, shapes, commit]
  );

  // Keys while the editor is open; they never reach the circuit canvas behind it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) {
        if (e.key === 'Escape') (t as HTMLElement).blur();
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        doRedo();
      } else if (ctrl && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setSel(new Set(shapesRef.current.map((_, i) => i)));
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelected();
      } else if (e.key === 'Enter') {
        if (pendingPoly) {
          e.preventDefault();
          finishPoly();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (!cancelPending()) {
          if (tool !== 'select') setTool('select');
          else setSel(new Set());
        }
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.altKey || !snapOn ? 1 : 10;
        nudge(e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [doUndo, doRedo, deleteSelected, pendingPoly, finishPoly, cancelPending, tool, snapOn, nudge]);

  const chooseTool = (t: Tool) => {
    cancelPending();
    setTool(t);
    if (t !== 'select') setSel(new Set());
  };

  const onImageFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const img = new window.Image();
      img.onload = () => {
        let w = img.naturalWidth || 40;
        let h = img.naturalHeight || 40;
        const k = Math.min(1, 100 / Math.max(w, h));
        w = Math.max(10, Math.round((w * k) / 10) * 10);
        h = Math.max(10, Math.round((h * k) / 10) * 10);
        const at = imageAtRef.current;
        const target = [...sel].find((i) => shapesRef.current[i]?.kind === 'image');
        if (target !== undefined && tool === 'select') {
          commit(shapesRef.current.map((s, i) => (i === target && s.kind === 'image' ? { ...s, src } : s)));
          return;
        }
        const list = shapesRef.current;
        const nDraw = list.filter((q) => !isElement(q)).length;
        commit([...list.slice(0, nDraw), { kind: 'image', x: at.x, y: at.y, width: w, height: h, src }, ...list.slice(nDraw)], new Set([nDraw]));
        setTool('select');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  // ---- Attribute panel: the attributes every selected shape that has them shares
  const selShapes = [...sel].map((i) => shapes[i]).filter(Boolean);
  const drawSel: AppearanceShape[] = selShapes.filter((s) => !isElement(s));
  const patchSelected = (patch: (s: AppearanceShape) => AppearanceShape | null) => {
    let changed = false;
    const next = shapes.map((s, i) => {
      if (!sel.has(i)) return s;
      const n = patch(s);
      if (!n || n === s) return s;
      changed = true;
      return n;
    });
    if (changed) commit(next);
  };
  const common = <T,>(get: (s: AppearanceShape) => T | undefined, list: AppearanceShape[] = drawSel): T | undefined => {
    const vals = list.map(get).filter((v) => v !== undefined) as T[];
    return vals.length && vals.every((v) => v === vals[0]) ? vals[0] : undefined;
  };
  const fillable: AppearanceShape[] = drawSel.filter((s) => s.kind === 'rect' || s.kind === 'oval' || s.kind === 'poly' || s.kind === 'curve');
  const paintOf = (s: AppearanceShape) => (s as { paint?: 'stroke' | 'fill' | 'both' }).paint ?? 'stroke';
  const stroked: AppearanceShape[] = drawSel.filter((s) => s.kind === 'line' || (fillable.includes(s) && paintOf(s) !== 'fill'));
  const filled: AppearanceShape[] = fillable.filter((s) => paintOf(s) !== 'stroke');
  const texts = drawSel.filter((s): s is Extract<AppearanceShape, { kind: 'text' }> => s.kind === 'text');
  const rrects = drawSel.filter((s): s is Extract<AppearanceShape, { kind: 'rect' }> => s.kind === 'rect' && s.rx !== undefined);
  const images = drawSel.filter((s) => s.kind === 'image');
  const anchorSel = selShapes.find((s): s is Extract<AppearanceShape, { kind: 'anchor' }> => s.kind === 'anchor');
  const portSel = selShapes.filter((s): s is Extract<AppearanceShape, { kind: 'port' }> => s.kind === 'port');

  const colorValue = (c: string | undefined, fallback: string) => (c ?? fallback).slice(0, 7);
  const withAlpha = (old: string | undefined, rgb: string) => (old && old.length === 9 ? rgb + old.slice(7) : rgb);

  const panel = dark ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800';
  const field = `text-[11px] rounded-md px-1.5 py-1 border outline-none ${dark ? 'bg-slate-800 text-slate-200 border-slate-600 focus:border-blue-500' : 'bg-white text-slate-800 border-slate-300 focus:border-blue-500'}`;
  const label = `text-[11px] font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`;
  const btn = (on = false, disabled = false) =>
    `p-1.5 rounded-md transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${
      on ? 'bg-blue-600 text-white' : dark ? 'text-slate-300 hover:bg-slate-700' : 'text-slate-600 hover:bg-slate-100'
    }`;
  const textBtn = `px-2 py-1 rounded-md text-[11px] font-semibold cursor-pointer transition-colors ${dark ? 'bg-slate-800 hover:bg-slate-700 text-slate-200' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'}`;

  const handleSize = 6 / zoom;
  const portStroke = dark ? '#93c5fd' : '#2563eb';

  const reset = (kind: 'custom' | 'logisim_evolution' | 'classic' | 'evolution') => {
    cancelPending();
    commit(portsOnTop(resetShapes(def, kind)), new Set());
  };

  const save = () => {
    cancelPending();
    onSave({ ...def.appearance, style: 'custom', shapes: portsOnTop(shapesRef.current) });
  };

  const cursorText = cursor ? `${cursor.x}, ${cursor.y}` : '';

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-sm p-3" onMouseDown={(e) => e.stopPropagation()}>
      <div className={`w-full max-w-6xl h-[88vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden ${panel}`} role="dialog" aria-label="Görünüm düzenleyici">
        {/* Title */}
        <div className={`flex items-center gap-3 px-4 py-2.5 border-b ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <span className="font-extrabold text-sm">Görünüm Düzenleyici</span>
          <span className={`text-xs truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            {def.name} {def.chipCode ? `· ${def.chipCode}` : ''}
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className={btn()} title="Kapat (kaydetmeden)">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toolbar */}
        <div className={`flex flex-wrap items-center gap-1 px-3 py-1.5 border-b ${dark ? 'border-slate-700' : 'border-slate-200'}`} id="appear-toolbar">
          {TOOLS.map((t) => (
            <button key={t.id} data-tool={t.id} onClick={() => chooseTool(t.id)} className={btn(tool === t.id)} title={t.label}>
              {t.icon}
            </button>
          ))}
          <span className={`w-px h-5 mx-1 ${dark ? 'bg-slate-700' : 'bg-slate-200'}`} />
          <button onClick={doUndo} className={btn(false, !undo.length)} title="Geri al (Ctrl+Z)" disabled={!undo.length}>
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={doRedo} className={btn(false, !redo.length)} title="Yinele (Ctrl+Y)" disabled={!redo.length}>
            <Redo2 className="w-4 h-4" />
          </button>
          <button onClick={deleteSelected} className={btn(false, !drawSel.length)} title="Seçilen şekilleri sil (Delete); portlar ve çapa silinmez" disabled={!drawSel.length}>
            <Trash2 className="w-4 h-4" />
          </button>
          <span className={`w-px h-5 mx-1 ${dark ? 'bg-slate-700' : 'bg-slate-200'}`} />
          {(
            [
              ['top', 'En üste', <ChevronsUp className="w-4 h-4" />],
              ['up', 'Bir yukarı', <ArrowUp className="w-4 h-4" />],
              ['down', 'Bir aşağı', <ArrowDown className="w-4 h-4" />],
              ['bottom', 'En alta', <ChevronsDown className="w-4 h-4" />],
            ] as const
          ).map(([how, title, icon]) => (
            <button
              key={how}
              onClick={() => {
                const r = reorder(shapes, sel, how);
                commit(r.list, r.selected);
              }}
              className={btn(false, !drawSel.length)}
              disabled={!drawSel.length}
              title={`${title} (portlar ve çapa her zaman en üstte kalır)`}
            >
              {icon}
            </button>
          ))}
          <span className={`w-px h-5 mx-1 ${dark ? 'bg-slate-700' : 'bg-slate-200'}`} />
          <button onClick={() => setSnapOn((v) => !v)} className={btn(snapOn)} title="Izgaraya yasla (10 px); Alt basılıyken serbest">
            <Magnet className="w-4 h-4" />
          </button>
          <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className={btn()} title="Uzaklaş">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button onClick={() => setZoom((z) => Math.min(8, z + 0.5))} className={btn()} title="Yakınlaş">
            <ZoomIn className="w-4 h-4" />
          </button>
          <label className="flex items-center gap-1 text-[11px] ml-2 cursor-pointer select-none">
            <input type="checkbox" checked={showPortNames} onChange={(e) => setShowPortNames(e.target.checked)} />
            Port adları
          </label>
          <div className="flex-1" />
          <span className={`text-[11px] font-mono ${dark ? 'text-slate-500' : 'text-slate-400'}`}>{cursorText}</span>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Canvas */}
          <div className={`flex-1 overflow-auto ${dark ? 'bg-slate-950' : 'bg-slate-100'}`}>
            <svg
              ref={svgRef}
              id="appear-canvas"
              width={view.w * zoom}
              height={view.h * zoom}
              viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
              className={tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}
              style={{ display: 'block', touchAction: 'none' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onDoubleClick={onDoubleClick}
              onPointerLeave={() => setCursor(null)}
            >
              <defs>
                <pattern id="appearGrid" x={0} y={0} width={10} height={10} patternUnits="userSpaceOnUse">
                  <circle cx={0} cy={0} r={0.6} fill={dark ? '#334155' : '#94a3b8'} />
                </pattern>
              </defs>
              <rect x={view.x} y={view.y} width={view.w} height={view.h} fill={dark ? '#0b1120' : '#ffffff'} />
              {snapOn && <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#appearGrid)" />}
              {shapes.map((s, i) =>
                isElement(s) ? null : (
                  <g key={i} data-shape={i}>
                    <AppearanceShapeSvg shape={s} dark={dark} dyn={editorDyn} />
                  </g>
                )
              )}
              {/* the polyline / polygon being drawn: rubber segment to the cursor */}
              {pendingPoly &&
                (() => {
                  const s = shapes[pendingPoly.index];
                  if (!s || s.kind !== 'poly' || !s.points.length) return null;
                  const last = s.points[s.points.length - 1];
                  return <line x1={last.x} y1={last.y} x2={pendingPoly.cursor.x} y2={pendingPoly.cursor.y} stroke="#3b82f6" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom},${2 / zoom}`} />;
                })()}
              {/* ports and the anchor, above the drawing */}
              {shapes.map((s, i) => {
                if (s.kind === 'port') {
                  const p = portName.get(s.portId);
                  const input = p?.type !== 'output';
                  const on = sel.has(i);
                  return (
                    <g key={`p${i}`} data-port={s.portId}>
                      <title>{`${input ? 'Giriş' : 'Çıkış'} portu: ${p?.name ?? s.portId}`}</title>
                      {input ? (
                        <rect x={s.x - 4} y={s.y - 4} width={8} height={8} fill={on ? '#3b82f6' : 'none'} fillOpacity={0.35} stroke={portStroke} strokeWidth={1} />
                      ) : (
                        <circle cx={s.x} cy={s.y} r={5} fill={on ? '#3b82f6' : 'none'} fillOpacity={0.35} stroke={portStroke} strokeWidth={1} />
                      )}
                      {showPortNames && p && (
                        <text x={s.x + (input ? -7 : 7)} y={s.y + 2} textAnchor={input ? 'end' : 'start'} fontSize={6} fill={portStroke} className="select-none pointer-events-none">
                          {p.name}
                        </text>
                      )}
                    </g>
                  );
                }
                if (s.kind === 'anchor') {
                  const on = sel.has(i);
                  const d = { east: [1, 0], west: [-1, 0], north: [0, -1], south: [0, 1] }[s.facing];
                  return (
                    <g key={`a${i}`} data-anchor="1">
                      <title>{`Çapa (yerleşim noktası), yön: ${s.facing}`}</title>
                      <circle cx={s.x} cy={s.y} r={3} fill={on ? '#f59e0b' : 'none'} stroke="#d97706" strokeWidth={1} />
                      <line x1={s.x + d[0] * 3} y1={s.y + d[1] * 3} x2={s.x + d[0] * 9} y2={s.y + d[1] * 9} stroke="#d97706" strokeWidth={1} />
                    </g>
                  );
                }
                return null;
              })}
              {/* selection: dashed boxes, handles of a single shape */}
              {[...sel].map((i) => {
                const s = shapes[i];
                if (!s || isElement(s)) return null;
                const b = shapeBox(s);
                return (
                  <rect key={`s${i}`} x={b.minX - 2 / zoom} y={b.minY - 2 / zoom} width={b.maxX - b.minX + 4 / zoom} height={b.maxY - b.minY + 4 / zoom} fill="none" stroke="#3b82f6" strokeWidth={1 / zoom} strokeDasharray={`${3 / zoom},${2 / zoom}`} pointerEvents="none" />
                );
              })}
              {sel.size === 1 &&
                (() => {
                  const s = shapes[[...sel][0]];
                  if (!s || isElement(s)) return null;
                  return shapeHandles(s).map((h, k) => (
                    <rect key={`h${k}`} x={h.x - handleSize / 2} y={h.y - handleSize / 2} width={handleSize} height={handleSize} fill="#ffffff" stroke="#3b82f6" strokeWidth={1 / zoom} pointerEvents="none" />
                  ));
                })()}
              {band && (
                <rect
                  x={Math.min(band.a.x, band.b.x)}
                  y={Math.min(band.a.y, band.b.y)}
                  width={Math.abs(band.b.x - band.a.x)}
                  height={Math.abs(band.b.y - band.a.y)}
                  fill="#3b82f6"
                  fillOpacity={0.08}
                  stroke="#3b82f6"
                  strokeWidth={1 / zoom}
                  pointerEvents="none"
                />
              )}
            </svg>
          </div>

          {/* Attribute panel */}
          <div className={`w-64 shrink-0 border-l overflow-y-auto p-3 space-y-3 text-xs ${dark ? 'border-slate-700' : 'border-slate-200'}`} id="appear-attrs">
            {selShapes.length === 0 && (
              <div className="space-y-2">
                <p className={label}>Bir şekil seçin ya da soldaki araçlarla çizin.</p>
                <p className={`text-[11px] leading-relaxed ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Kare = giriş portu, daire = çıkış portu, turuncu = çapa (parçanın yerleşim noktası ve varsayılan yönü). Portlar ve çapa yalnızca taşınabilir.
                </p>
              </div>
            )}

            {portSel.length > 0 && (
              <div className="space-y-1">
                <span className={label}>Port</span>
                {portSel.map((s) => {
                  const p = portName.get(s.portId);
                  return (
                    <div key={s.portId} className="font-mono text-[11px]">
                      {p?.type === 'output' ? 'Çıkış' : 'Giriş'} · {p?.name ?? s.portId} {(p?.width ?? 1) > 1 ? `[${p?.width}]` : ''} · ({s.x}, {s.y})
                    </div>
                  );
                })}
              </div>
            )}

            {anchorSel && (
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <span className={label}>
                  <Anchor className="w-3 h-3 inline mr-1" />
                  Çapa yönü
                </span>
                <select
                  className={field}
                  value={anchorSel.facing}
                  onChange={(e) => patchSelected((s) => (s.kind === 'anchor' ? { ...s, facing: e.target.value as typeof s.facing } : null))}
                  title="Parçanın varsayılan yönü: örnekler bu yöne göre döner"
                >
                  <option value="east">Doğu</option>
                  <option value="south">Güney</option>
                  <option value="west">Batı</option>
                  <option value="north">Kuzey</option>
                </select>
              </div>
            )}

            {fillable.length > 0 && (
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <span className={label}>Boyama</span>
                <select
                  className={field}
                  value={common((s) => paintOf(s), fillable) ?? ''}
                  onChange={(e) => patchSelected((s) => (fillable.includes(s) ? ({ ...s, paint: e.target.value as 'stroke' | 'fill' | 'both' } as AppearanceShape) : null))}
                >
                  {common((s) => paintOf(s), fillable) === undefined && <option value="" disabled>—</option>}
                  <option value="stroke">Kontur</option>
                  <option value="fill">Dolgu</option>
                  <option value="both">Kontur + dolgu</option>
                </select>
              </div>
            )}

            {stroked.length > 0 && (
              <>
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Kalınlık</span>
                  <select
                    className={field}
                    value={common((s) => ('strokeWidth' in s ? s.strokeWidth ?? 1 : 1), stroked) ?? ''}
                    onChange={(e) => patchSelected((s) => (stroked.includes(s) ? ({ ...s, strokeWidth: Number(e.target.value) } as AppearanceShape) : null))}
                  >
                    {common((s) => ('strokeWidth' in s ? s.strokeWidth ?? 1 : 1), stroked) === undefined && <option value="" disabled>—</option>}
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Kontur rengi</span>
                  <input
                    type="color"
                    className="w-full h-6 rounded cursor-pointer"
                    value={colorValue(common((s) => ('stroke' in s ? s.stroke ?? '#000000' : undefined), stroked), '#000000')}
                    onChange={(e) => patchSelected((s) => (stroked.includes(s) && 'stroke' in s ? ({ ...s, stroke: withAlpha(s.stroke, e.target.value) } as AppearanceShape) : stroked.includes(s) ? ({ ...s, stroke: e.target.value } as AppearanceShape) : null))}
                  />
                </div>
              </>
            )}

            {filled.length > 0 && (
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <span className={label}>Dolgu rengi</span>
                <input
                  type="color"
                  className="w-full h-6 rounded cursor-pointer"
                  value={colorValue(common((s) => ('fill' in s ? (s as { fill?: string }).fill ?? '#ffffff' : undefined), filled), '#ffffff')}
                  onChange={(e) => patchSelected((s) => (filled.includes(s) ? ({ ...s, fill: withAlpha((s as { fill?: string }).fill, e.target.value) } as AppearanceShape) : null))}
                />
              </div>
            )}

            {rrects.length > 0 && (
              <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                <span className={label}>Köşe yarıçapı</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  className={field}
                  key={`rx${[...sel].join(',')}:${common((s) => (s.kind === 'rect' ? s.rx : undefined), rrects)}`}
                  defaultValue={common((s) => (s.kind === 'rect' ? s.rx : undefined), rrects)}
                  onBlur={(e) => {
                    const v = Math.max(1, Math.min(1000, Math.round(Number(e.target.value))));
                    if (Number.isFinite(v)) patchSelected((s) => (s.kind === 'rect' && s.rx !== undefined && s.rx !== v ? { ...s, rx: v } : null));
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              </div>
            )}

            {texts.length > 0 && (
              <>
                {texts.length === 1 && (
                  <div className="space-y-1">
                    <span className={label}>Metin</span>
                    <textarea
                      ref={textRef}
                      rows={2}
                      className={`${field} w-full font-sans`}
                      value={texts[0].text}
                      onFocus={() => remember()}
                      onChange={(e) => {
                        const v = e.target.value;
                        setShapes((list) => list.map((s, i) => (sel.has(i) && s.kind === 'text' ? { ...s, text: v } : s)));
                      }}
                    />
                  </div>
                )}
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Yazı tipi</span>
                  <select className={field} value={common((s) => (s.kind === 'text' ? s.fontFamily : undefined), texts) ?? ''} onChange={(e) => patchSelected((s) => (s.kind === 'text' ? { ...s, fontFamily: e.target.value } : null))}>
                    {common((s) => (s.kind === 'text' ? s.fontFamily : undefined), texts) === undefined && <option value="" disabled>—</option>}
                    {[...new Set([...FONT_FAMILIES, ...texts.map((t) => t.fontFamily)])].map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Boyut</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={1}
                      max={200}
                      className={`${field} w-14`}
                      key={`fs${[...sel].join(',')}:${common((s) => (s.kind === 'text' ? s.fontSize : undefined), texts)}`}
                      defaultValue={common((s) => (s.kind === 'text' ? s.fontSize : undefined), texts)}
                      onBlur={(e) => {
                        const v = Math.round(Number(e.target.value));
                        if (Number.isFinite(v) && v >= 1 && v <= 200) patchSelected((s) => (s.kind === 'text' && s.fontSize !== v ? { ...s, fontSize: v } : null));
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <button className={btn(common((s) => (s.kind === 'text' ? !!s.bold : undefined), texts) === true)} onClick={() => { const on = common((s) => (s.kind === 'text' ? !!s.bold : undefined), texts) === true; patchSelected((s) => (s.kind === 'text' ? { ...s, bold: on ? undefined : true } : null)); }} title="Kalın">
                      <b className="text-[11px] px-0.5">K</b>
                    </button>
                    <button className={btn(common((s) => (s.kind === 'text' ? !!s.italic : undefined), texts) === true)} onClick={() => { const on = common((s) => (s.kind === 'text' ? !!s.italic : undefined), texts) === true; patchSelected((s) => (s.kind === 'text' ? { ...s, italic: on ? undefined : true } : null)); }} title="İtalik">
                      <i className="text-[11px] px-0.5">İ</i>
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Yatay hiza</span>
                  <select className={field} value={common((s) => (s.kind === 'text' ? s.halign : undefined), texts) ?? ''} onChange={(e) => patchSelected((s) => (s.kind === 'text' ? { ...s, halign: e.target.value as typeof s.halign } : null))}>
                    {common((s) => (s.kind === 'text' ? s.halign : undefined), texts) === undefined && <option value="" disabled>—</option>}
                    <option value="left">Sol</option>
                    <option value="center">Orta</option>
                    <option value="right">Sağ</option>
                  </select>
                </div>
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Dikey hiza</span>
                  <select className={field} value={common((s) => (s.kind === 'text' ? s.valign : undefined), texts) ?? ''} onChange={(e) => patchSelected((s) => (s.kind === 'text' ? { ...s, valign: e.target.value as typeof s.valign } : null))}>
                    {common((s) => (s.kind === 'text' ? s.valign : undefined), texts) === undefined && <option value="" disabled>—</option>}
                    <option value="top">Üst</option>
                    <option value="middle">Orta</option>
                    <option value="baseline">Taban çizgisi</option>
                    <option value="bottom">Alt</option>
                  </select>
                </div>
                <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
                  <span className={label}>Renk</span>
                  <input
                    type="color"
                    className="w-full h-6 rounded cursor-pointer"
                    value={colorValue(common((s) => (s.kind === 'text' ? s.fill ?? '#000000' : undefined), texts), '#000000')}
                    onChange={(e) => patchSelected((s) => (s.kind === 'text' ? { ...s, fill: withAlpha(s.fill, e.target.value) } : null))}
                  />
                </div>
              </>
            )}

            {images.length === 1 && (
              <button className={textBtn} onClick={() => fileRef.current?.click()}>
                Resmi değiştir…
              </button>
            )}

            {drawSel.length === 1 && (
              <div className={`text-[11px] font-mono ${dark ? 'text-slate-500' : 'text-slate-400'}`}>
                {(() => {
                  const b = shapeBox(drawSel[0]);
                  return `x ${Math.round(b.minX)}, y ${Math.round(b.minY)} · ${Math.round(b.maxX - b.minX)} × ${Math.round(b.maxY - b.minY)}`;
                })()}
              </div>
            )}

            <div className={`pt-3 mt-2 border-t space-y-1.5 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
              <span className={label}>Baştan başla</span>
              <div className="flex flex-wrap gap-1">
                <button className={textBtn} onClick={() => reset('custom')} title="Logisim-evolution'ın varsayılan özel görünümü: dikdörtgen + portlar">
                  <RotateCcw className="w-3 h-3 inline mr-1" />
                  Varsayılan özel
                </button>
                <button className={textBtn} onClick={() => reset('logisim_evolution')} title="Logisim-evolution kutusu (sabit boyut), düzenlenebilir şekiller olarak">
                  Logisim-evolution
                </button>
                <button className={textBtn} onClick={() => reset('classic')} title="Klasik Logisim kutusu, düzenlenebilir şekiller olarak">
                  Klasik
                </button>
                <button className={textBtn} onClick={() => reset('evolution')} title="Holy Cross kutusu, düzenlenebilir şekiller olarak">
                  Holy Cross
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center gap-2 px-4 py-2.5 border-t ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <span className={`text-[11px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            Kaydedince entegrenin görünümü "Özel çizim" olur ve tüm sayfalardaki örnekleri güncellenir (çapa yerinde kalır, teller yeniden bağlanır).
          </span>
          <div className="flex-1" />
          <button onClick={onClose} className={textBtn} id="appear-cancel">
            İptal
          </button>
          <button onClick={save} className="px-3 py-1.5 rounded-md text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer" id="appear-save">
            Kaydet
          </button>
        </div>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          onImageFile(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Line end while drawing; shift keeps it horizontal, vertical or at 45 degrees (evolution LineTool) */
function lineEnd(s: Extract<AppearanceShape, { kind: 'line' }>, p: Pt, constrain: boolean): AppearanceShape {
  if (!constrain) return { ...s, x2: p.x, y2: p.y };
  const dx = p.x - s.x1;
  const dy = p.y - s.y1;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx > 2 * ady) return { ...s, x2: p.x, y2: s.y1 };
  if (ady > 2 * adx) return { ...s, x2: s.x1, y2: p.y };
  const m = Math.max(adx, ady);
  return { ...s, x2: s.x1 + Math.sign(dx) * m, y2: s.y1 + Math.sign(dy) * m };
}
