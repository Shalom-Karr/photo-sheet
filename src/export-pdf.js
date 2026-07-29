import {
  PDFDocument, pushGraphicsState, popGraphicsState,
  moveTo, lineTo, closePath, clip, endPath,
} from '../vendor/pdf-lib.esm.js';

const PT = 72;

// Embed a Photo into the PDF document, dispatching on MIME type.
// Non-JPEG/PNG formats (WebP, etc.) are re-encoded to PNG via canvas because
// pdf-lib only supports JPEG and PNG as image formats.
async function embedPhoto(doc, photo) {
  // A PDF image XObject has no orientation concept and pdf-lib's embedders
  // never look at EXIF, so a rotated photo embedded raw prints rotated — and
  // stretched, because the crop math divides by srcRect using the corrected
  // aspect against the uncorrected pixel grid. The canvas path below already
  // gets this right: Chrome applies EXIF when loading the <img> and again when
  // drawing it. Orientation 1 keeps the fast path and its original bytes.
  if ((photo.orientation ?? 1) === 1) {
    const bytes = new Uint8Array(await photo.blob.arrayBuffer());
    if (photo.mime === 'image/png') return doc.embedPng(bytes);
    if (photo.mime === 'image/jpeg') return doc.embedJpg(bytes);
  }
  // Fallback: re-encode through canvas. Quality loss is unavoidable, but
  // correctness (all photos appear) matters more than lossless embedding.
  const canvas = Object.assign(document.createElement('canvas'), {
    width: photo.naturalW,
    height: photo.naturalH,
  });
  const imgEl = new Image();
  imgEl.src = photo.url;
  await new Promise((res, rej) => {
    imgEl.onload = res;
    imgEl.onerror = () => rej(new Error(`Failed to load image ${photo.id} for canvas re-encode`));
  });
  canvas.getContext('2d').drawImage(imgEl, 0, 0);
  const pngBytes = await new Promise((res, rej) =>
    canvas.toBlob((b) => {
      if (!b) { rej(new Error(`canvas.toBlob returned null for photo ${photo.id}`)); return; }
      b.arrayBuffer().then((ab) => res(new Uint8Array(ab)), rej);
    }, 'image/png'));
  return doc.embedPng(pngBytes);
}

export async function buildPdf(photos, placements, page) {
  const doc = await PDFDocument.create();
  const pdfPage = doc.addPage([page.widthIn * PT, page.heightIn * PT]);
  const byId = new Map(photos.map((p) => [p.id, p]));
  // Cache embedded images so the same photo used twice is embedded once.
  const cache = new Map();

  for (const pl of placements) {
    const photo = byId.get(pl.photoId);
    if (!photo) continue;

    if (!cache.has(photo.id)) {
      cache.set(photo.id, await embedPhoto(doc, photo));
    }
    const img = cache.get(photo.id);

    const x = pl.xIn * PT;
    const w = pl.wIn * PT;
    const h = pl.hIn * PT;
    // PDF origin is bottom-left; placements are top-left.
    const y = (page.heightIn - pl.yIn - pl.hIn) * PT;

    // pdf-lib has no crop API. Clipping to the box and drawing the image
    // oversized is better than pre-cropping through a canvas: it keeps the
    // original JPEG bytes intact rather than re-encoding.
    const fullW = w / pl.srcRect.w;
    const fullH = h / pl.srcRect.h;
    const drawX = x - pl.srcRect.x * fullW;
    const drawY = y - (1 - pl.srcRect.y - pl.srcRect.h) * fullH;

    pdfPage.pushOperators(
      pushGraphicsState(),
      moveTo(x, y), lineTo(x + w, y), lineTo(x + w, y + h), lineTo(x, y + h),
      closePath(), clip(), endPath(),
    );
    pdfPage.drawImage(img, { x: drawX, y: drawY, width: fullW, height: fullH });
    pdfPage.pushOperators(popGraphicsState());
  }

  return doc.save();
}

function blobUrl(bytes) {
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
}

export async function downloadPdf(photos, placements, page, name = 'photo-sheet.pdf') {
  const url = blobUrl(await buildPdf(photos, placements, page));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  // Revoke after 10 s — enough for the browser to initiate the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// Print the PDF, never the DOM. Chrome's print path defaults to "fit to
// printable area" and silently rescales the page by a few percent, which would
// make every photo the wrong physical size.
export async function printPdf(photos, placements, page) {
  const url = blobUrl(await buildPdf(photos, placements, page));
  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  frame.src = url;
  frame.onload = () => {
    frame.contentWindow.print();
    // Remove the frame and revoke the blob URL after a generous delay so the
    // URL stays alive while the print dialog is open. 60 s is ample.
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
}
