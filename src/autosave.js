// Automatic version history, so closing the tab never loses work.
//
// Storage shape, inside OPFS alongside the named projects:
//
//   photo-sheet/_versions/blobs/<photoId>.bin     photo bytes, written once
//   photo-sheet/_versions/v<timestamp>.json       one manifest per version
//
// Versions share the blob pool. A manifest is a few hundred bytes of metadata,
// so keeping 20 of them costs almost nothing even with heavy photos - copying
// the bytes per version would multiply a 40MB sheet by 20.

const DIR = 'photo-sheet';
const VERSIONS = '_versions';
const BLOBS = 'blobs';
const KEEP = 20;

async function root() {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null;
  const opfs = await navigator.storage.getDirectory();
  const base = await opfs.getDirectoryHandle(DIR, { create: true });
  return base.getDirectoryHandle(VERSIONS, { create: true });
}

async function blobDir(dir) {
  return dir.getDirectoryHandle(BLOBS, { create: true });
}

async function writeBlob(dir, name, blob) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
}

async function exists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

function metaOf(state) {
  return {
    version: 1,
    savedAt: new Date().toISOString(),
    page: state.page,
    manual: state.manual,
    pageCount: state.pageCount ?? 1,
    photos: state.photos.map((p) => ({
      id: p.id,
      file: `${p.id}.bin`,
      mime: p.mime,
      orientation: p.orientation ?? 1,
      naturalW: p.naturalW,
      naturalH: p.naturalH,
      aspect: p.aspect,
      cropOffset: p.cropOffset,
      pinned: p.pinned,
      targetHeightIn: p.targetHeightIn ?? null,
      sheetPage: p.sheetPage ?? 0,
    })),
  };
}

/**
 * Write a version. Blobs already in the pool are skipped, so a snapshot after
 * nudging one photo writes only the manifest.
 */
export async function snapshot(state) {
  const dir = await root();
  if (!dir) return null;
  if (!state.photos.length) return null; // nothing to recover

  const blobs = await blobDir(dir);
  for (const p of state.photos) {
    const name = `${p.id}.bin`;
    if (!(await exists(blobs, name))) await writeBlob(blobs, name, p.blob);
  }

  const manifest = metaOf(state);
  const name = `v${Date.now()}.json`;
  await writeBlob(dir, name,
    new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
  await prune(dir);
  return name;
}

export async function listVersions() {
  const dir = await root();
  if (!dir) return [];
  const out = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind !== 'file' || !name.startsWith('v') || !name.endsWith('.json')) continue;
    try {
      const m = JSON.parse(await (await handle.getFile()).text());
      out.push({
        name,
        savedAt: m.savedAt,
        photoCount: m.photos.length,
        pageCount: m.pageCount ?? 1,
      });
    } catch {
      // A half-written manifest from a interrupted save: ignore it rather than
      // letting one bad file hide every good version.
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

export async function restoreVersion(name) {
  const dir = await root();
  if (!dir) throw new Error('No version storage available.');
  const m = JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
  const blobs = await blobDir(dir);

  const photos = [];
  for (const meta of m.photos) {
    const file = await (await blobs.getFileHandle(meta.file)).getFile();
    const blob = new Blob([await file.arrayBuffer()], { type: meta.mime });
    photos.push({ orientation: 1, targetHeightIn: null, sheetPage: 0, ...meta, blob, url: URL.createObjectURL(blob) });
  }
  const highest = photos.reduce((mx, p) => Math.max(mx, p.sheetPage ?? 0), 0);
  return {
    page: { maxPhotoIn: 11, ...m.page },
    photos,
    manual: m.manual ?? false,
    pageCount: Math.max(m.pageCount ?? 1, highest + 1),
  };
}

/**
 * Keep the newest KEEP manifests and delete any blob no surviving version
 * references. Without the sweep the pool grows forever as photos are removed.
 */
async function prune(dir) {
  const names = [];
  for await (const [name, handle] of dir.entries()) {
    if (handle.kind === 'file' && name.startsWith('v') && name.endsWith('.json')) names.push(name);
  }
  names.sort((a, b) => b.localeCompare(a));
  for (const stale of names.slice(KEEP)) {
    await dir.removeEntry(stale).catch(() => {});
  }

  const live = new Set();
  for (const name of names.slice(0, KEEP)) {
    try {
      const m = JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
      m.photos.forEach((p) => live.add(p.file));
    } catch { /* skip unreadable manifest */ }
  }
  const blobs = await blobDir(dir);
  for await (const [name, handle] of blobs.entries()) {
    if (handle.kind === 'file' && !live.has(name)) {
      await blobs.removeEntry(name).catch(() => {});
    }
  }
}

export async function clearVersions() {
  const dir = await root();
  if (!dir) return;
  for await (const [name] of dir.entries()) {
    await dir.removeEntry(name, { recursive: true }).catch(() => {});
  }
}
