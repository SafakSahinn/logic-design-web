// Nios II processor (Aşama 6g): decoder, disassembler, assembler ISA and core. Exported through 'src/soc'.
import { registerNamespace } from '../../i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { NIOS2_NAMESPACE } from './assembler';

registerNamespace(NIOS2_NAMESPACE, { en, tr });

export { NIOS2_NAMESPACE, nios2Assembler } from './assembler';
export {
  ABI_NAMES as NIOS2_ABI_NAMES,
  REGISTER_NAMES as NIOS2_REGISTER_NAMES,
  CONTROL_NAMES as NIOS2_CONTROL_NAMES,
  controlName as nios2ControlName,
  registerIndex as nios2RegisterIndex,
  decode as nios2Decode,
} from './isa';
export type { Decoded as Nios2Decoded } from './isa';
export { disassembleWord as nios2DisassembleWord, formatDecoded as nios2FormatDecoded } from './disasm';
export {
  Nios2Core,
  TRACE_ENTRIES as NIOS2_TRACE_ENTRIES,
  MAX_IRQS as NIOS2_MAX_IRQS,
  Cause as Nios2Cause,
  STATUS_PIE,
  STATUS_RSIE,
} from './cpu';
export type { RunState as Nios2RunState, TraceEntry as Nios2TraceEntry, HaltInfo as Nios2HaltInfo, CustomRequest, Nios2Ports } from './cpu';
