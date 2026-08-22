// Post-install sanity check: report which ffmpeg JumpCut will use.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const verbose = process.argv.includes('--verbose');

function works(bin) {
  if (!bin) return false;
  try {
    return spawnSync(bin, ['-version'], { stdio: 'ignore', timeout: 15000 }).status === 0;
  } catch {
    return false;
  }
}

function onPath(name) {
  const which = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(which, [name], { encoding: 'utf8', timeout: 8000 });
  if (r.status !== 0) return null;
  const first = String(r.stdout).split(/\r?\n/)[0].trim();
  return works(first) ? first : null;
}

function bundled(mod, pick) {
  try {
    const p = pick(require(mod));
    if (p && fs.existsSync(p)) {
      try {
        fs.chmodSync(p, 0o755);
      } catch {
        /* best effort */
      }
      return works(p) ? p : null;
    }
  } catch {
    /* not installed */
  }
  return null;
}

const ffmpeg = (process.env.FFMPEG_PATH && works(process.env.FFMPEG_PATH) && process.env.FFMPEG_PATH)
  || onPath('ffmpeg')
  || bundled('ffmpeg-static', (m) => m?.default ?? m);
const ffprobe = (process.env.FFPROBE_PATH && works(process.env.FFPROBE_PATH) && process.env.FFPROBE_PATH)
  || onPath('ffprobe')
  || bundled('ffprobe-static', (m) => m?.path ?? m?.default?.path);

if (ffmpeg && ffprobe) {
  console.log(`JumpCut: ffmpeg  -> ${ffmpeg}`);
  console.log(`JumpCut: ffprobe -> ${ffprobe}`);
  if (verbose) {
    const v = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8' });
    console.log(String(v.stdout).split('\n')[0]);
    const enc = spawnSync(ffmpeg, ['-hide_banner', '-encoders'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const hw = String(enc.stdout).split('\n').filter((l) => /videotoolbox|nvenc|qsv|vaapi|amf/.test(l)).map((l) => l.trim().split(/\s+/)[1]);
    console.log(`Hardware encoders: ${hw.length ? hw.join(', ') : 'none detected (software encoding will be used)'}`);
  }
} else {
  console.log('JumpCut: no ffmpeg found yet.');
  console.log('  Install one of:');
  console.log('    macOS    brew install ffmpeg');
  console.log('    Debian   sudo apt install ffmpeg');
  console.log('    Windows  winget install Gyan.FFmpeg');
  console.log('  ...or let the bundled build install with `npm install`.');
}
