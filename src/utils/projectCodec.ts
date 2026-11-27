// Project file / autosave codec. Part state is saved as it is (keyboard buffer, TTY text, ...), except the RGB Video
// image: in memory it is kept in pages of VIDEO_PAGE_SIZE numbers (0xRRGGBB), which as JSON numbers is ~9 characters
// a pixel. On save each page becomes a short run-length string, and reading turns it back into numbers; files that
// still hold the number arrays open as they are.
//
// Page string: "r1:" + base64 of PackBits-style blocks over 3-byte pixels (R, G, B):
//   header 0..127   -> header + 1 literal pixels follow
//   header 128..255 -> the next pixel repeats header - 126 times (2..129)

const PAGE_TAG = 'r1:';

const toBase64 = (bytes: number[]): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(bin);
};

const fromBase64 = (text: string): number[] => {
  const bin = atob(text);
  const out = new Array<number>(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const pushRgb = (out: number[], rgb: number) => out.push((rgb >> 16) & 0xff, (rgb >> 8) & 0xff, rgb & 0xff);

/** One video page (numbers 0xRRGGBB) as a page string */
export function encodeVideoPage(page: number[]): string {
  const out: number[] = [];
  let i = 0;
  while (i < page.length) {
    let run = 1;
    while (i + run < page.length && run < 129 && page[i + run] === page[i]) run++;
    if (run >= 2) {
      out.push(run + 126);
      pushRgb(out, page[i]);
      i += run;
      continue;
    }
    // literal block: up to 128 pixels, stopping before a repeat of 2 or more
    const start = i;
    i++;
    while (i < page.length && i - start < 128 && !(i + 1 < page.length && page[i + 1] === page[i])) i++;
    out.push(i - start - 1);
    for (let j = start; j < i; j++) pushRgb(out, page[j]);
  }
  return PAGE_TAG + toBase64(out);
}

/** A page string back to numbers (a page is always written whole); undefined when it is not one */
export function decodeVideoPage(text: string): number[] | undefined {
  if (!text.startsWith(PAGE_TAG)) return undefined;
  let bytes: number[];
  try {
    bytes = fromBase64(text.slice(PAGE_TAG.length));
  } catch {
    return undefined;
  }
  const page: number[] = [];
  let k = 0;
  const rgb = () => {
    const v = ((bytes[k] << 16) | (bytes[k + 1] << 8) | bytes[k + 2]) >>> 0;
    k += 3;
    return v;
  };
  while (k + 3 < bytes.length) {
    const h = bytes[k++];
    if (h >= 128) {
      const v = rgb();
      for (let n = h - 126; n > 0; n--) page.push(v);
    } else {
      for (let n = h + 1; n > 0; n--) page.push(rgb());
    }
  }
  return page;
}

const isPageMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** JSON.stringify replacer for project data: RGB Video pages are written as page strings */
export function projectReplacer(key: string, value: unknown): unknown {
  if (key !== 'videoPages' || !isPageMap(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, page] of Object.entries(value)) out[k] = Array.isArray(page) ? encodeVideoPage(page as number[]) : page;
  return out;
}

/** Same as projectReplacer, but without the RGB Video images (the autosave's fallback when storage is full) */
export function projectReplacerWithoutImages(key: string, value: unknown): unknown {
  return key === 'videoPages' ? undefined : projectReplacer(key, value);
}

/** JSON.parse reviver for project data: page strings become number pages again (number pages are kept) */
export function projectReviver(key: string, value: unknown): unknown {
  if (key !== 'videoPages' || !isPageMap(value)) return value;
  const out: Record<string, number[]> = {};
  for (const [k, page] of Object.entries(value)) {
    if (Array.isArray(page)) out[k] = page as number[];
    else if (typeof page === 'string') {
      const p = decodeVideoPage(page);
      if (p) out[k] = p;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** The data has at least one RGB Video image (is anything lost when it is saved without them) */
export function hasVideoImages(data: unknown): boolean {
  let found = false;
  JSON.stringify(data, (key, value) => {
    if (found) return undefined;
    if (key === 'videoPages' && isPageMap(value) && Object.keys(value).length > 0) {
      found = true;
      return undefined;
    }
    return value;
  });
  return found;
}
