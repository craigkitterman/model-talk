import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapCI, mean, pairedDelta, rate, sd } from "../shared/stats.mjs";

test("mean and sd", () => {
  assert.equal(mean([1, 2, 3]), 2);
  assert.ok(Number.isNaN(mean([])));
  assert.equal(sd([2, 2, 2]), 0);
  assert.ok(Math.abs(sd([1, 2, 3, 4]) - 1.2910) < 1e-3);
});

test("bootstrap CI is deterministic and brackets the mean", () => {
  const xs = [0.1, 0.4, 0.35, 0.8, 0.5];
  const a = bootstrapCI(xs, { seed: 3 });
  const b = bootstrapCI(xs, { seed: 3 });
  assert.deepEqual(a, b);
  assert.ok(a.lo <= mean(xs) && mean(xs) <= a.hi);
  assert.deepEqual(bootstrapCI([0.7]), { lo: 0.7, hi: 0.7 });
  assert.ok(Number.isNaN(bootstrapCI([]).lo));
});

test("paired delta drops missing pairs and counts signs", () => {
  const d = pairedDelta([[0, 1], [0, 1], [1, 1], [NaN, 1], [0.5, null]]);
  assert.equal(d.n, 3);
  assert.equal(d.missing, 2);
  assert.equal(d.up, 2);
  assert.equal(d.tied, 1);
  assert.equal(d.down, 0);
  assert.ok(Math.abs(d.delta - 2 / 3) < 1e-9);
});

test("a clear effect excludes zero; a null effect does not", () => {
  const strong = pairedDelta(Array.from({ length: 12 }, (_, i) => [0.1 + (i % 3) * 0.01, 0.9 - (i % 2) * 0.01]));
  assert.equal(strong.excludesZero, true);
  const nothing = pairedDelta(Array.from({ length: 12 }, (_, i) => [0.5, 0.5 + (i % 2 ? 0.05 : -0.05)]));
  assert.equal(nothing.excludesZero, false);
  assert.equal(pairedDelta([[0, 1]]).excludesZero, false, "one pair can never be significant");
  assert.equal(pairedDelta([[0, 1], [0, 1]]).excludesZero, false, "two identical pairs are still not evidence");
  assert.equal(pairedDelta([[0, 1], [0, 1], [0, 1]]).excludesZero, false, "three concordant pairs happen 25% of the time under no effect");
  assert.equal(pairedDelta([[0, 1], [0, 1], [0, 1], [0, 1], [0, 1], [0, 1]]).excludesZero, true, "six concordant pairs may claim it");
});

test("rate ignores nulls", () => {
  assert.deepEqual(rate([true, false, null, true]), { rate: 2 / 3, n: 3 });
  assert.ok(Number.isNaN(rate([]).rate));
});
