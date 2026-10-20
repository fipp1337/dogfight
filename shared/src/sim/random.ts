/** Mulberry32 generator: deterministic, tiny, and entirely driven by snapshot state. */
export function nextRandom(state: number): { value: number; state: number } {
  const nextState = (state + 0x6d2b79f5) >>> 0;
  let value = nextState;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return {
    value: ((value ^ (value >>> 14)) >>> 0) / 4294967296,
    state: nextState,
  };
}

export function randomRange(
  state: number,
  min: number,
  max: number,
): { value: number; state: number } {
  const sample = nextRandom(state);
  return { value: min + sample.value * (max - min), state: sample.state };
}
