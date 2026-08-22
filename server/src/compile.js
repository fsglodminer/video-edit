// Compiles a JumpCut project (tracks of clips) into a single ffmpeg invocation.
//
// Strategy: every clip becomes its own ffmpeg *input* with `-ss`/`-t` applied
// before `-i`, so ffmpeg seeks instead of decoding whole files. The filter graph
// then only has to position, transform and mix streams that are already trimmed.
//
// Video: start from a solid canvas and `overlay` each clip in track order
// (bottom track first). Lead-in silence is handled with `tpad` transparent
// padding rather than `enable=` so the framesync never stalls.
//
// Audio: each clip is delayed to its timeline position with `adelay`, then the
// whole set is mixed with `amix` (normalize=0 so gains stay predictable).
import path from 'node:path';
import fs from 'node:fs';
import { capabilities } from './ffmpeg.js';
import { familyName } from './fontinfo.js';

export const DEFAULT_SETTINGS = {
  width: 1920,
  height: 1080,
  fps: 30,
  sampleRate: 48000,
  background: '#000000',
};

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (v) => Math.round(v * 1000) / 1000;

/** Escape a filesystem path for use inside a filtergraph argument. */
export function escapePath(p) {
  return String(p).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

/** Escape a plain value used as a filter argument. */
export function escapeArg(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/[[\]]/g, (m) => `\\${m}`);
}

/** #rrggbb (or #rrggbbaa) -> ffmpeg colour literal. */
export function ffColor(hex, fallback = 'black') {
  if (!hex) return fallback;
  const s = String(hex).trim();
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (!m) return fallback;
  return m[2] ? `0x${m[1]}${m[2]}` : `0x${m[1]}`;
}

/** ffmpeg's atempo only accepts 0.5..100, so chain factors for extreme speeds. */
export function atempoChain(speed) {
  let s = clamp(num(speed, 1), 0.05, 20);
  const parts = [];
  while (s < 0.5) {
    parts.push(0.5);
    s /= 0.5;
  }
  while (s > 2) {
    parts.push(2);
    s /= 2;
  }
  if (Math.abs(s - 1) > 1e-4 || parts.length === 0) parts.push(s);
  return parts.map((p) => `atempo=${r2(p)}`);
}

export function clipEnd(clip) {
  return num(clip.start) + Math.max(0, num(clip.duration));
}

/** Longest point on the timeline, in seconds. */
export function projectDuration(project) {
  let end = 0;
  for (const track of project.tracks || []) {
    for (const clip of track.clips || []) end = Math.max(end, clipEnd(clip));
  }
  for (const cap of project.captions?.items || []) end = Math.max(end, num(cap.end));
  return Math.max(0, r2(end));
}

function mediaById(project) {
  const map = new Map();
  for (const m of project.media || []) map.set(m.id, m);
  return map;
}

/**
 * Where a clip should be drawn, in canvas pixels.
 * Returns the scale target plus the overlay offset from centre.
 */
function layout(clip, media, settings) {
  const W = settings.width;
  const H = settings.height;
  const t = clip.transform || {};
  const crop = clip.crop || null;

  let srcW = Math.max(1, num(media?.width, W));
  let srcH = Math.max(1, num(media?.height, H));
  let cropFilter = null;
  if (crop && (num(crop.left) || num(crop.top) || num(crop.right) || num(crop.bottom))) {
    const l = clamp(num(crop.left), 0, 0.95);
    const tp = clamp(num(crop.top), 0, 0.95);
    const r = clamp(num(crop.right), 0, 0.95);
    const b = clamp(num(crop.bottom), 0, 0.95);
    const w = Math.max(2, Math.round(srcW * Math.max(0.05, 1 - l - r)));
    const h = Math.max(2, Math.round(srcH * Math.max(0.05, 1 - tp - b)));
    const x = Math.round(srcW * l);
    const y = Math.round(srcH * tp);
    cropFilter = `crop=${w}:${h}:${x}:${y}`;
    srcW = w;
    srcH = h;
  }

  const fit = t.fit || 'contain';
  const scale = clamp(num(t.scale, 1), 0.01, 10);
  let drawW;
  let drawH;
  if (fit === 'stretch') {
    drawW = W;
    drawH = H;
  } else {
    const ratio = fit === 'cover' ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH);
    drawW = srcW * ratio;
    drawH = srcH * ratio;
  }
  drawW = Math.max(2, Math.round((drawW * scale) / 2) * 2);
  drawH = Math.max(2, Math.round((drawH * scale) / 2) * 2);

  return {
    cropFilter,
    drawW,
    drawH,
    offX: Math.round(num(t.x) * W),
    offY: Math.round(num(t.y) * H),
    rotation: num(t.rotation),
    opacity: clamp(num(t.opacity, 1), 0, 1),
    cover: fit === 'cover',
  };
}

