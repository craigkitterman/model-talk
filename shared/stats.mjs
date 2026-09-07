// Paired-comparison statistics for experiment summaries. Plain ESM so the CLI, the server and
// `node --test` all run the same code. No dependencies; the numbers are simple on purpose.

/** Arithmetic mean; NaN for an empty sample. */
export function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

/** Sample standard deviation (n-1); 0 for fewer than two values. */
export function sd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Deterministic PRNG (mulberry32) so a summary is reproducible from its seed. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap CI of the mean of `xs`.
 * Returns { lo, hi } at the given level; both NaN when the sample is empty.
 */
export function bootstrapCI(xs, { level = 0.95, resamples = 2000, seed = 1 } = {}) {
  if (!xs.length) return { lo: NaN, hi: NaN };
  if (xs.length === 1) return { lo: xs[0], hi: xs[0] };
  const r = rng(seed);
  const means = new Array(resamples);
  for (let i = 0; i < resamples; i++) {
    let s = 0;
    for (let j = 0; j < xs.length; j++) s += xs[Math.floor(r() * xs.length)];
    means[i] = s / xs.length;
  }
  means.sort((a, b) => a - b);
  const q = (p) => means[Math.min(resamples - 1, Math.max(0, Math.floor(p * resamples)))];
  return { lo: q((1 - level) / 2), hi: q(1 - (1 - level) / 2) };
}

/**
 * Paired comparison of a condition against a baseline. `pairs` is a list of
 * [baselineValue, conditionValue] for the same seed (and same position, when swapped).
 * Null/NaN values drop the pair: a trial that failed to produce the outcome is reported
 * separately as `missing`, never silently treated as zero.
 */
export function pairedDelta(pairs, opts = {}) {
  const ok = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const deltas = ok.map(([a, b]) => b - a);
  const ci = bootstrapCI(deltas, opts);
  return {
    n: ok.length,
    missing: pairs.length - ok.length,
    baselineMean: mean(ok.map(([a]) => a)),
    conditionMean: mean(ok.map(([, b]) => b)),
    delta: mean(deltas),
    sd: sd(deltas),
    ci95: ci,
    // sign counts are the honest summary for small n: how many pairs moved which way
    up: deltas.filter((d) => d > 0).length,
    down: deltas.filter((d) => d < 0).length,
    tied: deltas.filter((d) => d === 0).length,
    // a CI that excludes zero is the only "significance" this tool reports
    // fewer than three pairs cannot support the claim, whatever the resamples say
    excludesZero: ok.length >= 3 && Number.isFinite(ci.lo) && (ci.lo > 0 || ci.hi < 0),
  };
}

/** Rate of a boolean across trials, with the count it is based on. */
export function rate(bools) {
  const xs = bools.filter((b) => b === true || b === false);
  return { rate: xs.length ? xs.filter(Boolean).length / xs.length : NaN, n: xs.length };
}
