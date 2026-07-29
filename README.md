# Photo Sheet

Packs photos of mixed aspect ratios (1:1, 5:4, 4:3, 3:2, 16:9, and portrait
variants) onto one printable sheet with minimal blank space, re-solving the
whole page automatically as photos are added or removed.

> **Status: in development.** The layout engine is being built and tested first;
> the browser app is not usable yet. This README describes what currently exists
> and is updated as tasks land. See the roadmap below.

## Documents

| Document | What it covers |
|---|---|
| [Design spec](docs/superpowers/specs/2026-07-29-photo-sheet-design.md) | The problem, the decisions and why, the layout algorithm, known limitations |
| [Implementation plan](docs/superpowers/plans/2026-07-29-photo-sheet.md) | Twelve tasks, TDD, with the code and tests for each |

## How the layout works

1. **Row height is solved, not searched.** Photos in a row share a height, and
   spanning the content width exactly determines it — one linear equation.
2. **Break points come from a dynamic program** minimising squared deviation
   from a target height. Greedy row filling strands one photo alone on the last
   row at several times everyone else's size; costing every possible split
   cannot.
3. **Target height is binary-searched** so the sheet fills vertically. Web
   galleries treat target height as a constant because they scroll forever. A
   sheet has a hard bottom edge, which turns it into a solved variable.
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
- [x] Row breaking by dynamic programming
- [ ] Binary-searched target height
- [ ] Residual absorption and uniform crop
- [ ] `layout()` entry point emitting inch-space placements
- [ ] App shell and live preview
- [ ] Photo ingest — file picker, clipboard paste, drag and drop
- [ ] PDF export and printing
- [ ] PNG export at 300 DPI
- [ ] Drag to reorder, pin, crop nudge
- [ ] Save and reopen sheets
- [ ] Final documentation

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
