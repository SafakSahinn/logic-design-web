// The map tab: the parts behind the top-level ports on the left, the board in the middle, the picked resource's
// pins on the right. Pick a part (or one of its pins), then click a resource on the photo or one of its pins
// (evo FpgaIoInformationContainer.tryMap / PartialMapDialog).
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair, Eraser, Wand2 } from 'lucide-react';
import type { BoardDefinition, BoardIo } from '../board/model';
import type { BoardMapping, MappablePart } from '../map/model';
import { boardIoKey, dirCompatible, findBoardIo, ioLogicalPinCount, ioLogicalPinDir, partPinName } from '../map/model';
import type { MapNote } from '../map/suggest';
import { BoardCanvas, type ResourcePaint } from './BoardCanvas';
import { assignPart, assignPin, fillPart, mapPartAt, mapPinAt, partMapState, resourceUsage } from './model';
import { fpgaPinOf, ioPinText, partPorts, partTitle, resourceName, targetText } from './text';
import { describeMapNote } from '../index';

export interface MapPanelProps {
  board: BoardDefinition | null;
  parts: MappablePart[];
  mapping: BoardMapping;
  notes: MapNote[];
  onChange: (mapping: BoardMapping) => void;
  onSuggest: () => void;
  onClear: () => void;
  onGoToPart: (compId: string) => void;
  dark: boolean;
}

type Selection = { compId: string; pin: number | null } | null;

const DIR_ARROW = { in: '→', out: '←', inout: '↔' } as const;

