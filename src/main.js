import { layout, LETTER } from './layout.js';
import { renderPreview } from './preview.js';
import { attachIngest } from './photos.js';
import { downloadPdf, printPdf } from './export-pdf.js';
import { downloadPng } from './export-png.js';
import { attachInteractions } from './interact.js';
import { saveProject, listProjects, loadProject } from './project.js';

export const state = {
  photos: [],
  page: { ...LETTER },
};

const sheet = document.getElementById('sheet');
const warningsEl = document.getElementById('warnings');
const countEl = document.getElementById('count');

let previewScale = 1;

export function rerender() {
  const { placements, warnings } = layout(state.photos, state.page);

  // Fit the sheet to the viewport without changing any inch-space value.
  const avail = sheet.parentElement.clientHeight - 48;
  const scale = Math.min(1, avail / (state.page.heightIn * 96));
  previewScale = scale;
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

attachInteractions(sheet, state, rerender, () => previewScale);

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

const projList = document.getElementById('projList');

// Sync slider positions and their displayed labels to the current state.page.
// Called after loading a project so the next slider drag does not jump.
function syncSliders(page) {
  document.getElementById('crop').value = Math.round(page.cropTolerance * 100);
  document.getElementById('cropVal').textContent = Math.round(page.cropTolerance * 100);
  document.getElementById('gutter').value = Math.round(page.gutterIn * 100);
  document.getElementById('gutVal').textContent = page.gutterIn.toFixed(2);
  document.getElementById('minsize').value = Math.round(page.minPhotoIn * 10);
  document.getElementById('minVal').textContent = page.minPhotoIn.toFixed(1);
  document.getElementById('ratio').value = Math.round(page.ratioCap * 10);
  document.getElementById('ratioVal').textContent = page.ratioCap.toFixed(1);
}

async function refreshProjects() {
  const names = await listProjects();
  projList.replaceChildren(
    ...names.map((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      return o;
    }),
  );
}

document.getElementById('save').addEventListener('click', async () => {
  const name = document.getElementById('projName').value.trim();
  if (!name) return alert('Name the sheet first.');
  try {
    await saveProject(state, name);
    await refreshProjects();
  } catch (e) {
    alert(`Save failed: ${e.message}`);
  }
});

document.getElementById('load').addEventListener('click', async () => {
  if (!projList.value) return;
  try {
    const loaded = await loadProject(projList.value);
    // syncSliders can throw on a malformed manifest, so it runs before the
    // commit. Revoking the old URLs first left the preview showing photos whose
    // blobs had just been freed — broken images on top of the error.
    syncSliders(loaded.page);
    state.photos.forEach((p) => URL.revokeObjectURL(p.url));
    state.photos = loaded.photos;
    state.page = loaded.page;
    rerender();
  } catch (e) {
    alert(`Load failed: ${e.message}`);
  }
});

refreshProjects();

rerender();
