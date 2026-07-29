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

export function totalHeight(aspects, rows, contentW, gutterIn) {
  if (rows.length === 0) return 0;
  const sum = rows.reduce(
    (s, [a, b]) => s + rowHeight(aspects.slice(a, b), contentW, gutterIn),
    0,
  );
  return sum + (rows.length - 1) * gutterIn;
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
  const { pinned = [], ratioCap = 3, windowSteps = 160 } = opts;
  const n = aspects.length;
  if (n === 0) return { rows: [], heights: [] };

  // A row's height is bounded below by putting every photo in one row, and
  // above by the tallest single photo spanning the full width.
  const allInOne = rowHeight(aspects, contentW, gutterIn);
  const tallestSingle = Math.max(...aspects.map((a) => contentW / a));
  const loMin = Math.max(1e-6, Math.min(allInOne, tallestSingle));
  const loMax = Math.max(allInOne, tallestSingle, loMin);

  // A single photo can be taller than the whole page (a 2:3 portrait spanning
  // 8in is 12in tall). Clamping keeps it on the sheet; layout() centres any row
  // that is consequently not flush.
  const heightOf = (i, j) =>
    Math.min(rowHeight(aspects.slice(i, j), contentW, gutterIn), contentH);

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

  if (best) return { rows: best.rows, heights: best.heights };

  // No window admitted a fitting layout. Give each photo its own clamped row so
  // callers still get a well-formed result; the density warning will fire.
  const rows = aspects.map((_, i) => [i, i + 1]);
  return { rows, heights: rows.map(([a, b]) => heightOf(a, b)) };
}

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
