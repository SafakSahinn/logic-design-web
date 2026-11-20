// Helper modules of the generated FPGA top level (Aşama 6i-4): the LED array drivers, the multiplexed 7-segment
// display drivers and the clock divider. Module, parameter and port names follow Logisim-evolution
// (std/io/LedArray*HdlGeneratorFactory, RgbArray*, SevenSegmentScanning*), whose behaviour they port: a scanning
// driver steps to the next row / column / digit at 1 kHz of the board clock, counting down from the last one, and
// inverts what it drives when the board resource is active low (the address / digit number never). evo's RGB
// scanning modules take the red input for all three colors in VHDL and its Verilog does not compile; here each
// color has its own input.
import type { DriverPlan } from './plan';

export type HdlLang = 'verilog' | 'vhdl';

export type HelperModule =
  | 'LogisimClockDivider'
  | 'LedArrayLedDefault'
  | 'RGBArrayLedDefault'
  | 'LedArrayRowScanning'
  | 'RGBArrayRowScanning'
  | 'LedArrayColumnScanning'
  | 'RGBArrayColumnScanning'
  | 'SevenSegmentScanningDecoded'
  | 'SevenSegmentScanning';

/** Output ports of a 7-segment driver, segment a .. g then the decimal point (evo SevenSegment labels) */
export const SEGMENT_PORTS = ['Segment_A', 'Segment_B', 'Segment_C', 'Segment_D', 'Segment_E', 'Segment_F', 'Segment_G', 'DecimalPoint'];

/** The helper module a driver is an instance of */
export function driverModule(d: DriverPlan): HelperModule {
  if (d.kind === 'scanning') return d.drive === 'decoded' ? 'SevenSegmentScanningDecoded' : 'SevenSegmentScanning';
  switch (d.drive) {
    case 'ledDefault':
      return 'LedArrayLedDefault';
    case 'rgbDefault':
      return 'RGBArrayLedDefault';
    case 'ledRowScanning':
      return 'LedArrayRowScanning';
    case 'rgbRowScanning':
      return 'RGBArrayRowScanning';
    case 'ledColumnScanning':
      return 'LedArrayColumnScanning';
    case 'rgbColumnScanning':
      return 'RGBArrayColumnScanning';
  }
}

/** Reload value and width of the 1 kHz scanning counter (evo: fpgaClockFrequency / 1000 - 1) */
export function scanningCounter(oscillatorHz: number): { reload: number; bits: number } {
  const reload = Math.max(0, Math.min(0x7fffffff, Math.floor(oscillatorHz / 1000) - 1));
  let bits = 1;
  while (reload >= 2 ** bits) bits++;
  return { reload, bits };
}

const COLORS = ['Red', 'Green', 'Blue'] as const;

/** Text of a helper module */
export function helperModuleText(name: HelperModule, lang: HdlLang): string {
  const v = lang === 'verilog';
  switch (name) {
    case 'LogisimClockDivider':
      return v ? clockDividerVerilog() : clockDividerVhdl();
    case 'LedArrayLedDefault':
      return v ? defaultVerilog(name, false) : defaultVhdl(name, false);
    case 'RGBArrayLedDefault':
      return v ? defaultVerilog(name, true) : defaultVhdl(name, true);
    case 'LedArrayRowScanning':
      return v ? scanVerilog(name, 'row', false) : scanVhdl(name, 'row', false);
    case 'RGBArrayRowScanning':
      return v ? scanVerilog(name, 'row', true) : scanVhdl(name, 'row', true);
    case 'LedArrayColumnScanning':
      return v ? scanVerilog(name, 'column', false) : scanVhdl(name, 'column', false);
    case 'RGBArrayColumnScanning':
      return v ? scanVerilog(name, 'column', true) : scanVhdl(name, 'column', true);
    case 'SevenSegmentScanningDecoded':
      return v ? sevenSegVerilog(name, true) : sevenSegVhdl(name, true);
    case 'SevenSegmentScanning':
      return v ? sevenSegVerilog(name, false) : sevenSegVhdl(name, false);
  }
}

