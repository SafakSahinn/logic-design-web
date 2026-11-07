import type {
  ComponentType,
  ComponentMetadata,
  CircuitComponentInstance,
  CircuitWire,
  CircuitPin,
  CircuitPreset,
  TruthTableData,
  TruthTableEntry,
} from '../types/circuit';
import { MAX_BIT_WIDTH, bitsToNumber, numberToBits, resolveDrivers, summarizeBits, type SignalValue } from '../types/logic';
import { evaluateSubcircuitStateful, getSubcircuitDefinition, subcircuitPortWidth } from './subcircuitManager';
import { repairWires, setComponentBodySizeResolver } from './wiringEngine';

export const COMPONENT_CATALOG: Record<ComponentType, ComponentMetadata> = {
  switch: {
    type: 'switch',
    name: 'Giriş Anahtarı',
    category: 'inputs',
    width: 70,
    height: 60,
    inputs: [],
    outputs: [{ id: 'out', name: 'Q', type: 'output', relX: 70, relY: 30 }],
    description: '0 veya 1 mantık seviyesi sağlayan açma/kapama anahtarı',
  },
  pushbutton: {
    type: 'pushbutton',
    name: 'Anlık Buton (Push Button)',
    category: 'inputs',
    width: 60,
    height: 52,
    inputs: [],
    outputs: [{ id: 'out', name: 'OUT', type: 'output', relX: 60, relY: 30 }],
    description: 'Basılı tutulduğunda 1, bırakıldığında otomatik 0 olan yaylı anlık bas-bırak buton',
  },
  clock: {
    type: 'clock',
    name: 'Saat Darbesi (Clock)',
    category: 'inputs',
    width: 60,
    height: 44,
    inputs: [],
    outputs: [{ id: 'out', name: 'CLK', type: 'output', relX: 60, relY: 30 }],
    description: 'Periyodik 0-1 kare dalga darbe üreteci',
  },
  vcc: {
    type: 'vcc',
    name: 'Sabit 1 (VCC)',
    category: 'inputs',
    width: 50,
    height: 38,
    inputs: [],
    outputs: [{ id: 'out', name: '1', type: 'output', relX: 50, relY: 20 }],
    description: 'Sürekli Lojik 1 seviyesi',
  },
  gnd: {
    type: 'gnd',
    name: 'Sabit 0 (GND)',
    category: 'inputs',
    width: 50,
    height: 38,
    inputs: [],
    outputs: [{ id: 'out', name: '0', type: 'output', relX: 50, relY: 20 }],
    description: 'Sürekli Lojik 0 seviyesi',
  },
  constant: {
    type: 'constant',
    name: 'Sabit (Constant)',
    category: 'inputs',
    width: 30,
    height: 20,
    inputs: [],
    outputs: [{ id: 'out', name: 'K', type: 'output', relX: 30, relY: 10 }],
    description: 'Seçilen bit genişliğinde sabit bir değer sürer (Logisim Constant)',
  },
  tunnel: {
    type: 'tunnel',
    name: 'Tünel (Kablosuz Hat)',
    category: 'inputs',
    width: 64,
    height: 32,
    inputs: [{ id: 'in', name: 'T', type: 'input', relX: 0, relY: 20 }],
    outputs: [{ id: 'out', name: 'T', type: 'output', relX: 64, relY: 20 }],
    description: 'Aynı ada sahip diğer tünellerle havadan elektriksel bağlantı kurar (Kablo kalabalığını önler)',
  },
  pullResistor: {
    type: 'pullResistor',
    name: 'Pull Direnci (Pull Resistor)',
    category: 'inputs',
    width: 30,
    height: 56,
    inputs: [{ id: 'in', name: 'P', type: 'input', relX: 15, relY: 0 }],
    outputs: [],
    description: 'Bağlı olduğu hat hiçbir parça tarafından sürülmüyorsa (Hi-Z / x) hattı 0 (pull-down) ya da 1 (pull-up) seviyesine çeker',
  },
  dipSwitch4: {
    type: 'dipSwitch4',
    name: '4-Bit DIP Anahtar (DIP Switch)',
    category: 'inputs',
    width: 84,
    height: 86,
    inputs: [],
    outputs: [
      { id: 'out0', name: 'Q0', type: 'output', relX: 84, relY: 20 },
      { id: 'out1', name: 'Q1', type: 'output', relX: 84, relY: 40 },
      { id: 'out2', name: 'Q2', type: 'output', relX: 84, relY: 60 },
      { id: 'out3', name: 'Q3', type: 'output', relX: 84, relY: 80 },
    ],
    description: '4 adet bağımsız açma/kapama anahtarını tek pakette sunan DIP anahtar bankası',
  },
  asciiKeyboard: {
    type: 'asciiKeyboard',
    name: 'ASCII Klavye Giriş Matrisi',
    category: 'inputs',
    width: 140,
    height: 96,
    inputs: [
      { id: 'inClr', name: 'CLR', type: 'input', relX: 0, relY: 50 },
    ],
    outputs: [
      { id: 'outD0', name: 'D0', type: 'output', relX: 140, relY: 20 },
      { id: 'outD1', name: 'D1', type: 'output', relX: 140, relY: 30 },
      { id: 'outD2', name: 'D2', type: 'output', relX: 140, relY: 40 },
      { id: 'outD3', name: 'D3', type: 'output', relX: 140, relY: 50 },
      { id: 'outD4', name: 'D4', type: 'output', relX: 140, relY: 60 },
      { id: 'outD5', name: 'D5', type: 'output', relX: 140, relY: 70 },
      { id: 'outD6', name: 'D6', type: 'output', relX: 140, relY: 80 },
      { id: 'outStrobe', name: 'ST', type: 'output', relX: 70, relY: 96 },
    ],
    description: 'Klavyeden basılan tuşun 7-bit standart ASCII kodunu (D0-D6) ve veri hazır (ST) sinyalini üretir',
  },
  not: {
    type: 'not',
    name: 'NOT Kapısı (Değil)',
    category: 'gates',
    width: 70,
    height: 60,
    inputs: [{ id: 'in', name: 'A', type: 'input', relX: 0, relY: 30 }],
    outputs: [{ id: 'out', name: "A'", type: 'output', relX: 70, relY: 30 }],
    description: "Girişin tersini alır: 0 ise 1, 1 ise 0 (A')",
  },
  buffer: {
    type: 'buffer',
    name: 'Tampon (Buffer)',
    category: 'gates',
    width: 70,
    height: 60,
    inputs: [{ id: 'in', name: 'A', type: 'input', relX: 0, relY: 30 }],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 70, relY: 30 }],
    description: 'Girişi değiştirmeden çıkışa aktarır (Y = A); tanımsız giriş x olarak geçer',
  },
  and: {
    type: 'and',
    name: 'AND Kapısı (VE)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'Her iki giriş 1 olduğunda çıkışı 1 verir (A · B)',
  },
  or: {
    type: 'or',
    name: 'OR Kapısı (VEYA)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'En az bir giriş 1 olduğunda çıkışı 1 verir (A + B)',
  },
  nand: {
    type: 'nand',
    name: 'NAND Kapısı (VE DEĞİL)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: "AND kapısının değili: (A · B)'",
  },
  nor: {
    type: 'nor',
    name: 'NOR Kapısı (VEYA DEĞİL)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: "OR kapısının değili: (A + B)'",
  },
  xor: {
    type: 'xor',
    name: 'XOR Kapısı (Özel VEYA)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'Girişler birbirinden farklı olduğunda 1 verir (A ⊕ B)',
  },
  xnor: {
    type: 'xnor',
    name: 'XNOR Kapısı (Özel VEYA DEĞİL)',
    category: 'gates',
    width: 80,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 80, relY: 30 }],
    description: 'Girişler birbirine eşit olduğunda 1 verir (Eşitlik kapısı)',
  },
  triState: {
    type: 'triState',
    name: '3 Durumlu Tampon (Tri-State)',
    category: 'gates',
    width: 70,
    height: 48,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 30 },
      { id: 'inEN', name: 'EN', type: 'input', relX: 40, relY: 50 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 70, relY: 30 }],
    description: 'EN=1 iken A girişini çıkışa aktarır; EN=0 iken yüksek empedans (Hi-Z) verir',
  },
  controlledInverter: {
    type: 'controlledInverter',
    name: 'Kontrollü Evirici',
    category: 'gates',
    width: 70,
    height: 48,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 30 },
      { id: 'inEN', name: 'EN', type: 'input', relX: 40, relY: 50 },
    ],
    outputs: [{ id: 'outY', name: "A'", type: 'output', relX: 70, relY: 30 }],
    description: "EN=1 iken A girişinin tersini çıkışa verir (A'); EN=0 iken yüksek empedans (Hi-Z) verir",
  },
  led: {
    type: 'led',
    name: 'Işıklı Gösterge (LED)',
    category: 'outputs',
    width: 48,
    height: 62,
    inputs: [{ id: 'in', name: 'D', type: 'input', relX: 0, relY: 30 }],
    outputs: [],
    description: 'Giriş 1 olduğunda parlayan dikey gerçekçi 5mm LED',
  },
  probe: {
    type: 'probe',
    name: 'Mantık Probu (0/1 Gösterge)',
    category: 'outputs',
    width: 50,
    height: 40,
    inputs: [{ id: 'in', name: 'IN', type: 'input', relX: 0, relY: 30 }],
    outputs: [],
    description: 'Sinyalin anlık 0 veya 1 değerini sayısal olarak gösterir',
  },
  buzzer: {
    type: 'buzzer',
    name: 'Sesli Uyarıcı & Müzik Buzzerı',
    category: 'outputs',
    width: 68,
    height: 72,
    inputs: [
      { id: 'in', name: 'EN', type: 'input', relX: 0, relY: 20 },
      { id: 'pitch0', name: 'N0', type: 'input', relX: 0, relY: 30 },
      { id: 'pitch1', name: 'N1', type: 'input', relX: 0, relY: 40 },
      { id: 'pitch2', name: 'N2', type: 'input', relX: 0, relY: 50 },
      { id: 'pitch3', name: 'N3', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [],
    description: 'EN girişi 1 iken ses çalar. N0-N3 (4-Bit) nota girişleriyle 16 farklı müzik notası/şarkı çalabilir',
  },
  dotMatrix8x8: {
    type: 'dotMatrix8x8',
    name: '8x8 LED Nokta Matris Ekranı (GPU)',
    category: 'outputs',
    width: 120,
    height: 124,
    inputs: [
      { id: 'row0', name: 'R0', type: 'input', relX: 0, relY: 20 },
      { id: 'row1', name: 'R1', type: 'input', relX: 0, relY: 30 },
      { id: 'row2', name: 'R2', type: 'input', relX: 0, relY: 40 },
      { id: 'row3', name: 'R3', type: 'input', relX: 0, relY: 50 },
      { id: 'row4', name: 'R4', type: 'input', relX: 0, relY: 60 },
      { id: 'row5', name: 'R5', type: 'input', relX: 0, relY: 70 },
      { id: 'row6', name: 'R6', type: 'input', relX: 0, relY: 80 },
      { id: 'row7', name: 'R7', type: 'input', relX: 0, relY: 90 },
      { id: 'col0', name: 'C0', type: 'input', relX: 20, relY: 124 },
      { id: 'col1', name: 'C1', type: 'input', relX: 30, relY: 124 },
      { id: 'col2', name: 'C2', type: 'input', relX: 40, relY: 124 },
      { id: 'col3', name: 'C3', type: 'input', relX: 50, relY: 124 },
      { id: 'col4', name: 'C4', type: 'input', relX: 60, relY: 124 },
      { id: 'col5', name: 'C5', type: 'input', relX: 70, relY: 124 },
      { id: 'col6', name: 'C6', type: 'input', relX: 80, relY: 124 },
      { id: 'col7', name: 'C7', type: 'input', relX: 90, relY: 124 },
    ],
    outputs: [],
    description: '8 Satır (R0-R7) ve 8 Sütun (C0-C7) matrisiyle piksel grafik ve animasyon oynatan 64 LED ekran',
  },
  rgbMatrix16x16: {
    type: 'rgbMatrix16x16',
    name: '16x16 RGB Video Matrisi (VRAM GPU Ekranı)',
    category: 'outputs',
    width: 170,
    height: 180,
    inputs: [
      { id: 'inX0', name: 'X0', type: 'input', relX: 0, relY: 20 },
      { id: 'inX1', name: 'X1', type: 'input', relX: 0, relY: 30 },
      { id: 'inX2', name: 'X2', type: 'input', relX: 0, relY: 40 },
      { id: 'inX3', name: 'X3', type: 'input', relX: 0, relY: 50 },
      { id: 'inY0', name: 'Y0', type: 'input', relX: 0, relY: 70 },
      { id: 'inY1', name: 'Y1', type: 'input', relX: 0, relY: 80 },
      { id: 'inY2', name: 'Y2', type: 'input', relX: 0, relY: 90 },
      { id: 'inY3', name: 'Y3', type: 'input', relX: 0, relY: 100 },
      { id: 'inR', name: 'R', type: 'input', relX: 0, relY: 120 },
      { id: 'inG', name: 'G', type: 'input', relX: 0, relY: 130 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 140 },
      { id: 'inWE', name: 'WE', type: 'input', relX: 0, relY: 160 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 60, relY: 180 },
      { id: 'inRst', name: 'RST', type: 'input', relX: 110, relY: 180 },
    ],
    outputs: [],
    description: '16x16 (256 Piksel) Renkli Video Ekranı. X(3:0) ve Y(3:0) adreslerindeki piksele R, G, B renk verisini yazar',
  },
  textLabel: {
    type: 'textLabel',
    name: 'Metin / Açıklama Notu (Text Note)',
    category: 'outputs',
    width: 140,
    height: 44,
    inputs: [],
    outputs: [],
    description: 'Tuvale devre şeması için özel notlar ve başlıklar eklemek için kullanılır',
  },
  sevenSegment: {
    type: 'sevenSegment',
    name: '7-Segment LED Ekran',
    category: 'outputs',
    width: 72,
    height: 96,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 10 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 20 },
      { id: 'inC', name: 'C', type: 'input', relX: 0, relY: 30 },
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 40 },
      { id: 'inE', name: 'E', type: 'input', relX: 0, relY: 50 },
      { id: 'inF', name: 'F', type: 'input', relX: 0, relY: 60 },
      { id: 'inG', name: 'G', type: 'input', relX: 0, relY: 70 },
      { id: 'inDP', name: 'DP', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [],
    description: 'A-G ve DP girişleriyle kontrol edilen klasik 7-segment LED göstergesi',
  },
  hexDisplay: {
    type: 'hexDisplay',
    name: '4-Bit Hex Gösterge (0-F)',
    category: 'outputs',
    width: 68,
    height: 84,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 40 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 60 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [],
    description: '4-bit ikili girişi (D0-D3) otomatik çözerek 0-F arası onaltılık karakter gösterir',
  },
  ledBar4: {
    type: 'ledBar4',
    name: '4-Bit LED Bar Göstergesi',
    category: 'outputs',
    width: 76,
    height: 86,
    inputs: [
      { id: 'in0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'D1', type: 'input', relX: 0, relY: 40 },
      { id: 'in2', name: 'D2', type: 'input', relX: 0, relY: 60 },
      { id: 'in3', name: 'D3', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [],
    description: '4-Bit veri yollarını görselleştiren çoklu LED seviye barı',
  },
  dFlipFlop: {
    type: 'dFlipFlop',
    name: 'D Flip-Flop (Veri Kaydedici)',
    category: 'sequential',
    width: 84,
    height: 74,
    inputs: [
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 20 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 50 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 84, relY: 20 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 84, relY: 50 },
    ],
    description: 'Saat darbesinin yükselen kenarında D girişindeki biti saklar',
  },
  jkFlipFlop: {
    type: 'jkFlipFlop',
    name: 'JK Flip-Flop (Evrensel Saklayıcı)',
    category: 'sequential',
    width: 88,
    height: 84,
    inputs: [
      { id: 'inJ', name: 'J', type: 'input', relX: 0, relY: 20 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 40 },
      { id: 'inK', name: 'K', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 88, relY: 20 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 88, relY: 60 },
    ],
    description: 'J=1/K=0 kurar, J=0/K=1 sıfırlar, J=1/K=1 iken çıkış durumunu tersler (Toggle)',
  },
  srLatch: {
    type: 'srLatch',
    name: 'SR Mandalı (SR Latch)',
    category: 'sequential',
    width: 84,
    height: 74,
    inputs: [
      { id: 'inS', name: 'S', type: 'input', relX: 0, relY: 20 },
      { id: 'inR', name: 'R', type: 'input', relX: 0, relY: 50 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 84, relY: 20 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 84, relY: 50 },
    ],
    description: 'Temel asenkron bellek hücresi: S (Set) kurar, R (Reset) sıfırlar',
  },
  halfAdder: {
    type: 'halfAdder',
    name: '1-Bit Yarım Toplayıcı (HA)',
    category: 'combinational',
    width: 90,
    height: 64,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [
      { id: 'outS', name: 'S', type: 'output', relX: 90, relY: 20 },
      { id: 'outC', name: 'C', type: 'output', relX: 90, relY: 40 },
    ],
    description: 'İki biti toplar: Toplam S (XOR) ve Elde C (AND)',
  },
  fullAdder: {
    type: 'fullAdder',
    name: '1-Bit Tam Toplayıcı (FA)',
    category: 'combinational',
    width: 96,
    height: 76,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
      { id: 'inCin', name: 'Cin', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outS', name: 'S', type: 'output', relX: 96, relY: 20 },
      { id: 'outCout', name: 'Cout', type: 'output', relX: 96, relY: 50 },
    ],
    description: 'Elde girişi (Cin) ile 3 biti toplayarak S ve Cout üretir',
  },
  halfSubtractor: {
    type: 'halfSubtractor',
    name: '1-Bit Yarım Çıkarıcı (HS)',
    category: 'combinational',
    width: 90,
    height: 64,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [
      { id: 'outD', name: 'D', type: 'output', relX: 90, relY: 20 },
      { id: 'outB', name: 'B', type: 'output', relX: 90, relY: 40 },
    ],
    description: 'İki biti çıkarır: Fark D (A ⊕ B) ve Borç B (A\' · B)',
  },
  fullSubtractor: {
    type: 'fullSubtractor',
    name: '1-Bit Tam Çıkarıcı (FS)',
    category: 'combinational',
    width: 96,
    height: 76,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
      { id: 'inBin', name: 'Bin', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outD', name: 'D', type: 'output', relX: 96, relY: 20 },
      { id: 'outBout', name: 'Bout', type: 'output', relX: 96, relY: 50 },
    ],
    description: 'Borç girişi (Bin) ile 3 biti çıkararak Fark D ve Borç Çıkışı Bout üretir',
  },
  mux2: {
    type: 'mux2',
    name: '2:1 Çoklayıcı (MUX)',
    category: 'combinational',
    width: 86,
    height: 70,
    inputs: [
      { id: 'inD0', name: 'I0', type: 'input', relX: 0, relY: 20 },
      { id: 'inD1', name: 'I1', type: 'input', relX: 0, relY: 40 },
      { id: 'inS', name: 'S', type: 'input', relX: 40, relY: 70 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 86, relY: 30 }],
    description: 'Seçme girişine (S) göre I0 veya I1 girişini çıkışa aktarır',
  },
  mux4: {
    type: 'mux4',
    name: '4:1 Çoklayıcı (4:1 MUX)',
    category: 'combinational',
    width: 88,
    height: 96,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 40 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 60 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 80 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 30, relY: 96 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 60, relY: 96 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 88, relY: 50 }],
    description: '2-Bit seçme girişine (S1-S0) göre 4 girişten birini çıkışa iletir',
  },
  mux8: {
    type: 'mux8',
    name: '8:1 Çoklayıcı (74HC151 benzeri)',
    category: 'combinational',
    width: 96,
    height: 160,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 40 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 60 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 80 },
      { id: 'inD4', name: 'D4', type: 'input', relX: 0, relY: 100 },
      { id: 'inD5', name: 'D5', type: 'input', relX: 0, relY: 110 },
      { id: 'inD6', name: 'D6', type: 'input', relX: 0, relY: 120 },
      { id: 'inD7', name: 'D7', type: 'input', relX: 0, relY: 130 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 20, relY: 160 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 50, relY: 160 },
      { id: 'inS2', name: 'S2', type: 'input', relX: 70, relY: 160 },
    ],
    outputs: [
      { id: 'outY', name: 'Y', type: 'output', relX: 96, relY: 60 },
      { id: 'outW', name: "W (Y')", type: 'output', relX: 96, relY: 100 },
    ],
    description: '3-Bit seçme girişi (S2-S0) ile 8 girişten birini seçip Y ve W (ters) çıkışlarına iletir; gerçek 74HC151\'deki aktif-düşük E\' yetki girişi yoktur',
  },
  demux2: {
    type: 'demux2',
    name: '1:2 Çoklayıcı Çözücü (DEMUX)',
    category: 'combinational',
    width: 86,
    height: 70,
    inputs: [
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 30 },
      { id: 'inS', name: 'S', type: 'input', relX: 40, relY: 70 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 86, relY: 20 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 86, relY: 50 },
    ],
    description: 'Seçme girişine (S) göre D girişini Y0 (S=0) veya Y1 (S=1) çıkışına yönlendirir',
  },
  demux4: {
    type: 'demux4',
    name: '1:4 Çoklayıcı Çözücü (1:4 DEMUX)',
    category: 'combinational',
    width: 88,
    height: 94,
    inputs: [
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 50 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 30, relY: 94 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 60, relY: 94 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 88, relY: 20 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 88, relY: 40 },
      { id: 'outY2', name: 'Y2', type: 'output', relX: 88, relY: 60 },
      { id: 'outY3', name: 'Y3', type: 'output', relX: 88, relY: 80 },
    ],
    description: '2-Bit seçme girişine (S1-S0) göre D giriş sinyalini 4 çıkıştan birine yönlendirir',
  },
  decoder2to4: {
    type: 'decoder2to4',
    name: '2:4 Kod Çözücü (Decoder)',
    category: 'combinational',
    width: 88,
    height: 84,
    inputs: [
      { id: 'inEN', name: 'EN', type: 'input', relX: 0, relY: 20 },
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 40 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 88, relY: 20 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 88, relY: 40 },
      { id: 'outY2', name: 'Y2', type: 'output', relX: 88, relY: 60 },
      { id: 'outY3', name: 'Y3', type: 'output', relX: 88, relY: 80 },
    ],
    description: '2-bit adresi çözerek 4 çıkıştan birini aktif (1) yapar',
  },
  decoder3to8: {
    type: 'decoder3to8',
    name: '3:8 Kod Çözücü (74HC238 benzeri, aktif-yüksek)',
    category: 'combinational',
    width: 96,
    height: 116,
    inputs: [
      { id: 'inEN', name: 'EN', type: 'input', relX: 0, relY: 20 },
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 40 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 60 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 96, relY: 20 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 96, relY: 30 },
      { id: 'outY2', name: 'Y2', type: 'output', relX: 96, relY: 40 },
      { id: 'outY3', name: 'Y3', type: 'output', relX: 96, relY: 50 },
      { id: 'outY4', name: 'Y4', type: 'output', relX: 96, relY: 60 },
      { id: 'outY5', name: 'Y5', type: 'output', relX: 96, relY: 70 },
      { id: 'outY6', name: 'Y6', type: 'output', relX: 96, relY: 80 },
      { id: 'outY7', name: 'Y7', type: 'output', relX: 96, relY: 90 },
    ],
    description: '3-bit ikili adresi çözerek 8 minterm çıkışından birini aktif (1) yapar; çıkışlar aktif-yüksektir (74HC238 gibi, 74HC138\'de aktif-düşük)',
  },
  bcdTo7Seg: {
    type: 'bcdTo7Seg',
    name: 'BCD/Hex → 7-Segment Kod Çözücü (aktif-yüksek)',
    category: 'combinational',
    width: 96,
    height: 104,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 40 },
      { id: 'inC', name: 'C', type: 'input', relX: 0, relY: 60 },
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [
      { id: 'outA', name: 'a', type: 'output', relX: 96, relY: 20 },
      { id: 'outB', name: 'b', type: 'output', relX: 96, relY: 30 },
      { id: 'outC', name: 'c', type: 'output', relX: 96, relY: 40 },
      { id: 'outD', name: 'd', type: 'output', relX: 96, relY: 50 },
      { id: 'outE', name: 'e', type: 'output', relX: 96, relY: 60 },
      { id: 'outF', name: 'f', type: 'output', relX: 96, relY: 70 },
      { id: 'outG', name: 'g', type: 'output', relX: 96, relY: 80 },
    ],
    description: '4-bit sayıyı (A-D, 0-F) ortak katotlu 7-segment göstergenin segment sinyallerine (a-g, aktif-yüksek) dönüştürür; 10-15 için A-F harflerini gösterir. Gerçek 74LS47 aktif-düşüktür (ortak anot) ve yalnızca 0-9 içindir',
  },
  priorityEncoder4to2: {
    type: 'priorityEncoder4to2',
    name: '4:2 Öncelikli Kodlayıcı (74HC148 benzeri)',
    category: 'combinational',
    width: 90,
    height: 92,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 40 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 60 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [
      { id: 'outY1', name: 'Y1', type: 'output', relX: 90, relY: 20 },
      { id: 'outY0', name: 'Y0', type: 'output', relX: 90, relY: 50 },
      { id: 'outV', name: 'V', type: 'output', relX: 90, relY: 70 },
    ],
    description: 'En yüksek öncelikli aktif girişi (D3 > D2 > D1 > D0) 2-bit ikili koda çevirir; V aktiflik göstergesidir. Girişler ve çıkışlar aktif-yüksektir (gerçek 74HC148 8:3 ve aktif-düşüktür)',
  },
  comparator4: {
    type: 'comparator4',
    name: '4-Bit Karşılaştırıcı (CMP)',
    category: 'combinational',
    width: 96,
    height: 90,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 20 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 30 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 50 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 60 },
      { id: 'inB0', name: 'B0', type: 'input', relX: 30, relY: 90 },
      { id: 'inB1', name: 'B1', type: 'input', relX: 50, relY: 90 },
      { id: 'inB2', name: 'B2', type: 'input', relX: 70, relY: 90 },
      { id: 'inB3', name: 'B3', type: 'input', relX: 80, relY: 90 },
    ],
    outputs: [
      { id: 'outGT', name: 'A>B', type: 'output', relX: 96, relY: 20 },
      { id: 'outEQ', name: 'A=B', type: 'output', relX: 96, relY: 50 },
      { id: 'outLT', name: 'A<B', type: 'output', relX: 96, relY: 70 },
    ],
    description: '4-bit A ve B sayılarını karşılaştırır: A>B, A=B veya A<B çıkışı verir',
  },
  alu4: {
    type: 'alu4',
    name: '4-Bit Aritmetik Mantık Birimi (4 İşlem ALU)',
    category: 'combinational',
    width: 104,
    height: 98,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 20 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 30 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 40 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 60 },
      { id: 'inCin', name: 'Cin', type: 'input', relX: 0, relY: 80 },
      { id: 'inB0', name: 'B0', type: 'input', relX: 20, relY: 98 },
      { id: 'inB1', name: 'B1', type: 'input', relX: 40, relY: 98 },
      { id: 'inB2', name: 'B2', type: 'input', relX: 60, relY: 98 },
      { id: 'inB3', name: 'B3', type: 'input', relX: 80, relY: 98 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 40, relY: 0 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 70, relY: 0 },
    ],
    outputs: [
      { id: 'outF0', name: 'F0', type: 'output', relX: 104, relY: 20 },
      { id: 'outF1', name: 'F1', type: 'output', relX: 104, relY: 30 },
      { id: 'outF2', name: 'F2', type: 'output', relX: 104, relY: 50 },
      { id: 'outF3', name: 'F3', type: 'output', relX: 104, relY: 60 },
      { id: 'outCout', name: 'Cout', type: 'output', relX: 104, relY: 80 },
      { id: 'outZero', name: 'Z', type: 'output', relX: 104, relY: 90 },
    ],
    description: '4-Bit ALU: S1-S0 fonksiyonlarına göre A+B, A-B, A&B, A|B işlemlerini yapar',
  },
  splitter4: {
    type: 'splitter4',
    name: "4'lü Paralel Geçiş (D0-D3 → Y0-Y3)",
    category: 'combinational',
    width: 84,
    height: 72,
    inputs: [
      { id: 'in0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'D1', type: 'input', relX: 0, relY: 30 },
      { id: 'in2', name: 'D2', type: 'input', relX: 0, relY: 50 },
      { id: 'in3', name: 'D3', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'out0', name: 'Y0', type: 'output', relX: 84, relY: 20 },
      { id: 'out1', name: 'Y1', type: 'output', relX: 84, relY: 30 },
      { id: 'out2', name: 'Y2', type: 'output', relX: 84, relY: 50 },
      { id: 'out3', name: 'Y3', type: 'output', relX: 84, relY: 60 },
    ],
    description: '4-Bit paralel veri yolu hatlarını ayırır ve dağıtır (D0-D3 -> Y0-Y3)',
  },
  splitter: {
    type: 'splitter',
    name: 'Splitter (Ayırıcı)',
    category: 'combinational',
    width: 20,
    height: 20,
    // Pins are rebuilt by configureSplitter: in0 = combined end, out<i> = end i+1
    inputs: [{ id: 'in0', name: 'Σ', type: 'input', relX: 0, relY: 20, width: 2 }],
    outputs: [
      { id: 'out0', name: '1', type: 'output', relX: 20, relY: 0 },
      { id: 'out1', name: '2', type: 'output', relX: 20, relY: 10 },
    ],
    description: 'Çok bitli bir veri yolunu uçlara ayırır ya da uçları birleştirir (iki yönlü, Logisim Splitter)',
  },
  bitExtender: {
    type: 'bitExtender',
    name: 'Bit Genişletici (Bit Extender)',
    category: 'combinational',
    width: 40,
    height: 40,
    // Logisim Bit Extender (facing east): input on the left, output on the right, the extension
    // input (type 'input' only; configureBitExtender drops it otherwise) on top
    inputs: [
      { id: 'in0', name: 'in', type: 'input', relX: 0, relY: 20, width: 8 },
      { id: 'in1', name: 'ext', type: 'input', relX: 20, relY: 0 },
    ],
    outputs: [{ id: 'out0', name: 'out', type: 'output', relX: 40, relY: 20, width: 16 }],
    description: 'Veri yolunu genişletir ya da daraltır; üst bitler 0, 1, işaret biti ya da ek girişle doldurulur (Logisim Bit Extender)',
  },
  bitSelector: {
    type: 'bitSelector',
    name: 'Bit Seçici (Bit Selector)',
    category: 'combinational',
    width: 40,
    height: 40,
    // Logisim BitSelector (facing east): data on the left, the selected group on the right, select below
    inputs: [
      { id: 'in0', name: 'D', type: 'input', relX: 0, relY: 20, width: 8 },
      { id: 'in1', name: 'S', type: 'input', relX: 30, relY: 40, width: 3 },
    ],
    outputs: [{ id: 'out0', name: 'Q', type: 'output', relX: 40, relY: 20 }],
    description: 'Veri yolundan seçme girişinin gösterdiği bit grubunu çıkışa verir (Logisim Bit Selector)',
  },
  counter4: {
    type: 'counter4',
    name: '4-Bit İkili Sayaç (0-15 Counter)',
    category: 'sequential',
    width: 90,
    height: 88,
    inputs: [
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 30 },
      { id: 'inRst', name: 'RST', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 90, relY: 20 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 90, relY: 40 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 90, relY: 60 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 90, relY: 80 },
    ],
    description: 'Her saat darbesinde 0-15 arası yukarı sayan 4-bit senkron sayaç',
  },
  register4: {
    type: 'register4',
    name: '4-Bit Paralel Yazmaç (Register)',
    category: 'sequential',
    width: 92,
    height: 88,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 20 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 40 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 60 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 80 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 30, relY: 88 },
      { id: 'inWE', name: 'WE', type: 'input', relX: 50, relY: 88 },
      { id: 'inRst', name: 'RST', type: 'input', relX: 70, relY: 88 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 92, relY: 20 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 92, relY: 40 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 92, relY: 60 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 92, relY: 80 },
    ],
    description: '4-Bit paralel saklama yazmacı: WE=1 iken saat darbesinde D verisini Q çıkışına kilitler',
  },
  shiftRegister4: {
    type: 'shiftRegister4',
    name: '4-Bit Çift Yönlü Kaydırmalı Yazmaç (74HC194 benzeri)',
    category: 'sequential',
    width: 104,
    height: 110,
    inputs: [
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 20 },
      { id: 'inRst', name: 'CLR', type: 'input', relX: 0, relY: 40 },
      { id: 'inSL', name: 'SL', type: 'input', relX: 0, relY: 60 },
      { id: 'inSR', name: 'SR', type: 'input', relX: 0, relY: 80 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 30, relY: 110 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 70, relY: 110 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 104, relY: 20 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 104, relY: 40 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 104, relY: 60 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 104, relY: 80 },
    ],
    description: '4-Bit Sağa/Sola kaydıran veya tutan saklayıcı (S1-S0: 00=Tut, 01=Sağa Kaydır, 10=Sola Kaydır, 11=Tut). CLR aktif-yüksektir; gerçek 74HC194\'teki paralel yükleme (11) yoktur',
  },
  tFlipFlop: {
    type: 'tFlipFlop',
    name: 'T Flip-Flop (T-FF / Toggle)',
    category: 'sequential',
    width: 86,
    height: 82,
    inputs: [
      { id: 'inT', name: 'T', type: 'input', relX: 0, relY: 20 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 60 },
      { id: 'inRst', name: 'RST', type: 'input', relX: 40, relY: 82 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 86, relY: 20 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 86, relY: 60 },
    ],
    description: 'T=1 iken her saat darbesinde (CLK) durumunu tersleyen temel ikili sayaç ve frekans bölücü birim',
  },
  ram16x4: {
    type: 'ram16x4',
    name: '16x4-Bit RAM (Saatli Yazma)',
    category: 'sequential',
    width: 108,
    height: 124,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 20 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 30 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 50 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 60 },
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 80 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 90 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 110 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 120 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 40, relY: 124 },
      { id: 'inWE', name: 'WE', type: 'input', relX: 70, relY: 124 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 108, relY: 20 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 108, relY: 40 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 108, relY: 60 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 108, relY: 80 },
    ],
    description: '16 Adres x 4-Bit Rastgele Erişimli Bellek: WE=1 iken saat darbesinde D verisini adrese yazar, adresteki veriyi Q çıkışına verir',
  },
  rom16x4: {
    type: 'rom16x4',
    name: '16x4-Bit ROM (Salt Okunur Bellek)',
    category: 'sequential',
    width: 100,
    height: 96,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 20 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 40 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 60 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 80 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 100, relY: 20 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 100, relY: 40 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 100, relY: 60 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 100, relY: 80 },
    ],
    description: '16 Adres x 4-Bit Önceden Programlanmış Salt Okunur Bellek: A3-A0 adresindeki veriyi anında Q çıkışlarına okur',
  },
  subcircuit: {
    type: 'subcircuit',
    name: 'Özel Alt Devre (IC)',
    category: 'custom',
    width: 120,
    height: 80,
    inputs: [],
    outputs: [],
    description: 'Kullanıcı tarafından paketlenmiş modüler alt devre / entegre modülü.',
  },
};

