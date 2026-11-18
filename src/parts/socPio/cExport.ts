// C driver export of the SoC PIO, after evo's PioMenu.exportC and SocSupport's add*Function: <NAME>.h declares
// one setter / getter per register the configuration has, <NAME>.c defines them as volatile word accesses at the
// start address. Two evo slips are fixed: the direction register is word 1 (evo writes index 2, the irq mask), and
// the outset / outclear functions come with every port that has outputs (evo writes them only for ports with inputs).
import { pioEffectiveIrqType, type SocPioConfig } from '../../soc';
import { t } from './text';

/** Longest component name in identifiers and file names */
const MAX_NAME = 64;

/**
 * The part name as a C identifier part and file name, as evo builds it (spaces, '@' and ',' become '_', upper case),
 * then limited to [A-Z0-9_] so that a label cannot break out of an identifier, a comment or a file name.
 */
export function cComponentName(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, MAX_NAME);
  if (!/[A-Z0-9]/.test(s)) return 'PIO';
  return /^[0-9]/.test(s) ? `_${s}`.slice(0, MAX_NAME) : s;
}

export interface CExport {
  /** <NAME>.h / <NAME>.c */
  headerName: string;
  sourceName: string;
  header: string;
  source: string;
}

const hexBase = (n: number): string => `0x${(n >>> 0).toString(16).toUpperCase()}`;

/** evo's remarks are /* … *\/ blocks; ours come from the locale, so they are wrapped here */
const remark = (text: string): string => `/* ${text.split('\n').join('\n * ')}\n */`;

export function pioCExport(name: string, cfg: SocPioConfig): CExport {
  const comp = cComponentName(name);
  const base = hexBase(cfg.startAddress);
  const bits = String(cfg.width);
  const h: string[] = [];
  const c: string[] = [];
  const intro = `/* ${t('cExport.generated')} */\n`;
  h.push(intro, `#ifndef __${comp}_H__`, `#define __${comp}_H__`, '');
  c.push(intro, `#include "${comp}.h"`, '');
  const setter = (fn: string, index: number) => {
    h.push(`void set${comp}${fn}(unsigned int value);`);
    c.push(`void set${comp}${fn}(unsigned int value) {`, '  volatile unsigned int* base;', `  base = (unsigned int *) ${base};`, `  base[${index}] = value;`, '}', '');
  };
  const getter = (fn: string, index: number) => {
    h.push(`unsigned int get${comp}${fn}();`);
    c.push(`unsigned int get${comp}${fn}() {`, '  volatile unsigned int* base;', `  base = (unsigned int *) ${base};`, `  return base[${index}];`, '}', '');
  };
  const both = (fn: string, index: number) => {
    setter(fn, index);
    getter(fn, index);
    h.push('');
  };
  const dir = cfg.direction;
  if (dir !== 'inputonly') {
    h.push(remark(t('cExport.outputData', { bits })));
    setter('OutputValue', 0);
    h.push('');
  }
  if (dir !== 'outputonly') {
    h.push(remark(t('cExport.inputData', { bits })));
    getter('InputValue', 0);
    h.push('');
    if (dir === 'bidir') {
      h.push(remark(t('cExport.direction', { bits })));
      both('DirectionReg', 1);
    }
    if (cfg.genIrq) {
      const source = pioEffectiveIrqType(cfg) === 'edge' ? t('cExport.irqEdge') : t('cExport.irqLevel');
      h.push(remark(t('cExport.irqMask', { source, bits })));
      both('IrqMaskReg', 2);
    }
    if (cfg.syncCapture) {
      const edge = t(`cExport.capture.${cfg.captureEdge}`);
      const clear = cfg.captureBitClear ? t('cExport.clearBits') : t('cExport.clearAll');
      h.push(remark(t('cExport.edgeCapture', { edge, clear, bits })));
      both('EdgeCapturReg', 3);
    }
  }
  if (dir !== 'inputonly' && cfg.outputBitOps) {
    h.push(remark(t('cExport.outSet', { bits })));
    setter('OutsetReg', 4);
    h.push('');
    h.push(remark(t('cExport.outClear', { bits })));
    setter('OutclearReg', 5);
    h.push('');
  }
  h.push('#endif', '');
  return { headerName: `${comp}.h`, sourceName: `${comp}.c`, header: h.join('\n'), source: c.join('\n') };
}
