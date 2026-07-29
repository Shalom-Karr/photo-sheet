export function attachInteractions(container, state, rerender, currentScale) {
  let dragId = null;

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
    photo.targetHeightIn = null;
    rerender();
  }, true);

  // Right click removes.
  container.addEventListener('contextmenu', (e) => {
    const box = e.target.closest('[data-photo-id]');
    if (!box) return;
    e.preventDefault();
    const i = state.photos.findIndex((p) => p.id === box.dataset.photoId);
    if (i < 0) return;
    URL.revokeObjectURL(state.photos[i].url);
    state.photos.splice(i, 1);
    rerender();
  });
}