/** Colour / sharpness adjustments, only emitted when they differ from neutral. */
function effectFilters(clip) {
  const fx = clip.effects || {};
  const out = [];
  const brightness = clamp(num(fx.brightness), -1, 1);
  const contrast = clamp(num(fx.contrast, 1), 0, 3);
  const saturation = clamp(num(fx.saturation, 1), 0, 3);
  const gamma = clamp(num(fx.gamma, 1), 0.1, 3);
  if (brightness || contrast !== 1 || saturation !== 1 || gamma !== 1) {
    out.push(`eq=brightness=${r2(brightness)}:contrast=${r2(contrast)}:saturation=${r2(saturation)}:gamma=${r2(gamma)}`);
  }
  const hue = num(fx.hue);
  if (hue) out.push(`hue=h=${r2(hue)}`);
  const blur = clamp(num(fx.blur), 0, 50);
  if (blur > 0) out.push(`gblur=sigma=${r2(blur)}`);
  const sharpen = clamp(num(fx.sharpen), 0, 3);
  if (sharpen > 0) out.push(`unsharp=5:5:${r2(sharpen)}:5:5:0`);
  if (fx.grayscale) out.push('hue=s=0');
  if (fx.invert) out.push('negate');
  return out;
}

function isRenderableVideo(clip, media) {
  if (clip.type === 'text' || clip.type === 'solid') return true;
  if (clip.type === 'image') return true;
  return Boolean(media && media.hasVideo);
}

function hasAudio(clip, media) {
  if (clip.type === 'text' || clip.type === 'solid' || clip.type === 'image') return false;
  if (clip.muted) return false;
  return Boolean(media && media.hasAudio);
}

/**
 * Build the ffmpeg argument list for a project.
 *
 * @param {object} project
 * @param {object} opts
 * @param {string} opts.outPath        destination file (omit with `opts.rawTo`)
 * @param {object} [opts.output]       encoder settings (see buildOutputArgs)
 * @param {number} [opts.startTime]    render only from this timeline second
 * @param {number} [opts.endTime]      render only up to this timeline second
 * @param {number} [opts.scale]        render at a fraction of project size (previews)
 * @param {string} [opts.workDir]      where sidecar files (text, subtitles) go
 * @param {string} [opts.fontFile]     TTF/OTF used by titles and captions
 */
