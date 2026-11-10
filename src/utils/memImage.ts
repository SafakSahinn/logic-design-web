/**
 * Logisim memory image files ("v2.0 raw", the hex editor's Open / Save format) for paged RAM / ROM contents.
 */
import { MEM_PAGE_SIZE } from './circuitEngine';

/** Logisim "v2.0 raw" text: words in hex, runs written "count*value", trailing zeros left out */
export function memToRawText(pages: Record<string, number[]>, words: number): string {
  let last = -1;
  for (const [k, page] of Object.entries(pages)) {
    for (let i = page.length - 1; i >= 0; i--) {
      if (page[i]) {
        last = Math.max(last, Number(k) * MEM_PAGE_SIZE + i);
        break;
      }
    }
  }
  const at = (a: number) => pages[Math.floor(a / MEM_PAGE_SIZE)]?.[a % MEM_PAGE_SIZE] ?? 0;
  const tokens: string[] = [];
  for (let a = 0; a <= last && a < words; ) {
    const v = at(a);
    let n = 1;
    while (a + n <= last && at(a + n) === v) n++;
    const hex = (v >>> 0).toString(16);
    if (n >= 4) tokens.push(`${n}*${hex}`);
    else for (let i = 0; i < n; i++) tokens.push(hex);
    a += n;
  }
  const lines: string[] = ['v2.0 raw'];
  for (let i = 0; i < tokens.length; i += 8) lines.push(tokens.slice(i, i + 8).join(' '));
  return lines.join('\n') + '\n';
}

/** Read a "v2.0 raw" text (or plain hex words); words past the memory are dropped, values keep the data bits */
export function rawTextToMem(text: string, words: number, mask: number): { pages: Record<string, number[]>; count: number } | string {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() === 'v2.0 raw') lines.shift();
  const pages: Record<string, number[]> = {};
  let addr = 0;
  for (const line of lines) {
    const body = line.replace(/#.*/, '').trim();
    if (!body) continue;
    for (const tok of body.split(/\s+/)) {
      const m = /^(?:(\d+)\*)?([0-9a-f]+)$/i.exec(tok);
      if (!m) return `Okunamayan değer: "${tok}"`;
      const n = m[1] ? Number(m[1]) : 1;
      // Only the low 32 bits count (Logisim-evolution writes up to 64 bit words)
      const v = (parseInt(m[2].slice(-8), 16) & mask) >>> 0;
      if (!v) {
        addr = Math.min(words, addr + n);
        continue;
      }
      for (let i = 0; i < n && addr < words; i++, addr++) {
        const k = String(Math.floor(addr / MEM_PAGE_SIZE));
        (pages[k] ??= new Array<number>(MEM_PAGE_SIZE).fill(0))[addr % MEM_PAGE_SIZE] = v;
      }
    }
  }
  return { pages, count: addr };
}
