/**
 * 7400-series TTL chips (Logisim-evolution std/ttl, Aşama 4). Each chip is a DIP package with its real pin
 * numbering: pin 1 bottom-left, counting anticlockwise, so the last pin is top-left (notch on the left when
 * facing east). Like evolution's AbstractTtlGate:
 * - the ports are the physical pins in order, without the unused (NC) pins and without VCC / GND;
 * - with "VCC/GND pins" on, GND and VCC are two extra inputs; unless GND reads 0 and VCC reads 1 every output
 *   floats;
 * - the body is pins x 10 wide and 60 high, pins 20px apart on the top and bottom edges.
 * The chip logic is evolution's propagateTtl, written over the same port indices.
 */
import type { SignalValue } from '../types/logic';
import { TTL_CHIP_IDS, type TtlChipId, type TtlType } from '../types/circuit';

export type TtlGroup = 'gates' | 'plexers' | 'arith' | 'sequential' | 'drivers';

export const TTL_GROUP_TITLES: Record<TtlGroup, string> = {
  gates: 'TTL: Kapılar',
  plexers: 'TTL: Kod Çözücü / Seçici',
  arith: 'TTL: Aritmetik / Karşılaştırıcı',
  sequential: 'TTL: Flip-Flop / Sayaç / Yazmaç',
  drivers: 'TTL: Tampon / Sürücü',
};

/** Port values in evolution's port order; the chip returns the values of the output ports it sets */
export type TtlEval = (p: SignalValue[]) => (SignalValue | undefined)[];

export interface TtlChip {
  /** Evolution tool id, also the .circ element name ("7400") */
  id: TtlChipId;
  pins: number;
  /** Output pins (physical numbers) */
  out: number[];
  /** Not connected pins */
  unused?: number[];
  vcc: number;
  gnd: number;
  /** Port names in port order (datasheet names) */
  names: string[];
  /** Short title, e.g. "Dörtlü 2 girişli NAND" */
  title: string;
  description: string;
  group: TtlGroup;
  /** Package height (evolution's height argument); unset = 60 */
  height?: number;
  /** Open-collector outputs: they pull low or float, never drive 1 */
  openCollector?: boolean;
  eval: TtlEval;
}

// ---- Logisim Value rules for one bit (Value.and / or / not / xor) ----------------------------------------
const lvl = (v: SignalValue): v is 0 | 1 => v === 0 || v === 1;
const not = (a: SignalValue): SignalValue => (lvl(a) ? (a === 1 ? 0 : 1) : 'E');
const and = (...xs: SignalValue[]): SignalValue => xs.reduce((a, b) => (a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 'E'));
const or = (...xs: SignalValue[]): SignalValue => xs.reduce((a, b) => (a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 'E'));
const xor = (a: SignalValue, b: SignalValue): SignalValue => (lvl(a) && lvl(b) ? ((a ^ b) as 0 | 1) : 'E');
const nand = (...xs: SignalValue[]) => not(and(...xs));
const nor = (...xs: SignalValue[]) => not(or(...xs));
const buf = (a: SignalValue): SignalValue => a;
/** Evolution's floating output (Value.UNKNOWN) */
const FLOAT: SignalValue = 'Z';

type Op2 = (a: SignalValue, b: SignalValue) => SignalValue;
type Op1 = (a: SignalValue) => SignalValue;

const QUAD_NAMES = ['1A', '1B', '1Y', '2A', '2B', '2Y', '3Y', '3A', '3B', '4Y', '4A', '4B'];
const HEX_NAMES = ['1A', '1Y', '2A', '2Y', '3A', '3Y', '4Y', '4A', '5Y', '5A', '6Y', '6A'];

interface Info {
  title: string;
  description: string;
}

/** Quad 2-input gate, outputs on pins 3, 6, 8, 11 (7400 pinout) */
function quad(id: TtlChipId, op: Op2, info: Info, extra: Partial<TtlChip> = {}): TtlChip {
  return {
    id, pins: 14, out: [3, 6, 8, 11], vcc: 14, gnd: 7, names: QUAD_NAMES, group: 'gates', ...info, ...extra,
    eval: (p) => {
      const o: SignalValue[] = [];
      for (const i of [2, 5]) o[i] = op(p[i - 1], p[i - 2]);
      for (const i of [6, 9]) o[i] = op(p[i + 1], p[i + 2]);
      return o;
    },
  };
}