let componentCounter = 1;

const COMPONENT_TYPE_ALIASES: Record<string, ComponentType> = {
  busSplitter: 'splitter4',
  constantHigh: 'vcc',
  constantLow: 'gnd',
  mux2to1: 'mux2',
  mux4to1: 'mux4',
  mux8to1: 'mux8',
  demux1to2: 'demux2',
  demux1to4: 'demux4',
  comparator4bit: 'comparator4',
  alu4bit: 'alu4',
  register4bit: 'register4',
  counter4bit: 'counter4',
  shiftRegister4bit: 'shiftRegister4',
  sevenSeg: 'sevenSegment',
};

export function createComponentInstance(
  rawType: ComponentType,
  x: number,
  y: number,
  customLabel?: string,
  customId?: string
): CircuitComponentInstance {
  const type: ComponentType = COMPONENT_CATALOG[rawType]
    ? rawType
    : COMPONENT_TYPE_ALIASES[rawType as string] || 'and';
  const meta = COMPONENT_CATALOG[type];
  const compId = customId || `comp_${type}_${Date.now()}_${componentCounter++}`;

  const inputs: CircuitPin[] = meta.inputs.map((pin) => ({
    id: `${compId}_${pin.id}`,
    name: pin.name,
    type: 'input',
    value: 0,
    ...(pin.width && pin.width > 1 ? { width: pin.width } : {}),
    x: x + pin.relX,
    y: y + pin.relY,
  }));

  const outputs: CircuitPin[] = meta.outputs.map((pin) => ({
    id: `${compId}_${pin.id}`,
    name: pin.name,
    type: 'output',
    // Q' starts at 1 like the flip-flop state (q = 0, qBar = 1); a 0 there rose to 1 on the first step and
    // clocked whatever it drives
    value: POWER_UP_X_TYPES.has(type) ? 'X' : type === 'vcc' || pin.id === 'outQBar' ? 1 : 0,
    ...(pin.width && pin.width > 1 ? { width: pin.width } : {}),
    x: x + pin.relX,
    y: y + pin.relY,
  }));

  const inst: CircuitComponentInstance = {
    id: compId,
    type,
    label: customLabel || meta.name,
    x,
    y,
    inputs,
    outputs,
    state: {
      on: type === 'vcc' ? true : false,
      frequencyHz: 1,
      q: 0,
      qBar: 1,
      // No previous clock yet: the first evaluation never counts as an edge (like Logisim, whose signals
      // power up unknown), so a flip-flop clocked by a high signal does not toggle when the circuit starts
      lastClk: undefined,
      hexVal: 0,
      regVal: 0,
      aluResult: 0,
      dipSwitches: type === 'dipSwitch4' ? [false, false, false, false] : undefined,
      matrixGrid: type === 'dotMatrix8x8' ? Array(8).fill(null).map(() => Array(8).fill(false)) : undefined,
      rgbPixels: type === 'rgbMatrix16x16' ? Array(16).fill(null).map(() => Array(16).fill('#050505')) : undefined,
      asciiChar: type === 'asciiKeyboard' ? 'A' : undefined,
      asciiCode: type === 'asciiKeyboard' ? 65 : undefined,
      strobe: type === 'asciiKeyboard' ? false : undefined,
      constValue: type === 'constant' ? 1 : undefined,
    },
  };
  // A new bit extender is type zero (Logisim default), which has no extension input
  return type === 'bitExtender' ? configureBitExtender(inst, {}) : inst;
}

// Logic gates whose inputs Logisim can negate one by one (AbstractGate), and that ignore open inputs
export const MULTI_INPUT_GATE_TYPES: ComponentType[] = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'];

// Parts whose single pin can be wider than 1 bit (Logisim Pin and Constant); the pin's width is the part's width
const WIDE_PIN_TYPES = new Set<ComponentType>(['switch', 'led', 'constant']);

export function getBitWidth(comp: CircuitComponentInstance): number {
  if (!WIDE_PIN_TYPES.has(comp.type)) return 1;
  return (comp.type === 'led' ? comp.inputs[0]?.width : comp.outputs[0]?.width) ?? 1;
}

// Body size of a part: a pin wider than 1 bit is drawn like Logisim's, one 10px cell per bit, 8 bits a row;
// a constant is as wide as its hex digits
export function getComponentSize(comp: CircuitComponentInstance): { width: number; height: number } {
  if (comp.type === 'subcircuit') {
    const maxPins = Math.max(comp.inputs.length, comp.outputs.length);
    return { width: 120, height: Math.max(60, (maxPins + 1) * 20) };
  }
  const meta = COMPONENT_CATALOG[comp.type];
  const w = getBitWidth(comp);
  if (MULTI_INPUT_GATE_TYPES.includes(comp.type)) return { width: meta.width, height: multiInputGateHeight(comp.inputs.length) };
  if (comp.type === 'splitter') return { width: 20, height: Math.max(20, Math.ceil(comp.outputs.length / 2) * 20) };
  if (comp.type === 'constant') return { width: Math.max(30, Math.ceil((Math.ceil(w / 4) * 8 + 14) / 10) * 10), height: 20 };
  if (w > 1) return { width: Math.min(w, 8) * 10 + 20, height: Math.ceil(w / 8) * 20 + 20 };
  return { width: meta?.width ?? 60, height: meta?.height ?? 50 };
}

// Give a switch/LED/constant a new bit width: the pin gets the width (and moves with the body), the
// stored value keeps only the bits that still exist
export function setBitWidth(comp: CircuitComponentInstance, width: number): CircuitComponentInstance {
  const w = Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(width)));
  const mask = (n: number | undefined) => (n === undefined ? undefined : n % 2 ** w);
  const pinW = (p: CircuitPin): CircuitPin => {
    const { bits: _bits, width: _width, ...rest } = p;
    return w > 1 ? { ...rest, width: w } : rest;
  };
  const next: CircuitComponentInstance = {
    ...comp,
    inputs: comp.type === 'led' ? comp.inputs.map(pinW) : comp.inputs,
    outputs: comp.type === 'led' ? comp.outputs : comp.outputs.map(pinW),
    state: {
      ...comp.state,
      inputValue: comp.type === 'switch' && w > 1 ? (mask(comp.state.inputValue) ?? (comp.state.on ? 1 : 0)) : undefined,
      constValue: mask(comp.state.constValue),
    },
  };
  if (comp.type === 'switch' && w === 1) next.state.on = (comp.state.inputValue ?? (comp.state.on ? 1 : 0)) % 2 === 1;
  return updatePinPositions(next);
}

// ---- Splitter (Logisim circuit/Splitter*) ----------------------------------------------------------

export type SplitterAppear = 'left' | 'right' | 'center';
export const SPLITTER_MAX_FANOUT = 32;

/**
 * Logisim SplitterAttributes.computeDistribution: end (1..fanout) of each bit, LSB first. Ascending
 * gives the low bits to end 1; with fewer ends than bits the first `bits % fanout` ends take one extra.
 */
export function splitterDistribution(fanout: number, bits: number, ascending = true): number[] {
  const ret = new Array<number>(bits).fill(0);
  if (fanout >= bits) {
    for (let i = 0; i < bits; i++) ret[i] = ascending ? i + 1 : fanout - i;
    return ret;
  }
  const perEnd = Math.floor(bits / fanout);
  let extra = bits % fanout;
  let curEnd = -1;
  let left = 0;
  for (let k = 0; k < bits; k++) {
    const i = ascending ? k : bits - 1 - k;
    if (left === 0) {
      curEnd++;
      left = perEnd;
      if (extra > 0) {
        left++;
        extra--;
      }
    }
    ret[i] = curEnd + 1;
    left--;
  }
  return ret;
}

export function getSplitterConfig(comp: CircuitComponentInstance): { fanout: number; bitEnd: number[]; appear: SplitterAppear } {
  const fanout = Math.max(1, comp.outputs.length);
  return {
    fanout,
    bitEnd: comp.state.splitBitEnd ?? splitterDistribution(fanout, 2),
    appear: comp.state.splitAppear ?? 'left',
  };
}

// Index of each bit inside its end (Logisim Splitter.bit_thread), and the width of every end
export function splitterThreads(bitEnd: number[], fanout: number): { thread: number[]; endWidth: number[] } {
  const endWidth = new Array<number>(fanout).fill(0);
  const thread = bitEnd.map((e) => (e > 0 && e <= fanout ? endWidth[e - 1]++ : -1));
  return { thread, endWidth };
}

// Logisim splitter end labels: runs of consecutive bits per end, e.g. "0-3", "0,2"
export function splitterEndLabels(bitEnd: number[], fanout: number): string[] {
  const labels: string[] = new Array<string>(fanout).fill('');
  let cur = -1;
  let start = 0;
  for (let i = 0; i <= bitEnd.length; i++) {
    const e = i === bitEnd.length ? -1 : bitEnd[i];
    if (e !== cur) {
      if (cur > 0 && cur <= fanout) {
        const run = start === i - 1 ? `${start}` : `${start}-${i - 1}`;
        labels[cur - 1] = labels[cur - 1] ? `${labels[cur - 1]},${run}` : run;
      }
      cur = e;
      start = i;
    }
  }
  return labels;
}

/**
 * New splitter settings. Like Logisim, changing the incoming width or the fan out resets the bit
 * distribution to the default spread; pins keep their ids so attached wires can follow them.
 */
export function configureSplitter(
  comp: CircuitComponentInstance,
  patch: { incoming?: number; fanout?: number; appear?: SplitterAppear; bitEnd?: number[] }
): CircuitComponentInstance {
  const cur = getSplitterConfig(comp);
  const incoming = Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(patch.incoming ?? cur.bitEnd.length)));
  const fanout = Math.max(1, Math.min(SPLITTER_MAX_FANOUT, Math.round(patch.fanout ?? cur.fanout)));
  let bitEnd = cur.bitEnd;
  if (incoming !== cur.bitEnd.length || fanout !== cur.fanout) bitEnd = splitterDistribution(fanout, incoming);
  if (patch.bitEnd && patch.bitEnd.length === incoming) bitEnd = patch.bitEnd.map((e) => (e >= 0 && e <= fanout ? e : 0));
  const { endWidth } = splitterThreads(bitEnd, fanout);
  const strip = (p: CircuitPin): CircuitPin => {
    const { bits: _bits, width: _width, ...rest } = p;
    return rest;
  };
  const combined = strip(comp.inputs[0] ?? { id: `${comp.id}_in0`, name: 'Σ', type: 'input', value: 0, x: 0, y: 0 });
  const outputs: CircuitPin[] = [];
  for (let i = 0; i < fanout; i++) {
    const p = strip(comp.outputs[i] ?? { id: `${comp.id}_out${i}`, name: `${i + 1}`, type: 'output', value: 0, x: 0, y: 0 });
    outputs.push(endWidth[i] === 1 ? p : { ...p, width: endWidth[i] });
  }
  return updatePinPositions({
    ...comp,
    inputs: [incoming > 1 ? { ...combined, width: incoming } : combined],
    outputs,
    state: { ...comp.state, splitBitEnd: bitEnd, splitAppear: patch.appear ?? cur.appear },
  });
}

// ---- Bit extender / bit selector (Logisim wiring/BitExtender, plexers/BitSelector) -----------------

export type ExtendType = 'zero' | 'one' | 'sign' | 'input';

const clampWidth = (n: number) => Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(n)));

// A pin with a new width (no stale bits); width 1 is stored as no width
const pinWithWidth = (p: CircuitPin, w: number): CircuitPin => {
  const { bits: _bits, width: _width, ...rest } = p;
  return w > 1 ? { ...rest, width: w } : rest;
};

const newPin = (comp: CircuitComponentInstance, id: string, name: string, type: 'input' | 'output'): CircuitPin => ({
  id: `${comp.id}_${id}`,
  name,
  type,
  value: 'X',
  x: comp.x,
  y: comp.y,
});

/** New bit extender settings; the extension input exists only for type 'input' (pin ids are kept). */
export function configureBitExtender(
  comp: CircuitComponentInstance,
  patch: { inWidth?: number; outWidth?: number; type?: ExtendType }
): CircuitComponentInstance {
  const inW = clampWidth(patch.inWidth ?? comp.inputs[0]?.width ?? 1);
  const outW = clampWidth(patch.outWidth ?? comp.outputs[0]?.width ?? 1);
  const type = patch.type ?? comp.state.extendType ?? 'zero';
  const inputs = [pinWithWidth(comp.inputs[0] ?? newPin(comp, 'in0', 'in', 'input'), inW)];
  if (type === 'input') inputs.push(pinWithWidth(comp.inputs[1] ?? newPin(comp, 'in1', 'ext', 'input'), 1));
  return updatePinPositions({
    ...comp,
    inputs,
    outputs: [pinWithWidth(comp.outputs[0] ?? newPin(comp, 'out0', 'out', 'output'), outW)],
    state: { ...comp.state, extendType: type },
  });
}

/** Logisim BitSelector.updatePorts: enough select bits to number every group (at least 1). */
export function bitSelectorSelectWidth(dataWidth: number, groupWidth: number): number {
  let groups = Math.ceil(dataWidth / groupWidth) - 1;
  let bits = 1;
  if (groups > 0) {
    while (groups !== 1) {
      groups >>= 1;
      bits++;
    }
  }
  return bits;
}

/** New bit selector settings: data width and output group width; the select width follows. */
export function configureBitSelector(
  comp: CircuitComponentInstance,
  patch: { dataWidth?: number; groupWidth?: number }
): CircuitComponentInstance {
  const dW = clampWidth(patch.dataWidth ?? comp.inputs[0]?.width ?? 1);
  const gW = clampWidth(patch.groupWidth ?? comp.outputs[0]?.width ?? 1);
  return updatePinPositions({
    ...comp,
    inputs: [
      pinWithWidth(comp.inputs[0] ?? newPin(comp, 'in0', 'D', 'input'), dW),
      pinWithWidth(comp.inputs[1] ?? newPin(comp, 'in1', 'S', 'input'), bitSelectorSelectWidth(dW, gW)),
    ],
    outputs: [pinWithWidth(comp.outputs[0] ?? newPin(comp, 'out0', 'Q', 'output'), gW)],
  });
}

/**
 * Unrotated (local frame) Y offset of input pin `idx` on a multi-input gate with `count` inputs.
 * Shared by updatePinPositions and the gate renderer so the drawn input leads match the pins.
 */
export function getMultiInputGatePinRelY(count: number, idx: number, height: number): number {
  if (count === 2) return idx === 0 ? 20 : 40;
  if (count === 3) return idx === 0 ? 10 : idx === 1 ? 30 : 50;
  if (count === 4) return idx === 0 ? 10 : idx === 1 ? 20 : idx === 2 ? 40 : 50;
  if (count === 5) return (idx + 1) * 10;
  // More than 5 inputs: 10px apart around the output like Logisim (an even count skips the middle point)
  const mid = multiInputGateHeight(count) / 2;
  void height;
  if (count % 2 === 1) return mid + 10 * (idx - (count - 1) / 2);
  return mid + 10 * (idx - count / 2) + (idx >= count / 2 ? 10 : 0);
}

/** Body height of a logic gate with `count` inputs: 60 up to 5 inputs, then 10px per input (output stays mid-height on the grid) */
export function multiInputGateHeight(count: number): number {
  if (count <= 5) return 60;
  return (count % 2 === 1 ? count + 1 : count + 2) * 10;
}

export function updatePinPositions(comp: CircuitComponentInstance): CircuitComponentInstance {
  if (comp.type === 'subcircuit') {
    const width = 120;
    const maxPins = Math.max(comp.inputs.length, comp.outputs.length);
    const height = Math.max(60, (maxPins + 1) * 20);
    const rot = comp.rotation || 0;
    const cx = width / 2;
    const cy = height / 2;
    const rotatePoint = (relX: number, relY: number) => {
      if (rot === 0) return { x: Math.round(relX / 10) * 10, y: Math.round(relY / 10) * 10 };
      const rad = (rot * Math.PI) / 180;
      const cos = Math.round(Math.cos(rad));
      const sin = Math.round(Math.sin(rad));
      const dx = relX - cx;
      const dy = relY - cy;
      const rx = cx + (dx * cos - dy * sin);
      const ry = cy + (dx * sin + dy * cos);
      return { x: Math.round(rx / 10) * 10, y: Math.round(ry / 10) * 10 };
    };

    const newInputs = comp.inputs.map((pin, idx) => {
      const relY = 20 * (idx + 1);
      const pt = rotatePoint(0, relY);
      return { ...pin, x: comp.x + pt.x, y: comp.y + pt.y };
    });
    const newOutputs = comp.outputs.map((pin, idx) => {
      const relY = 20 * (idx + 1);
      const pt = rotatePoint(width, relY);
      return { ...pin, x: comp.x + pt.x, y: comp.y + pt.y };
    });
    return { ...comp, inputs: newInputs, outputs: newOutputs };
  }

  const meta = COMPONENT_CATALOG[comp.type];
  const rot = comp.rotation || 0;
  const size = getComponentSize(comp);
  const cx = size.width / 2;
  const cy = size.height / 2;
  // A wide switch/LED/constant keeps its pin on the middle of its side
  const sizedPin = WIDE_PIN_TYPES.has(comp.type) && (comp.type === 'constant' || getBitWidth(comp) > 1)
    ? { relX: comp.type === 'led' ? 0 : size.width, relY: Math.round(size.height / 2 / 10) * 10 }
    : undefined;

  const rotatePoint = (relX: number, relY: number) => {
    if (rot === 0) return { x: Math.round(relX / 10) * 10, y: Math.round(relY / 10) * 10 };
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const dx = relX - cx;
    const dy = relY - cy;
    return {
      x: Math.round((cx + (dx * cos - dy * sin)) / 10) * 10,
      y: Math.round((cy + (dx * sin + dy * cos)) / 10) * 10,
    };
  };

  // Splitter (Logisim SplitterParameters, facing east): the combined end on the left, the ends 20px to
  // the right and 10px apart, above it (left-handed), below it (right-handed) or around it (centered)
  if (comp.type === 'splitter') {
    const n = comp.outputs.length;
    const appear = comp.state.splitAppear ?? 'left';
    const combinedY = appear === 'right' ? 0 : appear === 'center' ? 10 * Math.floor(n / 2) : 10 * n;
    const endY0 = appear === 'right' ? 10 : 0;
    const cp = rotatePoint(0, combinedY);
    return {
      ...comp,
      inputs: comp.inputs.map((pin) => ({ ...pin, x: comp.x + cp.x, y: comp.y + cp.y })),
      outputs: comp.outputs.map((pin, i) => {
        const p = rotatePoint(20, endY0 + 10 * i);
        return { ...pin, x: comp.x + p.x, y: comp.y + p.y };
      }),
    };
  }

  const isMultiInputGate = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'].includes(comp.type);

  const newInputs = comp.inputs.map((pin, idx) => {
    let relX = 0;
    let relY = 0;
    let pinSuffix = `in${idx}`;
    if (isMultiInputGate) {
      relX = 0;
      relY = getMultiInputGatePinRelY(comp.inputs.length, idx, size.height);
      pinSuffix = meta.inputs[idx]?.id || `in${idx}`;
    } else {
      const pinDef = meta.inputs[idx] || { relX: 0, relY: 0, id: `in${idx}` };
      relX = sizedPin?.relX ?? pinDef.relX;
      relY = sizedPin?.relY ?? pinDef.relY;
      pinSuffix = pinDef.id || `in${idx}`;
    }
    const p = rotatePoint(relX, relY);
    const canonicalId = `${comp.id}_${pinSuffix}`;
    const pinId = isMultiInputGate ? canonicalId : (pin.id.startsWith(`${comp.id}_`) ? pin.id : canonicalId);
    return { ...pin, id: pinId, x: comp.x + p.x, y: comp.y + p.y };
  });

  const newOutputs = comp.outputs.map((pin, idx) => {
    const defaultRelY = Math.round((meta.height / 2) / 10) * 10;
    const pinDef = meta.outputs[idx] || { relX: meta.width, relY: defaultRelY, id: idx === 0 ? 'out' : `out${idx}` };
    // A tall gate keeps its output in the middle of its side
    const rawRelY = isMultiInputGate && size.height !== meta.height ? size.height / 2 : pinDef.relY !== undefined ? pinDef.relY : defaultRelY;
    const p = rotatePoint(sizedPin?.relX ?? pinDef.relX, sizedPin?.relY ?? rawRelY);
    const pinSuffix = pinDef.id || (idx === 0 ? 'out' : `out${idx}`);
    const canonicalId = `${comp.id}_${pinSuffix}`;
    const pinId = isMultiInputGate ? canonicalId : (pin.id.startsWith(`${comp.id}_`) ? pin.id : canonicalId);
    return { ...pin, id: pinId, x: comp.x + p.x, y: comp.y + p.y };
  });

  return {
    ...comp,
    inputs: newInputs,
    outputs: newOutputs,
  };
}

// Body sizes for the wire auto-router (same geometry updatePinPositions uses)
setComponentBodySizeResolver((comp) => (comp.type === 'subcircuit' || COMPONENT_CATALOG[comp.type] ? getComponentSize(comp) : null));

/**
 * Propagate logic values across wires and components
 */
// Logisim value algebra for gates: a floating or unknown input is not a valid level, so it
// turns into E unless a controlling value (0 for AND, 1 for OR) decides the output anyway
const isLevel = (v: SignalValue): v is 0 | 1 => v === 0 || v === 1;
const sigNot = (a: SignalValue): SignalValue => (isLevel(a) ? (a === 1 ? 0 : 1) : 'E');
const sigAnd = (a: SignalValue, b: SignalValue): SignalValue =>
  a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : 'E';
const sigOr = (a: SignalValue, b: SignalValue): SignalValue =>
  a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : 'E';
const sigXor = (a: SignalValue, b: SignalValue): SignalValue =>
  isLevel(a) && isLevel(b) ? ((a ^ b) as 0 | 1) : 'E';

// Bits an input pin reads (LSB first): undriven or open bits are x, like Logisim's unknown value
const readBits = (pin: CircuitPin | undefined, w: number): SignalValue[] => {
  const raw = pin?.bits && pin.bits.length === w ? pin.bits : w === 1 && pin ? [pin.value] : new Array<SignalValue>(w).fill('X');
  return raw.map((b) => (b === 'Z' ? 'X' : b));
};


// Parts whose pins take the width of the net they sit on instead of setting it
const WIDTH_FOLLOWERS = new Set<ComponentType>(['tunnel', 'probe', 'pullResistor']);

// Same bit arrays (both absent counts as same)
export const sameBits = (a: SignalValue[] | undefined, b: SignalValue[] | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

// Logisim reads separate select/address pins as one bus: any E bit makes it an error, any other
// undefined bit (x or floating) makes it unknown
const busValue = (vals: SignalValue[]): number | 'X' | 'E' => {
  if (vals.some((v) => v === 'E')) return 'E';
  if (!vals.every(isLevel)) return 'X';
  return vals.reduce<number>((acc, v, i) => acc | ((v as number) << i), 0);
};

// Logisim's adder (Adder.computeSum): a carry-in that is x or floating counts as 0; an E or
// undefined bit makes that sum bit E or x, and the carry spreads it to every higher bit
const logisimSum = (a: SignalValue[], b: SignalValue[], cin: SignalValue): { sum: SignalValue[]; carry: SignalValue } => {
  let carry: SignalValue = cin === 'X' || cin === 'Z' ? 0 : cin;
  const sum: SignalValue[] = [];
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    const bi = b[i];
    if (carry === 'E' || carry === 'X') {
      sum.push(carry);
    } else if (ai === 'E' || bi === 'E') {
      sum.push('E');
      carry = 'E';
    } else if (!isLevel(ai) || !isLevel(bi) || !isLevel(carry)) {
      sum.push('X');
      carry = 'X';
    } else {
      const s: number = ai + bi + carry;
      sum.push((s & 1) as 0 | 1);
      carry = s >= 2 ? 1 : 0;
    }
  }
  return { sum, carry };
};

// Logisim's subtractor: A + NOT B + NOT Bin, borrow = NOT carry (NOT of a non-level is E,
// so an undefined B gives E); a borrow-in that is x or floating counts as 0
const logisimDiff = (a: SignalValue[], b: SignalValue[], bin: SignalValue): { diff: SignalValue[]; borrow: SignalValue } => {
  const { sum, carry } = logisimSum(a, b.map(sigNot), sigNot(bin === 'X' || bin === 'Z' ? 0 : bin));
  return { diff: sum, borrow: sigNot(carry) };
};

// Logisim clocks memory only on a clean 0 -> 1 step, so x or E on the clock never makes an edge
// (the first evaluation never does either: there is no previous level yet)
const risingEdge = (comp: CircuitComponentInstance, clk: SignalValue): boolean => {
  const prevClk = comp.state.lastClk ?? clk;
  comp.state.lastClk = clk;
  return prevClk === 0 && clk === 1;
};

// Gates power up unknown like in Logisim, so feedback loops such as a NAND latch only settle
// once something drives them; combinational logic overwrites the X on the first step
// Parts with Logisim's "Output Value" attribute
export const OUTPUT_MODE_TYPES = ['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor'];
// 0/floating leaves the net on a 1, floating/1 on a 0; x and E pass unchanged (Logisim pullOutput)
const gateOutput = (comp: CircuitComponentInstance, v: SignalValue): SignalValue =>
  (comp.state.outputMode === '0Z' && v === 1) || (comp.state.outputMode === 'Z1' && v === 0) ? 'Z' : v;

const POWER_UP_X_TYPES = new Set<string>(['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState', 'controlledInverter']);