export function MapPanel({ board, parts, mapping, notes, onChange, onSuggest, onClear, onGoToPart, dark }: MapPanelProps) {
  const { t } = useTranslation('fpga');
  const [sel, setSel] = useState<Selection>(parts[0] ? { compId: parts[0].compId, pin: null } : null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const part = sel ? parts.find((p) => p.compId === sel.compId) : undefined;
  const usage = useMemo(() => (board ? resourceUsage(board, mapping) : new Map()), [board, mapping]);
  const byId = useMemo(() => new Map(parts.map((p) => [p.compId, p])), [parts]);
  const selectedIo = board && selectedKey ? findBoardIo(board, selectedKey) : undefined;

  const usedBy = (uses: { compId: string; pin: number }[]) =>
    uses
      .map((u) => {
        const p = byId.get(u.compId);
        return p ? `${partTitle(p)}${p.pins.length > 1 ? ` · ${partPinName(p.pins[u.pin])}` : ''}` : '?';
      })
      .join(', ');

  const fits = (io: BoardIo): boolean => {
    if (!part) return false;
    if (sel?.pin != null) {
      const dir = part.pins[sel.pin]?.dir;
      return !!dir && Array.from({ length: ioLogicalPinCount(io) }, (_, i) => ioLogicalPinDir(io, i)).some((d) => d && dirCompatible(dir, d));
    }
    return mapPartAt(part, io, 0) !== null;
  };

  const paint = (io: BoardIo): ResourcePaint => {
    const slots: NonNullable<ResourcePaint['slots']> = (usage.get(boardIoKey(io)) ?? []).map((uses: { compId: string }[]) =>
      uses.some((u) => u.compId === part?.compId) ? 'mine' : uses.length ? 'other' : 'free',
    );
    if (slots.includes('mine')) return { tone: 'mine', slots };
    if (part) return { tone: fits(io) ? 'fit' : 'muted', slots };
    return { tone: slots.includes('other') ? 'used' : 'free', slots };
  };

  const pick = (io: BoardIo, at: number) => {
    setSelectedKey(boardIoKey(io));
    if (!part || !sel) return;
    if (sel.pin != null) {
      const target = mapPinAt(part, sel.pin, io, at);
      if (!target) {
        setMessage({ text: t('ui.map.pinDoesNotFit', { pin: partPinName(part.pins[sel.pin]), resource: resourceName(io) }), bad: true });
        return;
      }
      onChange(assignPin(mapping, part, sel.pin, target));
      setMessage({ text: t('ui.map.pinMapped', { pin: partPinName(part.pins[sel.pin]), target: targetText(target, board) }), bad: false });
      // Go on with the next pin of the part, like filling a connector pin by pin
      if (sel.pin + 1 < part.pins.length) setSel({ compId: part.compId, pin: sel.pin + 1 });
      return;
    }
    const targets = mapPartAt(part, io, at);
    if (!targets) {
      setMessage({ text: t('ui.map.partDoesNotFit', { name: partTitle(part), resource: resourceName(io) }), bad: true });
      return;
    }
    onChange(assignPart(mapping, part, targets));
    setMessage({ text: t('ui.map.partMapped', { name: partTitle(part), resource: resourceName(io) }), bad: false });
  };

  const fill = (what: 'open' | 0 | 1 | 'clear') => {
    if (!part || !sel) return;
    if (sel.pin == null) onChange(assignPart(mapping, part, fillPart(part, mapping.parts[part.compId], what)));
    else {
      const dir = part.pins[sel.pin].dir;
      const target = what === 'clear' ? null : what === 'open' ? (dir === 'in' ? undefined : { kind: 'open' as const }) : dir === 'in' ? { kind: 'const' as const, value: what } : undefined;
      if (target !== undefined) onChange(assignPin(mapping, part, sel.pin, target));
    }
    setMessage(null);
  };

  const pane = dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const rowHover = dark ? 'hover:bg-slate-800' : 'hover:bg-slate-100';
  const rowSel = dark ? 'bg-indigo-900/60' : 'bg-indigo-50';
  const btn = `px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-default ${
    dark ? 'border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200' : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
  }`;

  const selDir = part && sel?.pin != null ? part.pins[sel.pin]?.dir : undefined;
  const partHasIn = !!part?.pins.some((p) => p.dir === 'in');
  const partHasOut = !!part?.pins.some((p) => p.dir !== 'in');
  const canOpen = sel?.pin != null ? selDir !== 'in' : partHasOut;
  const canConst = sel?.pin != null ? selDir === 'in' : partHasIn;

  return (
    <div className="flex flex-col lg:flex-row gap-3 h-full min-h-0" data-fpga-map>
      {/* Parts */}
      <div className={`lg:w-64 shrink-0 border rounded-2xl flex flex-col min-h-0 max-h-64 lg:max-h-none ${pane}`}>
        <div className={`px-3 py-2 border-b text-xs font-bold flex items-center justify-between ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          <span>{t('ui.map.parts', { count: parts.length })}</span>
          <div className="flex gap-1">
            <button className={btn} onClick={onSuggest} disabled={!board || parts.length === 0} title={t('ui.map.suggestTitle')} data-fpga-suggest>
              <Wand2 className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />
              {t('ui.map.suggest')}
            </button>
            <button className={btn} onClick={onClear} disabled={parts.length === 0} title={t('ui.map.clearTitle')} data-fpga-clear>
              <Eraser className="w-3.5 h-3.5 inline -mt-0.5 mr-0.5" />
              {t('ui.map.clear')}
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 text-xs">
          {parts.length === 0 && <p className={`p-3 ${muted}`}>{t('ui.map.noParts')}</p>}
          {parts.map((p) => {
            const targets = mapping.parts[p.compId];
            const state = partMapState(p, targets);
            const isSel = sel?.compId === p.compId;
            return (
              <div key={p.compId} data-fpga-part={p.compId}>
                <div
                  className={`px-3 py-1.5 flex items-center gap-2 cursor-pointer ${isSel && sel?.pin == null ? rowSel : rowHover}`}
                  onClick={() => {
                    setSel({ compId: p.compId, pin: null });
                    setMessage(null);
                  }}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${state === 'full' ? 'bg-emerald-500' : state === 'partial' ? 'bg-amber-500' : 'bg-slate-400'}`}
                    title={t(`ui.map.state.${state}`)}
                  />
                  <span className="font-semibold truncate">{partTitle(p)}</span>
                  <span className={`truncate font-mono text-[10px] ${muted}`}>{partPorts(p)}</span>
                  <button
                    className={`ml-auto p-0.5 rounded ${muted} hover:text-indigo-500`}
                    title={t('ui.goToPart')}
                    onClick={(e) => {
                      e.stopPropagation();
                      onGoToPart(p.compId);
                    }}
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                  </button>
                </div>
                {isSel &&
                  p.pins.map((pin, i) => (
                    <div
                      key={i}
                      data-fpga-pin={i}
                      className={`pl-7 pr-3 py-1 flex gap-2 cursor-pointer ${sel?.pin === i ? rowSel : rowHover}`}
                      onClick={() => {
                        setSel({ compId: p.compId, pin: i });
                        setMessage(null);
                      }}
                    >
                      <span className="font-mono shrink-0" title={t(`ui.dir.${pin.dir}`)}>
                        {DIR_ARROW[pin.dir]} {partPinName(pin)}
                      </span>
                      <span className={`truncate ${targets?.[i] ? '' : muted}`}>{targetText(targets?.[i], board)}</span>
                    </div>
                  ))}
              </div>
            );
          })}
        </div>
        {part && (
          <div className={`p-2 border-t flex flex-wrap gap-1 ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
            <button className={btn} disabled={!canOpen} onClick={() => fill('open')} data-fpga-fill="open">
              {t('ui.map.open')}
            </button>
            <button className={btn} disabled={!canConst} onClick={() => fill(0)} data-fpga-fill="0">
              {t('ui.map.const0')}
            </button>
            <button className={btn} disabled={!canConst} onClick={() => fill(1)} data-fpga-fill="1">
              {t('ui.map.const1')}
            </button>
            <button className={btn} onClick={() => fill('clear')} data-fpga-fill="clear">
              {t('ui.map.unmap')}
            </button>
          </div>
        )}
      </div>

      {/* Board */}
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
        <div className={`border rounded-2xl overflow-hidden aspect-[740/400] ${pane}`}>
          {board ? (
            <BoardCanvas
              board={board}
              paint={paint}
              selectedKey={selectedKey}
              dark={dark}
              noPictureText={t('ui.noPicture')}
              title={(io) => `${resourceName(io)} (${t('ui.pinCount', { count: ioLogicalPinCount(io) })})`}
              onResourceClick={pick}
              onBackgroundClick={() => setSelectedKey(null)}
            />
          ) : (
            <div className={`w-full h-full flex items-center justify-center text-xs ${muted}`}>{t('ui.loadingBoard')}</div>
          )}
        </div>
        <p className={`text-[11px] ${message?.bad ? 'text-rose-500 font-semibold' : muted}`} data-fpga-message>
          {message?.text ??
            (part
              ? sel?.pin != null
                ? t('ui.map.hintPin', { pin: partPinName(part.pins[sel.pin]) })
                : t('ui.map.hintPart', { name: partTitle(part) })
              : t('ui.map.hintNone'))}
        </p>
        <div className={`flex flex-wrap gap-3 text-[10px] ${muted}`}>
          {(['fit', 'mine', 'used', 'free'] as const).map((k) => (
            <span key={k} className="flex items-center gap-1">
              <span
                className={`inline-block w-3 h-3 rounded-sm border ${
                  k === 'fit' ? 'bg-green-500/40 border-green-600' : k === 'mine' ? 'bg-orange-500/60 border-orange-600' : k === 'used' ? 'bg-slate-500/50 border-slate-500' : 'bg-blue-500/20 border-blue-500'
                }`}
              />
              {t(`ui.legend.${k}`)}
            </span>
          ))}
        </div>
        {notes.length > 0 && (
          <div className={`border rounded-xl p-2 text-[11px] space-y-1 overflow-y-auto max-h-32 ${pane}`} data-fpga-notes>
            <p className="font-bold">{t('ui.map.notes')}</p>
            {notes.map((n, i) => (
              <p key={i} className={n.compId ? 'cursor-pointer hover:underline' : undefined} onClick={() => n.compId && setSel({ compId: n.compId, pin: null })}>
                • {describeMapNote(n)}
              </p>
            ))}
          </div>
        )}
      </div>

      {/* Resource */}
      <div className={`lg:w-64 shrink-0 border rounded-2xl flex flex-col min-h-0 max-h-64 lg:max-h-none ${pane}`}>
        <div className={`px-3 py-2 border-b text-xs font-bold ${dark ? 'border-slate-700' : 'border-slate-200'}`}>
          {selectedIo ? resourceName(selectedIo) : t('ui.map.resource')}
        </div>
        <div className="overflow-y-auto flex-1 text-xs" data-fpga-resource-pins>
          {!selectedIo && <p className={`p-3 ${muted}`}>{t('ui.map.resourceHint')}</p>}
          {selectedIo &&
            Array.from({ length: ioLogicalPinCount(selectedIo) }, (_, i) => {
              const uses = usage.get(boardIoKey(selectedIo))?.[i] ?? [];
              const dir = ioLogicalPinDir(selectedIo, i);
              return (
                <div
                  key={i}
                  data-fpga-io-pin={i}
                  className={`px-3 py-1 cursor-pointer ${rowHover}`}
                  onClick={() => pick(selectedIo, i)}
                  title={dir ? t(`ui.dir.${dir}`) : undefined}
                >
                  <div className="flex gap-2">
                    <span className="font-mono shrink-0">{dir ? DIR_ARROW[dir] : ''}</span>
                    <span className="font-semibold">{ioPinText(selectedIo, i)}</span>
                    <span className={`ml-auto font-mono ${muted}`}>{fpgaPinOf(selectedIo, i)}</span>
                  </div>
                  {uses.length > 0 && <div className="pl-5 text-orange-500 truncate">{usedBy(uses)}</div>}
                </div>
              );
            })}
          {selectedIo && ioLogicalPinCount(selectedIo) === 0 && <p className={`p-3 ${muted}`}>{t('ui.map.zeroPins')}</p>}
        </div>
      </div>
    </div>
  );
}
