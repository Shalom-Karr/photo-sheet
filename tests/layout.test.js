import test from 'node:test';
import assert from 'node:assert/strict';
import { rowHeight, LETTER, totalHeight } from '../src/layout.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test('single photo row height makes it exactly content width', () => {
  const h = rowHeight([1.5], 8, 0.08);
  assert.ok(near(h * 1.5, 8), `width was ${h * 1.5}, expected 8`);
});

test('multi photo row is flush including gutters', () => {
  const aspects = [1.5, 1.7778, 1];
  const h = rowHeight(aspects, 8, 0.08);
  const used = aspects.reduce((s, a) => s + a * h, 0) + 2 * 0.08;
  assert.ok(near(used, 8), `used ${used}, expected 8`);
});

test('more photos in a row yields a shorter row', () => {
  assert.ok(rowHeight([1.5, 1.5], 8, 0.08) < rowHeight([1.5], 8, 0.08));
});

test('LETTER defaults match the spec', () => {
  assert.equal(LETTER.widthIn, 8.5);
  assert.equal(LETTER.heightIn, 11);
  assert.equal(LETTER.marginIn, 0.25);
  assert.equal(LETTER.gutterIn, 0.08);
  assert.equal(LETTER.cropTolerance, 0.06);
  assert.equal(LETTER.minPhotoIn, 1.5);
});

test('totalHeight sums rows plus the gutters between them', () => {
  const aspects = [1.5, 1.5, 1.5, 1.5];
  const rows = [[0, 2], [2, 4]];
  // Each row: two 1.5-aspect photos across 8in with one 0.08 gutter.
  // h = (8 - 0.08) / 3 = 2.64. Two rows plus one gutter between them.
  assert.ok(Math.abs(totalHeight(aspects, rows, 8, 0.08) - (2.64 * 2 + 0.08)) < 1e-9);
});

import { solveRows } from '../src/layout.js';

const CW = 8.0;   // 8.5 - 2*0.25
const CH = 10.5;  // 11  - 2*0.25

const fill = (r, contentH = CH) =>
  (r.heights.reduce((a, b) => a + b, 0) + (r.rows.length - 1) * 0.08) / contentH;

test('rows are contiguous and cover every photo once', () => {
  const aspects = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1];
  const { rows } = solveRows(aspects, CW, CH, 0.08);
  assert.equal(rows[0][0], 0);
  assert.equal(rows[rows.length - 1][1], aspects.length);
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i][0], rows[i - 1][1]);
});

test('never overflows the content height', () => {
  const sets = [
    [1.5],
    [0.67],
    [1.5, 1.78],
    Array.from({ length: 20 }, (_, i) => [1, 1.25, 1.33, 1.5, 1.78][i % 5]),
  ];
  for (const aspects of sets) {
    const r = solveRows(aspects, CW, CH, 0.08);
    const used = r.heights.reduce((a, b) => a + b, 0) + (r.rows.length - 1) * 0.08;
    assert.ok(used <= CH + 1e-6, `used ${used} for ${aspects.length} photos`);
  }
});

test('fills the page far better than near-uniform rows did', () => {
  // The superseded binary-search design scored 0.736 on this exact input.
  const aspects = Array.from({ length: 12 }, (_, i) => [1, 1.33, 1.5, 1.78][i % 4]);
  assert.ok(fill(solveRows(aspects, CW, CH, 0.08)) > 0.84);
});

test('ten identical landscapes fill the page', () => {
  // Scored 0.470 under the superseded design.
  assert.ok(fill(solveRows(Array(10).fill(1.5), CW, CH, 0.08)) > 0.85);
});

test('a lower ratio cap trades fill for evenness', () => {
  const aspects = Array.from({ length: 12 }, (_, i) => [1, 1.33, 1.5, 1.78][i % 4]);
  const loose = solveRows(aspects, CW, CH, 0.08, { ratioCap: 3 });
  const tight = solveRows(aspects, CW, CH, 0.08, { ratioCap: 1.5 });
  const spread = (r) => Math.max(...r.heights) / Math.min(...r.heights);
  assert.ok(spread(tight) <= spread(loose) + 1e-9);
  assert.ok(fill(tight) <= fill(loose) + 1e-9);
});

test('no row height exceeds the cap times the shortest, absent pinning', () => {
  const aspects = Array.from({ length: 14 }, (_, i) => [1, 1.33, 1.5, 1.78, 0.67, 0.75][i % 6]);
  const r = solveRows(aspects, CW, CH, 0.08, { ratioCap: 3 });
  assert.ok(Math.max(...r.heights) / Math.min(...r.heights) <= 3 + 1e-6);
});

test('a single portrait is clamped to the page instead of overflowing', () => {
  // 8 / 0.667 = 12in tall, taller than the 10.5in content height.
  const r = solveRows([0.667], CW, CH, 0.08);
  assert.equal(r.rows.length, 1);
  assert.ok(r.heights[0] <= CH + 1e-9, `height ${r.heights[0]} exceeds page`);
});

test('a pinned photo takes a row alone even when that breaks the window', () => {
  const aspects = [1.5, 1.78, 1, 1.33];
  const pinned = [false, true, false, false];
  const { rows } = solveRows(aspects, CW, CH, 0.08, { pinned });
  assert.ok(rows.some(([s, e]) => s === 1 && e === 2), 'pinned photo must be alone');
});

test('empty input yields no rows', () => {
  assert.deepEqual(solveRows([], CW, CH, 0.08).rows, []);
});