export function compile(project, opts = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...(project.settings || {}) };
  const previewScale = clamp(num(opts.scale, 1), 0.1, 1);
  if (previewScale !== 1) {
    settings.width = Math.max(16, Math.round((settings.width * previewScale) / 2) * 2);
    settings.height = Math.max(16, Math.round((settings.height * previewScale) / 2) * 2);
  }
  const fps = clamp(num(settings.fps, 30), 1, 240);
  const W = settings.width;
  const H = settings.height;

  const workDir = opts.workDir || path.join(process.cwd(), '.jumpcut-tmp');
  fs.mkdirSync(workDir, { recursive: true });

  const total = projectDuration(project);
  const rangeStart = clamp(num(opts.startTime, 0), 0, Math.max(0, total));
  const rangeEnd = opts.endTime != null ? clamp(num(opts.endTime, total), rangeStart, total || num(opts.endTime)) : total;
  const duration = Math.max(0.04, r2(rangeEnd - rangeStart));

  // Stills and GIFs carry no audio; emitting clip audio chains for them would
  // leave dangling filter outputs and ffmpeg refuses to bind the graph.
  const wantAudio = !opts.stillFrame && !opts.gif;

  const media = mediaById(project);
  const inputs = [];   // { args: [...], clip }
  const filters = [];
  const audioLabels = [];
  const audioGroups = { voice: [], music: [], other: [] };

  const addInput = (args) => {
    inputs.push(args);
    return inputs.length - 1;
  };

  // ---- video tracks --------------------------------------------------------
  // `tracks` is stored top-first (matching the UI), so composite in reverse.
  const videoTracks = (project.tracks || []).filter((t) => t.kind === 'video');
  const audioTracks = (project.tracks || []).filter((t) => t.kind === 'audio');

  const bg = ffColor(settings.background, 'black');
  filters.push(`color=c=${bg}:s=${W}x${H}:r=${fps}:d=${r2(duration)},format=rgba[vbase]`);
  let vLabel = 'vbase';
  let vIndex = 0;

  const textOverlays = [];

  for (const track of [...videoTracks].reverse()) {
    if (track.hidden) continue;
    for (const clip of track.clips || []) {
      const m = clip.mediaId ? media.get(clip.mediaId) : null;
      if (!isRenderableVideo(clip, m)) continue;

      const cStart = num(clip.start);
      const cDur = Math.max(0.02, num(clip.duration));
      const cEnd = cStart + cDur;
      // Skip clips entirely outside the requested render range.
      if (cEnd <= rangeStart || cStart >= rangeEnd) continue;

      // Position relative to the start of the render range.
      const visibleStart = Math.max(cStart, rangeStart);
      const visibleEnd = Math.min(cEnd, rangeEnd);
      const localStart = r2(visibleStart - rangeStart);
      const localDur = r2(visibleEnd - visibleStart);
      const trimHead = visibleStart - cStart; // seconds skipped from the clip head

      if (clip.type === 'text') {
        textOverlays.push({ clip, start: localStart, duration: localDur });
        continue;
      }

      const speed = clamp(num(clip.speed, 1), 0.05, 20);
      const chain = [];
      let idx;

      if (clip.type === 'solid') {
        const color = ffColor(clip.color || '#000000', 'black');
        idx = addInput(['-f', 'lavfi', '-t', String(r2(localDur)), '-i', `color=c=${color}:s=${W}x${H}:r=${fps}`]);
        chain.push('format=rgba');
      } else if (clip.type === 'image') {
        if (!m?.path) continue;
        idx = addInput(['-loop', '1', '-framerate', String(fps), '-t', String(r2(localDur)), '-i', m.path]);
        chain.push('format=rgba');
      } else {
        if (!m?.path) continue;
        const srcIn = num(clip.inPoint) + trimHead * speed;
        const srcDur = localDur * speed;
        idx = addInput(['-ss', String(r2(Math.max(0, srcIn))), '-t', String(r2(srcDur + 0.05)), '-i', m.path]);
        chain.push('setpts=PTS-STARTPTS');
        if (speed !== 1) chain.push(`setpts=PTS/${r2(speed)}`);
        chain.push(`fps=${fps}`);
        chain.push('format=rgba');
      }

      const L = layout(clip, m, settings);
      if (L.cropFilter) chain.splice(clip.type === 'image' || clip.type === 'solid' ? 0 : 1, 0, L.cropFilter);
      if (clip.type !== 'solid') {
        chain.push(`scale=${L.drawW}:${L.drawH}:flags=bicubic`);
        if (L.cover && (L.drawW > W || L.drawH > H)) {
          chain.push(`crop=${Math.min(W, L.drawW)}:${Math.min(H, L.drawH)}`);
        }
      }
      chain.push(...effectFilters(clip));
      if (L.rotation) {
        chain.push(`rotate=${r2((L.rotation * Math.PI) / 180)}:ow=rotw(${r2((L.rotation * Math.PI) / 180)}):oh=roth(${r2((L.rotation * Math.PI) / 180)}):c=0x00000000`);
      }
      if (L.opacity < 1) chain.push(`colorchannelmixer=aa=${r2(L.opacity)}`);

      // Trim to exact length, then fade, then shift into place.
      chain.push(`trim=duration=${r2(localDur)}`, 'setpts=PTS-STARTPTS');

      const fadeIn = clamp(num(clip.fadeIn), 0, localDur / 2);
      const fadeOut = clamp(num(clip.fadeOut), 0, localDur / 2);
      if (fadeIn > 0) chain.push(`fade=t=in:st=0:d=${r2(fadeIn)}:alpha=1`);
      if (fadeOut > 0) chain.push(`fade=t=out:st=${r2(localDur - fadeOut)}:d=${r2(fadeOut)}:alpha=1`);
      // `tpad` needs a known constant frame rate; trim+setpts clears it, so
      // re-assert fps immediately before padding or the delay is silently dropped.
      if (localStart > 0) chain.push(`fps=${fps}`, `tpad=start_duration=${r2(localStart)}:start_mode=add:color=0x00000000`);

      const src = `${idx}:v`;
      const label = `vc${vIndex}`;
      filters.push(`[${src}]${chain.join(',')}[${label}]`);

      const outLabel = `vo${vIndex}`;
      const x = L.offX === 0 ? '(W-w)/2' : `(W-w)/2${L.offX > 0 ? '+' : ''}${L.offX}`;
      const y = L.offY === 0 ? '(H-h)/2' : `(H-h)/2${L.offY > 0 ? '+' : ''}${L.offY}`;
      filters.push(`[${vLabel}][${label}]overlay=x=${x}:y=${y}:eof_action=pass:repeatlast=0:format=auto[${outLabel}]`);
      vLabel = outLabel;
      vIndex += 1;

      // Audio that rides along with a video clip.
      if (wantAudio && hasAudio(clip, m)) {
        const aLabel = pushAudio({
          filters,
          input: `${idx}:a`,
          index: audioLabels.length,
          clip,
          track,
          localStart,
          localDur,
          speed,
          sampleRate: settings.sampleRate,
        });
        audioLabels.push(aLabel);
        audioGroups[track.role === 'music' ? 'music' : track.role === 'voice' ? 'voice' : 'other'].push(aLabel);
      }
    }
  }

  // ---- audio-only tracks ---------------------------------------------------
  for (const track of audioTracks) {
    if (track.muted) continue;
    for (const clip of track.clips || []) {
      const m = clip.mediaId ? media.get(clip.mediaId) : null;
      if (!wantAudio || !hasAudio(clip, m)) continue;
      const cStart = num(clip.start);
      const cDur = Math.max(0.02, num(clip.duration));
      const cEnd = cStart + cDur;
      if (cEnd <= rangeStart || cStart >= rangeEnd) continue;

      const visibleStart = Math.max(cStart, rangeStart);
      const visibleEnd = Math.min(cEnd, rangeEnd);
      const localStart = r2(visibleStart - rangeStart);
      const localDur = r2(visibleEnd - visibleStart);
      const trimHead = visibleStart - cStart;
      const speed = clamp(num(clip.speed, 1), 0.05, 20);
      const srcIn = num(clip.inPoint) + trimHead * speed;

      const idx = addInput(['-ss', String(r2(Math.max(0, srcIn))), '-t', String(r2(localDur * speed + 0.05)), '-i', m.path]);
      const aLabel = pushAudio({
        filters,
        input: `${idx}:a`,
        index: audioLabels.length,
        clip,
        track,
        localStart,
        localDur,
        speed,
        sampleRate: settings.sampleRate,
      });
      audioLabels.push(aLabel);
      audioGroups[track.role === 'music' ? 'music' : track.role === 'voice' ? 'voice' : 'other'].push(aLabel);
    }
  }

  // ---- titles + captions ---------------------------------------------------
  // Both are text, so both go through libass in a single pass: one filter
  // instead of one drawtext per title, with real font shaping and wrapping.
  const fontFile = opts.fontFile || null;
  const capsOn = Boolean(project.captions?.enabled && (project.captions.items || []).length);
  const { filters: availableFilters } = capabilities();
  const canAss = availableFilters.has('ass') || availableFilters.size === 0;
  const canDrawtext = availableFilters.has('drawtext');
  const warnings = [];

  if (textOverlays.length || capsOn) {
    if (canAss) {
      const doc = buildAssDocument({
        titles: textOverlays,
        captions: capsOn ? project.captions : null,
        W,
        H,
        fontFile,
        offset: rangeStart,
      });
      if (doc) {
        const assPath = path.join(workDir, `text-${process.pid}-${Date.now()}.ass`);
        fs.writeFileSync(assPath, doc, 'utf8');
        const dirs = new Set();
        if (fontFile) dirs.add(path.dirname(fontFile));
        const fontsdir = dirs.size ? `:fontsdir='${escapePath([...dirs][0])}'` : '';
        filters.push(`[${vLabel}]ass=filename='${escapePath(assPath)}'${fontsdir}[vtext]`);
        vLabel = 'vtext';
      }
    } else if (canDrawtext) {
      // Older/leaner ffmpeg builds: fall back to drawtext for titles.
      for (const [i, item] of textOverlays.entries()) {
        const built = buildTextFilter(item, { W, H, workDir, fontFile, index: i });
        if (built) {
          const out = `vt${i}`;
          filters.push(`[${vLabel}]${built}[${out}]`);
          vLabel = out;
        }
      }
      if (capsOn) warnings.push('This ffmpeg build cannot burn in captions (no libass). Export captions as .srt and upload them to YouTube instead.');
    } else {
      warnings.push('This ffmpeg build has neither libass nor drawtext, so titles and captions cannot be burned in. Install a full ffmpeg (brew install ffmpeg / apt install ffmpeg).');
    }
  }

  // Watermark / logo overlay.
  if (project.watermark?.enabled && project.watermark.path && fs.existsSync(project.watermark.path)) {
    const wm = project.watermark;
    const size = Math.round(W * clamp(num(wm.size, 0.12), 0.01, 1));
    const pad = Math.round(W * clamp(num(wm.margin, 0.03), 0, 0.4));
    const idx = addInput(['-loop', '1', '-framerate', String(fps), '-t', String(r2(duration)), '-i', wm.path]);
    filters.push(`[${idx}:v]format=rgba,scale=${size}:-1,colorchannelmixer=aa=${r2(clamp(num(wm.opacity, 0.8), 0, 1))}[wm]`);
    const pos = {
      'top-left': `x=${pad}:y=${pad}`,
      'top-right': `x=W-w-${pad}:y=${pad}`,
      'bottom-left': `x=${pad}:y=H-h-${pad}`,
      'bottom-right': `x=W-w-${pad}:y=H-h-${pad}`,
    }[wm.position || 'bottom-right'];
    filters.push(`[${vLabel}][wm]overlay=${pos}:eof_action=pass:repeatlast=0[vwm]`);
    vLabel = 'vwm';
  }

  // Re-frame for a delivery size that differs from the project canvas
  // (e.g. exporting a 16:9 edit as a 9:16 Short).
  const target = opts.target;
  if (target && target.width > 0 && target.height > 0 && (target.width !== W || target.height !== H)) {
    const TW = Math.round(target.width / 2) * 2;
    const TH = Math.round(target.height / 2) * 2;
    const mode = target.mode || 'fit';
    if (mode === 'fill') {
      filters.push(`[${vLabel}]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH}[vfit]`);
      vLabel = 'vfit';
    } else if (mode === 'blur') {
      filters.push(`[${vLabel}]split=2[vbgsrc][vfgsrc]`);
      filters.push(`[vbgsrc]scale=${TW}:${TH}:force_original_aspect_ratio=increase,crop=${TW}:${TH},gblur=sigma=${Math.max(10, Math.round(TW / 40))},eq=brightness=-0.1[vbg]`);
      filters.push(`[vfgsrc]scale=${TW}:${TH}:force_original_aspect_ratio=decrease[vfg]`);
      filters.push(`[vbg][vfg]overlay=x=(W-w)/2:y=(H-h)/2[vfit]`);
      vLabel = 'vfit';
    } else {
      filters.push(`[${vLabel}]scale=${TW}:${TH}:force_original_aspect_ratio=decrease,pad=${TW}:${TH}:(ow-iw)/2:(oh-ih)/2:color=${bg}[vfit]`);
      vLabel = 'vfit';
    }
  }

  const outFps = target?.fps ? clamp(num(target.fps, fps), 1, 240) : fps;
  if (opts.gif) {
    // Per-clip palette keeps gradients from banding without a temp palette file.
    filters.push(`[${vLabel}]fps=${outFps},split=2[gsrc][gpal]`);
    filters.push(`[gpal]palettegen=stats_mode=diff[pal]`);
    filters.push(`[gsrc][pal]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[vout]`);
  } else if (opts.stillFrame) {
    filters.push(`[${vLabel}]format=rgb24[vout]`);
  } else {
    filters.push(`[${vLabel}]format=yuv420p,fps=${outFps},setsar=1[vout]`);
  }

  // ---- audio mixdown -------------------------------------------------------
  const aoutLabel = !wantAudio
    ? null
    : buildAudioMix({
        filters,
        audioLabels,
        audioGroups,
        project,
        duration,
        sampleRate: settings.sampleRate,
      });

  const args = ['-hide_banner', '-nostdin', '-y'];
  for (const inp of inputs) args.push(...inp);
  if (wantAudio && !audioLabels.length) {
    args.push('-f', 'lavfi', '-t', String(r2(duration)), '-i', `anullsrc=r=${settings.sampleRate}:cl=stereo`);
  }
  args.push('-filter_complex', filters.join(';'));
  args.push('-map', '[vout]');
  if (wantAudio) {
    if (audioLabels.length) args.push('-map', `[${aoutLabel}]`);
    else args.push('-map', `${inputs.length}:a`);
  } else {
    args.push('-an');
  }
  args.push('-t', String(r2(duration)));

  return { args, duration, settings, inputCount: inputs.length, filterGraph: filters.join(';'), warnings };
}

