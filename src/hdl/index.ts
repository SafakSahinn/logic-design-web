// HDL synthesis glue (Aşama 6b): HDL text -> external tools -> StoredNetlist -> src/netlist.
// Used by the VHDL Entity part (6b) and later the Verilog part (6c). See types.ts for this folder's rules.
export * from './types';
export { isStoredNetlist, netlistFromStored, storeNetlist } from './stored';
export { parseVerilogHeaders, type VerilogModuleHeader, type VerilogPort } from './verilogHeader';
export { parseYosysMessages, verilogToBlif, yosysScript } from './yosysBlif';
export {
  parseVhdlEntities,
  readVhdlEntities,
  topVhdlEntity,
  type GenericValues,
  type VhdlEntity,
  type VhdlEntityResult,
  type VhdlGenericDecl,
  type VhdlMode,
  type VhdlPortDecl,
  type VhdlRange,
} from './vhdl/entity';
export { genericArgs, genericValues, parseGenericSettings, type GenericSetting } from './vhdl/generics';
export { ghdlSynthArgs, parseGhdlMessages, vhdlToVerilog, VHDL_FILE } from './vhdl/ghdl';
export { synthesizeVhdl, type VhdlSynthOptions, type VhdlSynthResult } from './vhdl/synth';
