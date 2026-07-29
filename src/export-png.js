export async function renderCanvas(photos, placements, page, dpi = 300) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.widthIn * dpi);
  canvas.height = Math.round(page.heightIn * dpi);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const byId = new Map(photos.map((p) => [p.id, p]));

  for (const pl of placements) {
    const photo = byId.get(pl.photoId);
    if (!photo) continue;
    const bitmap = await createImageBitmap(photo.blob, { imageOrientation: 'from-image' });

    // srcRect is normalised, so scale it into source pixels.
    const sx = pl.srcRect.x * bitmap.width;
    const sy = pl.srcRect.y * bitmap.height;
    const sw = pl.srcRect.w * bitmap.width;
    const sh = pl.srcRect.h * bitmap.height;

    ctx.drawImage(
      bitmap, sx, sy, sw, sh,
      pl.xIn * dpi, pl.yIn * dpi, pl.wIn * dpi, pl.hIn * dpi,
    );
    bitmap.close();
  }
  return canvas;
}

export async function downloadPng(photos, placements, page, dpi = 300) {
  const canvas = await renderCanvas(photos, placements, page, dpi);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'photo-sheet.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
