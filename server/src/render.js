// Render jobs: queue, run, report progress, allow cancellation.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { compile, projectDuration } from './compile.js';
import { buildOutputArgs, extensionFor, getPreset } from './presets.js';
import { run, runBinary, ffmpegPath } from './ffmpeg.js';
import { DIRS, id, safeName, resolveFont } from './storage.js';

const jobs = new Map();
export const jobEvents = new EventEmitter();
jobEvents.setMaxListeners(0);

const TIME_RE = /time=\s*(\d+):(\d{2}):(\d{2}\.?\d*)/g;

function lastTime(chunk) {
  let match;
  let seconds = null;
  TIME_RE.lastIndex = 0;
  while ((match = TIME_RE.exec(chunk)) !== null) {
    seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + parseFloat(match[3]);
  }
  return seconds;
}

const SPEED_RE = /speed=\s*([\d.]+)x/g;
function lastSpeed(chunk) {
  let match;
  let speed = null;
  SPEED_RE.lastIndex = 0;
  while ((match = SPEED_RE.exec(chunk)) !== null) speed = parseFloat(match[1]);
  return speed;
}

export function listJobs() {
  return [...jobs.values()].map(publicJob);
}

export function getJob(jobId) {
  const job = jobs.get(jobId);
  return job ? publicJob(job) : null;
}

function publicJob(job) {
  const { controller, ...rest } = job;
  return rest;
}

export function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job || job.status !== 'running') return false;
  job.controller.abort();
  return true;
}

function emit(job, patch) {
  Object.assign(job, patch);
  jobEvents.emit('update', publicJob(job));
  jobEvents.emit(job.id, publicJob(job));
}

/**
 * Kick off an export. Returns immediately with the job record; progress
 * arrives on `jobEvents`.
 */
export function startExport(project, options = {}) {
  const preset = getPreset(options.presetId);
  const settings = { ...project.settings };
  const duration = projectDuration(project);
  if (duration <= 0) throw Object.assign(new Error('Timeline is empty — add a clip before exporting.'), { code: 'EMPTY_TIMELINE' });

  const target = preset.audioOnly
    ? null
    : {
        width: options.width || preset.width || settings.width,
        height: options.height || preset.height || settings.height,
        fps: options.fps || preset.fps || settings.fps,
        mode: options.reframe || 'fit',
      };

  const format = options.format || (preset.audioOnly ? 'mp3' : preset.gif ? 'gif' : 'mp4');
  const ext = extensionFor({ format, audioOnly: preset.audioOnly, gif: preset.gif });
  const filename = `${safeName(options.filename || project.name || 'export')}.${ext}`;
  const outDir = options.outputDir && fs.existsSync(options.outputDir) ? options.outputDir : DIRS.exports;
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, filename);

  const compiled = compile(project, {
    workDir: DIRS.tmp,
    fontFile: resolveFont(options.font || project.settings?.font),
    target,
    gif: Boolean(preset.gif),
    startTime: options.startTime,
    endTime: options.endTime,
  });

  const outputArgs = buildOutputArgs({
    format,
    codec: options.codec || 'h264',
    quality: options.quality || 'high',
    videoBitrate: options.videoBitrate ?? preset.videoBitrate ?? null,
    audioBitrate: options.audioBitrate || '320k',
    fps: target?.fps || settings.fps,
    hardware: options.hardware !== false,
    speed: options.speed || preset.speed || 'medium',
    audioOnly: Boolean(preset.audioOnly),
    gif: Boolean(preset.gif),
  });

  const args = [...compiled.args, ...outputArgs, outPath];

  const controller = new AbortController();
  const job = {
    id: id('job_'),
    kind: 'export',
    status: 'running',
    projectName: project.name || 'Untitled',
    preset: preset.id,
    presetLabel: preset.label,
    outPath,
    filename,
    duration: compiled.duration,
    progress: 0,
    speed: null,
    eta: null,
    startedAt: Date.now(),
    finishedAt: null,
    error: null,
    log: '',
    controller,
  };
  jobs.set(job.id, job);

  const onLog = (text) => {
    job.log = (job.log + text).slice(-20000);
    const t = lastTime(text);
    const s = lastSpeed(text);
    const patch = {};
    if (t != null && compiled.duration > 0) {
      patch.progress = Math.max(0, Math.min(0.999, t / compiled.duration));
      if (s && s > 0) patch.eta = Math.max(0, (compiled.duration - t) / s);
    }
    if (s) patch.speed = s;
    if (Object.keys(patch).length) emit(job, patch);
  };

  run(args, { onLog, signal: controller.signal })
    .then(() => {
      const size = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
      emit(job, { status: 'done', progress: 1, eta: 0, finishedAt: Date.now(), size });
    })
    .catch((err) => {
      const cancelled = err.code === 'CANCELLED' || controller.signal.aborted;
      if (cancelled) {
        try {
          fs.existsSync(outPath) && fs.unlinkSync(outPath);
        } catch {
          /* nothing to clean */
        }
      }
      emit(job, {
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? null : humanError(err, job.log),
        finishedAt: Date.now(),
      });
    });

  return publicJob(job);
}

