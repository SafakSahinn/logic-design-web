// The RV32IM's attribute row: the shared processor row (run controls, Load ELF…, Assembler…, Program…).
import type { ReactNode } from 'react';
import type { PartEditorProps } from '../registry';
import { CpuEditorRow } from '../shared/cpu/editor';
import { RV32IM_UI } from './program';

export function Rv32imEditorRow(props: PartEditorProps): ReactNode {
  return <CpuEditorRow {...props} ui={RV32IM_UI} />;
}
