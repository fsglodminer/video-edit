// Real-time preview compositor.
//
// The export path is ffmpeg; this is its browser twin. It draws the same
// layout maths onto a canvas (see `layout()` in server/src/compile.js) so the
// preview and the finished file agree on framing, scale and type size.
//
// Video/audio elements are pooled per clip and driven off a wall-clock
// playhead: seek them when scrubbing, let them play natively when rolling, and
// nudge them back only when they drift.
import type { CaptionItem, CaptionStyle, Clip, Media, Project, TextStyle } from '../lib/types';

type Sourced = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;

interface PooledElement {
  el: Sourced;
  clipId: string;
  mediaKey: string;
  lastUsed: number;
  ready: boolean;
}

const DRIFT_TOLERANCE = 0.22;
const POOL_TTL = 20_000;

export interface PreviewCallbacks {
  onTimeUpdate?: (t: number) => void;
  onEnded?: () => void;
  onLoading?: (loading: boolean) => void;
}

export class PreviewEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private project: Project | null = null;
  private pool = new Map<string, PooledElement>();
  private raf = 0;
  private playing = false;
  private clockStart = 0;
  private clockOrigin = 0;
  private time = 0;
  private dirty = true;
  private callbacks: PreviewCallbacks = {};
  private fileUrl: (path: string) => string;
  private watermarkImage: HTMLImageElement | null = null;
  private fontFamily = 'Inter, system-ui, sans-serif';
  private maxWidth = 1280;
  // Preview stand-ins for footage the browser cannot decode (HEVC, ProRes…).
  private proxies = new Map<string, string>();
  private proxyPending = new Set<string>();
  private proxyResolver: ((media: Media) => Promise<string | null>) | null = null;

  constructor(fileUrl: (path: string) => string) {
    this.fileUrl = fileUrl;
  }

  attach(canvas: HTMLCanvasElement, callbacks: PreviewCallbacks = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.callbacks = callbacks;
    this.resize();
    this.loop();
  }

  detach() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const p of this.pool.values()) this.release(p);
    this.pool.clear();
    this.canvas = null;
    this.ctx = null;
  }

  setProject(project: Project) {
    const sizeChanged =
      this.project?.settings.width !== project.settings.width || this.project?.settings.height !== project.settings.height;
    this.project = project;
    if (sizeChanged) this.resize();
    this.dirty = true;
  }

  /** Called when a source fails to decode; should return a playable file path. */
  setProxyResolver(resolver: (media: Media) => Promise<string | null>) {
    this.proxyResolver = resolver;
  }

  /** Use a proxy for this media from now on (e.g. after a manual build). */
  useProxy(mediaKey: string, path: string) {
    this.proxies.set(mediaKey, path);
    for (const pooled of [...this.pool.values()]) {
      if (pooled.mediaKey === mediaKey) this.release(pooled);
    }
    this.dirty = true;
  }

  setFontFamily(family: string) {
    this.fontFamily = family;
    this.dirty = true;
  }

  /** Backing store is capped for speed; all drawing maths is proportional. */
  private resize() {
    if (!this.canvas || !this.project) return;
    const { width, height } = this.project.settings;
    const scale = Math.min(1, this.maxWidth / Math.max(width, height));
    this.canvas.width = Math.max(2, Math.round((width * scale) / 2) * 2);
    this.canvas.height = Math.max(2, Math.round((height * scale) / 2) * 2);
    this.dirty = true;
  }

  get currentTime() {
    return this.time;
  }

  seek(t: number) {
    this.time = Math.max(0, t);
    if (this.playing) {
      this.clockStart = performance.now();
      this.clockOrigin = this.time;
    }
    this.dirty = true;
  }

  play() {
    if (this.playing) return;
    this.playing = true;
    this.clockStart = performance.now();
    this.clockOrigin = this.time;
    this.dirty = true;
  }

  pause() {
    this.playing = false;
    for (const p of this.pool.values()) {
      const el = p.el as HTMLMediaElement;
      if ('pause' in el) el.pause();
    }
    this.dirty = true;
  }

  /** Force a redraw (call after any project edit). */
  invalidate() {
    this.dirty = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.project || !this.ctx || !this.canvas) return;

    if (this.playing) {
      this.time = this.clockOrigin + (performance.now() - this.clockStart) / 1000;
      const total = this.duration();
      if (this.time >= total) {
        this.time = total;
        this.playing = false;
        this.pause();
        this.callbacks.onEnded?.();
      }
      this.callbacks.onTimeUpdate?.(this.time);
      this.dirty = true;
    }

    if (this.dirty) {
      this.syncElements();
      this.draw();
      this.dirty = this.playing;
    }
    this.prunePool();
  };

  private duration() {
    if (!this.project) return 0;
    let end = 0;
    for (const track of this.project.tracks) for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
    if (this.project.captions?.enabled) for (const c of this.project.captions.items) end = Math.max(end, c.end);
    return end;
  }

  private activeClips(): { clip: Clip; media?: Media; trackIndex: number; kind: 'video' | 'audio'; muted: boolean; volume: number }[] {
    if (!this.project) return [];
    const out: ReturnType<PreviewEngine['activeClips']> = [];
    this.project.tracks.forEach((track, trackIndex) => {
      if (track.kind === 'video' ? track.hidden : track.muted) return;
      for (const clip of track.clips) {
        if (this.time < clip.start - 0.001 || this.time >= clip.start + clip.duration) continue;
        out.push({
          clip,
          media: this.project!.media.find((m) => m.id === clip.mediaId),
          trackIndex,
          kind: track.kind,
          muted: Boolean(track.muted || clip.muted),
          volume: (track.volume ?? 1) * (clip.volume ?? 1),
        });
      }
    });
    return out;
  }

  private elementFor(clip: Clip, media: Media): PooledElement | null {
    const existing = this.pool.get(clip.id);
    if (existing && existing.mediaKey === media.key) {
      existing.lastUsed = performance.now();
      return existing;
    }
    if (existing) this.release(existing);

    const source = this.proxies.get(media.key) ?? media.path;
    let el: Sourced;
    if (media.kind === 'image') {
      const img = new Image();
      img.src = this.fileUrl(source);
      el = img;
    } else if (media.hasVideo) {
      const video = document.createElement('video');
      video.src = this.fileUrl(source);
      video.preload = 'auto';
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      el = video;
    } else {
      const audio = new Audio(this.fileUrl(source));
      audio.preload = 'auto';
      el = audio;
    }

    const pooled: PooledElement = { el, clipId: clip.id, mediaKey: media.key, lastUsed: performance.now(), ready: false };
    const markReady = () => {
      pooled.ready = true;
      this.dirty = true;
    };
    if (el instanceof HTMLImageElement) el.onload = markReady;
    else {
      el.addEventListener('loadeddata', markReady);
      el.addEventListener('seeked', () => {
        this.dirty = true;
      });
      el.addEventListener('error', () => {
        pooled.ready = false;
        this.requestProxy(media);
      });
    }
    this.pool.set(clip.id, pooled);
    return pooled;
  }

  /** One proxy build per media, no matter how many clips reference it. */
  private requestProxy(media: Media) {
    if (!this.proxyResolver || this.proxies.has(media.key) || this.proxyPending.has(media.key)) return;
    this.proxyPending.add(media.key);
    void this.proxyResolver(media)
      .then((path) => {
        if (path) this.useProxy(media.key, path);
      })
      .catch(() => undefined)
      .finally(() => this.proxyPending.delete(media.key));
  }

  private release(pooled: PooledElement) {
    const el = pooled.el as HTMLMediaElement;
    if ('pause' in el) {
      el.pause();
      el.removeAttribute('src');
      el.load?.();
    }
    this.pool.delete(pooled.clipId);
  }

  private prunePool() {
    const now = performance.now();
    for (const pooled of [...this.pool.values()]) {
      if (now - pooled.lastUsed > POOL_TTL) this.release(pooled);
    }
  }

  /** Keep every source element lined up with the playhead. */
  private syncElements() {
    const active = new Set<string>();
    for (const entry of this.activeClips()) {
      const { clip, media } = entry;
      if (!media || clip.type === 'text' || clip.type === 'solid') continue;
      active.add(clip.id);
      const pooled = this.elementFor(clip, media);
      if (!pooled) continue;
      pooled.lastUsed = performance.now();
      if (pooled.el instanceof HTMLImageElement) continue;

      const el = pooled.el as HTMLMediaElement;
      const speed = clip.speed || 1;
      const target = clip.inPoint + (this.time - clip.start) * speed;
      const fade = fadeGain(clip, this.time);
      el.volume = Math.max(0, Math.min(1, entry.volume * fade));
      el.muted = entry.muted || entry.volume <= 0;
      el.playbackRate = Math.max(0.0625, Math.min(16, speed));

      if (this.playing) {
        if (Math.abs(el.currentTime - target) > DRIFT_TOLERANCE && Number.isFinite(target)) el.currentTime = target;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.02 && Number.isFinite(target)) el.currentTime = target;
      }
    }

    for (const pooled of this.pool.values()) {
      if (active.has(pooled.clipId)) continue;
      const el = pooled.el as HTMLMediaElement;
      if ('pause' in el && !el.paused) el.pause();
    }
  }

  private draw() {
    const ctx = this.ctx;
    const canvas = this.canvas;
    const project = this.project;
    if (!ctx || !canvas || !project) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.save();
    ctx.fillStyle = project.settings.background || '#000000';
    ctx.fillRect(0, 0, W, H);

    // Video tracks composite bottom-up; `tracks` is stored top-first.
    const entries = this.activeClips()
      .filter((e) => e.kind === 'video')
      .sort((a, b) => b.trackIndex - a.trackIndex);

    for (const entry of entries) {
      const { clip, media } = entry;
      if (clip.type === 'text') continue;
      if (clip.type === 'solid') {
        ctx.save();
        ctx.globalAlpha = (clip.transform?.opacity ?? 1) * fadeGain(clip, this.time);
        ctx.fillStyle = clip.color || '#000000';
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
        continue;
      }
      if (!media) continue;
      const pooled = this.pool.get(clip.id);
      if (!pooled?.ready) continue;
      this.drawClip(ctx, pooled.el, clip, media, W, H);
    }

    for (const entry of entries) {
      if (entry.clip.type === 'text' && entry.clip.text) {
        drawText(ctx, entry.clip.text, entry.clip, this.time, W, H, this.fontFamily);
      }
    }

    if (project.captions?.enabled) {
      const line = project.captions.items.find((c) => this.time >= c.start && this.time < c.end);
      if (line) drawCaption(ctx, line, project.captions.style, W, H, this.fontFamily);
    }

    if (project.watermark?.enabled && project.watermark.path) this.drawWatermark(ctx, W, H);
    ctx.restore();
  }

  private drawClip(ctx: CanvasRenderingContext2D, el: Sourced, clip: Clip, media: Media, W: number, H: number) {
    const natural = naturalSize(el, media);
    if (!natural.w || !natural.h) return;

    const crop = clip.crop;
    const cx = crop ? natural.w * clampUnit(crop.left) : 0;
    const cy = crop ? natural.h * clampUnit(crop.top) : 0;
    const cw = crop ? natural.w * Math.max(0.05, 1 - clampUnit(crop.left) - clampUnit(crop.right)) : natural.w;
    const ch = crop ? natural.h * Math.max(0.05, 1 - clampUnit(crop.top) - clampUnit(crop.bottom)) : natural.h;

    const t = clip.transform || { fit: 'contain', scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };
    const scale = t.scale ?? 1;
    let ratio: number;
    if (t.fit === 'stretch') ratio = 1;
    else ratio = t.fit === 'cover' ? Math.max(W / cw, H / ch) : Math.min(W / cw, H / ch);

    let drawW = t.fit === 'stretch' ? W * scale : cw * ratio * scale;
    let drawH = t.fit === 'stretch' ? H * scale : ch * ratio * scale;

    // `cover` crops to the canvas before positioning, mirroring the export.
    let sx = cx;
    let sy = cy;
    let sw = cw;
    let sh = ch;
    if (t.fit === 'cover') {
      const visW = Math.min(W, drawW);
      const visH = Math.min(H, drawH);
      sw = cw * (visW / drawW);
      sh = ch * (visH / drawH);
      sx = cx + (cw - sw) / 2;
      sy = cy + (ch - sh) / 2;
      drawW = visW;
      drawH = visH;
    }

    const dx = (W - drawW) / 2 + (t.x ?? 0) * W;
    const dy = (H - drawH) / 2 + (t.y ?? 0) * H;

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, (t.opacity ?? 1) * fadeGain(clip, this.time)));
    if (t.rotation) {
      ctx.translate(dx + drawW / 2, dy + drawH / 2);
      ctx.rotate((t.rotation * Math.PI) / 180);
      ctx.translate(-(dx + drawW / 2), -(dy + drawH / 2));
    }
    const filter = cssFilter(clip);
    if (filter) ctx.filter = filter;
    try {
      ctx.drawImage(el as CanvasImageSource, sx, sy, sw, sh, dx, dy, drawW, drawH);
    } catch {
      /* element not decodable yet */
    }
    ctx.restore();
  }

  private drawWatermark(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const wm = this.project!.watermark;
    if (!this.watermarkImage || this.watermarkImage.dataset.path !== wm.path) {
      const img = new Image();
      img.src = this.fileUrl(wm.path!);
      img.dataset.path = wm.path!;
      img.onload = () => {
        this.dirty = true;
      };
      this.watermarkImage = img;
      return;
    }
    const img = this.watermarkImage;
    if (!img.naturalWidth) return;
    const w = W * (wm.size ?? 0.12);
    const h = (img.naturalHeight / img.naturalWidth) * w;
    const pad = W * (wm.margin ?? 0.03);
    const x = wm.position.includes('right') ? W - w - pad : pad;
    const y = wm.position.includes('bottom') ? H - h - pad : pad;
    ctx.save();
    ctx.globalAlpha = wm.opacity ?? 0.8;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }
}