function pushAudio({ filters, input, index, clip, track, localStart, localDur, speed, sampleRate }) {
  const chain = ['asetpts=PTS-STARTPTS'];
  if (speed !== 1) chain.push(...atempoChain(speed));
  chain.push(`aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=stereo`);
  chain.push(`atrim=duration=${r2(localDur)}`, 'asetpts=PTS-STARTPTS');

  const gain = clamp(num(clip.volume, 1), 0, 4) * clamp(num(track.volume, 1), 0, 4);
  if (Math.abs(gain - 1) > 1e-3) chain.push(`volume=${r2(gain)}`);

  const fadeIn = clamp(num(clip.audioFadeIn ?? clip.fadeIn), 0, localDur / 2);
  const fadeOut = clamp(num(clip.audioFadeOut ?? clip.fadeOut), 0, localDur / 2);
  if (fadeIn > 0) chain.push(`afade=t=in:st=0:d=${r2(fadeIn)}`);
  if (fadeOut > 0) chain.push(`afade=t=out:st=${r2(localDur - fadeOut)}:d=${r2(fadeOut)}`);

  if (clip.denoise) chain.push('afftdn=nf=-25');
  if (clip.highpass) chain.push('highpass=f=80');

  if (localStart > 0) {
    const ms = Math.round(localStart * 1000);
    chain.push(`adelay=${ms}|${ms}:all=1`);
  }
  const label = `ac${index}`;
  filters.push(`[${input}]${chain.join(',')}[${label}]`);
  return label;
}

