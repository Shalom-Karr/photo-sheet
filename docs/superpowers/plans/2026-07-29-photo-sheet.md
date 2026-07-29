# Photo Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local web app that packs photos of mixed aspect ratios onto a single printable sheet with minimal blank space, re-solving automatically as photos are added or removed.

**Architecture:** One pure function `layout(photos, page) → placements` carries all the risk and all the math; everything else is plumbing. Rows are solved to be flush with the content width, row break points come from an O(n²) dynamic program, and the target row height is binary-searched so the page fills vertically. Placements are emitted in **inches** — the preview scales by a screen factor, PNG by 300, PDF by 72, so preview and print can never drift.

**Tech Stack:** Vanilla ES modules (no build step, no framework), Tailwind via CDN, `pdf-lib` via ESM CDN, `node --test` for unit tests (zero dependencies).

## Global Constraints

- No build step. Browser loads `.js` files as native ES modules directly.
- No frontend framework. No bundler. No transpiler.
- `layout.js` must remain **pure**: no DOM access, no imports, no I/O. It is the only unit-tested module and must be importable unchanged in both Node and the browser.
- All geometry in `layout.js` is in **inches**. Pixel and point conversion happens only in renderers.
- Page defaults: 8.5 × 11 in, margin 0.25 in, gutter 0.08 in, crop tolerance 0.06, minimum photo dimension 1.5 in.
- Crop is **horizontal only** — rows are width-constrained, so absorbing residual height always trims left/right edges.
- Single sheet only. Overflow raises a density warning; it never flows to page 2.
- Tests run with `node --test tests/`. Requires `"type": "module"` in `package.json`.

---

### Task 1: Scaffold and flush row height

**Files:**
- Create: `package.json`
- Create: `src/layout.js`
- Create: `.gitignore`
- Test: `tests/layout.test.js`

**Interfaces:**
- Consumes: nothing
- Produces: `LETTER` (page defaults object), `rowHeight(aspects: number[], contentW: number, gutterIn: number): number`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "photo-sheet",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `.gitignore`**

```
node_modules/
*.pdf
*.png
.DS_Store
```

- [ ] **Step 3: Write the failing test**

Create `tests/layout.test.js`:

```js
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — cannot find module `../src/layout.js`

- [ ] **Step 5: Write minimal implementation**

Create `src/layout.js`:

```js
export const LETTER = {
  widthIn: 8.5,
  heightIn: 11,
  marginIn: 0.25,
  gutterIn: 0.08,
  cropTolerance: 0.06,
  minPhotoIn: 1.5,
};

