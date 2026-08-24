// Where JumpCut keeps projects, imported media, caches and exports.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const HOME = process.env.JUMPCUT_HOME || path.join(os.homedir(), 'JumpCut');

export const DIRS = {
  home: HOME,
  media: path.join(HOME, 'media'),
  projects: path.join(HOME, 'projects'),
  cache: path.join(HOME, 'cache'),
  exports: path.join(HOME, 'exports'),
  fonts: path.join(HOME, 'fonts'),
  tmp: path.join(HOME, 'tmp'),
};

export function ensureDirs() {
  for (const dir of Object.values(DIRS)) fs.mkdirSync(dir, { recursive: true });
  return DIRS;
}

export const id = (prefix = '') => `${prefix}${crypto.randomBytes(8).toString('hex')}`;

export function safeName(name) {
  return String(name || 'untitled')
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

/** Stable cache key for a file, cheap enough to run on every import. */
export function fileKey(file) {
  try {
    const st = fs.statSync(file);
    return crypto.createHash('sha1').update(`${path.resolve(file)}:${st.size}:${st.mtimeMs}`).digest('hex');
  } catch {
    return crypto.createHash('sha1').update(String(file)).digest('hex');
  }
}

export function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = path.join(dir, filename);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

/** Fonts drawtext/ass can use: bundled first, then anything the OS ships. */
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/System/Library/Fonts/SFNS.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  '/usr/share/fonts/TTF/DejaVuSans.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans.ttf',
  '/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf',
  'C:\\Windows\\Fonts\\arial.ttf',
  'C:\\Windows\\Fonts\\segoeui.ttf',
];

function scanDir(dir, depth = 0) {
  const found = [];
  if (depth > 3) return found;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) found.push(...scanDir(full, depth + 1));
    else if (/\.(ttf|otf|ttc)$/i.test(e.name)) found.push(full);
    if (found.length > 400) break;
  }
  return found;
}

let fontCache = null;
export function listFonts() {
  if (fontCache) return fontCache;
  const bundled = path.join(process.cwd(), 'assets', 'fonts');
  const dirs = [DIRS.fonts, bundled, '/usr/share/fonts', '/usr/local/share/fonts', path.join(os.homedir(), '.fonts'), path.join(os.homedir(), 'Library/Fonts'), '/Library/Fonts', 'C:\\Windows\\Fonts'];
  const seen = new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of scanDir(dir)) {
      const name = path.basename(file).replace(/\.(ttf|otf|ttc)$/i, '');
      if (!seen.has(name)) seen.set(name, { name, path: file });
    }
  }
  fontCache = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  return fontCache;
}

let defaultFont;
export function defaultFontFile() {
  if (defaultFont !== undefined) return defaultFont;
  if (process.env.JUMPCUT_FONT && fs.existsSync(process.env.JUMPCUT_FONT)) {
    defaultFont = process.env.JUMPCUT_FONT;
    return defaultFont;
  }
  const bundledDir = path.join(process.cwd(), 'assets', 'fonts');
  if (fs.existsSync(bundledDir)) {
    const bundled = scanDir(bundledDir).sort();
    // Prefer a regular weight when several are bundled.
    const regular = bundled.find((f) => /regular|-r\b/i.test(path.basename(f))) || bundled[0];
    if (regular) {
      defaultFont = regular;
      return defaultFont;
    }
  }
  for (const c of FONT_CANDIDATES) {
    if (fs.existsSync(c)) {
      defaultFont = c;
      return defaultFont;
    }
  }
  const any = listFonts()[0];
  defaultFont = any ? any.path : null;
  return defaultFont;
}

export function resolveFont(nameOrPath) {
  if (!nameOrPath) return defaultFontFile();
  if (fs.existsSync(nameOrPath)) return nameOrPath;
  const match = listFonts().find((f) => f.name.toLowerCase() === String(nameOrPath).toLowerCase());
  return match ? match.path : defaultFontFile();
}
