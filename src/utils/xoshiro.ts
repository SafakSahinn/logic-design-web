/**
 * Logisim-evolution's random generator (std/memory/Xoshiro256PlusPlus.java): xoshiro256++ with its 4 x 64-bit
 * state set up from the seed by SplitMix64. Shared by the simulator (Random part) and the HDL generator, which
 * loads the same starting state.
 */
const M64 = (1n << 64n) - 1n;
const GAMMA = 0x9e3779b97f4a7c15n;

/** Seed evolution's HDL uses when the part's seed is 0 (RandomHdlGeneratorFactory.HDL_DEFAULT_SEED) */
export const XOSHIRO_HDL_DEFAULT_SEED = 0x5deece66dn;

const rotl = (x: bigint, k: bigint): bigint => ((x << k) | (x >> (64n - k))) & M64;

/** Starting state for a 64-bit seed (Xoshiro256PlusPlus.initialState) */
export function xoshiroInitialState(seed: bigint): bigint[] {
  let s = seed & M64;
  const out: bigint[] = [];
  for (let i = 0; i < 4; i++) {
    s = (s + GAMMA) & M64;
    let z = s;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & M64;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & M64;
    out.push(z ^ (z >> 31n));
  }
  return out;
}

/** The value the state gives: rotl(s0 + s3, 23) + s0 */
export function xoshiroValue(s: bigint[]): bigint {
  return (rotl((s[0] + s[3]) & M64, 23n) + s[0]) & M64;
}

/** The next state */
export function xoshiroStep(s: bigint[]): bigint[] {
  const t = (s[1] << 17n) & M64;
  const s2 = s[2] ^ s[0];
  const s3 = s[3] ^ s[1];
  const s1 = s[1] ^ s2;
  const s0 = s[0] ^ s3;
  return [s0, s1, s2 ^ t, rotl(s3, 45n)];
}

/** Adds the golden gamma to a 64-bit seed (evolution's way to avoid restarting on the same time seed) */
export const xoshiroBumpSeed = (seed: bigint): bigint => (seed + GAMMA) & M64;
