import type { KMapGroup, KMapSolution, LogicValue } from '../types/logic';

export interface GridConfig {
  numVars: number;
  rowVars: string[];
  colVars: string[];
  rowCodes: string[];
  colCodes: string[];
  grid: number[][]; // grid[row][col] = minterm index
}

export function getGridConfig(numVars: number): GridConfig {
  if (numVars === 2) {
    return {
      numVars: 2,
      rowVars: ['A'],
      colVars: ['B'],
      rowCodes: ['0', '1'],
      colCodes: ['0', '1'],
      grid: [
        [0, 1],
        [2, 3],
      ],
    };
  }

  if (numVars === 3) {
    return {
      numVars: 3,
      rowVars: ['A'],
      colVars: ['B', 'C'],
      rowCodes: ['0', '1'],
      colCodes: ['00', '01', '11', '10'],
      grid: [
        [0, 1, 3, 2],
        [4, 5, 7, 6],
      ],
    };
  }

  // 4 variables
  return {
    numVars: 4,
    rowVars: ['A', 'B'],
    colVars: ['C', 'D'],
    rowCodes: ['00', '01', '11', '10'],
    colCodes: ['00', '01', '11', '10'],
    grid: [
      [0, 1, 3, 2],
      [4, 5, 7, 6],
      [12, 13, 15, 14],
      [8, 9, 11, 10],
    ],
  };
}

