// Browsers cannot re-read arbitrary local paths on reopen, so photo bytes are
// copied into OPFS at save time and the manifest references them by id.
// Reopening on the same machine then works with no re-picking.
const DIR = 'photo-sheet';

function assertOpfs() {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) {
    throw new Error('Origin Private File System (OPFS) is not supported in this browser.');
  }
}

function validateName(name) {
  if (!name || !name.trim()) throw new Error('Sheet name must not be empty.');
  // Path-hostile characters that would break getDirectoryHandle or the FS.
  if (/[/\\:*?"<>|\x00]/.test(name)) {
    throw new Error('Sheet name must not contain / \\ : * ? " < > | or null bytes.');
  }
}

async function root() {
  assertOpfs();
  const opfs = await navigator.storage.getDirectory();
  return opfs.getDirectoryHandle(DIR, { create: true });
}

async function writeBlob(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

export async function saveProject(state, name) {
  validateName(name);
  const dir = await root();
  // getDirectoryHandle with create:true silently overwrites an existing project.
  const projDir = await dir.getDirectoryHandle(name, { create: true });

  const manifest = {
    version: 1,
    page: state.page,
    manual: state.manual,
    photos: state.photos.map((p) => ({
      id: p.id,
      file: `${p.id}.bin`,
      mime: p.mime,
      // Without this a reopened sheet loses EXIF orientation and the PDF
      // exporter reintroduces the rotated-and-stretched bug.
      orientation: p.orientation ?? 1,
      naturalW: p.naturalW,
      naturalH: p.naturalH,
      aspect: p.aspect,
      cropOffset: p.cropOffset,
      pinned: p.pinned,
      targetHeightIn: p.targetHeightIn ?? null,
      // Which sheet page this photo sits on. Absent in v1 manifests, where
      // everything was implicitly page 0.
      sheetPage: p.sheetPage ?? 0,
    })),
    pageCount: state.pageCount ?? 1,
  };

  for (const p of state.photos) await writeBlob(projDir, `${p.id}.bin`, p.blob);
  await writeBlob(
    projDir,
    'manifest.json',
    new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }),
  );
}

export async function listProjects() {
  try {
    const dir = await root();
    const names = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') names.push(name);
    }
    return names.sort();
  } catch {
    // OPFS unavailable or no projects yet — return empty list rather than throwing.
    return [];
  }
}

export async function loadProject(name) {
  validateName(name);
  const dir = await root();
  const projDir = await dir.getDirectoryHandle(name);
  const mf = await (await projDir.getFileHandle('manifest.json')).getFile();
  const manifest = JSON.parse(await mf.text());

  const photos = [];
  for (const meta of manifest.photos) {
    const file = await (await projDir.getFileHandle(meta.file)).getFile();
    const blob = new Blob([await file.arrayBuffer()], { type: meta.mime });
    // Default first so a manifest written before orientation existed loads as
    // unrotated rather than undefined.
    photos.push({ orientation: 1, targetHeightIn: null, sheetPage: 0, ...meta, blob, url: URL.createObjectURL(blob) });
  }
  // Spread defaults first so old saved sheets missing newer fields get them.
  // Derive the count from the photos too, so a manifest that lost pageCount
  // still opens with every page intact rather than orphaning photos.
  const highest = photos.reduce((m, p) => Math.max(m, p.sheetPage ?? 0), 0);
  const pageCount = Math.max(manifest.pageCount ?? 1, highest + 1);
  return {
    page: { maxPhotoIn: 11, ...manifest.page },
    photos,
    manual: manifest.manual ?? false,
    pageCount,
  };
}
