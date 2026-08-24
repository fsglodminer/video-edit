// Locates and runs ffmpeg / ffprobe.
// Resolution order: explicit env var -> binary on PATH -> npm-bundled static build.
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);

function works(bin) {
  if (!bin) return false;
  try {
    const r = spawnSync(bin, ['-version'], { stdio: 'ignore', timeout: 15000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function fromPath(name) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  try {
    const r = spawnSync(which, [name], { encoding: 'utf8', timeout: 10000 });
    if (r.status === 0) {
      const first = String(r.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (first && works(first)) return first;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function fromStatic(mod, pick) {
  try {
    const resolved = pick(require(mod));
    // npm ships these read-only on some systems; make sure they are runnable.
    if (resolved && fs.existsSync(resolved)) {
      try {
        fs.chmodSync(resolved, 0o755);
      } catch {
        /* best effort */
      }
      if (works(resolved)) return resolved;
    }
  } catch {
    /* module not installed */
  }
  return null;
}

function resolveFfmpeg() {
  const env = process.env.FFMPEG_PATH;
  if (env && works(env)) return { bin: env, source: 'FFMPEG_PATH' };
  const onPath = fromPath('ffmpeg');
  if (onPath) return { bin: onPath, source: 'system' };
  const stat = fromStatic('ffmpeg-static', (m) => m?.default ?? m);
  if (stat) return { bin: stat, source: 'ffmpeg-static' };
  return { bin: null, source: 'missing' };
}

function resolveFfprobe() {
  const env = process.env.FFPROBE_PATH;
  if (env && works(env)) return { bin: env, source: 'FFPROBE_PATH' };
  const onPath = fromPath('ffprobe');
  if (onPath) return { bin: onPath, source: 'system' };
  const stat = fromStatic('ffprobe-static', (m) => (m?.path ?? m?.default?.path ?? null));
  if (stat) return { bin: stat, source: 'ffprobe-static' };
  return { bin: null, source: 'missing' };
}

let cached = null;
export function tools() {
  if (!cached) cached = { ffmpeg: resolveFfmpeg(), ffprobe: resolveFfprobe() };
  return cached;
}

export function ffmpegPath() {
  const t = tools().ffmpeg;
  if (!t.bin) {
    throw Object.assign(new Error('ffmpeg not found. Install ffmpeg or run `npm install` to fetch the bundled build.'), { code: 'NO_FFMPEG' });
  }
  return t.bin;
}

export function ffprobePath() {
  const t = tools().ffprobe;
  if (!t.bin) {
    throw Object.assign(new Error('ffprobe not found. Install ffmpeg or run `npm install` to fetch the bundled build.'), { code: 'NO_FFPROBE' });
  }
  return t.bin;
}

/** Capabilities we branch on when building filter graphs / choosing encoders. */
let caps = null;
export function capabilities() {
  if (caps) return caps;
  caps = { encoders: new Set(), filters: new Set(), hwaccels: new Set() };
  const bin = tools().ffmpeg.bin;
  if (!bin) return caps;
  const grab = (args, re) => {
    try {
      const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 20000, maxBuffer: 1 << 24 });
      const out = `${r.stdout || ''}`;
      const found = new Set();
      for (const line of out.split(/\r?\n/)) {
        const m = line.match(re);
        if (m) found.add(m[1]);
      }
      return found;
    } catch {
      return new Set();
    }
  };
  caps.encoders = grab(['-hide_banner', '-encoders'], /^\s*[VAS][.EFXBDSILW]{5}\s+(\S+)/);
  caps.filters = grab(['-hide_banner', '-filters'], /^\s*[TSC.]{3}\s+(\S+)/);
  caps.hwaccels = grab(['-hide_banner', '-hwaccels'], /^\s{0,2}(\w+)\s*$/);
  return caps;
}

/** Pick the best available H.264/HEVC encoder, preferring hardware when present. */
export function pickVideoEncoder({ codec = 'h264', preferHardware = true } = {}) {
  const { encoders } = capabilities();
  const table = {
    h264: ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_vaapi', 'h264_amf'],
    hevc: ['hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_vaapi', 'hevc_amf'],
  };
  if (preferHardware) {
    for (const enc of table[codec] || []) if (encoders.has(enc)) return enc;
  }
  if (codec === 'hevc') return encoders.has('libx265') ? 'libx265' : 'libx264';
  return 'libx264';
}

export function isHardwareEncoder(name) {
  return /videotoolbox|nvenc|qsv|vaapi|amf/.test(name || '');
}

/** Run ffmpeg, streaming stderr to `onLog`. Resolves with the full stderr text. */
export function run(args, { onLog, signal, bin } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin || ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    let stderr = '';
    let stdout = '';
    const onAbort = () => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      // Keep memory bounded on very long renders.
      if (stderr.length > 400_000) stderr = stderr.slice(-200_000);
      if (onLog) onLog(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener?.('abort', onAbort);
      if (code === 0) resolve({ stdout, stderr });
      else if (signal?.aborted) reject(Object.assign(new Error('cancelled'), { code: 'CANCELLED' }));
      else reject(Object.assign(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-4000)}`), { code: 'FFMPEG_FAILED', stderr }));
    });
  });
}

/** Run ffmpeg and collect raw stdout bytes (for piping frames/PCM back to us). */
export function runBinary(args, { signal, maxBytes = 1 << 28 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let total = 0;
    let stderr = '';
    const onAbort = () => child.kill('SIGKILL');
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (d) => {
      total += d.length;
      if (total > maxBytes) {
        child.kill('SIGKILL');
        reject(new Error('output exceeded size limit'));
        return;
      }
      chunks.push(d);
    });
    child.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener?.('abort', onAbort);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`ffmpeg exited with code ${code}\n${stderr.slice(-2000)}`));
    });
  });
}

export async function probe(file) {
  const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file];
  const { stdout } = await run(args, { bin: ffprobePath() });
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(`Could not read media info for ${path.basename(file)}`);
  }
}
