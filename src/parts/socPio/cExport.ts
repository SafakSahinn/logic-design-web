// C driver export of the SoC PIO, after evo's PioMenu.exportC and SocSupport's add*Function: <NAME>.h declares
// one setter / getter per register the configuration has, <NAME>.c defines them as volatile word accesses at the
// start address. Two evo slips are fixed: the direction register is word 1 (evo writes index 2, the irq mask), and
// the outset / outclear functions come with every port that has outputs (evo writes them only for ports with inputs).
import { pioEffectiveIrqType, type SocPioConfig } from '../../soc';
import { CWriter, cComponentName as sharedName, cRemark as remark, type CExport } from '../shared/cExport';
import { t } from './text';

export type { CExport } from '../shared/cExport';

/** The part name as a C identifier part and file name ("PIO" when nothing usable is left) */
export const cComponentName = (name: string): string => sharedName(name, 'PIO');

export function pioCExport(name: string, cfg: SocPioConfig): CExport {
  const comp = cComponentName(name);
  const bits = String(cfg.width);
  const w = new CWriter(comp, cfg.startAddress);
  const { h, c } = w;
  const intro = `/* ${t('cExport.generated')} */\n`;
  h.push(intro, `#ifndef __${comp}_H__`, `#define __${comp}_H__`, '');
  c.push(intro, `#include "${comp}.h"`, '');
  const dir = cfg.direction;
  if (dir !== 'inputonly') {
    h.push(remark(t('cExport.outputData', { bits })));
    w.setter('OutputValue', 0);
    h.push('');
  }
  if (dir !== 'outputonly') {
    h.push(remark(t('cExport.inputData', { bits })));
    w.getter('InputValue', 0);
    h.push('');
    if (dir === 'bidir') {
      h.push(remark(t('cExport.direction', { bits })));
      w.both('DirectionReg', 1);
    }
    if (cfg.genIrq) {
      const source = pioEffectiveIrqType(cfg) === 'edge' ? t('cExport.irqEdge') : t('cExport.irqLevel');
      h.push(remark(t('cExport.irqMask', { source, bits })));
      w.both('IrqMaskReg', 2);
    }
    if (cfg.syncCapture) {
      const edge = t(`cExport.capture.${cfg.captureEdge}`);
      const clear = cfg.captureBitClear ? t('cExport.clearBits') : t('cExport.clearAll');
      h.push(remark(t('cExport.edgeCapture', { edge, clear, bits })));
      w.both('EdgeCapturReg', 3);
    }
  }
  if (dir !== 'inputonly' && cfg.outputBitOps) {
    h.push(remark(t('cExport.outSet', { bits })));
    w.setter('OutsetReg', 4);
    h.push('');
    h.push(remark(t('cExport.outClear', { bits })));
    w.setter('OutclearReg', 5);
    h.push('');
  }
  h.push('#endif', '');
  return { headerName: `${comp}.h`, sourceName: `${comp}.c`, header: h.join('\n'), source: c.join('\n') };
}
