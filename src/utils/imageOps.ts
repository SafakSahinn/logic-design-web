/**
 * Browser side of the Image part (Aşama 5e): reading a picture file, the clipboard, and evolution's three menu
 * tools (Optimize, Make white transparent) on a canvas. The pure rules (sizes, the white flood fill) live in
 * circuitEngine so the tests can run them without a browser.
 */
import { IMAGE_MAX_DIMENSION, imageOptimizedSize, type ImageScale, whiteToTransparent } from './circuitEngine';

/** File types evolution's chooser offers (ImageIO also reads BMP, which its clipboard paste accepts) */
export const IMAGE_FILE_ACCEPT = '.png,.jpg,.jpeg,.gif,.bmp,image/png,image/jpeg,image/gif,image/bmp';

/** evolution ImageUtil.fileToBase64: "data:<type>;base64,<file bytes>", the type from the file or its extension */
export function fileToImageSource(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const url = String(reader.result);
      const comma = url.indexOf(',');
      const name = file.name.toLowerCase();
      const byExt = name.endsWith('.png')
        ? 'image/png'
        : name.endsWith('.jpg') || name.endsWith('.jpeg')
          ? 'image/jpeg'
          : name.endsWith('.gif')
            ? 'image/gif'
            : name.endsWith('.bmp')
              ? 'image/bmp'
              : 'image/png';
      const type = file.type.startsWith('image/') ? file.type : byExt;
      resolve(`data:${type};base64,${comma >= 0 ? url.slice(comma + 1) : ''}`);
    };
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Resim çözülemedi.'));
    img.src = src;
  });
}

const canvasOf = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { c, ctx };
};

/** The picture as evolution holds it (enforceMaxDimensions: above 2048 px scaled down to fit) on a canvas */
async function decoded(src: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  if (w > IMAGE_MAX_DIMENSION || h > IMAGE_MAX_DIMENSION) {
    const s = Math.min(IMAGE_MAX_DIMENSION / w, IMAGE_MAX_DIMENSION / h);
    w = Math.max(1, Math.trunc(w * s));
    h = Math.max(1, Math.trunc(h * s));
  }
  const { c, ctx } = canvasOf(w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c;
}

/** evolution "Optimize" (ImageUtil.optimizeImage): the picture redrawn at the size the frame needs, as PNG.
 * 'same': already that size */
export async function optimizeImageSource(
  src: string,
  frameW: number,
  frameH: number,
  scale: ImageScale
): Promise<{ src: string; from: { width: number; height: number }; to: { width: number; height: number } } | 'same'> {
  const img = await decoded(src);
  const from = { width: img.width, height: img.height };
  const to = imageOptimizedSize(from, frameW, frameH, scale);
  if (to.width <= 0 || to.height <= 0 || (to.width === from.width && to.height === from.height)) return 'same';
  const { c, ctx } = canvasOf(to.width, to.height);
  if (scale === 'cover') {
    const f = Math.max(to.width / from.width, to.height / from.height);
    const cw = Math.max(1, Math.trunc(from.width * f));
    const ch = Math.max(1, Math.trunc(from.height * f));
    ctx.drawImage(img, Math.trunc((to.width - cw) / 2), Math.trunc((to.height - ch) / 2), cw, ch);
  } else {
    ctx.drawImage(img, 0, 0, to.width, to.height);
  }
  return { src: c.toDataURL('image/png'), from, to };
}

/** evolution "Make white transparent": the white background joined to the border becomes transparent, as PNG */
export async function whiteTransparentSource(src: string): Promise<string> {
  const img = await decoded(src);
  const ctx = img.getContext('2d')!;
  const data = ctx.getImageData(0, 0, img.width, img.height);
  data.data.set(whiteToTransparent(data.data, img.width, img.height));
  ctx.putImageData(data, 0, 0);
  return img.toDataURL('image/png');
}

/** A picture pasted from the clipboard (evolution pasteSystemClipboardImage): PNG, at most 2048 px, and its size */
export async function clipboardImageSource(blob: Blob): Promise<{ src: string; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const c = await decoded(url);
    return { src: c.toDataURL('image/png'), width: c.width, height: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