export const GROUP_COLORS = [
  { border: 'border-blue-500', bg: 'bg-blue-50', text: 'text-blue-700', badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  { border: 'border-emerald-500', bg: 'bg-emerald-50', text: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { border: 'border-amber-500', bg: 'bg-amber-50', text: 'text-amber-700', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  { border: 'border-rose-500', bg: 'bg-rose-50', text: 'text-rose-700', badge: 'bg-rose-100 text-rose-800 border-rose-200' },
  { border: 'border-teal-500', bg: 'bg-teal-50', text: 'text-teal-700', badge: 'bg-teal-100 text-teal-800 border-teal-200' },
  { border: 'border-indigo-500', bg: 'bg-indigo-50', text: 'text-indigo-700', badge: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { border: 'border-orange-500', bg: 'bg-orange-50', text: 'text-orange-700', badge: 'bg-orange-100 text-orange-800 border-orange-200' },
  { border: 'border-cyan-500', bg: 'bg-cyan-50', text: 'text-cyan-700', badge: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
];

// Helper to convert minterm to binary string of length n
function toBinary(val: number, len: number): string {
  return val.toString(2).padStart(len, '0');
}

// Extract term from a group of minterm indices
export function getTermFromMinterms(cells: number[], numVars: number): { term: string; explanation: string } {
  const varNames = ['A', 'B', 'C', 'D'].slice(0, numVars);
  const totalCells = cells.length;

  if (totalCells === 0) return { term: '0', explanation: 'Hiçbir terim seçilmedi.' };
  if (totalCells === Math.pow(2, numVars)) return { term: '1', explanation: 'Tüm harita kaplandı, fonksiyon daima 1.' };

  const binaries = cells.map((m) => toBinary(m, numVars));
  const termParts: string[] = [];
  const constantVars: string[] = [];
  const eliminatedVars: string[] = [];

  for (let v = 0; v < numVars; v++) {
    const bit0Count = binaries.filter((b) => b[v] === '0').length;
    const bit1Count = binaries.filter((b) => b[v] === '1').length;
    const varName = varNames[v];

    if (bit0Count === totalCells) {
      termParts.push(`${varName}'`);
      constantVars.push(`${varName} = 0`);
    } else if (bit1Count === totalCells) {
      termParts.push(varName);
      constantVars.push(`${varName} = 1`);
    } else {
      eliminatedVars.push(varName);
    }
  }

  const term = termParts.join('');
  let explanation = '';

  if (eliminatedVars.length > 0) {
    explanation += `${eliminatedVars.join(', ')} değişkenleri hem 0 hem 1 aldığından sadeleşerek elenir. `;
  }
  if (constantVars.length > 0) {
    explanation += `${constantVars.join(' ve ')} sabit kalarak "${term}" terimini oluşturur.`;
  }

  return { term, explanation };
}

// Extract POS term from a group of 0-cells
export function getPOSTermFromMaxterms(cells: number[], numVars: number): { term: string; explanation: string } {
  const varNames = ['A', 'B', 'C', 'D'].slice(0, numVars);
  const totalCells = cells.length;

  if (totalCells === 0) return { term: '1', explanation: 'Hiçbir terim seçilmedi.' };
  if (totalCells === Math.pow(2, numVars)) return { term: '0', explanation: 'Tüm harita 0, fonksiyon daima 0.' };

  const binaries = cells.map((m) => toBinary(m, numVars));
  const termParts: string[] = [];

  for (let v = 0; v < numVars; v++) {
    const bit0Count = binaries.filter((b) => b[v] === '0').length;
    const bit1Count = binaries.filter((b) => b[v] === '1').length;
    const varName = varNames[v];

    if (bit0Count === totalCells) {
      // In POS, 0 is uncomplemented
      termParts.push(varName);
    } else if (bit1Count === totalCells) {
      // In POS, 1 is complemented
      termParts.push(`${varName}'`);
    }
  }

  const term = `(${termParts.join(' + ')})`;
  return { term, explanation: `0 gruplamasından elde edilen Maxterm toplamı: ${term}` };
}

interface RawGroup {
  rows: number[];
  cols: number[];
  cells: number[];
  h: number;
  w: number;
}

export function solveKMap(
  values: Record<number, LogicValue>,
  numVars: number
): KMapSolution {
  const totalCells = Math.pow(2, numVars);
  const config = getGridConfig(numVars);
  const numRows = config.grid.length;
  const numCols = config.grid[0].length;

  const minterms: number[] = [];
  const dontCares: number[] = [];
  const maxterms: number[] = [];

  for (let i = 0; i < totalCells; i++) {
    const val = values[i] ?? 0;
    if (val === 1) minterms.push(i);
    else if (val === 'X') dontCares.push(i);
    else maxterms.push(i);
  }

  // Handle all 0s
  if (minterms.length === 0) {
    return {
      primeImplicants: [],
      selectedGroups: [],
      simplifiedSOP: '0',
      simplifiedPOS: '0',
      minterms,
      dontCares,
      maxterms,
      steps: ['Fonksiyonda hiçbir 1 bulunmamaktadır. Çıkış daima 0 (Lojik Düşük) değerindedir.'],
    };
  }

  // Handle all 1s (or 1s + X covering entire map)
  if (minterms.length + dontCares.length === totalCells) {
    return {
      primeImplicants: [],
      selectedGroups: [],
      simplifiedSOP: '1',
      simplifiedPOS: '1',
      minterms,
      dontCares,
      maxterms,
      steps: ['Haritadaki tüm hücreler 1 veya Don\'t Care (X) olduğundan çıkış daima 1 (Lojik Yüksek) değerindedir.'],
    };
  }

  // Potential group sizes (h x w) as powers of 2
  const allowedH = [1, 2, 4].filter((h) => h <= numRows);
  const allowedW = [1, 2, 4].filter((w) => w <= numCols);

  const rawGroups: RawGroup[] = [];

  // Generate all valid toroidal groups (h, w)
  for (const h of allowedH) {
    for (const w of allowedW) {
      const area = h * w;
      if ((area & (area - 1)) !== 0) continue; // must be power of 2

      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const rows: number[] = [];
          for (let dr = 0; dr < h; dr++) {
            rows.push((r + dr) % numRows);
          }
          const cols: number[] = [];
          for (let dc = 0; dc < w; dc++) {
            cols.push((c + dc) % numCols);
          }

          // Gather cell minterms
          const cellsSet = new Set<number>();
          for (const row of rows) {
            for (const col of cols) {
              cellsSet.add(config.grid[row][col]);
            }
          }
          const cells = Array.from(cellsSet).sort((a, b) => a - b);

          // Check if all cells are 1 or X
          const all1OrX = cells.every((m) => values[m] === 1 || values[m] === 'X');
          const hasAtLeastOne1 = cells.some((m) => values[m] === 1);

          if (all1OrX && hasAtLeastOne1) {
            // Avoid duplicate groups (since wrap around can produce identical cell sets)
            const exists = rawGroups.some(
              (g) => g.cells.length === cells.length && g.cells.every((val, idx) => val === cells[idx])
            );
            if (!exists) {
              rawGroups.push({ rows, cols, cells, h, w });
            }
          }
        }
      }
    }
  }

  // Filter Prime Implicants: a group is prime if it is NOT a subset of any larger valid group
  const primeImplicantsRaw = rawGroups.filter((group) => {
    return !rawGroups.some(
      (other) =>
        other.cells.length > group.cells.length &&
        group.cells.every((c) => other.cells.includes(c))
    );
  });

  // Sort prime implicants by size descending
  primeImplicantsRaw.sort((a, b) => b.cells.length - a.cells.length);

  // Essential Prime Implicant Selection (Quine-McCluskey / Petrick's greedy resolution)
  const uncoveredMinterms = new Set<number>(minterms);
  const selectedRawGroups: RawGroup[] = [];
  const steps: string[] = [];

  // Step 1: Identify Essential Prime Implicants
  for (const m of minterms) {
    const coveringPIs = primeImplicantsRaw.filter((pi) => pi.cells.includes(m));
    if (coveringPIs.length === 1) {
      const epi = coveringPIs[0];
      if (!selectedRawGroups.includes(epi)) {
        selectedRawGroups.push(epi);
        steps.push(`Temel Asal Bileşen (EPI): m${m} mintermi yalnızca tek bir asal bileşen tarafından kaplandığı için bu grup zorunludur.`);
      }
    }
  }

  // Remove minterms covered by EPIs
  for (const group of selectedRawGroups) {
    for (const c of group.cells) {
      uncoveredMinterms.delete(c);
    }
  }

  // Step 2: Cover remaining minterms using minimal remaining prime implicants
  while (uncoveredMinterms.size > 0) {
    const remainingPIs = primeImplicantsRaw.filter((pi) => !selectedRawGroups.includes(pi));
    if (remainingPIs.length === 0) break;

    // Pick PI that covers the maximum number of remaining uncovered minterms
    let bestPI = remainingPIs[0];
    let maxCovered = -1;

    for (const pi of remainingPIs) {
      let count = 0;
      for (const c of pi.cells) {
        if (uncoveredMinterms.has(c)) count++;
      }
      if (count > maxCovered) {
        maxCovered = count;
        bestPI = pi;
      }
    }

    if (maxCovered <= 0) break;

    selectedRawGroups.push(bestPI);
    for (const c of bestPI.cells) {
      uncoveredMinterms.delete(c);
    }
    steps.push(`Kalan mintermleri en az sayıda grupla kaplamak için ${bestPI.cells.length}'li grup seçildi.`);
  }

  // Convert raw groups to KMapGroup with coordinates and terms
  const selectedGroups: KMapGroup[] = selectedRawGroups.map((g, idx) => {
    const color = GROUP_COLORS[idx % GROUP_COLORS.length].border;
    const { term, explanation } = getTermFromMinterms(g.cells, numVars);

    // Compute visual box coordinates
    // Check if group wraps around rows or cols
    const isWrapRow = g.rows.some((r, i) => i > 0 && r < g.rows[i - 1]);
    const isWrapCol = g.cols.some((c, i) => i > 0 && c < g.cols[i - 1]);

    return {
      id: `group-${idx}`,
      color,
      cells: g.cells,
      term,
      explanation,
      rowIndices: g.rows,
      colIndices: g.cols,
      isWrapRow,
      isWrapCol,
      boxCoordinates: [],
    };
  });

  const primeImplicants: KMapGroup[] = primeImplicantsRaw.map((g, idx) => {
    const { term, explanation } = getTermFromMinterms(g.cells, numVars);
    return {
      id: `pi-${idx}`,
      color: GROUP_COLORS[idx % GROUP_COLORS.length].border,
      cells: g.cells,
      term,
      explanation,
      rowIndices: g.rows,
      colIndices: g.cols,
      isWrapRow: false,
      isWrapCol: false,
      boxCoordinates: [],
    };
  });

  const terms = selectedGroups.map((g) => g.term);
  const simplifiedSOP = terms.join(' + ') || '0';

  // Also calculate POS by solving on 0s
  const posTerms = solvePOS(values, numVars);

  return {
    primeImplicants,
    selectedGroups,
    simplifiedSOP,
    simplifiedPOS: posTerms,
    minterms,
    dontCares,
    maxterms,
    steps,
  };
}

// Function to solve POS by grouping 0s
function solvePOS(values: Record<number, LogicValue>, numVars: number): string {
  const totalCells = Math.pow(2, numVars);
  const config = getGridConfig(numVars);
  const numRows = config.grid.length;
  const numCols = config.grid[0].length;

  const zeros: number[] = [];
  for (let i = 0; i < totalCells; i++) {
    if (values[i] === 0 || values[i] === undefined) zeros.push(i);
  }

  if (zeros.length === 0) return '1';
  if (zeros.length === totalCells) return '0';

  // Invert 0s to 1s for the 0-solver
  const invertedValues: Record<number, LogicValue> = {};
  for (let i = 0; i < totalCells; i++) {
    if (values[i] === 0 || values[i] === undefined) invertedValues[i] = 1;
    else if (values[i] === 'X') invertedValues[i] = 'X';
    else invertedValues[i] = 0;
  }

  // Run solver on inverted
  const allowedH = [1, 2, 4].filter((h) => h <= numRows);
  const allowedW = [1, 2, 4].filter((w) => w <= numCols);

  const rawGroups: RawGroup[] = [];

  for (const h of allowedH) {
    for (const w of allowedW) {
      const area = h * w;
      if ((area & (area - 1)) !== 0) continue;

      for (let r = 0; r < numRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const rows: number[] = [];
          for (let dr = 0; dr < h; dr++) rows.push((r + dr) % numRows);
          const cols: number[] = [];
          for (let dc = 0; dc < w; dc++) cols.push((c + dc) % numCols);

          const cellsSet = new Set<number>();
          for (const row of rows) {
            for (const col of cols) cellsSet.add(config.grid[row][col]);
          }
          const cells = Array.from(cellsSet).sort((a, b) => a - b);

          const allValid = cells.every((m) => invertedValues[m] === 1 || invertedValues[m] === 'X');
          const hasAtLeastOne0 = cells.some((m) => invertedValues[m] === 1);

          if (allValid && hasAtLeastOne0) {
            const exists = rawGroups.some(
              (g) => g.cells.length === cells.length && g.cells.every((val, idx) => val === cells[idx])
            );
            if (!exists) rawGroups.push({ rows, cols, cells, h, w });
          }
        }
      }
    }
  }

  const primePIs = rawGroups.filter((g) => {
    return !rawGroups.some((o) => o.cells.length > g.cells.length && g.cells.every((c) => o.cells.includes(c)));
  });
  primePIs.sort((a, b) => b.cells.length - a.cells.length);

  const uncovered = new Set<number>(zeros);
  const selected: RawGroup[] = [];

  // EPIs
  for (const z of zeros) {
    const covering = primePIs.filter((p) => p.cells.includes(z));
    if (covering.length === 1 && !selected.includes(covering[0])) {
      selected.push(covering[0]);
    }
  }

  for (const g of selected) {
    for (const c of g.cells) uncovered.delete(c);
  }

  while (uncovered.size > 0) {
    const remaining = primePIs.filter((p) => !selected.includes(p));
    if (remaining.length === 0) break;
    let best = remaining[0];
    let maxC = -1;
    for (const p of remaining) {
      let cnt = 0;
      for (const c of p.cells) if (uncovered.has(c)) cnt++;
      if (cnt > maxC) {
        maxC = cnt;
        best = p;
      }
    }
    if (maxC <= 0) break;
    selected.push(best);
    for (const c of best.cells) uncovered.delete(c);
  }

  const posTerms = selected.map((g) => getPOSTermFromMaxterms(g.cells, numVars).term);
  return posTerms.join(' · ') || '1';
}