// Gate outputs Logisim computes bit by bit with the 1-bit rules (Value.and/or/xor/not on each bit)
const logicGateBits = (comp: CircuitComponentInstance, connected: CircuitPin[], w: number): SignalValue[] => {
  // No connected input: Logisim gives an error value of the gate's width
  if (connected.length === 0) return new Array<SignalValue>(w).fill('E');
  const negated = comp.state.negated;
  const ins = connected.map((p) => {
    const bits = readBits(p, w);
    return negated?.includes(comp.inputs.indexOf(p)) ? bits.map(sigNot) : bits;
  });
  const t = comp.type;
  const invert = t === 'nand' || t === 'nor' || t === 'xnor';
  const one = (t === 'xor' || t === 'xnor') && comp.state.xorMode === 'one';
  const out: SignalValue[] = [];
  for (let b = 0; b < w; b++) {
    const col = ins.map((bits) => bits[b]);
    let v: SignalValue;
    if (t === 'and' || t === 'nand') v = col.reduce((acc, x) => sigAnd(acc, x));
    else if (t === 'or' || t === 'nor') v = col.reduce((acc, x) => sigOr(acc, x));
    else if (one) {
      // Exactly one 1 (GateFunctions.computeExactlyOne): any undefined bit makes it E
      v = col.every(isLevel) ? (col.filter((x) => x === 1).length === 1 ? 1 : 0) : 'E';
    } else {
      // Odd parity; a single input passes as it is (x stays x) like Logisim's computeOddParity
      v = col.reduce((acc, x) => sigXor(acc, x));
    }
    out.push(gateOutput(comp, invert ? sigNot(v) : v));
  }
  return out;
};

// ---- Gate width (Logisim 'Data Bits' of the gates library) -----------------------------------------------
export const GATE_WIDTH_TYPES: ComponentType[] = ['not', 'buffer', 'and', 'or', 'nand', 'nor', 'xor', 'xnor', 'triState', 'controlledInverter'];
// Controlled buffer / inverter: the data pin and the output take the width, the control pin stays 1 bit
const isGateDataPin = (comp: CircuitComponentInstance, inputIdx: number) =>
  (comp.type !== 'triState' && comp.type !== 'controlledInverter') || inputIdx === 0;

export function getGateWidth(comp: CircuitComponentInstance): number {
  return comp.outputs[0]?.width ?? 1;
}

// New gate width: pins keep their place and id, only their width changes (values restart unknown)
export function setGateWidth(comp: CircuitComponentInstance, width: number): CircuitComponentInstance {
  const w = Math.max(1, Math.min(MAX_BIT_WIDTH, Math.round(width)));
  const pinW = (p: CircuitPin, value: SignalValue): CircuitPin => {
    const { bits: _bits, width: _width, ...rest } = p;
    return w > 1 ? { ...rest, width: w, value } : { ...rest, value };
  };
  return {
    ...comp,
    inputs: comp.inputs.map((p, i) => (isGateDataPin(comp, i) ? pinW(p, 0) : p)),
    outputs: comp.outputs.map((p) => pinW(p, 'X')),
  };
}

