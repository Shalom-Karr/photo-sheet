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
  assert.equal(LETTER.ratioCap, 3);
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

import { absorbResidual } from '../src/layout.js';

test('zero tolerance leaves heights untouched and crops nothing', () => {
  const r = absorbResidual([3, 3, 3], 0.08, 10.5, 0);
  assert.equal(r.cropFraction, 0);
  assert.deepEqual(r.heights, [3, 3, 3]);
});

test('residual is absorbed and grown heights fill the page', () => {
  const heights = [3, 3, 3];
  const r = absorbResidual(heights, 0.08, 9.4, 0.5);
  const used = r.heights.reduce((a, b) => a + b, 0) + 2 * 0.08;
  assert.ok(Math.abs(used - 9.4) < 1e-6, `used ${used}, expected 9.4`);
});

test('crop fraction is identical across rows by construction', () => {
  // Uniform crop is the point: crop that varies photo to photo reads as broken.
  const heights = [2, 4, 3];
  const r = absorbResidual(heights, 0.08, 10.5, 0.5);
  const scale = r.heights[0] / heights[0];
  for (let i = 1; i < heights.length; i++) {
    assert.ok(Math.abs(r.heights[i] / heights[i] - scale) < 1e-9);
  }
  assert.ok(Math.abs(1 - 1 / scale - r.cropFraction) < 1e-9);
});

test('crop never exceeds tolerance; the remainder becomes gutter', () => {
  const heights = [2, 2, 2];
  const r = absorbResidual(heights, 0.08, 10.5, 0.06);
  assert.ok(r.cropFraction <= 0.06 + 1e-9, `crop ${r.cropFraction}`);
  assert.ok(r.extraGutter > 0, 'leftover should widen the gutters');
});

test('no residual means no crop and no extra gutter', () => {
  const used = 3 + 3 + 3 + 2 * 0.08;
  const r = absorbResidual([3, 3, 3], 0.08, used, 0.06);
  assert.ok(Math.abs(r.cropFraction) < 1e-9);
  assert.ok(Math.abs(r.extraGutter) < 1e-9);
});

import { layout } from '../src/layout.js';

const mk = (aspects) => aspects.map((a, i) => ({ id: `p${i}`, aspect: a }));

test('placements stay inside the printable area', () => {
  const { placements } = layout(mk([1.5, 1.78, 1, 0.67, 1.33, 1.5]), LETTER);
  for (const p of placements) {
    assert.ok(p.xIn >= LETTER.marginIn - 1e-6);
    assert.ok(p.yIn >= LETTER.marginIn - 1e-6);
    assert.ok(p.xIn + p.wIn <= LETTER.widthIn - LETTER.marginIn + 1e-6);
    assert.ok(p.yIn + p.hIn <= LETTER.heightIn - LETTER.marginIn + 1e-6);
  }
});

test('every photo is placed exactly once', () => {
  const photos = mk([1.5, 1.78, 1, 0.67, 1.33, 1.5, 1]);
  const { placements } = layout(photos, LETTER);
  assert.equal(placements.length, photos.length);
  assert.equal(new Set(placements.map(p => p.photoId)).size, photos.length);
});

test('zero crop tolerance preserves aspect ratios exactly', () => {
  const photos = mk([1.5, 1.78, 1, 0.67]);
  const { placements } = layout(photos, { ...LETTER, cropTolerance: 0 });
  placements.forEach((p, i) => {
    assert.ok(Math.abs(p.wIn / p.hIn - photos[i].aspect) < 1e-6);
    assert.equal(p.srcRect.w, 1);
  });
});

test('cropping trims width only, never height', () => {
  const photos = mk([1.5, 1.78, 1, 0.67, 1.33]);
  const { placements } = layout(photos, { ...LETTER, cropTolerance: 0.5 });
  for (const p of placements) {
    assert.equal(p.srcRect.h, 1, 'height must never be trimmed');
    assert.equal(p.srcRect.y, 0);
    assert.ok(p.srcRect.w <= 1 && p.srcRect.w > 0);
  }
});

test('cropOffset shifts the window but keeps it inside the source', () => {
  const photos = mk([1.5, 1.78, 1, 0.67, 1.33]).map(p => ({ ...p, cropOffset: 1 }));
  const { placements } = layout(photos, { ...LETTER, cropTolerance: 0.5 });
  for (const p of placements) {
    assert.ok(p.srcRect.x >= -1e-9);
    assert.ok(p.srcRect.x + p.srcRect.w <= 1 + 1e-9);
  }
});

test('a pinned photo gets a row to itself', () => {
  const photos = mk([1.5, 1.78, 1, 1.33]);
  photos[1].pinned = true;
  const { placements } = layout(photos, LETTER);
  const pin = placements.find(p => p.photoId === 'p1');
  const sameRow = placements.filter(p => Math.abs(p.yIn - pin.yIn) < 1e-6);
  assert.equal(sameRow.length, 1);
  assert.ok(Math.abs(pin.wIn - (LETTER.widthIn - 2 * LETTER.marginIn)) < 1e-6);
});

test('too many photos raises a density warning', () => {
  const many = mk(Array.from({ length: 60 }, () => 1.5));
  const { warnings } = layout(many, LETTER);
  assert.ok(warnings.some(w => w.code === 'density'));
});

test('a comfortable sheet raises no warnings', () => {
  const { warnings } = layout(mk([1.5, 1.78, 1, 1.33, 1.5, 1]), LETTER);
  assert.equal(warnings.length, 0);
});

test('empty input is not an error', () => {
  const { placements, warnings } = layout([], LETTER);
  assert.deepEqual(placements, []);
  assert.deepEqual(warnings, []);
});

test('a clamped row is centred rather than left-aligned', () => {
  // 8 / 0.667 = 12in wide at full height; clamped to the 10.5in page it
  // becomes 7.0in wide, leaving 0.5in of slack to split evenly.
  const { placements } = layout([{ id: 'a', aspect: 0.667 }], LETTER);
  assert.equal(placements.length, 1);
  const p = placements[0];
  const leftGap = p.xIn - LETTER.marginIn;
  const rightGap = (LETTER.widthIn - LETTER.marginIn) - (p.xIn + p.wIn);
  assert.ok(Math.abs(leftGap - rightGap) < 1e-6, `left ${leftGap} right ${rightGap}`);
  assert.ok(leftGap > 0, 'a clamped row should have slack on both sides');
});
