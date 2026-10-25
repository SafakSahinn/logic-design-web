import type {
  ComponentType,
  ComponentMetadata,
  CircuitComponentInstance,
  CircuitWire,
  CircuitPin,
  CircuitPreset,
  TruthTableData,
} from '../types/circuit';
import type { LogicValue } from '../types/logic';
import { evaluateSubcircuit, getSubcircuitDefinition } from './subcircuitManager';

export const COMPONENT_CATALOG: Record<ComponentType, ComponentMetadata> = {
  switch: {
    type: 'switch',
    name: 'Giriş Anahtarı',
    category: 'inputs',
    width: 66,
    height: 56,
    inputs: [],
    outputs: [{ id: 'out', name: 'Q', type: 'output', relX: 66, relY: 30 }],
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
  dipSwitch4: {
    type: 'dipSwitch4',
    name: '4-Bit DIP Anahtar (DIP Switch)',
    category: 'inputs',
    width: 84,
    height: 86,
    inputs: [],
    outputs: [
      { id: 'out0', name: 'Q0', type: 'output', relX: 84, relY: 16 },
      { id: 'out1', name: 'Q1', type: 'output', relX: 84, relY: 36 },
      { id: 'out2', name: 'Q2', type: 'output', relX: 84, relY: 56 },
      { id: 'out3', name: 'Q3', type: 'output', relX: 84, relY: 74 },
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
      { id: 'inClr', name: 'CLR', type: 'input', relX: 0, relY: 48 },
    ],
    outputs: [
      { id: 'outD0', name: 'D0', type: 'output', relX: 140, relY: 14 },
      { id: 'outD1', name: 'D1', type: 'output', relX: 140, relY: 26 },
      { id: 'outD2', name: 'D2', type: 'output', relX: 140, relY: 38 },
      { id: 'outD3', name: 'D3', type: 'output', relX: 140, relY: 50 },
      { id: 'outD4', name: 'D4', type: 'output', relX: 140, relY: 62 },
      { id: 'outD5', name: 'D5', type: 'output', relX: 140, relY: 74 },
      { id: 'outD6', name: 'D6', type: 'output', relX: 140, relY: 86 },
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
    width: 86,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 86, relY: 30 }],
    description: "AND kapısının değili: (A · B)'",
  },
  nor: {
    type: 'nor',
    name: 'NOR Kapısı (VEYA DEĞİL)',
    category: 'gates',
    width: 86,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 86, relY: 30 }],
    description: "OR kapısının değili: (A + B)'",
  },
  xor: {
    type: 'xor',
    name: 'XOR Kapısı (Özel VEYA)',
    category: 'gates',
    width: 84,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 84, relY: 30 }],
    description: 'Girişler birbirinden farklı olduğunda 1 verir (A ⊕ B)',
  },
  xnor: {
    type: 'xnor',
    name: 'XNOR Kapısı (Özel VEYA DEĞİL)',
    category: 'gates',
    width: 88,
    height: 60,
    inputs: [
      { id: 'in0', name: 'A', type: 'input', relX: 0, relY: 20 },
      { id: 'in1', name: 'B', type: 'input', relX: 0, relY: 40 },
    ],
    outputs: [{ id: 'out', name: 'Y', type: 'output', relX: 88, relY: 30 }],
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
      { id: 'inEN', name: 'EN', type: 'input', relX: 35, relY: 50 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 70, relY: 30 }],
    description: 'EN=1 iken A girişini çıkışa aktarır; EN=0 iken yüksek empedans (Hi-Z) verir',
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
      { id: 'in', name: 'EN', type: 'input', relX: 0, relY: 16 },
      { id: 'pitch0', name: 'N0', type: 'input', relX: 0, relY: 28 },
      { id: 'pitch1', name: 'N1', type: 'input', relX: 0, relY: 40 },
      { id: 'pitch2', name: 'N2', type: 'input', relX: 0, relY: 52 },
      { id: 'pitch3', name: 'N3', type: 'input', relX: 0, relY: 64 },
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
      { id: 'row0', name: 'R0', type: 'input', relX: 0, relY: 16 },
      { id: 'row1', name: 'R1', type: 'input', relX: 0, relY: 28 },
      { id: 'row2', name: 'R2', type: 'input', relX: 0, relY: 40 },
      { id: 'row3', name: 'R3', type: 'input', relX: 0, relY: 52 },
      { id: 'row4', name: 'R4', type: 'input', relX: 0, relY: 64 },
      { id: 'row5', name: 'R5', type: 'input', relX: 0, relY: 76 },
      { id: 'row6', name: 'R6', type: 'input', relX: 0, relY: 88 },
      { id: 'row7', name: 'R7', type: 'input', relX: 0, relY: 100 },
      { id: 'col0', name: 'C0', type: 'input', relX: 18, relY: 124 },
      { id: 'col1', name: 'C1', type: 'input', relX: 30, relY: 124 },
      { id: 'col2', name: 'C2', type: 'input', relX: 42, relY: 124 },
      { id: 'col3', name: 'C3', type: 'input', relX: 54, relY: 124 },
      { id: 'col4', name: 'C4', type: 'input', relX: 66, relY: 124 },
      { id: 'col5', name: 'C5', type: 'input', relX: 78, relY: 124 },
      { id: 'col6', name: 'C6', type: 'input', relX: 90, relY: 124 },
      { id: 'col7', name: 'C7', type: 'input', relX: 102, relY: 124 },
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
      { id: 'inX0', name: 'X0', type: 'input', relX: 0, relY: 16 },
      { id: 'inX1', name: 'X1', type: 'input', relX: 0, relY: 28 },
      { id: 'inX2', name: 'X2', type: 'input', relX: 0, relY: 40 },
      { id: 'inX3', name: 'X3', type: 'input', relX: 0, relY: 52 },
      { id: 'inY0', name: 'Y0', type: 'input', relX: 0, relY: 68 },
      { id: 'inY1', name: 'Y1', type: 'input', relX: 0, relY: 80 },
      { id: 'inY2', name: 'Y2', type: 'input', relX: 0, relY: 92 },
      { id: 'inY3', name: 'Y3', type: 'input', relX: 0, relY: 104 },
      { id: 'inR', name: 'R', type: 'input', relX: 0, relY: 122 },
      { id: 'inG', name: 'G', type: 'input', relX: 0, relY: 134 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 146 },
      { id: 'inWE', name: 'WE', type: 'input', relX: 0, relY: 162 },
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
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 13 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 23 },
      { id: 'inC', name: 'C', type: 'input', relX: 0, relY: 33 },
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 43 },
      { id: 'inE', name: 'E', type: 'input', relX: 0, relY: 53 },
      { id: 'inF', name: 'F', type: 'input', relX: 0, relY: 63 },
      { id: 'inG', name: 'G', type: 'input', relX: 0, relY: 73 },
      { id: 'inDP', name: 'DP', type: 'input', relX: 0, relY: 83 },
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
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 16 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 34 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 52 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 70 },
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
      { id: 'in0', name: 'D0', type: 'input', relX: 0, relY: 16 },
      { id: 'in1', name: 'D1', type: 'input', relX: 0, relY: 36 },
      { id: 'in2', name: 'D2', type: 'input', relX: 0, relY: 56 },
      { id: 'in3', name: 'D3', type: 'input', relX: 0, relY: 74 },
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
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 22 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 52 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 84, relY: 22 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 84, relY: 52 },
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
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 42 },
      { id: 'inK', name: 'K', type: 'input', relX: 0, relY: 64 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 88, relY: 24 },
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
      { id: 'inS', name: 'S', type: 'input', relX: 0, relY: 22 },
      { id: 'inR', name: 'R', type: 'input', relX: 0, relY: 52 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 84, relY: 22 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 84, relY: 52 },
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
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 44 },
    ],
    outputs: [
      { id: 'outS', name: 'S', type: 'output', relX: 90, relY: 20 },
      { id: 'outC', name: 'C', type: 'output', relX: 90, relY: 44 },
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
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 18 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 38 },
      { id: 'inCin', name: 'Cin', type: 'input', relX: 0, relY: 58 },
    ],
    outputs: [
      { id: 'outS', name: 'S', type: 'output', relX: 96, relY: 25 },
      { id: 'outCout', name: 'Cout', type: 'output', relX: 96, relY: 52 },
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
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 44 },
    ],
    outputs: [
      { id: 'outD', name: 'D', type: 'output', relX: 90, relY: 20 },
      { id: 'outB', name: 'B', type: 'output', relX: 90, relY: 44 },
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
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 18 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 38 },
      { id: 'inBin', name: 'Bin', type: 'input', relX: 0, relY: 58 },
    ],
    outputs: [
      { id: 'outD', name: 'D', type: 'output', relX: 96, relY: 25 },
      { id: 'outBout', name: 'Bout', type: 'output', relX: 96, relY: 52 },
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
      { id: 'inD0', name: 'I0', type: 'input', relX: 0, relY: 18 },
      { id: 'inD1', name: 'I1', type: 'input', relX: 0, relY: 38 },
      { id: 'inS', name: 'S', type: 'input', relX: 43, relY: 70 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 86, relY: 28 }],
    description: 'Seçme girişine (S) göre I0 veya I1 girişini çıkışa aktarır',
  },
  mux4: {
    type: 'mux4',
    name: '4:1 Çoklayıcı (4:1 MUX)',
    category: 'combinational',
    width: 88,
    height: 96,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 16 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 34 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 52 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 70 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 28, relY: 96 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 60, relY: 96 },
    ],
    outputs: [{ id: 'outY', name: 'Y', type: 'output', relX: 88, relY: 44 }],
    description: '2-Bit seçme girişine (S1-S0) göre 4 girişten birini çıkışa iletir',
  },
  mux8: {
    type: 'mux8',
    name: '8:1 Çoklayıcı (74HC151)',
    category: 'combinational',
    width: 96,
    height: 160,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 16 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 32 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 48 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 64 },
      { id: 'inD4', name: 'D4', type: 'input', relX: 0, relY: 80 },
      { id: 'inD5', name: 'D5', type: 'input', relX: 0, relY: 96 },
      { id: 'inD6', name: 'D6', type: 'input', relX: 0, relY: 112 },
      { id: 'inD7', name: 'D7', type: 'input', relX: 0, relY: 128 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 24, relY: 160 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 48, relY: 160 },
      { id: 'inS2', name: 'S2', type: 'input', relX: 72, relY: 160 },
    ],
    outputs: [
      { id: 'outY', name: 'Y', type: 'output', relX: 96, relY: 60 },
      { id: 'outW', name: "W (Y')", type: 'output', relX: 96, relY: 100 },
    ],
    description: '3-Bit seçme girişi (S2-S0) ile 8 girişten birini seçip Y ve W (ters) çıkışlarına iletir',
  },
  demux2: {
    type: 'demux2',
    name: '1:2 Çoklayıcı Çözücü (DEMUX)',
    category: 'combinational',
    width: 86,
    height: 70,
    inputs: [
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 28 },
      { id: 'inS', name: 'S', type: 'input', relX: 43, relY: 70 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 86, relY: 18 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 86, relY: 48 },
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
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 44 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 28, relY: 94 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 60, relY: 94 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 88, relY: 16 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 88, relY: 34 },
      { id: 'outY2', name: 'Y2', type: 'output', relX: 88, relY: 52 },
      { id: 'outY3', name: 'Y3', type: 'output', relX: 88, relY: 70 },
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
      { id: 'inEN', name: 'EN', type: 'input', relX: 0, relY: 16 },
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 42 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 66 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 88, relY: 16 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 88, relY: 34 },
      { id: 'outY2', name: 'Y2', type: 'output', relX: 88, relY: 52 },
      { id: 'outY3', name: 'Y3', type: 'output', relX: 88, relY: 70 },
    ],
    description: '2-bit adresi çözerek 4 çıkıştan birini aktif (1) yapar',
  },
  decoder3to8: {
    type: 'decoder3to8',
    name: '3:8 Kod Çözücü (74HC138)',
    category: 'combinational',
    width: 96,
    height: 116,
    inputs: [
      { id: 'inEN', name: 'EN', type: 'input', relX: 0, relY: 15 },
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 40 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 65 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 90 },
    ],
    outputs: [
      { id: 'outY0', name: 'Y0', type: 'output', relX: 96, relY: 15 },
      { id: 'outY1', name: 'Y1', type: 'output', relX: 96, relY: 28 },
      { id: 'outY2', name: 'Y2', type: 'output', relX: 96, relY: 41 },
      { id: 'outY3', name: 'Y3', type: 'output', relX: 96, relY: 54 },
      { id: 'outY4', name: 'Y4', type: 'output', relX: 96, relY: 67 },
      { id: 'outY5', name: 'Y5', type: 'output', relX: 96, relY: 80 },
      { id: 'outY6', name: 'Y6', type: 'output', relX: 96, relY: 93 },
      { id: 'outY7', name: 'Y7', type: 'output', relX: 96, relY: 106 },
    ],
    description: '3-bit ikili adresi çözerek 8 minterm çıkışından birini aktif (1) yapar',
  },
  bcdTo7Seg: {
    type: 'bcdTo7Seg',
    name: 'BCD to 7-Segment Kod Çözücü (74LS47)',
    category: 'combinational',
    width: 96,
    height: 104,
    inputs: [
      { id: 'inA', name: 'A', type: 'input', relX: 0, relY: 18 },
      { id: 'inB', name: 'B', type: 'input', relX: 0, relY: 38 },
      { id: 'inC', name: 'C', type: 'input', relX: 0, relY: 58 },
      { id: 'inD', name: 'D', type: 'input', relX: 0, relY: 78 },
    ],
    outputs: [
      { id: 'outA', name: 'a', type: 'output', relX: 96, relY: 16 },
      { id: 'outB', name: 'b', type: 'output', relX: 96, relY: 28 },
      { id: 'outC', name: 'c', type: 'output', relX: 96, relY: 40 },
      { id: 'outD', name: 'd', type: 'output', relX: 96, relY: 52 },
      { id: 'outE', name: 'e', type: 'output', relX: 96, relY: 64 },
      { id: 'outF', name: 'f', type: 'output', relX: 96, relY: 76 },
      { id: 'outG', name: 'g', type: 'output', relX: 96, relY: 88 },
    ],
    description: '4-bit ikili BCD sayıyı (A-D) doğrudan 7-segment LED göstergesi bacaklarına (a-g) dönüştürür',
  },
  priorityEncoder4to2: {
    type: 'priorityEncoder4to2',
    name: '4:2 Öncelikli Kodlayıcı (74HC148)',
    category: 'combinational',
    width: 90,
    height: 92,
    inputs: [
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 18 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 36 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 54 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 72 },
    ],
    outputs: [
      { id: 'outY1', name: 'Y1', type: 'output', relX: 90, relY: 24 },
      { id: 'outY0', name: 'Y0', type: 'output', relX: 90, relY: 46 },
      { id: 'outV', name: 'V', type: 'output', relX: 90, relY: 68 },
    ],
    description: 'En yüksek öncelikli aktif girişi (D3 > D2 > D1 > D0) 2-bit ikili koda çevirir; V aktiflik göstergesidir',
  },
  comparator4: {
    type: 'comparator4',
    name: '4-Bit Karşılaştırıcı (CMP)',
    category: 'combinational',
    width: 96,
    height: 90,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 16 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 32 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 48 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 64 },
      { id: 'inB0', name: 'B0', type: 'input', relX: 30, relY: 90 },
      { id: 'inB1', name: 'B1', type: 'input', relX: 48, relY: 90 },
      { id: 'inB2', name: 'B2', type: 'input', relX: 66, relY: 90 },
      { id: 'inB3', name: 'B3', type: 'input', relX: 84, relY: 90 },
    ],
    outputs: [
      { id: 'outGT', name: 'A>B', type: 'output', relX: 96, relY: 22 },
      { id: 'outEQ', name: 'A=B', type: 'output', relX: 96, relY: 45 },
      { id: 'outLT', name: 'A<B', type: 'output', relX: 96, relY: 68 },
    ],
    description: '4-bit A ve B sayılarını karşılaştırır: A>B, A=B veya A<B çıkışı verir',
  },
  alu4: {
    type: 'alu4',
    name: '4-Bit Mantık Birimi (ALU / 74HC181)',
    category: 'combinational',
    width: 104,
    height: 98,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 16 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 30 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 44 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 58 },
      { id: 'inCin', name: 'Cin', type: 'input', relX: 0, relY: 78 },
      { id: 'inB0', name: 'B0', type: 'input', relX: 24, relY: 98 },
      { id: 'inB1', name: 'B1', type: 'input', relX: 42, relY: 98 },
      { id: 'inB2', name: 'B2', type: 'input', relX: 60, relY: 98 },
      { id: 'inB3', name: 'B3', type: 'input', relX: 78, relY: 98 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 36, relY: 0 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 68, relY: 0 },
    ],
    outputs: [
      { id: 'outF0', name: 'F0', type: 'output', relX: 104, relY: 16 },
      { id: 'outF1', name: 'F1', type: 'output', relX: 104, relY: 32 },
      { id: 'outF2', name: 'F2', type: 'output', relX: 104, relY: 48 },
      { id: 'outF3', name: 'F3', type: 'output', relX: 104, relY: 64 },
      { id: 'outCout', name: 'Cout', type: 'output', relX: 104, relY: 78 },
      { id: 'outZero', name: 'Z', type: 'output', relX: 104, relY: 90 },
    ],
    description: '4-Bit ALU: S1-S0 fonksiyonlarına göre A+B, A-B, A&B, A|B işlemlerini yapar',
  },
  splitter4: {
    type: 'splitter4',
    name: '4-Bit Veri Yolu Ayırıcı (Splitter)',
    category: 'combinational',
    width: 84,
    height: 72,
    inputs: [
      { id: 'in0', name: 'D0', type: 'input', relX: 0, relY: 15 },
      { id: 'in1', name: 'D1', type: 'input', relX: 0, relY: 30 },
      { id: 'in2', name: 'D2', type: 'input', relX: 0, relY: 45 },
      { id: 'in3', name: 'D3', type: 'input', relX: 0, relY: 60 },
    ],
    outputs: [
      { id: 'out0', name: 'Y0', type: 'output', relX: 84, relY: 15 },
      { id: 'out1', name: 'Y1', type: 'output', relX: 84, relY: 30 },
      { id: 'out2', name: 'Y2', type: 'output', relX: 84, relY: 45 },
      { id: 'out3', name: 'Y3', type: 'output', relX: 84, relY: 60 },
    ],
    description: '4-Bit paralel veri yolu hatlarını ayırır ve dağıtır (D0-D3 -> Y0-Y3)',
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
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 90, relY: 16 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 90, relY: 36 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 90, relY: 56 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 90, relY: 76 },
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
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 16 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 34 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 52 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 70 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 28, relY: 88 },
      { id: 'inWE', name: 'WE', type: 'input', relX: 50, relY: 88 },
      { id: 'inRst', name: 'RST', type: 'input', relX: 72, relY: 88 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 92, relY: 16 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 92, relY: 34 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 92, relY: 52 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 92, relY: 70 },
    ],
    description: '4-Bit paralel saklama yazmacı: WE=1 iken saat darbesinde D verisini Q çıkışına kilitler',
  },
  shiftRegister4: {
    type: 'shiftRegister4',
    name: '4-Bit Evrensel Kaydırmalı Yazmaç (74HC194)',
    category: 'sequential',
    width: 104,
    height: 110,
    inputs: [
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 20 },
      { id: 'inRst', name: 'CLR', type: 'input', relX: 0, relY: 40 },
      { id: 'inSL', name: 'SL', type: 'input', relX: 0, relY: 60 },
      { id: 'inSR', name: 'SR', type: 'input', relX: 0, relY: 80 },
      { id: 'inS0', name: 'S0', type: 'input', relX: 30, relY: 110 },
      { id: 'inS1', name: 'S1', type: 'input', relX: 68, relY: 110 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 104, relY: 20 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 104, relY: 42 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 104, relY: 64 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 104, relY: 86 },
    ],
    description: '4-Bit Sağa/Sola kaydıran veya tutan evrensel saklayıcı (S1-S0: 00=Tut, 01=Sağa Kaydır, 10=Sola Kaydır)',
  },
  tFlipFlop: {
    type: 'tFlipFlop',
    name: 'T Flip-Flop (T-FF / Toggle)',
    category: 'sequential',
    width: 86,
    height: 82,
    inputs: [
      { id: 'inT', name: 'T', type: 'input', relX: 0, relY: 22 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 0, relY: 58 },
      { id: 'inRst', name: 'RST', type: 'input', relX: 43, relY: 82 },
    ],
    outputs: [
      { id: 'outQ', name: 'Q', type: 'output', relX: 86, relY: 22 },
      { id: 'outQBar', name: "Q'", type: 'output', relX: 86, relY: 58 },
    ],
    description: 'T=1 iken her saat darbesinde (CLK) durumunu tersleyen temel ikili sayaç ve frekans bölücü birim',
  },
  ram16x4: {
    type: 'ram16x4',
    name: '16x4-Bit RAM (74HC189)',
    category: 'sequential',
    width: 108,
    height: 124,
    inputs: [
      { id: 'inA0', name: 'A0', type: 'input', relX: 0, relY: 16 },
      { id: 'inA1', name: 'A1', type: 'input', relX: 0, relY: 32 },
      { id: 'inA2', name: 'A2', type: 'input', relX: 0, relY: 48 },
      { id: 'inA3', name: 'A3', type: 'input', relX: 0, relY: 64 },
      { id: 'inD0', name: 'D0', type: 'input', relX: 0, relY: 80 },
      { id: 'inD1', name: 'D1', type: 'input', relX: 0, relY: 94 },
      { id: 'inD2', name: 'D2', type: 'input', relX: 0, relY: 108 },
      { id: 'inD3', name: 'D3', type: 'input', relX: 0, relY: 122 },
      { id: 'inClk', name: 'CLK', type: 'input', relX: 36, relY: 124 },
      { id: 'inWE', name: 'WE', type: 'input', relX: 72, relY: 124 },
    ],
    outputs: [
      { id: 'outQ0', name: 'Q0', type: 'output', relX: 108, relY: 24 },
      { id: 'outQ1', name: 'Q1', type: 'output', relX: 108, relY: 48 },
      { id: 'outQ2', name: 'Q2', type: 'output', relX: 108, relY: 72 },
      { id: 'outQ3', name: 'Q3', type: 'output', relX: 108, relY: 96 },
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
    width: 130,
    height: 80,
    inputs: [],
    outputs: [],
    description: 'Kullanıcı tarafından paketlenmiş modüler alt devre / entegre modülü.',
  },
};

