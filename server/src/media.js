// Importing media, plus the derived data the timeline UI needs:
// duration/geometry, a poster frame, a filmstrip sprite and waveform peaks.
import fs from 'node:fs';
import path from 'node:path';
import { probe, run, runBinary } from './ffmpeg.js';
import { DIRS, fileKey, id } from './storage.js';

const VIDEO_EXT = /\.(mp4|mov|m4v|mkv|webm|avi|mts|m2ts|mpg|mpeg|wmv|flv|ogv|3gp|braw|mxf)$/i;
const AUDIO_EXT = /\.(mp3|wav|aac|m4a|flac|ogg|oga|opus|wma|aiff|aif)$/i;
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|heic|avif)$/i;

export function kindFor(file) {
  if (VIDEO_EXT.test(file)) return 'video';
  if (AUDIO_EXT.test(file)) return 'audio';
  if (IMAGE_EXT.test(file)) return 'image';
  return null;
}

export const MEDIA_EXTENSIONS = { video: VIDEO_EXT, audio: AUDIO_EXT, image: IMAGE_EXT };

const parseRate = (r) => {
  if (!r) return 0;
  const [n, d] = String(r).split('/').map(Number);
  if (!d) return n || 0;
  return d === 0 ? 0 : n / d;
};

/** Read metadata for a file on disk and normalise it into a media record. */
export async function inspect(file) {
  const info = await probe(file);
  const streams = info.streams || [];
  const v = streams.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = streams.find((s) => s.codec_type === 'audio');
  const kind = kindFor(file) || (v ? 'video' : a ? 'audio' : 'image');

  let width = Number(v?.width) || 0;
  let height = Number(v?.height) || 0;

  // Honour rotation metadata so portrait phone footage reports portrait dims.
  let rotation = 0;
  const sd = (v?.side_data_list || []).find((s) => s.rotation != null);
  if (sd) rotation = Number(sd.rotation) || 0;
  else if (v?.tags?.rotate) rotation = Number(v.tags.rotate) || 0;
  if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) [width, height] = [height, width];

  const duration =
    Number(info.format?.duration) ||
    Number(v?.duration) ||
    Number(a?.duration) ||
    (kind === 'image' ? 5 : 0);

  return {
    id: id('m_'),
    key: fileKey(file),
    name: path.basename(file),
    path: path.resolve(file),
    kind: kind === 'image' ? 'image' : v ? 'video' : 'audio',
    duration: Math.max(0, Number(duration.toFixed(3))),
    width,
    height,
    fps: parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate) || 0,
    rotation,
    hasVideo: Boolean(v),
    hasAudio: Boolean(a),
    videoCodec: v?.codec_name || null,
    audioCodec: a?.codec_name || null,
    channels: Number(a?.channels) || 0,
    sampleRate: Number(a?.sample_rate) || 0,
    bitrate: Number(info.format?.bit_rate) || 0,
    size: (() => {
      try {
        return fs.statSync(file).size;
      } catch {
        return 0;
      }
    })(),
  };
}

function cachePath(key, suffix) {
  return path.join(DIRS.cache, `${key}${suffix}`);
}

/** Single representative frame, used for media-bin cards. */
export async function poster(media) {
  const out = cachePath(media.key, '-poster.jpg');
  if (fs.existsSync(out)) return out;
  if (media.kind === 'audio') return null;
  const at = media.kind === 'image' ? 0 : Math.min(Math.max(media.duration * 0.1, 0.1), Math.max(0.1, media.duration - 0.05));
  await run([
    '-hide_banner', '-nostdin', '-y',
    '-ss', String(at.toFixed(3)),
    '-i', media.path,
    '-frames:v', '1',
    '-vf', 'scale=480:-2:flags=bicubic',
    '-q:v', '4',
    out,
  ]);
  return out;
}

/**
 * Horizontal sprite of evenly spaced frames, drawn behind clips on the timeline.
 * One tiled JPEG beats N requests when a project has hundreds of clips.
 */
