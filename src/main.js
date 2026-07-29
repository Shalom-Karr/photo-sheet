import { layout, LETTER } from './layout.js';
import { renderPreview } from './preview.js';
import { attachIngest } from './photos.js';
import { downloadPdf, printPdf } from './export-pdf.js';
import { downloadPng } from './export-png.js';

export const state = {
  photos: [],
  page: { ...LETTER },
};

const sheet = document.getElementById('sheet');
const warningsEl = document.getElementById('warnings');
const countEl = document.getElementById('count');

export function rerender() {
  const { placements, warnings } = layout(state.photos, state.page);

  // Fit the sheet to the viewport without changing any inch-space value.
  const avail = sheet.parentElement.clientHeight - 48;
  const scale = Math.min(1, avail / (state.page.heightIn * 96));
  renderPreview(sheet, state.photos, placements, state.page, scale);

  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('p');
      li.textContent = w.message;
      return li;
    }),
  );
  countEl.textContent = `${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}`;
  return placements;
}

function bindSlider(id, labelId, toValue, key, fmt) {
  const el = document.getElementById(id);
  const label = document.getElementById(labelId);
  el.addEventListener('input', () => {
    state.page[key] = toValue(Number(el.value));
    label.textContent = fmt(state.page[key]);
    rerender();
  });
}

bindSlider('crop', 'cropVal', (v) => v / 100, 'cropTolerance', (v) => Math.round(v * 100));
bindSlider('gutter', 'gutVal', (v) => v / 100, 'gutterIn', (v) => v.toFixed(2));
bindSlider('minsize', 'minVal', (v) => v / 10, 'minPhotoIn', (v) => v.toFixed(1));
bindSlider('ratio', 'ratioVal', (v) => v / 10, 'ratioCap', (v) => v.toFixed(1));

attachIngest(document.body, document.getElementById('pick'), ({ photos, rejected }) => {
  state.photos.push(...photos);
  rerender();
  if (rejected.length) alert(rejected.join('\n'));
});

function exportHandler(label, fn) {
  return async () => {
    try {
      const { placements } = layout(state.photos, state.page);
      await fn(state.photos, placements, state.page);
    } catch (e) {
      console.error(e);
      alert(`${label} failed: ${e.message}`);
    }
  };
}

document.getElementById('pdf').addEventListener('click', exportHandler('PDF export', downloadPdf));
document.getElementById('png').addEventListener('click', exportHandler('PNG export', downloadPng));
document.getElementById('print').addEventListener('click', exportHandler('Print', printPdf));

rerender();
