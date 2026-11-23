// The FPGA tab of the HDL window: the circuit's project files for the board it is mapped on (the design module,
// the top level around it and the pin constraints), previewed one at a time and downloaded together. Nothing is
// made while the design rule check finds an error; the findings are listed instead. The "build and program" view
// runs the open-source flow on these files (FpgaBuildPanel).
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Copy, Cpu, Download, Hammer } from 'lucide-react';
import type { CircuitComponentInstance, CircuitWire } from '../../types/circuit';
import type { BoardDefinition } from '../board/model';
import type { HdlLang } from '../hdl/drivers';
import { buildFpgaProject, type FpgaProject } from '../hdl/project';
import { formatHz } from '../hdl/wrapper';
import type { BoardMapping } from '../map/model';
import { loadBoardByName } from './boardSource';
import { DrcPanel } from './DrcPanel';
import { FpgaBuildPanel } from './FpgaBuildPanel';
import { describeDrcIssue } from '../index';

export interface HdlFpgaTabProps {
  circuitName: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  /** The circuit's mapping; null while it has none */
  mapping: BoardMapping | null;
  /** Rate of a clock part without a rate of its own (the simulator's global clock), Hz */
  defaultClockHz: number;
  onOpenMap: () => void;
  onGoToPart: (compId: string) => void;
  /** Saves a text file */
  onDownload: (fileName: string, text: string) => void;
  onToast: (message: string) => void;
}

type FileView = 'topLevel' | 'constraints' | 'design';
type View = FileView | 'build';

