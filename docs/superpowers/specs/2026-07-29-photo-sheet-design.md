# Photo Sheet — Design

**Date:** 2026-07-29
**Status:** Approved for planning

## Problem

Arrange a set of photos with mixed aspect ratios (1:1, 5:4, 4:3, 3:2, 16:9, portrait
variants) onto a single printable sheet with minimal blank space. Adding or removing a
photo re-solves the whole page automatically, like a Shutterfly photo book page.

## Decisions

| Question | Decision |
|---|---|
| Photo sizing | Free scaling — the packer chooses sizes to fill the sheet |
| Cropping | Allowed up to a user-set tolerance (default 6%) to remove leftover space |
| Overflow | Single sheet only; warn when density passes a threshold |
| Outputs | Live preview, direct print, PDF, PNG/JPG, saved reopenable project |
| Manual control | Drag reorder, pin size, crop nudge — all optional over a working auto-layout |
| Inputs | Multi-file picker, Ctrl+V clipboard paste, drag & drop from Explorer |
| Scale | 5–20 photos per sheet |
| Platform | Client-side web app, vanilla ES modules, Tailwind CDN, no build step |

### Platform rationale

The product is one pure function — `layout(photos, page, opts) → placements`. Everything
else is plumbing. So the shell is chosen to make the plumbing cheapest, not to make the
math faster.

Clipboard paste, Explorer drag-drop, and multi-file selection are native browser APIs.
CSS handles preview and drag interactions. `pdf-lib` writes the PDF client-side. Nothing
leaves the machine.

Angular was rejected: DI, RxJS, and module architecture are enterprise scaffolding for an
app with roughly six components. A pure Rust GUI was rejected: memory safety and speed buy
nothing against 20 JPEGs, and Windows printing from raw Rust is a known pain point.

**Tauri is the deferred phase 2, not a competing option.** Its frontend would be this exact
code, gaining a 5 MB `.exe`, native dialogs, and real filesystem paths in project files.
Building web-first costs nothing if that upgrade ever happens.

### The PDF is canonical

Browser CSS printing defaults to "fit to printable area" on Windows and silently rescales
by a few percent. So the PDF is generated first and printing means printing that PDF. The
HTML preview and the PNG export are secondary renders of the same placement data, never
sources of truth for print geometry.

## Layout engine

The only non-trivial component. Lives in `layout.js` as a pure function — no DOM, no
imports, fully unit-testable.

### Row solving

Photos keep their input order, which is what makes drag-to-reorder meaningful. For photos
*i..j* assigned to one row, the row must span the content width `W` exactly, so its height
follows directly:

```
h = (W − gutters) / Σ(aspect ratios in row)
```

No search. Any assignment of photos to a row has exactly one flush height.

### Superseded approach, and why it failed

The first design minimised each row's squared deviation from a target height and
binary-searched that target until the page filled. It was implemented, measured, and
**discarded**, because it does not fill the page.

Minimising height *deviation* rewards rows of near-equal height, and rows are near-equal
in height when they hold near-equal numbers of photos. The reachable layouts therefore
collapse to roughly "k photos per row", and total page height jumps geometrically between
them. For twelve photos the entire reachable set was:

```
12 → 6,6 → 4,4,4 → 3,3,3,3 → (overflows the page)
      0.42   1.89    4.31     7.73        12.34      inches
```

The content height, 10.5 in, falls in the gap. Binary search returns the best value below
it — 7.73 in, **73.6% fill** — and no target height reaches any nearer. Brute force over
all 2048 partitions found 99.9% was available. The failure is not a tuning problem; the
objective was simply the wrong one.

Measured fill against the maximum permitted ratio between the tallest and shortest row:

| photo set | ratio ≤ 3 | ratio ≤ 2 | ratio ≤ 1.5 (old behaviour) |
|---|---|---|---|
| 12 mixed | 85.5% | 76.1% | 73.6% |
| 10 landscape | 90.0% | 85.8% | 47.0% |
| 14 with portraits | 92.0% | 78.3% | 75.3% |
| 20 mixed | 86.6% | 75.3% | 70.5% |

