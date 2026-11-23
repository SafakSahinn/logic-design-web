// The "FPGA map" dialog: map the circuit's top-level I/O parts on a board's resources, check the design for the
// board, build it and program the board (open-source flow), and make or import boards. The mapping itself belongs to the circuit and is kept by the caller.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu, X } from 'lucide-react';
import type { CircuitComponentInstance, CircuitWire } from '../../types/circuit';
import { getTopLevelPorts, type PortDecl } from '../../utils/hdlGenerator';
import type { BoardDefinition } from '../board/model';
import { BUILT_IN_BOARDS } from '../board/catalog';
import { checkDesign } from '../drc/design';
import { sortIssues } from '../drc/issue';
import { checkBoard, checkMapping } from '../drc/mapping';
import { collectClockPorts, collectMappableParts, reconcileMapping, type BoardMapping } from '../map/model';
import { suggestMapping, type MapNote } from '../map/suggest';
import { BoardEditor } from './BoardEditor';
import { DEFAULT_BOARD_NAME, loadBoardByName } from './boardSource';
import { DrcPanel } from './DrcPanel';
import { FpgaBuildPanel } from './FpgaBuildPanel';
import type { HdlLang } from '../hdl/drivers';
import { MapPanel } from './MapPanel';
import { listUserBoards } from './userBoards';
import '../index';

export interface FpgaDialogProps {
  circuitName: string;
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  /** The circuit's mapping; null while it has none */
  mapping: BoardMapping | null;
  onMappingChange: (mapping: BoardMapping) => void;
  /** Select the part on the canvas and bring it into view (the dialog closes) */
  onGoToPart: (compId: string) => void;
  onClose: () => void;
  /** Rate of a clock part without a rate of its own (the simulator's global clock), Hz, for the build */
  defaultClockHz: number;
  dark: boolean;
}

type Tab = 'map' | 'drc' | 'build' | 'editor';

