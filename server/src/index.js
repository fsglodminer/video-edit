// JumpCut API server. Also serves the built editor in production.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { tools, capabilities } from './ffmpeg.js';
import { DIRS, ensureDirs, listFonts, defaultFontFile, uniquePath, safeName } from './storage.js';
import * as library from './library.js';
import * as projects from './projects.js';
import * as captions from './captions.js';
import { filmstrip, poster, waveform, detectSilence, loudness, kindFor, proxy, proxyPath, wantsProxy } from './media.js';
import { PRESETS } from './presets.js';
import { FILTER_PRESETS, TRANSITIONS, TEXT_ANIMATIONS, SHAPES, BACKGROUNDS } from './looks.js';
import { startExport, getJob, listJobs, cancelJob, jobEvents, renderFrame, exportStill, pruneJobs } from './render.js';
import { projectDuration } from './compile.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || '127.0.0.1';

ensureDirs();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '64mb' }));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, DIRS.media),
    filename: (_req, f, cb) => cb(null, path.basename(uniquePath(DIRS.media, safeName(f.originalname)))),
  }),
  limits: { fileSize: 32 * 1024 * 1024 * 1024 },
});

const wrap = (handler) => (req, res) => {
  Promise.resolve(handler(req, res)).catch((err) => {
    if (res.headersSent) return;
    const status = err.code === 'ENOENT' ? 404 : err.status || 500;
    res.status(status).json({ error: err.message || 'Something went wrong', code: err.code || null });
  });
};

// ---------------------------------------------------------------- system ----

app.get('/api/health', (_req, res) => {
  const t = tools();
  const caps = capabilities();
  res.json({
    ok: Boolean(t.ffmpeg.bin && t.ffprobe.bin),
    ffmpeg: { path: t.ffmpeg.bin, source: t.ffmpeg.source },
    ffprobe: { path: t.ffprobe.bin, source: t.ffprobe.source },
    hardwareEncoders: [...caps.encoders].filter((e) => /videotoolbox|nvenc|qsv|vaapi|amf/.test(e)),
    font: defaultFontFile(),
    speechToText: Boolean(captions.findWhisper()),
    dirs: DIRS,
    platform: process.platform,
    cpus: os.cpus().length,
  });
});

app.get('/api/presets', (_req, res) => res.json({ presets: PRESETS }));

/** Everything the content/effects panels offer, so the UI never hard-codes it. */
app.get('/api/library', (_req, res) =>
  res.json({
    filters: FILTER_PRESETS.map(({ id, label, css }) => ({ id, label, css })),
    transitions: TRANSITIONS.map(({ id, label, group }) => ({ id, label, group })),
    textAnimations: TEXT_ANIMATIONS,
    shapes: SHAPES,
    backgrounds: BACKGROUNDS,
  })
);
app.get('/api/fonts', (_req, res) => res.json({ fonts: listFonts().slice(0, 300), default: defaultFontFile() }));

/** Minimal directory browser so media can be added by path without uploading. */
app.get('/api/browse', wrap(async (req, res) => {
  const dir = path.resolve(req.query.dir || os.homedir());
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = entries
    .filter((e) => !e.name.startsWith('.'))
    .map((e) => {
      const full = path.join(dir, e.name);
      const isDir = e.isDirectory();
      return { name: e.name, path: full, isDir, kind: isDir ? null : kindFor(e.name) };
    })
    .filter((e) => e.isDir || e.kind)
    .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name));
  res.json({ dir, parent: path.dirname(dir) === dir ? null : path.dirname(dir), items, home: os.homedir() });
}));

app.post('/api/reveal', wrap(async (req, res) => {
  const target = path.resolve(req.body?.path || DIRS.exports);
  if (!library.isKnownPath(target) && !target.startsWith(DIRS.home)) {
    res.status(403).json({ error: 'Refusing to open a path outside the JumpCut folder.' });
    return;
  }
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  const args = process.platform === 'darwin' ? ['-R', target] : [fs.statSync(target).isDirectory() ? target : path.dirname(target)];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
}));

// ----------------------------------------------------------------- media ----

app.post('/api/media/import', wrap(async (req, res) => {
  const paths = Array.isArray(req.body?.paths) ? req.body.paths : [req.body?.path].filter(Boolean);
  const media = [];
  const errors = [];
  for (const p of paths) {
    try {
      media.push(await library.register(p));
    } catch (err) {
      errors.push({ path: p, error: err.message });
    }
  }
  res.json({ media, errors });
}));

app.post('/api/media/upload', upload.array('files', 64), wrap(async (req, res) => {
  const media = [];
  const errors = [];
  for (const f of req.files || []) {
    try {
      media.push(await library.register(f.path));
    } catch (err) {
      errors.push({ path: f.originalname, error: err.message });
    }
  }
  res.json({ media, errors });
}));