/** Turn ffmpeg's wall of text into something a creator can act on. */
function humanError(err, log = '') {
  const text = `${err?.stderr || ''}\n${log}`;
  if (err?.code === 'NO_FFMPEG') return err.message;
  if (/No such file or directory/i.test(text)) {
    const m = /Error opening input file (.+?)\./.exec(text) || /(\S+): No such file or directory/.exec(text);
    return `A source file is missing${m ? `: ${m[1]}` : ''}. Relink it in the media bin and try again.`;
  }
  if (/Cannot find a valid font|Could not load font|fontconfig/i.test(text)) {
    return 'No usable font was found for titles/captions. Drop a .ttf into ~/JumpCut/fonts (or set JUMPCUT_FONT).';
  }
  if (/No space left on device/i.test(text)) return 'The disk filled up during export. Free some space and retry.';
  if (/Unknown encoder|Encoder .* not found/i.test(text)) {
    return 'The selected encoder is unavailable in this ffmpeg build. Turn off hardware encoding in Export settings.';
  }
  if (/Invalid argument|Error (re)?initializing (an )?(output|filter)/i.test(text)) {
    const line = text.split(/\r?\n/).reverse().find((l) => /error|invalid/i.test(l));
    return `ffmpeg rejected the render${line ? `: ${line.trim()}` : ''}.`;
  }
  const tail = text.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').trim();
  return tail || err?.message || 'Export failed.';
}

/** Render one composited frame of the timeline as PNG bytes (preview + thumbnails). */
export async function renderFrame(project, atSeconds, { width, font } = {}) {
  const total = projectDuration(project);
  const t = Math.max(0, Math.min(atSeconds, Math.max(0, total - 0.02)));
  const compiled = compile(project, {
    workDir: DIRS.tmp,
    fontFile: resolveFont(font || project.settings?.font),
    startTime: t,
    endTime: Math.min(total, t + 0.5),
    stillFrame: true,
    target: width ? { width, height: Math.round((width * (project.settings?.height || 1080)) / (project.settings?.width || 1920) / 2) * 2, mode: 'fit' } : null,
  });
  const args = [...compiled.args, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', '-'];
  return runBinary(args);
}

/** Export a still at the playhead — for making a thumbnail out of a real frame. */
export async function exportStill(project, atSeconds, options = {}) {
  const buffer = await renderFrame(project, atSeconds, { width: options.width, font: options.font });
  const filename = `${safeName(options.filename || `${project.name || 'frame'}-${Math.round(atSeconds * 100) / 100}s`)}.png`;
  const outPath = path.join(DIRS.exports, filename);
  fs.mkdirSync(DIRS.exports, { recursive: true });
  fs.writeFileSync(outPath, buffer);
  return { path: outPath, filename, size: buffer.length };
}

export function pruneJobs(maxAgeMs = 6 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  for (const [key, job] of jobs) {
    if (job.status !== 'running' && (job.finishedAt || 0) < cutoff) jobs.delete(key);
  }
}
