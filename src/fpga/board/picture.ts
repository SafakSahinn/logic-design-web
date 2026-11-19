// Board photo codec of the Logisim-evolution board XML (evo fpga/file/ImageXmlFactory.java).
//
// Format 2 (PixelRGB starts with '@'): the bytes of a JPEG file, each byte written as one or two characters of a
// per-file code table. The table hands the 64 one-character codes to the most frequent bytes and the two-character
// codes ('+', '-' or '=' followed by a letter, digit or parenthesis) to the rest.
// Format 1 (no '@', read only): width*height pixels, each as three codes (red, green, blue) of the same table.

/** Codes in the order the most frequent byte gets the first one */
const INITIAL_CODES: readonly string[] = (() => {
  const singles = [...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789()'];
  return [...singles, ...['+', '-', '='].flatMap((p) => singles.map((s) => p + s))];
})();
const FORMAT2_MARK = '@';
const TWO_CHAR_PREFIXES = new Set(['+', '-', '=']);

export class BoardPictureError extends Error {
  readonly code: 'badCodeTable' | 'badPixelData';
  constructor(code: 'badCodeTable' | 'badPixelData') {
    super(code);
    this.code = code;
  }
}

/**
 * Code table entry k is the code of byte value (k + 128) & 0xff: evo indexes the table with a signed Java byte
 * plus 128.
 */
const tableIndex = (byte: number) => (byte + 128) & 0xff;

/** evo createCodeTable: counts per table index, then a stable sort from most to least frequent */
function createCodeTable(bytes: Uint8Array): string[] {
  const counts = new Array<number>(256).fill(0);
  for (const b of bytes) counts[tableIndex(b)]++;
  const order = Array.from({ length: 256 }, (_, i) => i).sort((a, b) => counts[b] - counts[a] || a - b);
  const table = new Array<string>(256);
  order.forEach((index, rank) => (table[index] = INITIAL_CODES[rank]));
  return table;
}

/** Encodes a JPEG file as evo does: returns the TableData and PixelRGB attribute values */
export function encodeBoardPicture(jpeg: Uint8Array): { codeTable: string; pixels: string } {
  const table = createCodeTable(jpeg);
  const out: string[] = [FORMAT2_MARK];
  for (const b of jpeg) out.push(table[tableIndex(b)]);
  return { codeTable: table.join(' '), pixels: out.join('') };
}

function readTable(codeTable: string): Map<string, number> {
  const codes = codeTable.split(' ');
  if (codes.length !== 256) throw new BoardPictureError('badCodeTable');
  const lookup = new Map<string, number>();
  codes.forEach((code, i) => lookup.set(code, i));
  if (lookup.size !== 256) throw new BoardPictureError('badCodeTable');
  return lookup;
}

/** Splits the stream into codes and returns their table indexes */
function readCodes(pixels: string, start: number, lookup: Map<string, number>): number[] {
  const values: number[] = [];
  for (let i = start; i < pixels.length; ) {
    const len = TWO_CHAR_PREFIXES.has(pixels[i]) ? 2 : 1;
    const value = lookup.get(pixels.slice(i, i + len));
    if (value === undefined) throw new BoardPictureError('badPixelData');
    values.push(value);
    i += len;
  }
  return values;
}

/** Decodes a picture; width and height come from PictureDimension */
export function decodeBoardPicture(
  codeTable: string,
  pixels: string,
  width: number,
  height: number,
): { format: 'jpeg'; jpeg: Uint8Array } | { format: 'rgb'; rgb: Uint8Array } {
  const lookup = readTable(codeTable);
  if (pixels.startsWith(FORMAT2_MARK)) {
    const values = readCodes(pixels, 1, lookup);
    return { format: 'jpeg', jpeg: Uint8Array.from(values, (v) => (v - 128) & 0xff) };
  }
  // Format 1 stores the colour channel values directly as table indexes
  const values = readCodes(pixels, 0, lookup);
  if (values.length !== width * height * 3) throw new BoardPictureError('badPixelData');
  return { format: 'rgb', rgb: Uint8Array.from(values) };
}
