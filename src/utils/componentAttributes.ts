/**
 * Attribute table of each part type (Logisim's attribute panel). Each attribute knows how to read its value
 * from a part and how to give a part a new value; the attribute panel draws the rows and applies the
 * change to every selected part of the same type in one undo step.
 */
import type { CircuitComponentInstance, CircuitPin, CircuitWire, ComponentType } from '../types/circuit';
import { MAX_BIT_WIDTH, type Radix } from '../types/logic';
import {
  GATE_WIDTH_TYPES,
  MULTI_INPUT_GATE_TYPES,
  OUTPUT_MODE_TYPES,
  SPLITTER_MAX_FANOUT,
  configureBitExtender,
  configureBitSelector,
  configureSplitter,
  getBitWidth,
  getGateWidth,
  getSplitterConfig,
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
export const MAX_GATE_INPUTS = 5;

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
  const updatedComp = updatePinPositions({ ...comp, inputs: newInputs, state });

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
  kind: 'buttons',
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
    case 'pullResistor':
      list.push(pullAttr);
      break;
    case 'clock':
      list.push(clockRateAttr);
      break;
  }
  if (type === 'led') list.push(ledColorAttr);
  if (type !== 'textLabel') list.push(labelPosAttr);
  return list;
}

export const resolveAttrOptions = (def: AttrDef, comp: CircuitComponentInstance, ctx: AttrContext): AttrOption[] =>
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
