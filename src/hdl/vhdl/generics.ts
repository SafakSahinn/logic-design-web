// The part's "Generics" attribute: "W=8, N=2" (commas, semicolons or line breaks between entries).
// Values are integers, booleans or enumeration literals, so each one is a safe ghdl -g option.
import { HdlError } from '../types';
import type { GenericValues } from './entity';

export interface GenericSetting {
  name: string;
  /** As written: "8", "-3", "true", "fast" */
  value: string;
}

const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const VALUE = /^(?:-?\d+|[A-Za-z][A-Za-z0-9_]*)$/;

export function parseGenericSettings(text: string): GenericSetting[] {
  const out: GenericSetting[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (entry === '') continue;
    const eq = entry.indexOf('=');
    const name = eq < 0 ? entry : entry.slice(0, eq).trim();
    const value = eq < 0 ? '' : entry.slice(eq + 1).trim();
    if (eq < 0 || !NAME.test(name) || !VALUE.test(value)) throw new HdlError('genericSyntax', `"${entry}" is not name=value`, { entry });
    if (seen.has(name.toLowerCase())) throw new HdlError('genericTwice', `generic ${name} is set twice`, { name });
    seen.add(name.toLowerCase());
    out.push({ name, value });
  }
  return out;
}

/** The settings as entity.ts overrides (integers and booleans; enumeration literals are left to ghdl) */
export function genericValues(settings: GenericSetting[]): GenericValues {
  const map = new Map<string, number | boolean>();
  for (const s of settings) {
    const v = s.value.toLowerCase();
    if (/^-?\d+$/.test(v)) map.set(s.name.toLowerCase(), Number(v));
    else if (v === 'true' || v === 'false') map.set(s.name.toLowerCase(), v === 'true');
  }
  return map;
}

/** ghdl options for the settings */
export const genericArgs = (settings: GenericSetting[]): string[] => settings.map((s) => `-g${s.name}=${s.value}`);