/** Hex 1-input gate, outputs on pins 2, 4, 6, 8, 10, 12 (7404 pinout) */
function hex(id: TtlChipId, op: Op1, info: Info, extra: Partial<TtlChip> = {}): TtlChip {
  return {
    id, pins: 14, out: [2, 4, 6, 8, 10, 12], vcc: 14, gnd: 7, names: HEX_NAMES, group: 'gates', ...info, ...extra,
    eval: (p) => {
      const o: SignalValue[] = [];
      for (const i of [1, 3, 5]) o[i] = op(p[i - 1]);
      for (const i of [6, 8, 10]) o[i] = op(p[i + 1]);
      return o;
    },
  };
}

/** Triple 3-input gate (7410 pinout: 1Y on pin 12, 2Y pin 6, 3Y pin 8) */
function triple(id: TtlChipId, op: (...xs: SignalValue[]) => SignalValue, info: Info): TtlChip {
  return {
    id, pins: 14, out: [6, 8, 12], vcc: 14, gnd: 7, group: 'gates', ...info,
    names: ['1A', '1B', '2A', '2B', '2C', '2Y', '3Y', '3A', '3B', '3C', '1Y', '1C'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = op(p[2], p[3], p[4]);
      o[10] = op(p[0], p[1], p[11]);
      o[6] = op(p[7], p[8], p[9]);
      return o;
    },
  };
}

/** Dual 4-input gate (7420 pinout, pins 3 and 11 not connected) */
function dual4(id: TtlChipId, op: (...xs: SignalValue[]) => SignalValue, info: Info): TtlChip {
  return {
    id, pins: 14, out: [6, 8], unused: [3, 11], vcc: 14, gnd: 7, group: 'gates', ...info,
    names: ['1A', '1B', '1C', '1D', '1Y', '2Y', '2A', '2B', '2C', '2D'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[4] = op(p[0], p[1], p[2], p[3]);
      o[5] = op(p[6], p[7], p[8], p[9]);
      return o;
    },
  };
}

/** Evolution 7405 / 74266: pulls low, releases (floats) for a high, E for an undefined value */
const ocLow = (high: SignalValue): SignalValue => (high === 1 ? FLOAT : high === 0 ? 0 : 'E');