function mixInto(filters, labels, outLabel, duration) {
  if (!labels.length) return null;
  if (labels.length === 1) {
    filters.push(`[${labels[0]}]anull[${outLabel}]`);
    return outLabel;
  }
  filters.push(`${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0:duration=longest[${outLabel}]`);
  return outLabel;
}

function buildAudioMix({ filters, audioLabels, audioGroups, project, duration, sampleRate }) {
  if (!audioLabels.length) return null;
  const audioOpts = project.audio || {};
  const duckEnabled = Boolean(audioOpts.ducking?.enabled) && audioGroups.music.length > 0;
  const { filters: available } = capabilities();

  let label;
  if (duckEnabled && available.has('sidechaincompress')) {
    const speech = [...audioGroups.voice, ...audioGroups.other];
    const musicMix = mixInto(filters, audioGroups.music, 'amusic', duration);
    if (!speech.length) {
      label = musicMix;
    } else {
      const speechMix = mixInto(filters, speech, 'aspeech', duration);
      filters.push(`[${speechMix}]asplit=2[aspeechA][aspeechB]`);
      const amount = clamp(num(audioOpts.ducking.amount, 0.7), 0, 1);
      const ratio = r2(1 + amount * 15);
      filters.push(
        `[${musicMix}][aspeechA]sidechaincompress=threshold=0.03:ratio=${ratio}:attack=${Math.round(num(audioOpts.ducking.attack, 20))}:release=${Math.round(num(audioOpts.ducking.release, 350))}:makeup=1[aducked]`
      );
      filters.push('[aducked][aspeechB]amix=inputs=2:normalize=0:dropout_transition=0:duration=longest[amixed]');
      label = 'amixed';
    }
  } else {
    label = mixInto(filters, audioLabels, 'amixed', duration);
  }

  const post = [`aformat=sample_fmts=fltp:sample_rates=${sampleRate}:channel_layouts=stereo`];
  const master = clamp(num(audioOpts.masterVolume, 1), 0, 4);
  if (Math.abs(master - 1) > 1e-3) post.push(`volume=${r2(master)}`);
  if (audioOpts.normalize && available.has('loudnorm')) {
    const target = clamp(num(audioOpts.loudnessTarget, -14), -40, -5); // -14 LUFS = YouTube
    post.push(`loudnorm=I=${target}:TP=-1.5:LRA=11`);
  }
  if (available.has('alimiter')) post.push('alimiter=limit=0.97:level=disabled');
  post.push(`apad`, `atrim=duration=${r2(duration)}`, 'asetpts=PTS-STARTPTS');
  filters.push(`[${label}]${post.join(',')}[aout]`);
  return 'aout';
}

