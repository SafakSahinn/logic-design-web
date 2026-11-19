// C driver export of the SoC DMA, in the style of the PIO's and the VGA's (evo's DMA has no Export C): <NAME>.h
// defines the register addresses and offsets, the CONTROL / STATUS bits and the burst size, and declares a setter /
// getter per register plus three helpers (start a transfer, poll BUSY, clear DONE); <NAME>.c defines them as
// volatile word accesses at the start address.
import { DMA_CTRL_DST_FIXED, DMA_CTRL_IRQ_EN, DMA_CTRL_SRC_FIXED, DMA_CTRL_START, DMA_REG, DMA_REGISTER_SIZE, DMA_STAT_BUSY, DMA_STAT_DONE, type SocDmaConfig } from '../../soc';
import { CWriter, cComponentName, cHex, cRemark, type CExport } from '../shared/cExport';
import { t } from './text';

/** Register name in macros / accessors, word index = offset / 4 */
const REGISTERS: readonly { macro: string; fn: string; offset: number; readOnly?: boolean }[] = [
  { macro: 'SRC_ADDR', fn: 'SrcAddr', offset: DMA_REG.srcAddr },
  { macro: 'DST_ADDR', fn: 'DstAddr', offset: DMA_REG.dstAddr },
  { macro: 'LENGTH', fn: 'Length', offset: DMA_REG.length },
  { macro: 'CONTROL', fn: 'Control', offset: DMA_REG.control },
  { macro: 'STATUS', fn: 'Status', offset: DMA_REG.status },
  { macro: 'BYTES_DONE', fn: 'BytesDone', offset: DMA_REG.bytesDone, readOnly: true },
];

export function dmaCExport(name: string, cfg: SocDmaConfig): CExport {
  const comp = cComponentName(name, 'DMA');
  const w = new CWriter(comp, cfg.startAddress);
  const { h, c } = w;
  const base = cHex(cfg.startAddress);
  const intro = `/* ${t('cExport.generated')} */\n`;
  h.push(intro, `#ifndef __${comp}_H__`, `#define __${comp}_H__`, '');
  // registers past 0xFFFFFFFF: the macros would wrap to low addresses the DMA does not answer, so the header stops
  // the build instead of writing to whatever sits there
  if (cfg.startAddress + DMA_REGISTER_SIZE > 2 ** 32) h.push(`#error "${t('cExport.wraps', { start: base })}"`, '');
  c.push(intro, `#include "${comp}.h"`, '');

  h.push(cRemark(t('cExport.addresses', { burst: cfg.burstSize })));
  h.push(`#define ${comp}_BASE_ADDRESS ${base}`, `#define ${comp}_BURST_SIZE ${cfg.burstSize}`);
  for (const r of REGISTERS) h.push(`#define ${comp}_${r.macro}_OFFSET ${cHex(r.offset)}`);
  for (const r of REGISTERS) h.push(`#define ${comp}_${r.macro} ((volatile unsigned int *) ${cHex(cfg.startAddress + r.offset)})`);
  h.push('');
  h.push(cRemark(t('cExport.bits')));
  h.push(
    `#define ${comp}_CONTROL_START ${cHex(DMA_CTRL_START)}`,
    `#define ${comp}_CONTROL_IRQ_EN ${cHex(DMA_CTRL_IRQ_EN)}`,
    `#define ${comp}_CONTROL_DST_FIXED ${cHex(DMA_CTRL_DST_FIXED)}`,
    `#define ${comp}_CONTROL_SRC_FIXED ${cHex(DMA_CTRL_SRC_FIXED)}`,
    `#define ${comp}_STATUS_BUSY ${cHex(DMA_STAT_BUSY)}`,
    `#define ${comp}_STATUS_DONE ${cHex(DMA_STAT_DONE)}`,
    '',
  );

  h.push(cRemark(t('cExport.registerFunctions')));
  for (const r of REGISTERS) {
    if (r.readOnly) {
      w.getter(r.fn, r.offset / 4);
      h.push('');
    } else w.both(r.fn, r.offset / 4);
  }

  const head = (sig: string) => {
    h.push(`${sig};`);
    c.push(`${sig} {`, '  volatile unsigned int* base;', `  base = (unsigned int *) ${base};`);
  };
  h.push(cRemark(t('cExport.start')));
  head(`void start${comp}Transfer(unsigned int src, unsigned int dst, unsigned int length, unsigned int flags)`);
  c.push(
    `  base[${DMA_REG.srcAddr / 4}] = src;`,
    `  base[${DMA_REG.dstAddr / 4}] = dst;`,
    `  base[${DMA_REG.length / 4}] = length;`,
    `  base[${DMA_REG.control / 4}] = flags | ${comp}_CONTROL_START;`,
    '}',
    '',
  );
  h.push('');
  h.push(cRemark(t('cExport.busy')));
  head(`int is${comp}Busy(void)`);
  c.push(`  return (base[${DMA_REG.status / 4}] & ${comp}_STATUS_BUSY) != 0;`, '}', '');
  h.push('');
  h.push(cRemark(t('cExport.clearDone')));
  head(`void clear${comp}Done(void)`);
  c.push(`  base[${DMA_REG.status / 4}] = ${comp}_STATUS_DONE;`, '}', '');
  h.push('');
  h.push('#endif', '');
  return { headerName: `${comp}.h`, sourceName: `${comp}.c`, header: h.join('\n'), source: c.join('\n') };
}
