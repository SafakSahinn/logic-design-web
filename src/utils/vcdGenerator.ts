import type { CircuitComponentInstance } from '../types/circuit';

export interface WaveformSample {
  time: number;
  values: Record<string, number>;
}

/**
 * Generate IEEE 1364 Standard VCD (Value Change Dump) file content
 * compatible with GTKWave, ModelSim, and WaveDrom.
 */
export function generateVCD(
  samples: WaveformSample[],
  components: CircuitComponentInstance[]
): string {
  const now = new Date().toISOString();

  // Find all components that have signals
  const monitoredComps = components.filter((c) =>
    ['switch', 'clock', 'pushbutton', 'dipSwitch4', 'asciiKeyboard', 'led', 'probe', 'buzzer', 'dFlipFlop', 'counter4', 'alu4', 'subcircuit'].includes(c.type)
  );

  // Map each component or signal to a unique VCD ASCII identifier (!, ", #, $, %, etc.)
  const signalMap = new Map<string, { id: string; name: string; type: string }>();
  let charCode = 33; // '!'

  monitoredComps.forEach((c) => {
    const safeName = (c.label || `${c.type}_${c.id}`).replace(/[^a-zA-Z0-9_]/g, '_');
    const vcdId = String.fromCharCode(charCode++);
    signalMap.set(c.id, { id: vcdId, name: safeName, type: 'wire' });
  });

  // If no monitored signals exist, return minimal valid VCD
  if (signalMap.size === 0) {
    return `$date
  ${now}
$end
$version
  LogicDesign Studio VCD Generator v1.0
$end
$timescale
  1ns
$end
$scope module logic_design $end
$upscope $end
$enddefinitions $end
#0
$dumpvars
$end
`;
  }

  const lines: string[] = [];

  // VCD Header
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

  // Variable definitions
  signalMap.forEach((sig) => {
    lines.push(`  $var wire 1 ${sig.id} ${sig.name} $end`);
  });

  lines.push('$upscope $end');
  lines.push('$enddefinitions $end');

  // Initial Dumpvars at time 0
  lines.push('#0');
  lines.push('$dumpvars');
  const initialValues = samples.length > 0 ? samples[0].values : {};
  signalMap.forEach((sig, compId) => {
    const val = initialValues[compId] ?? 0;
    lines.push(`${val}${sig.id}`);
  });
  lines.push('$end');

  // Timestamped transitions
  let lastValues: Record<string, number> = { ...initialValues };

  for (let i = 1; i < samples.length; i++) {
    const sample = samples[i];
    const timestamp = Math.round(sample.time * 100); // 100ns per sample tick
    let hasChangeAtThisTime = false;

    signalMap.forEach((sig, compId) => {
      const currentVal = sample.values[compId] ?? 0;
      if (currentVal !== lastValues[compId]) {
        if (!hasChangeAtThisTime) {
          lines.push(`#${timestamp}`);
          hasChangeAtThisTime = true;
        }
        lines.push(`${currentVal}${sig.id}`);
        lastValues[compId] = currentVal;
      }
    });
  }

  // Ensure final timestamp
  if (samples.length > 1) {
    const finalTime = Math.round(samples[samples.length - 1].time * 100) + 10;
    lines.push(`#${finalTime}`);
  }

  return lines.join('\n');
}
