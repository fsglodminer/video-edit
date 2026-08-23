import type { Clip, Media, Project, ShapeStyle, TextStyle, Track, Transform } from './types';

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

export const ASPECT_RATIOS = [
  { id: '16:9', label: '16:9', hint: 'YouTube', width: 1920, height: 1080 },
  { id: '9:16', label: '9:16', hint: 'Shorts, TikTok', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1', hint: 'Feed post', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5', hint: 'Instagram', width: 1080, height: 1350 },
  { id: '21:9', label: '21:9', hint: 'Cinematic', width: 2560, height: 1080 },
];

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
  animation: 'fade',
  animationDuration: 0.45,
};

export const DEFAULT_SHAPE: ShapeStyle = {
  kind: 'rect',
  x: 0.5,
  y: 0.5,
  width: 0.3,
  height: 0.2,
  color: '#7b61ff',
  strokeColor: '#ffffff',
  strokeWidth: 0,
  radius: 0.15,
  filled: true,
};

export function makeShapeClip(start: number, duration = 4, shape: Partial<ShapeStyle> = {}): Clip {
  return {
    id: uid('c_'),
    type: 'shape',
    name: `${shape.kind ?? DEFAULT_SHAPE.kind} shape`,
    start,
    duration,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0.2,
    fadeOut: 0.2,
    transform: { ...DEFAULT_TRANSFORM },
    effects: {},
    shape: { ...DEFAULT_SHAPE, ...shape },
  };
}

export function makeSolidClip(start: number, duration = 4, color = '#000000'): Clip {
  return {
    id: uid('c_'),
    type: 'solid',
    name: 'Background',
    start,
    duration,
    inPoint: 0,
    speed: 1,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    color,
    transform: { ...DEFAULT_TRANSFORM },
    effects: {},
  };
}

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

export const TEXT_PRESETS: { id: string; label: string; hint: string; text: Partial<TextStyle> }[] = [
  { id: 'title', label: 'Big title', hint: 'Bold opener', text: { content: 'BIG TITLE', size: 130, y: 0.45, uppercase: true, strokeWidth: 8, animation: 'pop' } },
  { id: 'lower-third', label: 'Lower third', hint: 'Name + role', text: { content: 'Your Name\nWhat you do', size: 52, x: 0.08, y: 0.8, align: 'left', strokeWidth: 0, shadow: true, background: '#000000', backgroundOpacity: 0.55, padding: 0.3, animation: 'slideup' } },
  { id: 'subscribe', label: 'Subscribe', hint: 'Call to action', text: { content: 'SUBSCRIBE', size: 64, y: 0.86, uppercase: true, color: '#ffffff', background: '#ff0033', backgroundOpacity: 1, padding: 0.35, strokeWidth: 0, animation: 'pop' } },
  { id: 'chapter', label: 'Chapter card', hint: 'Section break', text: { content: '01 — Getting set up', size: 84, y: 0.5, align: 'center', strokeWidth: 0, shadow: false, animation: 'fade' } },
  { id: 'caption-pop', label: 'Punch caption', hint: 'Yellow highlight', text: { content: 'wait for it…', size: 96, y: 0.72, color: '#ffe600', strokeWidth: 10, strokeColor: '#000000', animation: 'pop' } },
  { id: 'typewriter', label: 'Typewriter', hint: 'Types itself out', text: { content: 'typed one letter at a time', size: 64, y: 0.5, strokeWidth: 4, animation: 'typewriter' } },
  { id: 'quote', label: 'Quote', hint: 'Centred, light', text: { content: '“The best camera is the one you have.”', size: 60, y: 0.5, bold: false, italic: true, strokeWidth: 0, shadow: true, maxWidth: 0.7, animation: 'fade' } },
  { id: 'ticker', label: 'Corner label', hint: 'Small + boxed', text: { content: 'PART 1', size: 38, x: 0.12, y: 0.12, align: 'left', background: '#7b61ff', backgroundOpacity: 1, padding: 0.35, strokeWidth: 0, animation: 'slidedown' } },
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

/**
 * Apply a transition to the junction before `clip`, overlapping it with the
 * previous clip by `duration` and pulling everything after it back to match —
 * the way Clipchamp shortens the timeline when you drop a transition in.
 */
export function applyTransition(track: Track, clipId: string, type: string, duration = 0.6): boolean {
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  const index = sorted.findIndex((c) => c.id === clipId);
  if (index <= 0) return false;
  const clip = sorted[index];
  const previous = sorted[index - 1];

  const existing = clip.transitionIn ? Math.max(0, clipEnd(previous) - clip.start) : 0;
  const room = Math.min(previous.duration, clip.duration) * 0.9;
  const overlap = Math.min(Math.max(0.15, duration), room);
  // Where the clip should sit once it overlaps the previous one by `overlap`.
  const target = clipEnd(previous) - overlap + existing;
  const shift = target - clip.start;

  clip.transitionIn = { type, duration: overlap };
  for (const c of track.clips) {
    if (c.start >= clip.start - 1e-6 && c.id !== previous.id) c.start = Math.max(0, c.start + shift);
  }
  track.clips.sort((a, b) => a.start - b.start);
  return true;
}

/** Remove a transition and push the clip (and everything after) back out. */
export function removeTransition(track: Track, clipId: string): boolean {
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  const index = sorted.findIndex((c) => c.id === clipId);
  if (index <= 0 || !sorted[index].transitionIn) return false;
  const clip = sorted[index];
  const previous = sorted[index - 1];
  const overlap = Math.max(0, clipEnd(previous) - clip.start);
  clip.transitionIn = null;
  for (const c of track.clips) {
    if (c.start >= clip.start - 1e-6 && c.id !== previous.id) c.start += overlap;
  }
  track.clips.sort((a, b) => a.start - b.start);
  return true;
}

/** Junctions on a track where a transition could live. */
export function transitionPoints(track: Track): { clip: Clip; previous: Clip; at: number }[] {
  const sorted = [...track.clips].sort((a, b) => a.start - b.start);
  const out: { clip: Clip; previous: Clip; at: number }[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1];
    const clip = sorted[i];
    if (clip.type === 'text' || clip.type === 'shape' || previous.type === 'text' || previous.type === 'shape') continue;
    const gap = clip.start - clipEnd(previous);
    if (gap > 0.25) continue; // too far apart to read as a junction
    out.push({ clip, previous, at: clip.transitionIn ? (clip.start + clipEnd(previous)) / 2 : clip.start });
  }
  return out;
}