app.get('/api/media', (_req, res) => res.json({ media: library.all() }));

app.delete('/api/media/:key', wrap(async (req, res) => res.json({ ok: library.forget(req.params.key) })));

app.post('/api/media/:key/relink', wrap(async (req, res) => {
  const record = await library.relink(req.params.key, req.body?.path);
  res.json({ media: record });
}));

const needMedia = (key) => {
  const record = library.get(key);
  if (!record) throw Object.assign(new Error('Unknown media'), { status: 404 });
  return record;
};

app.get('/api/media/:key/poster', wrap(async (req, res) => {
  const out = await poster(needMedia(req.params.key));
  if (!out) {
    res.status(204).end();
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(out);
}));

app.get('/api/media/:key/filmstrip', wrap(async (req, res) => {
  const strip = await filmstrip(needMedia(req.params.key), { height: Math.min(160, Number(req.query.height) || 72) });
  if (!strip) {
    res.status(204).end();
    return;
  }
  if (req.query.meta === '1') {
    res.json({ count: strip.count, interval: strip.interval, tileWidth: strip.tileWidth, tileHeight: strip.tileHeight });
    return;
  }
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(strip.path);
}));

app.get('/api/media/:key/waveform', wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.json(await waveform(needMedia(req.params.key), { buckets: Math.min(8000, Number(req.query.buckets) || 2000) }));
}));

app.post('/api/media/:key/silence', wrap(async (req, res) => {
  res.json(await detectSilence(needMedia(req.params.key), {
    threshold: Number(req.body?.threshold ?? -32),
    minSilence: Number(req.body?.minSilence ?? 0.45),
    padding: Number(req.body?.padding ?? 0.08),
  }));
}));

/**
 * Build (or reuse) a preview proxy. Exports never touch it — this only exists
 * so footage the browser cannot decode still scrubs and plays in the editor.
 */
const proxyJobs = new Map();
app.post('/api/media/:key/proxy', wrap(async (req, res) => {
  const media = needMedia(req.params.key);
  const height = Math.min(1080, Math.max(240, Number(req.body?.height) || 720));
  const cached = proxyPath(media, height);
  if (cached) {
    res.json({ path: cached, cached: true });
    return;
  }
  const jobKey = `${media.key}:${height}`;
  if (!proxyJobs.has(jobKey)) {
    proxyJobs.set(
      jobKey,
      proxy(media, { height }).finally(() => {
        setTimeout(() => proxyJobs.delete(jobKey), 1000).unref?.();
      })
    );
  }
  const path_ = await proxyJobs.get(jobKey);
  res.json({ path: path_, cached: false });
}));

app.get('/api/media/:key/proxy', wrap(async (req, res) => {
  const media = needMedia(req.params.key);
  const height = Math.min(1080, Math.max(240, Number(req.query.height) || 720));
  res.json({ path: proxyPath(media, height), recommended: wantsProxy(media) });
}));

app.get('/api/media/:key/loudness', wrap(async (req, res) => res.json({ loudness: await loudness(needMedia(req.params.key)) })));

