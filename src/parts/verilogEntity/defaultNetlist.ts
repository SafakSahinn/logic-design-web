// GENERATED from defaultVerilog.ts by synthesizeVerilog (yosys 0.71); regenerate when the text changes.
import type { StoredNetlist } from '../../hdl';

export const DEFAULT_NETLIST: StoredNetlist = {
  "blif": "\r\n.model counter\r\n.inputs clk rst en\r\n.outputs q[0] q[1] q[2] q[3] max\r\n.names $false\r\n.names $true\r\n1\r\n.names $undef\r\n.subckt $_NOT_ A=q[0] Y=$auto$alumacc.cc:578:replace_alu$12.P[0]\r\n.subckt $_AND_ A=q[1] B=q[0] Y=$abc$150$new_n11\r\n.subckt $_XOR_ A=q[1] B=q[0] Y=$auto$alumacc.cc:578:replace_alu$12.Y[1]\r\n.subckt $_AND_ A=q[2] B=$abc$150$new_n11 Y=$abc$150$new_n13\r\n.subckt $_AND_ A=q[3] B=$abc$150$new_n13 Y=max\r\n.subckt $_XOR_ A=q[3] B=$abc$150$new_n13 Y=$auto$alumacc.cc:578:replace_alu$12.Y[3]\r\n.subckt $_XOR_ A=q[2] B=$abc$150$new_n11 Y=$auto$alumacc.cc:578:replace_alu$12.Y[2]\r\n.subckt $_SDFFE_PP0P_ C=clk D=$auto$alumacc.cc:578:replace_alu$12.P[0] E=en Q=q[0] R=rst\r\n.subckt $_SDFFE_PP0P_ C=clk D=$auto$alumacc.cc:578:replace_alu$12.Y[1] E=en Q=q[1] R=rst\r\n.subckt $_SDFFE_PP0P_ C=clk D=$auto$alumacc.cc:578:replace_alu$12.Y[2] E=en Q=q[2] R=rst\r\n.subckt $_SDFFE_PP0P_ C=clk D=$auto$alumacc.cc:578:replace_alu$12.Y[3] E=en Q=q[3] R=rst\r\n.names $auto$alumacc.cc:578:replace_alu$12.P[0] $auto$alumacc.cc:578:replace_alu$12.Y[0]\r\n1 1\r\n.names q[1] $auto$alumacc.cc:578:replace_alu$12.P[1]\r\n1 1\r\n.names q[2] $auto$alumacc.cc:578:replace_alu$12.P[2]\r\n1 1\r\n.names q[3] $auto$alumacc.cc:578:replace_alu$12.P[3]\r\n1 1\r\n.end\r\n",
  "top": "counter",
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
