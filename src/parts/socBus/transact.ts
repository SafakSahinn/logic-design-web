// Sending a SoC bus transaction by hand (the bus part's dialog; later the processors' debug tools).
import { BYTE_ACCESS, HALF_WORD_ACCESS, SocBusError, SocTransaction, WORD_ACCESS, type SocAccess } from '../../soc';
import type { CircuitComponentInstance } from '../../types/circuit';
import { peekSocBus, socManager } from '../shared/socRuntime';
import { busIdOf } from './model';

export const ACCESS_OPTIONS: { access: SocAccess; key: string; digits: number }[] = [
  { access: BYTE_ACCESS, key: 'byte', digits: 2 },
  { access: HALF_WORD_ACCESS, key: 'half', digits: 4 },
  { access: WORD_ACCESS, key: 'word', digits: 8 },
];

export const digitsOf = (access: SocAccess): number => ACCESS_OPTIONS.find((o) => o.access === access)!.digits;

/** A hex number of at most `digits` digits (with or without 0x), or undefined */
export function parseHex(text: string, digits: number): number | undefined {
  const s = text.trim().replace(/^0x/i, '').replace(/_/g, '');
  if (!/^[0-9a-f]+$/i.test(s)) return undefined;
  const v = parseInt(s, 16);
  return s.replace(/^0+(?=.)/, '').length <= digits ? v >>> 0 : undefined;
}

/**
 * Sends one transaction on the part's bus as the master `master`. Uses the bus object even while another circuit's
 * run has taken it out of the manager, so the dialog always reaches the bus it was opened from.
 */
export function sendTransaction(comp: CircuitComponentInstance, type: number, address: number, writeData: number, access: SocAccess, master: string): SocTransaction {
  const id = busIdOf(comp);
  const tr = new SocTransaction(type, address, writeData, access, master);
  const bus = socManager.getBus(id) ?? peekSocBus(id);
  if (bus) bus.transact(tr);
  else tr.error = SocBusError.noBusConnected;
  return tr;
}

