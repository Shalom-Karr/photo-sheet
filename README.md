# Photo Sheet

Packs photos of mixed aspect ratios (1:1, 5:4, 4:3, 3:2, 16:9, and portrait
variants) onto one printable sheet with minimal blank space, re-solving the whole
page automatically as photos are added or removed.

**Live:** <https://shalom-karr.github.io/photo-sheet/>

No build step, no framework, nothing to install.

## Running

Use the hosted copy: <https://shalom-karr.github.io/photo-sheet/>. Photos never
leave your machine — everything runs in the browser.

To run it locally instead:

```bash
python -m http.server 8000
```

Then open <http://localhost:8000>.

**It must be served over HTTP either way.** Opening `index.html` directly as a
`file://` URL will not work — Chrome blocks ES module loading across `file://`,
and the page will look dead with only a console error to explain why.

## Using it

| Action | How |
|---|---|
| Add photos | **Add photos…**, `Ctrl+V`, or drag files from Explorer onto the window |
| Reorder | Drag one photo onto another |
| Pin (own row, full width) | Double click |
| Nudge the crop window | `Shift` + scroll |
| Resize one photo | Drag any edge or the corner handle. The rest reflow around it |
| Release a resize | Double click the same handle |
| Select a photo | Click it — a fuchsia ring marks it |
| Delete the selected photo | `Backspace` or `Delete`. Deleting advances the selection, so you can keep pressing |
| Clear the selection | `Escape`, or click the empty sheet |
| Remove without selecting | Right click |
| Undo | `Ctrl+Z` — covers adding, deleting, reordering, pinning, resizing and crop nudges |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` |
| Save / reopen a sheet | Name it, **Save sheet**, then pick it from the list |

Four sliders control the layout:

- **Crop tolerance** — how much of each photo's edges may be trimmed to fill the page.
- **Gutter** — spacing between photos.
- **Min photo size** — below this, the density warning fires.
- **Max photo size** — no photo's longer side may exceed this. Lower it to force
  more photos per row: at 2.6 in a row of two landscape photos becomes impossible,
  so the packer uses three or more. Caps pinned and hand-sized photos too.
- **Density vs evenness** — how much row heights may differ. This is the one that
  most changes how a sheet looks.
- **Photos per row** — an optional strict range, off by default. See below.
- **Manual sizing** — a toggle. Off returns the sheet to automatic layout while
  *remembering* any size you set by hand; switch it back on and your size returns.
  Dragging a handle turns it on for you.

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

### Resizing one photo

Drag any edge of a photo, or its corner, and that photo becomes exactly the size
you drag it to. Handles fade in on hover and turn emerald while a photo is sized
by hand, so the state is visible rather than hidden.

Width and height are one control, not two: an uncropped photo's proportions are
fixed, so dragging a side edge and dragging the bottom edge set the same
underlying size. Dragging any edge *away* from the photo's centre makes it bigger.

**Growing a photo pushes its rowmates onto other rows rather than cropping them.**
Measured, dragging one photo of a six-photo sheet wider:

| target width | photos sharing its row |
|---|---|
| 2.5 in | 3 |
| 3.5 in | 2 |
| 6.0 in | 1 |

Your photo resizes smoothly, but neighbours jump between rows in steps — a photo
is either in a row or it isn't, and nothing can smooth that. It is the price of
reflowing instead of cropping.

Above roughly 3 inches a photo is close to the full page width and ends up alone
on its row, so there will be white space beside it. That is what asking for a big
photo means.

Sizing survives saving and reopening a sheet.

### Photos per row

Leave it at `any` and the packer decides. Set a minimum and maximum to force a
strict grid — the second field accepts `0` for "no upper limit".

Fixing the row count and filling the page are in tension, because short rows leave
whitespace. Measured with a 3–4 range:

| photos | page fill |
|---|---|
| 3 | 19% |
| 6 | 38% |
| 12 | 74% |
| 15 | 94% |
| 18 or more | overflows, then scaled down |

Some ranges are arithmetically impossible: five photos cannot be split into rows
of three or four, since no row count satisfies it. Rather than failing, the limit
relaxes — first the last row is allowed to be short, then the limit is dropped
entirely — and the sheet says so.

Pinned photos are exempt, because a pin means a row to itself and a minimum of
three would otherwise make pinning impossible.

**If your goal is just "these are too big", prefer Max photo size.** It gets you
more per row without forcing whitespace, and it can never be impossible.

### Undo

`Ctrl+Z` steps back through photo changes: adding, deleting, reordering, pinning,
resizing and crop nudges. Fifty steps are kept. `Ctrl+Shift+Z` or `Ctrl+Y` redoes.

Slider settings and the manual-sizing toggle are deliberately **not** on the undo
stack — they are re-adjusted by dragging back, and including them would mean
`Ctrl+Z` sometimes nudges a slider when you meant to restore a photo you deleted.
Opening a saved sheet clears the history.

One gesture is one step: a resize drag records once when you press, not once per
mouse move, and a burst of crop nudges on the same photo collapses into a single
entry.

`Ctrl+Z` inside the sheet-name field does the normal text undo, not a layout undo.

### When a sheet cannot fit

Some combinations genuinely do not fit — pinning a photo forces it onto a row by
itself, which can leave too little room for the rest. Rather than running off the
page, every row is scaled down to fit and the sheet says so. Unpinning usually
recovers the space.

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
