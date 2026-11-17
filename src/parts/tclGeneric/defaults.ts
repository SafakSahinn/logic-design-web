// Default texts of a new TCL Generic part.
//
// The interface is Logisim-evolution's own default (resources/logisim/tcl/entity.templ), so a part made here and
// one made in evo start with the same pins. The script is a small example of evo's TCL Generic protocol.

export const DEFAULT_INTERFACE = `library ieee;
use ieee.std_logic_1164.all;

entity TCL_Generic is
  port(
    --Insert input ports below
    horloge_i  : in  std_logic;                    -- input bit example
    val_i      : in  std_logic_vector(3 downto 0); -- input vector example

    --Insert output ports below
    max_o      : out std_logic;                    -- output bit example
    cpt_o      : out std_logic_Vector(3 downto 0)  -- output vector example
  );
end TCL_Generic;
`;

export const DEFAULT_SCRIPT = `# TCL Generic script (the protocol of Logisim-evolution's TCL Generic).
#
# logisimForce runs once on every simulation tick: read inputs with
# [examine name] and set outputs with [force name value]. Values are
# binary strings, most significant bit first ("x" = unknown bit).
# An output the script does not force on a tick is unknown (X).
# logisimExamine runs when an input changes between ticks; it cannot
# change the outputs. [echo text] writes to the console of the editor.
#
# Example: a 4-bit counter that counts rising edges of horloge_i;
# max_o is 1 while the count equals val_i.

set count 0
set lastClock 0

proc toBinary {value width} {
  set bits ""
  for {set i [expr {$width - 1}]} {$i >= 0} {incr i -1} {
    append bits [expr {($value >> $i) & 1}]
  }
  return $bits
}

proc logisimForce {} {
  global count lastClock
  set clock [examine horloge_i]
  if {$clock eq "1" && $lastClock eq "0"} {
    set count [expr {($count + 1) % 16}]
  }
  set lastClock $clock
  force cpt_o [toBinary $count 4]

  set limit [examine val_i]
  if {[regexp {^[01]+$} $limit] && [scan $limit %b value] == 1} {
    force max_o [expr {$count == $value}]
  } else {
    force max_o x
  }
}

proc logisimExamine {} {
  # nothing to do between ticks
}
`;
