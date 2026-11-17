// The part's "Parameters" attribute: "W=8, N=2" (commas, semicolons or line breaks between entries).
// Values are decimal integers, so each one is a safe yosys `chparam -set` token. Names are case-sensitive.
import { HdlError } from '../types';
import type { ParamValues, VerilogModule } from './module';

export interface ParamSetting {
  name: string;
  /** As written: "8", "-3" */
  value: string;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;
const VALUE = /^-?\d+$/;

export function parseParamSettings(text: string): ParamSetting[] {
  const out: ParamSetting[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,;\n]/)) {
    const entry = raw.trim();
    if (entry === '') continue;
    const eq = entry.indexOf('=');
    const name = eq < 0 ? entry : entry.slice(0, eq).trim();
    const value = eq < 0 ? '' : entry.slice(eq + 1).trim();
    if (eq < 0 || !NAME.test(name) || !VALUE.test(value)) throw new HdlError('paramSyntax', `"${entry}" is not name=integer`, { entry });
    if (seen.has(name)) throw new HdlError('paramTwice', `parameter ${name} is set twice`, { name });
    seen.add(name);
    out.push({ name, value: String(Number(value)) });
  }
  return out;
}

/** The settings as module.ts overrides */
export const paramValues = (settings: ParamSetting[]): ParamValues => new Map(settings.map((s) => [s.name, Number(s.value)]));

/** Throws HdlError when a setting names no parameter of the module, or a localparam */
export function checkParamSettings(module: VerilogModule, settings: ParamSetting[]): void {
  for (const s of settings) {
    const p = module.params.find((x) => x.name === s.name);
    if (!p) throw new HdlError('paramUnknown', `module ${module.name} has no parameter ${s.name}`, { name: s.name, module: module.name });
    if (p.local) throw new HdlError('paramLocal', `${s.name} is a localparam of module ${module.name} and cannot be set`, { name: s.name, module: module.name }, p.line);
  }
}

/** yosys `chparam` command for the settings, or '' when there are none */
export const chparamCommand = (settings: ParamSetting[], top: string): string =>
  settings.length === 0 ? '' : `chparam ${settings.map((s) => `-set ${s.name} ${s.value}`).join(' ')} ${top}`;