const CHIPS: TtlChip[] = [
  quad('7400', nand, { title: 'Dörtlü 2 girişli NAND', description: 'Dört adet 2 girişli VE DEĞİL kapısı.' }),
  {
    id: '7402', pins: 14, out: [1, 4, 10, 13], vcc: 14, gnd: 7, group: 'gates',
    title: 'Dörtlü 2 girişli NOR', description: 'Dört adet 2 girişli VEYA DEĞİL kapısı; çıkışlar 1, 4, 10, 13 numaralı bacaklarda.',
    names: ['1Y', '1A', '1B', '2Y', '2A', '2B', '3A', '3B', '3Y', '4A', '4B', '4Y'],
    eval: (p) => {
      const o: SignalValue[] = [];
      for (const i of [0, 3]) o[i] = nor(p[i + 1], p[i + 2]);
      for (const i of [8, 11]) o[i] = nor(p[i - 1], p[i - 2]);
      return o;
    },
  },
  hex('7404', not, { title: 'Altılı DEĞİL (evirici)', description: 'Altı adet evirici.' }),
  // Evolution openDrain(input): 1 pulls low, 0 floats, anything else E
  hex('7405', (a) => ocLow(not(a)), {
    title: 'Altılı açık kollektörlü evirici',
    description: 'Altı adet açık kollektörlü evirici: giriş 1 iken çıkışı 0\'a çeker, giriş 0 iken çıkış boşta kalır (pull-up direnci gerekir).',
  }, { openCollector: true }),
  quad('7408', (a, b) => and(a, b), { title: 'Dörtlü 2 girişli AND', description: 'Dört adet 2 girişli VE kapısı.' }),
  triple('7410', nand, { title: 'Üçlü 3 girişli NAND', description: 'Üç adet 3 girişli VE DEĞİL kapısı.' }),
  triple('7411', and, { title: 'Üçlü 3 girişli AND', description: 'Üç adet 3 girişli VE kapısı.' }),
  dual4('7413', nand, { title: 'Çift 4 girişli Schmitt NAND', description: 'İki adet 4 girişli Schmitt tetiklemeli VE DEĞİL kapısı (mantık olarak 7420 ile aynı).' }),
  hex('7414', not, { title: 'Altılı Schmitt evirici', description: 'Altı adet Schmitt tetiklemeli evirici (mantık olarak 7404 ile aynı).' }),
  dual4('7418', nand, { title: 'Çift 4 girişli Schmitt NAND', description: 'İki adet 4 girişli Schmitt tetiklemeli VE DEĞİL kapısı.' }),
  hex('7419', not, { title: 'Altılı Schmitt evirici', description: 'Altı adet Schmitt tetiklemeli evirici.' }),
  dual4('7420', nand, { title: 'Çift 4 girişli NAND', description: 'İki adet 4 girişli VE DEĞİL kapısı; 3 ve 11 numaralı bacaklar boş.' }),
  dual4('7421', and, { title: 'Çift 4 girişli AND', description: 'İki adet 4 girişli VE kapısı; 3 ve 11 numaralı bacaklar boş.' }),
  quad('7424', nand, { title: 'Dörtlü 2 girişli Schmitt NAND', description: 'Dört adet 2 girişli Schmitt tetiklemeli VE DEĞİL kapısı.' }),
  triple('7427', nor, { title: 'Üçlü 3 girişli NOR', description: 'Üç adet 3 girişli VEYA DEĞİL kapısı.' }),
  {
    id: '7430', pins: 14, out: [8], unused: [9, 10, 13], vcc: 14, gnd: 7, group: 'gates',
    title: '8 girişli NAND', description: 'Tek bir 8 girişli VE DEĞİL kapısı; 9, 10 ve 13 numaralı bacaklar boş.',
    names: ['A', 'B', 'C', 'D', 'E', 'F', 'Y', 'G', 'H'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[6] = not(and(and(p[0], p[1], p[2], p[3]), and(p[4], p[5], p[7], p[8])));
      return o;
    },
  },
  quad('7432', (a, b) => or(a, b), { title: 'Dörtlü 2 girişli OR', description: 'Dört adet 2 girişli VEYA kapısı.' }),
  hex('7434', buf, { title: 'Altılı tampon', description: 'Altı adet tampon (girişi aynen çıkışa verir).' }),
  quad('7436', nor, { title: 'Dörtlü 2 girişli NOR', description: 'Dört adet 2 girişli VEYA DEĞİL kapısı, 7400 bacak dizilimiyle.' }),
  {
    ...quad('7438', nand, {
      title: 'Dörtlü 2 girişli açık kollektörlü NAND',
      description: 'Dört adet açık kollektörlü VE DEĞİL tamponu: iki giriş de 1 iken çıkışı 0\'a çeker, aksi halde çıkış boşta kalır (pull-up gerekir).',
    }),
    openCollector: true,
    // Evolution reads each input as "is it 1", so an undefined input counts as 0 (the output floats)
    eval: (p) => {
      const o: SignalValue[] = [];
      const gate = (a: SignalValue, b: SignalValue) => (a === 1 && b === 1 ? 0 : FLOAT);
      for (const i of [2, 5]) o[i] = gate(p[i - 2], p[i - 1]);
      for (const i of [6, 9]) o[i] = gate(p[i + 1], p[i + 2]);
      return o;
    },
  },
  {
    id: '7451', pins: 14, out: [6, 8], unused: [11, 12], vcc: 14, gnd: 7, group: 'gates',
    title: 'Çift 2-2 girişli AND-OR-DEĞİL', description: 'İki adet VE-VEYA-DEĞİL (AOI) kapısı: Y = (A·B + C·D)\'.',
    names: ['1A', '2A', '2B', '2C', '2D', '2Y', '1Y', '1C', '1D', '1B'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = nor(and(p[1], p[2]), and(p[3], p[4]));
      o[6] = nor(and(p[0], p[9]), and(p[7], p[8]));
      return o;
    },
  },
  {
    id: '7454', pins: 14, out: [8], unused: [6, 11, 12], vcc: 14, gnd: 7, group: 'gates',
    title: '4 gruplu AND-OR-DEĞİL', description: 'Dört adet 2 girişli VE grubunun VEYA DEĞİL\'i: Y = (A·B + C·D + E·F + G·H)\'.',
    names: ['A', 'C', 'D', 'E', 'F', 'Y', 'G', 'H', 'B'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = nor(and(p[0], p[8]), and(p[1], p[2]), and(p[3], p[4]), and(p[6], p[7]));
      return o;
    },
  },
  {
    id: '7458', pins: 14, out: [6, 8], vcc: 14, gnd: 7, group: 'gates',
    title: 'Çift AND-OR', description: 'İki adet VE-VEYA kapısı: 2Y = 2A·2B + 2C·2D, 1Y = 1A·1B·1C + 1D·1E·1F.',
    names: ['1A', '2A', '2B', '2C', '2D', '2Y', '1Y', '1D', '1E', '1F', '1B', '1C'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[5] = or(and(p[1], p[2]), and(p[3], p[4]));
      o[6] = or(and(p[0], p[11], p[10]), and(p[9], p[8], p[7]));
      return o;
    },
  },
  {
    id: '7464', pins: 14, out: [8], vcc: 14, gnd: 7, group: 'gates', height: 70,
    title: '4-2-3-2 girişli AND-OR-DEĞİL', description: 'Dört VE grubunun (2, 3, 2 ve 4 girişli) VEYA DEĞİL\'i.',
    names: ['A', 'E', 'F', 'G', 'H', 'I', 'Y', 'J', 'K', 'B', 'C', 'D'],
    eval: (p) => {
      const o: SignalValue[] = [];
      o[6] = nor(and(p[1], p[2]), and(p[3], p[4], p[5]), and(p[7], p[8]), and(p[9], p[10], p[11], p[0]));
      return o;
    },
  },
  quad('7486', xor, { title: 'Dörtlü 2 girişli XOR', description: 'Dört adet 2 girişli ÖZEL VEYA kapısı.' }),
  {
    id: '7487', pins: 14, out: [3, 6, 9, 12], unused: [4, 11], vcc: 14, gnd: 7, group: 'gates',
    title: '4 bit doğru/tümleyen, 0/1 birimi',
    description: 'B = 1 iken dört çıkış da C\'nin tersi; B = 0, C = 1 iken Y = A; B = 0, C = 0 iken Y = A\'nın tersi.',
    names: ['C', 'A1', 'Y1', 'A2', 'Y2', 'B', 'Y3', 'A3', 'Y4', 'A4'],
    eval: (p) => {
      const o: SignalValue[] = [];
      const ys = [2, 4, 6, 8];
      const as = [1, 3, 7, 9];
      const b = p[5];
      const c = p[0];
      ys.forEach((y, k) => {
        if (b === 1) o[y] = not(c);
        else if (b === 0) o[y] = c === 1 ? p[as[k]] : c === 0 ? not(p[as[k]]) : 'E';
        else o[y] = 'E';
      });
      return o;
    },
  },
  quad('74132', nand, { title: 'Dörtlü 2 girişli Schmitt NAND', description: 'Dört adet 2 girişli Schmitt tetiklemeli VE DEĞİL kapısı.' }),
  {
    ...quad('74266', xor, {
      title: 'Dörtlü 2 girişli açık kollektörlü XNOR',
      description: 'Dört adet açık kollektörlü ÖZEL VEYA DEĞİL kapısı: girişler eşitse çıkış boşta kalır, farklıysa 0\'a çeker (pull-up gerekir).',
    }),
    openCollector: true,
    // Evolution: XNOR true floats, anything else (also E) pulls low
    eval: (p) => {
      const o: SignalValue[] = [];
      const gate = (a: SignalValue, b: SignalValue) => (not(xor(a, b)) === 1 ? FLOAT : 0);
      for (const i of [2, 5]) o[i] = gate(p[i - 1], p[i - 2]);
      for (const i of [6, 9]) o[i] = gate(p[i + 1], p[i + 2]);
      return o;
    },
  },
];

