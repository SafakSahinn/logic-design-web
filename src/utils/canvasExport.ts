/**
 * Standalone SVG of the circuit canvas for PNG / SVG export.
 *
 * The live canvas only shows the visible viewport, is styled through CSS classes that do not exist
 * outside the page, and draws note text in <foreignObject> (which taints a canvas, so PNG export
 * would throw). The export copy therefore gets: computed styles inlined, the pan/zoom transform
 * removed and a viewBox around the whole circuit, the grid and UI-only parts dropped, and note
 * text turned into plain SVG text.
 */

const STYLE_PROPS = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
  'visibility',
  'display',
];

const SVG_NS = 'http://www.w3.org/2000/svg';

export function buildExportSvg(
  svg: SVGSVGElement,
  view: { panX: number; panY: number; zoom: number },
  background: string
): { markup: string; width: number; height: number } | null {
  const contentGroup = Array.from(svg.children).find(
    (el) => el.tagName.toLowerCase() === 'g' && /translate\(.*scale\(/.test(el.getAttribute('transform') || '')
  ) as SVGGElement | undefined;
  if (!contentGroup) return null;

  // Bounding box of everything but the grid, in canvas coordinates
  const svgRect = svg.getBoundingClientRect();
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const child of Array.from(contentGroup.children)) {
    if (isGrid(child) || child.closest('[data-export-skip]')) continue;
    const r = child.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    x0 = Math.min(x0, (r.left - svgRect.left - view.panX) / view.zoom);
    y0 = Math.min(y0, (r.top - svgRect.top - view.panY) / view.zoom);
    x1 = Math.max(x1, (r.right - svgRect.left - view.panX) / view.zoom);
    y1 = Math.max(y1, (r.bottom - svgRect.top - view.panY) / view.zoom);
  }
  if (!isFinite(x0)) return null;
  const M = 40;
  x0 = Math.floor(x0 - M);
  y0 = Math.floor(y0 - M);
  const width = Math.ceil(x1 + M - x0);
  const height = Math.ceil(y1 + M - y0);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);

  // Drop the grid, UI-only parts and interaction overlays
  clone.querySelectorAll('[data-export-skip]').forEach((el) => el.remove());
  const cloneGroup = Array.from(clone.children).find(
    (el) => el.tagName.toLowerCase() === 'g' && /translate\(.*scale\(/.test(el.getAttribute('transform') || '')
  ) as SVGGElement;
  Array.from(cloneGroup.children).forEach((el) => isGrid(el) && el.remove());
  cloneGroup.removeAttribute('transform');

  // Notes: <foreignObject> -> wrapped <text>
  clone.querySelectorAll('foreignObject').forEach((fo) => {
    const x = Number(fo.getAttribute('x')) || 0;
    const y = Number(fo.getAttribute('y')) || 0;
    const w = Number(fo.getAttribute('width')) || 100;
    const h = Number(fo.getAttribute('height')) || 20;
    const holder = fo.querySelector('div, textarea, input') as HTMLElement | null;
    const raw = holder ? ('value' in holder && (holder as HTMLInputElement).value) || holder.textContent || '' : '';
    const fontSize = parseFloat(holder?.style.fontSize || '') || 11;
    const color = holder?.style.color || '#334155';
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('font-family', 'sans-serif');
    text.setAttribute('font-size', String(fontSize));
    text.setAttribute('fill', color);
    const lineH = fontSize * 1.35;
    const maxChars = Math.max(4, Math.floor(w / (fontSize * 0.55)));
    const lines = raw.split('\n').flatMap((l) => wrapLine(l, maxChars));
    lines.slice(0, Math.max(1, Math.floor(h / lineH))).forEach((line, i) => {
      const t = document.createElementNS(SVG_NS, 'tspan');
      t.setAttribute('x', String(x));
      t.setAttribute('y', String(y + fontSize + i * lineH));
      t.textContent = line;
      text.appendChild(t);
    });
    fo.replaceWith(text);
  });

  // Plain SVG document around the circuit
  clone.removeAttribute('class');
  clone.removeAttribute('style');
  clone.setAttribute('xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.setAttribute('viewBox', `${x0} ${y0} ${width} ${height}`);
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('x', String(x0));
  bg.setAttribute('y', String(y0));
  bg.setAttribute('width', String(width));
  bg.setAttribute('height', String(height));
  bg.setAttribute('fill', background);
  clone.insertBefore(bg, cloneGroup);

  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

function isGrid(el: Element): boolean {
  return (el.getAttribute('fill') || '').includes('gridPattern');
}

function wrapLine(line: string, maxChars: number): string[] {
  if (line.length <= maxChars) return [line];
  const out: string[] = [];
  let cur = '';
  for (const word of line.split(' ')) {
    if ((cur + ' ' + word).trim().length > maxChars && cur) {
      out.push(cur);
      cur = word;
    } else cur = (cur + ' ' + word).trim();
  }
  if (cur) out.push(cur);
  return out;
}

// Copy computed presentation styles from the live tree onto the clone, then drop class names
function inlineStyles(src: Element, dst: Element) {
  if (src instanceof SVGElement && !(src instanceof SVGSVGElement && src === src.ownerSVGElement)) {
    const cs = getComputedStyle(src);
    const parts: string[] = [];
    for (const prop of STYLE_PROPS) {
      const v = cs.getPropertyValue(prop);
      if (v) parts.push(`${prop}:${v}`);
    }
    if (parts.length) dst.setAttribute('style', parts.join(';'));
    dst.removeAttribute('class');
  }
  const sc = src.children;
  const dc = dst.children;
  for (let i = 0; i < sc.length && i < dc.length; i++) {
    if (sc[i].tagName.toLowerCase() === 'foreignobject') continue;
    inlineStyles(sc[i], dc[i]);
  }
}