export function simulateCircuitStep(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): {
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  hasChanged: boolean;
} {
  let hasChanged = false;

  // Clone components and wires for pure evaluation
  const newComps: CircuitComponentInstance[] = components.map((c) => ({
    ...c,
    inputs: c.inputs.map((p) => ({ ...p })),
    outputs: c.outputs.map((p) => ({ ...p })),
    state: {
      ...c.state,
      rgbPixels: c.state.rgbPixels ? c.state.rgbPixels.map((row) => [...row]) : undefined,
    },
  }));

  const newWires: CircuitWire[] = wires.map((w) => ({ ...w }));

  // Helper map to quickly lookup pins
  const pinMap = new Map<string, CircuitPin>();
  const pinOwner = new Map<string, CircuitComponentInstance>();
  newComps.forEach((c) => {
    c.inputs.forEach((p) => {
      pinMap.set(p.id, p);
      pinOwner.set(p.id, c);
    });
    c.outputs.forEach((p) => {
      pinMap.set(p.id, p);
      pinOwner.set(p.id, c);
    });
  });

  // A wide source drives its number as bits
  const driveNumber = (comp: CircuitComponentInstance, n: number) => {
    const out = comp.outputs[0];
    if (!out) return;
    const w = out.width ?? 1;
    if (w === 1) {
      const v: SignalValue = n % 2 === 1 ? 1 : 0;
      if (out.value !== v) {
        out.value = v;
        hasChanged = true;
      }
      return;
    }
    const bits = numberToBits(n, w);
    if (!sameBits(out.bits, bits)) {
      out.bits = bits;
      out.value = summarizeBits(bits);
      hasChanged = true;
    }
  };

  // Step 1: Update source components outputs (switch, vcc, gnd, clock)
  newComps.forEach((comp) => {
    const portBits = comp.state.portBits;
    if (comp.type === 'switch' && portBits && portBits.length > 1 && comp.outputs[0]) {
      // A wide IC port inside: the outside bits as they are (x/E/Z included)
      const out = comp.outputs[0];
      if (!sameBits(out.bits, portBits)) {
        out.bits = [...portBits];
        out.value = summarizeBits(portBits);
        hasChanged = true;
      }
    } else if (comp.type === 'switch' && (comp.outputs[0]?.width ?? 1) > 1) {
      driveNumber(comp, comp.state.inputValue ?? 0);
    } else if (comp.type === 'constant') {
      driveNumber(comp, comp.state.constValue ?? 1);
    } else if (comp.type === 'switch') {
      const targetVal: SignalValue = comp.state.portValue ?? (comp.state.on ? 1 : 0);
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'pushbutton') {
      const targetVal: SignalValue = comp.state.portValue ?? (comp.state.on ? 1 : 0);
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'clock') {
      const targetVal: SignalValue = comp.state.portValue ?? (comp.state.on ? 1 : 0);
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'vcc') {
      if (comp.outputs[0] && comp.outputs[0].value !== 1) {
        comp.outputs[0].value = 1;
        hasChanged = true;
      }
    } else if (comp.type === 'gnd') {
      if (comp.outputs[0] && comp.outputs[0].value !== 0) {
        comp.outputs[0].value = 0;
        hasChanged = true;
      }
    } else if (comp.type === 'dipSwitch4') {
      const switches = comp.state.dipSwitches || [false, false, false, false];
      for (let i = 0; i < 4; i++) {
        const targetVal: SignalValue = switches[i] ? 1 : 0;
        if (comp.outputs[i] && comp.outputs[i].value !== targetVal) {
          comp.outputs[i].value = targetVal;
          hasChanged = true;
        }
      }
    } else if (comp.type === 'asciiKeyboard') {
      const code = comp.state.asciiCode ?? 65;
      const strobeVal: SignalValue = comp.state.strobe ? 1 : 0;
      for (let i = 0; i < 7; i++) {
        const targetBit: SignalValue = (code & (1 << i)) ? 1 : 0;
        if (comp.outputs[i] && comp.outputs[i].value !== targetBit) {
          comp.outputs[i].value = targetBit;
          hasChanged = true;
        }
      }
      if (comp.outputs[7] && comp.outputs[7].value !== strobeVal) {
        comp.outputs[7].value = strobeVal;
        hasChanged = true;
      }
    }
  });

  // Step 2: Propagate output values into connected input pins via electrical nets & detect bus contention (Electrical Net Conflict)
  const parent = new Map<string, string>();
  function findRoot(pinId: string): string {
    if (!parent.has(pinId)) parent.set(pinId, pinId);
    let curr = pinId;
    while (curr !== parent.get(curr)) {
      const p = parent.get(curr)!;
      parent.set(curr, parent.get(p)!);
      curr = p;
    }
    return curr;
  }
  function unionPins(a: string, b: string) {
    const rootA = findRoot(a);
    const rootB = findRoot(b);
    if (rootA !== rootB) {
      parent.set(rootA, rootB);
    }
  }

  // Connect pins to their 10px snapped grid locations (Logisim CircuitWires coordinate connectivity)
  pinMap.forEach((pin, pinId) => {
    const gx = Math.round(pin.x / 10) * 10;
    const gy = Math.round(pin.y / 10) * 10;
    unionPins(pinId, `loc_${gx}_${gy}`);
  });

  // Connect pins and grid locations via wires
  newWires.forEach((w) => {
    if (w.startPoint && w.endPoint) {
      const sx = Math.round(w.startPoint.x / 10) * 10;
      const sy = Math.round(w.startPoint.y / 10) * 10;
      const ex = Math.round(w.endPoint.x / 10) * 10;
      const ey = Math.round(w.endPoint.y / 10) * 10;
      const ks = `loc_${sx}_${sy}`;
      const ke = `loc_${ex}_${ey}`;
      unionPins(ks, ke);
    } else {
      if (w.fromPinId && w.toPinId) {
        unionPins(w.fromPinId, w.toPinId);
      }
      if (w.branchPoint && w.toPinId) {
        const bx = Math.round(w.branchPoint.x / 10) * 10;
        const by = Math.round(w.branchPoint.y / 10) * 10;
        unionPins(`loc_${bx}_${by}`, w.toPinId);
      }
    }
  });

  // Connect matching Tunnels wirelessly into the same electrical net (Global Net Wireless Bus)
  const tunnelsByLabel = new Map<string, string[]>();
  newComps
    .filter((c) => c.type === 'tunnel')
    .forEach((t) => {
      const lbl = (t.label || 'Tünel').trim();
      if (!tunnelsByLabel.has(lbl)) tunnelsByLabel.set(lbl, []);
      const inPin = t.inputs[0]?.id;
      const outPin = t.outputs[0]?.id;
      if (inPin && outPin) unionPins(inPin, outPin);
      if (inPin) tunnelsByLabel.get(lbl)!.push(inPin);
    });
  tunnelsByLabel.forEach((pinIds) => {
    for (let i = 1; i < pinIds.length; i++) {
      if (pinIds[0] && pinIds[i]) unionPins(pinIds[0], pinIds[i]);
    }
  });

  // Group pins and wires by root net
  const netPins = new Map<string, string[]>();
  pinMap.forEach((_, pinId) => {
    const root = findRoot(pinId);
    if (!netPins.has(root)) netPins.set(root, []);
    netPins.get(root)!.push(pinId);
  });

  const netWires = new Map<string, CircuitWire[]>();
  newWires.forEach((w) => {
    const key = w.startPoint
      ? `loc_${Math.round(w.startPoint.x / 10) * 10}_${Math.round(w.startPoint.y / 10) * 10}`
      : w.fromPinId || w.id;
    const root = findRoot(key);
    if (!netWires.has(root)) netWires.set(root, []);
    netWires.get(root)!.push(w);
    if (!netPins.has(root)) netPins.set(root, []);
  });

  // Active driving output pins: a high-impedance tri-state buffer and the passive tunnel conduits don't drive
  const isDriver = (pinId: string): boolean => {
    const pin = pinMap.get(pinId);
    if (!pin || pin.type !== 'output') return false;
    const ownerComp = pinOwner.get(pinId);
    if ((ownerComp?.type === 'triState' || ownerComp?.type === 'controlledInverter') && ownerComp.state.hiZ) return false;
    // Tunnels and splitters are passive: a splitter only joins bit threads (bitLinks below)
    return ownerComp?.type !== 'tunnel' && ownerComp?.type !== 'splitter';
  };
  // Logisim pull resistors only act on a net nothing drives to a defined value: one level pulls
  // it there, differing pulls (or an X pull) make it E
  const netPulls = (pinsInNet: string[]): Set<SignalValue> => {
    const pulls = new Set<SignalValue>();
    pinsInNet.forEach((pinId) => {
      const owner = pinOwner.get(pinId);
      if (owner?.type === 'pullResistor') pulls.add(owner.state.pullValue === 1 ? 1 : owner.state.pullValue === 'X' ? 'E' : 0);
    });
    return pulls;
  };
  const applyPulls = (v: SignalValue, pulls: Set<SignalValue>): SignalValue =>
    (v === 'Z' || v === 'X') && pulls.size > 0 ? (pulls.size === 1 ? pulls.values().next().value! : 'E') : v;
  // Differing driven values (x/z don't count) short each other out
  const isConflict = (vals: SignalValue[]): boolean => new Set(vals.filter((v) => v !== 'Z' && v !== 'X')).size > 1;

  // Width of each net from the pins on it (Logisim CircuitWires bundle widths); tunnels, probes and
  // pull resistors take the width of the net they sit on. 0 = pins of different widths meet (Logisim
  // "Incompatible widths": the whole net reads x)
  const netWidth = new Map<string, number>();
  const netWidthList = new Map<string, number[]>();
  netPins.forEach((pinsInNet, root) => {
    const widths = new Set<number>();
    pinsInNet.forEach((pinId) => {
      const owner = pinOwner.get(pinId);
      if (owner && WIDTH_FOLLOWERS.has(owner.type)) return;
      const w = pinMap.get(pinId)!.width ?? 1;
      // A splitter end with no bits mapped to it carries nothing (Logisim width-0 end)
      if (w > 0) widths.add(w);
    });
    if (widths.size > 1) {
      netWidth.set(root, 0);
      netWidthList.set(root, [...widths].sort((a, b) => a - b));
    } else {
      netWidth.set(root, widths.size === 1 ? [...widths][0] : 1);
    }
  });

  // Bit links between nets, [netA, bitA, netB, bitB] (Logisim splitters unite the threads of their
  // ends); nets on a link, and every net wider than 1, are resolved bit by bit below
  const bitLinks: [string, number, string, number][] = [];
  newComps.forEach((c) => {
    if (c.type !== 'splitter' || !c.inputs[0]) return;
    const { fanout, bitEnd } = getSplitterConfig(c);
    const { thread } = splitterThreads(bitEnd, fanout);
    const combined = findRoot(c.inputs[0].id);
    bitEnd.forEach((e, i) => {
      const end = e > 0 ? c.outputs[e - 1] : undefined;
      if (end) bitLinks.push([combined, i, findRoot(end.id), thread[i]]);
    });
  });
  const linkedNets = new Set<string>();
  bitLinks.forEach(([a, , b]) => {
    linkedNets.add(a);
    linkedNets.add(b);
  });

  // Write a net's resolved value to its wires and to the pins reading it (inputs and passive tunnel pins)
  const assignNet = (root: string, value: SignalValue, bits: SignalValue[] | undefined, hasConflict: boolean, widthError: boolean) => {
    (netWires.get(root) || []).forEach((w) => {
      if (w.hasConflict !== hasConflict) {
        w.hasConflict = hasConflict;
        hasChanged = true;
      }
      if (w.value !== value) {
        w.value = value;
        hasChanged = true;
      }
      if (!sameBits(w.bits, bits)) {
        w.bits = bits;
        w.width = bits ? bits.length : undefined;
        hasChanged = true;
      }
      if (!!w.widthError !== widthError) {
        w.widthError = widthError || undefined;
        hasChanged = true;
      }
      const widthList = widthError ? netWidthList.get(root) : undefined;
      if (String(w.widthList ?? '') !== String(widthList ?? '')) {
        w.widthList = widthList;
        hasChanged = true;
      }
    });
    netPins.get(root)!.forEach((pinId) => {
      const pin = pinMap.get(pinId);
      if (!pin) return;
      const ownerComp = pinOwner.get(pinId);
      if (pin.type === 'input' || ownerComp?.type === 'tunnel') {
        if (pin.value !== value) {
          pin.value = value;
          hasChanged = true;
        }
        // A wide pin on a net of the wrong width reads all bits x
        const pinBits = bits ?? (widthError && (pin.width ?? 1) > 1 ? new Array<SignalValue>(pin.width!).fill('X') : undefined);
        if (!sameBits(pin.bits, pinBits)) {
          pin.bits = pinBits;
          hasChanged = true;
        }
      }
    });
  };

  // Evaluate each 1-bit electrical net (nets of the wrong width read x)
  netPins.forEach((pinsInNet, root) => {
    const width = netWidth.get(root)!;
    if (width === 0) {
      assignNet(root, 'X', undefined, false, true);
      return;
    }
    if (width > 1 || linkedNets.has(root)) return;

    const driverVals = pinsInNet.filter(isDriver).map((id) => pinMap.get(id)!.value);
    // Logisim value model: floating and unknown drivers don't count (x combined with 1 is 1),
    // an undriven net floats (Z) or stays unknown (X), and differing driven values short each other out (E)
    const resolvedValue = applyPulls(resolveDrivers(driverVals), netPulls(pinsInNet));
    assignNet(root, resolvedValue, undefined, isConflict(driverVals), false);
  });

  // Multi-bit and linked nets: each bit is its own net (a Logisim wire thread), joined across links
  const bitParent = new Map<string, string>();
  const bitFind = (k: string): string => {
    let r = k;
    while (bitParent.has(r) && bitParent.get(r) !== r) r = bitParent.get(r)!;
    if (r !== k) bitParent.set(k, r);
    return r;
  };
  bitLinks.forEach(([a, ba, b, bb]) => {
    // Links into a net of the wrong width (or past its width) are dropped, as Logisim skips invalid bundles
    if (netWidth.get(a)! <= ba || netWidth.get(b)! <= bb) return;
    const ra = bitFind(`${a}#${ba}`);
    const rb = bitFind(`${b}#${bb}`);
    if (ra !== rb) bitParent.set(ra, rb);
  });
  const bitNets: string[] = [];
  netPins.forEach((_, root) => {
    const width = netWidth.get(root)!;
    if (width > 1 || (width === 1 && linkedNets.has(root))) bitNets.push(root);
  });
  if (bitNets.length > 0) {
    const threads = new Map<string, [string, number][]>();
    bitNets.forEach((root) => {
      for (let b = 0; b < netWidth.get(root)!; b++) {
        const key = bitFind(`${root}#${b}`);
        if (!threads.has(key)) threads.set(key, []);
        threads.get(key)!.push([root, b]);
      }
    });
    const threadValue = new Map<string, { value: SignalValue; conflict: boolean }>();
    threads.forEach((members, key) => {
      const driverVals: SignalValue[] = [];
      const pulls = new Set<SignalValue>();
      members.forEach(([root, b]) => {
        const pinsInNet = netPins.get(root)!;
        pinsInNet.forEach((id) => {
          if (isDriver(id)) {
            const pin = pinMap.get(id)!;
            driverVals.push(pin.bits?.[b] ?? pin.value);
          }
        });
        netPulls(pinsInNet).forEach((p) => pulls.add(p));
      });
      threadValue.set(key, { value: applyPulls(resolveDrivers(driverVals), pulls), conflict: isConflict(driverVals) });
    });
    bitNets.forEach((root) => {
      const width = netWidth.get(root)!;
      const bits: SignalValue[] = [];
      let conflict = false;
      for (let b = 0; b < width; b++) {
        const t = threadValue.get(bitFind(`${root}#${b}`))!;
        bits.push(t.value);
        conflict = conflict || t.conflict;
      }
      if (width === 1) assignNet(root, bits[0], undefined, conflict, false);
      else assignNet(root, summarizeBits(bits), bits, conflict, false);
    });
  }

  // Helper to determine if a pin is electrically connected to a wire or other pin
  const isPinConnected = (pinId: string): boolean => {
    const root = findRoot(pinId);
    const wiresCount = netWires.get(root)?.length || 0;
    if (wiresCount > 0) return true;
    const pins = netPins.get(root);
    if (pins && pins.length > 1) return true;
    return false;
  };

  // Step 3: Compute gate/block outputs based on their current inputs
  newComps.forEach((comp) => {
    const inVals = comp.inputs.map((p) => (p.value === 1 ? 1 : 0));
    const raw = comp.inputs.map((p) => p.value);
    const setOut = (idx: number, val: SignalValue) => {
      if (comp.outputs[idx] && comp.outputs[idx].value !== val) {
        comp.outputs[idx].value = val;
        hasChanged = true;
      }
    };
    // A multi-bit output takes its bits (a 1-bit one just its value)
    const setBitsOut = (idx: number, bits: SignalValue[]) => {
      const out = comp.outputs[idx];
      if (!out) return;
      if (bits.length === 1) {
        setOut(idx, bits[0]);
        return;
      }
      if (!sameBits(out.bits, bits)) {
        out.bits = bits;
        out.value = summarizeBits(bits);
        hasChanged = true;
      }
    };
    // In Logisim, multi-input logic gates ignore unconnected (floating) input pins
    const connectedInputs = comp.inputs.filter((p) => isPinConnected(p.id));

    switch (comp.type) {
      case 'not': {
        // Logisim NOT: each bit inverted, an undefined bit (or an open input) gives E
        const w = getGateWidth(comp);
        setBitsOut(0, readBits(comp.inputs[0], w).map((v) => gateOutput(comp, sigNot(v))));
        break;
      }
      case 'buffer': {
        // Logisim buffer: passes 0/1/E unchanged, an undriven or open input comes out as x
        const w = getGateWidth(comp);
        setBitsOut(0, readBits(comp.inputs[0], w).map((v) => gateOutput(comp, v)));
        break;
      }
      case 'and':
      case 'or':
      case 'nand':
      case 'nor':
      case 'xor':
      case 'xnor':
        setBitsOut(0, logicGateBits(comp, connectedInputs, getGateWidth(comp)));
        break;
      case 'triState':
      case 'controlledInverter': {
        // Logisim controlled buffer / inverter: enable 1 passes the data (inverted: undefined bits -> E),
        // 0 floats, anything else is an error on every bit (Logisim 2.7.1; evolution floats on x/open enable)
        const w = getGateWidth(comp);
        const en = comp.inputs[1]?.value ?? 'Z';
        const isHiZ = en === 0;
        comp.state.hiZ = isHiZ;
        const data = readBits(comp.inputs[0], w);
        setBitsOut(
          0,
          isHiZ
            ? new Array<SignalValue>(w).fill('Z')
            : en === 1
              ? comp.type === 'controlledInverter'
                ? data.map(sigNot)
                : data
              : new Array<SignalValue>(w).fill('E')
        );
        break;
      }
      case 'bitExtender': {
        // Logisim Value.extendWidth: the low bits pass as they are (x/E included, extra ones cut off),
        // new high bits are 0, 1, the top input bit (sign) or the extension input (x when open)
        const inW = comp.inputs[0]?.width ?? 1;
        const src = readBits(comp.inputs[0], inW);
        const t = comp.state.extendType ?? 'zero';
        const ext: SignalValue = t === 'one' ? 1 : t === 'sign' ? src[inW - 1] : t === 'input' ? readBits(comp.inputs[1], 1)[0] : 0;
        const outW = comp.outputs[0]?.width ?? 1;
        setBitsOut(0, Array.from({ length: outW }, (_, i) => (i < inW ? src[i] : ext)));
        break;
      }
      case 'bitSelector': {
        // Logisim BitSelector: group `select` of the data (bits past the data end are 0); a select
        // with any x/E bit gives all x
        const dW = comp.inputs[0]?.width ?? 1;
        const gW = comp.outputs[0]?.width ?? 1;
        const data = readBits(comp.inputs[0], dW);
        const sel = bitsToNumber(readBits(comp.inputs[1], comp.inputs[1]?.width ?? 1));
        setBitsOut(0, Array.from({ length: gW }, (_, i): SignalValue => {
          if (sel === undefined) return 'X';
          const b = sel * gW + i;
          return b < dW ? data[b] : 0;
        }));
        break;
      }
      case 'splitter4': {
        // Like a Logisim splitter, every bit passes through unchanged (x/E included)
        for (let i = 0; i < 4; i++) setOut(i, raw[i] ?? 'Z');
        break;
      }
      case 'demux2':
      case 'demux4': {
        // Logisim demultiplexer: the selected output carries D as is, the others are 0;
        // an undefined select makes every output x (or E)
        const sel = busValue(raw.slice(1));
        for (let i = 0; i < comp.outputs.length; i++) {
          setOut(i, typeof sel === 'number' ? (i === sel ? raw[0] : 0) : sel);
        }
        break;
      }
      case 'alu4': {
        // No Logisim counterpart: an undefined operation select, or an E / undefined operand bit
        // (carry-in too for add/sub; open or x counts as 0 like Logisim's adder), makes every output E or x
        const op = busValue([raw[9], raw[10]]);
        const used = [...raw.slice(0, 4), ...raw.slice(5, 9)];
        if (typeof op === 'number' && op < 2 && raw[4] !== 'X' && raw[4] !== 'Z') used.push(raw[4]);
        const bad: SignalValue | null =
          typeof op !== 'number' ? op : used.some((v) => v === 'E') ? 'E' : used.every(isLevel) ? null : 'X';
        if (bad !== null) {
          for (let i = 0; i < comp.outputs.length; i++) setOut(i, bad);
          break;
        }
        const a = (inVals[0] || 0) + (inVals[1] || 0) * 2 + (inVals[2] || 0) * 4 + (inVals[3] || 0) * 8;
        const cin = inVals[4] || 0;
        const b = (inVals[5] || 0) + (inVals[6] || 0) * 2 + (inVals[7] || 0) * 4 + (inVals[8] || 0) * 8;
        const s0 = inVals[9] || 0;
        const s1 = inVals[10] || 0;
        const mode = s0 + s1 * 2;

        let result = 0;
        let cout = 0;
        if (mode === 0) {
          const sum = a + b + cin;
          result = sum & 0xf;
          cout = sum > 15 ? 1 : 0;
        } else if (mode === 1) {
          const diff = a - b - cin;
          result = (diff + 16) & 0xf;
          cout = a >= b + cin ? 1 : 0;
        } else if (mode === 2) {
          result = (a & b) & 0xf;
          cout = 0;
        } else {
          result = (a | b) & 0xf;
          cout = 0;
        }

        const isZero: SignalValue = result === 0 ? 1 : 0;
        comp.state.aluResult = result;

        for (let bit = 0; bit < 4; bit++) {
          const bitVal: SignalValue = ((result >> bit) & 1) === 1 ? 1 : 0;
          if (comp.outputs[bit] && comp.outputs[bit].value !== bitVal) {
            comp.outputs[bit].value = bitVal;
            hasChanged = true;
          }
        }
        if (comp.outputs[4] && comp.outputs[4].value !== cout) {
          comp.outputs[4].value = cout as SignalValue;
          hasChanged = true;
        }
        if (comp.outputs[5] && comp.outputs[5].value !== isZero) {
          comp.outputs[5].value = isZero;
          hasChanged = true;
        }
        break;
      }
      case 'register4': {
        // Logisim register: only an enable of 0 blocks loading (open, x and E enable it), only a
        // clear at 1 clears, and a D that is not fully defined is not loaded
        const dBits = busValue(raw.slice(0, 4));
        const isRisingEdge = risingEdge(comp, raw[4]);
        const we = raw[5] !== 0;
        const rst = raw[6];

        let curVal = comp.state.regVal ?? 0;
        if (rst === 1) {
          curVal = 0;
          if (comp.state.regVal !== 0) {
            comp.state.regVal = 0;
            hasChanged = true;
          }
        } else if (isRisingEdge && we && typeof dBits === 'number') {
          const d = dBits;
          curVal = d;
          if (comp.state.regVal !== d) {
            comp.state.regVal = d;
            hasChanged = true;
          }
        }

        for (let bit = 0; bit < 4; bit++) {
          const bitVal: SignalValue = ((curVal >> bit) & 1) === 1 ? 1 : 0;
          if (comp.outputs[bit] && comp.outputs[bit].value !== bitVal) {
            comp.outputs[bit].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'decoder2to4':
      case 'decoder3to8': {
        // Logisim decoder: only an enable of 0 disables (all outputs 0 here, active-high like the
        // 74HC238), an enable of E gives E, and an undefined address gives x (or E) on every output
        const en = raw[0];
        const sel = en === 0 ? -1 : en === 'E' && isPinConnected(comp.inputs[0]?.id ?? '') ? 'E' : busValue(raw.slice(1));
        for (let i = 0; i < comp.outputs.length; i++) {
          setOut(i, typeof sel === 'number' ? (i === sel ? 1 : 0) : sel);
        }
        break;
      }
      case 'comparator4': {
        // Logisim unsigned comparator: walks from the MSB and stops at the first bit pair that
        // differs; an E or undefined bit met before that makes all three outputs E or x
        let res: SignalValue[] = [0, 1, 0];
        for (let i = 3; i >= 0; i--) {
          const a = raw[i];
          const b = raw[4 + i];
          if (a === 'E' || b === 'E') {
            res = ['E', 'E', 'E'];
            break;
          }
          if (!isLevel(a) || !isLevel(b)) {
            res = ['X', 'X', 'X'];
            break;
          }
          if (a !== b) {
            res = a === 1 ? [1, 0, 0] : [0, 0, 1];
            break;
          }
        }
        res.forEach((v, i) => setOut(i, v));
        break;
      }
      case 'counter4': {
        const isRisingEdge = risingEdge(comp, raw[0]);
        const rst = raw[1];

        let curCount = comp.state.count ?? 0;
        if (rst === 1) {
          curCount = 0;
          if (comp.state.count !== 0) {
            comp.state.count = 0;
            hasChanged = true;
          }
        } else if (isRisingEdge) {
          curCount = (curCount + 1) % 16;
          comp.state.count = curCount;
          hasChanged = true;
        }

        for (let bit = 0; bit < 4; bit++) {
          const bitVal: SignalValue = ((curCount >> bit) & 1) === 1 ? 1 : 0;
          if (comp.outputs[bit] && comp.outputs[bit].value !== bitVal) {
            comp.outputs[bit].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'halfAdder':
      case 'fullAdder': {
        // Logisim 1-bit adder; the half adder is one with its carry-in left open
        const { sum, carry } = logisimSum([raw[0]], [raw[1]], raw[2] ?? 'Z');
        setOut(0, sum[0]);
        setOut(1, carry);
        break;
      }
      case 'halfSubtractor':
      case 'fullSubtractor': {
        const { diff, borrow } = logisimDiff([raw[0]], [raw[1]], raw[2] ?? 'Z');
        setOut(0, diff[0]);
        setOut(1, borrow);
        break;
      }
      case 'bcdTo7Seg': {
        // No Logisim counterpart: an E input makes every segment output E, any other undefined one x
        const code = busValue(raw.slice(0, 4));
        if (typeof code !== 'number') {
          for (let i = 0; i < 7; i++) setOut(i, code);
          break;
        }
        const a = inVals[0] ?? 0;
        const b = inVals[1] ?? 0;
        const c = inVals[2] ?? 0;
        const d = inVals[3] ?? 0;
        const num = (a === 1 ? 1 : 0) | ((b === 1 ? 1 : 0) << 1) | ((c === 1 ? 1 : 0) << 2) | ((d === 1 ? 1 : 0) << 3);
        const map = HEX_7SEG_MAP[num % 16] || HEX_7SEG_MAP[0];
        const segs: SignalValue[] = [
          map.a ? 1 : 0,
          map.b ? 1 : 0,
          map.c ? 1 : 0,
          map.d ? 1 : 0,
          map.e ? 1 : 0,
          map.f ? 1 : 0,
          map.g ? 1 : 0,
        ];
        for (let i = 0; i < 7; i++) {
          if (comp.outputs[i] && comp.outputs[i].value !== segs[i]) {
            comp.outputs[i].value = segs[i];
            hasChanged = true;
          }
        }
        break;
      }
      case 'mux2':
      case 'mux4':
      case 'mux8': {
        // Logisim multiplexer: the selected input passes as is (x/E included); an undefined
        // select gives x, an E bit in it gives E
        const n = comp.type === 'mux2' ? 2 : comp.type === 'mux4' ? 4 : 8;
        const sel = busValue(raw.slice(n, n + Math.log2(n)));
        const y: SignalValue = typeof sel === 'number' ? raw[sel] ?? 'Z' : sel;
        setOut(0, y);
        // mux8's W is the inverted output (like the 74HC151), so a non-level Y makes it E
        if (comp.type === 'mux8') setOut(1, sigNot(y));
        break;
      }
      case 'priorityEncoder4to2': {
        // Logisim priority encoder: only inputs at 1 count; with none the code is x and V is 0
        let hi = -1;
        for (let i = 3; i >= 0; i--) {
          if (raw[i] === 1) {
            hi = i;
            break;
          }
        }
        setOut(0, hi < 0 ? 'X' : hi >> 1 ? 1 : 0);
        setOut(1, hi < 0 ? 'X' : hi & 1 ? 1 : 0);
        setOut(2, hi < 0 ? 0 : 1);
        break;
      }
      case 'shiftRegister4': {
        const isRisingEdge = risingEdge(comp, raw[0]);
        const rst = raw[1];
        // Like Logisim's shift register the serial bit is stored as is, so an x shifted in shows up
        // on the outputs (a floating one is kept as x); an undefined mode select does not shift
        const sl: SignalValue = raw[2] === 'Z' ? 'X' : raw[2];
        const sr: SignalValue = raw[3] === 'Z' ? 'X' : raw[3];
        const mode = busValue([raw[4], raw[5]]);

        if (!Array.isArray(comp.state.regBits)) {
          comp.state.regBits = [0, 0, 0, 0];
        }

        if (rst === 1) {
          comp.state.regBits = [0, 0, 0, 0];
        } else {
          if (isRisingEdge) {
            const cur = [...comp.state.regBits];
            // Same directions as the 74HC194 this part models
            if (mode === 1) {
              // Shift Right: SR (DSR) into Q0, Q0 into Q1, Q1 into Q2, Q2 into Q3
              comp.state.regBits = [sr, cur[0], cur[1], cur[2]];
            } else if (mode === 2) {
              // Shift Left: SL (DSL) into Q3, Q3 into Q2, Q2 into Q1, Q1 into Q0
              comp.state.regBits = [cur[1], cur[2], cur[3], sl];
            }
          }
        }
        for (let b = 0; b < 4; b++) setOut(b, comp.state.regBits[b] ?? 0);
        break;
      }
      case 'sevenSegment': {
        // Direct segment mapping handled in renderer
        break;
      }
      case 'hexDisplay': {
        // Like Logisim's hex digit, any input that is not 0/1 shows a dash (stored as -1)
        const code = busValue(raw.slice(0, 4));
        const hexVal = typeof code === 'number' ? code : -1;
        if (comp.state.hexVal !== hexVal) {
          comp.state.hexVal = hexVal;
          hasChanged = true;
        }
        break;
      }
      case 'buzzer': {
        const en = inVals[0] === 1;
        const n0 = inVals[1] === 1 ? 1 : 0;
        const n1 = inVals[2] === 1 ? 2 : 0;
        const n2 = inVals[3] === 1 ? 4 : 0;
        const n3 = inVals[4] === 1 ? 8 : 0;
        const note = inVals.length > 1 ? n0 + n1 + n2 + n3 : 9;
        if (comp.state.on !== en || comp.state.buzzerNote !== note) {
          comp.state.on = en;
          comp.state.buzzerNote = note;
          hasChanged = true;
        }
        break;
      }
      case 'dotMatrix8x8': {
        const rows = inVals.slice(0, 8).map((v) => v === 1);
        const cols = inVals.slice(8, 16).map((v) => v === 1);
        const grid: boolean[][] = [];
        for (let r = 0; r < 8; r++) {
          grid[r] = [];
          for (let c = 0; c < 8; c++) {
            grid[r][c] = !!rows[r] && !!cols[c];
          }
        }
        comp.state.matrixGrid = grid;
        break;
      }
      case 'rgbMatrix16x16': {
        const xVal = (inVals[0] === 1 ? 1 : 0) | ((inVals[1] === 1 ? 2 : 0)) | ((inVals[2] === 1 ? 4 : 0)) | ((inVals[3] === 1 ? 8 : 0));
        const yVal = (inVals[4] === 1 ? 1 : 0) | ((inVals[5] === 1 ? 2 : 0)) | ((inVals[6] === 1 ? 4 : 0)) | ((inVals[7] === 1 ? 8 : 0));
        const rVal = inVals[8] === 1;
        const gVal = inVals[9] === 1;
        const bVal = inVals[10] === 1;
        const weVal = inVals[11] === 1;
        const rstVal = inVals[13] === 1;
        const isRising = risingEdge(comp, raw[12]);

        if (!comp.state.rgbPixels || comp.state.rgbPixels.length !== 16) {
          comp.state.rgbPixels = Array.from({ length: 16 }, () => Array(16).fill('#050505'));
        }

        const clkPin = comp.inputs[12];
        const isClkConnected = clkPin
          ? (netWires.get(findRoot(clkPin.id))?.length ?? 0) > 0 ||
            (netPins.get(findRoot(clkPin.id))?.length ?? 0) > 1
          : false;

        if (rstVal) {
          comp.state.rgbPixels = Array.from({ length: 16 }, () => Array(16).fill('#050505'));
          hasChanged = true;
        } else if (weVal && (isRising || !isClkConnected)) {
          let hexCol = '#050505';
          if (rVal && gVal && bVal) hexCol = '#ffffff'; // Beyaz (R+G+B)
          else if (rVal && gVal && !bVal) hexCol = '#facc15'; // Sarı (R+G)
          else if (rVal && !gVal && bVal) hexCol = '#d946ef'; // Macenta / Fuşya (R+B)
          else if (rVal && !gVal && !bVal) hexCol = '#ef4444'; // Kırmızı (R)
          else if (!rVal && gVal && bVal) hexCol = '#06b6d4'; // Camgöbeği / Turkuaz (G+B)
          else if (!rVal && gVal && !bVal) hexCol = '#10b981'; // Canlı Zümrüt Yeşili (G)
          else if (!rVal && !gVal && bVal) hexCol = '#1d4ed8'; // Derin Saf Mavi (B)

          if (xVal >= 0 && xVal < 16 && yVal >= 0 && yVal < 16) {
            if (comp.state.rgbPixels[yVal][xVal] !== hexCol) {
              comp.state.rgbPixels[yVal][xVal] = hexCol;
              hasChanged = true;
            }
          }
        }
        break;
      }
      case 'asciiKeyboard': {
        const clr = inVals[0] === 1;
        if (clr && comp.state.strobe) {
          comp.state.strobe = false;
          if (comp.outputs[7] && comp.outputs[7].value !== 0) {
            comp.outputs[7].value = 0;
            hasChanged = true;
          }
        }
        break;
      }
      case 'dFlipFlop': {
        // Logisim: a D that is x or E at the edge leaves the stored value unchanged
        const d = raw[0];
        if (risingEdge(comp, raw[1]) && isLevel(d)) {
          const nextQ = d;
          const nextQBar: SignalValue = d === 1 ? 0 : 1;
          if (comp.state.q !== nextQ) {
            comp.state.q = nextQ;
            comp.state.qBar = nextQBar;
            hasChanged = true;
          }
        }
        const qVal = comp.state.q ?? 0;
        const qBarVal = comp.state.qBar ?? 1;
        if (comp.outputs[0] && comp.outputs[0].value !== qVal) {
          comp.outputs[0].value = qVal;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== qBarVal) {
          comp.outputs[1].value = qBarVal;
          hasChanged = true;
        }
        break;
      }
      case 'jkFlipFlop': {
        // Logisim: unless both J and K are 0/1 the edge leaves the stored value unchanged
        const j = raw[0];
        const k = raw[2];
        if (risingEdge(comp, raw[1]) && isLevel(j) && isLevel(k)) {
          let nextQ = comp.state.q ?? 0;
          if (j === 0 && k === 1) nextQ = 0;
          else if (j === 1 && k === 0) nextQ = 1;
          else if (j === 1 && k === 1) nextQ = nextQ === 1 ? 0 : 1;

          const nextQBar: SignalValue = nextQ === 1 ? 0 : 1;
          if (comp.state.q !== nextQ) {
            comp.state.q = nextQ;
            comp.state.qBar = nextQBar;
            hasChanged = true;
          }
        }
        const qVal = comp.state.q ?? 0;
        const qBarVal = comp.state.qBar ?? 1;
        if (comp.outputs[0] && comp.outputs[0].value !== qVal) {
          comp.outputs[0].value = qVal;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== qBarVal) {
          comp.outputs[1].value = qBarVal;
          hasChanged = true;
        }
        break;
      }
      case 'srLatch': {
        // Like Logisim's S-R flip-flop: an x or E on S or R holds the state (as S = R = 1 does)
        const s = raw[0];
        const r = raw[1];
        if (s === 1 && r === 0) {
          if (comp.state.q !== 1) {
            comp.state.q = 1;
            comp.state.qBar = 0;
            hasChanged = true;
          }
        } else if (s === 0 && r === 1) {
          if (comp.state.q !== 0) {
            comp.state.q = 0;
            comp.state.qBar = 1;
            hasChanged = true;
          }
        }
        const qVal = comp.state.q ?? 0;
        const qBarVal = comp.state.qBar ?? 1;
        if (comp.outputs[0] && comp.outputs[0].value !== qVal) {
          comp.outputs[0].value = qVal;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== qBarVal) {
          comp.outputs[1].value = qBarVal;
          hasChanged = true;
        }
        break;
      }
      case 'tFlipFlop': {
        // Logisim: only T = 1 toggles, and only a reset at 1 clears (open or x does nothing)
        const t = raw[0];
        const isRisingEdge = risingEdge(comp, raw[1]);
        const rst = raw[2];

        let curQ = comp.state.q ?? 0;
        if (rst === 1) {
          curQ = 0;
          if (comp.state.q !== 0) {
            comp.state.q = 0;
            comp.state.qBar = 1;
            hasChanged = true;
          }
        } else if (isRisingEdge) {
          if (t === 1) {
            curQ = curQ === 1 ? 0 : 1;
            comp.state.q = curQ;
            comp.state.qBar = (curQ === 1 ? 0 : 1) as SignalValue;
            hasChanged = true;
          }
        }
        const qVal: SignalValue = comp.state.q ?? 0;
        const qBarVal: SignalValue = comp.state.qBar ?? 1;
        if (comp.outputs[0] && comp.outputs[0].value !== qVal) {
          comp.outputs[0].value = qVal;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== qBarVal) {
          comp.outputs[1].value = qBarVal;
          hasChanged = true;
        }
        break;
      }
      case 'ram16x4': {
        if (!Array.isArray(comp.state.ramData) || comp.state.ramData.length !== 16) {
          comp.state.ramData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
        }
        // Logisim RAM: an undefined address keeps the output as it was and writes nothing, and only
        // a write enable of 0 blocks writing (open or x writes). Unlike Logisim, which stores an
        // undefined data word as all ones, such a word is not written.
        const addr = busValue(raw.slice(0, 4));
        const dataIn = busValue(raw.slice(4, 8));
        const isRisingEdge = risingEdge(comp, raw[8]);
        if (typeof addr !== 'number') break;

        if (isRisingEdge && raw[9] !== 0 && typeof dataIn === 'number') {
          // Copy on write: the array is shared with the previous step's state and the preset template
          comp.state.ramData = comp.state.ramData.map((v, i) => (i === addr ? dataIn : v));
          hasChanged = true;
        }

        const storedVal = comp.state.ramData[addr] ?? 0;
        for (let b = 0; b < 4; b++) {
          const bitVal: SignalValue = ((storedVal >> b) & 1) === 1 ? 1 : 0;
          if (comp.outputs[b] && comp.outputs[b].value !== bitVal) {
            comp.outputs[b].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'rom16x4': {
        const DEFAULT_ROM = [0, 1, 4, 9, 3, 7, 15, 12, 8, 5, 10, 2, 6, 11, 14, 13];
        if (!Array.isArray(comp.state.romData) || comp.state.romData.length !== 16) {
          comp.state.romData = [...DEFAULT_ROM];
        }
        // Logisim ROM: an undefined address keeps the output as it was
        const addr = busValue(raw.slice(0, 4));
        if (typeof addr !== 'number') break;
        const storedVal = comp.state.romData[addr] ?? 0;
        for (let b = 0; b < 4; b++) {
          const bitVal: SignalValue = ((storedVal >> b) & 1) === 1 ? 1 : 0;
          if (comp.outputs[b] && comp.outputs[b].value !== bitVal) {
            comp.outputs[b].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'subcircuit': {
        const subId = comp.state.subcircuitId;
        if (subId) {
          const subDef = getSubcircuitDefinition(subId);
          if (subDef) {
            // Every port passes its bits as they are (Logisim SubcircuitFactory.propagate); a wide pin
            // the net gave no bits floats inside
            const inPorts = subDef.ports.filter((p) => p.type === 'input');
            const inBits = comp.inputs.map((pin, i): SignalValue[] => {
              const w = inPorts[i] ? subcircuitPortWidth(subDef, inPorts[i]) : 1;
              if (w === 1) return [pin.value];
              return pin.bits && pin.bits.length === w ? pin.bits : new Array<SignalValue>(w).fill('Z');
            });
            const { outputs: outVals, internal, oscillating } = evaluateSubcircuitStateful(
              subDef,
              inBits,
              comp.state.subcircuitInternal
            );
            comp.state.subcircuitInternal = internal;
            if (oscillating) comp.state.oscillating = true;
            else delete comp.state.oscillating;
            outVals.forEach((bits, oIdx) => setBitsOut(oIdx, bits));
          }
        }
        break;
      }
      case 'led':
      case 'probe':
      case 'buzzer':
      case 'textLabel':
      case 'tunnel': {
        // Output displays & wireless tunnels reflect network resolution
        break;
      }
    }
  });

  return { components: newComps, wires: newWires, hasChanged };
}

/**
 * Run simulation to convergence or up to maxIterations
 */
export function simulateCircuit(
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  maxIterations?: number
): {
  components: CircuitComponentInstance[];
  wires: CircuitWire[];
  oscillating?: boolean;
  oscillatingWireIds?: string[];
  oscillatingCompIds?: string[];
} {
  // Each step moves signals through one level of logic, and an acyclic path cannot be longer than
  // the number of parts, so that many steps always settle it. Only feedback that keeps
  // oscillating (e.g. NAND(clock, q) after a clock edge) runs into the limit.
  if (maxIterations === undefined) maxIterations = components.length + 10;
  let curComps = components;
  let curWires = wires;
  // Like Logisim's Propagator: what still changes in the last quarter of the steps is reported as oscillating
  const logFrom = Math.floor((3 * maxIterations) / 4);
  const oscWires = new Set<string>();
  const oscComps = new Set<string>();
  let settled = false;

  for (let i = 0; i < maxIterations; i++) {
    const step = simulateCircuitStep(curComps, curWires);
    if (!step.hasChanged) {
      curComps = step.components;
      curWires = step.wires;
      settled = true;
      break;
    }
    if (i >= logFrom) {
      step.wires.forEach((w, k) => {
        const old = curWires[k];
        if (old && (old.value !== w.value || !sameBits(old.bits, w.bits))) oscWires.add(w.id);
      });
      // A subcircuit that keeps changing inside is drawn with a frame, as in Logisim
      step.components.forEach((c) => {
        if (c.state.oscillating) oscComps.add(c.id);
      });
    }
    curComps = step.components;
    curWires = step.wires;
  }

  if (settled) {
    // The outer circuit can settle while an IC keeps oscillating inside with steady outputs
    oscWires.clear();
    oscComps.clear();
    curComps.forEach((c) => {
      if (c.state.oscillating) oscComps.add(c.id);
    });
  }
  // Mark the wires that kept changing for the canvas; clear the marks of an earlier oscillation
  if (oscWires.size > 0 || curWires.some((w) => w.oscillating)) {
    curWires = curWires.map((w) => {
      const osc = oscWires.has(w.id);
      if (!!w.oscillating === osc) return w;
      const { oscillating: _old, ...rest } = w;
      return osc ? { ...rest, oscillating: true } : rest;
    });
  }
  if ((settled || maxIterations === 0) && oscComps.size === 0) return { components: curComps, wires: curWires };
  return {
    components: curComps,
    wires: curWires,
    oscillating: true,
    oscillatingWireIds: [...oscWires],
    oscillatingCompIds: [...oscComps],
  };
}

/**
 * Multi-bit bus demo presets (Aşama 2l). Built with the multi-bit parts that exist so far (wide
 * switch/LED/constant/probe, tunnel, splitter, bit extender, bit selector); the fixed 4-bit parts (ALU,
 * hex display...) still have 1-bit pins, so splitters bridge a bus to them.
 */
type BusPartOptions = {
  width?: number;
  state?: Partial<CircuitComponentInstance['state']>;
  rotation?: CircuitComponentInstance['rotation'];
  splitter?: Parameters<typeof configureSplitter>[1];
  extender?: Parameters<typeof configureBitExtender>[1];
  selector?: Parameters<typeof configureBitSelector>[1];
};

function busPart(
  type: ComponentType,
  x: number,
  y: number,
  label: string,
  id: string,
  opt: BusPartOptions = {}
): CircuitComponentInstance {
  let c = createComponentInstance(type, x, y, label, id);
  if (opt.rotation) c = { ...c, rotation: opt.rotation };
  if (opt.width && opt.width > 1) c = setBitWidth(c, opt.width);
  if (opt.splitter) c = configureSplitter(c, opt.splitter);
  if (opt.extender) c = configureBitExtender(c, opt.extender);
  if (opt.selector) c = configureBitSelector(c, opt.selector);
  if (opt.state) c = { ...c, state: { ...c.state, ...opt.state } };
  return updatePinPositions(c);
}

// Wire list builder: link(fromPart, fromPin, toPart, toPin) with pins as objects of the parts
function busWires() {
  const wires: CircuitWire[] = [];
  const link = (a: CircuitComponentInstance, ap: CircuitPin, b: CircuitComponentInstance, bp: CircuitPin) => {
    wires.push({ id: `w${wires.length + 1}`, fromCompId: a.id, fromPinId: ap.id, toCompId: b.id, toPinId: bp.id, value: 0 });
  };
  return { wires, link };
}

function busSplitJoinPreset(): CircuitPreset {
  const sw = busPart('switch', 40, 150, 'Veri (8 bit)', 'bsj_sw', { width: 8, state: { inputValue: 0xa5 } });
  const pIn = busPart('probe', 160, 60, 'Giriş (hex)', 'bsj_pin', { state: { radix: '16' } });
  // 8 bits -> two 4-bit halves (end 1 = b3..b0, end 2 = b7..b4)
  const nib = busPart('splitter', 200, 150, 'Yarımlara Ayır', 'bsj_nib', { splitter: { incoming: 8, fanout: 2 } });
  // each half -> 4 single lines for its hex digit
  const sHi = busPart('splitter', 300, 50, 'Üst Yarım', 'bsj_shi', { splitter: { incoming: 4, fanout: 4, appear: 'right' } });
  const hexHi = busPart('hexDisplay', 360, 40, 'Üst Hane (b7..b4)', 'bsj_hexhi');
  const sLo = busPart('splitter', 480, 50, 'Alt Yarım', 'bsj_slo', { splitter: { incoming: 4, fanout: 4, appear: 'right' } });
  const hexLo = busPart('hexDisplay', 540, 40, 'Alt Hane (b3..b0)', 'bsj_hexlo');
  // the halves crossed over into a west-facing joining splitter: they swap places
  const join = busPart('splitter', 380, 250, 'Birleştir', 'bsj_join', { splitter: { incoming: 8, fanout: 2 }, rotation: 180 });
  const led = busPart('led', 450, 230, 'Yer Değişmiş (8 bit)', 'bsj_led', { width: 8 });
  const pOut = busPart('probe', 450, 300, 'Çıkış (hex)', 'bsj_pout', { state: { radix: '16' } });
  const { wires, link } = busWires();
  link(sw, sw.outputs[0], pIn, pIn.inputs[0]);
  link(sw, sw.outputs[0], nib, nib.inputs[0]);
  link(nib, nib.outputs[1], sHi, sHi.inputs[0]);
  link(nib, nib.outputs[0], sLo, sLo.inputs[0]);
  for (let i = 0; i < 4; i++) link(sHi, sHi.outputs[i], hexHi, hexHi.inputs[i]);
  for (let i = 0; i < 4; i++) link(sLo, sLo.outputs[i], hexLo, hexLo.inputs[i]);
  link(nib, nib.outputs[0], join, join.outputs[1]);
  link(nib, nib.outputs[1], join, join.outputs[0]);
  link(join, join.inputs[0], led, led.inputs[0]);
  link(join, join.inputs[0], pOut, pOut.inputs[0]);
  return {
    id: 'bus_split_join',
    name: 'Çok Bitli: 8-Bit Veri Yolunu Bölme ve Birleştirme (Splitter)',
    category: 'bus',
    description:
      '8 bitlik bir veri yolu splitter ile iki 4 bitlik yarıma bölünür; her yarım ikinci bir splitter ile tek bitlere açılıp Hex ekranda gösterilir. Aynı yarımlar, batıya bakan bir splitter ile yer değiştirerek yeniden 8 bite birleştirilir (A5 → 5A). Splitter iki yönlüdür: aynı parça hem ayırır hem birleştirir.',
    components: [sw, pIn, nib, sHi, hexHi, sLo, hexLo, join, led, pOut],
    wires,
  };
}

function busAluPreset(): CircuitPreset {
  const a = busPart('switch', 150, 130, 'A (4 bit)', 'bal_a', { width: 4, state: { inputValue: 7 } });
  const b = busPart('switch', 180, 320, 'B (4 bit)', 'bal_b', { width: 4, state: { inputValue: 5 } });
  const op = busPart('switch', 240, 80, 'İşlem (S1 S0)', 'bal_op', { width: 2, state: { inputValue: 0 } });
  const cin = busPart('switch', 170, 190, 'Elde Girişi (Cin)', 'bal_cin');
  const sa = busPart('splitter', 250, 150, 'A bitleri', 'bal_sa', { splitter: { incoming: 4, fanout: 4, appear: 'right' } });
  const sb = busPart('splitter', 330, 260, 'B bitleri', 'bal_sb', { splitter: { incoming: 4, fanout: 4 }, rotation: 270 });
  const sop = busPart('splitter', 320, 100, 'S bitleri', 'bal_sop', { splitter: { incoming: 2, fanout: 2 }, rotation: 90 });
  const alu = busPart('alu4', 300, 140, '4-Bit ALU', 'bal_alu');
  const sf = busPart('splitter', 440, 150, 'Sonucu Birleştir', 'bal_sf', { splitter: { incoming: 4, fanout: 4, bitEnd: [4, 3, 2, 1] }, rotation: 180 });
  const ledF = busPart('led', 500, 130, 'F (4 bit)', 'bal_ledf', { width: 4 });
  const pF = busPart('probe', 500, 60, 'F (ondalık)', 'bal_pf', { state: { radix: '10u' } });
  const ledC = busPart('led', 520, 190, 'Elde Çıkışı (Cout)', 'bal_ledc');
  const ledZ = busPart('led', 520, 270, 'Sıfır (Z)', 'bal_ledz');
  const { wires, link } = busWires();
  link(a, a.outputs[0], sa, sa.inputs[0]);
  link(b, b.outputs[0], sb, sb.inputs[0]);
  link(op, op.outputs[0], sop, sop.inputs[0]);
  for (let i = 0; i < 4; i++) link(sa, sa.outputs[i], alu, alu.inputs[i]);
  link(cin, cin.outputs[0], alu, alu.inputs[4]);
  for (let i = 0; i < 4; i++) link(sb, sb.outputs[i], alu, alu.inputs[5 + i]);
  link(sop, sop.outputs[0], alu, alu.inputs[9]);
  link(sop, sop.outputs[1], alu, alu.inputs[10]);
  // bit i of F is end 4-i of the west-facing joiner (bit 0 on top, next to F0)
  for (let i = 0; i < 4; i++) link(alu, alu.outputs[i], sf, sf.outputs[3 - i]);
  link(sf, sf.inputs[0], ledF, ledF.inputs[0]);
  link(sf, sf.inputs[0], pF, pF.inputs[0]);
  link(alu, alu.outputs[4], ledC, ledC.inputs[0]);
  link(alu, alu.outputs[5], ledZ, ledZ.inputs[0]);
  return {
    id: 'bus_alu4',
    name: "Çok Bitli: 4-Bit ALU'yu Veri Yollarıyla Sürmek",
    category: 'bus',
    description:
      "A ve B 4 bitlik, işlem seçimi 2 bitlik veri yollarından gelir; splitter'lar yolları ALU'nun tek bitlik pinlerine dağıtır, sonuç bitleri yeniden 4 bitlik F yoluna birleştirilir. Başlangıç: 7 + 5 = 12. İşlem: 00 toplama, 01 çıkarma, 10 VE, 11 VEYA.",
    components: [a, b, op, cin, sa, sb, sop, alu, sf, ledF, pF, ledC, ledZ],
    wires,
  };
}

function busSignExtendPreset(): CircuitPreset {
  const x = busPart('switch', 40, 170, 'X (4 bit)', 'bse_x', { width: 4, state: { inputValue: 0xa } });
  const pu = busPart('probe', 40, 60, 'X işaretsiz', 'bse_pu', { state: { radix: '10u' } });
  const ps = busPart('probe', 40, 260, 'X işaretli', 'bse_ps', { state: { radix: '10s' } });
  const ez = busPart('bitExtender', 240, 90, 'Sıfırla Genişlet', 'bse_ez', { extender: { inWidth: 4, outWidth: 8, type: 'zero' } });
  const es = busPart('bitExtender', 240, 250, 'İşaretle Genişlet', 'bse_es', { extender: { inWidth: 4, outWidth: 8, type: 'sign' } });
  const lz = busPart('led', 380, 80, 'Sıfır dolgulu (8 bit)', 'bse_lz', { width: 8 });
  const pz = busPart('probe', 380, 150, 'İşaretsiz ondalık', 'bse_pz', { state: { radix: '10u' } });
  const ls = busPart('led', 380, 240, 'İşaret dolgulu (8 bit)', 'bse_ls', { width: 8 });
  const pss = busPart('probe', 380, 310, 'İşaretli ondalık', 'bse_pss', { state: { radix: '10s' } });
  const { wires, link } = busWires();
  link(x, x.outputs[0], pu, pu.inputs[0]);
  link(x, x.outputs[0], ps, ps.inputs[0]);
  link(x, x.outputs[0], ez, ez.inputs[0]);
  link(x, x.outputs[0], es, es.inputs[0]);
  link(ez, ez.outputs[0], lz, lz.inputs[0]);
  link(ez, ez.outputs[0], pz, pz.inputs[0]);
  link(es, es.outputs[0], ls, ls.inputs[0]);
  link(es, es.outputs[0], pss, pss.inputs[0]);
  return {
    id: 'bus_sign_extend',
    name: 'Çok Bitli: İşaretli ve İşaretsiz Genişletme (Bit Extender)',
    category: 'bus',
    description:
      "Aynı 4 bitlik sayı iki bit genişleticiyle 8 bite çıkarılır. Sıfırla genişletme üst bitlere 0 koyar ve işaretsiz değeri korur (1010 = 10 → 0000 1010). İşaretle genişletme en üst biti kopyalar ve ikiye tümleyen değeri korur (1010 = −6 → 1111 1010 = −6).",
    components: [x, pu, ps, ez, es, lz, pz, ls, pss],
    wires,
  };
}

function busBitSelectorPreset(): CircuitPreset {
  const d = busPart('switch', 40, 180, 'Veri (8 bit)', 'bbs_d', { width: 8, state: { inputValue: 0x3c } });
  const pd = busPart('probe', 40, 90, 'Veri (hex)', 'bbs_pd', { state: { radix: '16' } });
  const half = busPart('switch', 180, 240, 'Yarım Seç (0 alt, 1 üst)', 'bbs_half');
  const selN = busPart('bitSelector', 220, 180, 'Yarım Bayt Seçici', 'bbs_seln', { selector: { dataWidth: 8, groupWidth: 4 } });
  const sn = busPart('splitter', 300, 200, 'Bitler', 'bbs_sn', { splitter: { incoming: 4, fanout: 4, appear: 'right' } });
  const hex = busPart('hexDisplay', 380, 190, 'Seçilen Yarım Bayt', 'bbs_hex');
  const pn = busPart('probe', 300, 100, 'Seçilen (ikili)', 'bbs_pn');
  const idx = busPart('switch', 200, 460, 'Bit No (0-7)', 'bbs_idx', { width: 3, state: { inputValue: 2 } });
  const selB = busPart('bitSelector', 220, 380, 'Tek Bit Seçici (8:1 MUX)', 'bbs_selb', { selector: { dataWidth: 8, groupWidth: 1 } });
  const lb = busPart('led', 330, 370, 'Seçilen Bit', 'bbs_lb');
  const { wires, link } = busWires();
  link(d, d.outputs[0], pd, pd.inputs[0]);
  link(d, d.outputs[0], selN, selN.inputs[0]);
  link(half, half.outputs[0], selN, selN.inputs[1]);
  link(selN, selN.outputs[0], sn, sn.inputs[0]);
  for (let i = 0; i < 4; i++) link(sn, sn.outputs[i], hex, hex.inputs[i]);
  link(selN, selN.outputs[0], pn, pn.inputs[0]);
  link(d, d.outputs[0], selB, selB.inputs[0]);
  link(idx, idx.outputs[0], selB, selB.inputs[1]);
  link(selB, selB.outputs[0], lb, lb.inputs[0]);
  return {
    id: 'bus_bit_selector',
    name: 'Çok Bitli: Bit Seçici ile Çoklayıcı (MUX)',
    category: 'bus',
    description:
      'Bit seçici, veri yolunu eşit gruplara böler ve seçme girişinin gösterdiği grubu çıkışa verir; yani bir çoklayıcıdır. Üstteki 4 bitlik gruplarla çalışır (1 bit seçme: alt ya da üst yarım bayt), alttaki 1 bitlik gruplarla 8:1 MUX gibi davranır (3 bit seçme). Veri 3C: alt yarım C, üst yarım 3; bit 2 = 1.',
    components: [d, pd, half, selN, sn, hex, pn, idx, selB, lb],
    wires,
  };
}

function busTriStatePreset(): CircuitPreset {
  const parts: CircuitComponentInstance[] = [];
  const { wires, link } = busWires();
  const side = (key: 'a' | 'b', y: number, value: number, enabled: boolean) => {
    const name = key.toUpperCase();
    const src = busPart('switch', 40, y + 30, `Kaynak ${name} (4 bit)`, `bts_${key}`, { width: 4, state: { inputValue: value } });
    const en = busPart('switch', 40, y + 130, `${name} Yola Yazsın (EN${name})`, `bts_en${key}`, { state: { on: enabled } });
    const sp = busPart('splitter', 160, y + 30, `${name} bitleri`, `bts_s${key}`, { splitter: { incoming: 4, fanout: 4 } });
    const bufs = [0, 1, 2, 3].map((i) => busPart('triState', 240, y + i * 50 - 20, `Tampon ${name}${i}`, `bts_t${key}${i}`));
    const jn = busPart('splitter', 400, y + 30, `${name} → yol`, `bts_j${key}`, { splitter: { incoming: 4, fanout: 4 }, rotation: 180 });
    const tun = busPart('tunnel', 450, y + 20, 'VERİ YOLU', `bts_tun${key}`);
    link(src, src.outputs[0], sp, sp.inputs[0]);
    bufs.forEach((t, i) => {
      link(sp, sp.outputs[i], t, t.inputs[0]);
      link(en, en.outputs[0], t, t.inputs[1]);
      link(t, t.outputs[0], jn, jn.outputs[i]);
    });
    link(jn, jn.inputs[0], tun, tun.inputs[0]);
    parts.push(src, en, sp, ...bufs, jn, tun);
  };
  side('a', 40, 0x3, true);
  side('b', 290, 0x5, false);
  const tunOut = busPart('tunnel', 600, 220, 'VERİ YOLU', 'bts_tunout');
  const led = busPart('led', 720, 210, 'Ortak Yol (4 bit)', 'bts_led', { width: 4 });
  const probe = busPart('probe', 720, 280, 'Ortak Yol (ikili)', 'bts_probe');
  link(tunOut, tunOut.outputs[0], led, led.inputs[0]);
  link(tunOut, tunOut.outputs[0], probe, probe.inputs[0]);
  parts.push(tunOut, led, probe);
  return {
    id: 'bus_tristate_shared',
    name: 'Çok Bitli: Tri-State Tamponlarla Ortak 4-Bit Veri Yolu',
    category: 'bus',
    description:
      "İki 4 bitlik kaynak, bit başına birer tri-state tamponla aynı veri yoluna bağlanır; yol tünellerle (VERİ YOLU) taşınır. Aynı anda yalnız bir EN açık olmalı. İkisi birden açılırsa farklı olan bitler çakışır (0011 + 0101 = 0EE1, kırmızı), ikisi de kapalıysa yol sürülmez (xxxx, gri).",
    components: parts,
    wires,
  };
}

/**
 * Standard Circuit Presets from "Sıfırdan İşlemciye"
 */
const RAW_CIRCUIT_PRESETS: CircuitPreset[] = [
  {
    id: 'half_adder',
    name: '1-Bit Yarım Toplayıcı (Half Adder)',
    category: 'arithmetic',
    description: 'XOR ve AND kapılarıyla kurulan, A ve B bitlerini toplayan temel kombinasyonel devre (S = A ⊕ B, C = A · B).',
    components: [
      {
        ...createComponentInstance('switch', 60, 100, 'Giriş A'),
        id: 'sw_A',
      },
      {
        ...createComponentInstance('switch', 60, 220, 'Giriş B'),
        id: 'sw_B',
      },
      {
        ...createComponentInstance('xor', 260, 90, 'XOR (Toplam S)'),
        id: 'gate_xor',
      },
      {
        ...createComponentInstance('and', 260, 210, 'AND (Elde C)'),
        id: 'gate_and',
      },
      {
        ...createComponentInstance('led', 460, 90, 'Toplam (S)'),
        id: 'led_S',
      },
      {
        ...createComponentInstance('led', 460, 210, 'Elde (C)'),
        id: 'led_C',
      },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_A', fromPinId: 'sw_A_out', toCompId: 'gate_xor', toPinId: 'gate_xor_in0', value: 0 },
      { id: 'w2', fromCompId: 'sw_B', fromPinId: 'sw_B_out', toCompId: 'gate_xor', toPinId: 'gate_xor_in1', value: 0 },
      { id: 'w3', fromCompId: 'sw_A', fromPinId: 'sw_A_out', toCompId: 'gate_and', toPinId: 'gate_and_in0', value: 0 },
      { id: 'w4', fromCompId: 'sw_B', fromPinId: 'sw_B_out', toCompId: 'gate_and', toPinId: 'gate_and_in1', value: 0 },
      { id: 'w5', fromCompId: 'gate_xor', fromPinId: 'gate_xor_out', toCompId: 'led_S', toPinId: 'led_S_in', value: 0 },
      { id: 'w6', fromCompId: 'gate_and', fromPinId: 'gate_and_out', toCompId: 'led_C', toPinId: 'led_C_in', value: 0 },
    ],
  },
  {
    id: 'full_adder',
    name: '1-Bit Tam Toplayıcı (Full Adder)',
    category: 'arithmetic',
    description: 'A, B ve Elde Girişi (Cin) bitlerini toplayarak Toplam (S) ve Elde Çıkışı (Cout) üreten temel toplayıcı.',
    components: [
      { ...createComponentInstance('switch', 50, 80, 'Giriş A'), id: 'sw_fa_a', state: { on: true } },
      { ...createComponentInstance('switch', 50, 180, 'Giriş B'), id: 'sw_fa_b', state: { on: true } },
      { ...createComponentInstance('switch', 50, 280, 'Elde Girişi (Cin)'), id: 'sw_fa_cin', state: { on: false } },
      { ...createComponentInstance('fullAdder', 260, 150, '1-Bit Tam Toplayıcı'), id: 'fa_1' },
      { ...createComponentInstance('led', 480, 110, 'Toplam (S)'), id: 'led_fa_s' },
      { ...createComponentInstance('led', 480, 230, 'Elde Çıkışı (Cout)'), id: 'led_fa_cout' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_fa_a', fromPinId: 'sw_fa_a_out', toCompId: 'fa_1', toPinId: 'fa_1_inA', value: 1 },
      { id: 'w2', fromCompId: 'sw_fa_b', fromPinId: 'sw_fa_b_out', toCompId: 'fa_1', toPinId: 'fa_1_inB', value: 1 },
      { id: 'w3', fromCompId: 'sw_fa_cin', fromPinId: 'sw_fa_cin_out', toCompId: 'fa_1', toPinId: 'fa_1_inCin', value: 0 },
      { id: 'w4', fromCompId: 'fa_1', fromPinId: 'fa_1_outS', toCompId: 'led_fa_s', toPinId: 'led_fa_s_in', value: 0 },
      { id: 'w5', fromCompId: 'fa_1', fromPinId: 'fa_1_outCout', toCompId: 'led_fa_cout', toPinId: 'led_fa_cout_in', value: 1 },
    ],
  },
  {
    id: 'xor_gate_internal',
    name: "XOR Kapısının İç Yapısı (A'B + AB')",
    category: 'basic',
    description: "İki AND, iki NOT ve bir OR kapısı kullanılarak oluşturulan denk XOR mantık devresi.",
    components: [
      { ...createComponentInstance('switch', 50, 100, 'Giriş A'), id: 'in_a' },
      { ...createComponentInstance('switch', 50, 260, 'Giriş B'), id: 'in_b' },
      { ...createComponentInstance('not', 200, 70, "NOT A (A')"), id: 'not_a' },
      { ...createComponentInstance('not', 200, 290, "NOT B (B')"), id: 'not_b' },
      { ...createComponentInstance('and', 340, 100, "AND (A'B)"), id: 'and_1' },
      { ...createComponentInstance('and', 340, 250, "AND (AB')"), id: 'and_2' },
      { ...createComponentInstance('or', 490, 180, 'OR Çıkışı'), id: 'or_1' },
      { ...createComponentInstance('led', 630, 180, 'XOR LED'), id: 'led_out' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'in_a', fromPinId: 'in_a_out', toCompId: 'not_a', toPinId: 'not_a_in', value: 0 },
      { id: 'w2', fromCompId: 'in_a', fromPinId: 'in_a_out', toCompId: 'and_2', toPinId: 'and_2_in0', value: 0 },
      { id: 'w3', fromCompId: 'in_b', fromPinId: 'in_b_out', toCompId: 'not_b', toPinId: 'not_b_in', value: 0 },
      { id: 'w4', fromCompId: 'in_b', fromPinId: 'in_b_out', toCompId: 'and_1', toPinId: 'and_1_in1', value: 0 },
      { id: 'w5', fromCompId: 'not_a', fromPinId: 'not_a_out', toCompId: 'and_1', toPinId: 'and_1_in0', value: 0 },
      { id: 'w6', fromCompId: 'not_b', fromPinId: 'not_b_out', toCompId: 'and_2', toPinId: 'and_2_in1', value: 0 },
      { id: 'w7', fromCompId: 'and_1', fromPinId: 'and_1_out', toCompId: 'or_1', toPinId: 'or_1_in0', value: 0 },
      { id: 'w8', fromCompId: 'and_2', fromPinId: 'and_2_out', toCompId: 'or_1', toPinId: 'or_1_in1', value: 0 },
      { id: 'w9', fromCompId: 'or_1', fromPinId: 'or_1_out', toCompId: 'led_out', toPinId: 'led_out_in', value: 0 },
    ],
  },
  {
    id: 'mux_2to1',
    name: '2:1 Çoklayıcı (Multiplexer - MUX)',
    category: 'basic',
    description: "S = 0 iken D0 girişini, S = 1 iken D1 girişini çıkışa ileten kombinasyonel veri seçici devre.",
    components: [
      { ...createComponentInstance('switch', 50, 80, 'Veri D0'), id: 'in_d0' },
      { ...createComponentInstance('switch', 50, 220, 'Veri D1'), id: 'in_d1' },
      { ...createComponentInstance('switch', 50, 340, 'Seçici S'), id: 'in_s' },
      { ...createComponentInstance('not', 200, 340, "NOT S (S')"), id: 'not_s' },
      { ...createComponentInstance('and', 340, 100, "AND (D0·S')"), id: 'and_0' },
      { ...createComponentInstance('and', 340, 240, 'AND (D1·S)'), id: 'and_1' },
      { ...createComponentInstance('or', 480, 170, 'OR Çıkışı (Y)'), id: 'or_out' },
      { ...createComponentInstance('led', 620, 170, 'Çıkış LED (Y)'), id: 'led_y' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'in_d0', fromPinId: 'in_d0_out', toCompId: 'and_0', toPinId: 'and_0_in0', value: 0 },
      { id: 'w2', fromCompId: 'in_d1', fromPinId: 'in_d1_out', toCompId: 'and_1', toPinId: 'and_1_in0', value: 0 },
      { id: 'w3', fromCompId: 'in_s', fromPinId: 'in_s_out', toCompId: 'not_s', toPinId: 'not_s_in', value: 0 },
      { id: 'w4', fromCompId: 'in_s', fromPinId: 'in_s_out', toCompId: 'and_1', toPinId: 'and_1_in1', value: 0 },
      { id: 'w5', fromCompId: 'not_s', fromPinId: 'not_s_out', toCompId: 'and_0', toPinId: 'and_0_in1', value: 0 },
      { id: 'w6', fromCompId: 'and_0', fromPinId: 'and_0_out', toCompId: 'or_out', toPinId: 'or_out_in0', value: 0 },
      { id: 'w7', fromCompId: 'and_1', fromPinId: 'and_1_out', toCompId: 'or_out', toPinId: 'or_out_in1', value: 0 },
      { id: 'w8', fromCompId: 'or_out', fromPinId: 'or_out_out', toCompId: 'led_y', toPinId: 'led_y_in', value: 0 },
    ],
  },
  {
    id: 'd_flip_flop_memory',
    name: 'D Flip-Flop ile 1-Bit Bellek (Kayıtçı)',
    category: 'sequential',
    description: 'Saat darbesinin (CLK) yükselen kenarında Giriş D verisini saklayan ve Q ile Q\' çıkışlarına aktaran temel ardışıl bellek devresi.',
    components: [
      { ...createComponentInstance('switch', 60, 100, 'Veri Girişi (D)'), id: 'sw_d' },
      { ...createComponentInstance('clock', 60, 220, 'Saat Darbesi (CLK)'), id: 'clk_1' },
      { ...createComponentInstance('dFlipFlop', 280, 140, 'D-FF Kaydedici'), id: 'dff_1' },
      { ...createComponentInstance('led', 480, 100, 'Kayıtlı Çıkış (Q)'), id: 'led_q' },
      { ...createComponentInstance('led', 480, 220, "Ters Çıkış (Q')"), id: 'led_q_bar' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_d', fromPinId: 'sw_d_out', toCompId: 'dff_1', toPinId: 'dff_1_inD', value: 0 },
      { id: 'w2', fromCompId: 'clk_1', fromPinId: 'clk_1_out', toCompId: 'dff_1', toPinId: 'dff_1_inClk', value: 0 },
      { id: 'w3', fromCompId: 'dff_1', fromPinId: 'dff_1_outQ', toCompId: 'led_q', toPinId: 'led_q_in', value: 0 },
      { id: 'w4', fromCompId: 'dff_1', fromPinId: 'dff_1_outQBar', toCompId: 'led_q_bar', toPinId: 'led_q_bar_in', value: 1 },
    ],
  },
  {
    id: 't_flip_flop_counter',
    name: 'T-FF ile 2-Bit Asenkron İkili Sayaç (Ripple Counter)',
    category: 'sequential',
    description: 'T Flip-Flop elemanlarının kaskat bağlanmasıyla saat darbelerini sayan ve 00, 01, 10, 11 sayma dizisini üreten 2-bit sayaç.',
    components: [
      { ...createComponentInstance('vcc', 50, 70, '1 (High)'), id: 'vcc_tff' },
      { ...createComponentInstance('clock', 50, 170, 'Saat (CLK)'), id: 'clk_tff' },
      { ...createComponentInstance('tFlipFlop', 190, 110, 'T-FF 0 (Bit 0)'), id: 'tff_0' },
      { ...createComponentInstance('tFlipFlop', 370, 110, 'T-FF 1 (Bit 1)'), id: 'tff_1' },
      { ...createComponentInstance('led', 270, 260, 'Q0 (1ler Biti)'), id: 'led_tff_q0' },
      { ...createComponentInstance('led', 450, 260, 'Q1 (2ler Biti)'), id: 'led_tff_q1' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'vcc_tff', fromPinId: 'vcc_tff_out', toCompId: 'tff_0', toPinId: 'tff_0_inT', value: 1 },
      { id: 'w2', fromCompId: 'clk_tff', fromPinId: 'clk_tff_out', toCompId: 'tff_0', toPinId: 'tff_0_inClk', value: 0 },
      { id: 'w3', fromCompId: 'vcc_tff', fromPinId: 'vcc_tff_out', toCompId: 'tff_1', toPinId: 'tff_1_inT', value: 1 },
      // Rising-edge flip-flops: Q0' clocks bit 1 (Q0 there would make it count down 00, 11, 10, 01)
      { id: 'w4', fromCompId: 'tff_0', fromPinId: 'tff_0_outQBar', toCompId: 'tff_1', toPinId: 'tff_1_inClk', value: 1 },
      { id: 'w5', fromCompId: 'tff_0', fromPinId: 'tff_0_outQ', toCompId: 'led_tff_q0', toPinId: 'led_tff_q0_in', value: 0 },
      { id: 'w6', fromCompId: 'tff_1', fromPinId: 'tff_1_outQ', toCompId: 'led_tff_q1', toPinId: 'led_tff_q1_in', value: 0 },
    ],
  },
  {
    id: 'sr_latch_memory',
    name: 'SR Mandalı (Set-Reset Bistable Latch)',
    category: 'sequential',
    description: 'Anlık SET ve RESET butonlarıyla kontrol edilen, 1 bit veriyi kalıcı olarak hafızasında tutan asenkron bellek hücresi.',
    components: [
      { ...createComponentInstance('pushbutton', 50, 80, 'SET Butonu (S)'), id: 'btn_s' },
      { ...createComponentInstance('pushbutton', 50, 220, 'RESET Butonu (R)'), id: 'btn_r' },
      { ...createComponentInstance('srLatch', 220, 130, 'SR Mandalı'), id: 'sr_latch_1' },
      { ...createComponentInstance('led', 430, 90, 'Q (Çıkış)'), id: 'led_sr_q' },
      { ...createComponentInstance('led', 430, 210, "Q' (Ters Çıkış)"), id: 'led_sr_qbar' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'btn_s', fromPinId: 'btn_s_out', toCompId: 'sr_latch_1', toPinId: 'sr_latch_1_inS', value: 0 },
      { id: 'w2', fromCompId: 'btn_r', fromPinId: 'btn_r_out', toCompId: 'sr_latch_1', toPinId: 'sr_latch_1_inR', value: 0 },
      { id: 'w3', fromCompId: 'sr_latch_1', fromPinId: 'sr_latch_1_outQ', toCompId: 'led_sr_q', toPinId: 'led_sr_q_in', value: 0 },
      { id: 'w4', fromCompId: 'sr_latch_1', fromPinId: 'sr_latch_1_outQBar', toCompId: 'led_sr_qbar', toPinId: 'led_sr_qbar_in', value: 1 },
    ],
  },
  {
    id: 'decoder_demo',
    name: '2:4 Kod Çözücü (1-of-4 Decoder Seçici)',
    category: 'bus',
    description: '2-Bitlik adresi (A1, A0) çözerek 4 çıkış hattından tam olarak birini aktif (1) yapan adres çözücü devre.',
    components: [
      { ...createComponentInstance('vcc', 50, 50, 'EN (Yetki=1)'), id: 'vcc_dec' },
      { ...createComponentInstance('switch', 50, 130, 'Adres A0 (1ler)'), id: 'sw_dec_a0', state: { on: false } },
      { ...createComponentInstance('switch', 50, 230, 'Adres A1 (2ler)'), id: 'sw_dec_a1', state: { on: false } },
      { ...createComponentInstance('decoder2to4', 210, 110, '2:4 Kod Çözücü'), id: 'dec_1' },
      { ...createComponentInstance('led', 420, 60, 'Hat 0 (Y0)'), id: 'led_dec_0' },
      { ...createComponentInstance('led', 420, 120, 'Hat 1 (Y1)'), id: 'led_dec_1' },
      { ...createComponentInstance('led', 420, 180, 'Hat 2 (Y2)'), id: 'led_dec_2' },
      { ...createComponentInstance('led', 420, 240, 'Hat 3 (Y3)'), id: 'led_dec_3' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'vcc_dec', fromPinId: 'vcc_dec_out', toCompId: 'dec_1', toPinId: 'dec_1_inEN', value: 1 },
      { id: 'w2', fromCompId: 'sw_dec_a0', fromPinId: 'sw_dec_a0_out', toCompId: 'dec_1', toPinId: 'dec_1_inA0', value: 0 },
      { id: 'w3', fromCompId: 'sw_dec_a1', fromPinId: 'sw_dec_a1_out', toCompId: 'dec_1', toPinId: 'dec_1_inA1', value: 0 },
      { id: 'w4', fromCompId: 'dec_1', fromPinId: 'dec_1_outY0', toCompId: 'led_dec_0', toPinId: 'led_dec_0_in', value: 1 },
      { id: 'w5', fromCompId: 'dec_1', fromPinId: 'dec_1_outY1', toCompId: 'led_dec_1', toPinId: 'led_dec_1_in', value: 0 },
      { id: 'w6', fromCompId: 'dec_1', fromPinId: 'dec_1_outY2', toCompId: 'led_dec_2', toPinId: 'led_dec_2_in', value: 0 },
      { id: 'w7', fromCompId: 'dec_1', fromPinId: 'dec_1_outY3', toCompId: 'led_dec_3', toPinId: 'led_dec_3_in', value: 0 },
    ],
  },
  {
    id: 'hex_display_demo',
    name: '4-Bit Hex 7-Segment Sayı Göstergesi',
    category: 'bus',
    description: '4 anahtarın ikili kombinasyonunu (0000 - 1111) onaltılık (0-F) olarak gerçekçi LED ekranda gösteren devre.',
    components: [
      { ...createComponentInstance('switch', 60, 60, 'Bit 0 (1ler)'), id: 'b0' },
      { ...createComponentInstance('switch', 60, 150, 'Bit 1 (2ler)'), id: 'b1' },
      { ...createComponentInstance('switch', 60, 240, 'Bit 2 (4ler)'), id: 'b2' },
      { ...createComponentInstance('switch', 60, 330, 'Bit 3 (8ler)'), id: 'b3' },
      { ...createComponentInstance('hexDisplay', 300, 170, 'Hex 7-Segment Ekran'), id: 'hex_disp' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'b0', fromPinId: 'b0_out', toCompId: 'hex_disp', toPinId: 'hex_disp_inD0', value: 0 },
      { id: 'w2', fromCompId: 'b1', fromPinId: 'b1_out', toCompId: 'hex_disp', toPinId: 'hex_disp_inD1', value: 0 },
      { id: 'w3', fromCompId: 'b2', fromPinId: 'b2_out', toCompId: 'hex_disp', toPinId: 'hex_disp_inD2', value: 0 },
      { id: 'w4', fromCompId: 'b3', fromPinId: 'b3_out', toCompId: 'hex_disp', toPinId: 'hex_disp_inD3', value: 0 },
    ],
  },
  {
    id: 'tristate_bus',
    name: '3 Durumlu Tampon & Ortak Veri Yolu (Tri-State Bus)',
    category: 'bus',
    description: 'Ortak bir veri yolu hattını iki farklı kaynağın çakışma (contention) olmadan paylaşmasını sağlayan 3 Durumlu Tampon (Tri-State) mimarisi.',
    components: [
      { ...createComponentInstance('switch', 50, 70, 'Kaynak 1 (Veri A)'), id: 'sw_data_a', state: { on: true } },
      { ...createComponentInstance('switch', 50, 190, 'Veri Yolu Seçici (SEL)'), id: 'sw_sel', state: { on: false } },
      { ...createComponentInstance('not', 190, 130, 'NOT SEL'), id: 'not_sel' },
      { ...createComponentInstance('switch', 50, 310, 'Kaynak 2 (Veri B)'), id: 'sw_data_b', state: { on: false } },
      { ...createComponentInstance('triState', 310, 70, 'Tampon A'), id: 'buf_a' },
      { ...createComponentInstance('triState', 310, 250, 'Tampon B'), id: 'buf_b' },
      { ...createComponentInstance('led', 530, 160, 'Ortak Veri Yolu LED'), id: 'bus_led' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_data_a', fromPinId: 'sw_data_a_out', toCompId: 'buf_a', toPinId: 'buf_a_inA', value: 1 },
      { id: 'w2', fromCompId: 'sw_sel', fromPinId: 'sw_sel_out', toCompId: 'not_sel', toPinId: 'not_sel_in', value: 0 },
      { id: 'w3', fromCompId: 'not_sel', fromPinId: 'not_sel_out', toCompId: 'buf_a', toPinId: 'buf_a_inEN', value: 1 },
      { id: 'w4', fromCompId: 'sw_sel', fromPinId: 'sw_sel_out', toCompId: 'buf_b', toPinId: 'buf_b_inEN', value: 0 },
      { id: 'w5', fromCompId: 'sw_data_b', fromPinId: 'sw_data_b_out', toCompId: 'buf_b', toPinId: 'buf_b_inA', value: 0 },
      { id: 'w6', fromCompId: 'buf_a', fromPinId: 'buf_a_outY', toCompId: 'bus_led', toPinId: 'bus_led_in', value: 1 },
      { id: 'w7', fromCompId: 'buf_b', fromPinId: 'buf_b_outY', toCompId: 'bus_led', toPinId: 'bus_led_in', value: 1 },
    ],
  },
  {
    id: 'alu_bus_splitter',
    name: '4-Bit ALU & Veri Yolu Ayırıcı (Splitter Bus)',
    category: 'arithmetic',
    description: '4-Bit ALU çıkışlarının paralel veri yolu ayırıcı (Splitter) ve 7-Segment Hex gösterge ile entegrasyonu.',
    components: [
      { ...createComponentInstance('vcc', 50, 60, '1 (High)'), id: 'vcc_1' },
      { ...createComponentInstance('gnd', 50, 120, '0 (Low)'), id: 'gnd_1' },
      { ...createComponentInstance('alu4', 160, 120, '4-Bit ALU'), id: 'alu_core' },
      { ...createComponentInstance('splitter4', 330, 120, 'Veri Yolu Splitter'), id: 'bus_split' },
      { ...createComponentInstance('hexDisplay', 490, 100, 'Hex Ekran'), id: 'alu_hex' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'vcc_1', fromPinId: 'vcc_1_out', toCompId: 'alu_core', toPinId: 'alu_core_inA0', value: 1 },
      { id: 'w2', fromCompId: 'vcc_1', fromPinId: 'vcc_1_out', toCompId: 'alu_core', toPinId: 'alu_core_inA1', value: 1 },
      { id: 'w3', fromCompId: 'vcc_1', fromPinId: 'vcc_1_out', toCompId: 'alu_core', toPinId: 'alu_core_inB0', value: 1 },
      { id: 'w4', fromCompId: 'alu_core', fromPinId: 'alu_core_outF0', toCompId: 'bus_split', toPinId: 'bus_split_in0', value: 0 },
      { id: 'w5', fromCompId: 'alu_core', fromPinId: 'alu_core_outF1', toCompId: 'bus_split', toPinId: 'bus_split_in1', value: 0 },
      { id: 'w6', fromCompId: 'alu_core', fromPinId: 'alu_core_outF2', toCompId: 'bus_split', toPinId: 'bus_split_in2', value: 0 },
      { id: 'w7', fromCompId: 'alu_core', fromPinId: 'alu_core_outF3', toCompId: 'bus_split', toPinId: 'bus_split_in3', value: 0 },
      { id: 'w8', fromCompId: 'bus_split', fromPinId: 'bus_split_out0', toCompId: 'alu_hex', toPinId: 'alu_hex_inD0', value: 0 },
      { id: 'w9', fromCompId: 'bus_split', fromPinId: 'bus_split_out1', toCompId: 'alu_hex', toPinId: 'alu_hex_inD1', value: 0 },
      { id: 'w10', fromCompId: 'bus_split', fromPinId: 'bus_split_out2', toCompId: 'alu_hex', toPinId: 'alu_hex_inD2', value: 0 },
      { id: 'w11', fromCompId: 'bus_split', fromPinId: 'bus_split_out3', toCompId: 'alu_hex', toPinId: 'alu_hex_inD3', value: 0 },
      // Open ALU inputs read as unknown, so the remaining bits and the operation select are tied low
      ...['inA2', 'inA3', 'inCin', 'inB1', 'inB2', 'inB3', 'inS0', 'inS1'].map((pin, i) => ({
        id: `w${12 + i}`,
        fromCompId: 'gnd_1',
        fromPinId: 'gnd_1_out',
        toCompId: 'alu_core',
        toPinId: `alu_core_${pin}`,
        value: 0 as const,
      })),
    ],
  },
  {
    id: 'counter_hex_demo',
    name: '4-Bit Senkron Sayaç ve 7-Segment Hex Gösterge (0-F)',
    category: 'sequential',
    description: 'Saat darbesi (CLK) ve Sıfırlama (RST) butonu ile kontrol edilen 4-bit sayaç, çıkışındaki 4 ikili biti Hexadecimal 7-Segment ekranda 0\'dan F\'ye canlı olarak saydırır.',
    components: [
      { ...createComponentInstance('clock', 60, 100, 'Saat Darbesi (CLK)'), id: 'cnt_clk' },
      { ...createComponentInstance('pushbutton', 60, 160, 'Sıfırla (RST)'), id: 'cnt_rst' },
      { ...createComponentInstance('counter4', 190, 100, '4-Bit Senkron Sayaç'), id: 'cnt_core' },
      { ...createComponentInstance('hexDisplay', 350, 100, 'Hex Ekran (0-F)'), id: 'cnt_hex' },
      { ...createComponentInstance('led', 480, 70, 'Q0 (LSB)'), id: 'led_q0' },
      { ...createComponentInstance('led', 480, 120, 'Q1'), id: 'led_q1' },
      { ...createComponentInstance('led', 480, 170, 'Q2'), id: 'led_q2' },
      { ...createComponentInstance('led', 480, 220, 'Q3 (MSB)'), id: 'led_q3' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'cnt_clk', fromPinId: 'cnt_clk_out', toCompId: 'cnt_core', toPinId: 'cnt_core_inClk', value: 0 },
      { id: 'w2', fromCompId: 'cnt_rst', fromPinId: 'cnt_rst_out', toCompId: 'cnt_core', toPinId: 'cnt_core_inRst', value: 0 },
      { id: 'w3', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ0', toCompId: 'cnt_hex', toPinId: 'cnt_hex_inD0', value: 0 },
      { id: 'w4', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ1', toCompId: 'cnt_hex', toPinId: 'cnt_hex_inD1', value: 0 },
      { id: 'w5', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ2', toCompId: 'cnt_hex', toPinId: 'cnt_hex_inD2', value: 0 },
      { id: 'w6', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ3', toCompId: 'cnt_hex', toPinId: 'cnt_hex_inD3', value: 0 },
      { id: 'w7', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ0', toCompId: 'led_q0', toPinId: 'led_q0_in', value: 0 },
      { id: 'w8', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ1', toCompId: 'led_q1', toPinId: 'led_q1_in', value: 0 },
      { id: 'w9', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ2', toCompId: 'led_q2', toPinId: 'led_q2_in', value: 0 },
      { id: 'w10', fromCompId: 'cnt_core', fromPinId: 'cnt_core_outQ3', toCompId: 'led_q3', toPinId: 'led_q3_in', value: 0 },
    ],
  },
  {
    id: 'magnitude_comparator',
    name: '4-Bit Büyüklük Karşılaştırıcı (74HC85 benzeri)',
    category: 'arithmetic',
    description: 'İki adet 4-bitlik ikili sayıyı (A3..A0 ile B3..B0) karşılaştırarak A>B, A=B veya A<B durumlarını anında tespit eden aritmetik mantık devresi.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A3 (MSB)'), id: 'sw_a3' },
      { ...createComponentInstance('switch', 60, 90, 'A2'), id: 'sw_a2' },
      { ...createComponentInstance('switch', 60, 140, 'A1'), id: 'sw_a1' },
      { ...createComponentInstance('switch', 60, 190, 'A0 (LSB)'), id: 'sw_a0' },
      { ...createComponentInstance('switch', 160, 240, 'B0 (LSB)'), id: 'sw_b0' },
      { ...createComponentInstance('switch', 210, 240, 'B1'), id: 'sw_b1' },
      { ...createComponentInstance('switch', 260, 240, 'B2'), id: 'sw_b2' },
      { ...createComponentInstance('switch', 310, 240, 'B3 (MSB)'), id: 'sw_b3' },
      { ...createComponentInstance('comparator4', 210, 90, '4-Bit CMP'), id: 'cmp_core' },
      { ...createComponentInstance('led', 390, 80, 'A > B (Yeşil)'), id: 'led_gt' },
      { ...createComponentInstance('led', 390, 130, 'A = B (Mavi)'), id: 'led_eq' },
      { ...createComponentInstance('led', 390, 180, 'A < B (Kırmızı)'), id: 'led_lt' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sw_a0', fromPinId: 'sw_a0_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inA0', value: 0 },
      { id: 'w2', fromCompId: 'sw_a1', fromPinId: 'sw_a1_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inA1', value: 0 },
      { id: 'w3', fromCompId: 'sw_a2', fromPinId: 'sw_a2_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inA2', value: 0 },
      { id: 'w4', fromCompId: 'sw_a3', fromPinId: 'sw_a3_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inA3', value: 0 },
      { id: 'w5', fromCompId: 'sw_b0', fromPinId: 'sw_b0_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inB0', value: 0 },
      { id: 'w6', fromCompId: 'sw_b1', fromPinId: 'sw_b1_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inB1', value: 0 },
      { id: 'w7', fromCompId: 'sw_b2', fromPinId: 'sw_b2_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inB2', value: 0 },
      { id: 'w8', fromCompId: 'sw_b3', fromPinId: 'sw_b3_out', toCompId: 'cmp_core', toPinId: 'cmp_core_inB3', value: 0 },
      { id: 'w9', fromCompId: 'cmp_core', fromPinId: 'cmp_core_outGT', toCompId: 'led_gt', toPinId: 'led_gt_in', value: 0 },
      { id: 'w10', fromCompId: 'cmp_core', fromPinId: 'cmp_core_outEQ', toCompId: 'led_eq', toPinId: 'led_eq_in', value: 1 },
      { id: 'w11', fromCompId: 'cmp_core', fromPinId: 'cmp_core_outLT', toCompId: 'led_lt', toPinId: 'led_lt_in', value: 0 },
    ],
  },
  {
    id: 'priority_encoder_demo',
    name: '4:2 Öncelikli Kodlayıcı (74HC148 benzeri)',
    category: 'basic',
    description: '4 aktif-yüksek girişten (D3..D0) önceliği en yüksek olanı 2-bit ikili koda (Y1, Y0) çevirir; V pini en az bir girişin aktif olduğunu gösterir. Gerçek 74HC148 ise 8:3 ve aktif-düşük çalışır.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'D0 (En Düşük Öncelik)'), id: 'pri_sw0' },
      { ...createComponentInstance('switch', 60, 100, 'D1'), id: 'pri_sw1' },
      { ...createComponentInstance('switch', 60, 150, 'D2'), id: 'pri_sw2' },
      { ...createComponentInstance('switch', 60, 200, 'D3 (En Yüksek Öncelik)'), id: 'pri_sw3' },
      { ...createComponentInstance('priorityEncoder4to2', 200, 90, '4:2 Öncelikli Kodlayıcı'), id: 'pri_core' },
      { ...createComponentInstance('led', 360, 80, 'Y1 (MSB)'), id: 'pri_led_y1' },
      { ...createComponentInstance('led', 360, 130, 'Y0 (LSB)'), id: 'pri_led_y0' },
      { ...createComponentInstance('led', 360, 180, 'V (Geçerli / Valid)'), id: 'pri_led_v' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'pri_sw0', fromPinId: 'pri_sw0_out', toCompId: 'pri_core', toPinId: 'pri_core_inD0', value: 0 },
      { id: 'w2', fromCompId: 'pri_sw1', fromPinId: 'pri_sw1_out', toCompId: 'pri_core', toPinId: 'pri_core_inD1', value: 0 },
      { id: 'w3', fromCompId: 'pri_sw2', fromPinId: 'pri_sw2_out', toCompId: 'pri_core', toPinId: 'pri_core_inD2', value: 0 },
      { id: 'w4', fromCompId: 'pri_sw3', fromPinId: 'pri_sw3_out', toCompId: 'pri_core', toPinId: 'pri_core_inD3', value: 0 },
      { id: 'w5', fromCompId: 'pri_core', fromPinId: 'pri_core_outY1', toCompId: 'pri_led_y1', toPinId: 'pri_led_y1_in', value: 0 },
      { id: 'w6', fromCompId: 'pri_core', fromPinId: 'pri_core_outY0', toCompId: 'pri_led_y0', toPinId: 'pri_led_y0_in', value: 0 },
      { id: 'w7', fromCompId: 'pri_core', fromPinId: 'pri_core_outV', toCompId: 'pri_led_v', toPinId: 'pri_led_v_in', value: 0 },
    ],
  },
  {
    id: 'universal_shift_register_demo',
    name: '4-Bit Çift Yönlü Kaydırmalı Yazmaç (74HC194 benzeri)',
    category: 'sequential',
    description: 'Saat darbesi (CLK) ve mod anahtarlarıyla çalışan 4-bit kaydırmalı saklayıcı: S1-S0=01 iken sağa, 10 iken sola kaydırır.',
    components: [
      { ...createComponentInstance('clock', 60, 60, 'Saat Darbesi (CLK)'), id: 'sh_clk' },
      { ...createComponentInstance('pushbutton', 60, 110, 'Sıfırla (CLR)'), id: 'sh_clr' },
      { ...createComponentInstance('switch', 60, 160, 'SR (Sağ Giriş)'), id: 'sh_sr' },
      { ...createComponentInstance('switch', 60, 210, 'SL (Sol Giriş)'), id: 'sh_sl' },
      { ...createComponentInstance('switch', 160, 260, 'S0 (Mod 0)'), id: 'sh_s0' },
      { ...createComponentInstance('switch', 220, 260, 'S1 (Mod 1)'), id: 'sh_s1' },
      { ...createComponentInstance('shiftRegister4', 200, 90, '4-Bit Shift Reg'), id: 'sh_core' },
      { ...createComponentInstance('led', 380, 60, 'Q0 (LSB)'), id: 'sh_q0' },
      { ...createComponentInstance('led', 380, 110, 'Q1'), id: 'sh_q1' },
      { ...createComponentInstance('led', 380, 160, 'Q2'), id: 'sh_q2' },
      { ...createComponentInstance('led', 380, 210, 'Q3 (MSB)'), id: 'sh_q3' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'sh_clk', fromPinId: 'sh_clk_out', toCompId: 'sh_core', toPinId: 'sh_core_inClk', value: 0 },
      { id: 'w2', fromCompId: 'sh_clr', fromPinId: 'sh_clr_out', toCompId: 'sh_core', toPinId: 'sh_core_inRst', value: 0 },
      { id: 'w3', fromCompId: 'sh_sl', fromPinId: 'sh_sl_out', toCompId: 'sh_core', toPinId: 'sh_core_inSL', value: 0 },
      { id: 'w4', fromCompId: 'sh_sr', fromPinId: 'sh_sr_out', toCompId: 'sh_core', toPinId: 'sh_core_inSR', value: 1 },
      { id: 'w5', fromCompId: 'sh_s0', fromPinId: 'sh_s0_out', toCompId: 'sh_core', toPinId: 'sh_core_inS0', value: 1 },
      { id: 'w6', fromCompId: 'sh_s1', fromPinId: 'sh_s1_out', toCompId: 'sh_core', toPinId: 'sh_core_inS1', value: 0 },
      { id: 'w7', fromCompId: 'sh_core', fromPinId: 'sh_core_outQ0', toCompId: 'sh_q0', toPinId: 'sh_q0_in', value: 0 },
      { id: 'w8', fromCompId: 'sh_core', fromPinId: 'sh_core_outQ1', toCompId: 'sh_q1', toPinId: 'sh_q1_in', value: 0 },
      { id: 'w9', fromCompId: 'sh_core', fromPinId: 'sh_core_outQ2', toCompId: 'sh_q2', toPinId: 'sh_q2_in', value: 0 },
      { id: 'w10', fromCompId: 'sh_core', fromPinId: 'sh_core_outQ3', toCompId: 'sh_q3', toPinId: 'sh_q3_in', value: 0 },
    ],
  },
  {
    id: 'ram_memory_demo',
    name: '16x4-Bit RAM Bellek ve Hex Gösterge',
    category: 'sequential',
    description: '16 Adresli 4-Bit RAM: A3-A0 adresini seçin, D3-D0 verisini ayarlayın ve WE=1 iken CLK saat darbesiyle belleğe yazın. Adresteki veri doğrudan Hex ekranda okunur.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A0 (Adres 0)'), id: 'ram_sw_a0' },
      { ...createComponentInstance('switch', 60, 100, 'A1 (Adres 1)'), id: 'ram_sw_a1' },
      { ...createComponentInstance('switch', 60, 150, 'A2 (Adres 2)'), id: 'ram_sw_a2' },
      { ...createComponentInstance('switch', 60, 200, 'A3 (Adres 3)'), id: 'ram_sw_a3' },
      { ...createComponentInstance('switch', 60, 250, 'D0 (Veri 0)'), id: 'ram_sw_d0' },
      { ...createComponentInstance('switch', 60, 300, 'D1 (Veri 1)'), id: 'ram_sw_d1' },
      { ...createComponentInstance('switch', 60, 350, 'D2 (Veri 2)'), id: 'ram_sw_d2' },
      { ...createComponentInstance('switch', 60, 400, 'D3 (Veri 3)'), id: 'ram_sw_d3' },
      { ...createComponentInstance('clock', 170, 290, 'CLK (Yazma Saati)'), id: 'ram_clk' },
      { ...createComponentInstance('switch', 240, 290, 'WE (Yazma İzni)'), id: 'ram_sw_we' },
      { ...createComponentInstance('ram16x4', 210, 80, '16x4 RAM'), id: 'ram_chip' },
      { ...createComponentInstance('hexDisplay', 380, 80, 'Okunan Hex Ekran'), id: 'ram_disp' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'ram_sw_a0', fromPinId: 'ram_sw_a0_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA0', value: 0 },
      { id: 'w2', fromCompId: 'ram_sw_a1', fromPinId: 'ram_sw_a1_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA1', value: 0 },
      { id: 'w3', fromCompId: 'ram_sw_a2', fromPinId: 'ram_sw_a2_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA2', value: 0 },
      { id: 'w4', fromCompId: 'ram_sw_a3', fromPinId: 'ram_sw_a3_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA3', value: 0 },
      { id: 'w5', fromCompId: 'ram_sw_d0', fromPinId: 'ram_sw_d0_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inD0', value: 0 },
      { id: 'w6', fromCompId: 'ram_sw_d1', fromPinId: 'ram_sw_d1_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inD1', value: 0 },
      { id: 'w6b', fromCompId: 'ram_sw_d2', fromPinId: 'ram_sw_d2_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inD2', value: 0 },
      { id: 'w6c', fromCompId: 'ram_sw_d3', fromPinId: 'ram_sw_d3_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inD3', value: 0 },
      { id: 'w7', fromCompId: 'ram_clk', fromPinId: 'ram_clk_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inClk', value: 0 },
      { id: 'w8', fromCompId: 'ram_sw_we', fromPinId: 'ram_sw_we_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inWE', value: 0 },
      { id: 'w9', fromCompId: 'ram_chip', fromPinId: 'ram_chip_outQ0', toCompId: 'ram_disp', toPinId: 'ram_disp_inD0', value: 0 },
      { id: 'w10', fromCompId: 'ram_chip', fromPinId: 'ram_chip_outQ1', toCompId: 'ram_disp', toPinId: 'ram_disp_inD1', value: 0 },
      { id: 'w11', fromCompId: 'ram_chip', fromPinId: 'ram_chip_outQ2', toCompId: 'ram_disp', toPinId: 'ram_disp_inD2', value: 0 },
      { id: 'w12', fromCompId: 'ram_chip', fromPinId: 'ram_chip_outQ3', toCompId: 'ram_disp', toPinId: 'ram_disp_inD3', value: 0 },
    ],
  },
  {
    id: 'full_subtractor_demo',
    name: '1-Bit Tam Çıkarıcı (Full Subtractor)',
    category: 'arithmetic',
    description: 'Eksilen (A), Çıkan (B) ve Borç Girişi (Bin) mantık anahtarlarıyla Fark (Diff) ve Borç Çıkışı (Bout) hesaplayan tam çıkarıcı devresi.',
    components: [
      { ...createComponentInstance('switch', 80, 50, 'A (Eksilen)'), id: 'fs_sw_a' },
      { ...createComponentInstance('switch', 80, 110, 'B (Çıkan)'), id: 'fs_sw_b' },
      { ...createComponentInstance('switch', 80, 170, 'Bin (Borç Girişi)'), id: 'fs_sw_bin' },
      { ...createComponentInstance('fullSubtractor', 230, 80, '1-Bit Tam Çıkarıcı'), id: 'fs_core' },
      { ...createComponentInstance('led', 390, 70, 'Fark (Diff = A⊕B⊕Bin)'), id: 'fs_led_diff' },
      { ...createComponentInstance('led', 390, 150, 'Borç Çıkışı (Bout)'), id: 'fs_led_bout' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'fs_sw_a', fromPinId: 'fs_sw_a_out', toCompId: 'fs_core', toPinId: 'fs_core_inA', value: 0 },
      { id: 'w2', fromCompId: 'fs_sw_b', fromPinId: 'fs_sw_b_out', toCompId: 'fs_core', toPinId: 'fs_core_inB', value: 0 },
      { id: 'w3', fromCompId: 'fs_sw_bin', fromPinId: 'fs_sw_bin_out', toCompId: 'fs_core', toPinId: 'fs_core_inBin', value: 0 },
      { id: 'w4', fromCompId: 'fs_core', fromPinId: 'fs_core_outD', toCompId: 'fs_led_diff', toPinId: 'fs_led_diff_in', value: 0 },
      { id: 'w5', fromCompId: 'fs_core', fromPinId: 'fs_core_outBout', toCompId: 'fs_led_bout', toPinId: 'fs_led_bout_in', value: 0 },
    ],
  },
  {
    id: 'bcd_to_7seg_display_demo',
    name: 'BCD/Hex → 7-Segment Kod Çözücü ve LED Ekran',
    category: 'basic',
    description: '4-Bit ikili kodu 7-segment LED göstergesi formatına (a-g) dönüştürerek 0-9 rakamlarını (10-15 için A-F harflerini) görüntüler. Çözücü aktif-yüksek çıkış verir (ortak katot ekran); gerçek 74LS47 aktif-düşüktür.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A (Bit 0 LSB)'), id: 'bcd_sw_a' },
      { ...createComponentInstance('switch', 60, 100, 'B (Bit 1)'), id: 'bcd_sw_b' },
      { ...createComponentInstance('switch', 60, 150, 'C (Bit 2)'), id: 'bcd_sw_c' },
      { ...createComponentInstance('switch', 60, 200, 'D (Bit 3 MSB)'), id: 'bcd_sw_d' },
      { ...createComponentInstance('bcdTo7Seg', 210, 80, 'BCD/Hex → 7-Seg'), id: 'bcd_chip' },
      { ...createComponentInstance('sevenSegment', 380, 90, '7-Segment Ekran'), id: 'bcd_disp' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'bcd_sw_a', fromPinId: 'bcd_sw_a_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inA', value: 0 },
      { id: 'w2', fromCompId: 'bcd_sw_b', fromPinId: 'bcd_sw_b_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inB', value: 0 },
      { id: 'w3', fromCompId: 'bcd_sw_c', fromPinId: 'bcd_sw_c_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inC', value: 0 },
      { id: 'w4', fromCompId: 'bcd_sw_d', fromPinId: 'bcd_sw_d_out', toCompId: 'bcd_chip', toPinId: 'bcd_chip_inD', value: 0 },
      { id: 'w5', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outA', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inA', value: 0 },
      { id: 'w6', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outB', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inB', value: 0 },
      { id: 'w7', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outC', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inC', value: 0 },
      { id: 'w8', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outD', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inD', value: 0 },
      { id: 'w9', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outE', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inE', value: 0 },
      { id: 'w10', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outF', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inF', value: 0 },
      { id: 'w11', fromCompId: 'bcd_chip', fromPinId: 'bcd_chip_outG', toCompId: 'bcd_disp', toPinId: 'bcd_disp_inG', value: 0 },
    ],
  },
  {
    id: 'decoder_3to8_minterm_demo',
    name: '3:8 Kod Çözücü ile Minterm Seçimi (74HC238 benzeri)',
    category: 'basic',
    description: '3-Bit ikili adres (A0, A1, A2) ve Enable yetkilendirmesiyle 8 çıkış hattından (m0-m7) birini seçen kod çözücü mimarisi.',
    components: [
      { ...createComponentInstance('switch', 60, 40, 'EN (Yetki = 1)'), id: 'dec_sw_en', state: { on: true } },
      { ...createComponentInstance('switch', 60, 100, 'A0 (Adres Bit 0)'), id: 'dec_sw_a0' },
      { ...createComponentInstance('switch', 60, 160, 'A1 (Adres Bit 1)'), id: 'dec_sw_a1' },
      { ...createComponentInstance('switch', 60, 220, 'A2 (Adres Bit 2)'), id: 'dec_sw_a2' },
      { ...createComponentInstance('decoder3to8', 210, 70, '3:8 Decoder'), id: 'dec_chip' },
      { ...createComponentInstance('led', 370, 40, 'm0 (000)'), id: 'dec_led_0' },
      { ...createComponentInstance('led', 370, 80, 'm1 (001)'), id: 'dec_led_1' },
      { ...createComponentInstance('led', 370, 120, 'm2 (010)'), id: 'dec_led_2' },
      { ...createComponentInstance('led', 370, 160, 'm3 (011)'), id: 'dec_led_3' },
      { ...createComponentInstance('led', 440, 40, 'm4 (100)'), id: 'dec_led_4' },
      { ...createComponentInstance('led', 440, 80, 'm5 (101)'), id: 'dec_led_5' },
      { ...createComponentInstance('led', 440, 120, 'm6 (110)'), id: 'dec_led_6' },
      { ...createComponentInstance('led', 440, 160, 'm7 (111)'), id: 'dec_led_7' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'dec_sw_en', fromPinId: 'dec_sw_en_out', toCompId: 'dec_chip', toPinId: 'dec_chip_inEN', value: 1 },
      { id: 'w2', fromCompId: 'dec_sw_a0', fromPinId: 'dec_sw_a0_out', toCompId: 'dec_chip', toPinId: 'dec_chip_inA0', value: 0 },
      { id: 'w3', fromCompId: 'dec_sw_a1', fromPinId: 'dec_sw_a1_out', toCompId: 'dec_chip', toPinId: 'dec_chip_inA1', value: 0 },
      { id: 'w4', fromCompId: 'dec_sw_a2', fromPinId: 'dec_sw_a2_out', toCompId: 'dec_chip', toPinId: 'dec_chip_inA2', value: 0 },
      { id: 'w5', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY0', toCompId: 'dec_led_0', toPinId: 'dec_led_0_in', value: 0 },
      { id: 'w6', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY1', toCompId: 'dec_led_1', toPinId: 'dec_led_1_in', value: 0 },
      { id: 'w7', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY2', toCompId: 'dec_led_2', toPinId: 'dec_led_2_in', value: 0 },
      { id: 'w8', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY3', toCompId: 'dec_led_3', toPinId: 'dec_led_3_in', value: 0 },
      { id: 'w9', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY4', toCompId: 'dec_led_4', toPinId: 'dec_led_4_in', value: 0 },
      { id: 'w10', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY5', toCompId: 'dec_led_5', toPinId: 'dec_led_5_in', value: 0 },
      { id: 'w11', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY6', toCompId: 'dec_led_6', toPinId: 'dec_led_6_in', value: 0 },
      { id: 'w12', fromCompId: 'dec_chip', fromPinId: 'dec_chip_outY7', toCompId: 'dec_led_7', toPinId: 'dec_led_7_in', value: 0 },
    ],
  },
  {
    id: 'sap1_micro_cpu_demo',
    name: 'SAP-1 Basit İşlemci (Simple As Possible CPU) Mimarisi',
    category: 'sequential',
    description: 'Sıfırdan İşlemciye yolculuğunun zirvesi: Program Sayacı (PC), 16x4 Program Belleği (RAM), A Yazmacı (Akümülatör), 4-Bit ALU ve Çıkış Göstergesinden oluşan gerçek zamanlı çalışan eğitim işlemcisi.',
    components: [
      { ...createComponentInstance('clock', 60, 60, 'Ana Saat (CLK)'), id: 'cpu_clk' },
      { ...createComponentInstance('switch', 60, 140, 'Sıfırla (Reset=0)'), id: 'cpu_rst' },
      { ...createComponentInstance('counter4', 180, 70, 'Program Sayacı (PC)'), id: 'cpu_pc' },
      {
        ...createComponentInstance('ram16x4', 330, 70, '16x4 Program Belleği (RAM)'),
        id: 'cpu_ram',
        state: { ramData: [3, 7, 2, 9, 12, 5, 1, 14, 0, 4, 8, 11, 15, 6, 10, 13] },
      },
      { ...createComponentInstance('switch', 220, 250, 'RAM Yazma (WE=0)'), id: 'cpu_we' },
      { ...createComponentInstance('register4', 500, 70, 'A Yazmacı (Akümülatör)'), id: 'cpu_reg_a' },
      { ...createComponentInstance('switch', 500, 10, 'A-Yazmaç İzni (WE=1)'), id: 'cpu_reg_we', state: { on: true } },
      { ...createComponentInstance('hexDisplay', 670, 70, 'Çıkış Portu (Display)'), id: 'cpu_disp' },
      { ...createComponentInstance('alu4', 500, 240, '4-Bit ALU'), id: 'cpu_alu' },
      { ...createComponentInstance('gnd', 400, 330, 'ALU B=0 (ADD)'), id: 'cpu_alu_gnd' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'cpu_clk', fromPinId: 'cpu_clk_out', toCompId: 'cpu_pc', toPinId: 'cpu_pc_inClk', value: 0 },
      { id: 'w2', fromCompId: 'cpu_rst', fromPinId: 'cpu_rst_out', toCompId: 'cpu_pc', toPinId: 'cpu_pc_inRst', value: 0 },
      { id: 'w3', fromCompId: 'cpu_pc', fromPinId: 'cpu_pc_outQ0', toCompId: 'cpu_ram', toPinId: 'cpu_ram_inA0', value: 0 },
      { id: 'w4', fromCompId: 'cpu_pc', fromPinId: 'cpu_pc_outQ1', toCompId: 'cpu_ram', toPinId: 'cpu_ram_inA1', value: 0 },
      { id: 'w5', fromCompId: 'cpu_pc', fromPinId: 'cpu_pc_outQ2', toCompId: 'cpu_ram', toPinId: 'cpu_ram_inA2', value: 0 },
      { id: 'w6', fromCompId: 'cpu_pc', fromPinId: 'cpu_pc_outQ3', toCompId: 'cpu_ram', toPinId: 'cpu_ram_inA3', value: 0 },
      { id: 'w7', fromCompId: 'cpu_clk', fromPinId: 'cpu_clk_out', toCompId: 'cpu_ram', toPinId: 'cpu_ram_inClk', value: 0 },
      { id: 'w8', fromCompId: 'cpu_we', fromPinId: 'cpu_we_out', toCompId: 'cpu_ram', toPinId: 'cpu_ram_inWE', value: 0 },
      { id: 'w9', fromCompId: 'cpu_ram', fromPinId: 'cpu_ram_outQ0', toCompId: 'cpu_reg_a', toPinId: 'cpu_reg_a_inD0', value: 0 },
      { id: 'w10', fromCompId: 'cpu_ram', fromPinId: 'cpu_ram_outQ1', toCompId: 'cpu_reg_a', toPinId: 'cpu_reg_a_inD1', value: 0 },
      { id: 'w11', fromCompId: 'cpu_ram', fromPinId: 'cpu_ram_outQ2', toCompId: 'cpu_reg_a', toPinId: 'cpu_reg_a_inD2', value: 0 },
      { id: 'w12', fromCompId: 'cpu_ram', fromPinId: 'cpu_ram_outQ3', toCompId: 'cpu_reg_a', toPinId: 'cpu_reg_a_inD3', value: 0 },
      { id: 'w13', fromCompId: 'cpu_clk', fromPinId: 'cpu_clk_out', toCompId: 'cpu_reg_a', toPinId: 'cpu_reg_a_inClk', value: 0 },
      { id: 'w14', fromCompId: 'cpu_reg_we', fromPinId: 'cpu_reg_we_out', toCompId: 'cpu_reg_a', toPinId: 'cpu_reg_a_inWE', value: 1 },
      { id: 'w15', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ0', toCompId: 'cpu_disp', toPinId: 'cpu_disp_inD0', value: 0 },
      { id: 'w16', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ1', toCompId: 'cpu_disp', toPinId: 'cpu_disp_inD1', value: 0 },
      { id: 'w17', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ2', toCompId: 'cpu_disp', toPinId: 'cpu_disp_inD2', value: 0 },
      { id: 'w18', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ3', toCompId: 'cpu_disp', toPinId: 'cpu_disp_inD3', value: 0 },
      { id: 'w19', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ0', toCompId: 'cpu_alu', toPinId: 'cpu_alu_inA0', value: 0 },
      { id: 'w20', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ1', toCompId: 'cpu_alu', toPinId: 'cpu_alu_inA1', value: 0 },
      { id: 'w21', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ2', toCompId: 'cpu_alu', toPinId: 'cpu_alu_inA2', value: 0 },
      { id: 'w22', fromCompId: 'cpu_reg_a', fromPinId: 'cpu_reg_a_outQ3', toCompId: 'cpu_alu', toPinId: 'cpu_alu_inA3', value: 0 },
      // Open ALU inputs read as unknown, so B, the carry-in and the operation select are tied low
      ...['inB0', 'inB1', 'inB2', 'inB3', 'inCin', 'inS0', 'inS1'].map((pin, i) => ({
        id: `w${23 + i}`,
        fromCompId: 'cpu_alu_gnd',
        fromPinId: 'cpu_alu_gnd_out',
        toCompId: 'cpu_alu',
        toPinId: `cpu_alu_${pin}`,
        value: 0 as const,
      })),
    ],
  },
  {
    id: 'chiptune_music_box',
    name: '8-Bit Chiptune Müzik Kutusu (Super Mario Melodisi)',
    category: 'music_graphics',
    description: 'Saat darbesi (CLK), 4-bit senkron sayaç ve notaların yazılı olduğu 16x4 ROM belleğiyle piezo buzzer üzerinden efsanevi Super Mario temasını 8-bit chiptune ses olarak çalan müzik işlemcisi.',
    components: [
      { ...createComponentInstance('vcc', 50, 40, 'Ses İzni (EN=1)'), id: 'vcc_mario' },
      { ...createComponentInstance('clock', 50, 110, 'Tempo Saati (CLK)'), id: 'clk_mario', state: { frequencyHz: 4 } },
      { ...createComponentInstance('pushbutton', 50, 180, 'Başa Sar (RST)'), id: 'rst_mario' },
      { ...createComponentInstance('counter4', 180, 100, 'Melodi Sayacı (PC)'), id: 'cnt_mario' },
      {
        ...createComponentInstance('rom16x4', 340, 100, 'Melodi ROM (Super Mario)'),
        id: 'rom_mario',
        state: { romData: [9, 9, 15, 9, 15, 7, 9, 15, 11, 15, 15, 15, 4, 15, 15, 15] },
      },
      { ...createComponentInstance('buzzer', 540, 100, 'Chiptune Piezo Buzzer'), id: 'buzz_mario' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'clk_mario', fromPinId: 'clk_mario_out', toCompId: 'cnt_mario', toPinId: 'cnt_mario_inClk', value: 0 },
      { id: 'w2', fromCompId: 'rst_mario', fromPinId: 'rst_mario_out', toCompId: 'cnt_mario', toPinId: 'cnt_mario_inRst', value: 0 },
      { id: 'w3', fromCompId: 'cnt_mario', fromPinId: 'cnt_mario_outQ0', toCompId: 'rom_mario', toPinId: 'rom_mario_inA0', value: 0 },
      { id: 'w4', fromCompId: 'cnt_mario', fromPinId: 'cnt_mario_outQ1', toCompId: 'rom_mario', toPinId: 'rom_mario_inA1', value: 0 },
      { id: 'w5', fromCompId: 'cnt_mario', fromPinId: 'cnt_mario_outQ2', toCompId: 'rom_mario', toPinId: 'rom_mario_inA2', value: 0 },
      { id: 'w6', fromCompId: 'cnt_mario', fromPinId: 'cnt_mario_outQ3', toCompId: 'rom_mario', toPinId: 'rom_mario_inA3', value: 0 },
      { id: 'w7', fromCompId: 'rom_mario', fromPinId: 'rom_mario_outQ0', toCompId: 'buzz_mario', toPinId: 'buzz_mario_pitch0', value: 0 },
      { id: 'w8', fromCompId: 'rom_mario', fromPinId: 'rom_mario_outQ1', toCompId: 'buzz_mario', toPinId: 'buzz_mario_pitch1', value: 0 },
      { id: 'w9', fromCompId: 'rom_mario', fromPinId: 'rom_mario_outQ2', toCompId: 'buzz_mario', toPinId: 'buzz_mario_pitch2', value: 0 },
      { id: 'w10', fromCompId: 'rom_mario', fromPinId: 'rom_mario_outQ3', toCompId: 'buzz_mario', toPinId: 'buzz_mario_pitch3', value: 0 },
      { id: 'w11', fromCompId: 'vcc_mario', fromPinId: 'vcc_mario_out', toCompId: 'buzz_mario', toPinId: 'buzz_mario_in', value: 1 },
    ],
  },
  {
    id: 'chiptune_synth_station',
    name: '8-Bit Retro Ses Synthesizer & Müzik İstasyonu Kiti',
    category: 'music_graphics',
    description: 'Saat jeneratörü, 4-bit melodi sayacı, 16x4 Melodi ROM belleği, 7-Segment nota göstergesi ve piezo synthesizer içeren tam donanımlı ses üretim kiti.',
    components: [
      { ...createComponentInstance('vcc', 50, 40, 'Güç (VCC)'), id: 'vcc_ps' },
      { ...createComponentInstance('clock', 50, 110, 'Tempo Saati'), id: 'clk_ps', state: { frequencyHz: 4 } },
      { ...createComponentInstance('pushbutton', 50, 180, 'Sıfırla / Başa Al'), id: 'rst_ps' },
      { ...createComponentInstance('counter4', 180, 100, 'Melodi Sayacı'), id: 'cnt_ps' },
      {
        ...createComponentInstance('rom16x4', 330, 100, 'Melodi ROM (Star Wars Fanfare)'),
        id: 'rom_ps',
        state: { romData: [4, 4, 4, 7, 7, 11, 11, 10, 9, 8, 14, 14, 11, 11, 15, 15] },
      },
      { ...createComponentInstance('hexDisplay', 490, 100, 'Nota Göstergesi (0-F)'), id: 'hex_note' },
      { ...createComponentInstance('buzzer', 640, 80, 'Chiptune Synthesizer'), id: 'buzz_ps' },
      { ...createComponentInstance('led', 640, 180, 'Sinyal Aktif LED'), id: 'led_ps' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'clk_ps', fromPinId: 'clk_ps_out', toCompId: 'cnt_ps', toPinId: 'cnt_ps_inClk', value: 0 },
      { id: 'w2', fromCompId: 'rst_ps', fromPinId: 'rst_ps_out', toCompId: 'cnt_ps', toPinId: 'cnt_ps_inRst', value: 0 },
      { id: 'w3', fromCompId: 'cnt_ps', fromPinId: 'cnt_ps_outQ0', toCompId: 'rom_ps', toPinId: 'rom_ps_inA0', value: 0 },
      { id: 'w4', fromCompId: 'cnt_ps', fromPinId: 'cnt_ps_outQ1', toCompId: 'rom_ps', toPinId: 'rom_ps_inA1', value: 0 },
      { id: 'w5', fromCompId: 'cnt_ps', fromPinId: 'cnt_ps_outQ2', toCompId: 'rom_ps', toPinId: 'rom_ps_inA2', value: 0 },
      { id: 'w6', fromCompId: 'cnt_ps', fromPinId: 'cnt_ps_outQ3', toCompId: 'rom_ps', toPinId: 'rom_ps_inA3', value: 0 },
      { id: 'w7', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ0', toCompId: 'buzz_ps', toPinId: 'buzz_ps_pitch0', value: 0 },
      { id: 'w8', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ1', toCompId: 'buzz_ps', toPinId: 'buzz_ps_pitch1', value: 0 },
      { id: 'w9', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ2', toCompId: 'buzz_ps', toPinId: 'buzz_ps_pitch2', value: 0 },
      { id: 'w10', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ3', toCompId: 'buzz_ps', toPinId: 'buzz_ps_pitch3', value: 0 },
      { id: 'w11', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ0', toCompId: 'hex_note', toPinId: 'hex_note_inD0', value: 0 },
      { id: 'w12', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ1', toCompId: 'hex_note', toPinId: 'hex_note_inD1', value: 0 },
      { id: 'w13', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ2', toCompId: 'hex_note', toPinId: 'hex_note_inD2', value: 0 },
      { id: 'w14', fromCompId: 'rom_ps', fromPinId: 'rom_ps_outQ3', toCompId: 'hex_note', toPinId: 'hex_note_inD3', value: 0 },
      { id: 'w15', fromCompId: 'vcc_ps', fromPinId: 'vcc_ps_out', toCompId: 'buzz_ps', toPinId: 'buzz_ps_in', value: 1 },
      { id: 'w16', fromCompId: 'vcc_ps', fromPinId: 'vcc_ps_out', toCompId: 'led_ps', toPinId: 'led_ps_in', value: 1 },
    ],
  },
  {
    id: 'dot_matrix_demo',
    name: '8x8 LED Nokta Matris: Satır × Sütun Kesişimi',
    category: 'music_graphics',
    description: 'Bir piksel, satırı ve sütunu aynı anda 1 olduğunda yanar. VCC satır 1-2 ile sütun 3-4\'ü sürekli sürer; iki anahtar satır 5-6\'yı ve sütun 2 ile 5\'i açıp kapatarak yanan bloğun nasıl büyüyüp küçüldüğünü gösterir.',
    components: [
      { ...createComponentInstance('vcc', 50, 40, 'VCC (+5V)'), id: 'vcc_mat' },
      { ...createComponentInstance('switch', 50, 110, 'Sütun 2 ve 5'), id: 'sw_eye', state: { on: true } },
      { ...createComponentInstance('switch', 50, 180, 'Satır 5 ve 6'), id: 'sw_smile', state: { on: true } },
      { ...createComponentInstance('dotMatrix8x8', 260, 60, '8x8 GPU Ekran'), id: 'disp_mat' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'vcc_mat', fromPinId: 'vcc_mat_out', toCompId: 'disp_mat', toPinId: 'disp_mat_row1', value: 1 },
      { id: 'w2', fromCompId: 'vcc_mat', fromPinId: 'vcc_mat_out', toCompId: 'disp_mat', toPinId: 'disp_mat_row2', value: 1 },
      { id: 'w3', fromCompId: 'sw_smile', fromPinId: 'sw_smile_out', toCompId: 'disp_mat', toPinId: 'disp_mat_row5', value: 1 },
      { id: 'w4', fromCompId: 'sw_smile', fromPinId: 'sw_smile_out', toCompId: 'disp_mat', toPinId: 'disp_mat_row6', value: 1 },
      { id: 'w5', fromCompId: 'sw_eye', fromPinId: 'sw_eye_out', toCompId: 'disp_mat', toPinId: 'disp_mat_col2', value: 1 },
      { id: 'w6', fromCompId: 'vcc_mat', fromPinId: 'vcc_mat_out', toCompId: 'disp_mat', toPinId: 'disp_mat_col3', value: 1 },
      { id: 'w7', fromCompId: 'vcc_mat', fromPinId: 'vcc_mat_out', toCompId: 'disp_mat', toPinId: 'disp_mat_col4', value: 1 },
      { id: 'w8', fromCompId: 'sw_eye', fromPinId: 'sw_eye_out', toCompId: 'disp_mat', toPinId: 'disp_mat_col5', value: 1 },
    ],
  },
  {
    id: 'ascii_keyboard_terminal',
    name: 'ASCII Klavye ve Veri Hazır (ST) Sinyali',
    category: 'music_graphics',
    description: 'Klavye basılan tuşun 7-bit ASCII kodunu (D0-D6) ve veri hazır (ST) sinyalini üretir. Bu şablonda yalnızca alt 4 bit (D0-D3) bağlıdır: hex ekran ve LED çubuğu kodun son hex hanesini gösterir (ör. \'A\' = 41h → 1). ST LED\'i tuşa basılınca yanar, düğmeyle temizlenir.',
    components: [
      { ...createComponentInstance('asciiKeyboard', 60, 80, 'ASCII Giriş Terminali'), id: 'kbd_unit', state: { asciiChar: 'A', asciiCode: 65, strobe: true } },
      { ...createComponentInstance('pushbutton', 60, 210, 'ST Temizle (ACK/CLR)'), id: 'btn_ack' },
      { ...createComponentInstance('hexDisplay', 260, 60, 'ASCII Alt Hane (D0-D3)'), id: 'hex_ascii' },
      { ...createComponentInstance('led', 260, 180, 'Veri Hazır (ST / IRQ)'), id: 'led_strobe' },
      { ...createComponentInstance('ledBar4', 400, 70, 'ASCII D0-D3 Veri Yolu'), id: 'bar_ascii' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'btn_ack', fromPinId: 'btn_ack_out', toCompId: 'kbd_unit', toPinId: 'kbd_unit_inClr', value: 0 },
      { id: 'w2', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outStrobe', toCompId: 'led_strobe', toPinId: 'led_strobe_in', value: 1 },
      { id: 'w3', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD0', toCompId: 'hex_ascii', toPinId: 'hex_ascii_inD0', value: 1 },
      { id: 'w4', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD1', toCompId: 'hex_ascii', toPinId: 'hex_ascii_inD1', value: 0 },
      { id: 'w5', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD2', toCompId: 'hex_ascii', toPinId: 'hex_ascii_inD2', value: 0 },
      { id: 'w6', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD3', toCompId: 'hex_ascii', toPinId: 'hex_ascii_inD3', value: 0 },
      { id: 'w7', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD0', toCompId: 'bar_ascii', toPinId: 'bar_ascii_in0', value: 1 },
      { id: 'w8', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD1', toCompId: 'bar_ascii', toPinId: 'bar_ascii_in1', value: 0 },
      { id: 'w9', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD2', toCompId: 'bar_ascii', toPinId: 'bar_ascii_in2', value: 0 },
      { id: 'w10', fromCompId: 'kbd_unit', fromPinId: 'kbd_unit_outD3', toCompId: 'bar_ascii', toPinId: 'bar_ascii_in3', value: 0 },
    ],
  },
  {
    id: 'rgb_matrix_gpu_painter',
    name: '16x16 RGB VRAM Renkli Video Ekranı Kiti',
    category: 'music_graphics',
    description: 'X ve Y koordinat sayaçları, RGB renk seçici ve Yazma İzni (WE) ile 256 piksellik renkli grafik ekranına çizim yapan GPU gösterim devresi.',
    components: [
      { ...createComponentInstance('clock', 40, 60, 'Piksel Saati (CLK)'), id: 'clk_gpu', state: { frequencyHz: 8 } },
      { ...createComponentInstance('counter4', 180, 60, 'X-Koordinat Sayacı'), id: 'cnt_x' },
      (() => {
        const notC = createComponentInstance('not', 310, 140, 'Satır İlerleme (NOT)');
        notC.id = 'not_y';
        if (notC.outputs[0]) notC.outputs[0].value = 1;
        return notC;
      })(),
      (() => {
        const cntC = createComponentInstance('counter4', 180, 240, 'Y-Koordinat Sayacı');
        cntC.id = 'cnt_y';
        if (cntC.inputs[0]) cntC.inputs[0].value = 1;
        cntC.state.lastClk = 1;
        cntC.state.count = 0;
        return cntC;
      })(),
      { ...createComponentInstance('vcc', 40, 340, 'Yazma İzni (WE=1)'), id: 'vcc_we' },
      { ...createComponentInstance('switch', 40, 410, 'Kırmızı Renk (R)'), id: 'sw_r', state: { on: true } },
      { ...createComponentInstance('switch', 40, 480, 'Yeşil Renk (G)'), id: 'sw_g', state: { on: false } },
      { ...createComponentInstance('switch', 40, 550, 'Mavi Renk (B)'), id: 'sw_b', state: { on: true } },
      { ...createComponentInstance('rgbMatrix16x16', 500, 60, '16x16 RGB Video Matrisi'), id: 'gpu_screen' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'clk_gpu', fromPinId: 'clk_gpu_out', toCompId: 'cnt_x', toPinId: 'cnt_x_inClk', value: 0 },
      { id: 'w2', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ0', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX0', value: 0 },
      { id: 'w3', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ1', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX1', value: 0 },
      { id: 'w4', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ2', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX2', value: 0 },
      { id: 'w5', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ3', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX3', value: 0 },
      { id: 'w6', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ3', toCompId: 'not_y', toPinId: 'not_y_in', value: 0 },
      { id: 'w7', fromCompId: 'not_y', fromPinId: 'not_y_out', toCompId: 'cnt_y', toPinId: 'cnt_y_inClk', value: 1 },
      { id: 'w8', fromCompId: 'cnt_y', fromPinId: 'cnt_y_outQ0', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inY0', value: 0 },
      { id: 'w9', fromCompId: 'cnt_y', fromPinId: 'cnt_y_outQ1', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inY1', value: 0 },
      { id: 'w10', fromCompId: 'cnt_y', fromPinId: 'cnt_y_outQ2', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inY2', value: 0 },
      { id: 'w11', fromCompId: 'cnt_y', fromPinId: 'cnt_y_outQ3', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inY3', value: 0 },
      { id: 'w12', fromCompId: 'vcc_we', fromPinId: 'vcc_we_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inWE', value: 1 },
      { id: 'w13', fromCompId: 'sw_r', fromPinId: 'sw_r_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inR', value: 1 },
      { id: 'w14', fromCompId: 'sw_g', fromPinId: 'sw_g_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inG', value: 0 },
      { id: 'w15', fromCompId: 'sw_b', fromPinId: 'sw_b_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inB', value: 1 },
    ],
  },
  busSplitJoinPreset(),
  busAluPreset(),
  busSignExtendPreset(),
  busBitSelectorPreset(),
  busTriStatePreset(),
];

export const CIRCUIT_PRESETS: CircuitPreset[] = RAW_CIRCUIT_PRESETS.map((preset) => ({
  ...preset,
  components: preset.components.map((c) =>
    POWER_UP_X_TYPES.has(c.type) ? { ...c, outputs: c.outputs.map((p) => ({ ...p, value: 'X' as SignalValue })) } : c
  ),
  wires: repairWires(preset.wires, preset.components),
}));

/**
 * Standard 7-Segment Hex Truth Table Lookup
 */
export const HEX_7SEG_MAP: Record<number, { a: boolean; b: boolean; c: boolean; d: boolean; e: boolean; f: boolean; g: boolean }> = {
  0:  { a: true,  b: true,  c: true,  d: true,  e: true,  f: true,  g: false },
  1:  { a: false, b: true,  c: true,  d: false, e: false, f: false, g: false },
  2:  { a: true,  b: true,  c: false, d: true,  e: true,  f: false, g: true  },
  3:  { a: true,  b: true,  c: true,  d: true,  e: false, f: false, g: true  },
  4:  { a: false, b: true,  c: true,  d: false, e: false, f: true,  g: true  },
  5:  { a: true,  b: false, c: true,  d: true,  e: false, f: true,  g: true  },
  6:  { a: true,  b: false, c: true,  d: true,  e: true,  f: true,  g: true  },
  7:  { a: true,  b: true,  c: true,  d: false, e: false, f: false, g: false },
  8:  { a: true,  b: true,  c: true,  d: true,  e: true,  f: true,  g: true  },
  9:  { a: true,  b: true,  c: true,  d: true,  e: false, f: true,  g: true  },
  10: { a: true,  b: true,  c: true,  d: false, e: true,  f: true,  g: true  }, // A
  11: { a: false, b: false, c: true,  d: true,  e: true,  f: true,  g: true  }, // b
  12: { a: true,  b: false, c: false, d: true,  e: true,  f: true,  g: false }, // C
  13: { a: false, b: true,  c: true,  d: true,  e: true,  f: false, g: true  }, // d
  14: { a: true,  b: false, c: false, d: true,  e: true,  f: true,  g: true  }, // E
  15: { a: true,  b: false, c: false, d: false, e: true,  f: true,  g: true  }, // F
};

// What Logisim's hex digit shows for an undefined input: a dash
export const HEX_7SEG_DASH = { a: false, b: false, c: false, d: false, e: false, f: false, g: true };

/**
 * 16-Tone Programmable Chiptune Musical Scale Table (Do-Re-Mi / Hz)
 */
export const CHIPTUNE_NOTE_FREQS: Record<number, number> = {
  0: 261.63,  // C4 (Do)
  1: 293.66,  // D4 (Re)
  2: 329.63,  // E4 (Mi)
  3: 349.23,  // F4 (Fa)
  4: 392.00,  // G4 (Sol)
  5: 440.00,  // A4 (La)
  6: 493.88,  // B4 (Si)
  7: 523.25,  // C5 (İnce Do)
  8: 587.33,  // D5 (İnce Re)
  9: 659.25,  // E5 (İnce Mi)
  10: 698.46, // F5 (İnce Fa)
  11: 783.99, // G5 (İnce Sol)
  12: 880.00, // A5 (İnce La)
  13: 987.77, // B5 (İnce Si)
  14: 1046.50,// C6 (Tiz Do)
  15: 0,      // Sessiz / Mute
};

export const CHIPTUNE_NOTE_NAMES: Record<number, string> = {
  0: 'C4 (Do)',
  1: 'D4 (Re)',
  2: 'E4 (Mi)',
  3: 'F4 (Fa)',
  4: 'G4 (Sol)',
  5: 'A4 (La)',
  6: 'B4 (Si)',
  7: 'C5 (Do)',
  8: 'D5 (Re)',
  9: 'E5 (Mi)',
  10: 'F5 (Fa)',
  11: 'G5 (Sol)',
  12: 'A5 (La)',
  13: 'B5 (Si)',
  14: 'C6',
  15: 'Sessiz',
};

/**
 * Recursively trace boolean algebraic expressions backwards from an output pin to input switches
 */
/**
 * Names of the input switches/buttons as they appear in formulas and truth tables. A part keeps its own
 * label when that label is unique and not the default one; the others become A, B, C ... (otherwise every
 * fresh switch is called "Giriş Anahtarı" and formulas read "Giriş Anahtarı · Giriş Anahtarı").
 */
export function getInputSignalNames(components: CircuitComponentInstance[]): Map<string, string> {
  const inputs = components.filter((c) => c.type === 'switch' || c.type === 'pushbutton');
  const defaults = new Set([COMPONENT_CATALOG.switch.name, COMPONENT_CATALOG.pushbutton.name, '']);
  const count = new Map<string, number>();
  for (const c of inputs) {
    const l = (c.label || '').trim();
    count.set(l, (count.get(l) || 0) + 1);
  }
  const keepsLabel = (c: CircuitComponentInstance) => {
    const l = (c.label || '').trim();
    return !defaults.has(l) && count.get(l) === 1;
  };
  const used = new Set(inputs.filter(keepsLabel).map((c) => (c.label || '').trim()));
  let letter = 0;
  const names = new Map<string, string>();
  for (const c of inputs) {
    if (keepsLabel(c)) {
      names.set(c.id, (c.label || '').trim());
      continue;
    }
    let name = '';
    do {
      name = letter < 26 ? String.fromCharCode(65 + letter) : `X${letter - 25}`;
      letter++;
    } while (used.has(name));
    used.add(name);
    names.set(c.id, name);
  }
  return names;
}

// Longest expression kept inline; deeper cones (e.g. a ripple carry built from gates, whose text doubles
// per stage) fall back to the driving part's name instead of growing without bound
const MAX_EXPR_LENGTH = 240;

// A cone that reaches a wide (multi-bit) signal has no single-bit formula: such an output gets no
// expression (the truth table still gives every bit its minimal SOP). Not '?', which the tri-state
// formula uses as its condition operator.
const OPAQUE_EXPR = '\u0000';
// A gate none of whose inputs has a driver has no formula at all (Logisim's ExpressionComputer leaves
// its output out); a gate reading it skips that input like an open one
const NO_EXPR = '\u0001';
// Gates that ignore inputs without a driver, like Logisim's analyzer
const SKIP_OPEN_INPUT_GATES = new Set(['and', 'or', 'nand', 'nor', 'xor', 'xnor']);
const isWidePin = (p: CircuitPin | undefined) => (p?.width ?? 1) > 1;
// Parts whose bits are only meaningful as a bus: their outputs are not single-bit formulas
const BUS_ONLY_TYPES = new Set(['splitter', 'bitExtender', 'bitSelector']);

interface BooleanExprContext {
  driverOf: (pinId: string) => { comp: CircuitComponentInstance; outIdx: number } | null;
  byId: Map<string, CircuitComponentInstance>;
  inputNames: Map<string, string>;
  memo: Map<string, string>;
}

// Net map built once per circuit: every pin's driving output (tunnels excluded, like the old per-call search)
function createBooleanExprContext(components: CircuitComponentInstance[], wires: CircuitWire[]): BooleanExprContext {
  const parent = new Map<string, string>();
  const findR = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let c = k;
    while (c !== parent.get(c)) {
      const p = parent.get(c)!;
      parent.set(c, parent.get(p)!);
      c = p;
    }
    return c;
  };
  const unite = (a: string, b: string) => {
    const ra = findR(a);
    const rb = findR(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  components.forEach((c) => {
    [...c.inputs, ...c.outputs].forEach((p) => {
      unite(p.id, `loc_${Math.round(p.x / 10) * 10}_${Math.round(p.y / 10) * 10}`);
    });
  });
  wires.forEach((w) => {
    if (w.fromPinId && w.toPinId) unite(w.fromPinId, w.toPinId);
    if (w.startPoint && w.endPoint) {
      const ks = `loc_${Math.round(w.startPoint.x / 10) * 10}_${Math.round(w.startPoint.y / 10) * 10}`;
      const ke = `loc_${Math.round(w.endPoint.x / 10) * 10}_${Math.round(w.endPoint.y / 10) * 10}`;
      unite(ks, ke);
      if (w.fromPinId) unite(w.fromPinId, ks);
      if (w.toPinId) unite(w.toPinId, ke);
    }
  });
  const driverByRoot = new Map<string, { comp: CircuitComponentInstance; outIdx: number }>();
  for (const c of components) {
    if (c.type === 'tunnel') continue;
    c.outputs.forEach((o, idx) => {
      const r = findR(o.id);
      if (!driverByRoot.has(r)) driverByRoot.set(r, { comp: c, outIdx: idx });
    });
  }
  return {
    driverOf: (pinId) => driverByRoot.get(findR(pinId)) || null,
    byId: new Map(components.map((c) => [c.id, c])),
    inputNames: getInputSignalNames(components),
    memo: new Map(),
  };
}

function booleanExprOf(
  compId: string,
  pinIndex: number | undefined,
  ctx: BooleanExprContext,
  visited: Set<string>
): string {
  const comp = ctx.byId.get(compId);
  if (!comp) return '?';

  if (comp.type === 'switch' || comp.type === 'pushbutton') {
    if (isWidePin(comp.outputs[0])) return OPAQUE_EXPR;
    return ctx.inputNames.get(comp.id) || (comp.type === 'switch' ? 'SW' : 'BTN');
  }
  if (comp.type === 'vcc') return '1';
  if (comp.type === 'gnd') return '0';
  if (comp.type === 'constant') return isWidePin(comp.outputs[0]) ? OPAQUE_EXPR : String((comp.state.constValue ?? 1) % 2);
  if (comp.type === 'clock') return 'CLK';

  if (comp.type === 'led' || comp.type === 'probe' || comp.type === 'buzzer') {
    const inPin = comp.inputs[0];
    if (!inPin) return '?';
    if (isWidePin(inPin)) return OPAQUE_EXPR;
    const driver = ctx.driverOf(inPin.id);
    if (!driver) return '0';
    if (visited.has(comp.id)) return '...';
    const nextVisited = new Set(visited);
    nextVisited.add(comp.id);
    return booleanExprOf(driver.comp.id, driver.outIdx, ctx, nextVisited);
  }

  if (visited.has(comp.id)) return '...';
  if (
    BUS_ONLY_TYPES.has(comp.type) ||
    (pinIndex !== undefined && isWidePin(comp.outputs[pinIndex])) ||
    comp.inputs.some(isWidePin)
  ) {
    return OPAQUE_EXPR;
  }
  // A cone without feedback has the same text whichever path reached it, so it is computed once
  const memoKey = `${comp.id}#${pinIndex ?? ''}`;
  const cached = ctx.memo.get(memoKey);
  if (cached !== undefined) return cached;
  const newVisited = new Set(visited);
  newVisited.add(comp.id);

  let hitLoop = false;
  // Formula of an input; null when nothing drives it (or its driver has no formula)
  const traceInput = (inputPinId: string): string | null => {
    const driver = ctx.driverOf(inputPinId);
    if (!driver) return null;
    const e = booleanExprOf(driver.comp.id, driver.outIdx, ctx, newVisited);
    if (e.includes('...')) hitLoop = true;
    return e === NO_EXPR ? null : e;
  };

  const negated = comp.state.negated ?? [];
  const traced = comp.inputs.map((p, i) => {
    const e = traceInput(p.id);
    return e !== null && negated.includes(i) ? (/^[A-Za-z0-9_]+$/.test(e) ? `${e}'` : `(${e})'`) : e;
  });
  let inputExprs: string[];
  if (SKIP_OPEN_INPUT_GATES.has(comp.type)) {
    // Like the simulator (and Logisim), a gate leaves inputs without a driver out
    inputExprs = traced.filter((e): e is string => e !== null);
    if (inputExprs.length === 0) return NO_EXPR;
    // "Exactly one 1" over three or more inputs is no XOR chain (Logisim's analyzer refuses it too)
    if ((comp.type === 'xor' || comp.type === 'xnor') && comp.state.xorMode === 'one' && inputExprs.length > 2) return OPAQUE_EXPR;
  } else if ((comp.type === 'not' || comp.type === 'buffer') && traced[0] === null) {
    return NO_EXPR;
  } else {
    // Other parts read a fixed level (or x) on an open input; a driver without a formula hides the cone
    if (traced.some((e, i) => e === null && ctx.driverOf(comp.inputs[i].id))) return OPAQUE_EXPR;
    inputExprs = traced.map((e) => e ?? '0');
  }
  if (inputExprs.some((e) => e.includes(OPAQUE_EXPR))) return OPAQUE_EXPR;

  let result: string;
  switch (comp.type) {
    case 'not':
      result = inputExprs[0].length === 1 ? `${inputExprs[0]}'` : `(${inputExprs[0]})'`;
      break;
    case 'buffer':
      result = inputExprs[0];
      break;
    case 'and':
      if (inputExprs.length === 0) result = '0';
      else if (inputExprs.length === 1) result = inputExprs[0];
      else result = inputExprs.map((e) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e)).join(' · ');
      break;
    case 'or':
      result = inputExprs.join(' + ');
      break;
    case 'nand':
      result = `(${inputExprs.map((e) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e)).join(' · ')})'`;
      break;
    case 'nor':
      result = `(${inputExprs.join(' + ')})'`;
      break;
    case 'xor':
      result = inputExprs.map((e) => (e.includes('+') ? `(${e})` : e)).join(' ⊕ ');
      break;
    case 'xnor':
      result = `(${inputExprs.map((e) => (e.includes('+') ? `(${e})` : e)).join(' ⊕ ')})'`;
      break;
    case 'halfAdder':
      result = pinIndex === 1 ? `(${inputExprs[0]} · ${inputExprs[1]})` : `(${inputExprs[0]} ⊕ ${inputExprs[1]})`;
      break;
    case 'fullAdder':
      result =
        pinIndex === 1
          ? `(${inputExprs[0]}·${inputExprs[1]} + ${inputExprs[2]}·(${inputExprs[0]}⊕${inputExprs[1]}))`
          : `(${inputExprs[0]} ⊕ ${inputExprs[1]} ⊕ ${inputExprs[2]})`;
      break;
    case 'halfSubtractor':
      result = pinIndex === 1 ? `(${inputExprs[0]}' · ${inputExprs[1]})` : `(${inputExprs[0]} ⊕ ${inputExprs[1]})`;
      break;
    case 'fullSubtractor':
      result =
        pinIndex === 1
          ? `(${inputExprs[0]}'·${inputExprs[1]} + (${inputExprs[0]}⊕${inputExprs[1]})'·${inputExprs[2]})`
          : `(${inputExprs[0]} ⊕ ${inputExprs[1]} ⊕ ${inputExprs[2]})`;
      break;
    case 'mux2':
      result = `(${inputExprs[2]}'·${inputExprs[0]} + ${inputExprs[2]}·${inputExprs[1]})`;
      break;
    case 'demux2':
      result = pinIndex === 1 ? `(${inputExprs[0]} · ${inputExprs[1]})` : `(${inputExprs[0]} · ${inputExprs[1]}')`;
      break;
    case 'triState':
      result = `(${inputExprs[1]} ? ${inputExprs[0]} : Z)`;
      break;
    case 'controlledInverter':
      result = `(${inputExprs[1]} ? ${inputExprs[0].length === 1 ? `${inputExprs[0]}'` : `(${inputExprs[0]})'`} : Z)`;
      break;
    default:
      return `${comp.label || comp.type}`;
  }
  if (result.length > MAX_EXPR_LENGTH) result = `${comp.label || comp.type}`;
  // Text that cut a feedback loop depends on where the loop was entered, so it is not reused
  if (!hitLoop) ctx.memo.set(memoKey, result);
  return result;
}

export function generateBooleanExpression(
  compId: string,
  pinIndex: number | undefined,
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): string {
  const expr = booleanExprOf(compId, pinIndex, createBooleanExprContext(components, wires), new Set());
  return expr.includes(OPAQUE_EXPR) || expr === NO_EXPR ? '?' : expr;
}

// Observable outputs of a circuit: LEDs, probes, buzzers and every output pin of the logic parts
// (splitter ends and tunnels excluded: they only re-route bits that are already shown elsewhere)
function getObservableOutputs(components: CircuitComponentInstance[]) {
  const outputList: { id: string; name: string; compId: string; pinIndex?: number; width: number }[] = [];
  components.forEach((c) => {
    if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
      outputList.push({
        id: c.id,
        name: c.label || (c.type === 'led' ? 'LED' : c.type === 'buzzer' ? 'Buzzer' : 'Prob'),
        compId: c.id,
        width: c.inputs[0]?.width ?? 1,
      });
    } else if (
      c.outputs.length > 0 &&
      c.type !== 'switch' &&
      c.type !== 'pushbutton' &&
      c.type !== 'clock' &&
      c.type !== 'vcc' &&
      c.type !== 'gnd' &&
      c.type !== 'constant' &&
      c.type !== 'dipSwitch4' &&
      c.type !== 'asciiKeyboard' &&
      c.type !== 'dotMatrix8x8' &&
      c.type !== 'rgbMatrix16x16' &&
      c.type !== 'textLabel' &&
      c.type !== 'splitter' &&
      c.type !== 'tunnel'
    ) {
      c.outputs.forEach((pin, pIdx) => {
        outputList.push({
          id: pin.id,
          name: `${c.label || c.type}.${pin.name}`,
          compId: c.id,
          pinIndex: pIdx,
          width: pin.width ?? 1,
        });
      });
    }
  });
  // Names key the expression maps and label the table columns, so two LEDs both called "LED" get "LED (2)"
  const seen = new Map<string, number>();
  outputList.forEach((o) => {
    const k = (seen.get(o.name) || 0) + 1;
    seen.set(o.name, k);
    if (k > 1) o.name = `${o.name} (${k})`;
  });
  return outputList;
}

/**
 * Boolean expression of every observable output, keyed by output name. Needs no simulation, so the
 * canvas formula HUD can use it without building the whole truth table. Outputs wider than 1 bit, and
 * single bits whose cone reaches a bus, have no single formula and are left out.
 */
export function generateBooleanExpressions(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): { [outputName: string]: string } {
  const ctx = createBooleanExprContext(components, wires);
  const booleanExpressions: { [outputName: string]: string } = {};
  getObservableOutputs(components).forEach((out) => {
    if (out.width > 1) return;
    const expr = booleanExprOf(out.compId, out.pinIndex, ctx, new Set());
    if (expr && expr !== '?' && expr !== '0' && expr !== NO_EXPR && !expr.includes(OPAQUE_EXPR)) {
      booleanExpressions[out.name] = expr;
    }
  });
  return booleanExpressions;
}

// Input bits a truth table sweeps (2^8 = 256 rows; Logisim-evolution allows 20) and the most it minimises
export const MAX_TRUTH_TABLE_INPUT_BITS = 8;
export const MAX_MINIMIZE_INPUT_BITS = 6;

// Bit width of an input source as the truth table drives it (a push button is always 1 bit)
const truthInputWidth = (c: CircuitComponentInstance) => (c.type === 'switch' ? c.outputs[0]?.width ?? 1 : 1);

// Bit `bit` of an input source's current value
const truthInputBit = (c: CircuitComponentInstance, bit: number): 0 | 1 =>
  truthInputWidth(c) > 1 ? ((Math.floor((c.state.inputValue ?? 0) / 2 ** bit) % 2) as 0 | 1) : c.state.on ? 1 : 0;

/**
 * Sets input sources to the bits of one truth-table row. `values` follows `columns` (one entry per bit,
 * MSB first within a part); parts not in `columns` are left as they are.
 */
export function applyTruthTableInputs(
  components: CircuitComponentInstance[],
  columns: TruthTableData['inputs'],
  values: (SignalValue | number)[]
): CircuitComponentInstance[] {
  const byComp = new Map<string, { bit: number; v: 0 | 1 }[]>();
  columns.forEach((col, k) => {
    if (!col.compId || k >= values.length) return;
    const list = byComp.get(col.compId) || [];
    list.push({ bit: col.bit ?? 0, v: values[k] === 1 ? 1 : 0 });
    byComp.set(col.compId, list);
  });
  return components.map((c) => {
    const bits = byComp.get(c.id);
    if (!bits) return c;
    if (truthInputWidth(c) > 1) {
      let n = c.state.inputValue ?? 0;
      for (const { bit, v } of bits) n += (v - (Math.floor(n / 2 ** bit) % 2)) * 2 ** bit;
      return { ...c, state: { ...c.state, inputValue: n } };
    }
    return { ...c, state: { ...c.state, on: bits[0].v === 1 } };
  });
}

/**
 * Automatically compute Truth Table (2^N combinations) for canvas circuit. Like Logisim-evolution's
 * Analyze.computeTable, a wide input or output is one column per bit, MSB first.
 */
export function generateTruthTable(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): TruthTableData | null {
  // 1. Identify input switches & buttons
  const switchComps = components.filter((c) => c.type === 'switch' || c.type === 'pushbutton');
  if (switchComps.length === 0) return null;

  // 2. Identify observable outputs (LEDs, Probes, Buzzer, or output pins of gates/blocks)
  const outputList = getObservableOutputs(components);

  if (outputList.length === 0) return null;

  const inputNames = getInputSignalNames(components);
  const nameOf = (s: CircuitComponentInstance) => inputNames.get(s.id) || 'Giriş';

  // Whole parts, in canvas order, while their bits fit; a part that does not fit and every part after
  // it keep their current value
  const activeSwitches: CircuitComponentInstance[] = [];
  let inputBits = 0;
  for (const s of switchComps) {
    const w = truthInputWidth(s);
    if (inputBits + w > MAX_TRUTH_TABLE_INPUT_BITS) break;
    activeSwitches.push(s);
    inputBits += w;
  }

  const inputColumns: TruthTableData['inputs'] = [];
  activeSwitches.forEach((s) => {
    const w = truthInputWidth(s);
    const name = nameOf(s);
    for (let b = w - 1; b >= 0; b--) {
      inputColumns.push(
        w > 1
          ? { id: `${s.id}#${b}`, name: `${name}[${b}]`, compId: s.id, bit: b, group: name, width: w }
          : { id: s.id, name, compId: s.id, bit: 0 }
      );
    }
  });
  const outputColumns: TruthTableData['outputs'] = [];
  outputList.forEach((o) => {
    for (let b = o.width - 1; b >= 0; b--) {
      outputColumns.push(
        o.width > 1
          ? { id: `${o.id}#${b}`, name: `${o.name}[${b}]`, compId: o.compId, bit: b, group: o.name, width: o.width }
          : { id: o.id, name: o.name, compId: o.compId, bit: 0 }
      );
    }
  });

  const notes: string[] = [];
  const restSwitches = switchComps.slice(activeSwitches.length);
  if (restSwitches.length > 0) {
    notes.push(
      `Tabloya en fazla ${MAX_TRUTH_TABLE_INPUT_BITS} giriş biti alınabilir; ${restSwitches
        .map((s) => (truthInputWidth(s) > 1 ? `${nameOf(s)} (${truthInputWidth(s)} bit)` : nameOf(s)))
        .join(', ')} şu anki değerinde sabit tutuldu.`
    );
  }
  if (inputColumns.length === 0) {
    return { inputs: [], outputs: outputColumns, rows: [], notes };
  }

  const numCombinations = Math.pow(2, inputColumns.length);
  const rows: TruthTableData['rows'] = [];

  // Determine current live inputs
  const switchById = new Map(activeSwitches.map((s) => [s.id, s]));
  const currentInputs = inputColumns.map((col) => truthInputBit(switchById.get(col.compId!)!, col.bit ?? 0));

  for (let i = 0; i < numCombinations; i++) {
    // Generate binary representation
    const inputVals: SignalValue[] = [];
    for (let bit = inputColumns.length - 1; bit >= 0; bit--) {
      inputVals.push(((i >> bit) & 1) as SignalValue);
    }

    // Clone components with new input switch states
    const testComps = applyTruthTableInputs(components, inputColumns, inputVals);

    const sim = simulateCircuit(testComps, wires);
    const simById = new Map(sim.components.map((c) => [c.id, c]));

    // Read outputs like Logisim-evolution's Analyze.computeTable: an oscillating row is '@' in
    // every column, E is a conflict, X / Z are don't cares
    const outputVals: TruthTableEntry[] = [];
    outputList.forEach((out) => {
      const found = simById.get(out.compId);
      let pin: CircuitPin | undefined;
      if (found && (found.type === 'led' || found.type === 'probe' || found.type === 'buzzer')) {
        pin = found.inputs[0];
      } else if (found && out.pinIndex !== undefined) {
        pin = found.outputs[out.pinIndex];
      }
      for (let b = out.width - 1; b >= 0; b--) {
        if (sim.oscillating) {
          outputVals.push('@');
          continue;
        }
        const v = out.width > 1 ? pin?.bits?.[b] : pin?.value;
        outputVals.push(v === 1 ? 1 : v === 0 ? 0 : v === 'E' ? 'E' : '-');
      }
    });

    const isCurrent = inputVals.every((v, idx) => v === currentInputs[idx]);

    rows.push({
      inputValues: inputVals,
      outputValues: outputVals,
      isCurrentState: isCurrent,
    });
  }

  // Extract Boolean algebraic expression for each output
  const booleanExpressions = generateBooleanExpressions(components, wires);

  // Extract minimal SOP expressions via Quine-McCluskey
  const minimalExpressions: {
    [outputName: string]: {
      expression: string;
      primeImplicants: string[];
      essentialImplicants: string[];
    };
  } = {};

  if (inputColumns.length <= MAX_MINIMIZE_INPUT_BITS) {
    const varNames = inputColumns.map((c) => c.name);
    outputColumns.forEach((out, outIdx) => {
      const { minterms, dontCares } = truthTableColumnTerms(rows, outIdx);
      minimalExpressions[out.name] = minimizeBooleanExpression(varNames, minterms, dontCares);
    });
  } else {
    notes.push(
      `Tabloda ${inputColumns.length} giriş biti var; en sade ifade (Quine-McCluskey) ve Karnaugh haritası en fazla ${MAX_MINIMIZE_INPUT_BITS} bit için hesaplanır.`
    );
  }

  const stateful = components.filter(
    (c) => COMPONENT_CATALOG[c.type]?.category === 'sequential' && c.type !== 'rom16x4'
  );
  if (stateful.length > 0) {
    notes.push(
      `Devrede bellek elemanı var (${stateful.map((c) => c.label || c.type).slice(0, 3).join(', ')}${
        stateful.length > 3 ? '…' : ''
      }): çıkışlar, elemanların şu anki iç durumu için hesaplandı.`
    );
  }

  return {
    inputs: inputColumns,
    outputs: outputColumns,
    booleanExpressions,
    minimalExpressions,
    rows,
    notes,
  };
}

/**
 * Minterms and don't cares of one truth-table output column. Like Logisim-evolution's
 * Implicant.computeMinimal, every cell that is not 0 or 1 ('-', 'E', '@') is a don't care.
 */
export function truthTableColumnTerms(
  rows: TruthTableData['rows'],
  outIdx: number
): { minterms: number[]; dontCares: number[] } {
  const minterms: number[] = [];
  const dontCares: number[] = [];
  rows.forEach((r, rIdx) => {
    const v = r.outputValues[outIdx];
    if (v === 1) minterms.push(rIdx);
    else if (v !== 0) dontCares.push(rIdx);
  });
  return { minterms, dontCares };
}

/**
 * Quine-McCluskey algorithmic minimization for up to 6 variables
 * Computes Prime Implicants, Essential Prime Implicants, and minimal Sum of Products (SOP).
 */
export function minimizeBooleanExpression(
  varNames: string[],
  minterms: number[],
  dontCares: number[] = []
): {
  expression: string;
  primeImplicants: string[];
  essentialImplicants: string[];
} {
  const n = varNames.length;
  if (n === 0) return { expression: '0', primeImplicants: [], essentialImplicants: [] };
  if (minterms.length === 0) return { expression: '0', primeImplicants: [], essentialImplicants: [] };
  const allTerms = Array.from(new Set([...minterms, ...dontCares]));
  if (allTerms.length === Math.pow(2, n)) {
    return { expression: '1', primeImplicants: ['1'], essentialImplicants: ['1'] };
  }

  let terms = allTerms.map((m) => ({
    mask: m.toString(2).padStart(n, '0'),
    minterms: [m],
    combined: false,
  }));

  const primeImplicants: { mask: string; minterms: number[] }[] = [];

  while (terms.length > 0) {
    const groups: { [weight: number]: typeof terms } = {};
    for (let i = 0; i <= n; i++) groups[i] = [];
    for (const t of terms) {
      const ones = (t.mask.match(/1/g) || []).length;
      groups[ones].push(t);
    }

    const nextTermsMap = new Map<string, { mask: string; minterms: number[]; combined: boolean }>();
    let anyCombined = false;

    for (let w = 0; w < n; w++) {
      const grp1 = groups[w] || [];
      const grp2 = groups[w + 1] || [];

      for (const t1 of grp1) {
        for (const t2 of grp2) {
          let diffCount = 0;
          let diffIdx = -1;
          for (let k = 0; k < n; k++) {
            if (t1.mask[k] !== t2.mask[k]) {
              if (t1.mask[k] === '-' || t2.mask[k] === '-') {
                diffCount = 999;
                break;
              }
              diffCount++;
              diffIdx = k;
            }
          }

          if (diffCount === 1) {
            t1.combined = true;
            t2.combined = true;
            anyCombined = true;
            const newMask = t1.mask.substring(0, diffIdx) + '-' + t1.mask.substring(diffIdx + 1);
            if (!nextTermsMap.has(newMask)) {
              const combinedMinterms = Array.from(new Set([...t1.minterms, ...t2.minterms])).sort(
                (a, b) => a - b
              );
              nextTermsMap.set(newMask, {
                mask: newMask,
                minterms: combinedMinterms,
                combined: false,
              });
            }
          }
        }
      }
    }

    for (const t of terms) {
      if (!t.combined) {
        if (!primeImplicants.some((pi) => pi.mask === t.mask)) {
          primeImplicants.push({ mask: t.mask, minterms: t.minterms });
        }
      }
    }

    if (!anyCombined) break;
    terms = Array.from(nextTermsMap.values());
  }

  const targetMinterms = minterms.slice().sort((a, b) => a - b);

  function covers(mask: string, minterm: number) {
    const bin = minterm.toString(2).padStart(n, '0');
    for (let i = 0; i < n; i++) {
      if (mask[i] !== '-' && mask[i] !== bin[i]) return false;
    }
    return true;
  }

  const essentialPIs: typeof primeImplicants = [];
  const coveredMinterms = new Set<number>();

  for (const m of targetMinterms) {
    const covering = primeImplicants.filter((pi) => covers(pi.mask, m));
    if (covering.length === 1) {
      const epi = covering[0];
      if (!essentialPIs.some((e) => e.mask === epi.mask)) {
        essentialPIs.push(epi);
        for (const cm of targetMinterms) {
          if (covers(epi.mask, cm)) coveredMinterms.add(cm);
        }
      }
    }
  }

  const remainingMinterms = targetMinterms.filter((m) => !coveredMinterms.has(m));
  const chosenPIs = [...essentialPIs];

  // Exact cover of what the essentials leave: branch on the uncovered minterm with the fewest candidate PIs,
  // prune by the best term count so far (ties: fewer literals). A greedy "covers most" pick is not minimal
  // (about 2% of random 4-variable functions got an extra term or literals).
  if (remainingMinterms.length > 0) {
    const nonEssentialPIs = primeImplicants.filter(
      (pi) => !essentialPIs.some((e) => e.mask === pi.mask) && remainingMinterms.some((m) => covers(pi.mask, m))
    );
    const literals = (pi: { mask: string }) => pi.mask.split('').filter((ch) => ch !== '-').length;
    const coverOf = new Map(nonEssentialPIs.map((pi) => [pi, new Set(remainingMinterms.filter((m) => covers(pi.mask, m)))]));
    const pisOf = new Map(remainingMinterms.map((m) => [m, nonEssentialPIs.filter((pi) => coverOf.get(pi)!.has(m))]));
    // Start from the greedy cover, so the search only has to beat it
    let best: typeof primeImplicants = [];
    {
      let left = [...remainingMinterms];
      while (left.length > 0) {
        let top = nonEssentialPIs[0];
        let topN = -1;
        for (const pi of nonEssentialPIs) {
          const k = left.filter((m) => coverOf.get(pi)!.has(m)).length;
          if (k > topN || (k === topN && literals(pi) < literals(top))) {
            top = pi;
            topN = k;
          }
        }
        best.push(top);
        left = left.filter((m) => !coverOf.get(top)!.has(m));
      }
    }
    let bestLits = best.reduce((sum, pi) => sum + literals(pi), 0);
    // Lower bound: minterms no single PI covers two of, each needs its own term
    const lowerBound = (uncovered: number[]) => {
      const chosen: number[] = [];
      for (const m of uncovered) {
        if (chosen.every((c) => !pisOf.get(m)!.some((pi) => coverOf.get(pi)!.has(c)))) chosen.push(m);
      }
      return chosen.length;
    };
    const pick: typeof primeImplicants = [];
    const search = (uncovered: number[], lits: number) => {
      if (uncovered.length === 0) {
        if (pick.length < best.length || (pick.length === best.length && lits < bestLits)) {
          best = [...pick];
          bestLits = lits;
        }
        return;
      }
      if (pick.length + lowerBound(uncovered) > best.length) return;
      let options = pisOf.get(uncovered[0])!;
      for (const m of uncovered) {
        const o = pisOf.get(m)!;
        if (o.length < options.length) options = o;
      }
      options = [...options].sort((x, y) => {
        const cx = uncovered.filter((m) => coverOf.get(x)!.has(m)).length;
        const cy = uncovered.filter((m) => coverOf.get(y)!.has(m)).length;
        return cy - cx || literals(x) - literals(y);
      });
      for (const pi of options) {
        pick.push(pi);
        search(
          uncovered.filter((m) => !coverOf.get(pi)!.has(m)),
          lits + literals(pi)
        );
        pick.pop();
      }
    };
    search(remainingMinterms, 0);
    chosenPIs.push(...best);
  }

  // Single letters are written side by side (AB'C); with longer input names ("Cin", "A0 (LSB)") that would be
  // unreadable, so the literals are joined with a dot
  const joiner = varNames.some((v) => v.length > 1) ? '·' : '';
  function maskToExpression(mask: string) {
    const lits: string[] = [];
    for (let i = 0; i < n; i++) {
      const bit = mask[i];
      const v = varNames[i] || `X${i}`;
      if (bit === '1') {
        lits.push(v);
      } else if (bit === '0') {
        lits.push(`${v}'`);
      }
    }
    return lits.length === 0 ? '1' : lits.join(joiner);
  }

  const termsExpr = chosenPIs.map((pi) => maskToExpression(pi.mask));
  const finalExpr = termsExpr.length > 0 ? termsExpr.join(' + ') : '0';

  return {
    expression: finalExpr,
    // A prime made only of don't cares covers no required 1, so it is not listed
    primeImplicants: primeImplicants
      .filter((pi) => targetMinterms.some((m) => covers(pi.mask, m)))
      .map((pi) => maskToExpression(pi.mask)),
    essentialImplicants: essentialPIs.map((pi) => maskToExpression(pi.mask)),
  };
}

export interface ASTNode {
  type: 'var' | 'not' | 'and' | 'or' | 'xor';
  name?: string;
  children?: ASTNode[];
  child?: ASTNode;
}

/**
 * Tokenize and parse a boolean algebraic expression into an AST
 * Supports:
 * - Literals / Variables: A, B, C, X1, etc.
 * - Infix OR: +, |
 * - Infix XOR: ^, ⊕
 * - Infix AND: *, ·, &, or adjacent terms (e.g. AB)
 * - Infix / Postfix NOT: A' or !A, ~A
 * - Parentheses: ( ... )
 */
export function parseBooleanExpression(rawExpr: string): ASTNode {
  let expr = rawExpr.trim();
  const eqIdx = expr.indexOf('=');
  if (eqIdx !== -1) {
    expr = expr.substring(eqIdx + 1).trim();
  }

  expr = expr
    .replace(/·/g, '*')
    .replace(/⊕/g, '^')
    .replace(/¬/g, '!')
    .replace(/\s+/g, ' ')
    .trim();

  type Token = { type: 'var' | 'op' | 'lparen' | 'rparen' | 'postnot'; value: string };
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    const ch = expr[i];
    if (ch === ' ') {
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(' });
      i++;
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')' });
      i++;
    } else if (ch === "'") {
      tokens.push({ type: 'postnot', value: "'" });
      i++;
    } else if (ch === '+' || ch === '^' || ch === '*' || ch === '&' || ch === '|' || ch === '!' || ch === '~') {
      tokens.push({ type: 'op', value: ch === '&' ? '*' : ch === '|' ? '+' : ch === '~' ? '!' : ch });
      i++;
    } else if (ch === '⊙') {
      tokens.push({ type: 'op', value: 'xnor' });
      i++;
    } else if (/[A-Za-z0-9_]/.test(ch)) {
      let word = '';
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) {
        word += expr[i];
        i++;
      }
      const kw = word.toUpperCase();
      if (kw === 'AND') tokens.push({ type: 'op', value: '*' });
      else if (kw === 'OR') tokens.push({ type: 'op', value: '+' });
      else if (kw === 'XOR') tokens.push({ type: 'op', value: '^' });
      else if (kw === 'XNOR') tokens.push({ type: 'op', value: 'xnor' });
      else if (kw === 'NOT') tokens.push({ type: 'op', value: '!' });
      else if (/^[A-Za-z]+$/.test(word)) {
        // Textbook notation: "AB'C" is A·B'·C (the K-map and truth table write their results this way);
        // names with digits/underscores (X1, IN_A) stay single variables
        for (const letter of word) tokens.push({ type: 'var', value: letter });
      } else if (/^[01]+$/.test(word)) {
        for (const digit of word) tokens.push({ type: 'var', value: digit });
      } else {
        tokens.push({ type: 'var', value: word });
      }
    } else {
      i++;
    }
  }

  const expandedTokens: Token[] = [];
  for (let j = 0; j < tokens.length; j++) {
    const cur = tokens[j];
    expandedTokens.push(cur);

    if (j < tokens.length - 1) {
      const next = tokens[j + 1];
      const curCanEnd = cur.type === 'var' || cur.type === 'rparen' || cur.type === 'postnot';
      const nextCanStart = next.type === 'var' || next.type === 'lparen' || (next.type === 'op' && next.value === '!');
      if (curCanEnd && nextCanStart) {
        expandedTokens.push({ type: 'op', value: '*' });
      }
    }
  }

  let pos = 0;

  function peek(): Token | undefined {
    return expandedTokens[pos];
  }

  function consume(expected?: string): Token {
    const t = expandedTokens[pos++];
    if (!t) throw new Error('Beklenmedik ifade sonu');
    if (expected && t.value !== expected) {
      throw new Error(`'${expected}' bekleniyordu, ancak '${t.value}' bulundu`);
    }
    return t;
  }

  function parseOr(): ASTNode {
    let node = parseXor();
    while (peek() && peek()!.type === 'op' && peek()!.value === '+') {
      consume('+');
      const right = parseXor();
      if (node.type === 'or' && node.children) {
        node.children.push(right);
      } else {
        node = { type: 'or', children: [node, right] };
      }
    }
    return node;
  }

  function parseXor(): ASTNode {
    let node = parseAnd();
    while (peek() && peek()!.type === 'op' && (peek()!.value === '^' || peek()!.value === 'xnor')) {
      const isXnor = consume().value === 'xnor';
      const right = parseAnd();
      if (isXnor) {
        node = { type: 'not', child: { type: 'xor', children: [node, right] } };
      } else if (node.type === 'xor' && node.children) {
        node.children.push(right);
      } else {
        node = { type: 'xor', children: [node, right] };
      }
    }
    return node;
  }

  function parseAnd(): ASTNode {
    let node = parseUnary();
    while (peek() && peek()!.type === 'op' && peek()!.value === '*') {
      consume('*');
      const right = parseUnary();
      if (node.type === 'and' && node.children) {
        node.children.push(right);
      } else {
        node = { type: 'and', children: [node, right] };
      }
    }
    return node;
  }

  function parseUnary(): ASTNode {
    if (peek() && peek()!.type === 'op' && peek()!.value === '!') {
      consume('!');
      const child = parseUnary();
      return { type: 'not', child };
    }
    return parsePostfix();
  }

  function parsePostfix(): ASTNode {
    let node = parsePrimary();
    while (peek() && peek()!.type === 'postnot') {
      consume("'");
      node = { type: 'not', child: node };
    }
    return node;
  }

  function parsePrimary(): ASTNode {
    const t = peek();
    if (!t) throw new Error('İfade bekleniyordu');

    if (t.type === 'var') {
      consume();
      return { type: 'var', name: t.value.toUpperCase() };
    }
    if (t.type === 'lparen') {
      consume('(');
      const inner = parseOr();
      consume(')');
      return inner;
    }
    throw new Error(`Geçersiz terim: '${t.value}'`);
  }

  return parseOr();
}

export interface SynthesisOptions {
  gateType?: 'standard' | 'nand' | 'nor';
  offsetX?: number;
  offsetY?: number;
  outputLabel?: string;
}

/**
 * Automatically layout and wire a digital circuit from a parsed Boolean AST.
 *
 * - standard: AND / OR / XOR / NOT gates (more than 5 operands are split over several gates)
 * - nand / nor: a real NAND-only / NOR-only network (NOT = NAND(a,a), OR = NAND(a',b'), XOR from 4 NANDs ...),
 *   not just the same gates renamed, which would change the function
 * The network is built first, then every gate is placed in the column of its logic level (inputs left,
 * output right) and stacked inside that column, so no two parts ever share a pin location.
 */
export function synthesizeCircuitFromBooleanExpression(
  rawExpr: string,
  options?: SynthesisOptions
): { components: CircuitComponentInstance[]; wires: CircuitWire[] } {
  const ast = parseBooleanExpression(rawExpr);
  const startX = options?.offsetX ?? 60;
  const startY = options?.offsetY ?? 60;
  const gateMode = options?.gateType ?? 'standard';
  const outLabel = options?.outputLabel ?? 'Çıkış F';

  // 1. Collect all unique variable names (0 / 1 are constants)
  const varSet = new Set<string>();
  let usesConst = false;
  function collectVars(node: ASTNode) {
    if (node.type === 'var' && node.name) {
      if (node.name === '0' || node.name === '1') usesConst = true;
      else varSet.add(node.name);
    }
    if (node.child) collectVars(node.child);
    if (node.children) node.children.forEach(collectVars);
  }
  collectVars(ast);
  const vars = Array.from(varSet).sort();
  if (vars.length === 0 && !usesConst) {
    throw new Error('İfadede en az 1 mantıksal değişken (A, B vb.) bulunmalıdır.');
  }

  // 2. Build the gate network (positions come later)
  const uid = `syn_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e4)}`;
  type Sig = { compId: string; pinId: string; level: number; key: string };
  interface GateSpec {
    id: string;
    type: ComponentType;
    inputs: Sig[];
    level: number;
  }
  const gates: GateSpec[] = [];
  const sources = new Map<string, { id: string; type: ComponentType; label: string }>();
  const sourceSig = (name: string): Sig => {
    if (!sources.has(name)) {
      const type: ComponentType = name === '0' ? 'gnd' : name === '1' ? 'vcc' : 'switch';
      const id = `${uid}_src_${sources.size}`;
      sources.set(name, { id, type, label: type === 'switch' ? `Giriş ${name}` : name === '1' ? 'Sabit 1' : 'Sabit 0' });
    }
    const s = sources.get(name)!;
    return { compId: s.id, pinId: `${s.id}_out`, level: 0, key: `src:${name}` };
  };
  // Identical gates on identical inputs are shared (e.g. one inverter per signal)
  const gateCache = new Map<string, Sig>();
  const gate = (type: ComponentType, inputs: Sig[]): Sig => {
    const cacheKey = `${type}(${inputs.map((i) => i.key).join(',')})`;
    const cached = gateCache.get(cacheKey);
    if (cached) return cached;
    const id = `${uid}_g${gates.length}`;
    const level = Math.max(...inputs.map((i) => i.level)) + 1;
    gates.push({ id, type, inputs, level });
    const sig = { compId: id, pinId: `${id}_out`, level, key: cacheKey };
    gateCache.set(cacheKey, sig);
    return sig;
  };
  // n-ary gate limited to 5 inputs: wider ones are split, keeping the function
  const wide = (type: 'and' | 'or' | 'xor', xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (xs.length <= 5) return gate(type, xs);
    const chunks: Sig[] = [];
    for (let k = 0; k < xs.length; k += 5) chunks.push(wide(type, xs.slice(k, k + 5)));
    return wide(type, chunks);
  };

  const notOf = (a: Sig): Sig => {
    if (gateMode === 'nand') return gate('nand', [a, a]);
    if (gateMode === 'nor') return gate('nor', [a, a]);
    return gate('not', [a]);
  };
  const andOf = (xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (gateMode === 'standard') return wide('and', xs);
    if (gateMode === 'nand') {
      if (xs.length > 5) return andOf([andOf(xs.slice(0, 5)), andOf(xs.slice(5))]);
      return notOf(gate('nand', xs));
    }
    // NOR-only: a·b = (a' + b')'
    if (xs.length > 5) return andOf([andOf(xs.slice(0, 5)), andOf(xs.slice(5))]);
    return gate('nor', xs.map(notOf));
  };
  const orOf = (xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (gateMode === 'standard') return wide('or', xs);
    if (gateMode === 'nor') {
      if (xs.length > 5) return orOf([orOf(xs.slice(0, 5)), orOf(xs.slice(5))]);
      return notOf(gate('nor', xs));
    }
    // NAND-only: a + b = (a'·b')'
    if (xs.length > 5) return orOf([orOf(xs.slice(0, 5)), orOf(xs.slice(5))]);
    return gate('nand', xs.map(notOf));
  };
  const xor2 = (a: Sig, b: Sig): Sig => {
    if (gateMode === 'nand') {
      const t = gate('nand', [a, b]);
      return gate('nand', [gate('nand', [a, t]), gate('nand', [b, t])]);
    }
    if (gateMode === 'nor') {
      // 4 NORs give XNOR; one more inverts it
      const t = gate('nor', [a, b]);
      return notOf(gate('nor', [gate('nor', [a, t]), gate('nor', [b, t])]));
    }
    return gate('xor', [a, b]);
  };
  const xorOf = (xs: Sig[]): Sig => {
    if (xs.length === 1) return xs[0];
    if (gateMode === 'standard') return wide('xor', xs);
    return xs.slice(1).reduce((acc, x) => xor2(acc, x), xs[0]);
  };

  const build = (node: ASTNode): Sig => {
    if (node.type === 'var') return sourceSig(node.name!);
    if (node.type === 'not') {
      // Double negation needs no gates
      if (node.child!.type === 'not') return build(node.child!.child!);
      return notOf(build(node.child!));
    }
    const xs = (node.children || []).map(build);
    if (node.type === 'and') return andOf(xs);
    if (node.type === 'or') return orOf(xs);
    return xorOf(xs);
  };
  const root = build(ast);

  // 3. Layout: inputs in column 0, each gate in the column of its level, LED after the last level
  const COL_W = 160;
  const components: CircuitComponentInstance[] = [];
  const wires: CircuitWire[] = [];
  let srcRow = 0;
  for (const name of [...vars, ...(usesConst ? ['0', '1'] : [])]) {
    const s = sources.get(name);
    if (!s) continue;
    components.push(updatePinPositions(createComponentInstance(s.type, startX, startY + srcRow * 80, s.label, s.id)));
    srcRow++;
  }
  const colY = new Map<number, number>();
  let gateNo = 1;
  const placed = new Map<string, CircuitComponentInstance>();
  for (const g of gates) {
    const x = startX + g.level * COL_W;
    const y = colY.get(g.level) ?? startY;
    let comp = createComponentInstance(g.type, x, y, `${g.type.toUpperCase()}_${gateNo++}`, g.id);
    if (g.type !== 'not' && g.inputs.length !== comp.inputs.length) {
      comp.inputs = g.inputs.map((_, k) => ({
        id: `${g.id}_in${k}`,
        name: String.fromCharCode(65 + k),
        type: 'input' as const,
        value: 0 as SignalValue,
        x,
        y,
      }));
      comp.state = { ...comp.state, gateInputsCount: g.inputs.length };
    }
    comp = updatePinPositions(comp);
    colY.set(g.level, y + (COMPONENT_CATALOG[g.type]?.height || 60) + 40);
    placed.set(g.id, comp);
    components.push(comp);
  }
  let wireNo = 0;
  const wireTo = (from: Sig, toComp: CircuitComponentInstance, pinIdx: number) => {
    wires.push({
      id: `${uid}_w${wireNo++}`,
      fromCompId: from.compId,
      fromPinId: from.pinId,
      toCompId: toComp.id,
      toPinId: toComp.inputs[pinIdx].id,
      value: 0,
    });
  };
  for (const g of gates) {
    const comp = placed.get(g.id)!;
    g.inputs.forEach((sig, k) => wireTo(sig, comp, k));
  }

  const rootComp = placed.get(root.compId);
  const ledY = rootComp ? rootComp.y : startY;
  const led = updatePinPositions(createComponentInstance('led', startX + (root.level + 1) * COL_W, ledY, outLabel, `${uid}_out`));
  components.push(led);
  wireTo(root, led, 0);

  const normalizedWires = repairWires(wires, components);
  const sim = simulateCircuit(components, normalizedWires);
  return { components: sim.components, wires: sim.wires };
}