export const TTL_CHIPS: Record<TtlChipId, TtlChip> = Object.fromEntries(CHIPS.map((c) => [c.id, c])) as Record<TtlChipId, TtlChip>;

export const TTL_TYPES = new Set<string>(TTL_CHIP_IDS.map((id) => `ttl${id}`));
export const isTtlType = (t: string): t is TtlType => TTL_TYPES.has(t);
export const ttlChipOf = (t: string): TtlChip | undefined => (isTtlType(t) ? TTL_CHIPS[t.slice(3) as TtlChipId] : undefined);

// ---- Ports and geometry ------------------------------------------------------------------------------------

export interface TtlPort {
  /** Physical pin number */
  pin: number;
  key: string;
  name: string;
  dir: 'input' | 'output';
}

export const ttlPinKey = (pin: number) => `p${pin}`;

/** Evolution's ports: physical order without NC and power pins, then GND and VCC when they are shown */
export function ttlPorts(chip: TtlChip, vccGnd: boolean): TtlPort[] {
  const ports: TtlPort[] = [];
  let k = 0;
  for (let pin = 1; pin <= chip.pins; pin++) {
    if (chip.unused?.includes(pin) || pin === chip.vcc || pin === chip.gnd) continue;
    ports.push({ pin, key: ttlPinKey(pin), name: chip.names[k] ?? String(pin), dir: chip.out.includes(pin) ? 'output' : 'input' });
    k++;
  }
  if (vccGnd) {
    ports.push({ pin: chip.gnd, key: ttlPinKey(chip.gnd), name: 'GND', dir: 'input' });
    ports.push({ pin: chip.vcc, key: ttlPinKey(chip.vcc), name: 'VCC', dir: 'input' });
  }
  return ports;
}

