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
  poolKey: string;
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
  private filterCss: Record<string, string> = {};
  private keyCanvas: HTMLCanvasElement | null = null;

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

  /** CSS equivalents of the server's look presets, keyed by preset id. */
  setFilterCss(map: Record<string, string>) {
    this.filterCss = map;
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
    const poolKey = `${clip.id}:${media.key}`;
    const existing = this.pool.get(poolKey);
    if (existing) {
      existing.lastUsed = performance.now();
      return existing;
    }

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

    const pooled: PooledElement = { el, clipId: clip.id, poolKey, mediaKey: media.key, lastUsed: performance.now(), ready: false };
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
    this.pool.set(poolKey, pooled);
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
    this.pool.delete(pooled.poolKey);
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
      if (!media || clip.type === 'text' || clip.type === 'solid' || clip.type === 'shape') continue;
      active.add(`${clip.id}:${media.key}`);
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
      if (active.has(pooled.poolKey)) continue;
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

    for (const [index, entry] of entries.entries()) {
      const { clip, media } = entry;
      if (clip.type === 'text' || clip.type === 'shape') continue;

      // A clip with a transition overlaps its predecessor; render the incoming
      // one through the transition's mask so the preview matches the export.
      const previous = entries
        .slice(0, index)
        .reverse()
        .find((e) => e.trackIndex === entry.trackIndex && e.clip.type !== 'text' && e.clip.type !== 'shape');
      const transition = clip.transitionIn;
      const overlap = previous ? previous.clip.start + previous.clip.duration - clip.start : 0;
      const inTransition = Boolean(transition && previous && overlap > 0.01 && this.time < clip.start + overlap);

      ctx.save();
      if (inTransition) {
        const progress = Math.max(0, Math.min(1, (this.time - clip.start) / overlap));
        applyTransitionMask(ctx, transition!.type, progress, W, H);
      }
      if (clip.type === 'solid') {
        ctx.globalAlpha *= (clip.transform?.opacity ?? 1) * fadeGain(clip, this.time);
        ctx.fillStyle = clip.color || '#000000';
        ctx.fillRect(0, 0, W, H);
      } else if (media) {
        const pooled = this.pool.get(`${clip.id}:${media.key}`);
        if (pooled?.ready) this.drawClip(ctx, pooled.el, clip, media, W, H);
      }
      ctx.restore();
    }

    // Shapes sit above the footage, titles above the shapes — matching the
    // layer order the ASS pass uses on export.
    for (const entry of entries) {
      if (entry.clip.type === 'shape' && entry.clip.shape) drawShape(ctx, entry.clip, this.time, W, H);
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
    const filter = [this.filterCss[clip.filter || 'none'] || '', cssFilter(clip)].filter(Boolean).join(' ');
    if (filter) ctx.filter = filter;
    const source = clip.chromaKey?.enabled ? this.keyed(el, clip, sx, sy, sw, sh) : null;
    try {
      if (source) ctx.drawImage(source, 0, 0, source.width, source.height, dx, dy, drawW, drawH);
      else ctx.drawImage(el as CanvasImageSource, sx, sy, sw, sh, dx, dy, drawW, drawH);
    } catch {
      /* element not decodable yet */
    }
    ctx.filter = 'none';
    const vignette = clip.effects?.vignette ?? 0;
    if (vignette > 0) paintVignette(ctx, dx, dy, drawW, drawH, vignette);
    ctx.restore();
  }

  /**
   * Green-screen preview. Keying is a per-pixel job, so it runs on a small
   * scratch canvas — enough to judge the key by, while the export does it at
   * full resolution in ffmpeg.
   */
  private keyed(el: Sourced, clip: Clip, sx: number, sy: number, sw: number, sh: number): HTMLCanvasElement | null {
    const key = clip.chromaKey;
    if (!key?.enabled) return null;
    if (!this.keyCanvas) this.keyCanvas = document.createElement('canvas');
    const canvas = this.keyCanvas;
    const scale = Math.min(1, 640 / Math.max(1, sw));
    const w = Math.max(2, Math.round(sw * scale));
    const h = Math.max(2, Math.round(sh * scale));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, w, h);
    try {
      ctx.drawImage(el as CanvasImageSource, sx, sy, sw, sh, 0, 0, w, h);
    } catch {
      return null;
    }

    const target = hexToRgb(key.color || '#00ff00');
    const similarity = Math.max(0.01, key.similarity ?? 0.3) * 441; // 441 ≈ max RGB distance
    const blend = Math.max(0, key.blend ?? 0.12) * 441;
    let frame: ImageData;
    try {
      frame = ctx.getImageData(0, 0, w, h);
    } catch {
      return null; // tainted canvas — should not happen for same-origin media
    }
    const data = frame.data;
    for (let i = 0; i < data.length; i += 4) {
      const distance = Math.sqrt(
        (data[i] - target.r) ** 2 + (data[i + 1] - target.g) ** 2 + (data[i + 2] - target.b) ** 2
      );
      if (distance < similarity) data[i + 3] = 0;
      else if (blend > 0 && distance < similarity + blend) {
        data[i + 3] = Math.round(data[i + 3] * ((distance - similarity) / blend));
      }
    }
    ctx.putImageData(frame, 0, 0);
    return canvas;
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

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 0, g: 255, b: 0 };
}

