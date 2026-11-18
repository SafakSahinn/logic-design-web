// Public entry of the SoC core (Aşama 6e): bus, memory, simulation manager, program images, ELF reader and the
// generic assembler, plus the RV32IM processor (6f). Nios II (6g) and peripherals (6h) build on it. Import from 'src/soc'.
import { registerNamespace } from '../i18n';
import en from './locales/en.json';
import tr from './locales/tr.json';

/** i18n namespace of the SoC core's texts (bus errors, ELF errors, assembler errors) */
export const SOC_NAMESPACE = 'soc';
registerNamespace(SOC_NAMESPACE, { en, tr });

export * from './bus/transaction';
export { SocBus, SocBusTrace, TRACE_LIMIT } from './bus/bus';
export type { SocSlave, SocSniffer } from './bus/bus';
export { SocManager, newSocBusId, isSocBusId } from './bus/manager';
export {
  SocMemory,
  MEM_SIZE_MIN_BITS,
  MEM_SIZE_MAX_BITS,
  MEM_SIZE_DEFAULT_BITS,
  clampMemSizeBits,
  memSizeText,
} from './memory/memory';
export type { SocMemoryConfig } from './memory/memory';
export * from './elf/reader';
export { programFromElf, programSize, loadProgram } from './program';
export type { ProgramImage, ProgramChunk, ProgramSection, ProgramSymbol, LoadResult } from './program';
export { assemble, MAX_ASM_BYTES } from './asm/assembler';
export type { AsmDiagnostic, AsmResult } from './asm/assembler';
export type { IsaAssembler, AsmInstruction, AsmOperand, AsmEncodeError, AsmFunctionContext } from './asm/isa';
export { buildListing } from './asm/listing';
export type { ListingLine } from './asm/listing';
export * from './rv32im';
