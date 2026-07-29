const HEIC_BRANDS = ['heic', 'heix', 'hevc', 'heim', 'heis', 'hevm', 'mif1'];

// Big enough to contain the APP1 EXIF segment, which JPEG caps at 64 KB, plus
// whatever small segments precede it.
const HEAD_BYTES = 128 * 1024;

// Chrome cannot decode HEIC and iPhone photos are commonly HEIC, so detect it
// by ftyp brand and say so plainly instead of failing with a broken image.
function isHeic(head) {
  const ascii = String.fromCharCode(...head.slice(4, 12));
  return ascii.startsWith('ftyp') && HEIC_BRANDS.some((b) => ascii.includes(b));
}

// The preview and the PNG export get EXIF rotation from the browser, but a PDF
// image XObject has no orientation concept and pdf-lib's JpegEmbedder reads only
// the SOF dimensions, so the PDF exporter has to be told. Total by construction:
// anything malformed yields 1 rather than throwing.
export function exifOrientation(head) {
  try {
    const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (dv.getUint16(0) !== 0xffd8) return 1;
    let p = 2;
    while (p + 4 <= dv.byteLength) {
      if (dv.getUint8(p) !== 0xff) return 1;
      const marker = dv.getUint8(p + 1);
      // Standalone markers carry no length; SOS means the entropy-coded image
      // data starts, so any EXIF would already have been seen.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { p += 2; continue; }
      if (marker === 0xda) return 1;
      const len = dv.getUint16(p + 2);
      if (len < 2) return 1;

      if (marker === 0xe1
          && dv.getUint32(p + 4) === 0x45786966   // "Exif"
          && dv.getUint16(p + 8) === 0) {         // "\0\0"
        const tiff = p + 10;
        const bo = dv.getUint16(tiff);
        if (bo !== 0x4949 && bo !== 0x4d4d) return 1;
        const le = bo === 0x4949;                 // "II" little-endian, "MM" big
        if (dv.getUint16(tiff + 2, le) !== 0x002a) return 1;
        const ifd0 = tiff + dv.getUint32(tiff + 4, le);
        const entries = dv.getUint16(ifd0, le);
        for (let i = 0; i < entries; i++) {
          const e = ifd0 + 2 + i * 12;
          if (dv.getUint16(e, le) !== 0x0112) continue;
          // A SHORT sits in the first two bytes of the four-byte value field.
          const v = dv.getUint16(e + 8, le);
          return v >= 1 && v <= 8 ? v : 1;
        }
        return 1;
      }
      p += 2 + len;
    }
  } catch {
    // Truncated or nonsense EXIF — treat it as unrotated.
  }
  return 1;
}

export async function ingestFiles(files) {
  const photos = [];
  const rejected = [];

  for (const file of files) {
    try {
      // Reading the file can itself fail — a OneDrive files-on-demand
      // placeholder that will not hydrate, or a file moved since the picker
      // closed — so it belongs inside the try. Outside it, one bad file
      // rejected the whole batch and the user saw nothing at all.
      const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
      if (isHeic(head)) {
        rejected.push(`${file.name}: HEIC is not supported by this browser. Convert to JPEG first.`);
        continue;
      }
      // An empty or unknown MIME still gets a decode attempt: Explorer
      // drag-drop supplies one for perfectly good JPEGs. createImageBitmap
      // rejects genuine non-images, so they land in rejected with a message
      // rather than being dropped silently.
      //
      // from-image applies EXIF rotation. Without it, phone portraits report
      // landscape dimensions and every aspect ratio on the sheet is wrong.
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      photos.push({
        // A UUID rather than a counter: a counter restarts at zero on reload
        // while loaded photos keep their saved ids, so the next photo added to
        // a reopened sheet collided and overwrote another photo's bytes.
        id: crypto.randomUUID(),
        blob: file,
        url: URL.createObjectURL(file),
        mime: file.type,
        orientation: exifOrientation(head),
        naturalW: bitmap.width,
        naturalH: bitmap.height,
        aspect: bitmap.width / bitmap.height,
        cropOffset: 0,
        pinned: false,
      });
      bitmap.close();
    } catch (e) {
      rejected.push(`${file.name}: could not be read or decoded${e?.name ? ` (${e.name})` : ''}.`);
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

  // Event listeners are the one place a rejected promise has nowhere to go, so
  // it becomes an unhandled rejection and the batch vanishes without a word.
  // Every other path in this app surfaces its failures; ingest now matches.
  const run = async (files) => {
    try {
      onResult(await ingestFiles(files));
    } catch (e) {
      console.error(e);
      alert(`Adding photos failed: ${e.message}`);
    }
  };

  pickButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    await run([...input.files]);
    input.value = '';
  });

  window.addEventListener('paste', async (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      await run(files);
    }
  });

  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  dropTarget.addEventListener('dragover', stop);
  dropTarget.addEventListener('drop', async (e) => {
    stop(e);
    await run([...e.dataTransfer.files]);
  });
}