// Photos in a row share height h. Their widths plus gutters must equal contentW:
//   h * Σaspect + (n-1) * gutter = contentW
export function rowHeight(aspects, contentW, gutterIn) {
  const sum = aspects.reduce((s, a) => s + a, 0);
  return (contentW - (aspects.length - 1) * gutterIn) / sum;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS, 4 tests

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore src/layout.js tests/layout.test.js
git commit -m "Solve row height from the flush-width constraint

A row's height is not a free parameter: once photos are assigned to a
row, spanning the content width exactly determines it. Encoding that as
an equation rather than a search removes a whole class of tuning."
```

---

### Task 2: Row breaking by dynamic programming

**Files:**
- Modify: `src/layout.js`
- Test: `tests/layout.test.js`

**Interfaces:**
- Consumes: `rowHeight`
- Produces: `breakRows(aspects, contentW, gutterIn, targetH): Array<[start, end]>` — half-open index ranges, in order, covering all photos. `totalHeight(aspects, rows, contentW, gutterIn): number`

- [ ] **Step 1: Write the failing test**

Append to `tests/layout.test.js`:

```js
import { breakRows, totalHeight } from '../src/layout.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `breakRows` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/layout.js`:

```js
// Choose row break points minimising Σ(rowHeight − targetH)².
// Greedy row filling (add photos until overflow, then break) is what strands a
// single photo on the last row. This considers every split, so it cannot.
export function breakRows(aspects, contentW, gutterIn, targetH, pinned = []) {
  const n = aspects.length;
  if (n === 0) return [];

  const best = new Array(n + 1).fill(Infinity);
  const prev = new Array(n + 1).fill(0);
  best[0] = 0;

  for (let j = 1; j <= n; j++) {
    for (let i = 1; i <= j; i++) {
      if (best[i - 1] === Infinity) continue;

      // A pinned photo takes a row alone, so any longer slice containing one
      // is not a legal row.
      const len = j - i + 1;
      if (len > 1) {
        let blocked = false;
        for (let k = i - 1; k < j; k++) if (pinned[k]) { blocked = true; break; }
        if (blocked) continue;
      }

      const h = rowHeight(aspects.slice(i - 1, j), contentW, gutterIn);
      if (!(h > 0)) continue; // gutters exceed the content width

      const cost = best[i - 1] + (h - targetH) ** 2;
      if (cost < best[j]) {
        best[j] = cost;
        prev[j] = i - 1;
      }
    }
  }

  const rows = [];
  let j = n;
  while (j > 0) {
    const i = prev[j];
    rows.unshift([i, j]);
    j = i;
  }
  return rows;
}

export function totalHeight(aspects, rows, contentW, gutterIn) {
  if (rows.length === 0) return 0;
  const sum = rows.reduce(
    (s, [a, b]) => s + rowHeight(aspects.slice(a, b), contentW, gutterIn),
    0,
  );
  return sum + (rows.length - 1) * gutterIn;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout.js tests/layout.test.js
git commit -m "Break rows with a DP instead of greedy filling

Greedy fills a row until it overflows, which reliably strands one photo
alone on the final row at several times everyone else's size. Costing
every possible split is O(n^2) — 400 evaluations at 20 photos — and
removes the failure mode rather than tuning around it."
```

---

### Task 3: Binary search the target height

**Files:**
- Modify: `src/layout.js`
- Test: `tests/layout.test.js`

**Interfaces:**
- Consumes: `breakRows`, `totalHeight`
- Produces: `solveRows(aspects, contentW, contentH, gutterIn, pinned): { rows, heights }` where `heights[i]` is the solved height of `rows[i]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/layout.test.js`:

```js
import { solveRows } from '../src/layout.js';

const CW = 8.0;   // 8.5 - 2*0.25
const CH = 10.5;  // 11  - 2*0.25

test('solved layout never exceeds the content height', () => {
  const sets = [
    [1.5],
    [1.5, 1.78],
    [1.5, 1.78, 1, 0.67, 1.33],
    Array.from({ length: 20 }, (_, i) => [1, 1.25, 1.33, 1.5, 1.78][i % 5]),
  ];
  for (const aspects of sets) {
    const { rows, heights } = solveRows(aspects, CW, CH, 0.08, []);
    const used = heights.reduce((a, b) => a + b, 0) + (rows.length - 1) * 0.08;
    assert.ok(used <= CH + 1e-6, `used ${used} exceeds ${CH}`);
  }
});

test('solved layout uses most of the page rather than a fraction of it', () => {
  const aspects = Array.from({ length: 12 }, (_, i) => [1, 1.33, 1.5, 1.78][i % 4]);
  const { rows, heights } = solveRows(aspects, CW, CH, 0.08, []);
  const used = heights.reduce((a, b) => a + b, 0) + (rows.length - 1) * 0.08;
  assert.ok(used > CH * 0.85, `only used ${used} of ${CH}`);
});

test('every solved row is flush to the content width', () => {
  const aspects = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1];
  const { rows, heights } = solveRows(aspects, CW, CH, 0.08, []);
  rows.forEach(([s, e], r) => {
    const w = aspects.slice(s, e).reduce((sum, a) => sum + a * heights[r], 0)
      + (e - s - 1) * 0.08;
    assert.ok(Math.abs(w - CW) < 1e-6, `row ${r} width ${w}, expected ${CW}`);
  });
});

test('empty input yields no rows', () => {
  const { rows } = solveRows([], CW, CH, 0.08, []);
  assert.equal(rows.length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `solveRows` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/layout.js`:

```js
// Total height rises monotonically with targetH: a small target favours many
// photos per row (short rows, short page), a large target favours few.
// So the target height that fills the sheet can be binary-searched.
//
// This is the step that adapts horizontal justification to a fixed sheet. Web
// galleries scroll forever and only justify width, so they pick a target height
// as a constant. A sheet has a hard bottom edge, so it is a solved variable.
export function solveRows(aspects, contentW, contentH, gutterIn, pinned = []) {
  if (aspects.length === 0) return { rows: [], heights: [] };

  const measure = (t) => {
    const rows = breakRows(aspects, contentW, gutterIn, t, pinned);
    return { rows, total: totalHeight(aspects, rows, contentW, gutterIn) };
  };

  let lo = 1e-3;
  let hi = contentH;
  let best = measure(lo);

  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const m = measure(mid);
    if (m.total > contentH) {
      hi = mid;
    } else {
      lo = mid;
      best = m;
    }
  }

  const heights = best.rows.map(([s, e]) =>
    rowHeight(aspects.slice(s, e), contentW, gutterIn),
  );
  return { rows: best.rows, heights };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS, 12 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout.js tests/layout.test.js
git commit -m "Binary-search the target row height to fill the sheet

Web galleries treat target row height as a constant because they scroll
indefinitely and only need to justify width. A sheet has a hard bottom
edge, so total height becoming a constraint makes target height a solved
variable instead."
```

---

### Task 4: Residual absorption and uniform crop

**Files:**
- Modify: `src/layout.js`
- Test: `tests/layout.test.js`

**Interfaces:**
- Consumes: nothing from prior tasks
- Produces: `absorbResidual(heights, gutterIn, contentH, cropTolerance): { heights, cropFraction, extraGutter }`

- [ ] **Step 1: Write the failing test**

Append to `tests/layout.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `absorbResidual` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/layout.js`:

```js
// Growing a row from h to h*scale keeps its width fixed, so each photo's source
// is trimmed left and right by 1 − 1/scale. Distributing the residual in
// proportion to row height makes that fraction identical on every row.
export function absorbResidual(heights, gutterIn, contentH, cropTolerance) {
  const n = heights.length;
  if (n === 0) return { heights: [], cropFraction: 0, extraGutter: 0 };

  const sumH = heights.reduce((a, b) => a + b, 0);
  const used = sumH + (n - 1) * gutterIn;
  const residual = contentH - used;

  if (residual <= 1e-9 || cropTolerance <= 0) {
    return { heights: heights.slice(), cropFraction: 0, extraGutter: 0 };
  }

  // crop = residual / (sumH + residual); invert for the tolerance-capped case.
  let cropFraction = residual / (sumH + residual);
  let absorbed = residual;
  if (cropFraction > cropTolerance) {
    cropFraction = cropTolerance;
    absorbed = (sumH * cropTolerance) / (1 - cropTolerance);
  }

  const scale = (sumH + absorbed) / sumH;
  // Whitespace the crop cap could not absorb is spread across every gap —
  // above, between and below — so it reads as margin rather than a bottom band.
  const extraGutter = (residual - absorbed) / (n + 1);

  return { heights: heights.map((h) => h * scale), cropFraction, extraGutter };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS, 17 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout.js tests/layout.test.js
git commit -m "Absorb leftover height as a uniform crop across all rows

Distributing residual in proportion to row height makes the crop
fraction algebraically identical everywhere. That matters perceptually:
a consistent trim reads as intentional, whereas crop that varies photo
to photo reads as a bug. Whatever the tolerance cap cannot absorb is
spread across all gaps instead of pooling into a band at the bottom."
```

---

### Task 5: The `layout()` entry point

**Files:**
- Modify: `src/layout.js`
- Test: `tests/layout.test.js`

**Interfaces:**
- Consumes: `solveRows`, `absorbResidual`
- Produces: `layout(photos, page): { placements, warnings }`
  - `photos`: `Array<{ id, aspect, cropOffset?, pinned? }>`
  - `placements`: `Array<{ photoId, xIn, yIn, wIn, hIn, srcRect: { x, y, w, h } }>` — `srcRect` normalised 0..1
  - `warnings`: `Array<{ code: 'density', message: string }>`

- [ ] **Step 1: Write the failing test**

Append to `tests/layout.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/`
Expected: FAIL — `layout` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/layout.js`:

```js
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function layout(photos, page) {
  if (photos.length === 0) return { placements: [], warnings: [] };

  const contentW = page.widthIn - 2 * page.marginIn;
  const contentH = page.heightIn - 2 * page.marginIn;
  const aspects = photos.map((p) => p.aspect);
  const pinned = photos.map((p) => !!p.pinned);

  const { rows, heights } = solveRows(
    aspects, contentW, contentH, page.gutterIn, pinned,
  );
  const abs = absorbResidual(heights, page.gutterIn, contentH, page.cropTolerance);

  // Visible slice of each source after the uniform horizontal trim.
  const visW = 1 - abs.cropFraction;

  const placements = [];
  let y = page.marginIn + abs.extraGutter;

  rows.forEach(([start, end], r) => {
    const rowH = abs.heights[r];
    // Width is fixed by the pre-absorption height, so growing the row crops.
    const baseH = heights[r];
    let x = page.marginIn;

    for (let i = start; i < end; i++) {
      const wIn = aspects[i] * baseH;
      const offset = clamp(photos[i].cropOffset ?? 0, -1, 1);
      const slack = 1 - visW;
      const sx = clamp(slack / 2 + (offset * slack) / 2, 0, slack);

      placements.push({
        photoId: photos[i].id,
        xIn: x,
        yIn: y,
        wIn,
        hIn: rowH,
        srcRect: { x: sx, y: 0, w: visW, h: 1 },
      });
      x += wIn + page.gutterIn;
    }
    y += rowH + page.gutterIn + abs.extraGutter;
  });

  const warnings = [];
  const smallest = Math.min(...placements.map((p) => Math.min(p.wIn, p.hIn)));
  if (smallest < page.minPhotoIn) {
    warnings.push({
      code: 'density',
      message:
        `Smallest photo is ${smallest.toFixed(2)} in, below the ` +
        `${page.minPhotoIn} in minimum. Remove photos or lower the minimum.`,
    });
  }

  return { placements, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/`
Expected: PASS, 26 tests

- [ ] **Step 5: Commit**

```bash
git add src/layout.js tests/layout.test.js
git commit -m "Assemble the layout entry point, emitting inches

Placements are in inches rather than pixels so the preview, the PNG and
the PDF are three renderers over one coordinate system. Preview and
print cannot drift, because there is nothing to drift between.

Pinning is defined as taking a row alone, which is unambiguous and needs
no cost function, unlike a 'make it bigger' multiplier."
```

---

### Task 6: App shell and preview

**Files:**
- Create: `index.html`
- Create: `src/preview.js`
- Create: `src/main.js`

**Interfaces:**
- Consumes: `layout`, `LETTER` from `src/layout.js`
- Produces: `renderPreview(container, photos, placements, page)` — draws placements as positioned DOM. `state` in `main.js`: `{ photos: Photo[], page }` where `Photo` is `{ id, blob, url, mime, naturalW, naturalH, aspect, cropOffset, pinned }`.

- [ ] **Step 1: Create `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Photo Sheet</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen">
  <div class="flex h-screen">
    <aside class="w-72 shrink-0 bg-slate-800 p-4 space-y-4 overflow-y-auto">
      <h1 class="text-lg font-semibold">Photo Sheet</h1>

      <div class="space-y-2">
        <button id="pick" class="w-full rounded bg-sky-600 hover:bg-sky-500 px-3 py-2 text-sm">Add photos…</button>
        <p class="text-xs text-slate-400">or paste with Ctrl+V, or drag files onto the sheet</p>
      </div>

      <label class="block text-sm">Crop tolerance: <span id="cropVal">6</span>%
        <input id="crop" type="range" min="0" max="20" value="6" class="w-full">
      </label>

      <label class="block text-sm">Gutter: <span id="gutVal">0.08</span> in
        <input id="gutter" type="range" min="0" max="50" value="8" class="w-full">
      </label>

      <label class="block text-sm">Min photo size: <span id="minVal">1.5</span> in
        <input id="minsize" type="range" min="5" max="40" value="15" class="w-full">
      </label>

      <div id="warnings" class="text-xs text-amber-300 space-y-1"></div>

      <div class="space-y-2 pt-2">
        <button id="pdf" class="w-full rounded bg-slate-600 hover:bg-slate-500 px-3 py-2 text-sm">Export PDF</button>
        <button id="png" class="w-full rounded bg-slate-600 hover:bg-slate-500 px-3 py-2 text-sm">Export PNG</button>
        <button id="print" class="w-full rounded bg-slate-600 hover:bg-slate-500 px-3 py-2 text-sm">Print</button>
      </div>

      <p id="count" class="text-xs text-slate-400"></p>
    </aside>

    <main class="flex-1 grid place-items-center overflow-auto p-6">
      <div id="sheet" class="relative bg-white shadow-2xl"></div>
    </main>
  </div>

  <script type="module" src="./src/main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/preview.js`**

```js
// Renders inch-space placements at a screen scale. The sheet element is sized
// in pixels from the same page spec the PDF uses, so what you see is what prints.
export const SCREEN_DPI = 96;

export function renderPreview(container, photos, placements, page, scale = 1) {
  const px = SCREEN_DPI * scale;
  container.style.width = `${page.widthIn * px}px`;
  container.style.height = `${page.heightIn * px}px`;
  container.replaceChildren();

  const byId = new Map(photos.map((p) => [p.id, p]));

  for (const pl of placements) {
    const photo = byId.get(pl.photoId);
    if (!photo) continue;

    const box = document.createElement('div');
    box.className = 'absolute overflow-hidden bg-slate-200';
    box.dataset.photoId = pl.photoId;
    box.style.left = `${pl.xIn * px}px`;
    box.style.top = `${pl.yIn * px}px`;
    box.style.width = `${pl.wIn * px}px`;
    box.style.height = `${pl.hIn * px}px`;

    const img = document.createElement('img');
    img.src = photo.url;
    img.draggable = false;
    img.className = 'pointer-events-none select-none';
    // Scale the source so srcRect fills the box, then offset to that window.
    img.style.position = 'absolute';
    img.style.width = `${(pl.wIn / pl.srcRect.w) * px}px`;
    img.style.height = `${(pl.hIn / pl.srcRect.h) * px}px`;
    img.style.left = `${-pl.srcRect.x * (pl.wIn / pl.srcRect.w) * px}px`;
    img.style.top = `${-pl.srcRect.y * (pl.hIn / pl.srcRect.h) * px}px`;

    box.appendChild(img);
    container.appendChild(box);
  }
}
```

- [ ] **Step 3: Create `src/main.js`**

```js
import { layout, LETTER } from './layout.js';
import { renderPreview } from './preview.js';

export const state = {
  photos: [],
  page: { ...LETTER },
};

const sheet = document.getElementById('sheet');
const warningsEl = document.getElementById('warnings');
const countEl = document.getElementById('count');

export function rerender() {
  const { placements, warnings } = layout(state.photos, state.page);

  // Fit the sheet to the viewport without changing any inch-space value.
  const avail = sheet.parentElement.clientHeight - 48;
  const scale = Math.min(1, avail / (state.page.heightIn * 96));
  renderPreview(sheet, state.photos, placements, state.page, scale);

  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('p');
      li.textContent = w.message;
      return li;
    }),
  );
  countEl.textContent = `${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}`;
  return placements;
}

function bindSlider(id, labelId, toValue, key, fmt) {
  const el = document.getElementById(id);
  const label = document.getElementById(labelId);
  el.addEventListener('input', () => {
    state.page[key] = toValue(Number(el.value));
    label.textContent = fmt(state.page[key]);
    rerender();
  });
}

bindSlider('crop', 'cropVal', (v) => v / 100, 'cropTolerance', (v) => Math.round(v * 100));
bindSlider('gutter', 'gutVal', (v) => v / 100, 'gutterIn', (v) => v.toFixed(2));
bindSlider('minsize', 'minVal', (v) => v / 10, 'minPhotoIn', (v) => v.toFixed(1));

rerender();
```

- [ ] **Step 4: Verify in the browser**

Run: `python -m http.server 8000` from the project root, open `http://localhost:8000`.
Expected: dark shell, white letter-proportioned sheet, sliders move without errors, console clean. No photos yet, so the sheet is blank.

- [ ] **Step 5: Commit**

```bash
git add index.html src/preview.js src/main.js
git commit -m "Add the app shell and inch-space preview renderer

The preview scales inch coordinates by 96 and a fit-to-viewport factor
rather than laying out in pixels, so zooming the preview cannot change
what the PDF produces."
```

---

### Task 7: Photo ingest

**Files:**
- Create: `src/photos.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `state`, `rerender` from `main.js`
- Produces: `ingestFiles(fileList): Promise<Photo[]>`, `attachIngest(target, onPhotos)` — wires picker, paste and drop. `Photo` = `{ id, blob, url, mime, naturalW, naturalH, aspect, cropOffset, pinned }`.

- [ ] **Step 1: Create `src/photos.js`**

```js
let seq = 0;

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1'];

// Chrome cannot decode HEIC and iPhone photos are commonly HEIC, so detect it
// by ftyp brand and say so plainly instead of failing with a broken image.
async function isHeic(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...head.slice(4, 12));
  return ascii.startsWith('ftyp') && HEIC_BRANDS.some((b) => ascii.includes(b));
}

export async function ingestFiles(files) {
  const photos = [];
  const rejected = [];

  for (const file of files) {
    if (!file.type.startsWith('image/') && !(await isHeic(file))) continue;
    if (await isHeic(file)) {
      rejected.push(`${file.name}: HEIC is not supported by this browser. Convert to JPEG first.`);
      continue;
    }
    try {
      // from-image applies EXIF rotation. Without it, phone portraits report
      // landscape dimensions and every aspect ratio on the sheet is wrong.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      photos.push({
        id: `p${seq++}`,
        blob: file,
        url: URL.createObjectURL(file),
        mime: file.type,
        naturalW: bitmap.width,
        naturalH: bitmap.height,
        aspect: bitmap.width / bitmap.height,
        cropOffset: 0,
        pinned: false,
      });
      bitmap.close();
    } catch {
      rejected.push(`${file.name}: could not be decoded.`);
    }
  }
  return { photos, rejected };
}

