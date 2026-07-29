# Photo Sheet

Packs photos of mixed aspect ratios (1:1, 5:4, 4:3, 3:2, 16:9, and portrait
variants) onto one printable sheet with minimal blank space, re-solving the
whole page automatically as photos are added or removed.

> **Status: usable, still in development.** You can load photos and see them laid
> out. Export and printing are not wired up yet. See the roadmap below.

## Documents

| Document | What it covers |
|---|---|
| [Design spec](docs/superpowers/specs/2026-07-29-photo-sheet-design.md) | The problem, the decisions and why, the layout algorithm, known limitations |
| [Implementation plan](docs/superpowers/plans/2026-07-29-photo-sheet.md) | Twelve tasks, TDD, with the code and tests for each |

## How the layout works

1. **Row height is solved, not searched.** Photos in a row share a height, and
   spanning the content width exactly determines it — one linear equation.
2. **Break points come from a dynamic program**, considering every possible split
   rather than filling greedily until a row overflows.
3. **Fill is maximised inside a row-height window.** Rows may differ in height by
   up to a user-set cap (default 3x). Forcing rows to near-equal heights looks
   tidier but caps page fill at 40-76%; allowing 3x reaches 85-96%. "Minimal
   blank space" and "neat and aligned" genuinely conflict, and that cap is the dial.
4. **Leftover height becomes a uniform crop.** Distributing the residual in
   proportion to row height makes the crop fraction algebraically identical on
   every row — a consistent trim reads as intentional, whereas crop that varies
   photo to photo reads as broken.

Placements are emitted in **inches**. The preview scales by 96, PNG export by
300, PDF by 72 — three renderers over one coordinate system, so preview and
print cannot drift.

## Running the tests

No build step, no dependencies.

```bash
npm test
```

Uses Node's built-in test runner. Requires Node 22+.

Note: run `node --test` with **no path argument**. On Node 22 for Windows a
path argument is resolved as a module and fails with `MODULE_NOT_FOUND`.

## Roadmap

- [x] Flush row-height solving
- [x] Fill maximisation within a row-height window
- [x] Residual absorption and uniform crop
- [x] `layout()` entry point emitting inch-space placements
- [x] App shell and live preview
- [x] Photo ingest — file picker, clipboard paste, drag and drop
- [ ] PDF export and printing
- [ ] PNG export at 300 DPI
- [ ] Drag to reorder, pin, crop nudge
- [ ] Save and reopen sheets
- [ ] Final documentation

## Page fill by photo count

Fill is dominated by how many photos are on the sheet, not what order they are in:

| photos | page fill |
|---|---|
| 5 | 73% |
| 8 | 89% |
| 12 | 96% |

Five photos of mixed aspect ratio cannot fill a letter sheet under **any** ordering —
the best of all 120 permutations reaches 64.5% ink coverage against 57.9% as-ordered.
Six photos reach 97%. Reordering was measured and rejected as a feature on that basis.

## Known limitations

- **Mixed portrait and landscape.** Within a row all photos share a height, so a
  16:9 receives about 2.6× the area of a 2:3 portrait beside it. The fix is
  column grouping — stacking two landscapes into a portrait-shaped block —
  deferred until it proves necessary in practice.
- **HEIC is not supported**, because Chrome cannot decode it. Convert to JPEG.
- **Single sheet only.** Overflow raises a density warning rather than
  paginating.

## Licence

Not yet determined.