export function FpgaDialog({ circuitName, components, wires, mapping, onMappingChange, onGoToPart, onClose, defaultClockHz, dark }: FpgaDialogProps) {
  const { t } = useTranslation('fpga');
  const [tab, setTab] = useState<Tab>('map');
  const [userBoards, setUserBoards] = useState<string[]>(() => listUserBoards());
  const boardName = mapping?.board ?? DEFAULT_BOARD_NAME;
  const [loaded, setLoaded] = useState<{ name: string; board: BoardDefinition | null } | null>(null);
  const [notes, setNotes] = useState<MapNote[]>([]);
  // Bumped when a user board is saved, so a board of the same name is read again
  const [boardVersion, setBoardVersion] = useState(0);
  const [buildLang, setBuildLang] = useState<HdlLang>('verilog');
  const [buildFullSpeed, setBuildFullSpeed] = useState(false);
  // Once opened, the build panel stays mounted (hidden on the other tabs): a run, its log and the built
  // bitstream survive a look at the map
  const [buildSeen, setBuildSeen] = useState(false);
  if (tab === 'build' && !buildSeen) setBuildSeen(true);

  useEffect(() => {
    let live = true;
    loadBoardByName(boardName).then(
      (board) => live && setLoaded({ name: boardName, board: board ?? null }),
      () => live && setLoaded({ name: boardName, board: null }),
    );
    return () => {
      live = false;
    };
  }, [boardName, boardVersion]);

  useEffect(() => {
    // A dialog on top (the WASM download question) handles its own Escape and marks it handled
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const board = loaded?.name === boardName ? loaded.board : null;
  const boardMissing = loaded?.name === boardName && !loaded.board;

  const ports = useMemo<PortDecl[]>(() => {
    try {
      return getTopLevelPorts(circuitName, components, wires);
    } catch {
      return [];
    }
  }, [circuitName, components, wires]);
  const parts = useMemo(() => collectMappableParts(ports, components), [ports, components]);
  const stored = useMemo<BoardMapping>(() => mapping ?? { board: boardName, parts: {} }, [mapping, boardName]);
  const current = useMemo(() => reconcileMapping(stored, parts).mapping, [stored, parts]);

  const issues = useMemo(
    () => sortIssues([...checkDesign(circuitName, components, wires), ...(board ? [...checkBoard(board), ...checkMapping(board, parts, stored)] : [])]),
    [circuitName, components, wires, board, parts, stored],
  );
  const errorCount = issues.filter((i) => i.severity === 'error').length;

  const pickBoard = (name: string) => {
    if (name === boardName) return;
    // A mapping names resource positions of its board; on another board it starts over
    onMappingChange({ board: name, parts: {} });
    setNotes([]);
  };

  const suggest = () => {
    if (!board) return;
    const activeLowParts = new Set(components.filter((c) => (c.state as { ioActiveLow?: boolean } | undefined)?.ioActiveLow === true).map((c) => c.id));
    const r = suggestMapping(board, parts, { keep: current, clockPorts: collectClockPorts(ports), activeLowParts });
    onMappingChange(r.mapping);
    setNotes(r.notes);
  };

  const shell = dark ? 'bg-slate-950 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800';
  const tabBtn = (id: Tab, label: string, badge?: number) => (
    <button
      key={id}
      data-fpga-tab={id}
      onClick={() => setTab(id)}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer flex items-center gap-1.5 ${
        tab === id ? 'bg-indigo-600 text-white' : dark ? 'text-slate-300 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-200'
      }`}
    >
      {label}
      {badge ? <span className="px-1.5 rounded-full bg-rose-500 text-white text-[10px]">{badge}</span> : null}
    </button>
  );
  const selectCls = `px-2 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer max-w-[16rem] ${
    dark ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-800'
  }`;

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4" data-fpga-dialog>
      <div className={`rounded-3xl shadow-2xl border w-full max-w-7xl h-[92vh] flex flex-col overflow-hidden ${shell}`} role="dialog" aria-label={t('ui.title')}>
        <div className={`px-4 py-3 border-b flex flex-wrap items-center gap-3 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <div className="p-2 bg-indigo-100 text-indigo-700 rounded-xl">
            <Cpu className="w-4 h-4" />
          </div>
          <div className="mr-auto min-w-0">
            <h3 className="font-extrabold text-sm">{t('ui.title')}</h3>
            <p className={`text-[11px] truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{t('ui.subtitle', { circuit: circuitName })}</p>
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold">
            {t('ui.board')}
            <select className={selectCls} value={boardName} onChange={(e) => pickBoard(e.target.value)} data-fpga-board-select>
              <optgroup label={t('ui.builtInBoards')}>
                {BUILT_IN_BOARDS.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name} ({b.family})
                  </option>
                ))}
              </optgroup>
              {(userBoards.length > 0 || !BUILT_IN_BOARDS.some((b) => b.name === boardName)) && (
                <optgroup label={t('ui.userBoards')}>
                  {[...new Set([...userBoards, ...(BUILT_IN_BOARDS.some((b) => b.name === boardName) ? [] : [boardName])])].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className={`flex gap-1 p-1 rounded-xl ${dark ? 'bg-slate-900' : 'bg-slate-100'}`}>
            {tabBtn('map', t('ui.tab.map'))}
            {tabBtn('drc', t('ui.tab.drc'), errorCount)}
            {tabBtn('build', t('build.tab'))}
            {tabBtn('editor', t('ui.tab.editor'))}
          </div>
          <button onClick={onClose} className={`p-1.5 rounded-xl cursor-pointer ${dark ? 'hover:bg-slate-800' : 'hover:bg-slate-200'}`} title={t('ui.close')} data-fpga-close>
            <X className="w-4 h-4" />
          </button>
        </div>
        {board && (
          <div className={`px-4 py-1.5 text-[11px] border-b ${dark ? 'border-slate-800 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
            {t('ui.boardInfo', {
              vendor: t(`vendor.${board.fpga.vendor}`),
              family: board.fpga.family,
              part: board.fpga.part,
              mhz: +(board.fpga.clock.frequency / 1e6).toFixed(3),
              pin: board.fpga.clock.pin,
              count: board.components.length,
            })}
          </div>
        )}
        <div className="flex-1 min-h-0 p-3 overflow-auto">
          {boardMissing && tab !== 'editor' && <p className="mb-2 text-xs text-rose-500 font-semibold">{t('ui.boardMissing', { name: boardName })}</p>}
          {tab === 'map' && (
            <MapPanel
              key={boardName}
              board={board}
              parts={parts}
              mapping={current}
              notes={notes}
              onChange={onMappingChange}
              onSuggest={suggest}
              onClear={() => {
                onMappingChange({ board: boardName, parts: {} });
                setNotes([]);
              }}
              onGoToPart={onGoToPart}
              dark={dark}
            />
          )}
          {tab === 'drc' && <DrcPanel issues={issues} onGoToPart={onGoToPart} dark={dark} />}
          {(tab === 'build' || buildSeen) &&
            (board && mapping ? (
              <div className={tab === 'build' ? 'h-full flex flex-col' : 'hidden'}>
                <FpgaBuildPanel
                  circuitName={circuitName}
                  components={components}
                  wires={wires}
                  board={board}
                  mapping={current}
                  lang={buildLang}
                  onLangChange={setBuildLang}
                  fullSpeed={buildFullSpeed}
                  onFullSpeedChange={setBuildFullSpeed}
                  defaultClockHz={defaultClockHz}
                  dark={dark}
                />
              </div>
            ) : (
              tab === 'build' && !boardMissing && <p className={`p-6 text-center text-sm ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{t(board ? 'build.noMapping' : 'ui.loadingBoard')}</p>
            ))}
          {tab === 'editor' && (
            <BoardEditor
              current={board}
              userBoards={userBoards}
              dark={dark}
              onSaved={(name) => {
                setUserBoards(listUserBoards());
                setBoardVersion((v) => v + 1);
                pickBoard(name);
              }}
              onDeleted={(name) => {
                setUserBoards(listUserBoards());
                if (name === boardName) pickBoard(DEFAULT_BOARD_NAME);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
