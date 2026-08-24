// Export presets and the encoder flags behind them.
import { pickVideoEncoder, isHardwareEncoder, capabilities } from './ffmpeg.js';

/** Ready-made targets for the places creators actually publish. */
export const PRESETS = [
  { id: 'youtube-2160', label: 'YouTube 4K', width: 3840, height: 2160, fps: 30, videoBitrate: '45M', group: 'YouTube' },
  { id: 'youtube-1440', label: 'YouTube 1440p', width: 2560, height: 1440, fps: 30, videoBitrate: '16M', group: 'YouTube' },
  { id: 'youtube-1080', label: 'YouTube 1080p', width: 1920, height: 1080, fps: 30, videoBitrate: '12M', group: 'YouTube', default: true },
  { id: 'youtube-1080-60', label: 'YouTube 1080p60', width: 1920, height: 1080, fps: 60, videoBitrate: '18M', group: 'YouTube' },
  { id: 'youtube-720', label: 'YouTube 720p', width: 1280, height: 720, fps: 30, videoBitrate: '7M', group: 'YouTube' },
  { id: 'shorts-1080', label: 'Shorts / Reels / TikTok', width: 1080, height: 1920, fps: 30, videoBitrate: '12M', group: 'Vertical' },
  { id: 'square-1080', label: 'Square 1:1', width: 1080, height: 1080, fps: 30, videoBitrate: '10M', group: 'Social' },
  { id: 'draft-720', label: 'Fast draft 720p', width: 1280, height: 720, fps: 30, crf: 28, speed: 'veryfast', group: 'Utility' },
  { id: 'audio-only', label: 'Audio only (MP3)', audioOnly: true, group: 'Utility' },
  { id: 'gif', label: 'Animated GIF', width: 640, height: -1, fps: 15, gif: true, group: 'Utility' },
];

export function getPreset(id) {
  return PRESETS.find((p) => p.id === id) || PRESETS.find((p) => p.default);
}

const QUALITY_CRF = { low: 28, medium: 23, high: 20, max: 17 };

/**
 * Output-side ffmpeg flags. Kept separate from the filter graph so the same
 * compiled timeline can be written out as a draft, a master, or a still.
 */
export function buildOutputArgs({
  format = 'mp4',
  codec = 'h264',
  quality = 'high',
  videoBitrate = null,
  audioBitrate = '320k',
  fps = 30,
  hardware = true,
  speed = 'medium',
  audioOnly = false,
  gif = false,
  threads = 0,
} = {}) {
  if (audioOnly) {
    return ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'];
  }
  if (gif) {
    // Two-pass palette in one graph gives clean colours without a temp file.
    return ['-c:v', 'gif', '-loop', '0'];
  }

  const encoder = pickVideoEncoder({ codec, preferHardware: hardware });
  const args = ['-c:v', encoder];
  const hw = isHardwareEncoder(encoder);

  if (hw) {
    args.push('-b:v', videoBitrate || '12M');
    if (encoder.includes('nvenc')) args.push('-preset', 'p5', '-rc', 'vbr', '-cq', String(QUALITY_CRF[quality] ?? 20));
    if (encoder.includes('videotoolbox')) args.push('-allow_sw', '1');
  } else if (videoBitrate) {
    args.push('-b:v', videoBitrate, '-maxrate', videoBitrate, '-bufsize', `${parseInt(videoBitrate, 10) * 2}M`);
    args.push('-preset', speed);
  } else {
    args.push('-crf', String(QUALITY_CRF[quality] ?? 20), '-preset', speed);
  }

  if (encoder === 'libx264') args.push('-profile:v', 'high', '-level', '4.2');
  args.push('-pix_fmt', 'yuv420p', '-g', String(Math.round(fps * 2)), '-r', String(fps));

  const { encoders } = capabilities();
  const aac = encoders.has('libfdk_aac') ? 'libfdk_aac' : 'aac';
  args.push('-c:a', aac, '-b:a', audioBitrate, '-ar', '48000', '-ac', '2');

  if (format === 'mp4' || format === 'mov') args.push('-movflags', '+faststart');
  if (threads) args.push('-threads', String(threads));
  return args;
}

export function extensionFor({ format = 'mp4', audioOnly = false, gif = false }) {
  if (audioOnly) return 'mp3';
  if (gif) return 'gif';
  return format;
}
