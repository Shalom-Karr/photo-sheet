# Manual Resize and GitHub Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the app to GitHub Pages, then let the user drag one photo to a chosen size and have the rest of the sheet re-solve around it.

**Architecture:** Pages needs no code change — the app is already static ES modules with relative paths. Resize adds `targetHeightIn` to a photo; the anchored row alone is assembled by free subset selection (companions chosen from any photos to best fill the width at that exact height), while every other photo keeps its relative order and packs through the existing windowed fill-maximising DP untouched.

**Tech Stack:** Vanilla ES modules (no build step), Tailwind via CDN, vendored `pdf-lib`, `node --test`, GitHub Actions Pages deployment.

## Global Constraints

- No build step. The browser loads `.js` files as native ES modules directly. No bundler, transpiler, framework, or npm dependencies.
- `src/layout.js` must remain **pure**: no DOM, no imports, no I/O. Importable unchanged in both Node and the browser.
- All geometry in `src/layout.js` is in **inches**. Conversion happens only in renderers (preview ×96, PNG ×300, PDF ×72).
- Tests run with `npm test` = `node --test` with **no path argument** (a path argument fails `MODULE_NOT_FOUND` on Node 22 for Windows). Baseline is 30 passing tests.
- Crop is horizontal only — `srcRect.y` is always 0, `srcRect.h` always 1.
- Single sheet only. Overflow raises a density warning; never paginates.
- Page defaults: 8.5 × 11 in, margin 0.25 in, gutter 0.08 in, crop tolerance 0.06, minimum photo dimension 1.5 in, row-height ratio cap 3.
- **One anchor at a time.** Anchoring a photo clears any other anchor and clears `pinned` on that photo; pinning clears its anchor.
- With no anchor set, engine output must be **identical** to current behaviour. This is the regression guard that the change is additive.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `.github/workflows/deploy.yml` | Create | Publish the repo to Pages on push to `main` |
| `.nojekyll` | Create | Stop Jekyll ignoring `_`-prefixed paths and skip pointless build time |
| `src/layout.js` | Modify | `targetHeightIn` support: clamping, free-subset anchored row, placement |
| `src/photos.js` | Modify | Initialise `targetHeightIn: null` |
| `src/project.js` | Modify | Round-trip `targetHeightIn` |
| `src/preview.js` | Modify | Render a resize handle on each photo box |
| `src/interact.js` | Modify | Handle drag to resize, double-click handle to release |
| `README.md` | Modify | Document the gesture and the deployed URL |

---

### Task 1: Deploy to GitHub Pages

**Files:**
- Create: `.nojekyll`
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a live public URL

- [ ] **Step 1: Create `.nojekyll`**

An empty file at the repo root:

```bash
touch .nojekyll
```

Jekyll ignores paths beginning with `_`. The repo has none today, but adding one later must not silently break the deploy. It also skips a pointless build stage.

- [ ] **Step 2: Create `.github/workflows/deploy.yml`**

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

# Let a newer push supersede an in-flight deploy rather than racing it.
concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4

      # No build step: the app is static ES modules with relative imports.
      # The whole repo is uploaded because vendor/ is required at runtime.
      - uses: actions/configure-pages@v5

      - uses: actions/upload-pages-artifact@v3
        with:
          path: .

      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 3: Make the repo public and enable Pages**

The tree was scanned for credentials, `.env`/`.pem`/`.key` files and absolute personal paths before this step; nothing was found.

```bash
export GH_TOKEN=$(gh auth token)
gh repo edit Shalom-Karr/photo-sheet --visibility public --accept-visibility-change-consequences
gh api --method POST repos/Shalom-Karr/photo-sheet/pages -f 'build_type=workflow' || \
  gh api --method PUT repos/Shalom-Karr/photo-sheet/pages -f 'build_type=workflow'
```

The `||` fallback covers the case where Pages is already configured — `POST` returns 409 then, and `PUT` updates instead.

- [ ] **Step 4: Commit and push, then watch the run**

```bash
git add .nojekyll .github/workflows/deploy.yml
git commit -m "Deploy to GitHub Pages

The app is already static ES modules with relative imports and a vendored
pdf-lib, so no build step is needed. Serving over HTTPS also removes the
project's sharpest usability edge: opening index.html as a file:// URL
fails silently because Chrome blocks ES modules across file://."
```

Push, then:

```bash
gh run list --limit 3
gh run watch $(gh run list --limit 1 --json databaseId --jq '.[0].databaseId')
```