export const TTL_HEIGHT = 60;

/** Package height: evolution's bounds are (0, -30, pins x 10, height) from the location */
export const ttlHeight = (chip: TtlChip) => chip.height ?? TTL_HEIGHT;

/**
 * Part box: the package rounded up to 20px (a 70 high package gets an 80 high box with the package at its
 * top) so the box centre, which the part rotates around, keeps every pin on the 10px grid
 */
export function ttlSize(chip: TtlChip): { width: number; height: number } {
  return { width: chip.pins * 10, height: Math.ceil(ttlHeight(chip) / 20) * 20 };
}

/** Pin point (unrotated, from the top-left corner): pins 1..n/2 left to right on the bottom edge, the rest right to left on top */
export function ttlPinPoint(chip: TtlChip, pin: number): { x: number; y: number } {
  const half = chip.pins / 2;
  const w = chip.pins * 10;
  return pin <= half ? { x: (pin - 1) * 20 + 10, y: ttlHeight(chip) } : { x: w - (pin - half - 1) * 20 - 10, y: 0 };
}

// ---- Evaluation ------------------------------------------------------------------------------------------

/**
 * Output values by pin key; `read` gives what an input pin reads (undriven = 'X').
 */
export function evalTtl(
  chip: TtlChip,
  vccGnd: boolean,
  read: (key: string) => SignalValue,
): Map<string, SignalValue> {
  const ports = ttlPorts(chip, false);
  const result = new Map<string, SignalValue>();
  if (vccGnd && (read(ttlPinKey(chip.gnd)) !== 0 || read(ttlPinKey(chip.vcc)) !== 1)) {
    for (const p of ports) if (p.dir === 'output') result.set(p.key, FLOAT);
    return result;
  }
  const vals = ports.map((p) => read(p.key));
  const outs = chip.eval(vals);
  ports.forEach((p, i) => {
    if (p.dir === 'output' && outs[i] !== undefined) result.set(p.key, outs[i]!);
  });
  return result;
}
