/**
 * Attribute table of each part type (Logisim's attribute panel). Each attribute knows how to read its value
 * from a part and how to give a part a new value; the attribute panel draws the rows and applies the
 * change to every selected part of the same type in one undo step.
 */
import type { CircuitComponentInstance, CircuitPin, CircuitWire, ComponentType } from '../types/circuit';
import { MAX_BIT_WIDTH, type Radix } from '../types/logic';
import {
  ARITH_TYPES,
  BIT_ADDER_MAX_INPUTS,
  LEVEL_TRIGGER_TYPES,
  MEM_TYPES,
  SHIFT_REGISTER_MAX_LENGTH,
  GATE_WIDTH_TYPES,
  MULTI_INPUT_GATE_TYPES,
  OUTPUT_MODE_TYPES,
  PLEXER_MAX_SELECT,
  SPLITTER_MAX_FANOUT,
  configureArith,
  configureBitExtender,
  configureBitSelector,
  configureMem,
  configurePlexer,
  configureRam,
  getRamConfig,
  RAM_ADDR_MAX,
  RAM_ADDR_MIN,
  type RamConfig,
  configureSplitter,
  getArithConfig,
  getArithMode,
  getBitWidth,
  getGateWidth,
  getCounterMax,
  getMemConfig,
  getTrigger,
  getPlexerConfig,
  getSplitterConfig,
  pinKey,
  type ArithConfig,
  type MemConfig,
  type TriggerMode,
  type PlexerConfig,
  setBitWidth,
  setGateWidth,
  updatePinPositions,
} from './circuitEngine';
import { snapPt10 } from './wiringEngine';

export type AttrValue = string | number;

export interface AttrOption {
  value: AttrValue;
  label: string;
  title?: string;
  /** Colour swatch drawn instead of the label */
  swatch?: string;
}

export interface AttrContext {
  /** Global clock rate, shown on the clock's "general rate" choice */
  clockHz: number;
}

/**
 * Result of an edit. `remap` maps old pin grid points ("x,y") to the pin id the wires there should now
 * follow (null = the pin is gone, its wires stay as open ends). Without `remap` every pin keeps its id
 * and wires on it follow it to its new place.
 */
export interface AttrEdit {
  comp: CircuitComponentInstance;
  remap?: Map<string, string | null>;
  /** Only the part's state changed (no pin moved), so the wires stay as they are */
  stateOnly?: boolean;
}

export type AttrKind =
  | 'select' // drop-down list
  | 'buttons' // row of toggle buttons
  | 'hex' // hexadecimal text field
  | 'int' // decimal integer text field (32-bit signed)
  | 'info' // read-only value
  | 'bitMap' // splitter: one drop-down per incoming bit
  | 'flags'; // row of on/off buttons; value = selected option values joined by ',', set takes '+v' / '-v'

