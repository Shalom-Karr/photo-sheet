# Photo Sheet

Packs photos of mixed aspect ratios (1:1, 5:4, 4:3, 3:2, 16:9, and portrait
variants) onto one printable sheet with minimal blank space, re-solving the whole
page automatically as photos are added or removed.

No build step, no framework, nothing to install. Serve the folder and open it.

## Running

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

**It must be served over HTTP.** Opening `index.html` directly as a `file://`
URL will not work — Chrome blocks ES module loading across `file://`, and the
page will look dead with only a console error to explain why.

## Using it

| Action | How |
|---|---|
| Add photos | **Add photos…**, `Ctrl+V`, or drag files from Explorer onto the window |
| Reorder | Drag one photo onto another |
| Pin (own row, full width) | Double click |
| Nudge the crop window | `Shift` + scroll |
| Remove | Right click |
| Save / reopen a sheet | Name it, **Save sheet**, then pick it from the list |

Four sliders control the layout:

- **Crop tolerance** — how much of each photo's edges may be trimmed to fill the page.
- **Gutter** — spacing between photos.
- **Min photo size** — below this, the density warning fires.
- **Density vs evenness** — how much row heights may differ. This is the one that
  most changes how a sheet looks.

Export as PDF or 300 DPI PNG, or print directly.

## Tests

```bash
npm test
```

Node's built-in runner, no dependencies. Requires Node 22+.

Run `node --test` with **no path argument** — on Node 22 for Windows a path
argument is resolved as a module and fails with `MODULE_NOT_FOUND`.

The tests cover `src/layout.js` only. That module is pure — no DOM, no imports,
no I/O — and holds all the geometry, so it is where the risk is. The browser
modules are verified by driving a real browser.

## How the layout works

1. **Row height is solved, not searched.** Photos in a row share a height, and
   spanning the content width exactly determines it — one linear equation, no
   tuning.

2. **Break points come from a dynamic program** that considers every possible
   split, rather than filling greedily until a row overflows. Greedy filling is
   what strands one photo alone on the last row at several times everyone
   else's size.

3. **Fill is maximised inside a row-height window.** Rows may differ in height
   by up to a user-set cap, default 3×. The page-height ceiling is enforced
   inside the DP relaxation rather than by rejecting a whole window — a window
   that permits an overflowing layout usually permits an excellent fitting one
   too.

4. **Leftover height becomes a uniform crop.** Distributing the residual in
   proportion to row height makes the crop fraction algebraically identical on
   every row. A consistent trim reads as intentional; crop that varies photo to
   photo reads as broken. Whatever the tolerance cap cannot absorb is spread
   across every gap instead of pooling into a band at the bottom.

Placements are emitted in **inches**. The preview multiplies by 96, PNG export
by 300, PDF by 72 — three renderers over one coordinate system, so preview and
print cannot drift.

### Why fill and evenness are in tension

Filling the sheet *requires* rows of visibly different heights. An earlier design
minimised each row's deviation from a target height and binary-searched that
target; it was implemented, measured, and discarded. Near-equal row heights mean
near-equal photo counts per row, so the reachable layouts collapse to "k photos
per row" and total height jumps geometrically between them — leaving the page
height in a gap. Measured page fill:

| photo set | ratio ≤ 3 | ratio ≤ 2 | ratio ≤ 1.5 (the old behaviour) |
|---|---|---|---|
| 12 mixed | 85.5% | 76.1% | 73.6% |
| 10 landscape | 90.0% | 85.8% | 47.0% |
| 14 with portraits | 92.0% | 78.3% | 75.3% |
| 20 mixed | 86.6% | 75.3% | 70.5% |

The Density vs evenness slider is that dial. Full reasoning in the
[design spec](docs/superpowers/specs/2026-07-29-photo-sheet-design.md).

### Page fill depends on photo count, not order

| photos | page fill |
|---|---|
| 5 | 73% |
| 8 | 89% |
| 12 | 96% |

Five photos of mixed aspect ratio cannot fill a letter sheet under **any**
ordering — the best of all 120 permutations reaches 64.5% ink coverage against
57.9% as-ordered. Six photos reach 97%. An auto-arrange feature was measured on
that basis and rejected: it buys about one point at six photos or more.

If a sheet looks half empty, the remedy is another photo, more crop tolerance, or
accepting the whitespace.

## Printing

The PDF is the canonical print artifact — printing goes through it, never through
the DOM. Chrome's DOM print path on Windows defaults to "fit to printable area"
and silently rescales the page by a few percent, which would defeat the point of
solving the layout in real inches.

Cropped photos are embedded whole and clipped with a PDF clipping path, so the
original JPEG bytes are preserved with no re-encode and no quality loss.

The one exception is a photo carrying a non-default EXIF orientation. A PDF image
XObject has no orientation concept, so such photos are re-encoded through a
canvas — which the browser orients for us — rather than printed rotated. The
orientation tag is read at ingest and saved with the sheet.

## Layout of the code

| File | Responsibility |
|---|---|
| `src/layout.js` | The engine. Pure, unit-tested, all geometry in inches |
| `src/preview.js` | Placements → positioned DOM |
| `src/photos.js` | Ingest from picker, clipboard and drag-drop |
| `src/interact.js` | Reorder, pin, crop nudge, remove |
| `src/export-pdf.js` | PDF generation and printing |
| `src/export-png.js` | 300 DPI raster export |
| `src/project.js` | Save and reopen, backed by OPFS |
| `src/main.js` | State and wiring |
| `vendor/` | pdf-lib, committed rather than loaded from a CDN — see `vendor/README.md` |

## Documents

| Document | What it covers |
|---|---|
| [Design spec](docs/superpowers/specs/2026-07-29-photo-sheet-design.md) | The problem, the decisions and why, the layout algorithm, known limitations |
| [Implementation plan](docs/superpowers/plans/2026-07-29-photo-sheet.md) | The twelve tasks, with the code and tests for each, plus the amendment that replaced the original layout approach |

## Known limitations

- **Mixed portrait and landscape.** Within a row all photos share a height, so a
  16:9 receives about 2.6× the area of a 2:3 portrait beside it. The fix is
  column grouping — stacking two landscapes into a portrait-shaped block —
  deferred until it proves necessary in practice.
- **HEIC is not supported.** Chrome cannot decode it and iPhone photos are
  commonly HEIC. Such files are rejected by name rather than failing silently.
  Convert to JPEG first.
- **Single sheet only.** Overflow raises a density warning rather than
  paginating.
- **Saved sheets live in OPFS**, which is per-browser and per-origin. They are
  not files you can copy elsewhere.

## Licence

Not yet determined.