export function attachIngest(dropTarget, pickButton, onResult) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);

  pickButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    onResult(await ingestFiles([...input.files]));
    input.value = '';
  });

  window.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      onResult(await ingestFiles(files));
    }
  });

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  dropTarget.addEventListener('dragover', stop);
  dropTarget.addEventListener('drop', async (e) => {
    stop(e);
    onResult(await ingestFiles([...e.dataTransfer.files]));
  });
}
```

- [ ] **Step 2: Wire it in `src/main.js`**

Add the import at the top:

```js
import { attachIngest } from './photos.js';
```

Add before the final `rerender()` call:

```js
attachIngest(document.body, document.getElementById('pick'), ({ photos, rejected }) => {
  state.photos.push(...photos);
  rerender();
  if (rejected.length) alert(rejected.join('\n'));
});
```

- [ ] **Step 3: Verify all three input paths in the browser**

Run: `python -m http.server 8000`, open `http://localhost:8000`.
Expected, each verified separately:
1. "Add photos…" → select several JPEGs → they appear packed and flush.
2. Copy an image, press Ctrl+V → it is added and the sheet re-solves.
3. Drag files from Explorer onto the window → added.
4. Include at least one phone photo shot in portrait — it must render portrait, not sideways.

- [ ] **Step 4: Commit**