export interface AttrDef {
  key: string;
  label: string;
  kind: AttrKind;
  title?: string;
  options?: AttrOption[] | ((comp: CircuitComponentInstance, ctx: AttrContext) => AttrOption[]);
  get: (comp: CircuitComponentInstance) => AttrValue;
  /** New part for a value, or null when nothing changes. `wires` are canonical when `canonicalWires` is set */
  set?: (comp: CircuitComponentInstance, value: AttrValue, wires: CircuitWire[]) => AttrEdit | null;
  /** The edit needs canonical (repaired) wires, e.g. to find which input pins are wired */
  canonicalWires?: boolean;
  /** Only offered when exactly one part is selected */
  singleOnly?: boolean;
  /** Shown only for parts where this holds (e.g. settings of one rule set); every selected part must pass */
  visible?: (comp: CircuitComponentInstance) => boolean;
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const numberOptions = (from: number, to: number): AttrOption[] => range(from, to).map((n) => ({ value: n, label: String(n) }));
const WIDTH_OPTIONS = numberOptions(1, MAX_BIT_WIDTH);

/** A state-only edit: the pins stay where they are */
const withState = (comp: CircuitComponentInstance, patch: Partial<CircuitComponentInstance['state']>): AttrEdit => ({
  comp: { ...comp, state: { ...comp.state, ...patch } },
  stateOnly: true,
});

/** Edit that changed the part's pins: unchanged parts give null so they don't count as a change */
const resized = (old: CircuitComponentInstance, next: CircuitComponentInstance): AttrEdit | null => (next === old ? null : { comp: next });

// ---------------------------------------------------------------------------------------------------------
// Gate input count. Wires keep their pins like in Logisim: wired inputs spread over the new pins (first
// stays first, last stays last), wires of a removed pin stay as open wire ends.
// ---------------------------------------------------------------------------------------------------------

export const MIN_GATE_INPUTS = 2;
export const MAX_GATE_INPUTS = 32;

export function changeGateInputCount(
  comp: CircuitComponentInstance,
  canonicalWires: CircuitWire[],
  targetCount: number
): AttrEdit | null {
  const currentCount = comp.inputs.length;
  const newCount = Math.max(MIN_GATE_INPUTS, Math.min(MAX_GATE_INPUTS, targetCount));
  if (newCount === currentCount) return null;
  const compId = comp.id;

  const oldInputs = comp.inputs;
  const oldPinLocations = oldInputs.map((p) => snapPt10({ x: p.x, y: p.y }));

  const width = getGateWidth(comp);
  const newInputs: CircuitPin[] = Array.from({ length: newCount }).map((_, idx) => {
    const existing = oldInputs[idx];
    return {
      id: compId + '_in' + idx,
      name: String.fromCharCode(65 + idx),
      type: 'input' as const,
      value: existing ? existing.value : 0,
      ...(width > 1 ? { width } : {}),
      x: comp.x,
      y: comp.y, // placed by updatePinPositions
    };
  });
  // A negation belongs to an input slot (like Logisim's negateN): slots that are gone lose theirs
  const negated = comp.state.negated?.filter((i) => i < newCount);
  const state = { ...comp.state, gateInputsCount: newCount };
  if (negated?.length) state.negated = negated;
  else delete state.negated;
  let updatedComp = updatePinPositions({ ...comp, inputs: newInputs, state });
  // A taller (or shorter) body grows around the output like in Logisim: the output pin stays where it was
  const oldOut = comp.outputs[0];
  const newOut = updatedComp.outputs[0];
  if (oldOut && newOut && (oldOut.x !== newOut.x || oldOut.y !== newOut.y)) {
    updatedComp = updatePinPositions({ ...updatedComp, x: updatedComp.x + oldOut.x - newOut.x, y: updatedComp.y + oldOut.y - newOut.y });
  }

  // Which old input pins have wires on them
  const attachedOld = new Set<number>();
  for (const w of canonicalWires) {
    if (w.endPoint) {
      const ep = snapPt10(w.endPoint);
      for (let i = 0; i < currentCount; i++) {
        const loc = oldPinLocations[i];
        if (
          (w.toCompId === compId && w.toPinId === oldInputs[i].id) ||
          ((!w.toCompId || w.toCompId === compId) && ep.x === loc.x && ep.y === loc.y)
        ) {
          attachedOld.add(i);
          break;
        }
      }
    }
    if (w.startPoint) {
      const sp = snapPt10(w.startPoint);
      for (let i = 0; i < currentCount; i++) {
        const loc = oldPinLocations[i];
        if (
          (w.fromCompId === compId && w.fromPinId === oldInputs[i].id) ||
          ((!w.fromCompId || w.fromCompId === compId) && sp.x === loc.x && sp.y === loc.y)
        ) {
          attachedOld.add(i);
          break;
        }
      }
    }
  }
  const connectedOldIndices = Array.from(attachedOld).sort((a, b) => a - b);
  const K = connectedOldIndices.length;

  // Collision-free mapping from old pin index to new pin
  const targetMap = new Map<number, CircuitPin>();
  const claimed = new Set<number>();
  if (K === 1) {
    const oldIdx = connectedOldIndices[0];
    let newIdx = 0;
    if (oldIdx === currentCount - 1 && newCount > 1) newIdx = newCount - 1;
    else if (oldIdx > 0 && oldIdx < currentCount - 1) newIdx = Math.round((oldIdx / (currentCount - 1)) * (newCount - 1));
    targetMap.set(oldIdx, updatedComp.inputs[newIdx]);
    claimed.add(newIdx);
  } else if (K === 2 && newCount >= 2) {
    targetMap.set(connectedOldIndices[0], updatedComp.inputs[0]);
    targetMap.set(connectedOldIndices[1], updatedComp.inputs[newCount - 1]);
    claimed.add(0);
    claimed.add(newCount - 1);
  } else if (K <= newCount) {
    connectedOldIndices.forEach((oldIdx, i) => {
      let newIdx: number;
      if (i === 0) newIdx = 0;
      else if (i === K - 1) newIdx = newCount - 1;
      else newIdx = Math.round((i / (K - 1)) * (newCount - 1));
      while (claimed.has(newIdx) && newIdx < newCount - 1) newIdx++;
      while (claimed.has(newIdx) && newIdx > 0) newIdx--;
      targetMap.set(oldIdx, updatedComp.inputs[newIdx]);
      claimed.add(newIdx);
    });
  } else {
    // More wired pins than new pins (e.g. 3 wires, 2 pins)
    targetMap.set(connectedOldIndices[0], updatedComp.inputs[0]);
    claimed.add(0);
    targetMap.set(connectedOldIndices[K - 1], updatedComp.inputs[newCount - 1]);
    claimed.add(newCount - 1);
    for (let i = 1; i < K - 1; i++) {
      for (let cand = 1; cand < newCount - 1; cand++) {
        if (!claimed.has(cand)) {
          targetMap.set(connectedOldIndices[i], updatedComp.inputs[cand]);
          claimed.add(cand);
          break;
        }
      }
    }
  }
  // Unwired old pins keep their slot where it still exists
  for (let i = 0; i < currentCount; i++) {
    if (!targetMap.has(i) && i < newCount && !claimed.has(i)) {
      targetMap.set(i, updatedComp.inputs[i]);
      claimed.add(i);
    }
  }

  const remap = new Map<string, string | null>();
  oldPinLocations.forEach((loc, i) => remap.set(`${loc.x},${loc.y}`, targetMap.get(i)?.id ?? null));
  return { comp: updatedComp, remap };
}

// ---------------------------------------------------------------------------------------------------------
// Attribute tables
// ---------------------------------------------------------------------------------------------------------

const MULTI_INPUT_GATES = new Set<ComponentType>(MULTI_INPUT_GATE_TYPES as ComponentType[]);

const gateInputsAttr: AttrDef = {
  key: 'inputs',
  label: 'Giriş sayısı',
  kind: 'select',
  title: 'Kapının giriş sayısı; bağlı teller yeni girişlere dağıtılır',
  options: numberOptions(MIN_GATE_INPUTS, MAX_GATE_INPUTS),
  get: (c) => c.inputs.length,
  set: (c, v, wires) => changeGateInputCount(c, wires, Number(v)),
  canonicalWires: true,
};

const outputModeAttr: AttrDef = {
  key: 'outputMode',
  label: 'Çıkış değeri',
  kind: 'buttons',
  options: [
    { value: '01', label: '0/1', title: 'Normal çıkış (0 ve 1 sürer)' },
    { value: '0Z', label: '0/Z', title: 'Açık kollektör: 0 sürer, 1 yerine hattı boş bırakır' },
    { value: 'Z1', label: 'Z/1', title: 'Açık emitör: 1 sürer, 0 yerine hattı boş bırakır' },
  ],
  get: (c) => c.state.outputMode ?? '01',
  set: (c, v) => ((c.state.outputMode ?? '01') === v ? null : withState(c, { outputMode: v as '01' | '0Z' | 'Z1' })),
};

const gateWidthAttr: AttrDef = {
  key: 'gateWidth',
  label: 'Bit genişliği',
  kind: 'select',
  title: 'Veri girişlerinin ve çıkışın bit sayısı (1-32); kapı her biti ayrı hesaplar',
  options: WIDTH_OPTIONS,
  get: (c) => getGateWidth(c),
  set: (c, v) => (getGateWidth(c) === Number(v) ? null : { comp: setGateWidth(c, Number(v)), stateOnly: true }),
};

const negateAttr: AttrDef = {
  key: 'negated',
  label: 'Giriş evirme',
  kind: 'flags',
  title: 'Seçilen girişler kapıya girmeden terslenir (girişte baloncuk)',
  options: (c) => c.inputs.map((p, i) => ({ value: i, label: p.name || String(i + 1), title: `${i + 1}. girişi evir` })),
  get: (c) => [...(c.state.negated ?? [])].sort((a, b) => a - b).join(','),
  set: (c, v) => {
    const op = String(v);
    const idx = Number(op.slice(1));
    if (!/^[+-]\d+$/.test(op) || idx >= c.inputs.length) return null;
    const cur = c.state.negated ?? [];
    const has = cur.includes(idx);
    if ((op[0] === '+') === has) return null;
    const next = op[0] === '+' ? [...cur, idx].sort((a, b) => a - b) : cur.filter((i) => i !== idx);
    const state: CircuitComponentInstance['state'] = { ...c.state, negated: next };
    if (next.length === 0) delete state.negated;
    return { comp: { ...c, state }, stateOnly: true };
  },
};

const xorModeAttr: AttrDef = {
  key: 'xorMode',
  label: 'Çok girişli',
  kind: 'buttons',
  title: 'İkiden çok girişte çıkış ne zaman 1 olur (iki girişte ikisi aynıdır)',
  options: [
    { value: 'odd', label: 'Tek sayıda 1', title: 'Parite: 1 olan giriş sayısı tekse 1' },
    { value: 'one', label: 'Tam bir tane 1', title: 'Yalnızca bir giriş 1 ise 1 (Logisim varsayılanı)' },
  ],
  get: (c) => c.state.xorMode ?? 'odd',
  set: (c, v) => ((c.state.xorMode ?? 'odd') === v ? null : withState(c, { xorMode: v as 'odd' | 'one' })),
};

const bitWidthAttr: AttrDef = {
  key: 'width',
  label: 'Bit genişliği',
  kind: 'select',
  title: 'Pinin taşıdığı bit sayısı (1-32)',
  options: WIDTH_OPTIONS,
  get: (c) => getBitWidth(c),
  set: (c, v) => (getBitWidth(c) === Number(v) ? null : resized(c, setBitWidth(c, Number(v)))),
};

const constantValueAttr: AttrDef = {
  key: 'constValue',
  label: 'Değer (hex)',
  kind: 'hex',
  title: 'Onaltılı değer; genişliğe sığmayan üst bitler atılır',
  get: (c) => c.state.constValue ?? 1,
  set: (c, v) => {
    const n = Number(v) % 2 ** getBitWidth(c);
    return n === (c.state.constValue ?? 1) ? null : withState(c, { constValue: n });
  },
};

const RADIX_OPTIONS: AttrOption[] = [
  { value: '2', label: 'BIN', title: 'İkili (taban 2)' },
  { value: '8', label: 'OCT', title: 'Sekizli (taban 8)' },
  { value: '10u', label: 'DEC', title: 'Onluk, işaretsiz' },
  { value: '10s', label: '±DEC', title: 'Onluk, işaretli (ikiye tümleyen)' },
  { value: '16', label: 'HEX', title: 'Onaltılı (taban 16)' },
];

const radixAttr: AttrDef = {
  key: 'radix',
  label: 'Taban',
  kind: 'buttons',
  options: RADIX_OPTIONS,
  get: (c) => c.state.radix ?? '2',
  set: (c, v) => ((c.state.radix ?? '2') === v ? null : withState(c, { radix: v as Radix })),
};

const splitterAttrs: AttrDef[] = [
  {
    key: 'incoming',
    label: 'Gelen bit',
    kind: 'select',
    title: 'Birleşik uçtaki veri yolunun genişliği (1-32)',
    options: WIDTH_OPTIONS,
    get: (c) => getSplitterConfig(c).bitEnd.length,
    set: (c, v) => (getSplitterConfig(c).bitEnd.length === Number(v) ? null : resized(c, configureSplitter(c, { incoming: Number(v) }))),
  },
  {
    key: 'fanout',
    label: 'Uç sayısı',
    kind: 'select',
    title: 'Ayrılan uç sayısı (1-32); değişince bitler varsayılan düzende yeniden dağıtılır',
    options: numberOptions(1, SPLITTER_MAX_FANOUT),
    get: (c) => getSplitterConfig(c).fanout,
    set: (c, v) => (getSplitterConfig(c).fanout === Number(v) ? null : resized(c, configureSplitter(c, { fanout: Number(v) }))),
  },
  {
    key: 'appear',
    label: 'Görünüm',
    kind: 'buttons',
    options: [
      { value: 'left', label: 'Sol', title: 'Sol elli: uçlar birleşik ucun bir yanında (Logisim varsayılanı)' },
      { value: 'center', label: 'Orta', title: 'Ortalı: uçlar birleşik ucun iki yanına dağılır' },
      { value: 'right', label: 'Sağ', title: 'Sağ elli: uçlar birleşik ucun öbür yanında' },
    ],
    get: (c) => getSplitterConfig(c).appear,
    set: (c, v) =>
      getSplitterConfig(c).appear === v ? null : resized(c, configureSplitter(c, { appear: v as 'left' | 'right' | 'center' })),
  },
  {
    key: 'bitEnd',
    label: 'Bit dağılımı',
    kind: 'bitMap',
    title: 'Her bitin hangi uca gideceği',
    singleOnly: true,
    get: (c) => getSplitterConfig(c).bitEnd.join(','),
    set: (c, v) => {
      const bitEnd = String(v).split(',').map(Number);
      return getSplitterConfig(c).bitEnd.join(',') === bitEnd.join(',') ? null : resized(c, configureSplitter(c, { bitEnd }));
    },
  },
];

const bitExtenderAttrs: AttrDef[] = [
  {
    key: 'inWidth',
    label: 'Giriş bit',
    kind: 'select',
    title: 'Girişteki veri yolunun genişliği (1-32)',
    options: WIDTH_OPTIONS,
    get: (c) => c.inputs[0]?.width ?? 1,
    set: (c, v) => ((c.inputs[0]?.width ?? 1) === Number(v) ? null : resized(c, configureBitExtender(c, { inWidth: Number(v) }))),
  },
  {
    key: 'outWidth',
    label: 'Çıkış bit',
    kind: 'select',
    title: 'Çıkış genişliği (1-32); girişten darsa üst bitler atılır',
    options: WIDTH_OPTIONS,
    get: (c) => c.outputs[0]?.width ?? 1,
    set: (c, v) => ((c.outputs[0]?.width ?? 1) === Number(v) ? null : resized(c, configureBitExtender(c, { outWidth: Number(v) }))),
  },
  {
    key: 'extendType',
    label: 'Doldurma',
    kind: 'buttons',
    options: [
      { value: 'zero', label: '0', title: 'Üst bitler 0 (işaretsiz genişletme)' },
      { value: 'one', label: '1', title: 'Üst bitler 1' },
      { value: 'sign', label: 'İşaret', title: 'Üst bitler girişin en üst biti (işaretli sayı, ikiye tümleyen)' },
      { value: 'input', label: 'Giriş', title: 'Üst bitler üstteki 1 bitlik ek girişten' },
    ],
    get: (c) => c.state.extendType ?? 'zero',
    set: (c, v) =>
      (c.state.extendType ?? 'zero') === v
        ? null
        : resized(c, configureBitExtender(c, { type: v as 'zero' | 'one' | 'sign' | 'input' })),
  },
];

const bitSelectorAttrs: AttrDef[] = [
  {
    key: 'dataWidth',
    label: 'Veri bit',
    kind: 'select',
    title: 'Veri girişinin genişliği (1-32)',
    options: WIDTH_OPTIONS,
    get: (c) => c.inputs[0]?.width ?? 1,
    set: (c, v) => ((c.inputs[0]?.width ?? 1) === Number(v) ? null : resized(c, configureBitSelector(c, { dataWidth: Number(v) }))),
  },
  {
    key: 'groupWidth',
    label: 'Grup bit',
    kind: 'select',
    title: 'Çıkışa verilen grubun genişliği (1-32); verinin dışına taşan bitler 0 olur',
    options: WIDTH_OPTIONS,
    get: (c) => c.outputs[0]?.width ?? 1,
    set: (c, v) => ((c.outputs[0]?.width ?? 1) === Number(v) ? null : resized(c, configureBitSelector(c, { groupWidth: Number(v) }))),
  },
  {
    key: 'selectWidth',
    label: 'Seçme bit',
    kind: 'info',
    title: 'Seçme girişinin genişliği grup sayısına göre kendiliğinden belirlenir',
    get: (c) => c.inputs[1]?.width ?? 1,
  },
];

// ---- Plexers: like Logisim the part grows around its anchor pin (MUX output, DEMUX data input, decoder select,
// priority encoder code output), which stays where it was
const PLEXER_ANCHOR: Record<string, string> = { multiplexer: 'out', demultiplexer: 'in', decoder: 'sel', priorityEncoder: 'out' };

function reconfigurePlexer(c: CircuitComponentInstance, patch: Partial<PlexerConfig>, state?: Partial<CircuitComponentInstance['state']>): AttrEdit {
  const key = PLEXER_ANCHOR[c.type];
  const anchor = [...c.inputs, ...c.outputs].find((p) => pinKey(c, p) === key);
  let next = configurePlexer(state ? { ...c, state: { ...c.state, ...state } } : c, patch);
  const moved = [...next.inputs, ...next.outputs].find((p) => pinKey(next, p) === key);
  if (anchor && moved && (anchor.x !== moved.x || anchor.y !== moved.y)) {
    next = updatePinPositions({ ...next, x: next.x + anchor.x - moved.x, y: next.y + anchor.y - moved.y });
  }
  // Pins keep their ids; a pin that is gone (fewer inputs, enable off) is named null so its wires stay as
  // open ends, or are dropped where another pin now sits (they would short that pin to the old net)
  const kept = new Set([...next.inputs, ...next.outputs].map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of [...c.inputs, ...c.outputs]) {
    const sp = snapPt10(p);
    remap.set(`${sp.x},${sp.y}`, kept.has(p.id) ? p.id : null);
  }
  return { comp: next, remap };
}

const FLOAT_OPTIONS: AttrOption[] = [
  { value: '0', label: '0', title: 'Çıkış 0' },
  { value: 'Z', label: 'Yüzer (x)', title: 'Çıkış sürülmez (x); başka bir sürücüyle aynı hatta bağlanabilir' },
];

const plexerSelectAttr: AttrDef = {
  key: 'plexSelect',
  label: 'Seçme bit',
  kind: 'select',
  title: 'Seçme girişinin genişliği; 2^n veri girişi / çıkışı (1-5)',
  options: Array.from({ length: PLEXER_MAX_SELECT }, (_, i) => ({ value: i + 1, label: `${i + 1}  (${2 ** (i + 1)})` })),
  get: (c) => getPlexerConfig(c).select,
  set: (c, v) => (getPlexerConfig(c).select === Number(v) ? null : reconfigurePlexer(c, { select: Number(v) })),
};

const priorityInputsAttr: AttrDef = {
  ...plexerSelectAttr,
  label: 'Giriş sayısı',
  title: 'Giriş sayısı (2-32); kod çıkışı log2(giriş) bittir',
  options: Array.from({ length: PLEXER_MAX_SELECT }, (_, i) => ({ value: i + 1, label: `${2 ** (i + 1)}  (${i + 1} bit kod)` })),
};

const plexerWidthAttr: AttrDef = {
  key: 'plexWidth',
  label: 'Veri bit',
  kind: 'select',
  title: 'Veri girişlerinin ve çıkışlarının genişliği (1-32)',
  options: WIDTH_OPTIONS,
  get: (c) => getPlexerConfig(c).width,
  set: (c, v) => (getPlexerConfig(c).width === Number(v) ? null : reconfigurePlexer(c, { width: Number(v) })),
};

const plexerEnableAttr: AttrDef = {
  key: 'plexEnable',
  label: 'Enable',
  kind: 'buttons',
  options: [
    { value: 'yes', label: 'Var', title: 'Enable girişi var; 0 iken çıkışlar devre dışı değerini alır' },
    { value: 'no', label: 'Yok', title: 'Enable girişi yok, parça hep çalışır' },
  ],
  get: (c) => (getPlexerConfig(c).enable ? 'yes' : 'no'),
  set: (c, v) => ((getPlexerConfig(c).enable ? 'yes' : 'no') === v ? null : reconfigurePlexer(c, { enable: v === 'yes' })),
};

const plexerDisabledAttr: AttrDef = {
  key: 'plexDisabled',
  label: 'Devre dışı çıkış',
  kind: 'buttons',
  title: 'Enable 0 iken çıkışların değeri (Logisim "Disabled Output")',
  options: FLOAT_OPTIONS,
  get: (c) => c.state.plexDisabled ?? '0',
  set: (c, v) => ((c.state.plexDisabled ?? '0') === v ? null : withState(c, { plexDisabled: v as '0' | 'Z' })),
};

const plexerTristateAttr: AttrDef = {
  key: 'plexTristate',
  label: 'Seçilmeyen çıkış',
  kind: 'buttons',
  title: 'Seçilmeyen çıkışların değeri (Logisim "Three-State")',
  options: FLOAT_OPTIONS,
  get: (c) => (c.state.plexTristate ? 'Z' : '0'),
  set: (c, v) => ((c.state.plexTristate ? 'Z' : '0') === v ? null : withState(c, { plexTristate: v === 'Z' })),
};

const plexerSelectLocAttr: AttrDef = {
  key: 'selectLoc',
  label: 'Seçme bacağı',
  kind: 'buttons',
  title: 'Seçme (ve enable) girişinin bulunduğu kenar (Logisim "Select Location")',
  options: [
    { value: 'bl', label: 'Alt / Sol' },
    { value: 'tr', label: 'Üst / Sağ' },
  ],
  get: (c) => c.state.selectLoc ?? 'bl',
  set: (c, v) => ((c.state.selectLoc ?? 'bl') === v ? null : reconfigurePlexer(c, {}, { selectLoc: v as 'bl' | 'tr' })),
};

// ---- Arithmetic (Logisim std/arith): like Logisim the part keeps its location, the main output; a bit adder
// with more inputs grows around it
function reconfigureArith(c: CircuitComponentInstance, patch: Partial<ArithConfig>): AttrEdit {
  const anchor = c.outputs.find((p) => pinKey(c, p) === 'out');
  let next = configureArith(c, patch);
  const moved = next.outputs.find((p) => pinKey(next, p) === 'out');
  if (anchor && moved && (anchor.x !== moved.x || anchor.y !== moved.y)) {
    next = updatePinPositions({ ...next, x: next.x + anchor.x - moved.x, y: next.y + anchor.y - moved.y });
  }
  // Pins keep their ids (and wires); a removed bit adder input is named null so its wires stay as open ends
  const kept = new Set([...next.inputs, ...next.outputs].map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of [...c.inputs, ...c.outputs]) {
    const sp = snapPt10(p);
    remap.set(`${sp.x},${sp.y}`, kept.has(p.id) ? p.id : null);
  }
  return { comp: next, remap };
}

const arithWidthAttr: AttrDef = {
  key: 'arithWidth',
  label: 'Veri bit',
  kind: 'select',
  title: 'Veri girişlerinin ve çıkışlarının genişliği (1-32)',
  options: WIDTH_OPTIONS,
  get: (c) => getArithConfig(c).width,
  set: (c, v) => (getArithConfig(c).width === Number(v) ? null : reconfigureArith(c, { width: Number(v) })),
};

const bitAdderInputsAttr: AttrDef = {
  key: 'arithInputs',
  label: 'Giriş sayısı',
  kind: 'select',
  title: 'Bitleri sayılan giriş sayısı (1-32); çıkış, en büyük toplamı tutacak kadar geniştir',
  options: numberOptions(1, BIT_ADDER_MAX_INPUTS),
  get: (c) => getArithConfig(c).inputs,
  set: (c, v) => (getArithConfig(c).inputs === Number(v) ? null : reconfigureArith(c, { inputs: Number(v) })),
};

const SIGNED_OPTION: AttrOption = { value: 'signed', label: 'İşaretli', title: 'İkiye tümleyen (Logisim "2\'s Complement")' };
const UNSIGNED_OPTION: AttrOption = { value: 'unsigned', label: 'İşaretsiz', title: 'İşaretsiz sayı (Logisim "Unsigned")' };

const arithModeAttr: AttrDef = {
  key: 'arithMode',
  label: 'Sayı türü',
  kind: 'buttons',
  title: 'Girişlerin nasıl okunduğu (Logisim "Numeric Type")',
  options: [SIGNED_OPTION, UNSIGNED_OPTION],
  get: (c) => getArithMode(c),
  set: (c, v) => (getArithMode(c) === v ? null : withState(c, { arithMode: v as 'signed' | 'unsigned' })),
};

const multiplierModeAttr: AttrDef = {
  ...arithModeAttr,
  options: [
    SIGNED_OPTION,
    { value: 'signedUnsigned', label: 'İşaretli × işaretsiz', title: 'A işaretli, B işaretsiz okunur (Logisim-evolution)' },
    UNSIGNED_OPTION,
  ],
  set: (c, v) => (getArithMode(c) === v ? null : withState(c, { arithMode: v as 'signed' | 'signedUnsigned' | 'unsigned' })),
};

const shiftTypeAttr: AttrDef = {
  key: 'shiftType',
  label: 'Kaydırma',
  kind: 'select',
  title: 'Kaydırma türü (Logisim "Shift Type")',
  options: [
    { value: 'll', label: 'Mantıksal sola' },
    { value: 'lr', label: 'Mantıksal sağa' },
    { value: 'ar', label: 'Aritmetik sağa' },
    { value: 'rl', label: 'Sola döndür' },
    { value: 'rr', label: 'Sağa döndür' },
  ],
  get: (c) => c.state.shiftType ?? 'll',
  set: (c, v) => ((c.state.shiftType ?? 'll') === v ? null : withState(c, { shiftType: v as 'll' | 'lr' | 'ar' | 'rl' | 'rr' })),
};

const findTypeAttr: AttrDef = {
  key: 'findType',
  label: 'Aranan',
  kind: 'select',
  title: 'Hangi bitin numarası verilir (Logisim "Type")',
  options: [
    { value: 'low1', label: 'En düşük 1' },
    { value: 'high1', label: 'En yüksek 1' },
    { value: 'low0', label: 'En düşük 0' },
    { value: 'high0', label: 'En yüksek 0' },
  ],
  get: (c) => c.state.findType ?? 'low1',
  set: (c, v) => ((c.state.findType ?? 'low1') === v ? null : withState(c, { findType: v as 'low1' | 'high1' | 'low0' | 'high0' })),
};

const pullAttr: AttrDef = {
  key: 'pullValue',
  label: 'Çekilen değer',
  kind: 'buttons',
  options: [
    { value: 0, label: '0', title: 'Pull-down (0)' },
    { value: 1, label: '1', title: 'Pull-up (1)' },
    { value: 'X', label: 'X', title: 'Hata (E)' },
  ],
  get: (c) => c.state.pullValue ?? 0,
  set: (c, v) => ((c.state.pullValue ?? 0) === v ? null : withState(c, { pullValue: v as 0 | 1 | 'X' })),
};

const ledColorAttr: AttrDef = {
  key: 'ledColor',
  label: 'Renk',
  kind: 'buttons',
  options: [
    { value: 'green', label: 'Yeşil', swatch: '#10b981' },
    { value: 'red', label: 'Kırmızı', swatch: '#f43f5e' },
    { value: 'blue', label: 'Mavi', swatch: '#3b82f6' },
    { value: 'yellow', label: 'Sarı', swatch: '#fbbf24' },
  ],
  get: (c) => c.state.ledColor || 'green',
  set: (c, v) => ((c.state.ledColor || 'green') === v ? null : withState(c, { ledColor: v as 'green' | 'red' | 'blue' | 'yellow' })),
};

const CLOCK_RATES = [0.5, 1, 2, 4, 6, 8];
const clockRateAttr: AttrDef = {
  key: 'clockRateHz',
  label: 'Hız',
  kind: 'buttons',
  options: (_c, ctx) => [
    { value: 'global', label: `Genel (${ctx.clockHz}Hz)`, title: 'Genel saat hızını kullan' },
    ...CLOCK_RATES.map((hz) => ({ value: hz, label: `${hz}Hz` })),
  ],
  get: (c) => c.state.clockRateHz ?? 'global',
  set: (c, v) => {
    if ((c.state.clockRateHz ?? 'global') === v) return null;
    if (v === 'global') {
      const { clockRateHz: _drop, ...rest } = c.state;
      void _drop;
      return { comp: { ...c, state: rest }, stateOnly: true };
    }
    return withState(c, { clockRateHz: Number(v) });
  },
};

const labelPosAttr: AttrDef = {
  key: 'labelPos',
  label: 'Etiket yeri',
  kind: 'buttons',
  options: [
    { value: 'top', label: 'Üst' },
    { value: 'bottom', label: 'Alt' },
    { value: 'center', label: 'Orta' },
    { value: 'hidden', label: 'Gizli' },
  ],
  get: (c) => c.state.labelPos || 'bottom',
  set: (c, v) =>
    (c.state.labelPos || 'bottom') === v ? null : withState(c, { labelPos: v as 'top' | 'bottom' | 'center' | 'hidden' }),
};

/** Attributes of a part type, in panel order (the label text itself is a field of the panel) */
export function getComponentAttributes(type: ComponentType): AttrDef[] {
  const list: AttrDef[] = [];
  if (GATE_WIDTH_TYPES.includes(type)) list.push(gateWidthAttr);
  if (MULTI_INPUT_GATES.has(type)) list.push(gateInputsAttr, negateAttr);
  if (type === 'xor' || type === 'xnor') list.push(xorModeAttr);
  if (OUTPUT_MODE_TYPES.includes(type)) list.push(outputModeAttr);
  switch (type) {
    case 'switch':
    case 'led':
      list.push(bitWidthAttr);
      break;
    case 'constant':
      list.push(bitWidthAttr, constantValueAttr);
      break;
    case 'probe':
      list.push(radixAttr);
      break;
    case 'splitter':
      list.push(...splitterAttrs);
      break;
    case 'bitExtender':
      list.push(...bitExtenderAttrs);
      break;
    case 'bitSelector':
      list.push(...bitSelectorAttrs);
      break;
    case 'multiplexer':
      list.push(plexerSelectAttr, plexerWidthAttr, plexerEnableAttr, plexerDisabledAttr, plexerSelectLocAttr);
      break;
    case 'demultiplexer':
      list.push(plexerSelectAttr, plexerWidthAttr, plexerEnableAttr, plexerDisabledAttr, plexerTristateAttr, plexerSelectLocAttr);
      break;
    case 'decoder':
      list.push(plexerSelectAttr, plexerEnableAttr, plexerDisabledAttr, plexerTristateAttr, plexerSelectLocAttr);
      break;
    case 'priorityEncoder':
      list.push(priorityInputsAttr, plexerDisabledAttr);
      break;
    case 'comparator':
    case 'divider':
    case 'minMax':
    case 'exponentiator':
      list.push(arithWidthAttr, arithModeAttr);
      break;
    case 'multiplier':
      list.push(arithWidthAttr, multiplierModeAttr);
      break;
    case 'shifter':
      list.push(arithWidthAttr, shiftTypeAttr);
      break;
    case 'bitFinder':
      list.push(arithWidthAttr, findTypeAttr);
      break;
    case 'bitAdder':
      list.push(arithWidthAttr, bitAdderInputsAttr);
      break;
    case 'pullResistor':
      list.push(pullAttr);
      break;
    case 'clock':
      list.push(clockRateAttr);
      break;
    case 'register':
      list.push(memWidthAttr, triggerAttr);
      break;
    case 'counter':
      list.push(memWidthAttr, counterMaxAttr, counterGoalAttr, triggerAttr);
      break;
    case 'shiftRegister':
      list.push(memWidthAttr, shiftLengthAttr, shiftParallelAttr, triggerAttr);
      break;
    case 'ram':
      list.push(ramAddrAttr, ramDataAttr, ramFlavorAttr, ramBusAttr, ramDataBusAttr, ramTriggerAttr, ramAsyncReadAttr, ramReadBehaviorAttr, ramByteEnablesAttr, ramClearPinAttr);
      break;
    case 'dualRam':
      // Logisim-evolution only: no rules switch
      list.push(ramAddrAttr, ramDataAttr, ramDataBusAttr, ramTriggerAttr, ramAsyncReadAttr, ramReadBehaviorAttr, ramByteEnablesAttr, ramClearPinAttr);
      break;
    case 'rom':
      list.push(ramAddrAttr, ramDataAttr, ramFlavorAttr);
      break;
    case 'random':
      list.push(randomWidthAttr, randomSeedAttr, triggerAttr);
      break;
  }
  if (MEM_TYPES.has(type) && !list.includes(triggerAttr)) list.push(triggerAttr);
  // Adder, subtractor, negator, absolute, square root: data width only
  if (ARITH_TYPES.has(type) && !list.includes(arithWidthAttr)) list.push(arithWidthAttr);
  if (type === 'led') list.push(ledColorAttr);
  if (type !== 'textLabel') list.push(labelPosAttr);
  return list;
}

// ---- Memory (Logisim std/memory): like Logisim the part keeps its location (register / counter: Q; shift
// register: the serial input); stage pins of a shorter shift register vanish and their wires stay as open ends
function reconfigureMem(c: CircuitComponentInstance, patch: Partial<MemConfig>): AttrEdit {
  const key = c.type === 'shiftRegister' ? 'in' : 'q';
  const find = (x: CircuitComponentInstance) => [...x.inputs, ...x.outputs].find((p) => pinKey(x, p) === key);
  const anchor = find(c);
  let next = configureMem(c, patch);
  const moved = find(next);
  if (anchor && moved && (anchor.x !== moved.x || anchor.y !== moved.y)) {
    next = updatePinPositions({ ...next, x: next.x + anchor.x - moved.x, y: next.y + anchor.y - moved.y });
  }
  const kept = new Set([...next.inputs, ...next.outputs].map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of [...c.inputs, ...c.outputs]) {
    const sp = snapPt10(p);
    remap.set(`${sp.x},${sp.y}`, kept.has(p.id) ? p.id : null);
  }
  return { comp: next, remap };
}

const TRIGGER_OPTIONS: AttrOption[] = [
  { value: 'rising', label: 'Yükselen kenar', title: '0 → 1 geçişinde (Logisim "Rising Edge")' },
  { value: 'falling', label: 'Düşen kenar', title: '1 → 0 geçişinde (Logisim "Falling Edge")' },
  { value: 'high', label: 'Yüksek seviye', title: 'Saat 1 olduğu sürece; mandal gibi saydamdır (Logisim "High Level")' },
  { value: 'low', label: 'Düşük seviye', title: 'Saat 0 olduğu sürece; mandal gibi saydamdır (Logisim "Low Level")' },
];

const triggerAttr: AttrDef = {
  key: 'trigger',
  label: 'Tetikleme',
  kind: 'select',
  title: 'Saatin ne zaman etki ettiği (Logisim "Trigger"); T, J-K, sayaç ve kaydırmalı yazmaç yalnız kenarla tetiklenir',
  options: (c) => (LEVEL_TRIGGER_TYPES.has(c.type) ? TRIGGER_OPTIONS : TRIGGER_OPTIONS.slice(0, 2)),
  get: (c) => getTrigger(c),
  set: (c, v) => (getTrigger(c) === v ? null : withState(c, { trigger: v as TriggerMode })),
};

const memWidthAttr: AttrDef = {
  key: 'memWidth',
  label: 'Veri bit',
  kind: 'select',
  title: 'Saklanan değerin ve veri pinlerinin genişliği (1-32)',
  options: WIDTH_OPTIONS,
  get: (c) => getMemConfig(c).width,
  set: (c, v) => (getMemConfig(c).width === Number(v) ? null : reconfigureMem(c, { width: Number(v) })),
};

const counterMaxAttr: AttrDef = {
  key: 'counterMax',
  label: 'Üst sınır (hex)',
  kind: 'hex',
  title: 'Sayacın en büyük değeri (Logisim "Maximum Value"); genişliğe sığmayan üst bitler atılır',
  get: (c) => getCounterMax(c),
  set: (c, v) => {
    const n = Number(v) % 2 ** getMemConfig(c).width;
    return n === getCounterMax(c) ? null : withState(c, { counterMax: n });
  },
};

const counterGoalAttr: AttrDef = {
  key: 'counterGoal',
  label: 'Sınırda',
  kind: 'select',
  title: 'Sayaç hedefe (yukarı: üst sınır, aşağı: 0) ulaşmışken gelen sayma darbesi (Logisim "Action On Overflow")',
  options: [
    { value: 'wrap', label: 'Başa dön', title: "Yukarı sayarken 0'a, aşağı sayarken üst sınıra geçer" },
    { value: 'stay', label: 'Dur', title: 'Değer hedefte kalır' },
    { value: 'continue', label: 'Devam et', title: 'Sınırı aşıp saymaya devam eder (genişlik dolunca başa döner)' },
    { value: 'load', label: 'Yükle', title: 'D girişindeki değeri yükler' },
  ],
  get: (c) => c.state.counterGoal ?? 'wrap',
  set: (c, v) => ((c.state.counterGoal ?? 'wrap') === v ? null : withState(c, { counterGoal: v as 'wrap' | 'stay' | 'continue' | 'load' })),
};

const shiftLengthAttr: AttrDef = {
  key: 'shiftLength',
  label: 'Aşama sayısı',
  kind: 'select',
  title: 'Kaydırmalı yazmacın aşama sayısı (Logisim "Number of Stages", 1-32)',
  options: numberOptions(1, SHIFT_REGISTER_MAX_LENGTH),
  get: (c) => getMemConfig(c).length,
  set: (c, v) => (getMemConfig(c).length === Number(v) ? null : reconfigureMem(c, { length: Number(v) })),
};

const shiftParallelAttr: AttrDef = {
  key: 'shiftParallel',
  label: 'Paralel yükleme',
  kind: 'buttons',
  title: 'Üstte paralel girişler + LD, altta aşama çıkışları (Logisim "Parallel Load")',
  options: [
    { value: 'on', label: 'Açık' },
    { value: 'off', label: 'Kapalı' },
  ],
  get: (c) => (getMemConfig(c).parallel ? 'on' : 'off'),
  set: (c, v) => ((getMemConfig(c).parallel ? 'on' : 'off') === v ? null : reconfigureMem(c, { parallel: v === 'on' })),
};

// ---- RAM / ROM / random generator (Logisim std/memory Ram, Rom, Random). The box never changes size, so pins keep
// their places; pins a setting removes are named null (their wires stay as open ends)
function reconfigureRam(c: CircuitComponentInstance, patch: Partial<RamConfig>): AttrEdit | null {
  const cur = getRamConfig(c);
  if ((Object.keys(patch) as (keyof RamConfig)[]).every((k) => cur[k] === patch[k])) return null;
  const next = configureRam(c, patch);
  const kept = new Set([...next.inputs, ...next.outputs].map((p) => p.id));
  const remap = new Map<string, string | null>();
  for (const p of [...c.outputs, ...c.inputs]) {
    const sp = snapPt10(p);
    // 'd' and 'dio' share a point: the output's id names the point when it stays
    const key = `${sp.x},${sp.y}`;
    if (remap.get(key)) continue;
    remap.set(key, kept.has(p.id) ? p.id : null);
  }
  return { comp: next, remap };
}

const isEvo = (c: CircuitComponentInstance) => (c.state.memFlavor ?? 'logisim') === 'evolution';
const isEdge = (c: CircuitComponentInstance) => {
  const t = c.state.trigger ?? 'rising';
  return t === 'rising' || t === 'falling';
};

const ramAddrAttr: AttrDef = {
  key: 'ramAddr',
  label: 'Adres bit',
  kind: 'select',
  title: `Adres girişinin genişliği (${RAM_ADDR_MIN}-${RAM_ADDR_MAX}); bellek 2^n kelimedir. Küçülünce aralık dışındaki kelimeler silinir`,
  options: range(RAM_ADDR_MIN, RAM_ADDR_MAX).map((n) => ({ value: n, label: `${n}  (${memSizeText(n)})` })),
  get: (c) => getRamConfig(c).addrWidth,
  set: (c, v) => reconfigureRam(c, { addrWidth: Number(v) }),
};

const ramDataAttr: AttrDef = {
  key: 'ramData',
  label: 'Veri bit',
  kind: 'select',
  title: 'Kelime genişliği (1-32); küçülünce saklanan kelimelerin üst bitleri atılır',
  options: WIDTH_OPTIONS,
  get: (c) => getRamConfig(c).dataWidth,
  set: (c, v) => reconfigureRam(c, { dataWidth: Number(v) }),
};

const ramFlavorAttr: AttrDef = {
  key: 'memFlavor',
  label: 'Kurallar',
  kind: 'buttons',
  title: 'Parçanın hangi Logisim sürümünün kurallarıyla çalıştığı; bacaklar buna göre değişir',
  options: [
    { value: 'logisim', label: '2.7.1', title: 'Logisim 2.7.1: sel (seçme) bacağı, yükselen kenarda yazma, okuma hep anında' },
    { value: 'evolution', label: 'evolution', title: 'Logisim-evolution: sel yok; RAM\'de WE bacağı, tetikleme seçimi, saatli ya da anında okuma' },
  ],
  get: (c) => getRamConfig(c).flavor,
  set: (c, v) => reconfigureRam(c, { flavor: v as RamConfig['flavor'] }),
};

const ramBusAttr: AttrDef = {
  key: 'ramBus',
  label: 'Veri yolu',
  kind: 'select',
  title: 'Logisim 2.7.1 "Data Interface"',
  options: [
    { value: 'combined', label: 'Ortak (tek D)', title: 'Okuma ve yazma aynı D bacağından; ld = 0 iken kenarda D\'deki değer yazılır' },
    { value: 'asynch', label: 'Asenkron (saatsiz)', title: 'Ortak D, saat bacağı yok: ld = 0 olduğu sürece yazılır' },
    { value: 'separate', label: 'Ayrı (D + DIN)', title: 'Yazma ayrı DIN bacağından, str (WE) = 1 iken kenarda' },
  ],
  visible: (c) => !isEvo(c),
  get: (c) => getRamConfig(c).bus,
  set: (c, v) => reconfigureRam(c, { bus: v as RamConfig['bus'] }),
};

const ramDataBusAttr: AttrDef = {
  key: 'ramDataBus',
  label: 'Veri yolu',
  kind: 'select',
  title: 'Logisim-evolution "Data Interface"',
  options: [
    { value: 'separate', label: 'Ayrı (D + DIN)', title: 'Okuma D\'den, yazma DIN\'den; OE = 0 iken D son değerini korur' },
    { value: 'controlled', label: 'Ayrı, kontrollü', title: 'Ayrı D ve DIN; OE = 0 iken D yüzer' },
    { value: 'bidir', label: 'Çift yönlü (tek D)', title: 'Okuma ve yazma aynı D bacağından; OE = 0 iken D yüzer' },
  ],
  visible: isEvo,
  get: (c) => getRamConfig(c).dataBus,
  set: (c, v) => reconfigureRam(c, { dataBus: v as RamConfig['dataBus'] }),
};

const ramTriggerAttr: AttrDef = {
  key: 'ramTrigger',
  label: 'Tetikleme',
  kind: 'select',
  title: 'Yazmanın ne zaman olduğu (Logisim-evolution "Trigger"); seviyede saat bacağı yoktur, WE seviyesi yazar',
  options: TRIGGER_OPTIONS,
  visible: isEvo,
  get: (c) => getRamConfig(c).trigger,
  set: (c, v) => reconfigureRam(c, { trigger: v as RamConfig['trigger'] }),
};

const ramAsyncReadAttr: AttrDef = {
  key: 'ramAsyncRead',
  label: 'Okuma',
  kind: 'buttons',
  title: 'Logisim-evolution "Asynchronous Read"; seviye tetiklemede okuma hep anındadır',
  options: [
    { value: 'off', label: 'Saatli', title: 'D yalnız saat kenarında güncellenir (evolution varsayılanı)' },
    { value: 'on', label: 'Anında', title: 'D, adres değişince hemen güncellenir' },
  ],
  visible: (c) => isEvo(c) && isEdge(c),
  get: (c) => (c.state.ramAsyncRead ? 'on' : 'off'),
  set: (c, v) => ((c.state.ramAsyncRead ? 'on' : 'off') === v ? null : withState(c, { ramAsyncRead: v === 'on' })),
};

const ramReadBehaviorAttr: AttrDef = {
  key: 'ramReadBehavior',
  label: 'Aynı kenarda',
  kind: 'buttons',
  title: 'Saatli okumada, aynı adrese yazılan kenarda D\'ye çıkan değer (Logisim-evolution "Read Behavior")',
  options: [
    { value: 'raw', label: 'Yeni değer', title: 'Read after write: yazılan değer okunur' },
    { value: 'war', label: 'Eski değer', title: 'Write after read: yazmadan önceki değer okunur' },
  ],
  visible: (c) => isEvo(c) && isEdge(c) && !c.state.ramAsyncRead,
  get: (c) => c.state.ramReadBehavior ?? 'raw',
  set: (c, v) => ((c.state.ramReadBehavior ?? 'raw') === v ? null : withState(c, { ramReadBehavior: v as 'raw' | 'war' })),
};

const ramByteEnablesAttr: AttrDef = {
  key: 'ramByteEnables',
  label: 'Bayt seçme',
  kind: 'buttons',
  title: 'Her 8 veri biti için bir BE bacağı; yalnız 1 olan baytlar yazılır (Logisim-evolution "Byte Enables"). Veri 8 bitten geniş ve tetikleme kenar olmalı',
  options: [
    { value: 'on', label: 'Açık' },
    { value: 'off', label: 'Kapalı' },
  ],
  visible: (c) => isEvo(c) && isEdge(c) && getRamConfig(c).dataWidth > 8,
  get: (c) => (getRamConfig(c).byteEnables ? 'on' : 'off'),
  set: (c, v) => reconfigureRam(c, { byteEnables: v === 'on' }),
};

const ramClearPinAttr: AttrDef = {
  key: 'ramClearPin',
  label: 'CLR bacağı',
  kind: 'buttons',
  title: 'CLR = 1 iken bütün kelimeler 0 olur (Logisim-evolution "Clear Pin")',
  options: [
    { value: 'on', label: 'Var' },
    { value: 'off', label: 'Yok' },
  ],
  visible: isEvo,
  get: (c) => (getRamConfig(c).clearPin ? 'on' : 'off'),
  set: (c, v) => reconfigureRam(c, { clearPin: v === 'on' }),
};

const randomWidthAttr: AttrDef = {
  key: 'randomWidth',
  label: 'Bit genişliği',
  kind: 'select',
  title: 'Çıkışın genişliği (1-32): üretilen 32 bitlik sayının düşük bitleri',
  options: WIDTH_OPTIONS,
  get: (c) => getRamConfig(c).dataWidth,
  set: (c, v) => reconfigureRam(c, { dataWidth: Number(v) }),
};

const randomSeedAttr: AttrDef = {
  key: 'randomSeed',
  label: 'Tohum',
  kind: 'int',
  title: 'Dizinin başlangıcı (Logisim "Seed"); 0 = her başlangıçta zamandan. Yeni tohum, bir sonraki RST = 1\'de geçerli olur',
  get: (c) => c.state.randomSeed ?? 0,
  set: (c, v) => {
    const n = Number(v) | 0;
    return n === (c.state.randomSeed ?? 0) ? null : withState(c, { randomSeed: n });
  },
};

/** Memory size text: 256, 1K, 64K, 16M words */
export function memSizeText(addrBits: number): string {
  if (addrBits >= 20) return `${2 ** (addrBits - 20)}M`;
  if (addrBits >= 10) return `${2 ** (addrBits - 10)}K`;
  return String(2 ** addrBits);
}

/** Parse a decimal integer field (32-bit signed); undefined when it isn't one */
export function parseIntAttr(text: string): number | undefined {
  const t = text.trim();
  if (!/^-?\d+$/.test(t)) return undefined;
  const n = Number(t);
  return n >= -(2 ** 31) && n < 2 ** 31 ? n : undefined;
}

export const resolveAttrOptions =(def: AttrDef, comp: CircuitComponentInstance, ctx: AttrContext): AttrOption[] =>
  typeof def.options === 'function' ? def.options(comp, ctx) : def.options ?? [];

/** Parse a hex text field; undefined when it isn't a hex number */
export function parseHexAttr(text: string): number | undefined {
  const t = text.trim().replace(/^0x/i, '');
  return /^[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : undefined;
}

/**
 * Apply one attribute value to several parts. Returns the edited parts (the others unchanged), one combined
 * pin remap and whether any pin moved (wires must follow), or null when no part changed.
 */
export function applyAttribute(
  def: AttrDef,
  value: AttrValue,
  comps: CircuitComponentInstance[],
  targetIds: string[],
  wires: CircuitWire[]
): { comps: CircuitComponentInstance[]; remap: Map<string, string | null>; rewire: boolean } | null {
  if (!def.set) return null;
  const ids = new Set(targetIds);
  const remap = new Map<string, string | null>();
  let changed = false;
  let rewire = false;
  const next = comps.map((c) => {
    if (!ids.has(c.id)) return c;
    const edit = def.set!(c, value, wires);
    if (!edit) return c;
    changed = true;
    if (edit.stateOnly) return edit.comp;
    rewire = true;
    if (edit.remap) {
      for (const [k, v] of edit.remap) remap.set(k, v);
    } else {
      for (const p of [...c.inputs, ...c.outputs]) {
        const sp = snapPt10(p);
        remap.set(`${sp.x},${sp.y}`, p.id);
      }
    }
    return edit.comp;
  });
  return changed ? { comps: next, remap, rewire } : null;
}