const VHDL_LIBS = ['library IEEE;', 'use IEEE.STD_LOGIC_1164.ALL;', 'use IEEE.NUMERIC_STD.ALL;', ''];

// --- clock divider -----------------------------------------------------------------------------------------

function clockDividerVerilog(): string {
  return [
    '// Divides the board clock: the output toggles every HALF_PERIOD board clock cycles',
    'module LogisimClockDivider #(',
    '  parameter HALF_PERIOD = 1,',
    '  parameter COUNTER_BITS = 1',
    ') (',
    '  input wire fpgaGlobalClock,',
    '  output wire clockOut',
    ');',
    '  reg [COUNTER_BITS-1:0] s_countReg = 0;',
    "  reg s_clockReg = 1'b0;",
    '',
    '  always @(posedge fpgaGlobalClock) begin',
    '    if (s_countReg == HALF_PERIOD - 1) begin',
    '      s_countReg <= 0;',
    '      s_clockReg <= ~s_clockReg;',
    '    end else begin',
    '      s_countReg <= s_countReg + 1;',
    '    end',
    '  end',
    '',
    '  assign clockOut = s_clockReg;',
    'endmodule',
  ].join('\n');
}

function clockDividerVhdl(): string {
  return [
    ...VHDL_LIBS,
    '-- Divides the board clock: the output toggles every HALF_PERIOD board clock cycles',
    'entity LogisimClockDivider is',
    '  generic (',
    '    HALF_PERIOD : integer := 1;',
    '    COUNTER_BITS : integer := 1',
    '  );',
    '  port (',
    '    fpgaGlobalClock : in std_logic;',
    '    clockOut : out std_logic',
    '  );',
    'end entity LogisimClockDivider;',
    '',
    'architecture Behavioral of LogisimClockDivider is',
    "  signal s_countReg : unsigned(COUNTER_BITS-1 downto 0) := (others => '0');",
    "  signal s_clockReg : std_logic := '0';",
    'begin',
    '  divide : process (fpgaGlobalClock) is',
    '  begin',
    '    if rising_edge(fpgaGlobalClock) then',
    '      if s_countReg = to_unsigned(HALF_PERIOD - 1, COUNTER_BITS) then',
    "        s_countReg <= (others => '0');",
    '        s_clockReg <= not s_clockReg;',
    '      else',
    '        s_countReg <= s_countReg + 1;',
    '      end if;',
    '    end if;',
    '  end process divide;',
    '',
    '  clockOut <= s_clockReg;',
    'end architecture Behavioral;',
  ].join('\n');
}

// --- LED arrays, default drive (one FPGA pin per LED) -------------------------------------------------------

function defaultVerilog(name: string, rgb: boolean): string {
  const sets = rgb ? COLORS.map((c) => ({ ins: `internal${c}Leds`, outs: `external${c}Leds` })) : [{ ins: 'internalLeds', outs: 'externalLeds' }];
  return [
    `// LED array, one FPGA pin per LED${rgb ? ' and color' : ''}`,
    `module ${name} #(`,
    '  parameter nrOfLeds = 1,',
    '  parameter activeLow = 0',
    ') (',
    [...sets.map((s) => `  input wire [nrOfLeds-1:0] ${s.ins}`), ...sets.map((s) => `  output wire [nrOfLeds-1:0] ${s.outs}`)].join(',\n'),
    ');',
    ...sets.map((s) => `  assign ${s.outs} = (activeLow != 0) ? ~${s.ins} : ${s.ins};`),
    'endmodule',
  ].join('\n');
}

