// Stages every open flow shares (Aşama 6j): VHDL through ghdl, and the yosys command that reads the sources.
import type { FlowStage } from './model';

const MINUTE = 60_000;

/** ghdl's Verilog output, read by yosys in place of the VHDL sources */
export const GHDL_VERILOG = 'ghdl_out.v';

/**
 * `ghdl --synth --out=verilog`: VHDL goes through ghdl first (the same route as the VHDL Entity part, Aşama 6b),
 * because the tool policy refuses the ghdl-yosys plugin (electron/toolPolicy.cjs). Returns the stage and the
 * Verilog files yosys reads afterwards.
 */
export function vhdlToVerilogStage(sourceNames: string[], top: string): { stage: FlowStage; verilogFiles: string[] } {
  return {
    stage: {
      id: 'vhdlToVerilog',
      tool: 'ghdl',
      // Same options as the VHDL Entity part; "-e <top>" elaborates the top level and everything below it
      args: ['--synth', '--std=08', '-fsynopsys', '--out=verilog', ...sourceNames, '-e', top],
      needs: sourceNames,
      outputs: [],
      stdoutTo: GHDL_VERILOG,
      timeoutMs: 5 * MINUTE,
    },
    verilogFiles: [GHDL_VERILOG],
  };
}

/** The yosys script head that reads the Verilog sources and picks the top level */
export function yosysRead(verilogFiles: string[], top: string): string {
  return `read_verilog -sv ${verilogFiles.join(' ')}; hierarchy -top ${top}`;
}
