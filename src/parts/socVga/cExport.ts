// C driver export of the SoC VGA, after evo's VgaMenu.exportC: <NAME>.h defines the soft mode masks (evo's
// SOFT_MODE_<W>X<H>_MASK) and declares the mode register's setter / getter; <NAME>.c defines them as volatile word
// accesses at the start address. Added to evo's header: the mode register and frame buffer addresses of this part,
// a pointer to the frame buffer, the width / height of every mode and the modes this part allows, so a program can
// draw without looking up the attributes. The mode macros have the same value in every VGA's header, so two
// headers in one program do not clash (C allows an identical redefinition).
import { VGA_MODES, VGA_SOFT_KEYS, vgaSoftModeMask, type SocVgaConfig } from '../../soc';
import { CWriter, cComponentName, cHex, cRemark, type CExport } from '../shared/cExport';
import { t } from './text';

export function vgaCExport(name: string, cfg: SocVgaConfig): CExport {
  const comp = cComponentName(name, 'VGA');
  const w = new CWriter(comp, cfg.startAddress);
  const { h, c } = w;
  const intro = `/* ${t('cExport.generated')} */\n`;
  h.push(intro, `#ifndef __${comp}_H__`, `#define __${comp}_H__`, '');
  c.push(intro, `#include "${comp}.h"`, '');
  for (const [i, m] of VGA_MODES.entries()) h.push(`#define SOFT_MODE_${m.name.toUpperCase()}_MASK ${1 << i}`);
  h.push('');
  h.push(cRemark(t('cExport.sizes')));
  for (const m of VGA_MODES) {
    const id = m.name.toUpperCase();
    h.push(`#define VGA_MODE_${id}_WIDTH ${m.width}`, `#define VGA_MODE_${id}_HEIGHT ${m.height}`);
  }
  h.push('');
  const allowed = VGA_MODES.filter((_, i) => cfg[VGA_SOFT_KEYS[i]]).map((m) => m.name);
  h.push(cRemark(t('cExport.addresses', { initial: VGA_MODES[cfg.displayMode].name, allowed: allowed.length ? allowed.join(', ') : t('cExport.noneAllowed') })));
  h.push(
    `#define ${comp}_MODE_REGISTER ${cHex(cfg.startAddress)}`,
    `#define ${comp}_BUFFER_ADDRESS ${cHex(cfg.bufferAddress)}`,
    `#define ${comp}_BUFFER ((volatile unsigned int *) ${cHex(cfg.bufferAddress)})`,
    `#define ${comp}_SOFT_MODES ${vgaSoftModeMask(cfg)}`,
    '',
  );
  h.push(cRemark(t('cExport.modeFunctions')));
  w.both('VgaMode', 0);
  h.push('#endif', '');
  return { headerName: `${comp}.h`, sourceName: `${comp}.c`, header: h.join('\n'), source: c.join('\n') };
}
