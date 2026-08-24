// Project files: plain JSON on disk, one file per project, with a rolling backup.
import fs from 'node:fs';
import path from 'node:path';
import { DIRS, id, safeName } from './storage.js';
import { projectDuration, DEFAULT_SETTINGS } from './compile.js';

const SCHEMA_VERSION = 1;

const file = (projectId) => path.join(DIRS.projects, `${projectId}.json`);

export function blankProject(name = 'Untitled project', overrides = {}) {
  const now = Date.now();
  // Pull `settings` out first: spreading `overrides` wholesale would let an
  // explicit `undefined` wipe the defaults we just built.
  const { settings: settingsOverride, ...rest } = overrides || {};
  const project = {
    id: id('p_'),
    schemaVersion: SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    settings: { ...DEFAULT_SETTINGS, ...(settingsOverride || {}) },
    media: [],
    tracks: [
      { id: id('t_'), kind: 'video', name: 'V2', role: 'overlay', clips: [], hidden: false, locked: false, volume: 1 },
      { id: id('t_'), kind: 'video', name: 'V1', role: 'main', clips: [], hidden: false, locked: false, volume: 1 },
      { id: id('t_'), kind: 'audio', name: 'A1 Voice', role: 'voice', clips: [], muted: false, locked: false, volume: 1 },
      { id: id('t_'), kind: 'audio', name: 'A2 Music', role: 'music', clips: [], muted: false, locked: false, volume: 0.35 },
    ],
    captions: {
      enabled: false,
      items: [],
      style: {
        fontName: null,
        size: 54,
        color: '#ffffff',
        outlineColor: '#000000',
        outline: 3,
        shadow: 1,
        boxed: false,
        boxColor: '#000000',
        position: 'bottom',
        marginV: 120,
        bold: true,
      },
    },
    audio: {
      masterVolume: 1,
      normalize: true,
      loudnessTarget: -14,
      ducking: { enabled: true, amount: 0.7, attack: 20, release: 350 },
    },
    watermark: { enabled: false, path: null, position: 'bottom-right', size: 0.12, margin: 0.03, opacity: 0.8 },
    brandKit: {
      colors: ['#6b4dff', '#ff5a5f', '#22c9a0', '#ffb020', '#0b1020', '#ffffff'],
      font: null,
      logoPath: null,
    },
  };
  for (const [key, value] of Object.entries(rest)) {
    if (value !== undefined) project[key] = value;
  }
  return project;
}

export function list() {
  fs.mkdirSync(DIRS.projects, { recursive: true });
  return fs
    .readdirSync(DIRS.projects)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.bak.json'))
    .map((f) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(DIRS.projects, f), 'utf8'));
        return {
          id: p.id,
          name: p.name,
          updatedAt: p.updatedAt,
          createdAt: p.createdAt,
          duration: projectDuration(p),
          clipCount: (p.tracks || []).reduce((n, t) => n + (t.clips?.length || 0), 0),
          settings: p.settings,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function read(projectId) {
  const target = file(projectId);
  if (!fs.existsSync(target)) return null;
  return migrate(JSON.parse(fs.readFileSync(target, 'utf8')));
}

export function write(project) {
  fs.mkdirSync(DIRS.projects, { recursive: true });
  const target = file(project.id);
  if (fs.existsSync(target)) {
    try {
      fs.copyFileSync(target, target.replace(/\.json$/, '.bak.json'));
    } catch {
      /* backup is best-effort */
    }
  }
  const payload = { ...project, schemaVersion: SCHEMA_VERSION, updatedAt: Date.now() };
  // Write to a temp file first so a crash mid-save can't truncate the project.
  const tmp = `${target}.writing`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, target);
  return payload;
}

export function remove(projectId) {
  for (const suffix of ['.json', '.bak.json']) {
    const target = path.join(DIRS.projects, `${projectId}${suffix}`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
  return true;
}

export function duplicate(projectId, name) {
  const original = read(projectId);
  if (!original) return null;
  const copy = { ...original, id: id('p_'), name: name || `${original.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
  return write(copy);
}

/** Bring older project files up to the current shape. */
function migrate(project) {
  const base = blankProject(project.name);
  return {
    ...project,
    settings: { ...base.settings, ...(project.settings || {}) },
    captions: { ...base.captions, ...(project.captions || {}), style: { ...base.captions.style, ...(project.captions?.style || {}) } },
    audio: { ...base.audio, ...(project.audio || {}), ducking: { ...base.audio.ducking, ...(project.audio?.ducking || {}) } },
    watermark: { ...base.watermark, ...(project.watermark || {}) },
    brandKit: { ...base.brandKit, ...(project.brandKit || {}) },
    tracks: (project.tracks || base.tracks).map((t) => ({ volume: 1, clips: [], ...t })),
    media: project.media || [],
  };
}

export function exportName(project) {
  return safeName(project.name || 'export');
}