/** Byte-range streaming, so <video> can seek during preview playback. */
app.get('/api/file', wrap(async (req, res) => {
  const file = path.resolve(String(req.query.path || ''));
  if (!library.isKnownPath(file)) {
    res.status(403).json({ error: 'That file is not in the media library.' });
    return;
  }
  if (!fs.existsSync(file)) {
    res.status(404).json({ error: 'File not found (it may have moved).' });
    return;
  }
  const stat = fs.statSync(file);
  const type = contentType(file);
  const range = req.headers.range;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'private, max-age=3600');
  if (!range) {
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(file).pipe(res);
    return;
  }
  const match = /bytes=(\d*)-(\d*)/.exec(range);
  const start = match?.[1] ? parseInt(match[1], 10) : 0;
  const end = match?.[2] ? Math.min(parseInt(match[2], 10), stat.size - 1) : stat.size - 1;
  if (start >= stat.size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${stat.size}`).end();
    return;
  }
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  res.setHeader('Content-Length', end - start + 1);
  fs.createReadStream(file, { start, end }).pipe(res);
}));

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.ogv': 'video/ogg',
    '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.wav': 'audio/wav',
    '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/opus',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.avif': 'image/avif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  }[ext] || 'application/octet-stream';
}

// -------------------------------------------------------------- projects ----

app.get('/api/projects', wrap(async (_req, res) => res.json({ projects: projects.list() })));

app.post('/api/projects', wrap(async (req, res) => {
  const project = projects.blankProject(req.body?.name || 'Untitled project', { settings: req.body?.settings });
  res.json({ project: projects.write(project) });
}));

app.get('/api/projects/:id', wrap(async (req, res) => {
  const project = projects.read(req.params.id);
  if (!project) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({ project });
}));

app.put('/api/projects/:id', wrap(async (req, res) => {
  const incoming = req.body?.project;
  if (!incoming?.id) {
    res.status(400).json({ error: 'Missing project payload' });
    return;
  }
  res.json({ project: projects.write({ ...incoming, id: req.params.id }) });
}));

app.delete('/api/projects/:id', wrap(async (req, res) => res.json({ ok: projects.remove(req.params.id) })));
app.post('/api/projects/:id/duplicate', wrap(async (req, res) => res.json({ project: projects.duplicate(req.params.id, req.body?.name) })));

// -------------------------------------------------------------- captions ----

const captionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.post('/api/captions/parse', captionUpload.single('file'), wrap(async (req, res) => {
  const text = req.file ? req.file.buffer.toString('utf8') : String(req.body?.text || '');
  const items = captions.parseCaptions(text, req.file?.originalname || req.body?.filename || '');
  res.json({ items });
}));

app.post('/api/captions/format', wrap(async (req, res) => {
  const items = req.body?.items || [];
  const mode = req.body?.mode || 'rewrap';
  if (mode === 'words') res.json({ items: captions.toWordChunks(items, { wordsPerChunk: Number(req.body?.wordsPerChunk) || 3 }) });
  else res.json({ items: captions.rewrap(items, { maxChars: Number(req.body?.maxChars) || 42, maxLines: Number(req.body?.maxLines) || 2 }) });
}));

app.post('/api/captions/export', wrap(async (req, res) => {
  const items = req.body?.items || [];
  const format = req.body?.format === 'vtt' ? 'vtt' : 'srt';
  const body = format === 'vtt' ? captions.toVtt(items) : captions.toSrt(items);
  const filename = `${safeName(req.body?.name || 'captions')}.${format}`;
  const outPath = path.join(DIRS.exports, filename);
  fs.writeFileSync(outPath, body, 'utf8');
  res.json({ path: outPath, filename, text: body });
}));

app.post('/api/captions/transcribe', wrap(async (req, res) => {
  const media = needMedia(req.body?.mediaKey);
  const items = await captions.transcribe(media.path, { language: req.body?.language || 'auto' });
  res.json({ items: captions.rewrap(items, { maxChars: 42, maxLines: 2 }) });
}));

// ---------------------------------------------------------------- render ----

app.post('/api/export', wrap(async (req, res) => {
  const job = startExport(req.body?.project, req.body?.options || {});
  res.json({ job });
}));

app.get('/api/jobs', (_req, res) => {
  pruneJobs();
  res.json({ jobs: listJobs() });
});

app.get('/api/jobs/:id', wrap(async (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json({ job });
}));

app.delete('/api/jobs/:id', wrap(async (req, res) => res.json({ cancelled: cancelJob(req.params.id) })));

/** Server-sent progress for a single job. */
app.get('/api/jobs/:id/events', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send(job);
  const listener = (updated) => {
    send(updated);
    if (updated.status !== 'running') {
      res.write('event: end\ndata: {}\n\n');
      res.end();
    }
  };
  jobEvents.on(req.params.id, listener);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 15000);
  req.on('close', () => {
    clearInterval(keepAlive);
    jobEvents.off(req.params.id, listener);
  });
});

/** A pixel-accurate frame straight from the render engine. */
app.post('/api/preview/frame', wrap(async (req, res) => {
  const png = await renderFrame(req.body?.project, Number(req.body?.time) || 0, { width: Number(req.body?.width) || 960 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
}));

app.post('/api/still', wrap(async (req, res) => {
  const result = await exportStill(req.body?.project, Number(req.body?.time) || 0, {
    width: Number(req.body?.width) || req.body?.project?.settings?.width || 1920,
    filename: req.body?.filename,
  });
  res.json(result);
}));

app.post('/api/duration', wrap(async (req, res) => res.json({ duration: projectDuration(req.body?.project || {}) })));

// ------------------------------------------------------------ static app ----

const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown endpoint' }));

const server = http.createServer(app);
server.requestTimeout = 0;
server.headersTimeout = 0;

server.listen(PORT, HOST, () => {
  const t = tools();
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
  console.log(`\n  JumpCut server  ${url}`);
  console.log(`  ffmpeg          ${t.ffmpeg.bin ? `${t.ffmpeg.bin} (${t.ffmpeg.source})` : 'NOT FOUND — run `npm run doctor`'}`);
  console.log(`  workspace       ${DIRS.home}`);
  if (!fs.existsSync(webDist)) console.log(`  editor          run \`npm run dev\` for the Vite dev server\n`);
  else console.log(`  editor          served from ${webDist}\n`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

export { app, server };
