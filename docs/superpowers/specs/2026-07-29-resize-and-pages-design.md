# Manual Resize and GitHub Pages — Design

**Date:** 2026-07-29
**Status:** Approved for planning
**Supersedes nothing.** Extends the [original design](2026-07-29-photo-sheet-design.md).

## Two independent pieces

1. **GitHub Pages deployment** — built first. Small, self-contained, no engine changes.
2. **Manual resize** — a layout engine change. Drag one photo to a size; the rest re-solve around it.

They share no code. Built and reviewed separately.

---

# Part 1 — GitHub Pages

## Decisions

| Question | Decision |
|---|---|
| Repo visibility | **Public.** Pages on a private repo requires a paid plan, and there is nothing sensitive in the tree |
| Build step | Still none. The workflow uploads the repo as-is |
| Jekyll | Disabled via `.nojekyll` |

## Why it works unchanged

The app is already static ES modules with relative import paths and a vendored `pdf-lib`. Nothing assumes a host or a port. Two things that could have broken and do not:

- **OPFS** requires a secure context. Pages serves over HTTPS, so saved sheets keep working.
- **The `file://` failure mode** — Chrome blocking ES modules across `file://` — does not apply, because Pages serves over HTTP(S). Pages actually removes the project's sharpest usability edge.

`.nojekyll` matters because Jekyll ignores paths beginning with `_` and would also add pointless build time. The repo has no underscore paths today, but adding one later must not silently break the deploy.

## Pre-publication check

Before flipping visibility, the tree was scanned for credential patterns, `.env`/`.pem`/`.key` files, and absolute personal paths. Nothing found. The only grep hit was a documentation line, not a secret.

## Workflow

`.github/workflows/deploy.yml`, triggered on push to `main` and manually via `workflow_dispatch`:

- `actions/configure-pages`
- `actions/upload-pages-artifact` with `path: .`
- `actions/deploy-pages`

Permissions limited to `contents: read`, `pages: write`, `id-token: write`. A `concurrency` group so overlapping pushes do not race.

The whole repo is uploaded, including `docs/` and the 1.6 MB vendored library. That is deliberate — the vendored library is required at runtime, and `docs/` is small and worth having published alongside.

## Verification

The deployed site must load, ingest a photo, and export a PDF. A green workflow run alone is not evidence the app works.

---

# Part 2 — Manual resize

## The requirement

Drag one photo to a chosen size; the rest of the sheet re-solves to accommodate it.

## The constraint that shapes everything

Within a row, all photos share one height — that is what makes rows flush to the content width. So a photo's size is its row's height, and changing it necessarily involves its row-mates.

Three behaviours were considered. The user chose **repack around it**: the resized photo gets the size it was given, and other photos regroup to accommodate.

## Why contiguous rows cannot deliver this

The existing engine builds rows from **contiguous** ranges of the photo array. Measured, that makes exact sizing impossible.

**Achievable heights are coarse.** Every contiguous range containing a given photo yields one possible height. For the first photo of a twelve-photo sheet the entire set is:

```
1.16   1.38   2.05   3.40   8.00     inches
```

Five options, with a **4.6 in gap**. Drag toward 5 in and it snaps to 3.40 or 8.00. Edge photos are worst — 5 options — while middle photos get 11 to 30, still with 2 in gaps.

**Allowing an exact height instead leaves holes.** If the anchored row is permitted its exact target height and centred rather than flush, the best contiguous companion set leaves side gaps up to **4.8 in on an 8 in width** — over half the row empty. Small at some targets (0.18 in), unusable at others (4.25 in).

Contiguity is the binding constraint, not the row model.

## The design: free grouping for the anchored row only

The anchored row draws its companions from **any** photos, chosen to best fill the content width at the target height. Everything else keeps its relative order and packs through the existing dynamic program unchanged.

Measured side gaps with free grouping:

| target height | side gap |
|---|---|
| 1.5 in | 0.02 – 0.59 in |
| 2.0 in | 0.18 – 0.28 in |
| 2.5 in | 0.14 – 0.84 in |
| 3.0 in | 0.42 – 0.93 in |
| 3.5 in and above | 0.33 – 4.00 in |

