/** Small seeded PRNG (mulberry32) so seed data is identical on every run. */
export type Rng = ReturnType<typeof createRng>;

export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    float: (min: number, max: number) => min + next() * (max - min),
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
    weighted: <T>(entries: [T, number][]): T => {
      const total = entries.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [value, w] of entries) if ((r -= w) < 0) return value;
      return entries[entries.length - 1]![0];
    },
    /** Box–Muller normal distribution. */
    normal: (mean: number, sd: number) => mean + sd * Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
    bytes: (n: number) => Uint8Array.from({ length: n }, () => Math.floor(next() * 256)),
  };
  return rng;
}
