import { layout, LETTER, PAGE_SIZES, applyPageSize } from './layout.js';
import { renderPreview } from './preview.js';
import { attachIngest } from './photos.js';
import { downloadPdf, printPdf } from './export-pdf.js';
import { downloadPng } from './export-png.js';
import { attachInteractions } from './interact.js';
import { saveProject, listProjects, loadProject } from './project.js';
import { record, clear, undo, redo, canUndo, canRedo } from './history.js';

export const state = {
  photos: [],
  page: { ...LETTER },
  manual: false,
  selectedId: null,
  pageCount: 1,
  currentPage: 0,
};

// Photos carry sheetPage; anything without one predates multi-page and belongs
// on the first sheet.
export function photosOnPage(index) {
  return state.photos.filter((p) => (p.sheetPage ?? 0) === index);
}

// Exported so every layout() call site shares one definition of what the
// toggle means. Suspending rather than clearing keeps the user's size.
export function photosForLayout(pageIndex = state.currentPage) {
  const onPage = photosOnPage(pageIndex);
  if (state.manual) return onPage;
  return onPage.map((p) =>
    p.targetHeightIn == null ? p : { ...p, targetHeightIn: null });
}

const sheet = document.getElementById('sheet');
const warningsEl = document.getElementById('warnings');
const countEl = document.getElementById('count');

let previewScale = 1;

export function rerender() {
  const { placements, warnings } = layout(photosForLayout(), state.page);
  document.getElementById('manual').checked = state.manual;

  // Fit the sheet to the viewport without changing any inch-space value.
  const avail = sheet.parentElement.clientHeight - 48;
  const scale = Math.min(1, avail / (state.page.heightIn * 96));
  previewScale = scale;
  renderPreview(sheet, state.photos, placements, state.page, scale, state.selectedId);

  warningsEl.replaceChildren(
    ...warnings.map((w) => {
      const li = document.createElement('p');
      li.textContent = w.message;
      return li;
    }),
  );
  const here = photosOnPage(state.currentPage).length;
  countEl.textContent = state.pageCount > 1
    ? `${here} on this page · ${state.photos.length} total`
    : `${state.photos.length} photo${state.photos.length === 1 ? '' : 's'}`;
  syncHistoryButtons();
  syncPages();
  return placements;
}

// The keyboard shortcuts in interact.js already call rerender(), so routing the
// button states through here keeps them correct however history changes -
// buttons, shortcuts, project load, or a fresh photo import.
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');

function syncHistoryButtons() {
  undoBtn.disabled = !canUndo();
  redoBtn.disabled = !canRedo();
}

undoBtn.addEventListener('click', () => { if (undo(state)) rerender(); });
redoBtn.addEventListener('click', () => { if (redo(state)) rerender(); });

// ---- pages -------------------------------------------------------------
const pageTabs = document.getElementById('pageTabs');
const addPageBtn = document.getElementById('addPage');
const movePageSel = document.getElementById('movePage');
const deletePageBtn = document.getElementById('deletePage');

function syncPages() {
  pageTabs.replaceChildren(
    ...Array.from({ length: state.pageCount }, (_, i) => {
      const b = document.createElement('button');
      const on = i === state.currentPage;
      b.textContent = String(i + 1);
      b.title = `Page ${i + 1} — ${photosOnPage(i).length} photo(s)`;
      b.className =
        'w-8 h-8 rounded text-sm transition ' +
        (on ? 'bg-sky-600 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-300');
      b.addEventListener('click', () => {
        state.currentPage = i;
        state.selectedId = null;
        rerender();
      });
      return b;
    }),
  );

  // Moving is only meaningful with a selection and somewhere to move it to.
  const sel = state.photos.find((p) => p.id === state.selectedId);
  movePageSel.disabled = !sel || state.pageCount < 2;
  movePageSel.replaceChildren(
    ...(() => {
      const opts = [Object.assign(document.createElement('option'),
        { value: '', textContent: sel ? 'Move selected to…' : 'Select a photo first' })];
      for (let i = 0; i < state.pageCount; i++) {
        if (i === state.currentPage) continue;
        opts.push(Object.assign(document.createElement('option'),
          { value: String(i), textContent: `Page ${i + 1}` }));
      }
      return opts;
    })(),
  );
  movePageSel.value = '';
  deletePageBtn.disabled = state.pageCount < 2;
}

addPageBtn.addEventListener('click', () => {
  record(state);
  state.pageCount += 1;
  state.currentPage = state.pageCount - 1;
  state.selectedId = null;
  rerender();
});

movePageSel.addEventListener('change', () => {
  const target = movePageSel.value;
  if (target === '') return;
  const photo = state.photos.find((p) => p.id === state.selectedId);
  if (!photo) return;
  record(state);
  photo.sheetPage = Number(target);
  // Follow the photo: landing on the page you sent it to is what makes this
  // feel like moving something rather than making it vanish.
  state.currentPage = Number(target);
  rerender();
});

deletePageBtn.addEventListener('click', () => {
  if (state.pageCount < 2) return;
  const doomed = state.currentPage;
  const onIt = photosOnPage(doomed).length;
  if (onIt && !confirm(`Delete page ${doomed + 1} and its ${onIt} photo(s)?`)) return;
  record(state);
  state.photos = state.photos
    .filter((p) => (p.sheetPage ?? 0) !== doomed)
    // Everything after the deleted page shifts down one.
    .map((p) => ((p.sheetPage ?? 0) > doomed ? { ...p, sheetPage: p.sheetPage - 1 } : p));
  state.pageCount -= 1;
  state.currentPage = Math.min(doomed, state.pageCount - 1);
  state.selectedId = null;
  rerender();
});

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
bindSlider('maxsize', 'maxVal', (v) => v / 10, 'maxPhotoIn', (v) => v.toFixed(1));
bindSlider('ratio', 'ratioVal', (v) => v / 10, 'ratioCap', (v) => v.toFixed(1));

