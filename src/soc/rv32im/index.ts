// RV32IM processor (Aşama 6f): decoder, disassembler, assembler ISA, core and PLIC. Exported through 'src/soc'.
import { registerNamespace } from '../../i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';
import { RV32IM_NAMESPACE } from './assembler';

registerNamespace(RV32IM_NAMESPACE, { en, tr });

export { RV32IM_NAMESPACE, rv32imAssembler } from './assembler';
export { ABI_NAMES, REGISTER_NAMES, CSR_NAMES, csrName, registerIndex, decode } from './isa';
export type { Decoded, Op } from './isa';
export { disassembleWord, formatDecoded } from './disasm';
export { Rv32imCore, TRACE_ENTRIES, Cause } from './cpu';
export type { RunState, TraceEntry, HaltInfo, Rv32imBusPort } from './cpu';
export { CsrFile, IMPLEMENTED_CSRS, MISA_VALUE } from './csr';
export { Rv32imPlic, PLIC_DEFAULT_BASE, PLIC_SIZE, MAX_IRQS } from './plic';