- [ ] **Step 5: Verify the deployed site actually works**

A green workflow run is not evidence the app works. Fetch the live URL and confirm:

```bash
URL=$(gh api repos/Shalom-Karr/photo-sheet/pages --jq '.html_url')
echo "$URL"
curl -sS -o /dev/null -w 'index %{http_code}\n' "$URL"
curl -sS -o /dev/null -w 'layout.js %{http_code}\n' "${URL}src/layout.js"
curl -sS -o /dev/null -w 'pdf-lib %{http_code}\n' "${URL}vendor/pdf-lib.esm.js"
```

All three must be `200`. A 404 on `vendor/pdf-lib.esm.js` means the artifact upload excluded it and PDF export is broken in production.

Note: `curl` may fail on this machine due to the local TLS filter. If it does, use Node instead — `fetch` works there:

```bash
node -e "for (const p of ['','src/layout.js','vendor/pdf-lib.esm.js']) fetch(process.argv[1]+p).then(r=>console.log(r.status,p||'index'))" "$URL"
```

- [ ] **Step 6: Add the URL to `README.md`**

Immediately under the `# Photo Sheet` heading, insert a line with the real URL substituted:

```markdown
**Live:** <https://shalom-karr.github.io/photo-sheet/>
```

Then update the Running section so the local server is presented as the alternative rather than the only way, keeping the existing `file://` warning intact.

- [ ] **Step 7: Commit**

```bash
git add README.md
git commit -m "Link the deployed site from the README"
```

---

### Task 2: Anchored sizing in the layout engine

**Files:**
- Modify: `src/layout.js`
- Test: `tests/layout.test.js`

**Interfaces:**
- Consumes: `LETTER`, `rowHeight(aspects, contentW, gutterIn)`, `solveRows(aspects, contentW, contentH, gutterIn, opts)`, `absorbResidual(heights, gutterIn, contentH, cropTolerance)`, `layout(photos, page)`
- Produces: `layout` honouring `photo.targetHeightIn`; new helper `clampTarget(target, aspect, contentW, contentH, minPhotoIn) → number`; new helper `anchoredRow(aspects, anchorIdx, target, contentW, gutterIn, maxK = 5) → { indices, widthIn }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/layout.test.js`:

```js
import { clampTarget, anchoredRow } from '../src/layout.js';

test('clampTarget keeps a photo inside the page', () => {
  const CW = 8, CH = 10.5;
  // A 1.5-aspect photo at 6in tall would be 9in wide — wider than the page.
  assert.ok(clampTarget(6, 1.5, CW, CH, 1.5) * 1.5 <= CW + 1e-9);
  // Below the floor clamps up.
  assert.equal(clampTarget(0.2, 1.5, CW, CH, 1.5), 1.5);
  // A value already legal passes through.
  assert.equal(clampTarget(3, 1.5, CW, CH, 1.5), 3);
  // Never taller than the page.
  assert.ok(clampTarget(99, 0.5, CW, CH, 1.5) <= CH + 1e-9);
});

test('anchoredRow always includes the anchor and never overflows the width', () => {
  const aspects = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1, 1.78];
  for (let i = 0; i < aspects.length; i++) {
    for (const t of [1.5, 2, 2.5, 3]) {
      const r = anchoredRow(aspects, i, t, 8, 0.08);
      assert.ok(r.indices.includes(i), `anchor ${i} missing at t=${t}`);
      assert.equal(new Set(r.indices).size, r.indices.length, 'no duplicates');
      assert.ok(r.widthIn <= 8 + 1e-9, `width ${r.widthIn} overflows at t=${t}`);
    }
  }
});

test('anchoredRow fills the width well at moderate targets', () => {
  // Measured: free grouping holds the side gap under an inch through 3in.
  const aspects = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1, 1.78];
  for (const t of [1.5, 2, 2.5]) {
    const r = anchoredRow(aspects, 0, t, 8, 0.08);
    assert.ok(8 - r.widthIn < 1.0, `gap ${(8 - r.widthIn).toFixed(2)}in at t=${t}`);
  }
});

test('an anchored photo is placed at its target height', () => {
  const photos = [1.5, 1.78, 1, 0.67, 1.33, 1.5].map((a, i) => ({ id: `p${i}`, aspect: a }));
  photos[2].targetHeightIn = 2.5;
  const { placements } = layout(photos, LETTER);
  const p = placements.find((x) => x.photoId === 'p2');
  assert.ok(Math.abs(p.hIn - 2.5) < 1e-6, `height ${p.hIn}, expected 2.5`);
});

test('anchoring places every photo exactly once and stays on the page', () => {
  const photos = [1.5, 1.78, 1, 0.67, 1.33, 1.5, 1, 1.78].map((a, i) => ({ id: `p${i}`, aspect: a }));
  photos[5].targetHeightIn = 3;
  const { placements } = layout(photos, LETTER);
  assert.equal(placements.length, photos.length);
  assert.equal(new Set(placements.map((p) => p.photoId)).size, photos.length);
  for (const p of placements) {
    assert.ok(p.xIn >= LETTER.marginIn - 1e-6);
    assert.ok(p.yIn >= LETTER.marginIn - 1e-6);
    assert.ok(p.xIn + p.wIn <= LETTER.widthIn - LETTER.marginIn + 1e-6);
    assert.ok(p.yIn + p.hIn <= LETTER.heightIn - LETTER.marginIn + 1e-6);
  }
});

test('an over-large target is clamped rather than overflowing', () => {
  const photos = [1.5, 1.78, 1].map((a, i) => ({ id: `p${i}`, aspect: a }));
  photos[0].targetHeightIn = 99;
  const { placements } = layout(photos, LETTER);
  for (const p of placements) {
    assert.ok(p.xIn + p.wIn <= LETTER.widthIn - LETTER.marginIn + 1e-6);
    assert.ok(p.yIn + p.hIn <= LETTER.heightIn - LETTER.marginIn + 1e-6);
  }
});

test('no anchor means output is unchanged', () => {
  // The regression guard: this change must be purely additive.
  const mk = () => [1, 1.33, 1.5, 1.78, 1, 1.33, 1.5, 1.78, 1, 1.33, 1.5, 1.78]
    .map((a, i) => ({ id: `p${i}`, aspect: a }));
  const withField = mk().map((p) => ({ ...p, targetHeightIn: null }));
  assert.deepEqual(layout(withField, LETTER), layout(mk(), LETTER));
});

test('clearing an anchor restores the original layout', () => {
  const mk = () => [1.5, 1.78, 1, 0.67, 1.33, 1.5].map((a, i) => ({ id: `p${i}`, aspect: a }));
  const before = layout(mk(), LETTER);
  const anchored = mk();
  anchored[1].targetHeightIn = 2.5;
  layout(anchored, LETTER);
  const cleared = mk();
  cleared[1].targetHeightIn = null;
  assert.deepEqual(layout(cleared, LETTER), before);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `clampTarget` is not exported.

- [ ] **Step 3: Add the two helpers**

Append to `src/layout.js`:

```js
// A photo's size is its row's height, and a row cannot be wider than the page.
// So a target is bounded above by both the width limit and the page height.
export function clampTarget(target, aspect, contentW, contentH, minPhotoIn) {
  const widthLimit = contentW / aspect;
  const hi = Math.min(widthLimit, contentH);
  return Math.min(Math.max(target, Math.min(minPhotoIn, hi)), hi);
}

// Choose companions for the anchored row from ANY photos, maximising width
// without exceeding contentW at the exact target height.
//
// Contiguous rows cannot do this. For the first photo of a twelve-photo sheet
// the only achievable contiguous heights are 1.16, 1.38, 2.05, 3.40 and 8.00in
// — dragging toward 5in would snap by 4.6in. Allowing an exact height with
// contiguous companions instead leaves side gaps up to 4.8in on an 8in width.
// Free selection holds the gap under an inch through 3in targets.
export function anchoredRow(aspects, anchorIdx, target, contentW, gutterIn, maxK = 5) {
  const others = [];
  for (let i = 0; i < aspects.length; i++) if (i !== anchorIdx) others.push(i);

  const widthOf = (idxs) =>
    target * idxs.reduce((s, i) => s + aspects[i], 0) + (idxs.length - 1) * gutterIn;

  let best = { indices: [anchorIdx], widthIn: widthOf([anchorIdx]) };
  if (best.widthIn > contentW + 1e-9) return best; // caller clamps; keep it total

  const chosen = [];
  const walk = (start, sum) => {
    const idxs = [anchorIdx, ...chosen];
    const w = target * (sum + aspects[anchorIdx]) + (idxs.length - 1) * gutterIn;
    if (w <= contentW + 1e-9 && w > best.widthIn) best = { indices: idxs, widthIn: w };
    if (idxs.length >= maxK) return;
    for (let j = start; j < others.length; j++) {
      const next = sum + aspects[others[j]];
      // Prune: adding this photo already overflows, and every later one is
      // only additive, so no deeper branch from here can fit either.
      if (target * (next + aspects[anchorIdx]) + idxs.length * gutterIn > contentW + 1e-9) continue;
      chosen.push(others[j]);
      walk(j + 1, next);
      chosen.pop();
    }
  };
  walk(0, 0);

  // Keep the row in the user's photo order so it reads predictably.
  best.indices.sort((a, b) => a - b);
  return best;
}
```

- [ ] **Step 4: Wire anchoring into `layout()`**

In `src/layout.js`, inside `layout(photos, page)`, immediately after `contentW`/`contentH` are computed and before the existing `solveRows` call, insert:

```js
  // At most one anchor is honoured; the first wins.
  const anchorIdx = photos.findIndex(
    (p) => typeof p.targetHeightIn === 'number' && p.targetHeightIn > 0,
  );

  if (anchorIdx >= 0) {
    return layoutAnchored(photos, page, contentW, contentH, anchorIdx);
  }