function defaultVhdl(name: string, rgb: boolean): string {
  const sets = rgb ? COLORS.map((c) => ({ ins: `internal${c}Leds`, outs: `external${c}Leds` })) : [{ ins: 'internalLeds', outs: 'externalLeds' }];
  return [
    ...VHDL_LIBS,
    `-- LED array, one FPGA pin per LED${rgb ? ' and color' : ''}`,
    `entity ${name} is`,
    '  generic (',
    '    nrOfLeds : integer := 1;',
    '    activeLow : integer := 0',
    '  );',
    '  port (',
    [...sets.map((s) => `    ${s.ins} : in std_logic_vector(nrOfLeds-1 downto 0)`), ...sets.map((s) => `    ${s.outs} : out std_logic_vector(nrOfLeds-1 downto 0)`)].join(';\n'),
    '  );',
    `end entity ${name};`,
    '',
    `architecture Behavioral of ${name} is`,
    'begin',
    ...sets.map((s) => `  ${s.outs} <= ${s.ins} when activeLow = 0 else not ${s.ins};`),
    'end architecture Behavioral;',
  ].join('\n');
}

// --- LED arrays, row / column scanning ----------------------------------------------------------------------

/**
 * Row scanning: the address picks a row, the column pins carry that row's LEDs (LED index = row x columns +
 * column). Column scanning: the address picks a column, the row pins carry that column's LEDs.
 */
function scanNames(dim: 'row' | 'column', rgb: boolean) {
  const row = dim === 'row';
  const addr = row ? 'rowAddress' : 'columnAddress';
  const addrBits = row ? 'nrOfRowAddressBits' : 'nrOfColumnAddressBits';
  const count = row ? 'nrOfRows' : 'nrOfColumns';
  const lines = row ? 'nrOfColumns' : 'nrOfRows';
  const outBase = row ? 'column' : 'row';
  const sets = rgb ? COLORS.map((c) => ({ ins: `internal${c}Leds`, outs: `${outBase}${c}Leds` })) : [{ ins: 'internalLeds', outs: `${outBase}Leds` }];
  return { row, addr, addrBits, count, lines, sets };
}

function scanVerilog(name: string, dim: 'row' | 'column', rgb: boolean): string {
  const n = scanNames(dim, rgb);
  const index = n.row ? 'nrOfColumns * s_counterReg + i' : 'nrOfColumns * i + s_counterReg';
  return [
    `// LED array, ${dim} scanning${rgb ? ', RGB' : ''}`,
    `module ${name} #(`,
    '  parameter nrOfRows = 1,',
    '  parameter nrOfColumns = 1,',
    `  parameter ${n.addrBits} = 1,`,
    '  parameter activeLow = 0,',
    '  parameter nrOfScanningCounterBits = 1,',
    '  parameter scanningCounterReloadValue = 0',
    ') (',
    [
      '  input wire fpgaGlobalClock',
      ...n.sets.map((s) => `  input wire [nrOfRows*nrOfColumns-1:0] ${s.ins}`),
      `  output wire [${n.addrBits}-1:0] ${n.addr}`,
      ...n.sets.map((s) => `  output wire [${n.lines}-1:0] ${s.outs}`),
    ].join(',\n'),
    ');',
    `  reg [${n.addrBits}-1:0] s_counterReg = 0;`,
    '  reg [nrOfScanningCounterBits-1:0] s_scanningCounterReg = 0;',
    '',
    '  always @(posedge fpgaGlobalClock) begin',
    '    if (s_scanningCounterReg == 0) begin',
    '      s_scanningCounterReg <= scanningCounterReloadValue;',
    `      s_counterReg <= (s_counterReg == 0) ? ${n.count} - 1 : s_counterReg - 1;`,
    '    end else begin',
    '      s_scanningCounterReg <= s_scanningCounterReg - 1;',
    '    end',
    '  end',
    '',
    `  assign ${n.addr} = s_counterReg;`,
    '',
    '  genvar i;',
    '  generate',
    `    for (i = 0; i < ${n.lines}; i = i + 1) begin : outputs`,
    ...n.sets.map((s) => `      assign ${s.outs}[i] = (activeLow != 0) ? ~${s.ins}[${index}] : ${s.ins}[${index}];`),
    '    end',
    '  endgenerate',
    'endmodule',
  ].join('\n');
}

