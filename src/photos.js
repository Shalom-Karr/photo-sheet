let seq = 0;

const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1'];

// Chrome cannot decode HEIC and iPhone photos are commonly HEIC, so detect it
// by ftyp brand and say so plainly instead of failing with a broken image.
async function isHeic(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...head.slice(4, 12));
  return ascii.startsWith('ftyp') && HEIC_BRANDS.some((b) => ascii.includes(b));
}

export async function ingestFiles(files) {
  const photos = [];
  const rejected = [];

  for (const file of files) {
    // Cache the HEIC check — calling it twice would be wasteful and the
    // second call is what actually decides whether we reject the file.
    const heic = await isHeic(file);
    if (!file.type.startsWith('image/') && !heic) continue;
    if (heic) {
      rejected.push(`${file.name}: HEIC is not supported by this browser. Convert to JPEG first.`);
      continue;
    }
    try {
      // from-image applies EXIF rotation. Without it, phone portraits report
      // landscape dimensions and every aspect ratio on the sheet is wrong.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      photos.push({
        id: `p${seq++}`,
        blob: file,
        url: URL.createObjectURL(file),
        mime: file.type,
        naturalW: bitmap.width,
        naturalH: bitmap.height,
        aspect: bitmap.width / bitmap.height,
        cropOffset: 0,
        pinned: false,
      });
      bitmap.close();
    } catch {
      rejected.push(`${file.name}: could not be decoded.`);
    }
  }
  return { photos, rejected };
}

export function attachIngest(dropTarget, pickButton, onResult) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);

  pickButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    onResult(await ingestFiles([...input.files]));
    input.value = '';
  });

  window.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      onResult(await ingestFiles(files));
    }
  });

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  dropTarget.addEventListener('dragover', stop);
  dropTarget.addEventListener('drop', async (e) => {
    stop(e);
    onResult(await ingestFiles([...e.dataTransfer.files]));
  });
}
