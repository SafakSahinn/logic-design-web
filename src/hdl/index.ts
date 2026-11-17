// HDL synthesis glue (Aşama 6b): HDL text -> external tools -> StoredNetlist -> src/netlist.
// Used by the VHDL Entity part (6b) and the Verilog Entity part (6c). See types.ts for this folder's rules.
export * from './types';
export { isStoredNetlist, netlistFromStored, storeNetlist } from './stored';
export { parseVerilogHeaders, type VerilogModuleHeader, type VerilogPort } from './verilogHeader';
export { parseYosysMessages, verilogToBlif, yosysScript, type YosysBlifOptions } from './yosysBlif';
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
export {
  parseVerilogModules,
  readVerilogModules,
  topVerilogModule,
  type ParamValues,
  type VerilogDirection,
  type VerilogModule,
  type VerilogModuleResult,
  type VerilogParamDecl,
  type VerilogPortDecl,
  type VerilogRange,
} from './verilog/module';
export { tokenizeVerilog, type VerilogToken } from './verilog/lexer';
export { checkParamSettings, chparamCommand, paramValues, parseParamSettings, type ParamSetting } from './verilog/params';
export { moduleHeader, synthesizeVerilog, type VerilogSynthOptions, type VerilogSynthResult } from './verilog/synth';