/** Darkened corners, drawn over the clip's own rect. */
function paintVignette(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, amount: number) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const radius = Math.max(w, h) * 0.72;
  const gradient = ctx.createRadialGradient(cx, cy, radius * 0.35, cx, cy, radius);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.92, amount).toFixed(2)})`);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = gradient;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/**
 * Clip the context to the part of the frame the incoming clip should occupy
 * partway through a transition, or set its alpha for the dissolve family.
 * Approximates ffmpeg's xfade closely enough to time a cut by.
 */
function applyTransitionMask(ctx: CanvasRenderingContext2D, type: string, progress: number, W: number, H: number) {
  const clipRect = (x: number, y: number, w: number, h: number) => {
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  };
  switch (type) {
    case 'wipeleft':
      clipRect(W * (1 - progress), 0, W * progress, H);
      break;
    case 'wiperight':
      clipRect(0, 0, W * progress, H);
      break;
    case 'wipeup':
      clipRect(0, H * (1 - progress), W, H * progress);
      break;
    case 'wipedown':
      clipRect(0, 0, W, H * progress);
      break;
    case 'slideleft':
      clipRect(W * (1 - progress), 0, W * progress, H);
      ctx.translate(W * (1 - progress), 0);
      break;
    case 'slideright':
      clipRect(0, 0, W * progress, H);
      ctx.translate(-W * (1 - progress), 0);
      break;
    case 'slideup':
      clipRect(0, H * (1 - progress), W, H * progress);
      ctx.translate(0, H * (1 - progress));
      break;
    case 'slidedown':
      clipRect(0, 0, W, H * progress);
      ctx.translate(0, -H * (1 - progress));
      break;
    case 'circleopen':
    case 'circlecrop':
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.5 * progress, 0, Math.PI * 2);
      ctx.clip();
      break;
    case 'circleclose':
      ctx.beginPath();
      ctx.arc(W / 2, H / 2, Math.hypot(W, H) * 0.5 * (1 - progress), 0, Math.PI * 2);
      ctx.clip();
      break;
    case 'rectcrop':
      clipRect(W / 2 - (W / 2) * progress, H / 2 - (H / 2) * progress, W * progress, H * progress);
      break;
    case 'vertopen':
      clipRect(W / 2 - (W / 2) * progress, 0, W * progress, H);
      break;
    case 'horzopen':
      clipRect(0, H / 2 - (H / 2) * progress, W, H * progress);
      break;
    case 'pixelize':
    case 'hblur':
      ctx.globalAlpha *= progress;
      ctx.filter = `blur(${((1 - progress) * 12).toFixed(1)}px)`;
      break;
    default:
      // fade, dissolve, fadeblack, fadewhite, radial, distance, diagonals…
      ctx.globalAlpha *= progress;
      break;
  }
}

/** Canvas twin of the ASS vector shapes drawn on export. */
function shapeOutline(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, w: number, h: number, radius: number) {
  ctx.beginPath();
  switch (kind) {
    case 'ellipse':
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(x + w / 2, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x, y + h);
      ctx.closePath();
      break;
    case 'arrow': {
      const shaft = h * 0.34;
      const headW = w * 0.36;
      const top = y + (h - shaft) / 2;
      ctx.moveTo(x, top);
      ctx.lineTo(x + w - headW, top);
      ctx.lineTo(x + w - headW, y);
      ctx.lineTo(x + w, y + h / 2);
      ctx.lineTo(x + w - headW, y + h);
      ctx.lineTo(x + w - headW, top + shaft);
      ctx.lineTo(x, top + shaft);
      ctx.closePath();
      break;
    }
    case 'star': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const outer = Math.min(w, h) / 2;
      const inner = outer * 0.42;
      for (let i = 0; i < 10; i += 1) {
        const r = i % 2 === 0 ? outer : inner;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        const px = cx + r * Math.cos(angle);
        const py = cy + r * Math.sin(angle);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'roundrect': {
      const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
      break;
    }
    default:
      ctx.rect(x, y, w, h);
      break;
  }
}

export function drawShape(ctx: CanvasRenderingContext2D, clip: Clip, time: number, W: number, H: number) {
  const shape = clip.shape;
  if (!shape) return;
  const w = shape.width * W;
  const h = shape.height * H;
  const x = shape.x * W - w / 2;
  const y = shape.y * H - h / 2;

  ctx.save();
  ctx.globalAlpha = (clip.transform?.opacity ?? 1) * fadeGain(clip, time);
  if (clip.transform?.rotation) {
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate((clip.transform.rotation * Math.PI) / 180);
    ctx.translate(-(x + w / 2), -(y + h / 2));
  }
  shapeOutline(ctx, shape.kind, x, y, w, h, (shape.radius ?? 0.15) * Math.min(w, h));
  if (shape.filled !== false) {
    ctx.fillStyle = shape.color || '#7b61ff';
    ctx.fill();
  }
  if ((shape.strokeWidth ?? 0) > 0) {
    ctx.lineWidth = (shape.strokeWidth ?? 0) * (Math.min(W, H) / 1080);
    ctx.strokeStyle = shape.strokeColor || '#ffffff';
    ctx.stroke();
  }
  ctx.restore();
}

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
  if (fx.temperature) {
    // Warm shifts towards sepia, cool towards blue — a rough stand-in for
    // ffmpeg's colortemperature, close enough to judge framing by.
    parts.push(fx.temperature > 0 ? `sepia(${(fx.temperature * 0.35).toFixed(2)})` : `hue-rotate(${(-fx.temperature * 14).toFixed(0)}deg)`);
  }
  if (fx.filmFade) parts.push(`contrast(${(1 - fx.filmFade * 0.25).toFixed(2)}) brightness(${(1 + fx.filmFade * 0.08).toFixed(2)})`);
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
