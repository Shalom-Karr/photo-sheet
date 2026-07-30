export const LETTER = {
  widthIn: 8.5,
  heightIn: 11,
  marginIn: 0.25,
  gutterIn: 0.08,
  cropTolerance: 0.06,
  minPhotoIn: 1.5,
  ratioCap: 3,
  maxPhotoIn: 11,
  minPerRow: 1,
  maxPerRow: 0,
};

// Photos in a row share height h. Their widths plus gutters must equal contentW:
//   h * Σaspect + (n-1) * gutter = contentW
export function rowHeight(aspects, contentW, gutterIn) {
  const sum = aspects.reduce((s, a) => s + a, 0);
  return (contentW - (aspects.length - 1) * gutterIn) / sum;
}

// Maximise page fill using only rows whose height falls inside a window
// [lo, lo*ratioCap], sweeping the window across the plausible range.
//
// The superseded approach minimised each row's deviation from a target height
// and binary-searched the target. That rewards rows of near-equal height, hence
// near-equal photo counts, so reachable layouts collapse to "k photos per row"
// and total height jumps geometrically — leaving the page height in a gap and
// fill stuck at 40-76%. Capping the ratio instead of minimising the spread
// reaches 85-96%.
export function solveRows(aspects, contentW, contentH, gutterIn, opts = {}) {
  const { pinned = [], ratioCap = 3, windowSteps = 160, maxPhotoIn = Infinity, minPerRow = 1, maxPerRow = 0, relaxMinForLast = false } = opts;
  const n = aspects.length;
  if (n === 0) return { rows: [], heights: [] };

  // A row's height is bounded below by putting every photo in one row, and
  // above by the tallest single photo spanning the full width.
  const allInOne = rowHeight(aspects, contentW, gutterIn);
  const tallestSingle = Math.max(...aspects.map((a) => contentW / a));
  // contentH belongs in the lower bound because heightOf clamps to it. Two very
  // tall photos make even the all-in-one row taller than the page, so every
  // candidate clamps to contentH — below the window — and no window admits any
  // layout at all. The fallback then gives each photo a full-height row and the
  // sheet silently overflows.
  const loMin = Math.max(1e-6, Math.min(allInOne, tallestSingle, contentH));
  const loMax = Math.max(allInOne, tallestSingle, loMin);

  // A single photo can be taller than the whole page (a 2:3 portrait spanning
  // 8in is 12in tall). Clamping keeps it on the sheet; layout() centres any row
  // that is consequently not flush. maxPhotoIn caps the largest rendered
  // dimension: for a row of height h the largest dimension is h × max(1,
  // largestAspect), so the cap translates to an upper bound on h.
  const heightOf = (i, j) => {
    const slice = aspects.slice(i, j);
    const largestAspect = Math.max(1, ...slice);
    return Math.min(rowHeight(slice, contentW, gutterIn), contentH, maxPhotoIn / largestAspect);
  };

  let best = null;

  for (let s = 0; s <= windowSteps; s++) {
    const lo = loMin * Math.pow(loMax / loMin, s / windowSteps);
    const hi = lo * ratioCap;

    const dp = new Array(n + 1).fill(-Infinity);
    const prev = new Array(n + 1).fill(-1);
    dp[0] = 0;

    for (let j = 1; j <= n; j++) {
      for (let i = 0; i < j; i++) {
        if (dp[i] === -Infinity) continue;

        let hasPinned = false;
        for (let k = i; k < j; k++) if (pinned[k]) { hasPinned = true; break; }
        if (hasPinned && j - i > 1) continue;

        // Per-row count constraints. Pinned rows are exempt (forced to size 1
        // above — an explicit instruction beats a default).
        if (!hasPinned) {
          const count = j - i;
          const isLast = j === n;
          if (!(relaxMinForLast && isLast) && count < minPerRow) continue;
          if (maxPerRow > 0 && count > maxPerRow) continue;
        }

        const h = heightOf(i, j);
        if (!(h > 0)) continue;
        // A pinned row is exempt from the window: it spans the full width by
        // definition, and constraining it would make pinning fail to solve.
        if (!hasPinned && (h < lo * (1 - 1e-9) || h > hi * (1 + 1e-9))) continue;

        const total = dp[i] + h + (i > 0 ? gutterIn : 0);
        // The ceiling belongs here, not on the window's best total. A window
        // that permits an overflowing layout usually permits an excellent
        // fitting one too; rejecting the window wholesale loses it.
        if (total > contentH + 1e-9) continue;

        if (total > dp[j]) { dp[j] = total; prev[j] = i; }
      }
    }

    if (dp[n] === -Infinity) continue;

    const rows = [];
    for (let j = n; j > 0; j = prev[j]) rows.unshift([prev[j], j]);
    const heights = rows.map(([a, b]) => heightOf(a, b));
    const ratio = Math.max(...heights) / Math.min(...heights);

    // Prefer fill; break near-ties within 1% of the page toward the tidier layout.
    const better =
      !best ||
      dp[n] > best.total + contentH * 0.01 ||
      (Math.abs(dp[n] - best.total) <= contentH * 0.01 && ratio < best.ratio);
    if (better) best = { total: dp[n], rows, heights, ratio };
  }

  if (best) return { rows: best.rows, heights: best.heights, feasible: true };

  // No window admitted a fitting layout. Give each photo its own clamped row so
  // callers still get a well-formed result; the density warning will fire.
  const rows = aspects.map((_, i) => [i, i + 1]);
  return { rows, heights: rows.map(([a, b]) => heightOf(a, b)), feasible: false };
}

