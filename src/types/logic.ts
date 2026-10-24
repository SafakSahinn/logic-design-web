export type LogicValue = 0 | 1 | 'X';

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
