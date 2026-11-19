// The board editor tab (evo BoardEditor / BoardManipulator): a photo, resources drawn on it with their FPGA pins,
// the FPGA and its clock; saved to the user's boards (localStorage) or exported / imported as evo board XML.
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, FilePlus2, ImagePlus, Save, Trash2, Upload } from 'lucide-react';
import {
  BOARD_IO_KINDS,
  BOARD_VENDORS,
  DRIVE_STRENGTHS,
  IO_STANDARDS,
  LED_ARRAY_DRIVES,
  PULL_BEHAVIORS,
  SCANNING_DRIVES,
  boardIoHasRotation,
  type BoardDefinition,
  type BoardIo,
  type BoardIoKind,
  type BoardPicture,
  type BoardRotation,
} from '../board/model';
import { BoardXmlError, parseBoardXml, writeBoardXml } from '../board/xml';
import { describeBoardXmlError, describeBoardXmlWarning } from '../index';
import { boardIoKey } from '../map/model';
import { BoardCanvas } from './BoardCanvas';
import { BUILT_IN_BOARD_NAMES } from './boardSource';
import { BOARD_HEIGHT, BOARD_WIDTH, boardPinProblems, cloneBoard, emptyBoard, fitPicture, kindPinHint, newResource, parsePinList, withKind } from './model';
import { deleteUserBoard, readUserBoard, saveUserBoard } from './userBoards';
import { resourceName } from './text';

export interface BoardEditorProps {
  /** The board picked in the map tab ("copy" starts from it) */
  current: BoardDefinition | null;
  userBoards: string[];
  onSaved: (name: string) => void;
  onDeleted: (name: string) => void;
  dark: boolean;
}

type Feedback = { kind: 'ok' | 'error' | 'warning'; text: string }[];

/** A picture file drawn on evo's 740 x 400 board area (scaled to fit, on white), as a JPEG */
async function toBoardJpeg(source: CanvasImageSource, w: number, h: number): Promise<BoardPicture> {
  const canvas = document.createElement('canvas');
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);
  const fit = fitPicture(w, h);
  ctx.drawImage(source, fit.x, fit.y, fit.w, fit.h);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('jpeg encoding failed');
  return { format: 'jpeg', width: BOARD_WIDTH, height: BOARD_HEIGHT, jpeg: new Uint8Array(await blob.arrayBuffer()) };
}

/** evo's old raw RGB picture as a JPEG (the board writer only writes JPEG) */
async function rgbToJpeg(picture: Extract<BoardPicture, { format: 'rgb' }>): Promise<BoardPicture> {
  const canvas = document.createElement('canvas');
  canvas.width = picture.width;
  canvas.height = picture.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  const data = ctx.createImageData(picture.width, picture.height);
  for (let i = 0; i < picture.width * picture.height; i++) {
    data.data.set([picture.rgb[i * 3], picture.rgb[i * 3 + 1], picture.rgb[i * 3 + 2], 255], i * 4);
  }
  ctx.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('jpeg encoding failed');
  return { format: 'jpeg', width: picture.width, height: picture.height, jpeg: new Uint8Array(await blob.arrayBuffer()) };
}

function saveText(text: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/xml;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * A list of FPGA pins typed as text; the list is taken when the field is left or Enter is pressed. The caller
 * keys it by the list, so a new list (another resource) starts a new field.
 */
function PinListInputField({ value, onCommit, className, ...rest }: { value: string[]; onCommit: (pins: string[]) => void; className: string; 'data-fpga-field'?: string }) {
  const [text, setText] = useState(value.join(', '));
  return (
    <input
      {...rest}
      className={className}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(parsePinList(text))}
      onKeyDown={(e) => e.key === 'Enter' && onCommit(parsePinList(text))}
    />
  );
}

const PinListInput = ({ owner, ...props }: Parameters<typeof PinListInputField>[0] & { owner: number }) => (
  <PinListInputField key={`${owner}:${props.value.join(',')}`} {...props} />
);