function perRowLabel(min, max) {
  if (min <= 1 && max === 0) return 'any';
  if (max === 0) return `${min}+`;
  if (min === max) return String(min);
  return `${min}–${max}`;
}

function updatePerRow() {
  const minRaw = Math.max(1, Math.min(8, parseInt(document.getElementById('minPerRow').value) || 1));
  const maxRaw = Math.max(0, Math.min(8, parseInt(document.getElementById('maxPerRow').value) || 0));
  const inverted = maxRaw > 0 && minRaw > maxRaw;
  state.page.minPerRow = inverted ? 1 : minRaw;
  state.page.maxPerRow = inverted ? 0 : maxRaw;
  document.getElementById('perRowVal').textContent = perRowLabel(state.page.minPerRow, state.page.maxPerRow);
  rerender();
}

document.getElementById('minPerRow').addEventListener('input', updatePerRow);
document.getElementById('maxPerRow').addEventListener('input', updatePerRow);

document.getElementById('manual').addEventListener('change', (e) => {
  state.manual = e.target.checked;
  rerender();
});

// ---- page size ---------------------------------------------------------
const pageSizeEl = document.getElementById('pageSize');
const landscapeEl = document.getElementById('landscape');
const marginEl = document.getElementById('margin');
const marginValEl = document.getElementById('marginVal');

pageSizeEl.replaceChildren(
  ...Object.entries(PAGE_SIZES).map(([key, size]) => {
    const o = document.createElement('option');
    o.value = key;
    o.textContent = size.label;
    return o;
  }),
);

/** Which preset matches the current page, in either orientation. */
function currentSizeKey(page) {
  const w = Math.round(page.widthIn * 100);
  const h = Math.round(page.heightIn * 100);
  for (const [key, s] of Object.entries(PAGE_SIZES)) {
    const sw = Math.round(s.widthIn * 100);
    const sh = Math.round(s.heightIn * 100);
    if ((w === sw && h === sh) || (w === sh && h === sw)) return key;
  }
  return null;
}

function applyPage() {
  state.page = applyPageSize(state.page, pageSizeEl.value, landscapeEl.checked);
  syncPageControls(state.page);
  rerender();
}

function syncPageControls(page) {
  const key = currentSizeKey(page);
  if (key) pageSizeEl.value = key;
  landscapeEl.checked = page.widthIn > page.heightIn;
  marginEl.value = Math.round(page.marginIn * 100);
  marginValEl.textContent = page.marginIn.toFixed(2);
  // The max-size slider tops out at the page's long edge, so the control stays
  // meaningful on a 4x6 instead of spending most of its travel out of range.
  const maxEl = document.getElementById('maxsize');
  maxEl.max = Math.round(Math.max(page.widthIn, page.heightIn) * 10);
  if (Number(maxEl.value) > Number(maxEl.max)) {
    maxEl.value = maxEl.max;
    document.getElementById('maxVal').textContent = (Number(maxEl.max) / 10).toFixed(1);
  }
}

pageSizeEl.addEventListener('change', applyPage);
landscapeEl.addEventListener('change', applyPage);

marginEl.addEventListener('input', () => {
  state.page.marginIn = Number(marginEl.value) / 100;
  marginValEl.textContent = state.page.marginIn.toFixed(2);
  rerender();
});

attachInteractions(sheet, state, rerender, () => previewScale);

attachIngest(document.body, document.getElementById('pick'), ({ photos, rejected }) => {
  record(state);
  // New photos land on the page you are looking at, not always the first.
  state.photos.push(...photos.map((p) => ({ ...p, sheetPage: state.currentPage })));
  rerender();
  if (rejected.length) alert(rejected.join('\n'));
});

// PDF gets every page; PNG is a single canvas, so it exports the visible one.
function exportHandler(label, fn, allPages = false) {
  return async () => {
    try {
      const placements = allPages
        ? Array.from({ length: state.pageCount },
            (_, i) => layout(photosForLayout(i), state.page).placements)
        : layout(photosForLayout(), state.page).placements;
      await fn(state.photos, placements, state.page);
    } catch (e) {
      console.error(e);
      alert(`${label} failed: ${e.message}`);
    }
  };
}

document.getElementById('pdf').addEventListener('click', exportHandler('PDF export', downloadPdf, true));
document.getElementById('png').addEventListener('click', exportHandler('PNG export', downloadPng));
document.getElementById('print').addEventListener('click', exportHandler('Print', printPdf, true));

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
  document.getElementById('maxsize').value = Math.round(page.maxPhotoIn * 10);
  document.getElementById('maxVal').textContent = page.maxPhotoIn.toFixed(1);
  document.getElementById('ratio').value = Math.round(page.ratioCap * 10);
  document.getElementById('ratioVal').textContent = page.ratioCap.toFixed(1);
  const min = page.minPerRow ?? 1;
  const max = page.maxPerRow ?? 0;
  document.getElementById('minPerRow').value = min;
  document.getElementById('maxPerRow').value = max;
  document.getElementById('perRowVal').textContent = perRowLabel(min, max);
  syncPageControls(page);
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
    state.manual = loaded.manual;
    state.pageCount = loaded.pageCount ?? 1;
    state.currentPage = 0;
    state.selectedId = null;
    clear();
    rerender();
  } catch (e) {
    alert(`Load failed: ${e.message}`);
  }
});

refreshProjects();

syncPageControls(state.page);
rerender();
