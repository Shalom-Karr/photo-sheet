import test from 'node:test';
import assert from 'node:assert/strict';
import { record, undo, redo, clear, canUndo, canRedo, depth, setClock } from '../src/history.js';

const mkState = (n = 3) => ({
  photos: Array.from({ length: n }, (_, i) => ({ id: `p${i}`, aspect: 1.5, pinned: false, cropOffset: 0, targetHeightIn: null, blob: {}, url: `u${i}` })),
  selectedId: null,
});

test('undo restores the photos as they were', () => {
  clear();
  const s = mkState(3);
  record(s);
  s.photos.splice(1, 1);
  assert.equal(s.photos.length, 2);
  assert.equal(undo(s), true);
  assert.equal(s.photos.length, 3);
  assert.deepEqual(s.photos.map((p) => p.id), ['p0', 'p1', 'p2']);
});

test('undo with nothing recorded returns false', () => {
  clear();
  assert.equal(canUndo(), false);
  assert.equal(undo(mkState()), false);
});

test('redo reapplies what undo reverted', () => {
  clear();
  const s = mkState(3);
  record(s);
  s.photos.splice(0, 1);
  undo(s);
  assert.equal(canRedo(), true);
  assert.equal(redo(s), true);
  assert.deepEqual(s.photos.map((p) => p.id), ['p1', 'p2']);
});

test('a new change clears the redo stack', () => {
  clear();
  const s = mkState(3);
  record(s);
  s.photos.pop();
  undo(s);
  assert.equal(canRedo(), true);
  record(s);
  assert.equal(canRedo(), false);
});

test('snapshots are independent of later mutation', () => {
  clear();
  const s = mkState(2);
  record(s);
  s.photos[0].pinned = true;
  s.photos[0].targetHeightIn = 4;
  undo(s);
  assert.equal(s.photos[0].pinned, false, 'the snapshot must not alias the live photo');
  assert.equal(s.photos[0].targetHeightIn, null);
});

test('the blob is shared, not copied', () => {
  clear();
  const s = mkState(1);
  const blob = s.photos[0].blob;
  record(s);
  s.photos = [];
  undo(s);
  assert.equal(s.photos[0].blob, blob, 'restoring must give back the same blob');
});

test('a coalesce key merges a burst into one step', () => {
  clear();
  let t = 1000;
  setClock(() => t);
  const s = mkState(2);
  record(s, 'crop:p0'); s.photos[0].cropOffset = 0.1;
  t += 100; record(s, 'crop:p0'); s.photos[0].cropOffset = 0.2;
  t += 100; record(s, 'crop:p0'); s.photos[0].cropOffset = 0.3;
  assert.equal(depth().past, 1, 'a burst on one key is one entry');
  undo(s);
  assert.equal(s.photos[0].cropOffset, 0, 'undo returns to before the burst');
  setClock(() => Date.now());
});

test('a coalesce key past the window starts a new step', () => {
  clear();
  let t = 1000;
  setClock(() => t);
  const s = mkState(2);
  record(s, 'crop:p0'); s.photos[0].cropOffset = 0.1;
  t += 5000; record(s, 'crop:p0'); s.photos[0].cropOffset = 0.2;
  assert.equal(depth().past, 2);
  setClock(() => Date.now());
});

test('different coalesce keys do not merge', () => {
  clear();
  let t = 1000;
  setClock(() => t);
  const s = mkState(2);
  record(s, 'crop:p0');
  t += 10; record(s, 'crop:p1');
  assert.equal(depth().past, 2);
  setClock(() => Date.now());
});

test('history is capped', () => {
  clear();
  const s = mkState(1);
  for (let i = 0; i < 80; i++) record(s);
  assert.ok(depth().past <= 50, `past was ${depth().past}`);
});

test('a restored selection that no longer exists is dropped', () => {
  clear();
  const s = mkState(3);
  s.selectedId = 'p2';
  record(s);
  s.photos = s.photos.filter((p) => p.id !== 'p2');
  s.selectedId = null;
  undo(s);
  assert.equal(s.selectedId, 'p2', 'p2 exists again, so the selection comes back');
  clear();
  const s2 = mkState(3);
  s2.selectedId = 'p9';
  record(s2);
  undo(s2);
  assert.equal(s2.selectedId, null, 'a selection with no matching photo is dropped');
});
