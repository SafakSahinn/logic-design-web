// Conversions between the engine's levels and the app's SignalValue.
import type { SignalValue } from '../types/logic';
import { LEV_0, LEV_1, LEV_E, LEV_X, LEV_Z, type Level } from './ir';

export function levelOf(v: SignalValue): Level {
  switch (v) {
    case 0:
      return LEV_0;
    case 1:
      return LEV_1;
    case 'Z':
      return LEV_Z;
    case 'E':
      return LEV_E;
    default:
      return LEV_X;
  }
}

const SIGNALS: readonly SignalValue[] = ['Z', 0, 1, 'X', 'E'];

export function signalOf(lev: Level): SignalValue {
  return SIGNALS[lev];
}
