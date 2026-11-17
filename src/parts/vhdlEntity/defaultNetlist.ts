// GENERATED from defaultVhdl.ts by synthesizeVhdl (ghdl 6.0.0 + yosys 0.71); regenerate when the text changes.
import type { StoredNetlist } from '../../hdl';

export const DEFAULT_NETLIST: StoredNetlist = {
  "blif": "\r\n.model counter4\r\n.inputs clk rst en\r\n.outputs q[0] q[1] q[2] q[3] max\r\n.names $false\r\n.names $true\r\n1\r\n.names $undef\r\n.subckt $_NOT_ A=n17[0] Y=n6[0]\r\n.subckt $_AND_ A=n17[0] B=n17[1] Y=$abc$168$new_n11\r\n.subckt $_AND_ A=n17[2] B=$abc$168$new_n11 Y=$abc$168$new_n12\r\n.subckt $_AND_ A=n17[3] B=$abc$168$new_n12 Y=max\r\n.subckt $_XOR_ A=n17[3] B=$abc$168$new_n12 Y=n6[3]\r\n.subckt $_XOR_ A=n17[0] B=n17[1] Y=n6[1]\r\n.subckt $_XOR_ A=n17[2] B=$abc$168$new_n11 Y=n6[2]\r\n.subckt $_SDFFE_PP0P_ C=clk D=n6[0] E=en Q=n17[0] R=rst\r\n.subckt $_SDFFE_PP0P_ C=clk D=n6[1] E=en Q=n17[1] R=rst\r\n.subckt $_SDFFE_PP0P_ C=clk D=n6[2] E=en Q=n17[2] R=rst\r\n.subckt $_SDFFE_PP0P_ C=clk D=n6[3] E=en Q=n17[3] R=rst\r\n.names max n14\r\n1 1\r\n.names max n15\r\n1 1\r\n.names n17[0] r[0]\r\n1 1\r\n.names n17[1] r[1]\r\n1 1\r\n.names n17[2] r[2]\r\n1 1\r\n.names n17[3] r[3]\r\n1 1\r\n.names n17[0] q[0]\r\n1 1\r\n.names n17[1] q[1]\r\n1 1\r\n.names n17[2] q[2]\r\n1 1\r\n.names n17[3] q[3]\r\n1 1\r\n.end\r\n",
  "top": "counter4",
  "inputs": [
    {
      "name": "clk",
      "width": 1
    },
    {
      "name": "rst",
      "width": 1
    },
    {
      "name": "en",
      "width": 1
    }
  ],
  "outputs": [
    {
      "name": "q",
      "width": 4
    },
    {
      "name": "max",
      "width": 1
    }
  ]
};
