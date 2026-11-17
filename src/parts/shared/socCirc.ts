// .circ helpers shared by the SoC parts (Aşama 6e): bus ids and evo's attribute value formats.
//
// evo stores a bus's identity in the SocBus's hidden "SocBusIdentifier" and the bus a slave uses in its
// "SocBusSelection"; both are opaque strings. The ids are written as they are, except the fallback a bus without
// one gets here ("lds:<component id>"): it becomes a stable id in evo's shape, the same for the bus and for every
// part that names it, so the file stays connected and a re-export gives the same text.

/** Longest bus id the parts keep (longer ones in a file are refused) */
export const MAX_BUS_ID_LENGTH = 64;

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = (1n << 64n) - 1n;

function fnv1a64(text: string): bigint {
  let h = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(text)) h = ((h ^ BigInt(byte)) * FNV64_PRIME) & MASK64;
  return h;
}

function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
  return h;
}

/** The id written to .circ for a bus id kept here ('' stays '': not connected) */
export function circBusId(id: string): string {
  if (!id.startsWith('lds:')) return id;
  // evo's shape: 0x, 16 upper-case hex digits (its time stamp), then lower-case hex (its object hash)
  return `0x${fnv1a64(id).toString(16).toUpperCase().padStart(16, '0')}${fnv1a32(id).toString(16)}`;
}

/** A bus id read from .circ: undefined when empty or missing, 'tooLong' when it cannot be kept */
export function readCircBusId(value: string | undefined): string | undefined | 'tooLong' {
  const id = value?.trim() ?? '';
  if (id === '') return undefined;
  return id.length > MAX_BUS_ID_LENGTH ? 'tooLong' : id;
}

/** evo's hex integer attribute (forHexInteger): "0x" and lower-case digits, no padding */
export const circHex = (value: number): string => `0x${(value >>> 0).toString(16)}`;

/**
 * evo's hex integer as it reads it: "0x" + hex digits, or a decimal number; a 32-bit value (unsigned here).
 * undefined = unreadable.
 */
export function readCircHex(value: string): number | undefined {
  const v = value.trim();
  const n = /^0x[0-9a-f]{1,8}$/i.test(v) ? parseInt(v.slice(2), 16) : /^-?\d{1,10}$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n > 0xffffffff || n < -0x80000000) return undefined;
  return n >>> 0;
}

/** evo's bit width attribute: a plain decimal number in [min, max]; undefined = unreadable or out of range */
export function readCircWidth(value: string, min: number, max: number): number | undefined {
  const v = value.trim();
  if (!/^\d{1,3}$/.test(v)) return undefined;
  const n = Number(v);
  return n >= min && n <= max ? n : undefined;
}