export async function filmstrip(media, { height = 72 } = {}) {
  const out = cachePath(media.key, `-strip${height}.jpg`);
  const metaFile = `${out}.json`;
  if (fs.existsSync(out) && fs.existsSync(metaFile)) {
    return { path: out, ...JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
  }
  if (media.kind === 'audio' || !media.duration) return null;

  const count = media.kind === 'image' ? 1 : Math.max(8, Math.min(80, Math.round(media.duration / 2) || 8));
  const interval = Math.max(0.05, media.duration / count);
  const aspect = media.width && media.height ? media.width / media.height : 16 / 9;
  const tileW = Math.max(2, Math.round((height * aspect) / 2) * 2);

  const vf =
    media.kind === 'image'
      ? `scale=${tileW}:${height}`
      : `fps=1/${interval.toFixed(4)},scale=${tileW}:${height}:force_original_aspect_ratio=increase,crop=${tileW}:${height},tile=${count}x1`;

  await run(['-hide_banner', '-nostdin', '-y', '-i', media.path, '-vf', vf, '-frames:v', '1', '-q:v', '5', out]);
  const meta = { count, interval, tileWidth: tileW, tileHeight: height };
  fs.writeFileSync(metaFile, JSON.stringify(meta));
  return { path: out, ...meta };
}

/**
 * Min/max peaks per bucket. Decoded to low-rate mono PCM so even long
 * podcasts come back in well under a second.
 */
export async function waveform(media, { buckets = 2000 } = {}) {
  const out = cachePath(media.key, `-wave${buckets}.json`);
  if (fs.existsSync(out)) return JSON.parse(fs.readFileSync(out, 'utf8'));
  if (!media.hasAudio) return { peaks: [], duration: media.duration, buckets: 0 };

  const rate = 4000;
  const pcm = await runBinary([
    '-hide_banner', '-nostdin',
    '-i', media.path,
    '-map', '0:a:0',
    '-ac', '1',
    '-ar', String(rate),
    '-f', 's16le',
    '-',
  ]);

  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const n = Math.max(1, Math.min(buckets, samples.length));
  const per = samples.length / n;
  const peaks = new Array(n * 2);
  for (let i = 0; i < n; i += 1) {
    const from = Math.floor(i * per);
    const to = Math.min(samples.length, Math.floor((i + 1) * per));
    let min = 0;
    let max = 0;
    for (let j = from; j < to; j += 1) {
      const s = samples[j];
      if (s < min) min = s;
      if (s > max) max = s;
    }
    peaks[i * 2] = Math.round((min / 32768) * 1000) / 1000;
    peaks[i * 2 + 1] = Math.round((max / 32768) * 1000) / 1000;
  }
  const result = { peaks, duration: media.duration, buckets: n };
  fs.writeFileSync(out, JSON.stringify(result));
  return result;
}

/**
 * Silence ranges from ffmpeg's silencedetect, converted into the "keep"
 * segments that drive auto jump cuts.
 *
 * @param {number} threshold  dBFS below which audio counts as silence
 * @param {number} minSilence shortest gap worth cutting (seconds)
 * @param {number} padding    lead/tail kept around speech so cuts breathe
 */
export async function detectSilence(media, { threshold = -32, minSilence = 0.45, padding = 0.08 } = {}) {
  if (!media.hasAudio) return { silences: [], segments: [{ start: 0, end: media.duration }], removed: 0 };

  const { stderr } = await run([
    '-hide_banner', '-nostdin',
    '-i', media.path,
    '-map', '0:a:0',
    '-af', `silencedetect=noise=${threshold}dB:d=${minSilence}`,
    '-f', 'null', '-',
  ]);

  const silences = [];
  let openStart = null;
  for (const line of stderr.split(/\r?\n/)) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line);
    if (s) {
      openStart = Math.max(0, parseFloat(s[1]));
      continue;
    }
    const e = /silence_end:\s*([\d.]+)/.exec(line);
    if (e && openStart != null) {
      silences.push({ start: openStart, end: parseFloat(e[1]) });
      openStart = null;
    }
  }
  if (openStart != null) silences.push({ start: openStart, end: media.duration });

  // Invert silences into keep-segments, padding each side so words aren't clipped.
  const segments = [];
  let cursor = 0;
  for (const s of silences) {
    const cutStart = Math.min(media.duration, s.start + padding);
    const cutEnd = Math.max(0, s.end - padding);
    if (cutEnd - cutStart < minSilence * 0.5) continue;
    if (cutStart > cursor) segments.push({ start: cursor, end: cutStart });
    cursor = cutEnd;
  }
  if (cursor < media.duration) segments.push({ start: cursor, end: media.duration });

  const kept = segments.reduce((sum, s) => sum + (s.end - s.start), 0);
  return {
    silences,
    segments: segments.filter((s) => s.end - s.start > 0.05),
    removed: Math.max(0, Number((media.duration - kept).toFixed(2))),
  };
}

/** Integrated loudness, so the UI can tell you how far off YouTube's -14 LUFS you are. */
export async function loudness(media) {
  if (!media.hasAudio) return null;
  const { stderr } = await run([
    '-hide_banner', '-nostdin',
    '-i', media.path,
    '-map', '0:a:0',
    '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json',
    '-f', 'null', '-',
  ]);
  const match = stderr.slice(stderr.lastIndexOf('{')).match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const json = JSON.parse(match[0]);
    return {
      integrated: Number(json.input_i),
      truePeak: Number(json.input_tp),
      range: Number(json.input_lra),
      threshold: Number(json.input_thresh),
    };
  } catch {
    return null;
  }
}

/** Codecs no mainstream browser will decode, so previewing them needs a proxy. */
const NEEDS_PROXY = /^(hevc|h265|prores|dnxhd|mjpeg|mpeg2video|mpeg4|wmv[123]|vc1|vp6|av1|cinepak|rawvideo|ffv1|huffyuv|dvvideo)$/i;

export function wantsProxy(media) {
  if (media.kind !== 'video') return false;
  if (media.videoCodec && NEEDS_PROXY.test(media.videoCodec)) return true;
  // Big frames chew through decode budget even when the codec is fine.
  return media.width * media.height > 2560 * 1440;
}

/**
 * A small, universally decodable stand-in used for preview only — exports
 * always go back to the original file.
 */
export async function proxy(media, { height = 720, onLog, signal } = {}) {
  const out = cachePath(media.key, `-proxy${height}.mp4`);
  if (fs.existsSync(out) && fs.statSync(out).size > 0) return out;
  if (media.kind === 'image') return null;

  // Keep a real extension on the temp file — ffmpeg picks the muxer from it.
  const partial = out.replace(/\.mp4$/, '.partial.mp4');
  const args = [
    '-hide_banner', '-nostdin', '-y',
    '-i', media.path,
  ];
  if (media.hasVideo) {
    args.push('-vf', `scale=-2:'min(${height},ih)':flags=fast_bilinear`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '48');
  } else {
    args.push('-vn');
  }
  if (media.hasAudio) args.push('-c:a', 'aac', '-b:a', '160k', '-ac', '2');
  else args.push('-an');
  args.push('-movflags', '+faststart', '-f', 'mp4', partial);

  await run(args, { onLog, signal });
  fs.renameSync(partial, out);
  return out;
}

export function proxyPath(media, height = 720) {
  const out = cachePath(media.key, `-proxy${height}.mp4`);
  return fs.existsSync(out) ? out : null;
}
