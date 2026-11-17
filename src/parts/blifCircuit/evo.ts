// What Logisim-evolution's BLIF reader (std/hdl/BlifParser) cannot load from a text this part accepts.
//
// Evo reads one line at a time (no "\" continuations), takes .names only as the constants $true / $false /
// $undef, knows only its own gate cells (no yosys $_..._ cells, no models of the text as cells), allows one
// .model and silently skips .latch. Its library is the one yosys gives with
// `write_blif -icells -conn` after mapping to these cells.

/** Evo's gate cells: the binary gates of DenseLogicCircuit.GATE_TYPE_NAMES and BlifParser's own ones */
const EVO_CELLS = new Set([
  'BUS', 'TRIS', 'TRISI', 'AND', 'OR', 'XOR', 'NAND', 'NOR', 'NXOR', 'ANDNOT', 'ORNOT',
  'BUF', 'NOT', 'MUX', 'PULLUP', 'PULLDOWN', 'DFF', 'DFFSR', 'DLATCH',
]);

const EVO_CONSTANTS = new Set(['$true', '$false', '$undef']);

export type EvoIssue =
  | { code: 'continuation'; line: number }
  | { code: 'cover'; line: number }
  | { code: 'cell'; line: number; cell: string }
  | { code: 'latch'; line: number }
  | { code: 'models' };

/** The first issue of each kind (one per kind keeps the export report short) */
export function evoIssues(text: string): EvoIssue[] {
  const found = new Map<EvoIssue['code'], EvoIssue>();
  const add = (issue: EvoIssue) => {
    if (!found.has(issue.code)) found.set(issue.code, issue);
  };
  let models = 0;
  text.split('\n').forEach((raw, i) => {
    const line = i + 1;
    const s = raw.replace(/#.*/, '').trim();
    if (s.endsWith('\\')) add({ code: 'continuation', line });
    if (!s.startsWith('.')) return;
    const words = s.split(/\s+/);
    switch (words[0]) {
      case '.model':
        if (words.length > 1) models++;
        break;
      case '.names':
        if (words.length !== 2 || !EVO_CONSTANTS.has(words[1])) add({ code: 'cover', line });
        break;
      case '.subckt':
      case '.gate':
        if (words[1] !== undefined && !EVO_CELLS.has(words[1])) add({ code: 'cell', line, cell: words[1] });
        break;
      case '.latch':
        add({ code: 'latch', line });
        break;
    }
  });
  if (models > 1) add({ code: 'models' });
  return [...found.values()];
}
