// Netlist engine (Aşama 6a): front ends -> Netlist -> compileNetlist -> stepNetlist.
//
// Used by the BLIF Circuit part (6a) and, through the yosys JSON front end, by the VHDL (6b) and
// Verilog (6c) entity parts. See ir.ts for the rules every module here follows.
export * from './ir';
export { MAX_PORT_WIDTH, parseBlif } from './blif';
export { compileNetlist, type CompiledNetlist, type CompiledPort } from './compile';
export { cloneNetlistState, newNetlistState, readNetlistOutputs, stepNetlist, type NetlistState } from './sim';
export { levelOf, signalOf } from './levels';
export { evoBitNames, evoBlifPorts, writeEvoBlif, type EvoBlifPort, type EvoBlifResult } from './evoBlif';