```

Then append this function to the file:

```js
// Anchored layout: pull the anchored row out, solve the remaining photos with
// the ordinary engine, then insert the anchored row at whichever row boundary
// packs the page best. Choosing the position is also what stops a large row
// from always landing at the top.
function layoutAnchored(photos, page, contentW, contentH, anchorIdx) {
  const aspects = photos.map((p) => p.aspect);
  const target = clampTarget(
    photos[anchorIdx].targetHeightIn,
    aspects[anchorIdx],
    contentW,
    contentH,
    page.minPhotoIn,
  );

  const row = anchoredRow(aspects, anchorIdx, target, contentW, page.gutterIn);
  const inRow = new Set(row.indices);

  // Everything else keeps its relative order.
  const restIdx = [];
  for (let i = 0; i < photos.length; i++) if (!inRow.has(i)) restIdx.push(i);
  const restAspects = restIdx.map((i) => aspects[i]);
  const restPinned = restIdx.map((i) => !!photos[i].pinned);

  const budget = contentH - target - (restIdx.length ? page.gutterIn : 0);
  const solved = restIdx.length
    ? solveRows(restAspects, contentW, Math.max(0.01, budget), page.gutterIn, {
        pinned: restPinned,
        ratioCap: page.ratioCap,
      })
    : { rows: [], heights: [] };

  // Try the anchored row at every boundary; keep the fullest page.
  const nRows = solved.rows.length;
  let bestPos = 0;
  let bestFill = -1;
  for (let pos = 0; pos <= nRows; pos++) {
    const fill = solved.heights.reduce((a, b) => a + b, 0) + target;
    // Fill is position-independent, so prefer a middle placement for variety
    // while still preferring any position that fits.
    const score = fill - Math.abs(pos - nRows / 2) * 1e-6;
    if (score > bestFill) { bestFill = score; bestPos = pos; }
  }

  // Assemble the final row list in vertical order.
  const rowsOut = [];
  for (let r = 0; r < nRows; r++) {
    if (r === bestPos) rowsOut.push({ anchored: true });
    const [s, e] = solved.rows[r];
    rowsOut.push({ anchored: false, idx: restIdx.slice(s, e), h: solved.heights[r] });
  }
  if (bestPos >= nRows) rowsOut.push({ anchored: true });

  const heights = rowsOut.map((r) => (r.anchored ? target : r.h));
  const abs = absorbResidual(heights, page.gutterIn, contentH, page.cropTolerance);
  // The anchored row keeps its exact requested height; only ordinary rows absorb.
  const finalH = rowsOut.map((r, i) => (r.anchored ? target : abs.heights[i]));

  const placements = [];
  let y = page.marginIn + abs.extraGutter;
  rowsOut.forEach((r, ri) => {
    const idxs = r.anchored ? row.indices : r.idx;
    const baseH = r.anchored ? target : heights[ri];
    const boxH = finalH[ri];
    const rowW =
      idxs.reduce((s, i) => s + aspects[i] * baseH, 0) + (idxs.length - 1) * page.gutterIn;
    let x = page.marginIn + (contentW - rowW) / 2;

    for (const i of idxs) {
      const wIn = aspects[i] * baseH;
      const visW = r.anchored ? 1 : 1 - abs.cropFraction;
      const slack = 1 - visW;
      const offset = Math.max(-1, Math.min(1, photos[i].cropOffset ?? 0));
      const sx = Math.max(0, Math.min(slack, slack / 2 + (offset * slack) / 2));
      placements.push({
        photoId: photos[i].id,
        xIn: x,
        yIn: y,
        wIn,
        hIn: boxH,
        srcRect: { x: sx, y: 0, w: visW, h: 1 },
      });
      x += wIn + page.gutterIn;
    }
    y += boxH + page.gutterIn + abs.extraGutter;
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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. 30 existing plus 8 new = 38.

If `no anchor means output is unchanged` fails, the anchored branch is being entered when it should not be — check the `findIndex` guard rejects `null`, `undefined` and `0`.

- [ ] **Step 6: Commit**

```bash
git add src/layout.js tests/layout.test.js
git commit -m "Let one photo be sized directly, repacking the rest around it

A photo's size is its row's height, and rows are built from contiguous
runs of the photo array — which makes exact sizing impossible. For the
first photo of a twelve-photo sheet the only achievable heights are 1.16,
1.38, 2.05, 3.40 and 8.00in, so dragging toward 5in snaps by 4.6in.
Allowing an exact height with contiguous companions instead leaves side
gaps up to 4.8in on an 8in width.

So the anchored row alone draws companions from any photos, which holds
the gap under an inch through 3in targets. Every other photo keeps its
relative order and packs through the existing solver untouched."
```

---

### Task 3: Persist and initialise the anchor

**Files:**
- Modify: `src/photos.js`
- Modify: `src/project.js`

**Interfaces:**
- Consumes: the `Photo` shape
- Produces: `Photo` carrying `targetHeightIn`, round-tripped through save and reopen

- [ ] **Step 1: Initialise the field at ingest**

In `src/photos.js`, where the `Photo` object is built (alongside `cropOffset: 0, pinned: false`), add:

```js
        targetHeightIn: null,
```

- [ ] **Step 2: Persist it**

In `src/project.js`, in the manifest `photos.map(...)`, add `targetHeightIn` alongside `cropOffset` and `pinned`:

```js
      targetHeightIn: p.targetHeightIn ?? null,
```

In `loadProject`, the restore already spreads `meta`, so include a default for manifests written before this field existed. Where the loaded photo object is assembled, ensure the default comes **before** the spread so a saved value wins:

```js
    photos.push({ targetHeightIn: null, ...photoMeta, blob, url: URL.createObjectURL(blob) });
```

- [ ] **Step 3: Verify the round trip in a real browser**

Serve with `python -m http.server 8000`. Using Playwright (`mcp__plugin_playwright_playwright__*` — the Chrome extension is blocked from localhost on this machine, Playwright is not), import `/src/main.js`, push several canvas-generated photos into `state.photos`, set `state.photos[1].targetHeightIn = 2.5`, `rerender()`, save under a name, **reload the page**, load the sheet, and assert `state.photos[1].targetHeightIn === 2.5`.

Report the asserted value. Stop the server when done.

- [ ] **Step 4: Run tests and commit**

```bash
npm test
git add src/photos.js src/project.js
git commit -m "Round-trip the anchored size through saved sheets

Without this, reopening a sheet silently drops the sizing the user set
by hand, which is worse than not saving it at all."
```

---

### Task 4: The resize handle — SUPERSEDED

> **Replaced by Task 4A in Amendment 1 at the end of this plan.** The user asked
> for edge handles, not just a corner. Build from the amendment.

**Files:**
- Modify: `src/preview.js`
- Modify: `src/interact.js`

**Interfaces:**
- Consumes: `state`, `rerender`, placement boxes carrying `data-photo-id`
- Produces: pointer-drag resizing and double-click release

- [ ] **Step 1: Render the handle**

In `src/preview.js`, inside the placement loop after the box's classes are set, append a handle child:

```js
    const handle = document.createElement('div');
    handle.dataset.resize = pl.photoId;
    handle.className =
      'absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize bg-sky-400/80 ' +
      'opacity-0 hover:opacity-100 group-hover:opacity-100';
    box.classList.add('group');
    if (byId.get(pl.photoId)?.targetHeightIn) handle.classList.add('opacity-100', 'bg-emerald-400');
    box.appendChild(handle);
```

The handle is emerald and permanently visible when that photo is anchored, so the sizing is discoverable rather than invisible state.

- [ ] **Step 2: Handle the drag**

In `src/interact.js`, inside `attachInteractions`, add:

```js
  // Dragging the corner handle sets an explicit height for one photo.
  // Pointer events are used rather than HTML5 drag-and-drop so this cannot be
  // confused with the reorder drag or the file-ingest drop.
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();

    const id = handle.dataset.resize;
    const photo = state.photos.find((p) => p.id === id);
    if (!photo) return;

    const box = handle.closest('[data-photo-id]');
    const startY = e.clientY;
    const startPx = box.getBoundingClientRect().height;
    // Convert screen pixels back to inches using the live preview scale.
    const pxPerIn = startPx / (startPx / (96 * currentScale()));

    // One anchor at a time, and anchoring is not pinning.
    for (const p of state.photos) if (p !== photo) p.targetHeightIn = null;
    photo.pinned = false;

    const move = (ev) => {
      const dIn = (ev.clientY - startY) / pxPerIn;
      photo.targetHeightIn = Math.max(0.25, startPx / pxPerIn + dIn);
      rerender();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Double-clicking the handle releases the anchor. stopPropagation is
  // required: the box's own dblclick toggles pinning, and without this the
  // release would also pin the photo.
  container.addEventListener('dblclick', (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const photo = state.photos.find((p) => p.id === handle.dataset.resize);
    if (!photo) return;
    photo.targetHeightIn = null;
    rerender();
  }, true);
```

The release listener is registered with `capture: true` so it runs before the existing box-level `dblclick` pin handler.

`currentScale()` must be supplied by `src/main.js`. Change `attachInteractions(sheet, state, rerender)` to `attachInteractions(sheet, state, rerender, currentScale)` and pass a function returning the scale factor `rerender()` last used. Store it in a module-level variable in `main.js` when computing the scale.

- [ ] **Step 3: Verify every gesture in a real browser**

Serve and drive with Playwright. Verify and report each:

1. Dragging a handle downward increases that photo's `targetHeightIn` and its placement `hIn` follows.
2. The other photos re-solve — placement count unchanged, every id still present exactly once.
3. No placement leaves the printable area during or after the drag.
4. Double-clicking the handle sets `targetHeightIn` back to `null` and **does not** pin the photo (`pinned` stays `false`).
5. Dragging a handle does not start a reorder drag and does not trigger file ingest — photo count unchanged.
6. Anchoring a second photo clears the first.

- [ ] **Step 4: Commit**

```bash
git add src/preview.js src/interact.js src/main.js
git commit -m "Add a corner handle to size one photo by hand

Pointer events rather than HTML5 drag-and-drop, so resizing cannot be
mistaken for the reorder drag or the file-ingest drop. The release is a
double-click on the handle with capture and stopPropagation, because the
box's own double-click already toggles pinning."
```

---

### Task 5: Document the gesture

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add the gesture to the usage table**

Insert after the "Pin" row:

```markdown
| Resize one photo | Drag its bottom-right corner. The rest re-solve around it |
| Release a resize | Double click the same corner handle |
```

- [ ] **Step 2: Explain the tradeoff**

Add after the "Page fill depends on photo count" section:

```markdown
### Resizing one photo

Dragging a photo's corner sets its exact height. Because every photo in a row
shares one height, the resized photo's row is assembled from whichever photos
best fill the width at that size — drawn from anywhere on the sheet, not just
its neighbours. Everything else keeps its order.

The row has to come from anywhere because contiguous neighbours cannot deliver
an exact size. For the first photo of a twelve-photo sheet the only achievable
heights from contiguous runs are 1.16, 1.38, 2.05, 3.40 and 8.00 inches, so
dragging toward 5 would snap by 4.6. Free grouping holds the leftover gap under
an inch for targets up to 3 inches.

Above about 3 inches a photo is close to full width and ends up alone on its
row, so there will be white space beside it. That is what asking for a big
photo means.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document resizing and why its row is drawn from anywhere"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Repo public, Pages enabled | 1 |
| `.nojekyll` | 1 |
| `deploy.yml` with correct permissions and concurrency | 1 |
| Verify deployed site, not just a green run | 1 |
| `targetHeightIn` on a photo | 2, 3 |
| Clamp to `[minPhotoIn, contentW/aspect]` and `contentH` | 2 |
| Free-subset companions, anchored row only, cap 5 | 2 |
| Other photos keep relative order | 2 |
| Anchored row centred when not flush | 2 |
| Vertical position chosen rather than fixed | 2 |
| One anchor at a time; anchor and pin mutually exclusive | 2, 4 |
| Ratio cap not applied to the anchored row | 2 (anchored row bypasses `solveRows`) |
| Round-trip through save/reopen | 3 |
| Resize handle and release gesture | 4 |
| No-anchor output identical to current | 2 |
| Documentation | 1, 5 |

No gaps. The spec's "row order was never biased big-at-top" section requires no task by design — it is a recorded finding.

**Type consistency:** `targetHeightIn` is the field name in tasks 2, 3 and 4. `clampTarget(target, aspect, contentW, contentH, minPhotoIn)` and `anchoredRow(aspects, anchorIdx, target, contentW, gutterIn, maxK)` are used with those signatures in task 2 only. `attachInteractions` gains a fourth parameter `currentScale` in task 4, which is the only call-site change.

**Known risk to watch in review:** `layoutAnchored` duplicates the placement-assembly loop from `layout()`. That duplication is deliberate for a first cut — the anchored row differs in crop handling and height source — but if the review judges the two loops close enough to share, extracting a common emitter is the right call.

---

## Amendment 1 — Task 4 replaced: edge handles, not just a corner

**Why.** The user asked for edge handles: hover an edge, a line appears, drag it to make the photo wider or narrower, with the layout reflowing rather than cropping.

**This needs no engine change at all.** For an uncropped photo, width and height are locked together by aspect ratio, so a width target is exactly a height target: `targetHeightIn = width / aspect`. Verified — a 4.0000 in width request on a 1:1 photo produces a placement measuring `wIn = 4.0000`.

The "push the neighbour to another row" behaviour also arrives free. Measured, dragging photo 0 of `[1.5, 1.78, 1, 0.67, 1.33, 1.5]` wider:

| target width | photos in its row | rowmates | actual `wIn` |
|---|---|---|---|
| 2.5 in | 3 | p0, p1, p4 | 2.500 |
| 3.5 in | 2 | p0, p1 | 3.500 |
| 5.0 in | 2 | p0, p3 | 5.000 |
| 6.0 in | 1 | p0 | 6.000 |
| 8.0 in | 1 | p0 | 8.000 |

The row sheds companions as the anchor grows, with no cropping. So this task is purely an interaction change over Task 2's anchor.

### Task 4A: Edge and corner resize handles

**Files:**
- Modify: `src/preview.js`
- Modify: `src/interact.js`
- Modify: `src/main.js`

**Interfaces:**
- Consumes: `state`, `rerender`, placement boxes carrying `data-photo-id`, and `photo.targetHeightIn` honoured by `layout()`
- Produces: `attachInteractions(container, state, rerender, currentScale)` — a fourth parameter, a function returning the preview's live scale factor

- [ ] **Step 1: Render five handles per photo**

In `src/preview.js`, inside the placement loop after the box's classes are set, add the handles. `box` must get `relative` positioning context — it is already `absolute`, which is sufficient.

```js
    // Five handles, all setting one anchor: width and height are locked
    // together by aspect ratio, so an edge drag and a corner drag are the
    // same constraint expressed on different axes.
    const anchored = !!byId.get(pl.photoId)?.targetHeightIn;
    for (const [edge, cls] of [
      ['left',   'left-0 top-0 h-full w-1 cursor-ew-resize'],
      ['right',  'right-0 top-0 h-full w-1 cursor-ew-resize'],
      ['top',    'top-0 left-0 w-full h-1 cursor-ns-resize'],
      ['bottom', 'bottom-0 left-0 w-full h-1 cursor-ns-resize'],
      ['corner', 'bottom-0 right-0 w-3 h-3 cursor-nwse-resize'],
    ]) {
      const h = document.createElement('div');
      h.dataset.resize = pl.photoId;
      h.dataset.edge = edge;
      h.className =
        `absolute ${cls} transition-opacity ` +
        (anchored ? 'bg-emerald-400 opacity-90' : 'bg-sky-400 opacity-0 hover:opacity-90');
      box.appendChild(h);
    }
```

An anchored photo keeps its handles visible in emerald, so the state is discoverable rather than hidden.

- [ ] **Step 2: Handle the drag**

In `src/interact.js`, inside `attachInteractions(container, state, rerender, currentScale)`:

```js
  // Pointer events, not HTML5 drag-and-drop, so a resize can never be
  // confused with the reorder drag or the file-ingest drop.
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();

    const photo = state.photos.find((p) => p.id === handle.dataset.resize);
    if (!photo) return;
    const edge = handle.dataset.edge;
    const box = handle.closest('[data-photo-id]');
    const rect = box.getBoundingClientRect();

    // One anchor at a time, and anchoring is not pinning.
    for (const p of state.photos) if (p !== photo) p.targetHeightIn = null;
    photo.pinned = false;

    const startX = e.clientX;
    const startY = e.clientY;
    const pxPerIn = 96 * currentScale();
    const startW = rect.width / pxPerIn;
    const startH = rect.height / pxPerIn;

    let queued = false;
    let pending = null;

    // Re-solving costs 0.63ms at 12 photos but 8.52ms at 30, dominated by the
    // solver's window sweep. Coalescing into one frame keeps the drag smooth.
    const flush = () => {
      queued = false;
      if (pending == null) return;
      photo.targetHeightIn = pending;
      rerender();
    };

    const move = (ev) => {
      const dxIn = (ev.clientX - startX) / pxPerIn;
      const dyIn = (ev.clientY - startY) / pxPerIn;

      let targetH;
      if (edge === 'left' || edge === 'right') {
        const w = edge === 'right' ? startW + dxIn : startW - dxIn;
        targetH = w / photo.aspect;
      } else if (edge === 'top' || edge === 'bottom') {
        targetH = edge === 'bottom' ? startH + dyIn : startH - dyIn;
      } else {
        // Corner: follow whichever axis the pointer moved further along.
        targetH = Math.abs(dxIn) > Math.abs(dyIn)
          ? (startW + dxIn) / photo.aspect
          : startH + dyIn;
      }

      pending = Math.max(0.1, targetH);
      if (!queued) { queued = true; requestAnimationFrame(flush); }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      flush();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Double-clicking any handle releases the anchor. Capture and
  // stopPropagation are both required: the box's own dblclick toggles
  // pinning, so without them the release would also pin the photo.
  container.addEventListener('dblclick', (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const photo = state.photos.find((p) => p.id === handle.dataset.resize);
    if (!photo) return;
    photo.targetHeightIn = null;
    rerender();
  }, true);
```

`pending` is clamped only to a floor of 0.1 in here; `layout()`'s `clampTarget` applies the real bounds, so the engine stays the single authority on what is legal.

- [ ] **Step 3: Expose the preview scale from `main.js`**

`src/main.js` computes a fit-to-viewport scale inside `rerender()`. Store it and pass a getter:

```js
let previewScale = 1;
```

Inside `rerender()`, where the scale is computed, assign `previewScale = scale;` before calling `renderPreview`.

Then change the interactions call to:

```js
attachInteractions(sheet, state, rerender, () => previewScale);
```

- [ ] **Step 4: Verify every gesture in a real browser**

Playwright works on this machine; the Chrome extension is blocked from localhost. Serve with `python -m http.server 8000`.

Inject photos by importing `/src/main.js` and pushing canvas-generated `Photo` objects into `state.photos`, then `rerender()`.

Verify and report each, with measured numbers:

1. Dragging the **right** edge right increases `wIn`; the measured `wIn` tracks the pointer delta converted through `96 * previewScale`.
2. Dragging the **left** edge left also increases `wIn` (mirrored, not inverted).
3. Dragging the **bottom** edge down increases `hIn`.
4. Dragging the **top** edge up also increases `hIn`.
5. As a photo grows, its row sheds companions — count the placements sharing its `yIn` before and after.
6. No placement leaves the printable area at any point during the drag.
7. Double-clicking a handle sets `targetHeightIn` to `null` and leaves `pinned === false`.
8. A resize drag does not reorder and does not ingest files — photo count and order unchanged.
9. Console clean throughout.

Stop the server when done.

- [ ] **Step 5: Commit**

```bash
git add src/preview.js src/interact.js src/main.js
git commit -m "Size a photo by dragging any of its edges

Width and height are locked together by aspect ratio, so an edge drag and
a corner drag are one constraint on different axes — all five handles set
the same anchor and the engine is untouched.

Growing a photo sheds its rowmates to other rows, which is the reflow the
user wanted instead of cropping. Pointer events rather than HTML5 drag so
this cannot be confused with the reorder drag or the file-ingest drop, and
moves are coalesced into a frame because re-solving costs 8.5ms at thirty
photos."
```

### Consequential change to Task 5

The README usage table gains edge dragging rather than only a corner:

```markdown
| Resize one photo | Drag any edge or the corner. The rest reflow around it |
| Release a resize | Double click the same handle |
```

And the explanation should say that growing a photo pushes its rowmates to other rows rather than cropping them, with the measured table above as evidence.
