// The board photo with its resources drawn on it (evo BoardManipulator): a click on a resource reports the
// resource and the logical pin under the pointer; with onDrawRect a drag on an empty place draws a new rectangle
// (the board editor). The drawing is an SVG in photo pixels, scaled to the space it gets.
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { BoardDefinition, BoardIo, BoardPicture, BoardRect } from '../board/model';
import { boardIoKey } from '../map/model';
import { boardSize, dragRect, logicalPinRects } from './model';

/** How a resource is drawn: its tone, and per logical pin whether the selected part, another part or nobody has it */
export interface ResourcePaint {
  tone: 'free' | 'fit' | 'used' | 'mine' | 'muted';
  slots?: ('mine' | 'other' | 'free')[];
}

const TONES: Record<ResourcePaint['tone'], { fill: string; stroke: string; width: number }> = {
  free: { fill: 'rgba(59,130,246,0.12)', stroke: '#3b82f6', width: 1.5 },
  fit: { fill: 'rgba(34,197,94,0.25)', stroke: '#16a34a', width: 2.5 },
  used: { fill: 'rgba(100,116,139,0.35)', stroke: '#64748b', width: 1.5 },
  mine: { fill: 'rgba(249,115,22,0.35)', stroke: '#ea580c', width: 2.5 },
  muted: { fill: 'rgba(148,163,184,0.08)', stroke: '#94a3b8', width: 1 },
};
const SLOT_FILL = { mine: 'rgba(249,115,22,0.75)', other: 'rgba(71,85,105,0.7)', free: 'transparent' };

/**
 * URL of the board photo for an <image>: a data URL of the JPEG, or a PNG drawn from raw RGB pixels. Data URLs
 * need no revoking, so the value can be derived during render.
 */
function pictureUrl(picture: BoardPicture | undefined): string | null {
  if (!picture) return null;
  if (picture.format === 'jpeg') {
    let binary = '';
    for (let i = 0; i < picture.jpeg.length; i += 0x8000) binary += String.fromCharCode(...picture.jpeg.subarray(i, i + 0x8000));
    return `data:image/jpeg;base64,${btoa(binary)}`;
  }
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const data = ctx.createImageData(picture.width, picture.height);
  for (let i = 0, j = 0; i < picture.width * picture.height; i++, j += 3) {
    data.data[i * 4] = picture.rgb[j];
    data.data[i * 4 + 1] = picture.rgb[j + 1];
    data.data[i * 4 + 2] = picture.rgb[j + 2];
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL('image/png');
}

export interface BoardCanvasProps {
  board: BoardDefinition;
  paint?: (io: BoardIo) => ResourcePaint;
  selectedKey?: string | null;
  /** Tooltip of a resource */
  title?: (io: BoardIo) => string;
  onResourceClick?: (io: BoardIo, logicalPin: number) => void;
  onBackgroundClick?: () => void;
  /** Board editor: a drag on an empty place draws a rectangle */
  onDrawRect?: (rect: BoardRect) => void;
  dark?: boolean;
  /** Text shown on a board without a photo */
  noPictureText?: string;
}

export function BoardCanvas({ board, paint, selectedKey, title, onResourceClick, onBackgroundClick, onDrawRect, dark, noPictureText }: BoardCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const url = useMemo(() => pictureUrl(board.picture), [board.picture]);
  const size = boardSize(board);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  const toPhoto = (e: { clientX: number; clientY: number }) => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const onResourceDown = (io: BoardIo, e: ReactPointerEvent) => {
    e.stopPropagation();
    if (!onResourceClick) return;
    const p = toPhoto(e);
    const rects = logicalPinRects(io);
    const pin = rects.findIndex((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
    onResourceClick(io, pin < 0 ? 0 : pin);
  };

  const onBackgroundDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (onDrawRect) {
      const p = toPhoto(e);
      try {
        // Keeps the drag when the pointer leaves the photo; not available for every pointer
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // drawing still works while the pointer stays on the photo
      }
      setDrag({ a: p, b: p });
    } else onBackgroundClick?.();
  };

  const preview = drag ? dragRect(drag.a, drag.b, size) : null;
  const slotsFor = useMemo(() => new Map(board.components.map((io) => [boardIoKey(io), logicalPinRects(io)])), [board.components]);

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${size.width} ${size.height}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full select-none touch-none"
      data-fpga-board={board.name}
      onPointerDown={onBackgroundDown}
      onPointerMove={(e) => drag && setDrag({ a: drag.a, b: toPhoto(e) })}
      onPointerUp={() => {
        if (!drag) return;
        const r = dragRect(drag.a, drag.b, size);
        setDrag(null);
        if (r) onDrawRect?.(r);
        else onBackgroundClick?.();
      }}
      onPointerCancel={() => setDrag(null)}
    >
      <rect x={0} y={0} width={size.width} height={size.height} fill={dark ? '#1e293b' : '#e2e8f0'} />
      {url ? (
        <image href={url} x={0} y={0} width={size.width} height={size.height} preserveAspectRatio="none" />
      ) : (
        noPictureText && (
          <text x={size.width / 2} y={size.height / 2} textAnchor="middle" fontSize={16} fill={dark ? '#94a3b8' : '#64748b'}>
            {noPictureText}
          </text>
        )
      )}
      {board.components.map((io) => {
        const key = boardIoKey(io);
        const p = paint?.(io) ?? { tone: 'free' as const };
        const tone = TONES[p.tone];
        const selected = key === selectedKey;
        const slots = slotsFor.get(key) ?? [];
        return (
          <g
            key={`${key}:${io.rect.w}:${io.rect.h}`}
            data-fpga-io={key}
            className={onResourceClick ? 'cursor-pointer' : undefined}
            onPointerDown={(e) => onResourceDown(io, e)}
          >
            {title && <title>{title(io)}</title>}
            <rect x={io.rect.x} y={io.rect.y} width={io.rect.w} height={io.rect.h} fill={tone.fill} />
            {p.slots &&
              slots.length > 1 &&
              p.slots.map((s, i) =>
                s !== 'free' && slots[i] ? (
                  <rect key={i} x={slots[i].x} y={slots[i].y} width={slots[i].w} height={slots[i].h} fill={SLOT_FILL[s]} />
                ) : null,
              )}
            {p.slots && slots.length === 1 && p.slots[0] !== 'free' && (
              <rect x={io.rect.x} y={io.rect.y} width={io.rect.w} height={io.rect.h} fill={SLOT_FILL[p.slots[0]]} />
            )}
            <rect
              x={io.rect.x}
              y={io.rect.y}
              width={io.rect.w}
              height={io.rect.h}
              fill="none"
              stroke={selected ? '#facc15' : tone.stroke}
              strokeWidth={selected ? 3.5 : tone.width}
            />
          </g>
        );
      })}
      {preview && <rect x={preview.x} y={preview.y} width={preview.w} height={preview.h} fill="rgba(250,204,21,0.25)" stroke="#ca8a04" strokeWidth={2} strokeDasharray="6 3" />}
    </svg>
  );
}
