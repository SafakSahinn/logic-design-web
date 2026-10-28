import type { CircuitComponentInstance } from '../types/circuit';
import type { SignalValue } from '../types/logic';

export interface WaveformSample {
  time: number;
  values: Record<string, SignalValue>;
}

// VCD identifier codes use the printable ASCII range '!'..'~' (94 symbols); more signals get longer codes
function vcdIdentifier(index: number): string {
  let id = '';
  let n = index;
  do {
    id += String.fromCharCode(33 + (n % 94));
    n = Math.floor(n / 94);
  } while (n > 0);
  return id;
}

/**
 * Generate IEEE 1364 Standard VCD (Value Change Dump) file content
 * compatible with GTKWave, ModelSim, and WaveDrom.
 *
 * Signals are taken from the waveform samples themselves: a key is either a component id
 * (single-bit parts) or `${componentId}_${suffix}` for multi-bit parts (q0..q3, f0.., z, ...).
 */
export function generateVCD(
  samples: WaveformSample[],
  components: CircuitComponentInstance[]
): string {
  const now = new Date().toISOString();
  const compById = new Map(components.map((c) => [c.id, c]));

  // Every key seen in any sample, in first-seen order
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const s of samples) {
    for (const k of Object.keys(s.values)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }

  // Resolve each key to "<label>[_<suffix>]" and keep the names unique
  const usedNames = new Map<string, number>();
  const signals: { key: string; id: string; name: string }[] = [];
  keys.forEach((key) => {
    let comp = compById.get(key);
    let suffix = '';
    if (!comp) {
      const cut = key.lastIndexOf('_');
      if (cut > 0) {
        comp = compById.get(key.slice(0, cut));
        suffix = key.slice(cut + 1);
      }
    }
    const base = ((comp?.label || (comp ? comp.type : key)) + (suffix ? `_${suffix}` : ''))
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'sig';
    const n = usedNames.get(base) || 0;
    usedNames.set(base, n + 1);
    signals.push({ key, id: vcdIdentifier(signals.length), name: n === 0 ? base : `${base}_${n + 1}` });
  });

  const lines: string[] = [];
  lines.push('$date');
  lines.push(`  ${now}`);
  lines.push('$end');
  lines.push('$version');
  lines.push('  LogicDesign Studio VCD Generator (GTKWave & ModelSim Compatible)');
  lines.push('$end');
  lines.push('$timescale');
  lines.push('  1ns');
  lines.push('$end');
  lines.push('$scope module logic_design $end');
  signals.forEach((sig) => lines.push(`  $var wire 1 ${sig.id} ${sig.name} $end`));
  lines.push('$upscope $end');
  lines.push('$enddefinitions $end');

  if (signals.length === 0) {
    lines.push('#0');
    lines.push('$dumpvars');
    lines.push('$end');
    return lines.join('\n') + '\n';
  }

  // Floating is z; unknown, conflicting (E) and missing samples are x
  const bit = (v: SignalValue | undefined) => (v === 1 ? '1' : v === 0 ? '0' : v === 'Z' ? 'z' : 'x');
  const t0 = samples[0].time;
  // 100 ns per sample tick, measured from the first kept sample so the dump starts at #0
  const stamp = (t: number) => Math.round((t - t0) * 100);

  lines.push('#0');
  lines.push('$dumpvars');
  const last: Record<string, string> = {};
  signals.forEach((sig) => {
    last[sig.key] = bit(samples[0].values[sig.key]);
    lines.push(`${last[sig.key]}${sig.id}`);
  });
  lines.push('$end');

  let lastStamp = 0;
  for (let i = 1; i < samples.length; i++) {
    // Timestamps must strictly increase
    const ts = Math.max(stamp(samples[i].time), lastStamp + 1);
    const changes: string[] = [];
    signals.forEach((sig) => {
      const v = bit(samples[i].values[sig.key]);
      if (v !== last[sig.key]) {
        changes.push(`${v}${sig.id}`);
        last[sig.key] = v;
      }
    });
    if (changes.length > 0) {
      lines.push(`#${ts}`, ...changes);
      lastStamp = ts;
    }
  }

  // Close the last sample's interval so viewers draw its value
  const end = Math.max(stamp(samples[samples.length - 1].time) + 100, lastStamp + 1);
  lines.push(`#${end}`);

  return lines.join('\n') + '\n';
}
