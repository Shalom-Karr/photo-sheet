import test from 'node:test';
import assert from 'node:assert/strict';
import { rowHeight, LETTER } from '../src/layout.js';

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
