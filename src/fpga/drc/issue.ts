// A finding of the FPGA design rule check. The text comes from the fpga namespace: fpga:drc.<code>.

export type DrcSeverity = 'error' | 'warning' | 'info';

export interface DrcIssue {
  code: string;
  /** error: the design cannot be built for the board; warning: it can, but may not work as simulated */
  severity: DrcSeverity;
  /** Canvas part the finding is about */
  compId?: string;
  /** Pin of that part in the mapping (MappablePart.pins index) */
  pin?: number;
  /** Values for the message */
  values: Record<string, string | number>;
}

const RANK: Record<DrcSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Errors first, then warnings, then remarks; otherwise in the order found */
export function sortIssues(issues: DrcIssue[]): DrcIssue[] {
  return issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) => RANK[a.issue.severity] - RANK[b.issue.severity] || a.i - b.i)
    .map((x) => x.issue);
}

export const hasErrors = (issues: readonly DrcIssue[]) => issues.some((i) => i.severity === 'error');
