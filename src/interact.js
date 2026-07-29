export function attachInteractions(container, state, rerender) {
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
