// Renders inch-space placements at a screen scale. The sheet element is sized
// in pixels from the same page spec the PDF uses, so what you see is what prints.
export const SCREEN_DPI = 96;

export function renderPreview(container, photos, placements, page, scale = 1) {
  const px = SCREEN_DPI * scale;
  container.style.width = `${page.widthIn * px}px`;
  container.style.height = `${page.heightIn * px}px`;
  container.replaceChildren();

  const byId = new Map(photos.map((p) => [p.id, p]));

  for (const pl of placements) {
    const photo = byId.get(pl.photoId);
    if (!photo) continue;

    const box = document.createElement('div');
    box.className = 'absolute overflow-hidden bg-slate-200';
    box.dataset.photoId = pl.photoId;
    box.draggable = true;
    box.classList.add('cursor-move', 'ring-0', 'hover:ring-2', 'ring-sky-400');
    if (byId.get(pl.photoId)?.pinned) box.classList.add('ring-2', 'ring-amber-400');
    box.style.left = `${pl.xIn * px}px`;
    box.style.top = `${pl.yIn * px}px`;
    box.style.width = `${pl.wIn * px}px`;
    box.style.height = `${pl.hIn * px}px`;

    const img = document.createElement('img');
    img.src = photo.url;
    img.draggable = false;
    img.className = 'pointer-events-none select-none';
    // Scale the source so srcRect fills the box, then offset to that window.
    img.style.position = 'absolute';
    img.style.width = `${(pl.wIn / pl.srcRect.w) * px}px`;
    img.style.height = `${(pl.hIn / pl.srcRect.h) * px}px`;
    img.style.left = `${-pl.srcRect.x * (pl.wIn / pl.srcRect.w) * px}px`;
    img.style.top = `${-pl.srcRect.y * (pl.hIn / pl.srcRect.h) * px}px`;

    box.appendChild(img);

    // Five handles, all setting one anchor: width and height are locked
    // together by aspect ratio, so an edge drag and a corner drag are the
    // same constraint expressed on different axes.
    const anchored = !!byId.get(pl.photoId)?.targetHeightIn;
    for (const [edge, cls] of [
      ['left',   'left-0 top-0 h-full w-1 cursor-ew-resize'],
      ['right',  'right-0 top-0 h-full w-1 cursor-ew-resize'],
      ['top',    'top-0 left-0 w-full h-1 cursor-ns-resize'],
      ['bottom', 'bottom-0 left-0 w-full h-1 cursor-ns-resize'],
      ['corner', 'bottom-0 right-0 w-3 h-3 cursor-nwse-resize'],
    ]) {
      const h = document.createElement('div');
      h.dataset.resize = pl.photoId;
      h.dataset.edge = edge;
      h.className =
        `absolute ${cls} transition-opacity ` +
        (anchored ? 'bg-emerald-400 opacity-90' : 'bg-sky-400 opacity-0 hover:opacity-90');
      box.appendChild(h);
    }

    container.appendChild(box);
  }
}