function scanVhdl(name: string, dim: 'row' | 'column', rgb: boolean): string {
  const n = scanNames(dim, rgb);
  const index = n.row ? 'nrOfColumns * to_integer(s_counterReg) + i' : 'nrOfColumns * i + to_integer(s_counterReg)';
  return [
    ...VHDL_LIBS,
    `-- LED array, ${dim} scanning${rgb ? ', RGB' : ''}`,
    `entity ${name} is`,
    '  generic (',
    '    nrOfRows : integer := 1;',
    '    nrOfColumns : integer := 1;',
    `    ${n.addrBits} : integer := 1;`,
    '    activeLow : integer := 0;',
    '    nrOfScanningCounterBits : integer := 1;',
    '    scanningCounterReloadValue : integer := 0',
    '  );',
    '  port (',
    [
      '    fpgaGlobalClock : in std_logic',
      ...n.sets.map((s) => `    ${s.ins} : in std_logic_vector(nrOfRows*nrOfColumns-1 downto 0)`),
      `    ${n.addr} : out std_logic_vector(${n.addrBits}-1 downto 0)`,
      ...n.sets.map((s) => `    ${s.outs} : out std_logic_vector(${n.lines}-1 downto 0)`),
    ].join(';\n'),
    '  );',
    `end entity ${name};`,
    '',
    `architecture Behavioral of ${name} is`,
    `  signal s_counterReg : unsigned(${n.addrBits}-1 downto 0) := (others => '0');`,
    "  signal s_scanningCounterReg : unsigned(nrOfScanningCounterBits-1 downto 0) := (others => '0');",
    'begin',
    '  scan : process (fpgaGlobalClock) is',
    '  begin',
    '    if rising_edge(fpgaGlobalClock) then',
    '      if s_scanningCounterReg = 0 then',
    '        s_scanningCounterReg <= to_unsigned(scanningCounterReloadValue, nrOfScanningCounterBits);',
    '        if s_counterReg = 0 then',
    `          s_counterReg <= to_unsigned(${n.count} - 1, ${n.addrBits});`,
    '        else',
    '          s_counterReg <= s_counterReg - 1;',
    '        end if;',
    '      else',
    '        s_scanningCounterReg <= s_scanningCounterReg - 1;',
    '      end if;',
    '    end if;',
    '  end process scan;',
    '',
    `  ${n.addr} <= std_logic_vector(s_counterReg);`,
    '',
    `  genOutputs : for i in 0 to ${n.lines} - 1 generate`,
    ...n.sets.map((s) => `    ${s.outs}(i) <= ${s.ins}(${index}) when activeLow = 0 else not ${s.ins}(${index});`),
    '  end generate genOutputs;',
    'end architecture Behavioral;',
  ].join('\n');
}

// --- multiplexed 7-segment displays ---------------------------------------------------------------------------

/**
 * Decoded: the digit number goes out on the select pins. Selected: one select pin per digit, the active one at 1
 * (or at 0 with activeLowSelectPins). The segment inputs are digit x 8 + segment (a .. g, dp).
 */
function sevenSegVerilog(name: string, decoded: boolean): string {
  const selectWidth = decoded ? 'nrOfControl' : 'nrOfDigits';
  const select = decoded ? 'digitDecodedSelect' : 'digitSelect';
  return [
    `// Multiplexed 7-segment display, ${decoded ? 'digit number on the select pins' : 'one select pin per digit'}`,
    `module ${name} #(`,
    '  parameter nrOfDigits = 1,',
    '  parameter nrOfControl = 1,',
    '  parameter activeLow = 0,',
    ...(decoded ? [] : ['  parameter activeLowSelectPins = 0,']),
    '  parameter nrOfScanningCounterBits = 1,',
    '  parameter scanningCounterReloadValue = 0',
    ') (',
    [
      '  input wire fpgaGlobalClock',
      '  input wire [nrOfDigits*8-1:0] allSegments',
      `  output wire [${selectWidth}-1:0] ${select}`,
      ...SEGMENT_PORTS.map((s) => `  output wire ${s}`),
    ].join(',\n'),
    ');',
    '  reg [nrOfControl-1:0] s_digitReg = 0;',
    '  reg [nrOfScanningCounterBits-1:0] s_scanningCounterReg = 0;',
    '',
    '  always @(posedge fpgaGlobalClock) begin',
    '    if (s_scanningCounterReg == 0) begin',
    '      s_scanningCounterReg <= scanningCounterReloadValue;',
    '      s_digitReg <= (s_digitReg == 0) ? nrOfDigits - 1 : s_digitReg - 1;',
    '    end else begin',
    '      s_scanningCounterReg <= s_scanningCounterReg - 1;',
    '    end',
    '  end',
    '',
    ...SEGMENT_PORTS.map((s, i) => `  assign ${s} = (activeLow != 0) ? ~allSegments[s_digitReg * 8 + ${i}] : allSegments[s_digitReg * 8 + ${i}];`),
    '',
    ...(decoded
      ? [`  assign ${select} = s_digitReg;`]
      : [
          '  genvar n;',
          '  generate',
          '    for (n = 0; n < nrOfDigits; n = n + 1) begin : selects',
          `      assign ${select}[n] = (s_digitReg == n) ? (activeLowSelectPins == 0) : (activeLowSelectPins != 0);`,
          '    end',
          '  endgenerate',
        ]),
    'endmodule',
  ].join('\n');
}

