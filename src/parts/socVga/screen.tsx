// The picture of a VGA part on the canvas: a <canvas> in a <foreignObject> that copies the VGA's offscreen surface
// (runtime.ts) after each render in which the VGA's version changed. The canvas export turns it into an <image>.
import { useEffect, useRef, type ReactNode } from 'react';
import { peekVga } from './runtime';

export interface VgaScreenProps {
  /** Component id of the VGA */
  vgaKey: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Version stamp of a canvas that shows "no VGA yet" (black) */
const BLANK = -2;

/** What a canvas element shows: a new element (or a new size, which clears it) must be drawn again */
interface Drawn {
  canvas: HTMLCanvasElement | null;
  /** The VGA object drawn: a new object for the same part counts its version from the start again */
  vga: object | undefined;
  w: number;
  h: number;
  version: number;
}

export function VgaScreen({ vgaKey, x, y, width, height }: VgaScreenProps): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawn = useRef<Drawn>({ canvas: null, vga: undefined, w: 0, h: 0, version: -1 });
  const vga = peekVga(vgaKey);
  // the canvas has the picture's own size; the foreignObject scales it into the body (they differ only for a moment
  // after the initial mode attribute changes, until the next simulation run hands it to the VGA)
  const cw = vga?.width ?? width;
  const ch = vga?.height ?? height;
  useEffect(() => {
    const cv = ref.current;
    const g = cv?.getContext('2d');
    if (!cv || !g) return;
    const v = peekVga(vgaKey);
    const surface = v?.surface() ?? null;
    // surface() may have reloaded the picture, so the stamp is read after it
    const version = v && surface ? v.version : BLANK;
    const d = drawn.current;
    if (d.canvas === cv && d.vga === v && d.w === cv.width && d.h === cv.height && d.version === version) return;
    drawn.current = { canvas: cv, vga: v, w: cv.width, h: cv.height, version };
    if (surface) g.drawImage(surface, 0, 0);
    else {
      g.fillStyle = '#000';
      g.fillRect(0, 0, cv.width, cv.height);
    }
  });
  return (
    <foreignObject x={x} y={y} width={width} height={height} data-vga-screen="">
      <canvas
        ref={ref}
        width={cw}
        height={ch}
        style={{ display: 'block', width: '100%', height: '100%', imageRendering: 'pixelated', background: '#000' }}
      />
    </foreignObject>
  );
}
