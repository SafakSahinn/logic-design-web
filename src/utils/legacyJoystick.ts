import type { CircuitComponentInstance, CircuitWire } from '../types/circuit';
import { updatePinPositions } from './circuitEngine';
import { rerouteWiresToRemappedPins, snapPt10 } from './wiringEngine';

/**
 * Joysticks of older project files (Aşama 7b-2). A joystick turned south or west used to have the east pair turned
 * around (X right / below); it now has evolution's order (X left / above), so its two pins swap spots. Wires are
 * joined to pins by location, so on opening such a file the wires on those pins are re-routed to where each pin now
 * is (as rotating a part does): X stays on the X wire. Joysticks whose pins are already in place are left alone.
 */
export function upgradeJoystickPins(
  components: CircuitComponentInstance[],
  wires: CircuitWire[]
): { components: CircuitComponentInstance[]; wires: CircuitWire[]; moved: number } {
  const remap = new Map<string, string | null>();
  let moved = 0;
  const next = components.map((c) => {
    if (c.type !== 'joystick' || c.outputs.some((p) => typeof p.x !== 'number' || typeof p.y !== 'number')) return c;
    const placed = updatePinPositions(c);
    const same = placed.outputs.every((p, i) => {
      const a = snapPt10(p);
      const b = snapPt10(c.outputs[i]);
      return a.x === b.x && a.y === b.y;
    });
    if (same) return c;
    moved++;
    for (const p of c.outputs) {
      const sp = snapPt10(p);
      remap.set(`${sp.x},${sp.y}`, p.id);
    }
    return placed;
  });
  if (moved === 0) return { components, wires, moved };
  return { components: next, wires: rerouteWiresToRemappedPins(wires, components, next, remap), moved };
}