Filling the sheet *requires* rows of visibly different heights. "Minimal blank space" and
"neat and aligned" are in direct tension, and the ratio cap is the dial between them.

### Fill maximisation within a row-height window

Sweep a window `[lo, lo × ratioCap]` over candidate row heights. For each window, a DP
maximises total page height using only rows whose height falls inside it:

```
best[j] = max over i of ( best[i] + rowHeight(i..j) + gutter )
          subject to  rowHeight(i..j) ∈ [lo, hi]
          and         the running total ≤ contentH
```

O(n²) per window, ~160 windows — still well under a millisecond at 20 photos.

**The page-height ceiling must be enforced inside the DP relaxation, not by rejecting a
window whose best total overflows.** A window that permits an overflowing layout usually
also permits an excellent fitting one; discarding the window wholesale loses it. The first
prototype made exactly this mistake and underperformed brute force by up to 43 points.

Across nine test sets the search matches brute-force optimum on seven and lands within 6
points on the remaining two. Exactness would require exponential search for no visible gain.

Ties within 1% of page height break toward the lower ratio, so the tidier of two equally
full layouts wins.

`ratioCap` is user-facing — a Density vs Evenness slider, default 3.

### Residual absorption

The window search lands at or just under `H`, leaving residual `r`. Distribute it
proportionally to row heights, `δₖ = r · hₖ / Σh`, which yields a useful identity:

```
crop fraction = r / (Σh + r)     — identical for every row
```

Every photo loses the same percentage from its left and right edges. Uniform crop reads as
intentional; crop that varies photo to photo reads as broken.

Capped by the user's crop tolerance. Whatever `r` the cap cannot absorb becomes slightly
wider gutters rather than a white band at the bottom — evenly distributed whitespace looks
deliberate, pooled whitespace looks like a failure.

### Crop is horizontal only

Rows are width-constrained, so absorbing residual height grows each box vertically while
its width stays fixed. The source image is therefore always trimmed from its left and right
edges, never top and bottom. Crop nudging is consequently a single scalar per photo along
one axis, not a 2D offset.

### Pinned photos

Pinning is defined as: **the photo occupies a row by itself**, which makes it as large as
the content width allows. This is a forced break before and after that photo in the DP —
no new cost function and no ambiguity about "how much bigger."

A pinned row is **exempt from the row-height window**. A single photo spanning the full
content width is often far taller than any window admits, and applying the constraint would
make pinning fail to solve rather than do what the user asked. The exemption can push the
tallest-to-shortest ratio above the cap; that is the user's explicit instruction overriding
a default, which is the correct precedence.

Multiple pinned photos each take their own row. If pinning pushes the solve past the
density floor, the standard warning fires.

### Density warning

After solving, if any photo falls below a minimum dimension floor (default 1.5 in), raise
the density warning rather than silently producing unusably small prints.

### Known limitation: mixed orientation

Within a row all photos share a height, so a 16:9 receives about 2.6× the area of a 2:3
portrait beside it. Landscapes visually dominate.

The fix is column grouping — stacking two landscapes vertically into a block whose combined
aspect is about 0.89, which pairs evenly with a 0.67 portrait. This turns the DP into a
search over both break points and groupings.

**Deferred.** Mostly-landscape sets look correct without it. If mixed sets prove
unsatisfying in practice, it is a contained upgrade to one module. Building it before the
problem is confirmed is speculative work.

## Data model

```
Photo     { id, blob, mime, naturalW, naturalH, aspect, cropOffset, pinned }
Page      { widthIn, heightIn, marginIn, gutterIn, cropTolerance, minPhotoIn, ratioCap }
Placement { photoId, xIn, yIn, wIn, hIn, srcRect }   // srcRect normalized 0..1
```

`cropOffset` is a single scalar in −1..1 shifting the visible window horizontally, clamped
so `srcRect` stays inside the source. It has no effect when nothing is cropped.

