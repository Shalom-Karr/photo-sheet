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