// Growing a row from h to h*scale keeps its width fixed, so each photo's source
// is trimmed left and right by 1 − 1/scale. Distributing the residual in
// proportion to row height makes that fraction identical on every row.
//
// maxScaleFactor is an optional external ceiling on the scale (e.g. derived from
// the maxPhotoIn constraint). When it binds, the part of the residual that the
// capped scale cannot absorb becomes extra gutter instead.
export function absorbResidual(heights, gutterIn, contentH, cropTolerance, maxScaleFactor = Infinity) {
  const n = heights.length;
  if (n === 0) return { heights: [], cropFraction: 0, extraGutter: 0 };

  const sumH = heights.reduce((a, b) => a + b, 0);
  const used = sumH + (n - 1) * gutterIn;
  const residual = contentH - used;

  if (residual <= 1e-9) {
    return { heights: heights.slice(), cropFraction: 0, extraGutter: 0 };
  }

  // Zero tolerance absorbs nothing, but the residual is not discarded: it falls
  // through and becomes extraGutter below, as it does whenever the cap binds.
  let cropFraction = 0;
  let absorbed = 0;
  if (cropTolerance > 0) {
    // crop = residual / (sumH + residual); invert for the tolerance-capped case.
    cropFraction = residual / (sumH + residual);
    absorbed = residual;
    if (cropFraction > cropTolerance) {
      cropFraction = cropTolerance;
      absorbed = (sumH * cropTolerance) / (1 - cropTolerance);
    }
  }

  let scale = (sumH + absorbed) / sumH;
  // Apply external scale ceiling. When it binds, re-derive absorbed and
  // cropFraction from the capped scale so they remain consistent.
  if (scale > maxScaleFactor) {
    scale = maxScaleFactor;
    absorbed = sumH * (scale - 1);
    cropFraction = scale > 1 ? 1 - 1 / scale : 0;
  }

  // Whitespace the crop cap could not absorb is spread across every gap —
  // above, between and below — so it reads as margin rather than a bottom band.
  const extraGutter = (residual - absorbed) / (n + 1);

  return { heights: heights.map((h) => h * scale), cropFraction, extraGutter };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Last resort, used by both layout paths. solveRows fits its rows inside the
// height it is given only when it finds a layout at all; its fallback — one row
// per photo — does not, and pinning reaches that fallback on ordinary sheets.
//
// Contiguity plus a solo pinned row strands the photo immediately before the pin
// alone in a row of its own, because the only contiguous range it can occupy ends
// at the pin. Both rows are then full width. For [1.5, 1.78, …] with the second
// photo pinned that is 5.33in plus 4.49in before the remaining four photos get
// anything — genuinely infeasible, so no window admits a layout. Measured, 31 of
// 46 single-pin cases overflowed, the worst reaching 72.89in on a 10.75in page.
//
// Gutters are fixed, so only the heights can give. scaled tells the caller to say
// out loud that the sheet did not fit.
function fitToPage(heights, gutterIn, contentH) {
  const gutters = (heights.length - 1) * gutterIn;
  const sumH = heights.reduce((a, b) => a + b, 0);
  if (sumH + gutters <= contentH || !(sumH > 0)) {
    return { heights: heights.slice(), scaled: false };
  }
  const scale = Math.max(0, contentH - gutters) / sumH;
  return { heights: heights.map((h) => h * scale), scaled: true };
}

const OVERFLOW_WARNING = {
  code: 'overflow',
  message:
    'This combination does not fit the sheet, so every photo was scaled down ' +
    'to fit. Unpinning a photo usually recovers the space.',
};

const PERROW_WARNING = {
  code: 'perRow',
  message: 'Cannot fit these photos into rows of that size, so the limit was ignored.',
};

export function layout(photos, page) {
  if (photos.length === 0) return { placements: [], warnings: [] };

  const contentW = page.widthIn - 2 * page.marginIn;
  const contentH = page.heightIn - 2 * page.marginIn;

  // At most one anchor is honoured; the first wins. The guard must reject null,
  // undefined, 0 and NaN, or an unanchored sheet would take the anchored path
  // and stop matching the ordinary engine.
  const anchorIdx = photos.findIndex(
    (p) => typeof p.targetHeightIn === 'number' && p.targetHeightIn > 0,
  );

  if (anchorIdx >= 0) {
    return layoutAnchored(photos, page, contentW, contentH, anchorIdx);
  }

  const aspects = photos.map((p) => p.aspect);
  const pinned = photos.map((p) => !!p.pinned);

  const minPerRow = page.minPerRow ?? 1;
  const maxPerRow = page.maxPerRow ?? 0;
  const inverted = maxPerRow > 0 && minPerRow > maxPerRow;
  const effectiveMin = inverted ? 1 : minPerRow;
  const effectiveMax = inverted ? 0 : maxPerRow;
  const hasConstraint = effectiveMin > 1 || effectiveMax > 0;

  const perRowOpts = {
    pinned,
    ratioCap: page.ratioCap,
    maxPhotoIn: page.maxPhotoIn,
    minPerRow: effectiveMin,
    maxPerRow: effectiveMax,
  };

  let solved = solveRows(aspects, contentW, contentH, page.gutterIn, perRowOpts);
  let perRowWarning = null;

  if (!solved.feasible && hasConstraint) {
    // Step 1: allow the final row to fall below minPerRow.
    const s2 = solveRows(aspects, contentW, contentH, page.gutterIn, { ...perRowOpts, relaxMinForLast: true });
    if (s2.feasible) {
      solved = s2;
    } else {
      // Step 2: drop the per-row constraint entirely.
      solved = solveRows(aspects, contentW, contentH, page.gutterIn, { pinned, ratioCap: page.ratioCap, maxPhotoIn: page.maxPhotoIn });
    }
    perRowWarning = { ...PERROW_WARNING };
  }

  const { rows, heights: solvedH } = solved;
  // A no-op unless the page would actually overflow, which needs an infeasible
  // sheet — in practice a pinned photo that is not the first.
  const fit = fitToPage(solvedH, page.gutterIn, contentH);
  const heights = fit.heights;
  // Keep rendered heights within maxPhotoIn. heightOf already caps
  // pre-absorption heights; absorbResidual would otherwise scale them up past
  // the limit. Scale cap = maxPhotoIn / tallest pre-absorption row height.
  const maxScaleFactor = page.maxPhotoIn != null
    ? Math.min(...heights.map((h) => h > 0 ? page.maxPhotoIn / h : Infinity))
    : Infinity;
  const abs = absorbResidual(heights, page.gutterIn, contentH, page.cropTolerance, maxScaleFactor);

  // Visible slice of each source after the uniform horizontal trim.
  const visW = 1 - abs.cropFraction;

  const placements = [];
  let y = page.marginIn + abs.extraGutter;

  rows.forEach(([start, end], r) => {
    const rowH = abs.heights[r];
    // Width is fixed by the pre-absorption height, so growing the row crops.
    const baseH = heights[r];
    // True row width from the pre-absorption height. For a flush row this equals
    // contentW exactly, so the centring offset is zero — no branch needed.
    const rowW = aspects.slice(start, end).reduce((s, a) => s + a * baseH, 0)
               + (end - start - 1) * page.gutterIn;
    let x = page.marginIn + (contentW - rowW) / 2;

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

  return { placements, warnings: warningsFor(placements, page, fit.scaled, perRowWarning) };
}

// The overflow explanation comes first: it is the reason the photos are small, so
// it reads before the density warning that scaling down usually also triggers.
function warningsFor(placements, page, scaled, perRowWarning = null) {
  const warnings = [];
  if (scaled) warnings.push({ ...OVERFLOW_WARNING });
  if (perRowWarning) warnings.push({ ...perRowWarning });
  warnings.push(...densityWarnings(placements, page));
  return warnings;
}

function densityWarnings(placements, page) {
  const smallest = Math.min(...placements.map((p) => Math.min(p.wIn, p.hIn)));
  if (smallest >= page.minPhotoIn) return [];
  return [
    {
      code: 'density',
      message:
        `Smallest photo is ${smallest.toFixed(2)} in, below the ` +
        `${page.minPhotoIn} in minimum. Remove photos or lower the minimum.`,
    },
  ];
}

// A photo's size is its row's height, and a row cannot be wider than the page.
// So a target is bounded above by the width limit, the page height, and the max
// photo size: at height h the photo's larger dimension is h × max(1, aspect).
export function clampTarget(target, aspect, contentW, contentH, minPhotoIn, maxPhotoIn = Infinity) {
  const widthLimit = contentW / aspect;
  const maxFromSize = maxPhotoIn / Math.max(1, aspect);
  const hi = Math.min(widthLimit, contentH, maxFromSize);
  const lo = Math.min(minPhotoIn, hi);
  // NaN would propagate through every downstream multiplication and yield a
  // sheet of NaN boxes. The drag handler derives the target by dividing by a
  // live preview scale, so a zero scale can produce one; resolve it to the floor.
  if (Number.isNaN(target)) return lo;
  return clamp(target, lo, hi);
}

// Choose companions for the anchored row from ANY photos, maximising width
// without exceeding contentW at the exact target height.
//
// Contiguous rows cannot do this. For the first photo of a twelve-photo sheet
// the only achievable contiguous heights are 1.16, 1.38, 2.05, 3.40 and 8.00in
// — dragging toward 5in would snap by 4.6in. Allowing an exact height with
// contiguous companions instead leaves side gaps up to 4.8in on an 8in width.
// Free selection holds the gap under an inch through 3in targets.
//
// excluded is a boolean array parallel to aspects marking photos that may not be
// drafted in as companions. The anchor is always in the row whatever its flag.
export function anchoredRow(aspects, anchorIdx, target, contentW, gutterIn, maxK = 5, excluded = []) {
  const others = [];
  for (let i = 0; i < aspects.length; i++) if (i !== anchorIdx && !excluded[i]) others.push(i);

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
      // Prune: adding this photo already overflows, and any deeper branch from
      // here only adds width, so nothing below this j can fit either. Later j
      // values are still tried — others is not sorted by aspect.
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

// Anchored layout: pull the anchored row out, solve the remaining photos with
// the ordinary engine, then insert the anchored row at a row boundary.
function layoutAnchored(photos, page, contentW, contentH, anchorIdx) {
  const aspects = photos.map((p) => p.aspect);
  let target = clampTarget(
    photos[anchorIdx].targetHeightIn,
    aspects[anchorIdx],
    contentW,
    contentH,
    page.minPhotoIn,
    page.maxPhotoIn,
  );

  // Every other photo still has to land on the page, so the anchored row cannot
  // claim the whole content height. Reserve a strip for the rest plus a gutter,
  // and let the anchored row have the remainder: their flush height as one row if
  // that is small, otherwise minPhotoIn, which is already this app's threshold for
  // "too small to be worth printing". Capping the reserve matters — a leftover
  // portrait's flush height can exceed the whole sheet, and reserving that would
  // squeeze the anchored row to nothing. Measured on two 0.35 portraits dragged to
  // full height, reserving half the page instead cost the anchor 5.33in; this
  // costs it 1.58in.
  //
  // Reserving before the row is chosen, not after, is what keeps the row's
  // companions consistent with the height the row is actually drawn at.
  if (photos.length > 1) {
    const others = aspects.filter((_, i) => i !== anchorIdx);
    const flush = Math.max(rowHeight(others, contentW, page.gutterIn), 1e-6);
    const reserve = Math.min(flush, page.minPhotoIn) + page.gutterIn;
    target = Math.max(1e-6, Math.min(target, contentH - reserve));
  }

  // A pin means "a row of my own at full content width", which is as explicit as
  // the requested size, so a pinned photo is never drafted in as a companion —
  // that would silently override it. It stays in the rest, where solveRows still
  // gives it its own row. The anchor itself is exempt: an explicit size supersedes
  // "full content width" for the one photo being sized.
  const anchorMaxK = Math.min(5, page.maxPerRow || 5);
  const row = anchoredRow(
    aspects,
    anchorIdx,
    target,
    contentW,
    page.gutterIn,
    anchorMaxK,
    photos.map((p) => !!p.pinned),
  );

  // After companions are known, enforce the max-size cap against the largest
  // aspect actually in the row. clampTarget only knew the anchor's own aspect;
  // a wide companion could push the row's largest dimension past the cap.
  if (page.maxPhotoIn != null) {
    const largestAspectInRow = Math.max(1, ...row.indices.map((i) => aspects[i]));
    target = Math.min(target, page.maxPhotoIn / largestAspectInRow);
  }

  const inRow = new Set(row.indices);

  // Everything else keeps its relative order.
  const restIdx = [];
  for (let i = 0; i < photos.length; i++) if (!inRow.has(i)) restIdx.push(i);
  const restAspects = restIdx.map((i) => aspects[i]);
  const restPinned = restIdx.map((i) => !!photos[i].pinned);

  // Positive by construction, thanks to the reserve above. It must not be floored
  // to a positive sliver when negative: solveRows only guarantees that its rows
  // fit the height it is given, so a floored budget puts the bottom row off the
  // page — measured at 0.09in past the bottom margin for a portrait dragged to
  // full page height on an eight-photo sheet.
  const budget = contentH - target - page.gutterIn;
  const aMinPerRow = page.minPerRow ?? 1;
  const aMaxPerRow = page.maxPerRow ?? 0;
  const aInverted = aMaxPerRow > 0 && aMinPerRow > aMaxPerRow;
  const aEffMin = aInverted ? 1 : aMinPerRow;
  const aEffMax = aInverted ? 0 : aMaxPerRow;
  const aHasConstraint = aEffMin > 1 || aEffMax > 0;

  const restBaseOpts = {
    pinned: restPinned,
    ratioCap: page.ratioCap,
    maxPhotoIn: page.maxPhotoIn,
    minPerRow: aEffMin,
    maxPerRow: aEffMax,
  };
  let anchoredPerRowWarning = null;
  let solved;
  if (restIdx.length) {
    solved = solveRows(restAspects, contentW, budget, page.gutterIn, restBaseOpts);
    if (!solved.feasible && aHasConstraint) {
      const s2 = solveRows(restAspects, contentW, budget, page.gutterIn, { ...restBaseOpts, relaxMinForLast: true });
      if (s2.feasible) {
        solved = s2;
      } else {
        solved = solveRows(restAspects, contentW, budget, page.gutterIn, { pinned: restPinned, ratioCap: page.ratioCap, maxPhotoIn: page.maxPhotoIn });
      }
      anchoredPerRowWarning = { ...PERROW_WARNING };
    }
  } else {
    solved = { rows: [], heights: [] };
  }

  const nRows = solved.rows.length;
  // Vertical position of the anchored row. Total fill is the same whichever
  // boundary it sits at — the identical rows are used either way — so there is
  // nothing to optimise here. This is a tie-break, not an optimisation: it picks
  // the middle boundary so a large anchored row does not always land at the top.
  const anchorPos = Math.floor(nRows / 2);

  // Assemble the final row list in vertical order.
  const rowsOut = [];
  for (let r = 0; r < nRows; r++) {
    if (r === anchorPos) rowsOut.push({ anchored: true });
    const [s, e] = solved.rows[r];
    rowsOut.push({ anchored: false, idx: restIdx.slice(s, e), h: solved.heights[r] });
  }
  if (anchorPos >= nRows) rowsOut.push({ anchored: true });

  // Excluding pinned photos from the row puts every pin in the rest, and a pin
  // forbids grouping, so three leftover photos need three full-width rows where
  // one flush row would have done — more height than the strip beside an anchored
  // row holds. That reaches the same solveRows fallback, so the same backstop
  // applies. The anchored row gives up its exact height only here, where the sheet
  // cannot honour it at all.
  const fit = fitToPage(
    rowsOut.map((r) => (r.anchored ? target : r.h)),
    page.gutterIn,
    contentH,
  );
  const heights = fit.heights;
  // Anchored rows use heights[ri] directly (not abs.heights), so they are
  // already capped. Cap the absorption scale using all row heights so
  // non-anchored abs.heights also stay within maxPhotoIn.
  const maxScaleFactor = page.maxPhotoIn != null
    ? Math.min(...heights.map((h) => h > 0 ? page.maxPhotoIn / h : Infinity))
    : Infinity;
  const abs = absorbResidual(heights, page.gutterIn, contentH, page.cropTolerance, maxScaleFactor);
  // The anchored row keeps the height it asked for; only ordinary rows absorb.
  const finalH = rowsOut.map((r, i) => (r.anchored ? heights[i] : abs.heights[i]));

  const placements = [];
  let y = page.marginIn + abs.extraGutter;

  rowsOut.forEach((r, ri) => {
    const idxs = r.anchored ? row.indices : r.idx;
    // Width is fixed by the pre-absorption height, so growing the row crops.
    const baseH = heights[ri];
    const boxH = finalH[ri];
    const rowW =
      idxs.reduce((s, i) => s + aspects[i] * baseH, 0) + (idxs.length - 1) * page.gutterIn;
    let x = page.marginIn + (contentW - rowW) / 2;

    for (const i of idxs) {
      const wIn = aspects[i] * baseH;
      const visW = r.anchored ? 1 : 1 - abs.cropFraction;
      const slack = 1 - visW;
      const offset = clamp(photos[i].cropOffset ?? 0, -1, 1);
      const sx = clamp(slack / 2 + (offset * slack) / 2, 0, slack);

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

  return { placements, warnings: warningsFor(placements, page, fit.scaled, anchoredPerRowWarning) };
}