// ---- drawing helpers -------------------------------------------------------

const clampUnit = (v: number) => Math.max(0, Math.min(0.95, v || 0));

function naturalSize(el: Sourced, media: Media) {
  if (el instanceof HTMLVideoElement) return { w: el.videoWidth || media.width, h: el.videoHeight || media.height };
  if (el instanceof HTMLImageElement) return { w: el.naturalWidth || media.width, h: el.naturalHeight || media.height };
  return { w: media.width, h: media.height };
}

export function fadeGain(clip: Clip, time: number): number {
  const local = time - clip.start;
  let gain = 1;
  if (clip.fadeIn > 0) gain = Math.min(gain, local / clip.fadeIn);
  if (clip.fadeOut > 0) gain = Math.min(gain, (clip.duration - local) / clip.fadeOut);
  return Math.max(0, Math.min(1, gain));
}

function cssFilter(clip: Clip): string {
  const fx = clip.effects || {};
  const parts: string[] = [];
  if (fx.brightness) parts.push(`brightness(${1 + fx.brightness})`);
  if (fx.contrast != null && fx.contrast !== 1) parts.push(`contrast(${fx.contrast})`);
  if (fx.saturation != null && fx.saturation !== 1) parts.push(`saturate(${fx.saturation})`);
  if (fx.hue) parts.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.blur) parts.push(`blur(${fx.blur}px)`);
  if (fx.grayscale) parts.push('grayscale(1)');
  if (fx.invert) parts.push('invert(1)');
  return parts.join(' ');
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else {
        out.push(line);
        line = word;
      }
    }
    out.push(line);
  }
  return out;
}