Good through 3 in. Above that the gaps grow because the photo is nearly full-width and ends up alone on its row — which is precisely what "make this one big" means, so whitespace beside it is the correct outcome, not a defect.

### Rules

1. **`targetHeightIn` on a photo**, set by dragging a corner handle. `null` means unanchored, the current behaviour.
2. **Clamped** to `[minPhotoIn, contentW / aspect]` and to `contentH`, so a photo can never be dragged wider than the page or taller than the sheet.
3. **Companions chosen freely**, maximising row width without exceeding `contentW` at the target height. **The anchored row only** is capped at five photos to bound the subset search; ordinary rows keep their existing unlimited width and regularly hold six.
4. **Remaining photos keep their relative order**, packed by the existing windowed fill-maximising DP.
5. **The anchored row is centred when not flush**, reusing the machinery already built for clamped portraits. No new rendering path.
6. **Vertical position chosen for best fill** — the anchored row is tried at each row boundary and placed where the page packs best.
7. **One anchor at a time.** Anchoring a second photo releases the first. Multiple simultaneous anchors multiply the search space for a feature whose value is a single deliberate emphasis.
8. **The ratio cap does not apply to an anchored row**, matching the existing pinned-row exemption: an explicit instruction overrides a default.

### Relationship to pinning

Pinning already means "own row at full content width". Resizing generalises it to "a size you choose". Pinning stays — it is one gesture for the common case. An anchored photo is not pinned and vice versa; setting one clears the other.

## Row order was never biased toward big-at-top

The user reported that upper rows seem larger. Measured across eight photo sets, row heights run:

```
5 mixed         1.95 -> 4.21                    ascending
6 mixed         2.51 -> 4.93 -> 2.91            big in the middle
8 mixed         1.95 -> 4.21 -> 1.95            big in the middle
9 squares       4.21 -> 1.63 -> 4.21            big at both ends
12 mixed        2.18 -> 3.03 -> 2.98 -> 1.11    mixed
10 landscape    2.81 -> 2.81 -> 2.81 -> 1.38    big at top
```

**One of eight.** There is no bias in the packer. Which row is large follows from where wide photos sit in the sequence, and the user already controls that by dragging to reorder. Rule 6 above adds further variation by choosing the anchored row's vertical position.

No work is required for this part of the request. It is recorded here so it is not re-investigated later.

## Data model change

```
Photo { id, blob, url, mime, naturalW, naturalH, aspect, orientation,
        cropOffset, pinned, targetHeightIn }
```

`targetHeightIn` must round-trip through `src/project.js`, or reopening a saved sheet would silently drop the user's sizing.

## Interaction

A resize handle on the bottom-right corner of each photo box, visible on hover. Dragging changes height live; the layout re-solves on each pointer move, which is affordable — the engine solves in well under a millisecond at twenty photos.

**Clearing an anchor conflicts with the existing pin gesture.** Double-click on a photo box already toggles pinning, so the release cannot also be a double-click on the box. The handle is a child of the box, so a double-click on it would bubble and toggle the pin too.

Resolution: **double-click the handle specifically, and the handler calls `stopPropagation`** so the box's pin handler never sees it. The handle is the only element that releases an anchor, which also reads correctly — you grab the same control to size it and to let it go.

There must be a way back; an anchor with no release is a trap.

## Testing

`src/layout.js` stays pure and unit-tested. New cases:

- An anchored photo's placement height equals its target, within tolerance.
- The anchored row's width never exceeds the content width.
- A target above `contentW / aspect` is clamped rather than overflowing.
- A target below `minPhotoIn` is clamped.
- Unanchored photos still cover every remaining photo exactly once, in their original relative order.
- With no anchor set, output is byte-identical to the current engine — this is the regression guard that the change is additive.
- Anchoring then clearing returns the original layout.

The interaction is verified by driving a real browser, as with every other browser module.

## Out of scope

Multiple simultaneous anchors, anchoring by absolute width instead of height, dragging a photo to a specific position on the page, and free-form non-row layouts.