let componentCounter = 1;

export function createComponentInstance(
  type: ComponentType,
  x: number,
  y: number,
  customLabel?: string,
  customId?: string
): CircuitComponentInstance {
  const meta = COMPONENT_CATALOG[type];
  const compId = customId || `comp_${type}_${Date.now()}_${componentCounter++}`;

  const inputs: CircuitPin[] = meta.inputs.map((pin) => ({
    id: `${compId}_${pin.id}`,
    name: pin.name,
    type: 'input',
    value: 0,
    x: x + pin.relX,
    y: y + pin.relY,
  }));

  const outputs: CircuitPin[] = meta.outputs.map((pin) => ({
    id: `${compId}_${pin.id}`,
    name: pin.name,
    type: 'output',
    value: type === 'vcc' ? 1 : 0,
    x: x + pin.relX,
    y: y + pin.relY,
  }));

  return {
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
      lastClk: 0,
      hexVal: 0,
      regVal: 0,
      aluResult: 0,
      dipSwitches: type === 'dipSwitch4' ? [false, false, false, false] : undefined,
      matrixGrid: type === 'dotMatrix8x8' ? Array(8).fill(null).map(() => Array(8).fill(false)) : undefined,
      rgbPixels: type === 'rgbMatrix16x16' ? Array(16).fill(null).map(() => Array(16).fill('#050505')) : undefined,
      asciiChar: type === 'asciiKeyboard' ? 'A' : undefined,
      asciiCode: type === 'asciiKeyboard' ? 65 : undefined,
      strobe: type === 'asciiKeyboard' ? false : undefined,
    },
  };
}

