export type LogicValue = 0 | 1 | 'X';

// Circuit signal value (Logisim model): 'X' unknown, 'Z' floating, 'E' error (driver conflict).
// LogicValue above is the truth-table/K-map value where 'X' means don't care.
export type SignalValue = 0 | 1 | 'X' | 'Z' | 'E';

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
