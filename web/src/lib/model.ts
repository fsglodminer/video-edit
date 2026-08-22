import type { Clip, Media, Project, TextStyle, Track, Transform } from './types';

export const uid = (prefix = '') => `${prefix}${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

export const DEFAULT_TRANSFORM: Transform = { fit: 'contain', scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };

export const clipEnd = (clip: Clip) => clip.start + clip.duration;

export function projectDuration(project: Project): number {
  let end = 0;
  for (const track of project.tracks) for (const clip of track.clips) end = Math.max(end, clipEnd(clip));
  if (project.captions?.enabled) for (const c of project.captions.items) end = Math.max(end, c.end);
  return end;
}

export function findMedia(project: Project, mediaId?: string): Media | undefined {
  return mediaId ? project.media.find((m) => m.id === mediaId) : undefined;
}

export function findClip(project: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** Longest a clip can be, given its source and where its in-point sits. */
export function maxDuration(project: Project, clip: Clip): number {
  const media = findMedia(project, clip.mediaId);
  if (!media || clip.type === 'text' || clip.type === 'solid' || media.kind === 'image') return Infinity;
  return Math.max(0.05, (media.duration - clip.inPoint) / (clip.speed || 1));
}

export function makeClip(media: Media, start: number, overrides: Partial<Clip> = {}): Clip {
  const isImage = media.kind === 'image';
  return {
    id: uid('c_'),
    type: isImage ? 'image' : media.hasVideo ? 'video' : 'audio',
    mediaId: media.id,
    name: media.name,
    start,
    duration: isImage ? 5 : media.duration,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    transform: { ...DEFAULT_TRANSFORM, fit: 'cover' },
    effects: {},
    ...overrides,
  };
}

export const DEFAULT_TEXT: TextStyle = {
  content: 'Your title here',
  size: 72,
  color: '#ffffff',
  align: 'center',
  x: 0.5,
  y: 0.5,
  bold: true,
  uppercase: false,
  strokeWidth: 6,
  strokeColor: '#000000',
  shadow: true,
  shadowColor: '#000000',
  background: 'none',
  backgroundOpacity: 0.75,
  padding: 0.35,
  letterSpacing: 0,
  lineHeight: 0.25,
  maxWidth: 0.86,
};

export function makeTextClip(start: number, duration = 3, text: Partial<TextStyle> = {}): Clip {
  return {
    id: uid('c_'),
    type: 'text',
    name: text.content?.slice(0, 24) || 'Title',
    start,
    duration,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0.25,
    fadeOut: 0.25,
    transform: { ...DEFAULT_TRANSFORM },
    effects: {},
    text: { ...DEFAULT_TEXT, ...text },
  };
}

export const TEXT_PRESETS: { id: string; label: string; text: Partial<TextStyle> }[] = [
  { id: 'title', label: 'Big title', text: { content: 'BIG TITLE', size: 130, y: 0.45, uppercase: true, strokeWidth: 8 } },
  { id: 'lower-third', label: 'Lower third', text: { content: 'Your Name\nWhat you do', size: 52, x: 0.08, y: 0.8, align: 'left', strokeWidth: 0, shadow: true, background: '#000000', backgroundOpacity: 0.55, padding: 0.3 } },
  { id: 'subscribe', label: 'Subscribe nudge', text: { content: 'SUBSCRIBE', size: 64, y: 0.86, uppercase: true, color: '#ffffff', background: '#ff0033', backgroundOpacity: 1, padding: 0.35, strokeWidth: 0 } },
  { id: 'chapter', label: 'Chapter card', text: { content: '01 — Getting set up', size: 84, y: 0.5, align: 'center', strokeWidth: 0, shadow: false } },
  { id: 'caption-pop', label: 'Punch-in caption', text: { content: 'wait for it…', size: 96, y: 0.72, uppercase: false, color: '#ffe600', strokeWidth: 10, strokeColor: '#000000' } },
];

/** Insert a clip and keep the track ordered by start time. */
export function insertClip(track: Track, clip: Clip) {
  track.clips.push(clip);
  track.clips.sort((a, b) => a.start - b.start);
}

/** First gap on the track that can hold `duration` seconds at or after `from`. */
export function findFreeSlot(track: Track, from: number, duration: number, ignoreId?: string): number {
  const others = track.clips.filter((c) => c.id !== ignoreId).sort((a, b) => a.start - b.start);
  let cursor = from;
  for (const clip of others) {
    if (clipEnd(clip) <= cursor) continue;
    if (clip.start >= cursor + duration) break;
    cursor = clipEnd(clip);
  }
  return cursor;
}

export function overlaps(a: Clip, b: Clip) {
  return a.start < clipEnd(b) && b.start < clipEnd(a);
}

/** Split a clip at an absolute timeline position. Returns the new right-hand clip. */
export function splitClip(track: Track, clip: Clip, at: number): Clip | null {
  if (at <= clip.start + 0.04 || at >= clipEnd(clip) - 0.04) return null;
  const leftDuration = at - clip.start;
  const right: Clip = {
    ...structuredClone(clip),
    id: uid('c_'),
    start: at,
    duration: clip.duration - leftDuration,
    inPoint: clip.inPoint + leftDuration * clip.speed,
    fadeIn: 0,
  };
  clip.duration = leftDuration;
  clip.fadeOut = 0;
  insertClip(track, right);
  return right;
}

/** Remove a clip and pull everything after it back by its length. */
export function rippleDelete(track: Track, clip: Clip) {
  const gap = clip.duration;
  const from = clip.start;
  track.clips = track.clips.filter((c) => c.id !== clip.id);
  for (const c of track.clips) if (c.start >= from) c.start = Math.max(0, c.start - gap);
}

/** Close every gap on a track, butting clips up against each other. */
export function closeGaps(track: Track, from = 0) {
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  let cursor = from;
  for (const clip of sorted) {
    if (clip.start < from) {
      cursor = Math.max(cursor, clipEnd(clip));
      continue;
    }
    clip.start = cursor;
    cursor = clipEnd(clip);
  }
}

/**
 * Replace a clip with one clip per keep-segment, closing the removed silence.
 * This is the auto jump-cut: source times in, a tightened timeline out.
 */
export function applySegments(track: Track, clip: Clip, segments: { start: number; end: number }[], gap = 0): Clip[] {
  const inside = segments
    .map((s) => ({
      start: Math.max(s.start, clip.inPoint),
      end: Math.min(s.end, clip.inPoint + clip.duration * clip.speed),
    }))
    .filter((s) => s.end - s.start > 0.05);
  if (!inside.length) return [];

  const created: Clip[] = [];
  let cursor = clip.start;
  for (const seg of inside) {
    const duration = (seg.end - seg.start) / clip.speed;
    created.push({
      ...structuredClone(clip),
      id: uid('c_'),
      start: cursor,
      duration,
      inPoint: seg.start,
      fadeIn: 0,
      fadeOut: 0,
    });
    cursor += duration + gap;
  }
  if (created.length) {
    created[0].fadeIn = clip.fadeIn;
    created[created.length - 1].fadeOut = clip.fadeOut;
  }

  const shift = cursor - gap - clipEnd(clip);
  const index = track.clips.findIndex((c) => c.id === clip.id);
  track.clips.splice(index, 1, ...created);
  for (const c of track.clips) {
    if (created.some((n) => n.id === c.id)) continue;
    if (c.start >= clipEnd(clip)) c.start = Math.max(0, c.start + shift);
  }
  track.clips.sort((a, b) => a.start - b.start);
  return created;
}

/** Candidate positions a dragged edge should stick to. */
export function snapPoints(project: Project, exclude: Set<string>, playhead: number): number[] {
  const points = [0, playhead];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (exclude.has(clip.id)) continue;
      points.push(clip.start, clipEnd(clip));
    }
  }
  return points;
}

export function snap(value: number, points: number[], tolerance: number): number {
  let best = value;
  let bestDistance = tolerance;
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best;
}

export function formatTime(seconds: number, fps = 30, withFrames = false): string {
  if (!Number.isFinite(seconds)) return '--:--';
  const sign = seconds < 0 ? '-' : '';
  const s = Math.abs(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const frames = Math.floor((s % 1) * fps);
  const core = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return withFrames ? `${sign}${core}:${String(frames).padStart(2, '0')}` : `${sign}${core}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Rough estimate of where a clip's audio is loud, for drawing waveforms. */
export function trackOf(project: Project, clipId: string): Track | undefined {
  return project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
}
