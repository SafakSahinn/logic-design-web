// The VGA's "C header" attribute row: evo's "Export C" menu item (the shared SoC export row).
import type { ReactNode } from 'react';
import type { PartEditorProps } from '../registry';
import { CExportRow } from '../shared/cExportRow';
import { vgaCExport } from './cExport';
import { vgaConfig, vgaName } from './model';
import { t } from './text';

export function SocVgaExportRow(props: PartEditorProps): ReactNode {
  return <CExportRow {...props} makeFiles={(comp) => vgaCExport(vgaName(comp), vgaConfig(comp))} t={t} hook="socvga" />;
}
