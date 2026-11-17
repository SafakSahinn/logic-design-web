// The text of a new VHDL Entity part. Its synthesized netlist is in defaultNetlist.ts, so a new part
// simulates at once, also where GHDL is not available (the web).
export const DEFAULT_VHDL = `-- 4-bit counter. Edit the text, then Synthesize (desktop app, GHDL + Yosys).
library ieee;
use ieee.std_logic_1164.all;
use ieee.numeric_std.all;

entity counter4 is
  port (
    clk : in  std_logic;
    rst : in  std_logic;                     -- synchronous reset
    en  : in  std_logic;
    q   : out std_logic_vector(3 downto 0);
    max : out std_logic                      -- q = 15
  );
end counter4;

architecture rtl of counter4 is
  signal r : unsigned(3 downto 0);
begin
  process (clk)
  begin
    if rising_edge(clk) then
      if rst = '1' then
        r <= (others => '0');
      elsif en = '1' then
        r <= r + 1;
      end if;
    end if;
  end process;

  q   <= std_logic_vector(r);
  max <= '1' when r = 15 else '0';
end rtl;
`;
