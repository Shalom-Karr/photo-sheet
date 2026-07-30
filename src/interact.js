import { record, undo, redo } from './history.js';

const typing = (t) =>
  t instanceof HTMLElement &&
  (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function attachInteractions(container, state, rerender, currentScale) {
  let dragId = null;

  function removePhoto(id) {
    const i = state.photos.findIndex((p) => p.id === id);
    if (i < 0) return;
    // Do not revoke the object URL here: undo restores this photo and a
    // revoked URL is permanently dead. The blob is what holds the memory.
    record(state);
    state.photos.splice(i, 1);
    if (state.selectedId === id) {
      state.selectedId = state.photos.length > 0
        ? state.photos[Math.min(i, state.photos.length - 1)].id
        : null;
    }
    rerender();
  }

  container.addEventListener('dragstart', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    dragId = box.dataset.photoId;
    e.dataTransfer.effectAllowed = 'move';
    // Firefox requires data to be set or the drag never starts.
    e.dataTransfer.setData('text/plain', dragId);
  });

  container.addEventListener('dragend', () => { dragId = null; });

  container.addEventListener('dragover', (e) => {
    if (dragId) e.preventDefault();
  });

  container.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const box = e.target.closest('[data-photo-id]');
    if (!box || box.dataset.photoId === dragId) { dragId = null; return; }

    const from = state.photos.findIndex((p) => p.id === dragId);
    const to = state.photos.findIndex((p) => p.id === box.dataset.photoId);
    if (from < 0 || to < 0) { dragId = null; return; }

    record(state);
    const [moved] = state.photos.splice(from, 1);
    state.photos.splice(to, 0, moved);
    dragId = null;
    rerender();
  });

  // Double click pins: the photo takes a row alone, at full content width.
  container.addEventListener('dblclick', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    const photo = state.photos.find((p) => p.id === box.dataset.photoId);
    if (!photo) return;
    record(state);
    photo.pinned = !photo.pinned;
    rerender();
  });

  // Shift+wheel nudges the crop window of a cropped photo.
  container.addEventListener('wheel', (e) => {
    if (!e.shiftKey) return;
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    const photo = state.photos.find((p) => p.id === box.dataset.photoId);
    if (!photo) return;
    e.preventDefault();
    record(state, `crop:${photo.id}`);
    photo.cropOffset = Math.max(-1, Math.min(1, (photo.cropOffset ?? 0) + Math.sign(e.deltaY) * 0.1));
    rerender();
  }, { passive: false });

  // Pointer events, not HTML5 drag-and-drop, so a resize can never be
  // confused with the reorder drag or the file-ingest drop.
  container.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();

    const photo = state.photos.find((p) => p.id === handle.dataset.resize);
    if (!photo) return;
    const edge = handle.dataset.edge;
    const box = handle.closest('[data-photo-id]');
    const rect = box.getBoundingClientRect();

    // Record once at drag start, before clearing other anchors. Never inside
    // pointermove — a drag fires dozens of moves and each must not be a step.
    record(state, `resize:${photo.id}`);

    // One anchor at a time, and anchoring is not pinning.
    for (const p of state.photos) if (p !== photo) p.targetHeightIn = null;
    photo.pinned = false;

    const startX = e.clientX;
    const startY = e.clientY;
    const pxPerIn = 96 * currentScale();
    const startW = rect.width / pxPerIn;
    const startH = rect.height / pxPerIn;

    let queued = false;
    let pending = null;

    // Re-solving costs 0.63ms at 12 photos but 8.52ms at 30, dominated by the
    // solver's window sweep. Coalescing into one frame keeps the drag smooth.
    const flush = () => {
      queued = false;
      if (pending == null) return;
      photo.targetHeightIn = pending;
      state.manual = true;
      rerender();
    };

    const move = (ev) => {
      const dxIn = (ev.clientX - startX) / pxPerIn;
      const dyIn = (ev.clientY - startY) / pxPerIn;

      let targetH;
      if (edge === 'left' || edge === 'right') {
        const w = edge === 'right' ? startW + dxIn : startW - dxIn;
        targetH = w / photo.aspect;
      } else if (edge === 'top' || edge === 'bottom') {
        targetH = edge === 'bottom' ? startH + dyIn : startH - dyIn;
      } else {
        // Corner: follow whichever axis the pointer moved further along.
        targetH = Math.abs(dxIn) > Math.abs(dyIn)
          ? (startW + dxIn) / photo.aspect
          : startH + dyIn;
      }

      pending = Math.max(0.1, targetH);
      if (!queued) { queued = true; requestAnimationFrame(flush); }
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      flush();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  // Double-clicking any handle releases the anchor. Capture and
  // stopPropagation are both required: the box's own dblclick toggles
  // pinning, so without them the release would also pin the photo.
  container.addEventListener('dblclick', (e) => {
    const handle = e.target.closest('[data-resize]');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    const photo = state.photos.find((p) => p.id === handle.dataset.resize);
    if (!photo) return;
    record(state);
    photo.targetHeightIn = null;
    rerender();
  }, true);

  // Right click removes.
  container.addEventListener('contextmenu', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    e.preventDefault();
    removePhoto(box.dataset.photoId);
  });

  // Click on a photo box selects it; click on the sheet background clears selection.
  // Clicks that land on a resize handle are ignored — pointerdown already starts
  // a resize there and we must not let the bubbled click disturb the selection.
  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-resize]')) return;
    const box = e.target.closest('[data-photo-id]');
    state.selectedId = box ? box.dataset.photoId : null;
    rerender();
  });

  // Backspace / Delete removes the selected photo; Escape clears selection.
  // Ctrl+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo.
  // Registered on window so it works without the sheet being focusable.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.selectedId = null;
      rerender();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      if (typing(e.target)) return;
      if (!state.selectedId) return;
      e.preventDefault();
      removePhoto(state.selectedId);
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key === 'z' && !e.shiftKey) {
      if (typing(e.target)) return;
      e.preventDefault();
      if (undo(state)) rerender();
      return;
    }
    if (ctrl && (e.key === 'Z' || e.key === 'y')) {
      if (typing(e.target)) return;
      e.preventDefault();
      if (redo(state)) rerender();
    }
  });
}
