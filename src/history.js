const CAP = 50;
const COALESCE_MS = 600;

let now = () => Date.now();
export function setClock(fn) { now = fn; }

let past = [];
let future = [];
let lastKey = null;
let lastTime = -Infinity;

function snap(state) {
  return {
    photos: state.photos.map((p) => ({ ...p })),
    selectedId: state.selectedId,
  };
}

function apply(state, snapshot) {
  state.photos = snapshot.photos;
  const exists =
    snapshot.selectedId !== null &&
    snapshot.photos.some((p) => p.id === snapshot.selectedId);
  state.selectedId = exists ? snapshot.selectedId : null;
}

export function record(state, coalesceKey = null) {
  if (coalesceKey !== null && coalesceKey === lastKey && now() - lastTime < COALESCE_MS) {
    lastTime = now();
    return;
  }
  past.push(snap(state));
  if (past.length > CAP) past.shift();
  future = [];
  lastKey = coalesceKey;
  lastTime = now();
}

export function undo(state) {
  if (past.length === 0) return false;
  future.push(snap(state));
  const snapshot = past.pop();
  apply(state, snapshot);
  lastKey = null;
  return true;
}

export function redo(state) {
  if (future.length === 0) return false;
  past.push(snap(state));
  if (past.length > CAP) past.shift();
  const snapshot = future.pop();
  apply(state, snapshot);
  lastKey = null;
  return true;
}

export function clear() {
  past = [];
  future = [];
  lastKey = null;
  lastTime = -Infinity;
}

export function canUndo() { return past.length > 0; }
export function canRedo() { return future.length > 0; }
export function depth() { return { past: past.length, future: future.length }; }
