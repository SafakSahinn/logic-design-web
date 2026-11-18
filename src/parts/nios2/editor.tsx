// The Nios II's attribute row: the shared processor row (run controls, Load ELF…, Assembler…, Program…).
import type { ReactNode } from 'react';
import type { PartEditorProps } from '../registry';
import { CpuEditorRow } from '../shared/cpu/editor';
import { NIOS2_UI } from './program';

export function Nios2EditorRow(props: PartEditorProps): ReactNode {
  return <CpuEditorRow {...props} ui={NIOS2_UI} />;
}