export function updatePinPositions(comp: CircuitComponentInstance): CircuitComponentInstance {
  if (comp.type === 'subcircuit') {
    const width = 130;
    const height = Math.max(76, (Math.max(comp.inputs.length, comp.outputs.length) + 1) * 22);
    const newInputs = comp.inputs.map((pin, idx) => {
      const spacing = height / (comp.inputs.length + 1);
      const relY = Math.round(spacing * (idx + 1));
      return { ...pin, x: comp.x, y: comp.y + relY };
    });
    const newOutputs = comp.outputs.map((pin, idx) => {
      const spacing = height / (comp.outputs.length + 1);
      const relY = Math.round(spacing * (idx + 1));
      return { ...pin, x: comp.x + width, y: comp.y + relY };
    });
    return { ...comp, inputs: newInputs, outputs: newOutputs };
  }

  const meta = COMPONENT_CATALOG[comp.type];
  const rot = comp.rotation || 0;
  const cx = meta.width / 2;
  const cy = meta.height / 2;

  const rotatePoint = (relX: number, relY: number) => {
    if (rot === 0) return { x: relX, y: relY };
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const dx = relX - cx;
    const dy = relY - cy;
    return {
      x: cx + (dx * cos - dy * sin),
      y: cy + (dx * sin + dy * cos),
    };
  };

  const isMultiInputGate = ['and', 'or', 'nand', 'nor', 'xor', 'xnor'].includes(comp.type);

  const newInputs = comp.inputs.map((pin, idx) => {
    let relX = 0;
    let relY = 0;
    let pinSuffix = `in${idx}`;
    if (isMultiInputGate) {
      relX = 0;
      const count = comp.inputs.length;
      if (count === 2) {
        relY = idx === 0 ? 20 : 40;
      } else if (count === 3) {
        relY = idx === 0 ? 10 : (idx === 1 ? 30 : 50);
      } else if (count === 4) {
        relY = idx === 0 ? 10 : (idx === 1 ? 20 : (idx === 2 ? 40 : 50));
      } else if (count === 5) {
        relY = (idx + 1) * 10;
      } else {
        const spacing = meta.height / (count + 1);
        relY = Math.round((spacing * (idx + 1)) / 10) * 10;
      }
      pinSuffix = meta.inputs[idx]?.id || `in${idx}`;
    } else {
      const pinDef = meta.inputs[idx] || { relX: 0, relY: 0, id: `in${idx}` };
      relX = pinDef.relX;
      relY = pinDef.relY;
      pinSuffix = pinDef.id || `in${idx}`;
    }
    const p = rotatePoint(relX, relY);
    const pinId = pin.id.startsWith(`${comp.id}_`) ? pin.id : `${comp.id}_${pinSuffix}`;
    return { ...pin, id: pinId, x: comp.x + p.x, y: comp.y + p.y };
  });

  const newOutputs = comp.outputs.map((pin, idx) => {
    const defaultRelY = Math.round((meta.height / 2) / 10) * 10;
    const pinDef = meta.outputs[idx] || { relX: meta.width, relY: defaultRelY, id: idx === 0 ? 'out' : `out${idx}` };
    const rawRelY = pinDef.relY !== undefined ? pinDef.relY : defaultRelY;
    const p = rotatePoint(pinDef.relX, rawRelY);
    const pinSuffix = pinDef.id || (idx === 0 ? 'out' : `out${idx}`);
    const pinId = pin.id.startsWith(`${comp.id}_`) ? pin.id : `${comp.id}_${pinSuffix}`;
    return { ...pin, id: pinId, x: comp.x + p.x, y: comp.y + p.y };
  });

  return {
    ...comp,
    inputs: newInputs,
    outputs: newOutputs,
  };
}