Page defaults: 8.5 × 11 in, 0.25 in margin (below most printers' unprintable edge),
0.08 in gutter, 6% crop tolerance, 1.5 in minimum photo dimension, 3× row-height ratio cap.
All user-adjustable; `ratioCap` and `cropTolerance` are the two that visibly change output,
and both get sliders.

`Placement` is in inches. Preview scales by screen factor, PNG by 300, PDF by 72. One
coordinate system, three renderers, no drift between preview and print.

## Modules

| File | Responsibility |
|---|---|
| `layout.js` | Pure engine. Row solving, windowed fill-maximising DP, residual absorption |
| `photos.js` | Ingest from picker, paste, drop. Decode, read EXIF, compute aspect |
| `preview.js` | Placements → positioned DOM elements |
| `interact.js` | Drag reorder, pin, crop nudge. Mutates photo list, triggers re-solve |
| `export-pdf.js` | Placements → PDF via `pdf-lib` |
| `export-png.js` | Placements → canvas → blob at chosen DPI |
| `project.js` | Save and reopen sheets |
| `main.js` | Wiring and state |

## Data flow

```
ingest → Photo[] ──┐
                   ├──► layout() ──► Placement[] ──┬──► preview (DOM)
Page settings ─────┘         ▲                     ├──► PDF ──► print
                             │                     └──► PNG
interact ────────────────────┘
```

Every mutation re-runs the full solve. At this scale there is no reason to do anything
incremental.

## Ordering

Auto-layout respects input order, and drag-to-reorder is therefore never silently undone by
the packer.

An "auto-arrange" action that reorders photos to improve packing was considered and
**rejected on measurement**. Best-of-all-permutations against as-ordered fill:

| photos | as-ordered | best ordering |
|---|---|---|
| 5 | 57.9% | 64.5% |
| 6 | 97.5% | 97.7% |
| 7 | 96.9% | 97.7% |

It buys about one point at six photos or more, and does not rescue the five-photo case. Fill
is dominated by how many photos there are, not what order they sit in.

Small counts pack badly and that is inherent: five photos of mixed aspect cannot fill a
letter sheet under any ordering, while six reach 97%. The honest remedies are adding a photo,
raising crop tolerance, or accepting the whitespace.

## Risks

**EXIF orientation.** Phone JPEGs report swapped dimensions, which would corrupt every
aspect ratio. Decode with `createImageBitmap(blob, { imageOrientation: 'from-image' })`.
Must be handled at ingest.

**HEIC.** Chrome cannot decode it, and iPhone photos are commonly HEIC. Detect by
magic bytes and show a clear message rather than failing opaquely. Bundling `libheif-js` is
possible but heavy; out of scope for phase 1.

**Cropping inside the PDF.** `pdf-lib` has no crop API. Place the image scaled up and apply
a PDF clipping path via raw content operators (`q W n … Q`). This preserves original JPEG
bytes with no re-encode and no quality loss — strictly better than pre-cropping through a
canvas.

**Project persistence.** Browsers cannot re-read arbitrary local paths on reopen. Photos
are copied into OPFS at import and the project manifest references them by content hash.
Reopening on the same machine works fully. Portable export bundles are out of scope for
phase 1.

## Testing

`layout.js` is pure and carries the entire risk, so it gets real unit tests:

- Every row is flush to the content width within tolerance
- Total height never exceeds content height
- Crop fraction stays within tolerance and is uniform across rows
- Aspect ratios are preserved exactly when crop tolerance is 0
- Degenerate inputs: one photo, all identical aspects, extreme ratios, empty set
- DP beats greedy on a set constructed to produce a runt final row

Export paths are verified by rendering a known layout and checking PDF page dimensions and
image placement rectangles.

## Out of scope for phase 1

Multi-page flow, column grouping for mixed orientation, HEIC decoding, portable project
bundles, text captions, borders and frames, background colors, templates.