/** A title clip becomes a drawtext filter; the copy lives in a sidecar file so
 *  quotes, colons and emoji in user text can never break the graph. */
function buildTextFilter(item, { W, H, workDir, fontFile, index, scale }) {
  const t = item.clip.text || {};
  const content = String(t.content ?? '').replace(/\r\n/g, '\n');
  if (!content.trim()) return null;

  const file = path.join(workDir, `text-${index}-${Date.now()}.txt`);
  fs.writeFileSync(file, content, 'utf8');

  const size = Math.max(6, Math.round(num(t.size, 64) * (W / 1920) ));
  const color = ffColor(t.color || '#ffffff', 'white');
  const parts = [
    `textfile='${escapePath(file)}'`,
    'expansion=none',
    `fontsize=${size}`,
    `fontcolor=${color}`,
    `line_spacing=${Math.round(size * clamp(num(t.lineHeight, 0.25), 0, 2))}`,
  ];
  if (fontFile) parts.push(`fontfile='${escapePath(fontFile)}'`);
  else if (t.font) parts.push(`font='${escapeArg(t.font)}'`);

  // Position: normalised 0..1 anchor across the canvas.
  const px = clamp(num(t.x, 0.5), 0, 1);
  const py = clamp(num(t.y, 0.5), 0, 1);
  const align = t.align || 'center';
  const xExpr = align === 'left' ? `${Math.round(px * W)}` : align === 'right' ? `${Math.round(px * W)}-tw` : `${Math.round(px * W)}-tw/2`;
  parts.push(`x=${xExpr}`, `y=${Math.round(py * H)}-th/2`);

  if (t.background && t.background !== 'none') {
    parts.push('box=1', `boxcolor=${ffColor(t.background, 'black@0.6')}`, `boxborderw=${Math.round(size * clamp(num(t.padding, 0.3), 0, 3))}`);
  }
  const strokeW = num(t.strokeWidth, 0);
  if (strokeW > 0) {
    parts.push(`borderw=${Math.max(1, Math.round(strokeW * (W / 1920)))}`, `bordercolor=${ffColor(t.strokeColor || '#000000', 'black')}`);
  }
  if (t.shadow) {
    parts.push(`shadowx=${Math.max(1, Math.round(size * 0.06))}`, `shadowy=${Math.max(1, Math.round(size * 0.06))}`, `shadowcolor=${ffColor(t.shadowColor || '#000000cc', 'black@0.7')}`);
  }

  // Fade the title in/out by animating alpha over the clip's own window.
  const fi = clamp(num(item.clip.fadeIn), 0, item.duration / 2);
  const fo = clamp(num(item.clip.fadeOut), 0, item.duration / 2);
  const s = r2(item.start);
  const e = r2(item.start + item.duration);
  if (fi > 0 || fo > 0) {
    const inExpr = fi > 0 ? `min(1\\,(t-${s})/${r2(fi)})` : '1';
    const outExpr = fo > 0 ? `min(1\\,(${e}-t)/${r2(fo)})` : '1';
    parts.push(`alpha='if(between(t\\,${s}\\,${e})\\,max(0\\,min(${inExpr}\\,${outExpr}))\\,0)'`);
  }
  parts.push(`enable='between(t,${s},${e})'`);
  return `drawtext=${parts.join(':')}`;
}

