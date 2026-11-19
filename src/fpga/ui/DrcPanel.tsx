// The design rule check tab: the findings of the design, the board and the mapping, errors first. A finding about
// a part goes to that part on the canvas when clicked.
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import type { DrcIssue } from '../drc/issue';
import { describeDrcIssue } from '../index';

export interface DrcPanelProps {
  issues: DrcIssue[];
  onGoToPart: (compId: string) => void;
  dark: boolean;
}

export function DrcPanel({ issues, onGoToPart, dark }: DrcPanelProps) {
  const { t } = useTranslation('fpga');
  const count = (s: DrcIssue['severity']) => issues.filter((i) => i.severity === s).length;
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  return (
    <div className="flex flex-col gap-2 h-full min-h-0" data-fpga-drc>
      <div className="flex flex-wrap gap-3 text-xs font-semibold">
        <span className="flex items-center gap-1 text-rose-500">
          <XCircle className="w-4 h-4" />
          {t('ui.drc.errors', { count: count('error') })}
        </span>
        <span className="flex items-center gap-1 text-amber-500">
          <AlertTriangle className="w-4 h-4" />
          {t('ui.drc.warnings', { count: count('warning') })}
        </span>
        <span className={`flex items-center gap-1 ${dark ? 'text-sky-400' : 'text-sky-600'}`}>
          <Info className="w-4 h-4" />
          {t('ui.drc.infos', { count: count('info') })}
        </span>
      </div>
      <div className={`border rounded-2xl overflow-y-auto flex-1 text-xs ${dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200'}`}>
        {issues.length === 0 && (
          <p className="p-4 flex items-center gap-2 text-emerald-600 font-semibold">
            <CheckCircle2 className="w-4 h-4" />
            {t('ui.drc.clean')}
          </p>
        )}
        {issues.map((issue, i) => {
          const Icon = issue.severity === 'error' ? XCircle : issue.severity === 'warning' ? AlertTriangle : Info;
          const color = issue.severity === 'error' ? 'text-rose-500' : issue.severity === 'warning' ? 'text-amber-500' : dark ? 'text-sky-400' : 'text-sky-600';
          const go = issue.compId;
          return (
            <div
              key={i}
              data-fpga-issue={issue.code}
              className={`px-3 py-2 flex gap-2 border-b last:border-b-0 ${dark ? 'border-slate-800' : 'border-slate-100'} ${
                go ? `cursor-pointer ${dark ? 'hover:bg-slate-800' : 'hover:bg-slate-50'}` : ''
              }`}
              onClick={() => go && onGoToPart(go)}
              title={go ? t('ui.goToPart') : undefined}
            >
              <Icon className={`w-4 h-4 shrink-0 mt-px ${color}`} />
              <span className="flex-1">{describeDrcIssue(issue)}</span>
              <span className={`shrink-0 text-[10px] ${muted}`}>{t(`ui.drc.severity.${issue.severity}`)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
