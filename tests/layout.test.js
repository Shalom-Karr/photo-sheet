import test from 'node:test';
import assert from 'node:assert/strict';
import { rowHeight, LETTER, breakRows, totalHeight } from '../src/layout.js';

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

test('rows cover every photo exactly once, in order', () => {
  const aspects = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1];
  const rows = breakRows(aspects, 8, 0.08, 2.0);
  assert.equal(rows[0][0], 0);
  assert.equal(rows[rows.length - 1][1], aspects.length);
  for (let i = 1; i < rows.length; i++) {
    assert.equal(rows[i][0], rows[i - 1][1], 'rows must be contiguous');
  }
});

test('a larger target height produces more rows', () => {
  const aspects = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1, 1.78];
  const few = breakRows(aspects, 8, 0.08, 1.0);
  const many = breakRows(aspects, 8, 0.08, 3.0);
  assert.ok(many.length > few.length);
});

test('DP beats greedy on a set built to strand a runt final row', () => {
  // Greedy fills until overflow and leaves one photo alone on the last row.
  const aspects = [1.5, 1.5, 1.5, 1.5, 1.5];
  const target = 2.0;
  const rows = breakRows(aspects, 8, 0.08, target);
  const heights = rows.map(([s, e]) => rowHeight(aspects.slice(s, e), 8, 0.08));
  const worst = Math.max(...heights.map(h => Math.abs(h - target)));
  // A stranded single photo would be ~5.3in tall, far from the 2in target.
  assert.ok(worst < 2.0, `worst deviation ${worst} suggests a runt row`);
});

test('totalHeight sums rows plus the gutters between them', () => {
  const aspects = [1.5, 1.5, 1.5, 1.5];
  const rows = breakRows(aspects, 8, 0.08, 2.0);
  const expected =
    rows.reduce((s, [a, b]) => s + rowHeight(aspects.slice(a, b), 8, 0.08), 0) +
    (rows.length - 1) * 0.08;
  assert.ok(Math.abs(totalHeight(aspects, rows, 8, 0.08) - expected) < 1e-9);
});