function sevenSegVhdl(name: string, decoded: boolean): string {
  const selectWidth = decoded ? 'nrOfControl' : 'nrOfDigits';
  const select = decoded ? 'digitDecodedSelect' : 'digitSelect';
  return [
    ...VHDL_LIBS,
    `-- Multiplexed 7-segment display, ${decoded ? 'digit number on the select pins' : 'one select pin per digit'}`,
    `entity ${name} is`,
    '  generic (',
    '    nrOfDigits : integer := 1;',
    '    nrOfControl : integer := 1;',
    '    activeLow : integer := 0;',
    ...(decoded ? [] : ['    activeLowSelectPins : integer := 0;']),
    '    nrOfScanningCounterBits : integer := 1;',
    '    scanningCounterReloadValue : integer := 0',
    '  );',
    '  port (',
    [
      '    fpgaGlobalClock : in std_logic',
      '    allSegments : in std_logic_vector(nrOfDigits*8-1 downto 0)',
      `    ${select} : out std_logic_vector(${selectWidth}-1 downto 0)`,
      ...SEGMENT_PORTS.map((s) => `    ${s} : out std_logic`),
    ].join(';\n'),
    '  );',
    `end entity ${name};`,
    '',
    `architecture Behavioral of ${name} is`,
    "  signal s_digitReg : unsigned(nrOfControl-1 downto 0) := (others => '0');",
    "  signal s_scanningCounterReg : unsigned(nrOfScanningCounterBits-1 downto 0) := (others => '0');",
    'begin',
    '  scan : process (fpgaGlobalClock) is',
    '  begin',
    '    if rising_edge(fpgaGlobalClock) then',
    '      if s_scanningCounterReg = 0 then',
    '        s_scanningCounterReg <= to_unsigned(scanningCounterReloadValue, nrOfScanningCounterBits);',
    '        if s_digitReg = 0 then',
    '          s_digitReg <= to_unsigned(nrOfDigits - 1, nrOfControl);',
    '        else',
    '          s_digitReg <= s_digitReg - 1;',
    '        end if;',
    '      else',
    '        s_scanningCounterReg <= s_scanningCounterReg - 1;',
    '      end if;',
    '    end if;',
    '  end process scan;',
    '',
    ...SEGMENT_PORTS.map(
      (s, i) => `  ${s} <= allSegments(to_integer(s_digitReg) * 8 + ${i}) when activeLow = 0 else not allSegments(to_integer(s_digitReg) * 8 + ${i});`
    ),
    '',
    ...(decoded
      ? [`  ${select} <= std_logic_vector(s_digitReg);`]
      : [
          '  genSelects : for n in 0 to nrOfDigits - 1 generate',
          `    ${select}(n) <= '1' when (s_digitReg = to_unsigned(n, nrOfControl)) = (activeLowSelectPins = 0) else '0';`,
          '  end generate genSelects;',
        ]),
    'end architecture Behavioral;',
  ].join('\n');
}