function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  opts: {
    x: number;
    y: number;
    size: number;
    lineHeight: number;
    align: CanvasTextAlign;
    color: string;
    strokeWidth: number;
    strokeColor: string;
    shadow: boolean;
    shadowColor: string;
    background?: string;
    backgroundOpacity?: number;
    padding?: number;
  }
) {
  const totalHeight = lines.length * opts.lineHeight;
  let top = opts.y - totalHeight / 2;

  if (opts.background && opts.background !== 'none') {
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const pad = (opts.padding ?? 0.3) * opts.size;
    const boxW = widest + pad * 2;
    const boxX = opts.align === 'left' ? opts.x - pad : opts.align === 'right' ? opts.x - boxW + pad : opts.x - boxW / 2;
    ctx.save();
    ctx.globalAlpha = opts.backgroundOpacity ?? 0.75;
    ctx.fillStyle = opts.background;
    ctx.fillRect(boxX, top - pad * 0.5, boxW, totalHeight + pad);
    ctx.restore();
  }

  ctx.textAlign = opts.align;
  ctx.textBaseline = 'middle';
  for (const line of lines) {
    const cy = top + opts.lineHeight / 2;
    ctx.save();
    if (opts.shadow) {
      ctx.shadowColor = opts.shadowColor;
      ctx.shadowBlur = opts.size * 0.12;
      ctx.shadowOffsetX = opts.size * 0.05;
      ctx.shadowOffsetY = opts.size * 0.05;
    }
    if (opts.strokeWidth > 0) {
      ctx.lineWidth = opts.strokeWidth * 2;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeStyle = opts.strokeColor;
      ctx.strokeText(line, opts.x, cy);
    }
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = opts.color;
    ctx.fillText(line, opts.x, cy);
    ctx.restore();
    top += opts.lineHeight;
  }
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  style: TextStyle,
  clip: Clip,
  time: number,
  W: number,
  H: number,
  fontFamily: string
) {
  const content = style.uppercase ? style.content.toUpperCase() : style.content;
  if (!content.trim()) return;
  const unit = Math.min(W, H) / 1080;
  const size = (style.size || 64) * unit;

  ctx.save();
  ctx.globalAlpha = (clip.transform?.opacity ?? 1) * fadeGain(clip, time);
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold === false ? '400' : '700'} ${size}px ${fontFamily}`;
  if (style.letterSpacing) ctx.letterSpacing = `${style.letterSpacing * unit}px`;

  const x = (style.x ?? 0.5) * W;
  const y = (style.y ?? 0.5) * H;
  if (clip.transform?.rotation) {
    ctx.translate(x, y);
    ctx.rotate((clip.transform.rotation * Math.PI) / 180);
    ctx.translate(-x, -y);
  }

  const lines = wrapLines(ctx, content, (style.maxWidth ?? 0.86) * W);
  paintLines(ctx, lines, {
    x,
    y,
    size,
    lineHeight: size * 1.2,
    align: style.align || 'center',
    color: style.color || '#ffffff',
    strokeWidth: (style.strokeWidth ?? 0) * unit,
    strokeColor: style.strokeColor || '#000000',
    shadow: Boolean(style.shadow),
    shadowColor: style.shadowColor || '#000000',
    background: style.background,
    backgroundOpacity: style.backgroundOpacity,
    padding: style.padding,
  });
  ctx.restore();
}

export function drawCaption(
  ctx: CanvasRenderingContext2D,
  item: CaptionItem,
  style: CaptionStyle,
  W: number,
  H: number,
  fontFamily: string
) {
  const unit = Math.min(W, H) / 1080;
  const size = (style.size || 54) * unit;
  ctx.save();
  ctx.font = `${style.italic ? 'italic ' : ''}${style.bold === false ? '400' : '700'} ${size}px ${fontFamily}`;
  if (style.letterSpacing) ctx.letterSpacing = `${style.letterSpacing * unit}px`;

  const lines = wrapLines(ctx, item.text, W - (style.marginH ?? 80) * unit * 2);
  const margin = (style.marginV ?? 120) * unit;
  const blockHeight = lines.length * size * 1.2;
  const vertical = style.position.startsWith('top') ? margin + blockHeight / 2 : style.position.startsWith('middle') ? H / 2 : H - margin - blockHeight / 2;
  const horizontal = style.position.endsWith('-left') ? (style.marginH ?? 80) * unit : style.position.endsWith('-right') ? W - (style.marginH ?? 80) * unit : W / 2;
  const align: CanvasTextAlign = style.position.endsWith('-left') ? 'left' : style.position.endsWith('-right') ? 'right' : 'center';

  paintLines(ctx, lines, {
    x: horizontal,
    y: vertical,
    size,
    lineHeight: size * 1.2,
    align,
    color: style.color || '#ffffff',
    strokeWidth: style.boxed ? 0 : (style.outline ?? 3) * unit,
    strokeColor: style.outlineColor || '#000000',
    shadow: (style.shadow ?? 1) > 0,
    shadowColor: '#000000',
    background: style.boxed ? style.boxColor || '#000000' : undefined,
    backgroundOpacity: 0.75,
    padding: 0.3,
  });
  ctx.restore();
}
