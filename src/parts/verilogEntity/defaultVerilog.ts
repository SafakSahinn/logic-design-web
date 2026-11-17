// The text of a new Verilog Entity part. Its synthesized netlist is in defaultNetlist.ts, so a new part
// simulates at once, before the first synthesis and without downloading Yosys on the web.
export const DEFAULT_VERILOG = `// Counter with a width parameter. Set it in the Parameters attribute (e.g. W=8), then Synthesize (Yosys).
module counter #(
  parameter W = 4              // width of q
) (
  input              clk,
  input              rst,      // synchronous reset
  input              en,
  output reg [W-1:0] q,
  output             max       // q is all ones
);
  always @(posedge clk)
    if (rst)
      q <= 0;
    else if (en)
      q <= q + 1'b1;

  assign max = &q;
endmodule
`;
