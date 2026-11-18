// C driver export shared by the SoC peripherals (PIO, VGA), after evo's "Export C" menu items and SocSupport's
// add*Function: a <NAME>.h with declarations and a <NAME>.c with volatile word accesses at the part's address.

/** Longest component name in identifiers and file names */
const MAX_NAME = 64;

/**
 * The part name as a C identifier part and file name, as evo builds it (spaces, '@' and ',' become '_', upper case),
 * then limited to [A-Z0-9_] so that a label cannot break out of an identifier, a comment or a file name. A name with
 * no letter or digit left becomes `fallback`.
 */
export function cComponentName(name: string, fallback: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, MAX_NAME);
  if (!/[A-Z0-9]/.test(s)) return fallback;
  return /^[0-9]/.test(s) ? `_${s}`.slice(0, MAX_NAME) : s;
}

export interface CExport {
  /** <NAME>.h / <NAME>.c */
  headerName: string;
  sourceName: string;
  header: string;
  source: string;
}

/** An address as evo writes it: "0x" + upper-case hex digits, no padding */
export const cHex = (n: number): string => `0x${(n >>> 0).toString(16).toUpperCase()}`;

/** evo's remarks are /* … *\/ blocks; ours come from the locale, so they are wrapped here */
export const cRemark = (text: string): string => `/* ${text.split('\n').join('\n * ')}\n */`;

/** Lines of a header and a source being written; the accessors are evo's SocSupport setter / getter functions */
export class CWriter {
  readonly h: string[] = [];
  readonly c: string[] = [];
  private readonly comp: string;
  private readonly base: string;

  constructor(comp: string, base: number) {
    this.comp = comp;
    this.base = cHex(base);
  }

  setter(fn: string, index: number): void {
    this.h.push(`void set${this.comp}${fn}(unsigned int value);`);
    this.c.push(`void set${this.comp}${fn}(unsigned int value) {`, '  volatile unsigned int* base;', `  base = (unsigned int *) ${this.base};`, `  base[${index}] = value;`, '}', '');
  }

  getter(fn: string, index: number): void {
    this.h.push(`unsigned int get${this.comp}${fn}();`);
    this.c.push(`unsigned int get${this.comp}${fn}() {`, '  volatile unsigned int* base;', `  base = (unsigned int *) ${this.base};`, `  return base[${index}];`, '}', '');
  }

  /** evo's addAllFunctions: a setter and a getter, then a blank header line */
  both(fn: string, index: number): void {
    this.setter(fn, index);
    this.getter(fn, index);
    this.h.push('');
  }
}

/** Hands the text to the browser as a file download (the desktop app asks where to save it) */
export function saveTextFile(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Downloads both files of an export; the second a moment later, as some browsers drop a download right after another */
export function saveCExport(files: CExport): void {
  saveTextFile(files.header, files.headerName);
  setTimeout(() => saveTextFile(files.source, files.sourceName), 300);
}