const assTime = (sec) => {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${rest.toFixed(2).padStart(5, '0')}`;
};

/** #rrggbb -> ASS &HAABBGGRR (note: reversed channels, and alpha is inverted). */
const assColor = (hex, alpha = 0) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '#ffffff'));
  const [r, g, b] = m ? [m[1], m[2], m[3]] : ['ff', 'ff', 'ff'];
  const a = Math.round(clamp(alpha, 0, 1) * 255).toString(16).padStart(2, '0');
  return `&H${a}${b}${g}${r}`.toUpperCase();
};

/** Escape user copy for an ASS dialogue line. */
function assText(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r\n/g, '\n')
    .replace(/\n/g, '\\N');
}

const ALIGN_AN = { left: 4, center: 5, right: 6 };
const CAPTION_AN = {
  'bottom-left': 1, bottom: 2, 'bottom-right': 3,
  'middle-left': 4, middle: 5, 'middle-right': 6,
  'top-left': 7, top: 8, 'top-right': 9,
};

/**
 * One ASS file covering every title clip and every caption line.
 *
 * Titles are absolutely positioned with \pos so they land exactly where the
 * editor previewed them; captions use ASS margins/alignment so they behave
 * like normal subtitles.
 */
export function buildAssDocument({ titles = [], captions = null, W, H, fontFile, offset = 0 }) {
  const unit = Math.min(W, H) / 1080; // keep type the same relative size at any canvas
  const baseFamily = fontFile ? familyName(fontFile) : 'Sans';
  const styles = [];
  const events = [];

  // --- caption style ---
  if (captions) {
    const st = captions.style || {};
    const size = Math.round(num(st.size, 54) * unit);
    const family = st.fontFile ? familyName(st.fontFile) : st.fontName || baseFamily;
    styles.push(
      `Style: Caption,${family},${size},${assColor(st.color || '#ffffff')},${assColor(st.highlight || '#ffe600')},` +
        `${assColor(st.outlineColor || '#000000')},${assColor(st.boxColor || '#000000', st.boxed ? 0.25 : 0.5)},` +
        `${st.bold === false ? 0 : -1},${st.italic ? -1 : 0},0,0,100,100,${r2(num(st.letterSpacing, 0) * unit)},0,` +
        `${st.boxed ? 3 : 1},${r2(Math.max(0, num(st.outline, 3)) * unit)},${r2(Math.max(0, num(st.shadow, 1)) * unit)},` +
        `${CAPTION_AN[st.position || 'bottom'] ?? 2},${Math.round(num(st.marginH, 80) * unit)},${Math.round(num(st.marginH, 80) * unit)},` +
        `${Math.round(num(st.marginV, 120) * unit)},1`
    );
    for (const c of captions.items || []) {
      const start = num(c.start) - offset;
      const end = num(c.end) - offset;
      if (end <= 0 || !String(c.text || '').trim()) continue;
      events.push(`Dialogue: 1,${assTime(Math.max(0, start))},${assTime(end)},Caption,,0,0,0,,${assText(c.text)}`);
    }
  }

  // --- one style per title clip ---
  titles.forEach((item, i) => {
    const t = item.clip.text || {};
    let content = String(t.content ?? '');
    if (!content.trim()) return;
    if (t.uppercase) content = content.toUpperCase();

    const size = Math.round(num(t.size, 64) * unit);
    const family = t.fontFile ? familyName(t.fontFile) : t.fontName || baseFamily;
    const align = ALIGN_AN[t.align || 'center'] ?? 5;
    const boxed = Boolean(t.background && t.background !== 'none');
    const outline = boxed
      ? Math.max(2, num(t.padding, 0.35) * size)
      : Math.max(0, num(t.strokeWidth, 0)) * unit;
    const wrapMargin = Math.round(((1 - clamp(num(t.maxWidth, 0.86), 0.1, 1)) / 2) * W);

    styles.push(
      `Style: T${i},${family},${size},${assColor(t.color || '#ffffff')},${assColor(t.color || '#ffffff')},` +
        `${assColor(boxed ? t.background : t.strokeColor || '#000000', boxed ? clamp(1 - num(t.backgroundOpacity, 0.75), 0, 1) : 0)},` +
        `${assColor(t.shadowColor || '#000000', t.shadow ? 0.3 : 1)},` +
        `${t.bold === false ? 0 : -1},${t.italic ? -1 : 0},${t.underline ? -1 : 0},0,100,100,` +
        `${r2(num(t.letterSpacing, 0) * unit)},0,${boxed ? 3 : 1},${r2(outline)},` +
        `${t.shadow ? r2(Math.max(1, size * 0.06)) : 0},${align},${wrapMargin},${wrapMargin},20,1`
    );

    const x = Math.round(clamp(num(t.x, 0.5), 0, 1) * W);
    const y = Math.round(clamp(num(t.y, 0.5), 0, 1) * H);
    const tags = [`\\pos(${x},${y})`, `\\an${align}`];
    const fadeIn = Math.round(clamp(num(item.clip.fadeIn), 0, item.duration / 2) * 1000);
    const fadeOut = Math.round(clamp(num(item.clip.fadeOut), 0, item.duration / 2) * 1000);
    if (fadeIn || fadeOut) tags.push(`\\fad(${fadeIn},${fadeOut})`);
    const rotation = num(item.clip.transform?.rotation ?? t.rotation);
    if (rotation) tags.push(`\\frz${r2(-rotation)}`);
    const opacity = clamp(num(item.clip.transform?.opacity, 1), 0, 1);
    if (opacity < 1) tags.push(`\\alpha&H${Math.round((1 - opacity) * 255).toString(16).padStart(2, '0').toUpperCase()}&`);

    events.push(
      `Dialogue: 0,${assTime(item.start)},${assTime(item.start + item.duration)},T${i},,0,0,0,,{${tags.join('')}}${assText(content)}`
    );
  });

  if (!events.length) return null;

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: None

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}

/** Standalone .ass for "burn captions only" / external subtitle export. */
export function buildAss(captions, opts) {
  return buildAssDocument({ titles: [], captions, ...opts }) || '';
}
