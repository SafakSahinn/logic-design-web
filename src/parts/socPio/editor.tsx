// The PIO's "C header" attribute row: evo's "Export C" menu item (the shared SoC export row).
import type { ReactNode } from 'react';
import type { PartEditorProps } from '../registry';
import { CExportRow } from '../shared/cExportRow';
import { pioCExport } from './cExport';
import { pioConfig, pioName } from './model';
import { t } from './text';

export function SocPioExportRow(props: PartEditorProps): ReactNode {
  return <CExportRow {...props} makeFiles={(comp) => pioCExport(pioName(comp), pioConfig(comp))} t={t} hook="socpio" />;
}
