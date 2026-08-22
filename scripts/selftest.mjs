#!/usr/bin/env node
// End-to-end smoke test for the render engine.
// Generates its own footage with ffmpeg, builds a project, renders it, and
// checks the results. Run with: npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { run, ffmpegPath, capabilities } = await import(path.join(root, 'server/src/ffmpeg.js'));
const { inspect, detectSilence, waveform, filmstrip } = await import(path.join(root, 'server/src/media.js'));
const { compile, projectDuration } = await import(path.join(root, 'server/src/compile.js'));
const { buildOutputArgs } = await import(path.join(root, 'server/src/presets.js'));
const { blankProject } = await import(path.join(root, 'server/src/projects.js'));
const { defaultFontFile, ensureDirs, DIRS } = await import(path.join(root, 'server/src/storage.js'));
const { probe } = await import(path.join(root, 'server/src/ffmpeg.js'));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'jumpcut-selftest-'));
let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  const ok = Boolean(condition);
  if (!ok) failures += 1;
  console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
}

async function main() {
  ensureDirs();
  console.log(`\nJumpCut self-test\n  ffmpeg: ${ffmpegPath()}\n  font:   ${defaultFontFile() ?? 'none found'}\n  temp:   ${work}\n`);

  console.log('Generating test footage…');
  const aroll = path.join(work, 'aroll.mp4');
  const broll = path.join(work, 'broll.mp4');
  const music = path.join(work, 'music.mp3');
  // Speech-like bursts with two clear silences, so silence detection has something to find.
  await run(['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=220:duration=8',
    '-af', "volume=enable='between(t,0,1.6)+between(t,3.2,5)+between(t,6.4,8)':volume=0.6,volume=enable='between(t,1.6,3.2)+between(t,5,6.4)':volume=0.0005",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', aroll]);
  await run(['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30:duration=5',
    '-f', 'lavfi', '-i', 'anoisesrc=d=5:c=pink:a=0.05',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', broll]);
  await run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-c:a', 'libmp3lame', music]);

  console.log('\nProbing media…');
  const a = await inspect(aroll);
  const b = await inspect(broll);
  const m = await inspect(music);
  check('reads video duration', Math.abs(a.duration - 8) < 0.2, `${a.duration}s`);
  check('reads resolution', a.width === 640 && a.height === 360, `${a.width}×${a.height}`);
  check('detects audio + video streams', a.hasAudio && a.hasVideo);
  check('detects audio-only file', m.hasAudio && !m.hasVideo);

  console.log('\nDerived data…');
  const wave = await waveform(a, { buckets: 200 });
  check('builds waveform peaks', wave.peaks.length === 400, `${wave.buckets} buckets`);
  const strip = await filmstrip(a);
  check('builds filmstrip', strip && fs.existsSync(strip.path), strip ? `${strip.count} frames` : '');

  console.log('\nSilence detection (auto jump cuts)…');
  const silence = await detectSilence(a, { threshold: -32, minSilence: 0.4 });
  check('finds the two silent gaps', silence.silences.length === 2, silence.silences.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)}`).join(', '));
  check('returns keep-segments', silence.segments.length === 3, `removes ${silence.removed}s`);

  console.log('\nCompiling a project…');
  const project = blankProject('Self test');
  project.media = [a, b, m];
  const [v2, v1, , a2] = project.tracks;
  const clip = (media, start, duration, over = {}) => ({
    id: `c_${start}`, type: media.hasVideo ? 'video' : 'audio', mediaId: media.id,
    start, duration, inPoint: 0, speed: 1, volume: 1, fadeIn: 0, fadeOut: 0,
    transform: { fit: 'cover', scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 }, effects: {}, ...over,
  });
  v1.clips.push(clip(a, 0, 3), clip(b, 3, 2.5, { fadeIn: 0.4, speed: 1.5 }));
  v2.clips.push(
    clip(b, 0.5, 2, { muted: true, transform: { fit: 'cover', scale: 0.3, x: 0.31, y: -0.3, rotation: 0, opacity: 1 } }),
    { id: 'c_title', type: 'text', start: 0.3, duration: 2.5, inPoint: 0, speed: 1, volume: 1, fadeIn: 0.3, fadeOut: 0.3,
      transform: { fit: 'contain', scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 }, effects: {},
      text: { content: 'Self test title', size: 80, color: '#ffffff', align: 'center', x: 0.5, y: 0.8,
              bold: true, strokeWidth: 6, strokeColor: '#000000', shadow: true, background: 'none', maxWidth: 0.86 } }
  );
  a2.clips.push(clip(m, 0, 5.5, { fadeOut: 1 }));
  project.captions = { ...project.captions, enabled: true, items: [{ start: 0.5, end: 3, text: 'a burned-in caption' }] };

  check('computes timeline length', Math.abs(projectDuration(project) - 5.5) < 0.01, `${projectDuration(project)}s`);

  const compiled = compile(project, { workDir: DIRS.tmp, fontFile: defaultFontFile() });
  check('builds a filter graph', compiled.filterGraph.includes('overlay') && compiled.filterGraph.includes('amix'));
  for (const warning of compiled.warnings) console.log(`    \x1b[33m! ${warning}\x1b[0m`);

  console.log('\nRendering…');
  const out = path.join(work, 'out.mp4');
  const started = Date.now();
  await run([...compiled.args, ...buildOutputArgs({ format: 'mp4', quality: 'low', fps: 30, hardware: false, speed: 'ultrafast' }), out]);
  const rendered = await probe(out);
  const v = rendered.streams.find((s) => s.codec_type === 'video');
  const au = rendered.streams.find((s) => s.codec_type === 'audio');
  check('renders a playable file', fs.existsSync(out) && fs.statSync(out).size > 1000, `${(fs.statSync(out).size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  check('renders at project resolution', v?.width === 1920 && v?.height === 1080, `${v?.width}×${v?.height}`);
  check('renders the full timeline', Math.abs(Number(rendered.format.duration) - 5.5) < 0.4, `${Number(rendered.format.duration).toFixed(2)}s`);
  check('renders an audio track', Boolean(au), au?.codec_name);

  console.log('\nVertical reframe (Shorts)…');
  const vertical = path.join(work, 'short.mp4');
  const short = compile(project, { workDir: DIRS.tmp, fontFile: defaultFontFile(), target: { width: 1080, height: 1920, fps: 30, mode: 'fill' } });
  await run([...short.args, ...buildOutputArgs({ format: 'mp4', quality: 'low', fps: 30, hardware: false, speed: 'ultrafast' }), vertical]);
  const shortProbe = await probe(vertical);
  const sv = shortProbe.streams.find((s) => s.codec_type === 'video');
  check('re-frames to 9:16', sv?.width === 1080 && sv?.height === 1920, `${sv?.width}×${sv?.height}`);

  console.log('\nStill frame…');
  const stillCompiled = compile(project, { workDir: DIRS.tmp, fontFile: defaultFontFile(), startTime: 1, endTime: 1.5, stillFrame: true });
  const still = path.join(work, 'still.png');
  await run([...stillCompiled.args, '-frames:v', '1', '-c:v', 'png', still]);
  check('exports a still frame', fs.existsSync(still) && fs.statSync(still).size > 1000, `${(fs.statSync(still).size / 1024).toFixed(0)} KB`);

  const caps = capabilities();
  console.log(`\nEngine: ${caps.filters.has('ass') ? 'libass available (titles + captions burn in)' : caps.filters.has('drawtext') ? 'drawtext only (titles burn in, captions do not)' : 'no text renderer — titles and captions cannot burn in'}`);
  console.log(`Hardware encoders: ${[...caps.encoders].filter((e) => /videotoolbox|nvenc|qsv|vaapi|amf/.test(e)).join(', ') || 'none (software encoding)'}`);
}

try {
  await main();
} catch (err) {
  failures += 1;
  console.error(`\n\x1b[31mSelf-test crashed:\x1b[0m ${err.message}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\n${failures ? '\x1b[31m' : '\x1b[32m'}${checks - failures}/${checks} checks passed\x1b[0m\n`);
process.exit(failures ? 1 : 0);