export function BoardEditor({ current, userBoards, onSaved, onDeleted, dark }: BoardEditorProps) {
  const { t } = useTranslation('fpga');
  const [draft, setDraft] = useState<BoardDefinition>(() => emptyBoard());
  const [selected, setSelected] = useState<number | null>(null);
  const [newKind, setNewKind] = useState<BoardIoKind>('led');
  const [feedback, setFeedback] = useState<Feedback>([]);
  const photoInput = useRef<HTMLInputElement | null>(null);
  const xmlInput = useRef<HTMLInputElement | null>(null);

  const io = selected != null ? draft.components[selected] : undefined;
  // Functional updates, so two edits in one event (leaving a pin field by clicking another field) both stay
  const updateIo = (f: (c: BoardIo) => BoardIo) => setDraft((d) => ({ ...d, components: d.components.map((c, i) => (i === selected ? f(c) : c)) }));
  const patchIo = (patch: Partial<BoardIo>) => updateIo((c) => ({ ...c, ...patch }));
  const setFpga = (patch: Partial<BoardDefinition['fpga']>) => setDraft((d) => ({ ...d, fpga: { ...d.fpga, ...patch } }));
  const setClock = (patch: Partial<BoardDefinition['fpga']['clock']>) => setDraft((d) => ({ ...d, fpga: { ...d.fpga, clock: { ...d.fpga.clock, ...patch } } }));

  const start = (board: BoardDefinition) => {
    setDraft(board);
    setSelected(null);
    setFeedback([]);
  };

  const onPhoto = async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file);
      const picture = await toBoardJpeg(bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      setDraft((d) => ({ ...d, picture }));
      setFeedback([{ kind: 'ok', text: t('ui.editor.photoLoaded', { width: BOARD_WIDTH, height: BOARD_HEIGHT }) }]);
    } catch {
      setFeedback([{ kind: 'error', text: t('ui.editor.photoFailed') }]);
    }
  };

  const onImport = async (file: File) => {
    try {
      const { board, warnings } = parseBoardXml(await file.text());
      if (board.picture?.format === 'rgb') board.picture = await rgbToJpeg(board.picture);
      start(board);
      setFeedback([
        { kind: 'ok', text: t('ui.editor.imported', { name: board.name, count: board.components.length }) },
        ...warnings.map((w) => ({ kind: 'warning' as const, text: describeBoardXmlWarning(w) })),
      ]);
    } catch (e) {
      setFeedback([{ kind: 'error', text: e instanceof BoardXmlError ? describeBoardXmlError(e) : t('ui.editor.readFailed') }]);
    }
  };

  const problems = (): Feedback => {
    const out: Feedback = [];
    if (!draft.picture) out.push({ kind: 'warning', text: t('ui.editor.noPictureWarning') });
    const { duplicates } = boardPinProblems(draft);
    if (duplicates.length) out.push({ kind: 'warning', text: t('ui.editor.duplicatePins', { pins: duplicates.join(', ') }) });
    return out;
  };

  const onExport = () => {
    try {
      saveText(writeBoardXml(draft), `${draft.name}.xml`);
      setFeedback([{ kind: 'ok', text: t('ui.editor.exported', { file: `${draft.name}.xml` }) }, ...problems()]);
    } catch (e) {
      setFeedback([{ kind: 'error', text: e instanceof BoardXmlError ? describeBoardXmlError(e) : String(e) }]);
    }
  };

  const onSave = () => {
    const r = saveUserBoard(draft, BUILT_IN_BOARD_NAMES);
    if (r.ok) {
      setFeedback([{ kind: 'ok', text: t('ui.editor.saved', { name: draft.name }) }, ...problems()]);
      onSaved(draft.name);
    } else if (r.reason === 'xml') setFeedback([{ kind: 'error', text: describeBoardXmlError(r.error) }]);
    else setFeedback([{ kind: 'error', text: t(`ui.editor.saveFailed.${r.reason}`, { name: draft.name }) }]);
  };

  const onDelete = () => {
    if (!deleteUserBoard(draft.name)) {
      setFeedback([{ kind: 'error', text: t('ui.editor.saveFailed.storage') }]);
      return;
    }
    setFeedback([{ kind: 'ok', text: t('ui.editor.deleted', { name: draft.name }) }]);
    onDeleted(draft.name);
  };

  const pane = dark ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-200';
  const muted = dark ? 'text-slate-400' : 'text-slate-500';
  const input = `w-full px-2 py-1 rounded-lg border text-[11px] ${dark ? 'bg-slate-800 border-slate-600 text-slate-100' : 'bg-white border-slate-300 text-slate-800'}`;
  const btn = `px-2 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer flex items-center gap-1 disabled:opacity-40 disabled:cursor-default ${
    dark ? 'border-slate-600 bg-slate-800 hover:bg-slate-700 text-slate-200' : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-700'
  }`;
  const field = (label: string, control: ReactNode, wide = false) => (
    <label className={`flex flex-col gap-0.5 ${wide ? 'col-span-2' : ''}`}>
      <span className={`text-[10px] font-semibold ${muted}`}>{label}</span>
      {control}
    </label>
  );
  const num = (value: number, set: (n: number) => void, attrs: { min?: number; step?: number; name?: string } = {}) => (
    <input type="number" className={input} value={value} min={attrs.min} step={attrs.step} data-fpga-field={attrs.name} onChange={(e) => set(Number(e.target.value) || 0)} />
  );
  const select = <T extends string | number>(value: T, options: readonly T[], label: (v: T) => string, set: (v: T) => void, name?: string) => (
    <select className={input} value={String(value)} data-fpga-field={name} onChange={(e) => set(options.find((o) => String(o) === e.target.value) as T)}>
      {options.map((o) => (
        <option key={String(o)} value={String(o)}>
          {label(o)}
        </option>
      ))}
    </select>
  );
  const isUserBoard = userBoards.includes(draft.name);
  const hint = io ? kindPinHint(io.kind) : null;

  return (
    <div className="flex flex-col lg:flex-row gap-3 h-full min-h-0" data-fpga-editor>
      <div className="flex-1 min-w-0 flex flex-col gap-2 min-h-0">
        <div className="flex flex-wrap gap-1.5 items-center">
          <button className={btn} onClick={() => start(emptyBoard())} data-fpga-editor-new>
            <FilePlus2 className="w-3.5 h-3.5" />
            {t('ui.editor.new')}
          </button>
          <button className={btn} disabled={!current} onClick={() => current && start({ ...cloneBoard(current), name: `${current.name}_COPY` })} data-fpga-editor-copy>
            <Copy className="w-3.5 h-3.5" />
            {t('ui.editor.copyCurrent')}
          </button>
          {userBoards.length > 0 && (
            <select
              className={`${input} w-auto`}
              value=""
              onChange={(e) => {
                const b = readUserBoard(e.target.value);
                if (b) start(b);
                else setFeedback([{ kind: 'error', text: t('ui.editor.readFailed') }]);
              }}
            >
              <option value="">{t('ui.editor.openUserBoard')}</option>
              {userBoards.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          )}
          <button className={btn} onClick={() => xmlInput.current?.click()} data-fpga-editor-import>
            <Upload className="w-3.5 h-3.5" />
            {t('ui.editor.importXml')}
          </button>
          <button className={btn} onClick={onExport} data-fpga-editor-export>
            <Download className="w-3.5 h-3.5" />
            {t('ui.editor.exportXml')}
          </button>
          <button className={btn} onClick={() => photoInput.current?.click()} data-fpga-editor-photo>
            <ImagePlus className="w-3.5 h-3.5" />
            {t('ui.editor.photo')}
          </button>
          <button className={`${btn} ${dark ? '!bg-indigo-700 !border-indigo-600 !text-white' : '!bg-indigo-600 !border-indigo-600 !text-white'}`} onClick={onSave} data-fpga-editor-save>
            <Save className="w-3.5 h-3.5" />
            {t('ui.editor.save')}
          </button>
          {isUserBoard && (
            <button className={`${btn} !text-rose-500`} onClick={onDelete} data-fpga-editor-delete>
              <Trash2 className="w-3.5 h-3.5" />
              {t('ui.editor.delete')}
            </button>
          )}
          <input
            ref={photoInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onPhoto(f);
            }}
          />
          <input
            ref={xmlInput}
            type="file"
            accept=".xml,application/xml,text/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void onImport(f);
            }}
          />
        </div>
        <div className={`flex items-center gap-2 text-[11px] ${muted}`}>
          <span>{t('ui.editor.drawKind')}</span>
          {select(newKind, BOARD_IO_KINDS, (k) => t(`ioKind.${k}`), setNewKind)}
          <span className="truncate">{t('ui.editor.drawHint')}</span>
        </div>
        <div className={`border rounded-2xl overflow-hidden aspect-[740/400] ${pane}`}>
          <BoardCanvas
            board={draft}
            dark={dark}
            noPictureText={t('ui.editor.noPicture')}
            selectedKey={io ? boardIoKey(io) : null}
            title={(c) => resourceName(c)}
            onResourceClick={(c) => setSelected(draft.components.indexOf(c))}
            onBackgroundClick={() => setSelected(null)}
            onDrawRect={(rect) => {
              setDraft((d) => ({ ...d, components: [...d.components, newResource(newKind, rect)] }));
              setSelected(draft.components.length);
            }}
          />
        </div>
        {feedback.length > 0 && (
          <div className="text-[11px] space-y-0.5" data-fpga-editor-feedback>
            {feedback.map((f, i) => (
              <p key={i} className={f.kind === 'error' ? 'text-rose-500 font-semibold' : f.kind === 'warning' ? 'text-amber-500' : 'text-emerald-600'}>
                {f.text}
              </p>
            ))}
          </div>
        )}
      </div>

      <div className={`lg:w-80 shrink-0 border rounded-2xl overflow-y-auto p-3 space-y-3 text-xs min-h-0 ${pane}`}>
        {io ? (
          <div className="space-y-2" data-fpga-editor-resource>
            <div className="flex items-center justify-between">
              <p className="font-bold">{t('ui.editor.resource')}</p>
              <button
                className={`${btn} !text-rose-500`}
                onClick={() => {
                  setDraft((d) => ({ ...d, components: d.components.filter((_, i) => i !== selected) }));
                  setSelected(null);
                }}
                data-fpga-editor-remove
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('ui.editor.removeResource')}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {field(t('ui.editor.kind'), select(io.kind, BOARD_IO_KINDS, (k) => t(`ioKind.${k}`), (k) => updateIo((c) => withKind(c, k)), 'kind'), true)}
              {field(t('ui.editor.label'), <input className={input} value={io.label ?? ''} data-fpga-field="label" onChange={(e) => patchIo({ label: e.target.value || undefined })} />, true)}
              {field('x', num(io.rect.x, (x) => patchIo({ rect: { ...io.rect, x } }), { min: 0 }))}
              {field('y', num(io.rect.y, (y) => patchIo({ rect: { ...io.rect, y } }), { min: 0 }))}
              {field(t('ui.editor.width'), num(io.rect.w, (w) => patchIo({ rect: { ...io.rect, w } }), { min: 1 }))}
              {field(t('ui.editor.height'), num(io.rect.h, (h) => patchIo({ rect: { ...io.rect, h } }), { min: 1 }))}
            </div>
            {hint && <p className={`text-[10px] ${muted}`}>{t('ui.editor.pinHint', hint)}</p>}
            {field(
              t('ui.editor.inputPins', { count: io.inputPins.length }),
              <PinListInput owner={selected ?? -1} className={input} value={io.inputPins} onCommit={(inputPins) => patchIo({ inputPins })} data-fpga-field="inputPins" />,
            )}
            {field(
              t('ui.editor.outputPins', { count: io.outputPins.length }),
              <PinListInput owner={selected ?? -1} className={input} value={io.outputPins} onCommit={(outputPins) => patchIo({ outputPins })} data-fpga-field="outputPins" />,
            )}
            {field(
              t('ui.editor.ioPins', { count: io.ioPins.length }),
              <PinListInput owner={selected ?? -1} className={input} value={io.ioPins} onCommit={(ioPins) => patchIo({ ioPins })} data-fpga-field="ioPins" />,
            )}
            <div className="grid grid-cols-2 gap-2">
              {field(t('ui.editor.ioStandard'), select(io.ioStandard, IO_STANDARDS, (s) => (s === 'default' ? t('ui.editor.default') : s), (ioStandard) => patchIo({ ioStandard })))}
              {field(t('ui.editor.pull'), select(io.pull, PULL_BEHAVIORS, (p) => t(`ui.pull.${p}`), (pull) => patchIo({ pull })))}
              {field(t('ui.editor.drive'), select(io.drive, DRIVE_STRENGTHS, (d) => (d === 0 ? t('ui.editor.default') : `${d} mA`), (drive) => patchIo({ drive })))}
              {boardIoHasRotation(io.kind) &&
                field(t('ui.editor.rotation'), select<BoardRotation>(io.rotation, [0, 90, -90, 180], (r) => `${r}°`, (rotation) => patchIo({ rotation })))}
            </div>
            {io.kind !== 'pin' && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={io.activeLow} onChange={(e) => patchIo({ activeLow: e.target.checked })} data-fpga-field="activeLow" />
                <span>{t('ui.editor.activeLow')}</span>
              </label>
            )}
            {io.ledArray && (
              <div className="grid grid-cols-2 gap-2">
                {field(t('ui.editor.rows'), num(io.ledArray.rows, (rows) => patchIo({ ledArray: { ...io.ledArray!, rows: Math.max(1, rows) } }), { min: 1 }))}
                {field(t('ui.editor.columns'), num(io.ledArray.columns, (columns) => patchIo({ ledArray: { ...io.ledArray!, columns: Math.max(1, columns) } }), { min: 1 }))}
                {field(t('ui.editor.arrayDrive'), select(io.ledArray.drive, LED_ARRAY_DRIVES, (d) => t(`ui.ledArrayDrive.${d}`), (drive) => patchIo({ ledArray: { ...io.ledArray!, drive } })), true)}
              </div>
            )}
            {io.scanning && (
              <div className="grid grid-cols-2 gap-2">
                {field(t('ui.editor.digits'), num(io.scanning.digits, (digits) => patchIo({ scanning: { ...io.scanning!, digits: Math.max(1, digits) } }), { min: 1 }))}
                {field(t('ui.editor.selectBits'), num(io.scanning.selectBits, (selectBits) => patchIo({ scanning: { ...io.scanning!, selectBits } }), { min: -1 }))}
                {field(t('ui.editor.scanningDrive'), select(io.scanning.drive, SCANNING_DRIVES, (d) => t(`ui.scanningDrive.${d}`), (drive) => patchIo({ scanning: { ...io.scanning!, drive } })), true)}
              </div>
            )}
          </div>
        ) : (
          <p className={muted}>{t('ui.editor.resourceHint', { count: draft.components.length })}</p>
        )}

        <div className={`space-y-2 pt-2 border-t ${dark ? 'border-slate-700' : 'border-slate-200'}`} data-fpga-editor-board>
          <p className="font-bold">{t('ui.editor.board')}</p>
          {field(t('ui.editor.boardName'), <input className={input} value={draft.name} data-fpga-field="boardName" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value.trim() }))} />)}
          <div className="grid grid-cols-2 gap-2">
            {field(t('ui.editor.vendor'), select(draft.fpga.vendor, BOARD_VENDORS, (v) => t(`vendor.${v}`), (vendor) => setFpga({ vendor })), true)}
            {field(t('ui.editor.family'), <input className={input} value={draft.fpga.family} onChange={(e) => setFpga({ family: e.target.value })} />)}
            {field(t('ui.editor.part'), <input className={input} value={draft.fpga.part} onChange={(e) => setFpga({ part: e.target.value })} />)}
            {field(t('ui.editor.package'), <input className={input} value={draft.fpga.package} onChange={(e) => setFpga({ package: e.target.value })} />)}
            {field(t('ui.editor.speedGrade'), <input className={input} value={draft.fpga.speedGrade} onChange={(e) => setFpga({ speedGrade: e.target.value })} />)}
            {field(t('ui.editor.jtagPos'), num(draft.fpga.jtagPos, (jtagPos) => setFpga({ jtagPos }), { min: 0 }))}
            {field(t('ui.editor.flashPos'), num(draft.fpga.flashPos, (flashPos) => setFpga({ flashPos }), { min: 0 }))}
            {field(t('ui.editor.flashName'), <input className={input} value={draft.fpga.flashName} onChange={(e) => setFpga({ flashName: e.target.value })} />, true)}
            {field(t('ui.editor.unusedPull'), select(draft.fpga.unusedPull, PULL_BEHAVIORS, (p) => t(`ui.pull.${p}`), (unusedPull) => setFpga({ unusedPull })), true)}
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.fpga.usbTmc} onChange={(e) => setFpga({ usbTmc: e.target.checked })} />
            <span>{t('ui.editor.usbTmc')}</span>
          </label>
          <p className="font-bold pt-1">{t('ui.editor.clock')}</p>
          <div className="grid grid-cols-2 gap-2">
            {field(t('ui.editor.clockPin'), <input className={input} value={draft.fpga.clock.pin} data-fpga-field="clockPin" onChange={(e) => setClock({ pin: e.target.value.trim() })} />)}
            {field(t('ui.editor.clockHz'), num(draft.fpga.clock.frequency, (frequency) => setClock({ frequency }), { min: 1, name: 'clockHz' }))}
            {field(t('ui.editor.pull'), select(draft.fpga.clock.pull, PULL_BEHAVIORS, (p) => t(`ui.pull.${p}`), (pull) => setClock({ pull })))}
            {field(t('ui.editor.ioStandard'), select(draft.fpga.clock.ioStandard, IO_STANDARDS, (s) => (s === 'default' ? t('ui.editor.default') : s), (ioStandard) => setClock({ ioStandard })))}
          </div>
        </div>
      </div>
    </div>
  );
}
