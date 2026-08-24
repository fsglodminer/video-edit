// A registry of every media file the app has been shown.
// Doubles as the allowlist for the file-streaming endpoint.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, fileKey } from './storage.js';
import { inspect } from './media.js';

const INDEX = () => path.join(DIRS.cache, 'media-index.json');

let index = null;

function load() {
  if (index) return index;
  index = new Map();
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX(), 'utf8'));
    for (const item of raw.items || []) index.set(item.key, item);
  } catch {
    /* first run */
  }
  return index;
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DIRS.cache, { recursive: true });
      fs.writeFileSync(INDEX(), JSON.stringify({ items: [...load().values()] }, null, 0));
    } catch {
      /* cache is best-effort */
    }
  }, 250);
  saveTimer.unref?.();
}

export function get(key) {
  return load().get(key) || null;
}

export function all() {
  return [...load().values()];
}

export function isKnownPath(file) {
  const resolved = path.resolve(file);
  for (const item of load().values()) if (item.path === resolved) return true;
  // Anything the app itself wrote is fair game.
  return [DIRS.media, DIRS.exports, DIRS.cache, DIRS.tmp].some((dir) => resolved.startsWith(path.resolve(dir) + path.sep));
}

/** Probe a file (or reuse the cached probe) and register it. */
export async function register(file) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved)) throw Object.assign(new Error(`File not found: ${resolved}`), { code: 'ENOENT' });
  const key = fileKey(resolved);
  const existing = load().get(key);
  if (existing) return existing;
  const record = await inspect(resolved);
  load().set(record.key, record);
  persist();
  return record;
}

export function forget(key) {
  const removed = load().delete(key);
  if (removed) persist();
  return removed;
}

/** Re-point a media record at a new file after it moved (offline media relink). */
export async function relink(oldKey, newFile) {
  const record = await register(newFile);
  const previous = load().get(oldKey);
  if (previous) {
    load().delete(oldKey);
    persist();
  }
  return record;
}
