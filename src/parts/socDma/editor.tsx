// The DMA's "C header" attribute row: an "Export C" item like the PIO's and the VGA's (the shared SoC export row).
import type { ReactNode } from 'react';
import type { PartEditorProps } from '../registry';
import { CExportRow } from '../shared/cExportRow';
import { dmaCExport } from './cExport';
import { dmaConfig, dmaName } from './model';
import { t } from './text';

export function SocDmaExportRow(props: PartEditorProps): ReactNode {
  return <CExportRow {...props} makeFiles={(comp) => dmaCExport(dmaName(comp), dmaConfig(comp))} t={t} hook="socdma" />;
}