```bash
git add src/photos.js src/main.js
git commit -m "Ingest photos from picker, clipboard and drag-drop

Decoding uses imageOrientation:'from-image' because phone JPEGs carry
EXIF rotation and report swapped dimensions otherwise, which would
corrupt every aspect ratio the packer depends on.

HEIC is detected by ftyp brand and rejected with a clear message —
Chrome cannot decode it and iPhone photos are commonly HEIC, so the
silent failure would otherwise be a broken image with no explanation."
```

---

### Task 8: PDF export and print

**Files:**
- Create: `src/export-pdf.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `layout` output, `state`
- Produces: `buildPdf(photos, placements, page): Promise<Uint8Array>`, `downloadPdf(...)`, `printPdf(...)`

- [ ] **Step 1: Create `src/export-pdf.js`**

```js
import {
  PDFDocument, pushGraphicsState, popGraphicsState,
  moveTo, lineTo, closePath, clip, endPath,
} from 'https://esm.sh/pdf-lib@1.17.1';

const PT = 72;

export async function buildPdf(photos, placements, page) {
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([page.widthIn * PT, page.heightIn * PT]);
  const byId = new Map(photos.map((p) => [p.id, p]));
  const cache = new Map();

  for (const pl of placements) {
    const photo = byId.get(pl.photoId);
    if (!photo) continue;

    if (!cache.has(photo.id)) {
      const bytes = new Uint8Array(await photo.blob.arrayBuffer());
      // Embed original bytes with no re-encode, so no generational quality loss.
      cache.set(
        photo.id,
        photo.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes),
      );
    }
    const img = cache.get(photo.id);

    const x = pl.xIn * PT;
    const w = pl.wIn * PT;
    const h = pl.hIn * PT;
    // PDF origin is bottom-left; placements are top-left.
    const y = (page.heightIn - pl.yIn - pl.hIn) * PT;

    // pdf-lib has no crop API. Clipping to the box and drawing the image
    // oversized is better than pre-cropping through a canvas: it keeps the
    // original JPEG bytes intact rather than re-encoding.
    const fullW = w / pl.srcRect.w;
    const fullH = h / pl.srcRect.h;
    const drawX = x - pl.srcRect.x * fullW;
    const drawY = y - (1 - pl.srcRect.y - pl.srcRect.h) * fullH;

    pdfPage.pushOperators(
      pushGraphicsState(),
      moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h),
      closePath(), clip(), endPath(),
    );
    pdfPage.drawImage(img, { x: drawX, y: drawY, width: fullW, height: fullH });
    pdfPage.pushOperators(popGraphicsState());
  }

  return doc.save();
}

function blobUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export async function downloadPdf(photos, placements, page, name = 'photo-sheet.pdf') {
  const url = blobUrl(await buildPdf(photos, placements, page));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Print the PDF, never the DOM. Chrome's print path defaults to "fit to
// printable area" and silently rescales the page by a few percent, which would
// make every photo the wrong physical size.
export async function printPdf(photos, placements, page) {
  const url = blobUrl(await buildPdf(photos, placements, page));
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.src = url;
  frame.onload = () => frame.contentWindow.print();
  document.body.appendChild(frame);
}
```

- [ ] **Step 2: Wire it in `src/main.js`**

Add the import:

```js
import { downloadPdf, printPdf } from './export-pdf.js';
```

Add before the final `rerender()`:

```js
document.getElementById('pdf').addEventListener('click', async () => {
  const { placements } = layout(state.photos, state.page);
  await downloadPdf(state.photos, placements, state.page);
});

document.getElementById('print').addEventListener('click', async () => {
  const { placements } = layout(state.photos, state.page);
  await printPdf(state.photos, placements, state.page);
});
```

- [ ] **Step 3: Verify physical sizing with a ruler**

Run: `python -m http.server 8000`, add 4-6 photos, click Export PDF.
Expected:
1. PDF opens at exactly 8.5 × 11 in (check in the viewer's document properties).
2. Photo edges align flush to a 0.25 in margin.
3. **Print it and measure a photo with a ruler.** Its width must match `wIn` from the preview. This is the whole reason the PDF is the print path — verify it rather than assume it.

- [ ] **Step 4: Commit**

```bash
git add src/export-pdf.js src/main.js
git commit -m "Export and print via PDF rather than the DOM

Chrome's DOM print path defaults to fitting the printable area and
rescales by a few percent without saying so, which silently defeats the
point of solving layout in inches. Generating the PDF and printing that
keeps physical sizes exact.

Cropping uses a PDF clipping path with the image drawn oversized, so
original JPEG bytes are embedded untouched instead of being re-encoded
through a canvas."
```

---

### Task 9: PNG export

**Files:**
- Create: `src/export-png.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `layout` output, `state`
- Produces: `downloadPng(photos, placements, page, dpi = 300)`

- [ ] **Step 1: Create `src/export-png.js`**

```js
export async function renderCanvas(photos, placements, page, dpi = 300) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.widthIn * dpi);
  canvas.height = Math.round(page.heightIn * dpi);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const byId = new Map(photos.map((p) => [p.id, p]));

  for (const pl of placements) {
    const photo = byId.get(pl.photoId);
    if (!photo) continue;
    const bitmap = await createImageBitmap(photo.blob, { imageOrientation: 'from-image' });

    // srcRect is normalised, so scale it into source pixels.
    const sx = pl.srcRect.x * bitmap.width;
    const sy = pl.srcRect.y * bitmap.height;
    const sw = pl.srcRect.w * bitmap.width;
    const sh = pl.srcRect.h * bitmap.height;

    ctx.drawImage(
      bitmap, sx, sy, sw, sh,
      pl.xIn * dpi, pl.yIn * dpi, pl.wIn * dpi, pl.hIn * dpi,
    );
    bitmap.close();
  }
  return canvas;
}

export async function downloadPng(photos, placements, page, dpi = 300) {
  const canvas = await renderCanvas(photos, placements, page, dpi);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'photo-sheet.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
```

- [ ] **Step 2: Wire it in `src/main.js`**

Add the import:

```js
import { downloadPng } from './export-png.js';
```

Add before the final `rerender()`:

```js
document.getElementById('png').addEventListener('click', async () => {
  const { placements } = layout(state.photos, state.page);
  await downloadPng(state.photos, placements, state.page);
});
```

- [ ] **Step 3: Verify in the browser**

Run: `python -m http.server 8000`, add photos, click Export PNG.
Expected: a 2550 × 3300 px PNG whose arrangement matches the preview exactly, white background, no transparent gaps.

- [ ] **Step 4: Commit**

```bash
git add src/export-png.js src/main.js
git commit -m "Add 300 DPI PNG export as a third renderer over inch space"
```

---

### Task 10: Drag to reorder, pin, and crop nudge

**Files:**
- Create: `src/interact.js`
- Modify: `src/main.js`
- Modify: `src/preview.js`

**Interfaces:**
- Consumes: `state`, `rerender`, placement boxes carrying `data-photo-id`
- Produces: `attachInteractions(container, state, rerender)`

- [ ] **Step 1: Add hover affordances in `src/preview.js`**

Inside the placement loop in `renderPreview`, immediately after `box.dataset.photoId = pl.photoId;`, add:

```js
    box.draggable = true;
    box.classList.add('cursor-move', 'ring-0', 'hover:ring-2', 'ring-sky-400');
    if (byId.get(pl.photoId)?.pinned) box.classList.add('ring-2', 'ring-amber-400');
```

- [ ] **Step 2: Create `src/interact.js`**

```js
export function attachInteractions(container, state, rerender) {
  let dragId = null;

  container.addEventListener('dragstart', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    dragId = box.dataset.photoId;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set or the drag never starts.
    e.dataTransfer.setData('text/plain', dragId);
  });

  container.addEventListener('dragover', (e) => {
    if (dragId) e.preventDefault();
  });

  container.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const box = e.target.closest('[data-photo-id]');
    if (!box || box.dataset.photoId === dragId) { dragId = null; return; }

    const from = state.photos.findIndex((p) => p.id === dragId);
    const to = state.photos.findIndex((p) => p.id === box.dataset.photoId);
    if (from < 0 || to < 0) { dragId = null; return; }

    const [moved] = state.photos.splice(from, 1);
    state.photos.splice(to, 0, moved);
    dragId = null;
    rerender();
  });

  // Double click pins: the photo takes a row alone, at full content width.
  container.addEventListener('dblclick', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    const photo = state.photos.find((p) => p.id === box.dataset.photoId);
    if (!photo) return;
    photo.pinned = !photo.pinned;
    rerender();
  });

  // Shift+wheel nudges the crop window of a cropped photo.
  container.addEventListener('wheel', (e) => {
    if (!e.shiftKey) return;
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    const photo = state.photos.find((p) => p.id === box.dataset.photoId);
    if (!photo) return;
    e.preventDefault();
    photo.cropOffset = Math.max(-1, Math.min(1, (photo.cropOffset ?? 0) + Math.sign(e.deltaY) * 0.1));
    rerender();
  }, { passive: false });

  // Right click removes.
  container.addEventListener('contextmenu', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    e.preventDefault();
    const i = state.photos.findIndex((p) => p.id === box.dataset.photoId);
    if (i < 0) return;
    URL.revokeObjectURL(state.photos[i].url);
    state.photos.splice(i, 1);
    rerender();
  });
}
```

- [ ] **Step 3: Wire it in `src/main.js`**

Add the import:

```js
import { attachInteractions } from './interact.js';
```

Add before the final `rerender()`:

```js
attachInteractions(sheet, state, rerender);
```

- [ ] **Step 4: Verify each interaction in the browser**

Run: `python -m http.server 8000`, add 6 photos.
Expected, each verified separately:
1. Drag one photo onto another → order changes, layout re-solves, no photo lost.
2. Double click a photo → amber ring, it takes a full-width row alone. Double click again → returns.
3. Shift+scroll over a cropped photo → its visible window slides, never past the source edge.
4. Right click a photo → removed, remaining photos re-pack.

- [ ] **Step 5: Commit**

```bash
git add src/interact.js src/main.js src/preview.js
git commit -m "Add reorder, pin, crop nudge and remove

Reordering mutates photo order and re-solves rather than moving
placements directly, so manual arrangement and automatic packing stay
in one representation instead of two that can disagree."
```

---

### Task 11: Save and reopen sheets

**Files:**
- Create: `src/project.js`
- Modify: `src/main.js`
- Modify: `index.html`

**Interfaces:**
- Consumes: `state`
- Produces: `saveProject(state, name)`, `listProjects()`, `loadProject(name)`

- [ ] **Step 1: Create `src/project.js`**

```js
// Browsers cannot re-read arbitrary local paths on reopen, so photo bytes are
// copied into OPFS at save time and the manifest references them by id.
// Reopening on the same machine then works with no re-picking.
const DIR = 'photo-sheet';

async function root() {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle(DIR, { create: true });
}

async function writeBlob(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

export async function saveProject(state, name) {
  const dir = await root();
  const projDir = await dir.getDirectoryHandle(name, { create: true });

  const manifest = {
    version: 1,
    page: state.page,
    photos: state.photos.map((p) => ({
      id: p.id,
      file: `${p.id}.bin`,
      mime: p.mime,
      naturalW: p.naturalW,
      naturalH: p.naturalH,
      aspect: p.aspect,
      cropOffset: p.cropOffset,
      pinned: p.pinned,
    })),
  };

  for (const p of state.photos) await writeBlob(projDir, `${p.id}.bin`, p.blob);
  await writeBlob(
    projDir,
    'manifest.json',
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  );
}

export async function listProjects() {
  const dir = await root();
  const names = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'directory') names.push(name);
  }
  return names.sort();
}

export async function loadProject(name) {
  const dir = await root();
  const projDir = await dir.getDirectoryHandle(name);
  const mf = await (await projDir.getFileHandle('manifest.json')).getFile();
  const manifest = JSON.parse(await mf.text());

  const photos = [];
  for (const meta of manifest.photos) {
    const file = await (await projDir.getFileHandle(meta.file)).getFile();
    const blob = new Blob([await file.arrayBuffer()], { type: meta.mime });
    photos.push({ ...meta, blob, url: URL.createObjectURL(blob) });
  }
  return { page: manifest.page, photos };
}
```

- [ ] **Step 2: Add controls to `index.html`**

Insert immediately before the closing `</aside>`:

```html
      <div class="space-y-2 pt-2 border-t border-slate-700">
        <input id="projName" placeholder="Sheet name" class="w-full rounded bg-slate-700 px-2 py-1 text-sm">
        <button id="save" class="w-full rounded bg-slate-600 hover:bg-slate-500 px-3 py-2 text-sm">Save sheet</button>
        <select id="projList" class="w-full rounded bg-slate-700 px-2 py-1 text-sm"></select>
        <button id="load" class="w-full rounded bg-slate-600 hover:bg-slate-500 px-3 py-2 text-sm">Open sheet</button>
      </div>
```

- [ ] **Step 3: Wire it in `src/main.js`**

Add the import:

```js
import { saveProject, listProjects, loadProject } from './project.js';
```

Add before the final `rerender()`:

```js
const projList = document.getElementById('projList');

async function refreshProjects() {
  const names = await listProjects();
  projList.replaceChildren(
    ...names.map((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      return o;
    }),
  );
}

document.getElementById('save').addEventListener('click', async () => {
  const name = document.getElementById('projName').value.trim();
  if (!name) return alert('Name the sheet first.');
  await saveProject(state, name);
  await refreshProjects();
});

document.getElementById('load').addEventListener('click', async () => {
  if (!projList.value) return;
  const loaded = await loadProject(projList.value);
  state.photos.forEach((p) => URL.revokeObjectURL(p.url));
  state.photos = loaded.photos;
  state.page = loaded.page;
  rerender();
});

refreshProjects();
```

- [ ] **Step 4: Verify persistence across a full browser restart**

Run: `python -m http.server 8000`, add photos, name the sheet, click Save sheet.
Expected:
1. The name appears in the dropdown.
2. **Close the browser entirely, reopen, load the sheet** — photos, order, pins, crop offsets and page settings all return.

- [ ] **Step 5: Commit**

```bash
git add src/project.js src/main.js index.html
git commit -m "Persist sheets to OPFS

Photo bytes are copied into OPFS rather than referenced by path, because
a browser cannot re-read a local path on reopen. Copying costs disk but
makes reopening work with no re-picking, which is the actual use case."
```

---

### Task 12: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# Photo Sheet

Packs photos of mixed aspect ratios onto one printable sheet with minimal blank
space, re-solving automatically as photos are added or removed.

## Running

No build step. Serve the directory and open it:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

## Tests

```bash
npm test
```

Covers `src/layout.js`, which holds all the geometry.

## Usage

| Action | How |
|---|---|
| Add photos | "Add photos…", Ctrl+V, or drag files onto the window |
| Reorder | Drag one photo onto another |
| Pin (own row, full width) | Double click |
| Nudge crop window | Shift + scroll |
| Remove | Right click |

Sliders control crop tolerance, gutter and the minimum photo size that triggers
the density warning.

## How the layout works

1. **Row height is solved, not searched.** Photos in a row share a height, and
   spanning the content width exactly determines it.
2. **Break points come from a dynamic program** minimising squared deviation
   from a target height. Greedy filling strands one photo alone on the last row;
   costing every split cannot.
3. **Target height is binary-searched** so the sheet fills vertically. Web
   galleries treat it as a constant because they scroll forever; a sheet has a
   hard bottom edge.
4. **Leftover height becomes a uniform crop** — distributing it in proportion to
   row height makes the crop fraction identical everywhere. Whatever exceeds the
   tolerance is spread across all gaps rather than pooling at the bottom.

Placements are emitted in inches. The preview scales by 96, PNG by 300, PDF by
72 — three renderers over one coordinate system, so preview and print cannot
drift.

## Known limitations

- **Mixed portrait and landscape.** Within a row all photos share a height, so a
  16:9 gets about 2.6× the area of a 2:3 portrait beside it. The fix is column
  grouping (stacking two landscapes into a portrait-shaped block); deferred
  until it proves necessary in practice.
- **HEIC is rejected**, since Chrome cannot decode it. Convert to JPEG first.
- **Single sheet only.** Overflow raises a density warning rather than paginating.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Document the layout algorithm and its known limitations"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Free scaling to fill the sheet | 1–3 |
| Crop tolerance, default 6% | 4, 5 |
| Uniform crop across rows | 4 |
| Horizontal-only crop | 5 |
| Pinned photo takes a row alone | 2, 5 |
| Density warning at 1.5 in floor | 5 |
| Single sheet, no pagination | 5 |
| Live preview | 6 |
| File picker / paste / drag-drop | 7 |
| EXIF orientation | 7 |
| HEIC detection | 7 |
| PDF export | 8 |
| Direct print via PDF | 8 |
| PNG at 300 DPI | 9 |
| Drag reorder, pin, crop nudge | 10 |
| Save and reopen | 11 |
| `layout.js` unit tested | 1–5 |

No gaps.

**Type consistency:** `Photo` carries `{ id, blob, url, mime, naturalW, naturalH, aspect, cropOffset, pinned }` in tasks 6, 7, 9, 10 and 11. `Placement` carries `{ photoId, xIn, yIn, wIn, hIn, srcRect }` in tasks 5, 6, 8 and 9. `srcRect` is `{ x, y, w, h }` normalised 0..1 throughout. `layout()` returns `{ placements, warnings }` at every call site.

**Deferred, by design:** column grouping for mixed orientation, HEIC decoding, multi-page flow, portable export bundles.