export function HdlFpgaTab({ circuitName, components, wires, mapping, defaultClockHz, onOpenMap, onGoToPart, onDownload, onToast }: HdlFpgaTabProps) {
  const { t } = useTranslation('fpga');
  const [lang, setLang] = useState<HdlLang>('verilog');
  const [view, setView] = useState<View>('topLevel');
  const [fullSpeed, setFullSpeed] = useState(false);
  const [copied, setCopied] = useState(false);
  // Once opened, the build panel stays mounted (hidden behind the file views), as in the map dialog
  const [buildSeen, setBuildSeen] = useState(false);
  if (view === 'build' && !buildSeen) setBuildSeen(true);
  const boardName = mapping?.board ?? null;
  const [loaded, setLoaded] = useState<{ name: string; board: BoardDefinition | null } | null>(null);

  useEffect(() => {
    if (!boardName) return;
    let live = true;
    loadBoardByName(boardName).then(
      (board) => live && setLoaded({ name: boardName, board: board ?? null }),
      () => live && setLoaded({ name: boardName, board: null }),
    );
    return () => {
      live = false;
    };
  }, [boardName]);

  const board = loaded && loaded.name === boardName ? loaded.board : undefined;

  const project = useMemo<FpgaProject | null>(() => {
    if (!mapping || !board) return null;
    try {
      return buildFpgaProject({
        circuitName,
        components,
        wires,
        board,
        mapping,
        lang,
        clock: { fullSpeed, defaultHz: defaultClockHz },
        describe: describeDrcIssue,
      });
    } catch {
      return null;
    }
  }, [circuitName, components, wires, board, mapping, lang, fullSpeed, defaultClockHz]);

  const mapButton = (
    <button
      data-fpga-open
      onClick={onOpenMap}
      className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-xl border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
    >
      <Cpu className="w-3.5 h-3.5" />
      <span>{t('ui.openButton')}</span>
    </button>
  );

  const message = (text: string) => (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6 text-center bg-slate-50" data-fpga-hdl-state>
      <p className="text-sm text-slate-600 max-w-xl">{text}</p>
      {mapButton}
    </div>
  );

  if (!mapping) return message(t('hdl.noMapping'));
  if (board === undefined) return message(t('ui.loadingBoard'));
  if (board === null) return message(t('ui.boardMissing', { name: mapping.board }));
  if (!project) return message(t('hdl.failed'));

  if (!project.ok) {
    const errors = project.issues.filter((i) => i.severity === 'error').length;
    return (
      <div className="flex-1 flex flex-col gap-3 p-4 min-h-0 bg-slate-50" data-fpga-hdl-blocked>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-semibold text-rose-600 mr-auto">{t('hdl.blocked', { count: errors })}</p>
          {mapButton}
        </div>
        <div className="flex-1 min-h-0">
          <DrcPanel issues={project.issues} onGoToPart={onGoToPart} dark={false} />
        </div>
      </div>
    );
  }

  const files = { topLevel: project.topLevel, constraints: project.constraints, design: project.design };
  const shown = view === 'build' ? null : files[view];
  const warnings = project.issues.filter((i) => i.severity === 'warning').length;

  const copy = () => {
    // The browser may refuse (no focus / permission): the text is still on screen to copy by hand
    if (!shown) return;
    navigator.clipboard?.writeText(shown.text).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const downloadAll = () => {
    const list = [project.design, project.topLevel, project.constraints];
    // One file at a time: browsers drop clicks that come too close together
    list.forEach((f, i) => setTimeout(() => onDownload(f.fileName, f.text), i * 250));
    onToast(t('hdl.downloaded', { files: list.map((f) => f.fileName).join(', ') }));
  };

  const seg = (active: boolean) =>
    `px-3 py-1 rounded-lg font-semibold transition-all cursor-pointer ${active ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'}`;

  return (
    <div className="flex-1 flex flex-col min-h-0" data-fpga-hdl>
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-700 mr-1" data-fpga-hdl-board>
          {t('hdl.boardLine', { board: board.name, tool: t(`vendor.${board.fpga.vendor}`), clock: formatHz(board.fpga.clock.frequency) })}
        </span>
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
          <button className={seg(lang === 'verilog')} onClick={() => setLang('verilog')} data-fpga-hdl-lang="verilog">
            Verilog
          </button>
          <button className={seg(lang === 'vhdl')} onClick={() => setLang('vhdl')} data-fpga-hdl-lang="vhdl">
            VHDL
          </button>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-xl border border-slate-200">
          {(['topLevel', 'constraints', 'design'] as const).map((v) => (
            <button key={v} className={seg(view === v)} onClick={() => setView(v)} data-fpga-hdl-view={v} title={files[v].fileName}>
              {t(`hdl.file.${v}`)}
            </button>
          ))}
          <button className={`${seg(view === 'build')} flex items-center gap-1`} onClick={() => setView('build')} data-fpga-hdl-view="build">
            <Hammer className="w-3.5 h-3.5" />
            {t('build.tab')}
          </button>
        </div>
        <label className="flex items-center gap-1.5 font-semibold text-slate-600 cursor-pointer" title={t('hdl.fullSpeedTitle')}>
          <input type="checkbox" checked={fullSpeed} onChange={(e) => setFullSpeed(e.target.checked)} data-fpga-hdl-fullspeed />
          {t('hdl.fullSpeed')}
        </label>
        <div className="ml-auto flex items-center gap-2">
          {mapButton}
          <button
            onClick={copy}
            disabled={!shown}
            data-fpga-hdl-copy
            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 rounded-xl border border-slate-300 font-semibold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-500" />}
            <span>{copied ? t('hdl.copied') : t('hdl.copy')}</span>
          </button>
          <button
            onClick={downloadAll}
            data-fpga-hdl-download
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-2xs"
          >
            <Download className="w-3.5 h-3.5" />
            <span>{t('hdl.download', { count: 3 })}</span>
          </button>
        </div>
      </div>
      {(warnings > 0 || project.plan.clocks.length > 0) && (
        <div className="px-4 py-1.5 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
          {warnings > 0 && (
            <span className="flex items-center gap-1 text-amber-600 font-semibold" data-fpga-hdl-warnings>
              <AlertTriangle className="w-3.5 h-3.5" />
              {t('hdl.warnings', { count: warnings })}
            </span>
          )}
          {project.plan.clocks.map((k) => (
            <span key={k.port} data-fpga-hdl-clock>
              {k.halfPeriod > 0
                ? t('hdl.clockDivided', { port: k.port, actual: formatHz(k.actualHz), requested: formatHz(k.requestedHz) })
                : t('hdl.clockDirect', { port: k.port, actual: formatHz(k.actualHz) })}
            </span>
          ))}
        </div>
      )}
      {shown && (
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-950">
          <p className="text-[11px] text-slate-400 font-mono mb-2" data-fpga-hdl-file>
            {shown.fileName}
          </p>
          <pre className="font-mono text-xs text-indigo-200 leading-relaxed whitespace-pre selection:bg-indigo-700 selection:text-white">
            <code>{shown.text}</code>
          </pre>
        </div>
      )}
      {buildSeen && (
        <div className={shown ? 'hidden' : 'flex-1 min-h-0 flex flex-col p-4 bg-slate-50'}>
          <FpgaBuildPanel
            circuitName={circuitName}
            components={components}
            wires={wires}
            board={board}
            mapping={mapping}
            lang={lang}
            fullSpeed={fullSpeed}
            defaultClockHz={defaultClockHz}
            dark={false}
          />
        </div>
      )}
    </div>
  );
}