/**
 * Propagate logic values across wires and components
 */
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
    state: { ...c.state },
  }));

  const newWires: CircuitWire[] = wires.map((w) => ({ ...w }));

  // Helper map to quickly lookup pins
  const pinMap = new Map<string, CircuitPin>();
  newComps.forEach((c) => {
    c.inputs.forEach((p) => pinMap.set(p.id, p));
    c.outputs.forEach((p) => pinMap.set(p.id, p));
  });

  // Step 1: Update source components outputs (switch, vcc, gnd, clock)
  newComps.forEach((comp) => {
    if (comp.type === 'switch') {
      const targetVal: LogicValue = comp.state.on ? 1 : 0;
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'pushbutton') {
      const targetVal: LogicValue = comp.state.on ? 1 : 0;
      if (comp.outputs[0] && comp.outputs[0].value !== targetVal) {
        comp.outputs[0].value = targetVal;
        hasChanged = true;
      }
    } else if (comp.type === 'clock') {
      const targetVal: LogicValue = comp.state.on ? 1 : 0;
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
        const targetVal: LogicValue = switches[i] ? 1 : 0;
        if (comp.outputs[i] && comp.outputs[i].value !== targetVal) {
          comp.outputs[i].value = targetVal;
          hasChanged = true;
        }
      }
    } else if (comp.type === 'asciiKeyboard') {
      const code = comp.state.asciiCode ?? 65;
      const strobeVal: LogicValue = comp.state.strobe ? 1 : 0;
      for (let i = 0; i < 7; i++) {
        const targetBit: LogicValue = (code & (1 << i)) ? 1 : 0;
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
    if (w.fromPinId && w.toPinId) {
      unionPins(w.fromPinId, w.toPinId);
    }
    if (w.startPoint && w.endPoint) {
      const sx = Math.round(w.startPoint.x / 10) * 10;
      const sy = Math.round(w.startPoint.y / 10) * 10;
      const ex = Math.round(w.endPoint.x / 10) * 10;
      const ey = Math.round(w.endPoint.y / 10) * 10;
      const ks = `loc_${sx}_${sy}`;
      const ke = `loc_${ex}_${ey}`;
      unionPins(ks, ke);
      if (w.fromPinId) unionPins(w.fromPinId, ks);
      if (w.toPinId) unionPins(w.toPinId, ke);
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
    const key =
      w.fromPinId ||
      (w.startPoint
        ? `loc_${Math.round(w.startPoint.x / 10) * 10}_${Math.round(w.startPoint.y / 10) * 10}`
        : w.id);
    const root = findRoot(key);
    if (!netWires.has(root)) netWires.set(root, []);
    netWires.get(root)!.push(w);
    if (!netPins.has(root)) netPins.set(root, []);
  });

  // Evaluate each electrical net
  netPins.forEach((pinsInNet, root) => {
    // Collect active driving output pins on this net
    const driverPins: CircuitPin[] = [];
    pinsInNet.forEach((pinId) => {
      const pin = pinMap.get(pinId);
      if (!pin || pin.type !== 'output') return;

      // Find owner component
      const ownerComp = newComps.find((c) => c.outputs.some((p) => p.id === pinId));
      if (ownerComp?.type === 'triState' && ownerComp.state.hiZ) {
        // High impedance tri-state buffer is not actively driving the bus net
        return;
      }
      if (ownerComp?.type === 'tunnel') {
        // Tunnel pins are passive wireless conduits, not active driving sources
        return;
      }
      driverPins.push(pin);
    });

    const drivenVals = new Set(driverPins.map((d) => d.value));
    const hasConflict = drivenVals.has(0) && drivenVals.has(1);

    // If conflict detected, mark all wires in this net
    const wiresInThisNet = netWires.get(root) || [];
    wiresInThisNet.forEach((w) => {
      if (w.hasConflict !== hasConflict) {
        w.hasConflict = hasConflict;
        hasChanged = true;
      }
    });

    // Determine the resolved logic value on this net
    let resolvedValue: LogicValue = 0;
    if (hasConflict) {
      resolvedValue = 0; // State in conflict
    } else if (driverPins.length > 0) {
      resolvedValue = driverPins[0].value;
    }

    // Assign resolved value to all wires in net
    wiresInThisNet.forEach((w) => {
      if (w.value !== resolvedValue) {
        w.value = resolvedValue;
        hasChanged = true;
      }
    });

    // Assign resolved value to all input pins (and passive tunnel pins) in net
    pinsInNet.forEach((pinId) => {
      const pin = pinMap.get(pinId);
      if (!pin) return;
      const ownerComp = newComps.find(
        (c) => c.inputs.some((p) => p.id === pinId) || c.outputs.some((p) => p.id === pinId)
      );
      if (pin.type === 'input' || ownerComp?.type === 'tunnel') {
        if (pin.value !== resolvedValue) {
          pin.value = resolvedValue;
          hasChanged = true;
        }
      }
    });
  });

  // Step 3: Compute gate/block outputs based on their current inputs
  newComps.forEach((comp) => {
    const inVals = comp.inputs.map((p) => (p.value === 1 ? 1 : 0));

    switch (comp.type) {
      case 'not': {
        const val: LogicValue = inVals[0] === 1 ? 0 : 1;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'and': {
        const val: LogicValue = inVals.length > 0 && inVals.every((v) => v === 1) ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'or': {
        const val: LogicValue = inVals.some((v) => v === 1) ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'nand': {
        const allOnes = inVals.length > 0 && inVals.every((v) => v === 1);
        const val: LogicValue = allOnes ? 0 : 1;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'nor': {
        const anyOnes = inVals.some((v) => v === 1);
        const val: LogicValue = anyOnes ? 0 : 1;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'xor': {
        const onesCount = inVals.filter((v) => v === 1).length;
        const val: LogicValue = onesCount % 2 === 1 ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'xnor': {
        const onesCount = inVals.filter((v) => v === 1).length;
        const val: LogicValue = onesCount % 2 === 0 ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'triState': {
        const a = inVals[0] === 1 ? 1 : 0;
        const en = inVals[1] === 1 ? 1 : 0;
        const isHiZ = en === 0;
        comp.state.hiZ = isHiZ;
        const val: LogicValue = isHiZ ? 0 : (a === 1 ? 1 : 0);
        if (comp.outputs[0] && comp.outputs[0].value !== val) {
          comp.outputs[0].value = val;
          hasChanged = true;
        }
        break;
      }
      case 'splitter4': {
        for (let i = 0; i < 4; i++) {
          const bitVal: LogicValue = inVals[i] === 1 ? 1 : 0;
          if (comp.outputs[i] && comp.outputs[i].value !== bitVal) {
            comp.outputs[i].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'demux2': {
        const d = inVals[0] === 1 ? 1 : 0;
        const s = inVals[1] === 1 ? 1 : 0;
        const y0: LogicValue = d === 1 && s === 0 ? 1 : 0;
        const y1: LogicValue = d === 1 && s === 1 ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== y0) {
          comp.outputs[0].value = y0;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== y1) {
          comp.outputs[1].value = y1;
          hasChanged = true;
        }
        break;
      }
      case 'alu4': {
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

        const isZero: LogicValue = result === 0 ? 1 : 0;
        comp.state.aluResult = result;

        for (let bit = 0; bit < 4; bit++) {
          const bitVal: LogicValue = ((result >> bit) & 1) === 1 ? 1 : 0;
          if (comp.outputs[bit] && comp.outputs[bit].value !== bitVal) {
            comp.outputs[bit].value = bitVal;
            hasChanged = true;
          }
        }
        if (comp.outputs[4] && comp.outputs[4].value !== cout) {
          comp.outputs[4].value = cout as LogicValue;
          hasChanged = true;
        }
        if (comp.outputs[5] && comp.outputs[5].value !== isZero) {
          comp.outputs[5].value = isZero;
          hasChanged = true;
        }
        break;
      }
      case 'register4': {
        const d = (inVals[0] || 0) + (inVals[1] || 0) * 2 + (inVals[2] || 0) * 4 + (inVals[3] || 0) * 8;
        const clk: LogicValue = inVals[4] === 1 ? 1 : 0;
        const we: LogicValue = inVals[5] === 1 ? 1 : 0;
        const rst: LogicValue = inVals[6] === 1 ? 1 : 0;
        const prevClk = comp.state.lastClk ?? 0;
        const isRisingEdge = clk === 1 && prevClk === 0;
        comp.state.lastClk = clk;

        let curVal = comp.state.regVal ?? 0;
        if (rst === 1) {
          curVal = 0;
          if (comp.state.regVal !== 0) {
            comp.state.regVal = 0;
            hasChanged = true;
          }
        } else if (isRisingEdge && we === 1) {
          curVal = d;
          if (comp.state.regVal !== d) {
            comp.state.regVal = d;
            hasChanged = true;
          }
        }

        for (let bit = 0; bit < 4; bit++) {
          const bitVal: LogicValue = ((curVal >> bit) & 1) === 1 ? 1 : 0;
          if (comp.outputs[bit] && comp.outputs[bit].value !== bitVal) {
            comp.outputs[bit].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'decoder2to4': {
        const en = inVals[0] ?? 1;
        const a0 = inVals[1] ?? 0;
        const a1 = inVals[2] ?? 0;
        const addr = a0 + a1 * 2;
        for (let i = 0; i < 4; i++) {
          const val: LogicValue = en === 1 && addr === i ? 1 : 0;
          if (comp.outputs[i] && comp.outputs[i].value !== val) {
            comp.outputs[i].value = val;
            hasChanged = true;
          }
        }
        break;
      }
      case 'comparator4': {
        const a = (inVals[0] || 0) + (inVals[1] || 0) * 2 + (inVals[2] || 0) * 4 + (inVals[3] || 0) * 8;
        const b = (inVals[4] || 0) + (inVals[5] || 0) * 2 + (inVals[6] || 0) * 4 + (inVals[7] || 0) * 8;
        const gt: LogicValue = a > b ? 1 : 0;
        const eq: LogicValue = a === b ? 1 : 0;
        const lt: LogicValue = a < b ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== gt) {
          comp.outputs[0].value = gt;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== eq) {
          comp.outputs[1].value = eq;
          hasChanged = true;
        }
        if (comp.outputs[2] && comp.outputs[2].value !== lt) {
          comp.outputs[2].value = lt;
          hasChanged = true;
        }
        break;
      }
      case 'counter4': {
        const clk: LogicValue = inVals[0] === 1 ? 1 : 0;
        const rst: LogicValue = inVals[1] === 1 ? 1 : 0;
        const prevClk = comp.state.lastClk ?? 0;
        const isRisingEdge = clk === 1 && prevClk === 0;
        comp.state.lastClk = clk;

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
          const bitVal: LogicValue = ((curCount >> bit) & 1) === 1 ? 1 : 0;
          if (comp.outputs[bit] && comp.outputs[bit].value !== bitVal) {
            comp.outputs[bit].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'halfAdder': {
        const s: LogicValue = inVals[0] !== inVals[1] ? 1 : 0;
        const c: LogicValue = inVals[0] === 1 && inVals[1] === 1 ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== s) {
          comp.outputs[0].value = s;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== c) {
          comp.outputs[1].value = c;
          hasChanged = true;
        }
        break;
      }
      case 'fullAdder': {
        const a = inVals[0];
        const b = inVals[1];
        const cin = inVals[2] || 0;
        const s: LogicValue = ((a ^ b ^ cin) === 1 ? 1 : 0);
        const cout: LogicValue = (((a & b) | (cin & (a ^ b))) === 1 ? 1 : 0);
        if (comp.outputs[0] && comp.outputs[0].value !== s) {
          comp.outputs[0].value = s;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== cout) {
          comp.outputs[1].value = cout;
          hasChanged = true;
        }
        break;
      }
      case 'halfSubtractor': {
        const a = inVals[0] ?? 0;
        const b = inVals[1] ?? 0;
        const diff: LogicValue = ((a ^ b) === 1 ? 1 : 0);
        const borrow: LogicValue = (a === 0 && b === 1 ? 1 : 0);
        if (comp.outputs[0] && comp.outputs[0].value !== diff) {
          comp.outputs[0].value = diff;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== borrow) {
          comp.outputs[1].value = borrow;
          hasChanged = true;
        }
        break;
      }
      case 'fullSubtractor': {
        const a = inVals[0] ?? 0;
        const b = inVals[1] ?? 0;
        const bin = inVals[2] ?? 0;
        const diff: LogicValue = (((a ^ b ^ bin) & 1) === 1 ? 1 : 0);
        const bout: LogicValue = ((a === 0 && b === 1) || ((a ^ b) === 0 && bin === 1) ? 1 : 0);
        if (comp.outputs[0] && comp.outputs[0].value !== diff) {
          comp.outputs[0].value = diff;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== bout) {
          comp.outputs[1].value = bout;
          hasChanged = true;
        }
        break;
      }
      case 'decoder3to8': {
        const en = inVals[0] ?? 0;
        const a0 = inVals[1] ?? 0;
        const a1 = inVals[2] ?? 0;
        const a2 = inVals[3] ?? 0;
        const sel = en === 1 ? a0 + a1 * 2 + a2 * 4 : -1;
        for (let i = 0; i < 8; i++) {
          const val: LogicValue = sel === i ? 1 : 0;
          if (comp.outputs[i] && comp.outputs[i].value !== val) {
            comp.outputs[i].value = val;
            hasChanged = true;
          }
        }
        break;
      }
      case 'bcdTo7Seg': {
        const a = inVals[0] ?? 0;
        const b = inVals[1] ?? 0;
        const c = inVals[2] ?? 0;
        const d = inVals[3] ?? 0;
        const num = (a === 1 ? 1 : 0) | ((b === 1 ? 1 : 0) << 1) | ((c === 1 ? 1 : 0) << 2) | ((d === 1 ? 1 : 0) << 3);
        const map = HEX_7SEG_MAP[num % 16] || HEX_7SEG_MAP[0];
        const segs: LogicValue[] = [
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
      case 'mux2': {
        const d0 = inVals[0];
        const d1 = inVals[1];
        const s = inVals[2] || 0;
        const y: LogicValue = s === 1 ? d1 : d0;
        if (comp.outputs[0] && comp.outputs[0].value !== y) {
          comp.outputs[0].value = y;
          hasChanged = true;
        }
        break;
      }
      case 'mux4': {
        const d0 = inVals[0] ?? 0;
        const d1 = inVals[1] ?? 0;
        const d2 = inVals[2] ?? 0;
        const d3 = inVals[3] ?? 0;
        const s0 = inVals[4] ?? 0;
        const s1 = inVals[5] ?? 0;
        const sel = s0 + s1 * 2;
        const chosen = sel === 0 ? d0 : sel === 1 ? d1 : sel === 2 ? d2 : d3;
        const y: LogicValue = chosen === 1 ? 1 : 0;
        if (comp.outputs[0] && comp.outputs[0].value !== y) {
          comp.outputs[0].value = y;
          hasChanged = true;
        }
        break;
      }
      case 'mux8': {
        const s0 = inVals[8] ?? 0;
        const s1 = inVals[9] ?? 0;
        const s2 = inVals[10] ?? 0;
        const sel = s0 + s1 * 2 + s2 * 4;
        const chosen = inVals[sel] ?? 0;
        const y: LogicValue = chosen === 1 ? 1 : 0;
        const w: LogicValue = y === 1 ? 0 : 1;
        if (comp.outputs[0] && comp.outputs[0].value !== y) {
          comp.outputs[0].value = y;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== w) {
          comp.outputs[1].value = w;
          hasChanged = true;
        }
        break;
      }
      case 'demux4': {
        const d = inVals[0] ?? 0;
        const s0 = inVals[1] ?? 0;
        const s1 = inVals[2] ?? 0;
        const sel = s0 + s1 * 2;
        for (let i = 0; i < 4; i++) {
          const val: LogicValue = sel === i && d === 1 ? 1 : 0;
          if (comp.outputs[i] && comp.outputs[i].value !== val) {
            comp.outputs[i].value = val;
            hasChanged = true;
          }
        }
        break;
      }
      case 'priorityEncoder4to2': {
        const d0 = inVals[0] ?? 0;
        const d1 = inVals[1] ?? 0;
        const d2 = inVals[2] ?? 0;
        const d3 = inVals[3] ?? 0;
        let y1: LogicValue = 0;
        let y0: LogicValue = 0;
        let v: LogicValue = 0;
        if (d3 === 1) {
          y1 = 1; y0 = 1; v = 1;
        } else if (d2 === 1) {
          y1 = 1; y0 = 0; v = 1;
        } else if (d1 === 1) {
          y1 = 0; y0 = 1; v = 1;
        } else if (d0 === 1) {
          y1 = 0; y0 = 0; v = 1;
        }
        if (comp.outputs[0] && comp.outputs[0].value !== y1) {
          comp.outputs[0].value = y1;
          hasChanged = true;
        }
        if (comp.outputs[1] && comp.outputs[1].value !== y0) {
          comp.outputs[1].value = y0;
          hasChanged = true;
        }
        if (comp.outputs[2] && comp.outputs[2].value !== v) {
          comp.outputs[2].value = v;
          hasChanged = true;
        }
        break;
      }
      case 'shiftRegister4': {
        const clk = inVals[0] ?? 0;
        const rst = inVals[1] ?? 0;
        const sl = inVals[2] ?? 0;
        const sr = inVals[3] ?? 0;
        const s0 = inVals[4] ?? 0;
        const s1 = inVals[5] ?? 0;

        if (!Array.isArray(comp.state.regBits)) {
          comp.state.regBits = [0, 0, 0, 0];
        }

        if (rst === 1) {
          comp.state.regBits = [0, 0, 0, 0];
        } else {
          const prevClk = comp.state.lastClk ?? 0;
          if (prevClk === 0 && clk === 1) {
            const mode = s0 + s1 * 2;
            const cur = [...comp.state.regBits];
            if (mode === 1) {
              // Shift Right: SR into Q3, Q3 into Q2, Q2 into Q1, Q1 into Q0
              comp.state.regBits = [cur[1], cur[2], cur[3], sr];
            } else if (mode === 2) {
              // Shift Left: SL into Q0, Q0 into Q1, Q1 into Q2, Q2 into Q3
              comp.state.regBits = [sl, cur[0], cur[1], cur[2]];
            }
          }
        }
        comp.state.lastClk = clk;

        for (let b = 0; b < 4; b++) {
          const bitVal: LogicValue = comp.state.regBits[b] === 1 ? 1 : 0;
          if (comp.outputs[b] && comp.outputs[b].value !== bitVal) {
            comp.outputs[b].value = bitVal;
            hasChanged = true;
          }
        }
        break;
      }
      case 'sevenSegment': {
        // Direct segment mapping handled in renderer
        break;
      }
      case 'hexDisplay': {
        const d0 = inVals[0] || 0;
        const d1 = inVals[1] || 0;
        const d2 = inVals[2] || 0;
        const d3 = inVals[3] || 0;
        const hexVal = d0 + d1 * 2 + d2 * 4 + d3 * 8;
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
        const clkVal = inVals[12] === 1 ? 1 : 0;
        const rstVal = inVals[13] === 1;
        const prevClk = comp.state.lastClk ?? 0;
        const isRising = clkVal === 1 && prevClk === 0;
        comp.state.lastClk = clkVal;

        if (!comp.state.rgbPixels || comp.state.rgbPixels.length !== 16) {
          comp.state.rgbPixels = Array.from({ length: 16 }, () => Array(16).fill('#050505'));
        }

        if (rstVal) {
          comp.state.rgbPixels = Array.from({ length: 16 }, () => Array(16).fill('#050505'));
          hasChanged = true;
        } else if (weVal && (isRising || inVals[12] === undefined)) {
          let hexCol = '#050505';
          if (rVal && gVal && bVal) hexCol = '#ffffff';
          else if (rVal && gVal && !bVal) hexCol = '#eab308';
          else if (rVal && !gVal && bVal) hexCol = '#ec4899';
          else if (rVal && !gVal && !bVal) hexCol = '#ef4444';
          else if (!rVal && gVal && bVal) hexCol = '#06b6d4';
          else if (!rVal && gVal && !bVal) hexCol = '#22c55e';
          else if (!rVal && !gVal && bVal) hexCol = '#3b82f6';

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
        const d: LogicValue = inVals[0] === 1 ? 1 : 0;
        const clk: LogicValue = inVals[1] === 1 ? 1 : 0;
        const prevClk = comp.state.lastClk ?? 0;
        const isRisingEdge = clk === 1 && prevClk === 0;
        comp.state.lastClk = clk;

        if (isRisingEdge) {
          const nextQ = d;
          const nextQBar: LogicValue = d === 1 ? 0 : 1;
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
        const j: LogicValue = inVals[0] === 1 ? 1 : 0;
        const clk: LogicValue = inVals[1] === 1 ? 1 : 0;
        const k: LogicValue = inVals[2] === 1 ? 1 : 0;
        const prevClk = comp.state.lastClk ?? 0;
        const isRisingEdge = clk === 1 && prevClk === 0;
        comp.state.lastClk = clk;

        if (isRisingEdge) {
          let nextQ = comp.state.q ?? 0;
          if (j === 0 && k === 1) nextQ = 0;
          else if (j === 1 && k === 0) nextQ = 1;
          else if (j === 1 && k === 1) nextQ = nextQ === 1 ? 0 : 1;

          const nextQBar: LogicValue = nextQ === 1 ? 0 : 1;
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
        const s: LogicValue = inVals[0] === 1 ? 1 : 0;
        const r: LogicValue = inVals[1] === 1 ? 1 : 0;
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
        const t: LogicValue = inVals[0] === 1 ? 1 : 0;
        const clk: LogicValue = inVals[1] === 1 ? 1 : 0;
        const rst: LogicValue = inVals[2] === 1 ? 1 : 0;
        const prevClk = comp.state.lastClk ?? 0;
        const isRisingEdge = clk === 1 && prevClk === 0;
        comp.state.lastClk = clk;

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
            comp.state.qBar = (curQ === 1 ? 0 : 1) as LogicValue;
            hasChanged = true;
          }
        }
        const qVal: LogicValue = comp.state.q ?? 0;
        const qBarVal: LogicValue = comp.state.qBar ?? 1;
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
        const addr = (inVals[0] ?? 0) + (inVals[1] ?? 0) * 2 + (inVals[2] ?? 0) * 4 + (inVals[3] ?? 0) * 8;
        const dataIn = (inVals[4] ?? 0) + (inVals[5] ?? 0) * 2 + (inVals[6] ?? 0) * 4 + (inVals[7] ?? 0) * 8;
        const clk = inVals[8] ?? 0;
        const we = inVals[9] ?? 0;

        const prevClk = comp.state.lastClk ?? 0;
        const isRisingEdge = prevClk === 0 && clk === 1;
        comp.state.lastClk = clk;

        if (isRisingEdge && we === 1) {
          comp.state.ramData[addr] = dataIn;
          hasChanged = true;
        }

        const storedVal = comp.state.ramData[addr] ?? 0;
        for (let b = 0; b < 4; b++) {
          const bitVal: LogicValue = ((storedVal >> b) & 1) === 1 ? 1 : 0;
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
        const addr = (inVals[0] ?? 0) + (inVals[1] ?? 0) * 2 + (inVals[2] ?? 0) * 4 + (inVals[3] ?? 0) * 8;
        const storedVal = comp.state.romData[addr] ?? 0;
        for (let b = 0; b < 4; b++) {
          const bitVal: LogicValue = ((storedVal >> b) & 1) === 1 ? 1 : 0;
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
            const outVals = evaluateSubcircuit(subDef, inVals);
            outVals.forEach((val, oIdx) => {
              if (comp.outputs[oIdx] && comp.outputs[oIdx].value !== val) {
                comp.outputs[oIdx].value = val;
                hasChanged = true;
              }
            });
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
  maxIterations = 10
): { components: CircuitComponentInstance[]; wires: CircuitWire[] } {
  let curComps = components;
  let curWires = wires;

  for (let i = 0; i < maxIterations; i++) {
    const step = simulateCircuitStep(curComps, curWires);
    curComps = step.components;
    curWires = step.wires;
    if (!step.hasChanged) break;
  }

  return { components: curComps, wires: curWires };
}

/**
 * Standard Circuit Presets from "Sıfırdan İşlemciye"
 */
export const CIRCUIT_PRESETS: CircuitPreset[] = [
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
      { ...createComponentInstance('fullAdder', 260, 150, '74HC283 Tam Toplayıcı'), id: 'fa_1' },
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
      { ...createComponentInstance('or', 490, 175, 'OR Çıkışı'), id: 'or_1' },
      { ...createComponentInstance('led', 630, 175, 'XOR LED'), id: 'led_out' },
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
      { ...createComponentInstance('and', 340, 95, "AND (D0·S')"), id: 'and_0' },
      { ...createComponentInstance('and', 340, 235, 'AND (D1·S)'), id: 'and_1' },
      { ...createComponentInstance('or', 480, 165, 'OR Çıkışı (Y)'), id: 'or_out' },
      { ...createComponentInstance('led', 620, 165, 'Çıkış LED (Y)'), id: 'led_y' },
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
      { id: 'w4', fromCompId: 'tff_0', fromPinId: 'tff_0_outQ', toCompId: 'tff_1', toPinId: 'tff_1_inClk', value: 0 },
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
    ],
  },
  {
    id: 'counter_hex_demo',
    name: '4-Bit Senkron Sayaç ve 7-Segment Hex Gösterge (0-F)',
    category: 'sequential',
    description: 'Saat darbesi (CLK) ve Sıfırlama (RST) butonu ile kontrol edilen 4-bit sayaç (74HC161), çıkışındaki 4 ikili biti Hexadecimal 7-Segment ekranda 0\'dan F\'ye canlı olarak saydırır.',
    components: [
      { ...createComponentInstance('clock', 60, 95, 'Saat Darbesi (CLK)'), id: 'cnt_clk' },
      { ...createComponentInstance('pushbutton', 60, 160, 'Sıfırla (RST)'), id: 'cnt_rst' },
      { ...createComponentInstance('counter4', 190, 100, '4-Bit Senkron Sayaç'), id: 'cnt_core' },
      { ...createComponentInstance('hexDisplay', 350, 75, 'Hex Ekran (0-F)'), id: 'cnt_hex' },
      { ...createComponentInstance('led', 480, 75, 'Q0 (LSB)'), id: 'led_q0' },
      { ...createComponentInstance('led', 480, 115, 'Q1'), id: 'led_q1' },
      { ...createComponentInstance('led', 480, 155, 'Q2'), id: 'led_q2' },
      { ...createComponentInstance('led', 480, 195, 'Q3 (MSB)'), id: 'led_q3' },
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
    name: '4-Bit Büyüklük Karşılaştırıcı (74HC85 CMP)',
    category: 'arithmetic',
    description: 'İki adet 4-bitlik ikili sayıyı (A3..A0 ile B3..B0) karşılaştırarak A>B, A=B veya A<B durumlarını anında tespit eden aritmetik mantık devresi.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A3 (MSB)'), id: 'sw_a3' },
      { ...createComponentInstance('switch', 60, 95, 'A2'), id: 'sw_a2' },
      { ...createComponentInstance('switch', 60, 140, 'A1'), id: 'sw_a1' },
      { ...createComponentInstance('switch', 60, 185, 'A0 (LSB)'), id: 'sw_a0' },
      { ...createComponentInstance('switch', 160, 240, 'B0 (LSB)'), id: 'sw_b0' },
      { ...createComponentInstance('switch', 210, 240, 'B1'), id: 'sw_b1' },
      { ...createComponentInstance('switch', 260, 240, 'B2'), id: 'sw_b2' },
      { ...createComponentInstance('switch', 310, 240, 'B3 (MSB)'), id: 'sw_b3' },
      { ...createComponentInstance('comparator4', 210, 90, '4-Bit CMP (74HC85)'), id: 'cmp_core' },
      { ...createComponentInstance('led', 390, 75, 'A > B (Yeşil)'), id: 'led_gt' },
      { ...createComponentInstance('led', 390, 120, 'A = B (Mavi)'), id: 'led_eq' },
      { ...createComponentInstance('led', 390, 165, 'A < B (Kırmızı)'), id: 'led_lt' },
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
    name: '4:2 Öncelikli Kodlayıcı (74HC148 Priority Encoder)',
    category: 'basic',
    description: '4 aktif girişten (D3..D0) önceliği en yüksek olanı 2-bit ikili koda (Y1, Y0) çevirir; V pini aktiflik göstergesidir.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'D0 (En Düşük Öncelik)'), id: 'pri_sw0' },
      { ...createComponentInstance('switch', 60, 95, 'D1'), id: 'pri_sw1' },
      { ...createComponentInstance('switch', 60, 140, 'D2'), id: 'pri_sw2' },
      { ...createComponentInstance('switch', 60, 185, 'D3 (En Yüksek Öncelik)'), id: 'pri_sw3' },
      { ...createComponentInstance('priorityEncoder4to2', 200, 90, '74HC148 Priority Encoder'), id: 'pri_core' },
      { ...createComponentInstance('led', 360, 75, 'Y1 (MSB)'), id: 'pri_led_y1' },
      { ...createComponentInstance('led', 360, 120, 'Y0 (LSB)'), id: 'pri_led_y0' },
      { ...createComponentInstance('led', 360, 165, 'V (Geçerli / Valid)'), id: 'pri_led_v' },
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
    name: '4-Bit Evrensel Kaydırmalı Yazmaç (74HC194)',
    category: 'sequential',
    description: 'Saat darbesi (CLK) ve mod anahtarlarıyla çalışan 4-bit kaydırmalı saklayıcı: S1-S0=01 iken sağa, 10 iken sola kaydırır.',
    components: [
      { ...createComponentInstance('clock', 60, 60, 'Saat Darbesi (CLK)'), id: 'sh_clk' },
      { ...createComponentInstance('pushbutton', 60, 115, 'Sıfırla (CLR)'), id: 'sh_clr' },
      { ...createComponentInstance('switch', 60, 170, 'SR (Sağ Giriş)'), id: 'sh_sr' },
      { ...createComponentInstance('switch', 60, 225, 'SL (Sol Giriş)'), id: 'sh_sl' },
      { ...createComponentInstance('switch', 160, 255, 'S0 (Mod 0)'), id: 'sh_s0' },
      { ...createComponentInstance('switch', 220, 255, 'S1 (Mod 1)'), id: 'sh_s1' },
      { ...createComponentInstance('shiftRegister4', 200, 90, '74HC194 Shift Reg'), id: 'sh_core' },
      { ...createComponentInstance('led', 380, 65, 'Q0 (LSB)'), id: 'sh_q0' },
      { ...createComponentInstance('led', 380, 105, 'Q1'), id: 'sh_q1' },
      { ...createComponentInstance('led', 380, 145, 'Q2'), id: 'sh_q2' },
      { ...createComponentInstance('led', 380, 185, 'Q3 (MSB)'), id: 'sh_q3' },
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
    name: '16x4-Bit RAM Bellek ve Hex Gösterge (74HC189)',
    category: 'sequential',
    description: '16 Adresli 4-Bit RAM: A3-A0 adresini seçin, D3-D0 verisini ayarlayın ve WE=1 iken CLK saat darbesiyle belleğe yazın. Adresteki veri doğrudan Hex ekranda okunur.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A0 (Adres 0)'), id: 'ram_sw_a0' },
      { ...createComponentInstance('switch', 60, 95, 'A1 (Adres 1)'), id: 'ram_sw_a1' },
      { ...createComponentInstance('switch', 60, 140, 'A2 (Adres 2)'), id: 'ram_sw_a2' },
      { ...createComponentInstance('switch', 60, 185, 'A3 (Adres 3)'), id: 'ram_sw_a3' },
      { ...createComponentInstance('switch', 60, 240, 'D0 (Veri 0)'), id: 'ram_sw_d0' },
      { ...createComponentInstance('switch', 60, 285, 'D1 (Veri 1)'), id: 'ram_sw_d1' },
      { ...createComponentInstance('clock', 170, 285, 'CLK (Yazma Saati)'), id: 'ram_clk' },
      { ...createComponentInstance('switch', 240, 285, 'WE (Yazma İzni)'), id: 'ram_sw_we' },
      { ...createComponentInstance('ram16x4', 210, 80, '16x4 RAM (74HC189)'), id: 'ram_chip' },
      { ...createComponentInstance('hexDisplay', 380, 80, 'Okunan Hex Ekran'), id: 'ram_disp' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'ram_sw_a0', fromPinId: 'ram_sw_a0_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA0', value: 0 },
      { id: 'w2', fromCompId: 'ram_sw_a1', fromPinId: 'ram_sw_a1_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA1', value: 0 },
      { id: 'w3', fromCompId: 'ram_sw_a2', fromPinId: 'ram_sw_a2_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA2', value: 0 },
      { id: 'w4', fromCompId: 'ram_sw_a3', fromPinId: 'ram_sw_a3_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inA3', value: 0 },
      { id: 'w5', fromCompId: 'ram_sw_d0', fromPinId: 'ram_sw_d0_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inD0', value: 0 },
      { id: 'w6', fromCompId: 'ram_sw_d1', fromPinId: 'ram_sw_d1_out', toCompId: 'ram_chip', toPinId: 'ram_chip_inD1', value: 0 },
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
      { ...createComponentInstance('led', 390, 75, 'Fark (Diff = A⊕B⊕Bin)'), id: 'fs_led_diff' },
      { ...createComponentInstance('led', 390, 155, 'Borç Çıkışı (Bout)'), id: 'fs_led_bout' },
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
    name: 'BCD to 7-Segment Kod Çözücü ve LED Ekran (74LS47)',
    category: 'basic',
    description: '4-Bit ikili BCD kodunu 7-segment LED göstergesi formatına (a-g) dönüştürerek 0-9 rakamlarını görüntüleyen donanım devresi.',
    components: [
      { ...createComponentInstance('switch', 60, 50, 'A (Bit 0 LSB)'), id: 'bcd_sw_a' },
      { ...createComponentInstance('switch', 60, 105, 'B (Bit 1)'), id: 'bcd_sw_b' },
      { ...createComponentInstance('switch', 60, 160, 'C (Bit 2)'), id: 'bcd_sw_c' },
      { ...createComponentInstance('switch', 60, 215, 'D (Bit 3 MSB)'), id: 'bcd_sw_d' },
      { ...createComponentInstance('bcdTo7Seg', 210, 80, 'BCD to 7-Seg (74LS47)'), id: 'bcd_chip' },
      { ...createComponentInstance('sevenSegment', 380, 70, '7-Segment Ekran'), id: 'bcd_disp' },
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
    name: '3:8 Kod Çözücü ile Minterm Seçimi (74HC138)',
    category: 'basic',
    description: '3-Bit ikili adres (A0, A1, A2) ve Enable yetkilendirmesiyle 8 çıkış hattından (m0-m7) birini seçen kod çözücü mimarisi.',
    components: [
      { ...createComponentInstance('switch', 60, 40, 'EN (Yetki = 1)'), id: 'dec_sw_en', state: { on: true } },
      { ...createComponentInstance('switch', 60, 95, 'A0 (Adres Bit 0)'), id: 'dec_sw_a0' },
      { ...createComponentInstance('switch', 60, 150, 'A1 (Adres Bit 1)'), id: 'dec_sw_a1' },
      { ...createComponentInstance('switch', 60, 205, 'A2 (Adres Bit 2)'), id: 'dec_sw_a2' },
      { ...createComponentInstance('decoder3to8', 210, 70, '3:8 Decoder (74HC138)'), id: 'dec_chip' },
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
        ...createComponentInstance('ram16x4', 330, 60, '16x4 Program Belleği (RAM)'),
        id: 'cpu_ram',
        state: { ramData: [3, 7, 2, 9, 12, 5, 1, 14, 0, 4, 8, 11, 15, 6, 10, 13] },
      },
      { ...createComponentInstance('switch', 220, 250, 'RAM Yazma (WE=0)'), id: 'cpu_we' },
      { ...createComponentInstance('register4', 500, 70, 'A Yazmacı (Akümülatör)'), id: 'cpu_reg_a' },
      { ...createComponentInstance('switch', 500, 10, 'A-Yazmaç İzni (WE=1)'), id: 'cpu_reg_we', state: { on: true } },
      { ...createComponentInstance('hexDisplay', 670, 70, 'Çıkış Portu (Display)'), id: 'cpu_disp' },
      { ...createComponentInstance('alu4', 500, 240, '4-Bit ALU'), id: 'cpu_alu' },
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
        ...createComponentInstance('rom16x4', 340, 90, 'Melodi ROM (Super Mario)'),
        id: 'rom_mario',
        state: { romData: [9, 9, 15, 9, 15, 7, 9, 15, 11, 15, 15, 15, 4, 15, 15, 15] },
      },
      { ...createComponentInstance('buzzer', 540, 90, 'Chiptune Piezo Buzzer'), id: 'buzz_mario' },
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
        ...createComponentInstance('rom16x4', 330, 90, 'Melodi ROM (Star Wars Fanfare)'),
        id: 'rom_ps',
        state: { romData: [4, 4, 4, 7, 7, 11, 11, 10, 9, 8, 14, 14, 11, 11, 15, 15] },
      },
      { ...createComponentInstance('hexDisplay', 490, 70, 'Nota Göstergesi (0-F)'), id: 'hex_note' },
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
    name: '8x8 LED Grafik Matrisi & Piksel Çizim Kiti (GPU)',
    category: 'music_graphics',
    description: 'Satır ve sütun mantık sinyalleriyle 64 piksellik LED matrisinde retro piksel sanatı, göz kırpma animasyonu ve grafik çizimi gerçekleştiren ekran gösterge devresi.',
    components: [
      { ...createComponentInstance('vcc', 50, 40, 'VCC (+5V)'), id: 'vcc_mat' },
      { ...createComponentInstance('switch', 50, 110, 'Göz Kırpma / Animasyon'), id: 'sw_eye', state: { on: true } },
      { ...createComponentInstance('switch', 50, 180, 'Gülümseme (Ağız)'), id: 'sw_smile', state: { on: true } },
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
    name: 'ASCII Klavye & 7-Bit Kod Çözücü Terminal Kiti',
    category: 'music_graphics',
    description: 'ASCII klavye giriş matrisi, tuşa basıldığında üretilen 7-bit ikili ASCII kodu, veri hazır strobe (ST) sinyali ve LED göstergeleriyle tam donanımlı mikrobilgisayar giriş terminali.',
    components: [
      { ...createComponentInstance('asciiKeyboard', 60, 80, 'ASCII Giriş Terminali'), id: 'kbd_unit', state: { asciiChar: 'A', asciiCode: 65, strobe: true } },
      { ...createComponentInstance('pushbutton', 60, 210, 'ST Temizle (ACK/CLR)'), id: 'btn_ack' },
      { ...createComponentInstance('hexDisplay', 260, 60, 'ASCII Hex (0-F)'), id: 'hex_ascii' },
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
      { ...createComponentInstance('clock', 50, 40, 'Piksel Saati (CLK)'), id: 'clk_gpu', state: { frequencyHz: 4 } },
      { ...createComponentInstance('counter4', 160, 40, 'X-Koordinat Sayacı'), id: 'cnt_x' },
      { ...createComponentInstance('vcc', 50, 160, 'Yazma İzni (WE=1)'), id: 'vcc_we' },
      { ...createComponentInstance('switch', 50, 230, 'Kırmızı Renk (R)'), id: 'sw_r', state: { on: true } },
      { ...createComponentInstance('switch', 50, 290, 'Yeşil Renk (G)'), id: 'sw_g', state: { on: false } },
      { ...createComponentInstance('switch', 50, 350, 'Mavi Renk (B)'), id: 'sw_b', state: { on: true } },
      { ...createComponentInstance('rgbMatrix16x16', 360, 50, '16x16 RGB Video Matrisi'), id: 'gpu_screen' },
    ].map(updatePinPositions),
    wires: [
      { id: 'w1', fromCompId: 'clk_gpu', fromPinId: 'clk_gpu_out', toCompId: 'cnt_x', toPinId: 'cnt_x_inClk', value: 0 },
      { id: 'w2', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ0', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX0', value: 0 },
      { id: 'w3', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ1', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX1', value: 0 },
      { id: 'w4', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ2', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX2', value: 0 },
      { id: 'w5', fromCompId: 'cnt_x', fromPinId: 'cnt_x_outQ3', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inX3', value: 0 },
      { id: 'w6', fromCompId: 'vcc_we', fromPinId: 'vcc_we_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inWE', value: 1 },
      { id: 'w7', fromCompId: 'sw_r', fromPinId: 'sw_r_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inR', value: 1 },
      { id: 'w8', fromCompId: 'sw_g', fromPinId: 'sw_g_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inG', value: 0 },
      { id: 'w9', fromCompId: 'sw_b', fromPinId: 'sw_b_out', toCompId: 'gpu_screen', toPinId: 'gpu_screen_inB', value: 1 },
    ],
  },
];

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
export function generateBooleanExpression(
  compId: string,
  pinIndex: number | undefined,
  components: CircuitComponentInstance[],
  wires: CircuitWire[],
  visited = new Set<string>()
): string {
  const comp = components.find((c) => c.id === compId);
  if (!comp) return '?';

  if (comp.type === 'switch' || comp.type === 'pushbutton') {
    return comp.label || (comp.type === 'switch' ? 'SW' : 'BTN');
  }
  if (comp.type === 'vcc') return '1';
  if (comp.type === 'gnd') return '0';
  if (comp.type === 'clock') return 'CLK';

  const findDriverForPin = (targetPinId: string): { comp: CircuitComponentInstance; outIdx: number } | null => {
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
    const targetRoot = findR(targetPinId);
    for (const c of components) {
      if (c.type === 'tunnel') continue;
      for (let idx = 0; idx < c.outputs.length; idx++) {
        if (findR(c.outputs[idx].id) === targetRoot) {
          return { comp: c, outIdx: idx };
        }
      }
    }
    return null;
  };

  if (comp.type === 'led' || comp.type === 'probe' || comp.type === 'buzzer') {
    const inPin = comp.inputs[0];
    if (!inPin) return '?';
    const driver = findDriverForPin(inPin.id);
    if (!driver) return '0';
    if (visited.has(comp.id)) return '...';
    const nextVisited = new Set(visited);
    nextVisited.add(comp.id);
    return generateBooleanExpression(driver.comp.id, driver.outIdx, components, wires, nextVisited);
  }

  if (visited.has(comp.id)) return '...';
  const newVisited = new Set(visited);
  newVisited.add(comp.id);

  const traceInput = (inputPinId: string): string => {
    const driver = findDriverForPin(inputPinId);
    if (!driver) return '0';
    return generateBooleanExpression(driver.comp.id, driver.outIdx, components, wires, newVisited);
  };

  const inputExprs = comp.inputs.map((p) => traceInput(p.id));

  switch (comp.type) {
    case 'not':
      return inputExprs[0].length === 1 ? `${inputExprs[0]}'` : `(${inputExprs[0]})'`;
    case 'and':
      if (inputExprs.length === 0) return '0';
      if (inputExprs.length === 1) return inputExprs[0];
      return inputExprs
        .map((e) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e))
        .join(' · ');
    case 'or':
      return inputExprs.join(' + ');
    case 'nand':
      return `(${inputExprs.map((e) => (e.includes('+') || e.includes('⊕') ? `(${e})` : e)).join(' · ')})'`;
    case 'nor':
      return `(${inputExprs.join(' + ')})'`;
    case 'xor':
      return inputExprs.join(' ⊕ ');
    case 'xnor':
      return `(${inputExprs.join(' ⊕ ')})'`;
    case 'halfAdder':
      return pinIndex === 1 ? `(${inputExprs[0]} · ${inputExprs[1]})` : `(${inputExprs[0]} ⊕ ${inputExprs[1]})`;
    case 'fullAdder':
      return pinIndex === 1
        ? `(${inputExprs[0]}·${inputExprs[1]} + ${inputExprs[2]}·(${inputExprs[0]}⊕${inputExprs[1]}))`
        : `(${inputExprs[0]} ⊕ ${inputExprs[1]} ⊕ ${inputExprs[2]})`;
    case 'halfSubtractor':
      return pinIndex === 1 ? `(${inputExprs[0]}' · ${inputExprs[1]})` : `(${inputExprs[0]} ⊕ ${inputExprs[1]})`;
    case 'fullSubtractor':
      return pinIndex === 1
        ? `(${inputExprs[0]}'·${inputExprs[1]} + (${inputExprs[0]}⊕${inputExprs[1]})'·${inputExprs[2]})`
        : `(${inputExprs[0]} ⊕ ${inputExprs[1]} ⊕ ${inputExprs[2]})`;
    case 'mux2':
      return `(${inputExprs[2]}'·${inputExprs[0]} + ${inputExprs[2]}·${inputExprs[1]})`;
    case 'demux2':
      return pinIndex === 1 ? `(${inputExprs[0]} · ${inputExprs[1]})` : `(${inputExprs[0]} · ${inputExprs[1]}')`;
    case 'triState':
      return `(${inputExprs[1]} ? ${inputExprs[0]} : Z)`;
    default:
      return `${comp.label || comp.type}`;
  }
}

/**
 * Automatically compute Truth Table (2^N combinations) for canvas circuit
 */
export function generateTruthTable(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): TruthTableData | null {
  // 1. Identify input switches & buttons
  const switchComps = components.filter((c) => c.type === 'switch' || c.type === 'pushbutton');
  if (switchComps.length === 0) return null;
  // Limit to max 6 switches (max 64 rows)
  const activeSwitches = switchComps.slice(0, 6);

  // 2. Identify observable outputs (LEDs, Probes, Buzzer, or output pins of gates/blocks)
  const outputList: { id: string; name: string; compId: string; pinIndex?: number }[] = [];
  components.forEach((c) => {
    if (c.type === 'led' || c.type === 'probe' || c.type === 'buzzer') {
      outputList.push({
        id: c.id,
        name: c.label || (c.type === 'led' ? 'LED' : c.type === 'buzzer' ? 'Buzzer' : 'Prob'),
        compId: c.id,
      });
    } else if (
      c.outputs.length > 0 &&
      c.type !== 'switch' &&
      c.type !== 'pushbutton' &&
      c.type !== 'clock' &&
      c.type !== 'vcc' &&
      c.type !== 'gnd' &&
      c.type !== 'dipSwitch4' &&
      c.type !== 'asciiKeyboard' &&
      c.type !== 'dotMatrix8x8' &&
      c.type !== 'rgbMatrix16x16' &&
      c.type !== 'textLabel'
    ) {
      c.outputs.forEach((pin, pIdx) => {
        outputList.push({
          id: pin.id,
          name: `${c.label || c.type}.${pin.name}`,
          compId: c.id,
          pinIndex: pIdx,
        });
      });
    }
  });

  if (outputList.length === 0) return null;

  const numCombinations = Math.pow(2, activeSwitches.length);
  const rows: TruthTableData['rows'] = [];

  // Determine current live inputs
  const currentInputs = activeSwitches.map((s) => (s.state.on ? 1 : 0));

  for (let i = 0; i < numCombinations; i++) {
    // Generate binary representation
    const inputVals: LogicValue[] = [];
    for (let bit = activeSwitches.length - 1; bit >= 0; bit--) {
      inputVals.push(((i >> bit) & 1) as LogicValue);
    }

    // Clone components with new input switch states
    const testComps = components.map((c) => {
      const sIdx = activeSwitches.findIndex((s) => s.id === c.id);
      if (sIdx !== -1) {
        return {
          ...c,
          state: { ...c.state, on: inputVals[sIdx] === 1 },
        };
      }
      return c;
    });

    const sim = simulateCircuit(testComps, wires);

    // Read outputs
    const outputVals: LogicValue[] = outputList.map((out) => {
      const found = sim.components.find((c) => c.id === out.compId);
      if (!found) return 0;
      if (found.type === 'led' || found.type === 'probe' || found.type === 'buzzer') {
        return (found.inputs[0]?.value === 1 ? 1 : 0) as LogicValue;
      }
      if (out.pinIndex !== undefined && found.outputs[out.pinIndex]) {
        return (found.outputs[out.pinIndex].value === 1 ? 1 : 0) as LogicValue;
      }
      return 0;
    });

    const isCurrent = inputVals.every((v, idx) => v === currentInputs[idx]);

    rows.push({
      inputValues: inputVals,
      outputValues: outputVals,
      isCurrentState: isCurrent,
    });
  }

  // Extract Boolean algebraic expression for each output
  const booleanExpressions: { [outputName: string]: string } = {};
  outputList.forEach((out) => {
    const expr = generateBooleanExpression(out.compId, out.pinIndex, components, wires);
    if (expr && expr !== '?' && expr !== '0') {
      booleanExpressions[out.name] = expr;
    }
  });

  // Extract minimal SOP expressions via Quine-McCluskey
  const minimalExpressions: {
    [outputName: string]: {
      expression: string;
      primeImplicants: string[];
      essentialImplicants: string[];
    };
  } = {};

  const varNames = activeSwitches.map((s) => s.label || 'Giriş');
  outputList.forEach((out, outIdx) => {
    const mintermIndices: number[] = [];
    rows.forEach((r, rIdx) => {
      if (r.outputValues[outIdx] === 1) {
        mintermIndices.push(rIdx);
      }
    });
    minimalExpressions[out.name] = minimizeBooleanExpression(varNames, mintermIndices);
  });

  return {
    inputs: activeSwitches.map((s) => ({ id: s.id, name: s.label || 'Giriş' })),
    outputs: outputList.map((o) => ({ id: o.id, name: o.name })),
    booleanExpressions,
    minimalExpressions,
    rows,
  };
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
  if (minterms.length === Math.pow(2, n)) {
    return { expression: '1', primeImplicants: ['1'], essentialImplicants: ['1'] };
  }

  const allTerms = Array.from(new Set([...minterms, ...dontCares]));

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
  let chosenPIs = [...essentialPIs];

  if (remainingMinterms.length > 0) {
    const nonEssentialPIs = primeImplicants.filter(
      (pi) => !essentialPIs.some((e) => e.mask === pi.mask)
    );
    let uncovered = [...remainingMinterms];
    while (uncovered.length > 0 && nonEssentialPIs.length > 0) {
      nonEssentialPIs.sort((a, b) => {
        const countA = uncovered.filter((m) => covers(a.mask, m)).length;
        const countB = uncovered.filter((m) => covers(b.mask, m)).length;
        return countB - countA;
      });
      const best = nonEssentialPIs.shift();
      if (!best) break;
      chosenPIs.push(best);
      uncovered = uncovered.filter((m) => !covers(best.mask, m));
    }
  }

  function maskToExpression(mask: string) {
    let term = '';
    for (let i = 0; i < n; i++) {
      const bit = mask[i];
      const v = varNames[i] || `X${i}`;
      if (bit === '1') {
        term += v;
      } else if (bit === '0') {
        term += `${v}'`;
      }
    }
    return term === '' ? '1' : term;
  }

  const termsExpr = chosenPIs.map((pi) => maskToExpression(pi.mask));
  const finalExpr = termsExpr.length > 0 ? termsExpr.join(' + ') : '0';

  return {
    expression: finalExpr,
    primeImplicants: primeImplicants.map((pi) => maskToExpression(pi.mask)),
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
    } else if (/[A-Za-z0-9_]/.test(ch)) {
      let varName = '';
      while (i < expr.length && /[A-Za-z0-9_]/.test(expr[i])) {
        varName += expr[i];
        i++;
      }
      tokens.push({ type: 'var', value: varName });
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
    while (peek() && peek()!.type === 'op' && peek()!.value === '^') {
      consume('^');
      const right = parseAnd();
      if (node.type === 'xor' && node.children) {
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
 * Automatically layout and wire a digital circuit from a parsed Boolean AST
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

  // 1. Collect all unique variable names
  const varSet = new Set<string>();
  function collectVars(node: ASTNode) {
    if (node.type === 'var' && node.name) varSet.add(node.name);
    if (node.child) collectVars(node.child);
    if (node.children) node.children.forEach(collectVars);
  }
  collectVars(ast);
  const vars = Array.from(varSet).sort();
  if (vars.length === 0) {
    throw new Error('İfadede en az 1 mantıksal değişken (A, B vb.) bulunmalıdır.');
  }

  const components: CircuitComponentInstance[] = [];
  const wires: CircuitWire[] = [];

  // 2. Create switches on the left column
  const switchMap = new Map<string, CircuitComponentInstance>();
  vars.forEach((vName, idx) => {
    const sw = createComponentInstance('switch', startX, startY + idx * 80, `Giriş ${vName}`);
    components.push(updatePinPositions(sw));
    switchMap.set(vName, sw);
  });

  let nextGateId = 1;
  let nextWireId = 1;

  function buildSubcircuit(node: ASTNode, depth: number, yPos: number): { comp: CircuitComponentInstance; outputPinId: string; height: number } {
    if (node.type === 'var') {
      const sw = switchMap.get(node.name!)!;
      return { comp: sw, outputPinId: sw.outputs[0].id, height: 60 };
    }

    const colX = startX + 120 + depth * 140;

    if (node.type === 'not') {
      const childRes = buildSubcircuit(node.child!, depth, yPos);
      const notComp = createComponentInstance('not', colX, yPos, `NOT_${nextGateId++}`);
      const refreshedNot = updatePinPositions(notComp);
      components.push(refreshedNot);

      wires.push({
        id: `wire_synth_${Date.now()}_${nextWireId++}`,
        fromCompId: childRes.comp.id,
        fromPinId: childRes.outputPinId,
        toCompId: refreshedNot.id,
        toPinId: refreshedNot.inputs[0].id,
        value: 0,
      });

      return { comp: refreshedNot, outputPinId: refreshedNot.outputs[0].id, height: 50 };
    }

    let actualGateType: ComponentType = node.type === 'and' ? 'and' : node.type === 'xor' ? 'xor' : 'or';
    if (gateMode === 'nand') {
      actualGateType = 'nand';
    } else if (gateMode === 'nor') {
      actualGateType = 'nor';
    }

    const children = node.children || [];
    const childResults: { comp: CircuitComponentInstance; outputPinId: string; height: number }[] = [];

    let curY = yPos;
    children.forEach((child) => {
      const res = buildSubcircuit(child, depth, curY);
      childResults.push(res);
      curY += res.height + 20;
    });

    const midY = Math.round((yPos + curY - 20) / 2) - 24;
    const gateComp = createComponentInstance(actualGateType, colX, Math.max(startY - 20, midY), `${actualGateType.toUpperCase()}_${nextGateId++}`);

    if (children.length > 2) {
      const numInputs = Math.min(5, children.length);
      const meta = COMPONENT_CATALOG[actualGateType];
      gateComp.inputs = Array.from({ length: numInputs }).map((_, idx) => {
        const pinId = `${gateComp.id}_in_${idx}`;
        const spacing = meta.height / (numInputs + 1);
        const relY = Math.round(spacing * (idx + 1));
        return {
          id: pinId,
          name: String.fromCharCode(65 + idx),
          type: 'input' as const,
          value: 0 as LogicValue,
          x: gateComp.x,
          y: gateComp.y + relY,
        };
      });
      gateComp.state.gateInputsCount = numInputs;
    }

    const refreshedGate = updatePinPositions(gateComp);
    components.push(refreshedGate);

    childResults.forEach((cRes, idx) => {
      if (refreshedGate.inputs[idx]) {
        wires.push({
          id: `wire_synth_${Date.now()}_${nextWireId++}`,
          fromCompId: cRes.comp.id,
          fromPinId: cRes.outputPinId,
          toCompId: refreshedGate.id,
          toPinId: refreshedGate.inputs[idx].id,
          value: 0,
        });
      }
    });

    return { comp: refreshedGate, outputPinId: refreshedGate.outputs[0].id, height: curY - yPos };
  }

  const rootResult = buildSubcircuit(ast, 1, startY);

  const finalLed = createComponentInstance('led', rootResult.comp.x + 130, rootResult.comp.y, outLabel);
  const refreshedLed = updatePinPositions(finalLed);
  components.push(refreshedLed);

  wires.push({
    id: `wire_synth_${Date.now()}_${nextWireId++}`,
    fromCompId: rootResult.comp.id,
    fromPinId: rootResult.outputPinId,
    toCompId: refreshedLed.id,
    toPinId: refreshedLed.inputs[0].id,
    value: 0,
  });

  const sim = simulateCircuit(components, wires);
  return { components: sim.components, wires: sim.wires };
}
