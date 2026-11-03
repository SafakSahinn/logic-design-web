export type LogicValue = 0 | 1 | 'X';

// Circuit signal value (Logisim model): 'X' unknown, 'Z' floating, 'E' error (driver conflict).
// LogicValue above is the truth-table/K-map value where 'X' means don't care.
export type SignalValue = 0 | 1 | 'X' | 'Z' | 'E';

// Widest pin/wire, as in Logisim 2.7.1 (evolution allows 64 but reads 32-bit files)
export const MAX_BIT_WIDTH = 32;

// Logisim's net rule for one bit: floating and unknown drivers don't count (x combined with 1 is 1),
// differing driven values short each other out (E), an undriven bit floats (Z) or stays unknown (X)
export function resolveDrivers(drivers: SignalValue[]): SignalValue {
  let driven: SignalValue | undefined;
  let unknown = false;
  for (const d of drivers) {
    if (d === 'Z') continue;
    if (d === 'X') {
      unknown = true;
      continue;
    }
    if (driven === undefined) driven = d;
    else if (driven !== d) return 'E';
  }
  return driven ?? (unknown ? 'X' : 'Z');
}

// Multi-bit values are SignalValue[] with bit 0 (LSB) first.
// Text like Logisim's: MSB first, undefined bits (X/Z) as x, groups of 4 separated by spaces
export function bitsToString(bits: SignalValue[]): string {
  let s = '';
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    s += b === 0 || b === 1 ? String(b) : b === 'E' ? 'E' : 'x';
    if (i > 0 && i % 4 === 0) s += ' ';
  }
  return s;
}

// Unsigned value of the bits, undefined when any bit is not 0/1
export function bitsToNumber(bits: SignalValue[]): number | undefined {
  let n = 0;
  for (let i = bits.length - 1; i >= 0; i--) {
    const b = bits[i];
    if (b !== 0 && b !== 1) return undefined;
    n = n * 2 + b;
  }
  return n;
}

export function numberToBits(n: number, width: number): SignalValue[] {
  const bits: SignalValue[] = [];
  for (let i = 0; i < width; i++) bits.push((Math.floor(n / 2 ** i) % 2) as 0 | 1);
  return bits;
}

// Display bases of a probe, as Logisim's RadixOption ('10s' = signed decimal, '10u' = unsigned)
export type Radix = '2' | '8' | '10s' | '10u' | '16';

// A value in the given base like Logisim's Value.toDisplayString: octal/hex digits that hold an E bit
// show E, ones with an undefined bit show x (scanning from the digit's top bit); decimal needs every
// bit defined ("Hata" if any is E, "???" otherwise)
export function formatBits(bits: SignalValue[], radix: Radix): string {
  if (radix === '2' || bits.length <= 1) return bitsToString(bits);
  if (radix === '8' || radix === '16') {
    const per = radix === '8' ? 3 : 4;
    let s = '';
    for (let k = Math.ceil(bits.length / per) - 1; k >= 0; k--) {
      let v = 0;
      let ch = '';
      for (let j = Math.min(bits.length, per * (k + 1)) - 1; j >= per * k; j--) {
        const b = bits[j];
        if (b === 'E') { ch = 'E'; break; }
        if (b !== 0 && b !== 1) { ch = 'x'; break; }
        v = v * 2 + b;
      }
      s += ch || v.toString(radix === '8' ? 8 : 16);
    }
    return s;
  }
  if (bits.includes('E')) return 'Hata';
  const n = bitsToNumber(bits);
  if (n === undefined) return '???';
  return String(radix === '10s' && bits[bits.length - 1] === 1 ? n - 2 ** bits.length : n);
}

// One value standing for a whole bus, for code that only looks at `value` (colours, legacy reads):
// E if any bit is E, Z if every bit floats, X if any bit is undefined, else 1 if any bit is 1, else 0
export function summarizeBits(bits: SignalValue[]): SignalValue {
  if (bits.includes('E')) return 'E';
  if (bits.length > 0 && bits.every((b) => b === 'Z')) return 'Z';
  if (bits.some((b) => b === 'X' || b === 'Z')) return 'X';
  return bits.includes(1) ? 1 : 0;
}

export interface GateInfo {
  id: string;
  name: string;
  turkishName: string;
  symbol: string;
  expression: string;
  altExpression?: string;
  icCode: string;
  inputs: number; // 1 or 2
  description: string;
  behavior: string;
  analogy: string;
  table: { a: number; b?: number; out: number }[];
}

export interface KMapGroup {
  id: string;
  color: string;
  cells: number[]; // minterm indices
  term: string; // e.g. "A'B"
  explanation: string;
  rowIndices: number[];
  colIndices: number[];
  isWrapRow: boolean;
  isWrapCol: boolean;
  boxCoordinates: {
    top: number;
    left: number;
    width: number;
    height: number;
  }[];
}

export interface KMapSolution {
  primeImplicants: KMapGroup[];
  selectedGroups: KMapGroup[];
  simplifiedSOP: string;
  simplifiedPOS: string;
  minterms: number[];
  dontCares: number[];
  maxterms: number[];
  steps: string[];
}
