// The DMA's transfer status as one line, as evo's body shows it: "Idle", "Done" or
// "Transferring N% (done/length bytes)". The body and the Status attribute both use it.
import type { DmaRegisters } from '../../soc';
import { t } from './text';

export function dmaStatusLine(r: DmaRegisters): string {
  if (r.busy) {
    const percent = r.length > 0 ? Math.floor((r.bytesDone * 100) / r.length) : 0;
    return t('body.busy', { percent, done: r.bytesDone, length: r.length });
  }
  return r.done ? t('body.done') : t('body.idle');
}
