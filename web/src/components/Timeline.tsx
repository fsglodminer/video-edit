import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { Clip, Media, Project, Track } from '../lib/types';
import { addTrack, useEditor } from '../state/store';
import {
  clipEnd,
  findFreeSlot,
  formatTime,
  makeClip,
  makeTextClip,
  maxDuration,
  projectDuration,
  snap,
  snapPoints,
  splitClip,
} from '../lib/model';
import { Button, Icon } from './ui';

const TRACK_HEIGHT = { video: 68, audio: 54 };

/** Which lane kind a clip belongs on — titles and stills live on video tracks. */
function clipTrackKind(project: Project, clipId: string): 'video' | 'audio' {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip) continue;
    if (clip.type === 'audio') return 'audio';
    return 'video';
  }
  return 'video';
}
const HEADER_WIDTH = 168;
const RULER_HEIGHT = 28;

type DragMode = 'move' | 'trim-start' | 'trim-end';

interface DragState {
  mode: DragMode;
  clipId: string;
  trackId: string;
  originX: number;
  originY: number;
  start: number;
  duration: number;
  inPoint: number;
  moved: boolean;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const zoom = useEditor((s) => s.zoom);
  const setZoom = useEditor((s) => s.setZoom);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  const update = useEditor((s) => s.update);
  const commit = useEditor((s) => s.commit);
  const begin = useEditor((s) => s.beginInteraction);
  const end = useEditor((s) => s.endInteraction);
  const snapping = useEditor((s) => s.snapping);
  const toggleSnapping = useEditor((s) => s.toggleSnapping);
  const rippleMode = useEditor((s) => s.rippleMode);
  const toggleRipple = useEditor((s) => s.toggleRipple);

  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [dropHint, setDropHint] = useState<{ trackId: string; time: number } | null>(null);

  const duration = project ? projectDuration(project) : 0;
  const contentWidth = Math.max(1200, (duration + 12) * zoom);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scrollRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + el.scrollLeft - HEADER_WIDTH) / zoom);
    },
    [zoom]
  );

  // Ctrl/⌘ + wheel zooms around the pointer; plain wheel scrolls.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const before = timeAt(e.clientX);
      const next = Math.max(6, Math.min(600, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      setZoom(next);
      requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        el.scrollLeft = before * next - (e.clientX - rect.left - HEADER_WIDTH);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, setZoom, timeAt]);

  const onRulerPointer = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setPlayhead(timeAt(e.clientX));
  };
  const onRulerMove = (e: React.PointerEvent) => {
    if (e.buttons !== 1) return;
    setPlayhead(timeAt(e.clientX));
  };

  const startDrag = (e: React.PointerEvent, clip: Clip, track: Track, mode: DragMode) => {
    if (track.locked) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    begin();
    drag.current = {
      mode,
      clipId: clip.id,
      trackId: track.id,
      originX: e.clientX,
      originY: e.clientY,
      start: clip.start,
      duration: clip.duration,
      inPoint: clip.inPoint,
      moved: false,
    };
    if (!selection.includes(clip.id)) select(clip.id, { additive: e.shiftKey });
  };

  const onDragMove = (e: React.PointerEvent) => {
    const state = drag.current;
    if (!state || !project) return;
    const deltaTime = (e.clientX - state.originX) / zoom;
    if (Math.abs(e.clientX - state.originX) > 2 || Math.abs(e.clientY - state.originY) > 2) state.moved = true;

    // Moving vertically onto another lane of the same kind re-parents the clip.
    if (state.mode === 'move') {
      const lane = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-track-id]') as HTMLElement | null;
      const overId = lane?.dataset.trackId;
      const overKind = lane?.dataset.trackKind;
      if (overId && overId !== state.trackId) {
        const clipKind = clipTrackKind(project, state.clipId);
        const targetTrack = project.tracks.find((t) => t.id === overId);
        if (overKind === clipKind && targetTrack && !targetTrack.locked) {
          update((draft) => {
            const from = draft.tracks.find((t) => t.id === state.trackId);
            const to = draft.tracks.find((t) => t.id === overId);
            const index = from?.clips.findIndex((c) => c.id === state.clipId) ?? -1;
            if (!from || !to || index < 0) return;
            const [moved] = from.clips.splice(index, 1);
            to.clips.push(moved);
            to.clips.sort((a, b) => a.start - b.start);
          });
          state.trackId = overId;
        }
      }
    }

    const tolerance = snapping && !e.altKey ? 8 / zoom : 0;
    const points = snapPoints(project, new Set([state.clipId]), playhead);

    update((draft) => {
      const track = draft.tracks.find((t) => t.id === state.trackId);
      const clip = track?.clips.find((c) => c.id === state.clipId);
      if (!track || !clip) return;
      const media = draft.media.find((m) => m.id === clip.mediaId);
      const sourceLimit = media && clip.type !== 'text' && clip.type !== 'solid' && media.kind !== 'image' ? media.duration : Infinity;

      if (state.mode === 'move') {
        let next = Math.max(0, state.start + deltaTime);
        next = tolerance ? snap(next, points, tolerance) : next;
        // Snap the tail too, so clips butt up cleanly on either edge.
        if (tolerance) {
          const tail = snap(next + clip.duration, points, tolerance);
          if (Math.abs(tail - (next + clip.duration)) > 0.0001) next = Math.max(0, tail - clip.duration);
        }
        clip.start = next;
      } else if (state.mode === 'trim-start') {
        const maxShift = state.duration - 0.05;
        const minShift = clip.type === 'text' || clip.type === 'solid' || media?.kind === 'image' ? -state.start : -state.inPoint / (clip.speed || 1);
        let shift = Math.max(minShift, Math.min(maxShift, deltaTime));
        if (tolerance) {
          const snapped = snap(state.start + shift, points, tolerance);
          shift = Math.max(minShift, Math.min(maxShift, snapped - state.start));
        }
        clip.start = Math.max(0, state.start + shift);
        clip.duration = state.duration - shift;
        if (clip.type !== 'text' && clip.type !== 'solid' && media?.kind !== 'image') {
          clip.inPoint = Math.max(0, state.inPoint + shift * (clip.speed || 1));
        }
      } else {
        const limit =
          sourceLimit === Infinity ? Infinity : Math.max(0.05, (sourceLimit - clip.inPoint) / (clip.speed || 1));
        let next = Math.max(0.05, Math.min(limit, state.duration + deltaTime));
        if (tolerance) {
          const snapped = snap(clip.start + next, points, tolerance);
          next = Math.max(0.05, Math.min(limit, snapped - clip.start));
        }
        clip.duration = next;
      }
      track.clips.sort((a, b) => a.start - b.start);
    });
  };

  const onDragEnd = (e: React.PointerEvent) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    if (!state.moved) {
      end();
      return;
    }
    end(state.mode === 'move' ? 'Moved clip' : 'Trimmed clip');
  };

  const onDrop = (e: React.DragEvent, track: Track) => {
    e.preventDefault();
    setDropHint(null);
    if (!project) return;
    const mediaId = e.dataTransfer.getData('application/x-jumpcut-media');
    if (!mediaId) return;
    const media = project.media.find((m) => m.id === mediaId);
    if (!media) return;
    const wantsAudioTrack = track.kind === 'audio';
    if (wantsAudioTrack && !media.hasAudio) return;
    if (!wantsAudioTrack && !media.hasVideo && media.kind !== 'image') return;

    const at = Math.max(0, timeAt(e.clientX));
    commit(`Added ${media.name}`, (draft) => {
      const target = draft.tracks.find((t) => t.id === track.id);
      if (!target) return;
      const clip = makeClip(media, at, wantsAudioTrack ? { type: 'audio' } : {});
      clip.start = findFreeSlot(target, at, clip.duration);
      target.clips.push(clip);
      target.clips.sort((a, b) => a.start - b.start);
    });
  };

  if (!project) return <div className="timeline" />;

  const videoTracks = project.tracks.filter((t) => t.kind === 'video');
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');

  return (
    <div className="timeline">
      <TimelineToolbar
        zoom={zoom}
        setZoom={setZoom}
        snapping={snapping}
        toggleSnapping={toggleSnapping}
        ripple={rippleMode}
        toggleRipple={toggleRipple}
        onSplit={() => {
          commit('Split clip', (draft) => {
            for (const track of draft.tracks) {
              if (track.locked) continue;
              for (const clip of [...track.clips]) {
                if (selection.length && !selection.includes(clip.id)) continue;
                if (playhead > clip.start && playhead < clipEnd(clip)) splitClip(track, clip, playhead);
              }
            }
          });
        }}
        onAddText={() => {
          let newId: string | null = null;
          commit('Added title', (draft) => {
            const target = draft.tracks.find((t) => t.kind === 'video') || addTrack(draft, 'video');
            const clip = makeTextClip(playhead, 3);
            clip.start = findFreeSlot(target, playhead, clip.duration);
            target.clips.push(clip);
            target.clips.sort((a, b) => a.start - b.start);
            newId = clip.id;
          });
          if (newId) select(newId);
        }}
        onAddTrack={(kind) => commit(`Added ${kind} track`, (draft) => void addTrack(draft, kind))}
      />

      <div className="timeline-scroll" ref={scrollRef} onPointerDown={(e) => e.target === e.currentTarget && select(null)}>
        <div className="timeline-content" style={{ width: contentWidth + HEADER_WIDTH }}>
          <Ruler
            duration={duration}
            zoom={zoom}
            width={contentWidth}
            fps={project.settings.fps}
            onPointerDown={onRulerPointer}
            onPointerMove={onRulerMove}
          />

          <div className="tracks">
            {[...videoTracks, ...audioTracks].map((track) => (
              <TrackRow
                key={track.id}
                track={track}
                project={project}
                zoom={zoom}
                width={contentWidth}
                selection={selection}
                dropHint={dropHint?.trackId === track.id ? dropHint.time : null}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('application/x-jumpcut-media')) return;
                  e.preventDefault();
                  setDropHint({ trackId: track.id, time: timeAt(e.clientX) });
                }}
                onDragLeave={() => setDropHint((h) => (h?.trackId === track.id ? null : h))}
                onDrop={(e) => onDrop(e, track)}
                onClipPointerDown={startDrag}
                onClipPointerMove={onDragMove}
                onClipPointerUp={onDragEnd}
                onSelect={(clip, additive) => select(clip.id, { additive })}
              />
            ))}
          </div>

          <div className="playhead" style={{ left: HEADER_WIDTH + playhead * zoom }}>
            <span className="playhead-grip" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TimelineToolbar({
  zoom,
  setZoom,
  snapping,
  toggleSnapping,
  ripple,
  toggleRipple,
  onSplit,
  onAddText,
  onAddTrack,
}: {
  zoom: number;
  setZoom: (z: number) => void;
  snapping: boolean;
  toggleSnapping: () => void;
  ripple: boolean;
  toggleRipple: () => void;
  onSplit: () => void;
  onAddText: () => void;
  onAddTrack: (kind: 'video' | 'audio') => void;
}) {
  return (
    <div className="timeline-toolbar">
      <Button variant="ghost" size="sm" onClick={onSplit} title="Split at playhead (S)">
        {Icon.split} Split
      </Button>
      <Button variant="ghost" size="sm" onClick={onAddText} title="Add a title at the playhead (T)">
        {Icon.text} Title
      </Button>
      <span className="toolbar-divider" />
      <Button variant="ghost" size="sm" active={snapping} onClick={toggleSnapping} title="Snap to edges (hold Alt to bypass)">
        {Icon.magnet} Snap
      </Button>
      <Button variant="ghost" size="sm" active={ripple} onClick={toggleRipple} title="Ripple delete closes the gap">
        Ripple
      </Button>
      <span className="toolbar-divider" />
      <Button variant="ghost" size="sm" onClick={() => onAddTrack('video')} title="Add a video track">
        {Icon.plus} Video track
      </Button>
      <Button variant="ghost" size="sm" onClick={() => onAddTrack('audio')} title="Add an audio track">
        {Icon.plus} Audio track
      </Button>
      <div className="toolbar-spacer" />
      <div className="zoom-control">
        <button type="button" onClick={() => setZoom(zoom / 1.4)} title="Zoom out (−)">
          −
        </button>
        <input type="range" min={6} max={600} step={1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        <button type="button" onClick={() => setZoom(zoom * 1.4)} title="Zoom in (+)">
          +
        </button>
      </div>
    </div>
  );
}

function Ruler({
  duration,
  zoom,
  width,
  fps,
  onPointerDown,
  onPointerMove,
}: {
  duration: number;
  zoom: number;
  width: number;
  fps: number;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
}) {
  const step = niceStep(zoom);
  const ticks = [];
  for (let t = 0; t <= duration + 12; t += step) ticks.push(t);

  return (
    <div className="ruler" style={{ height: RULER_HEIGHT, paddingLeft: HEADER_WIDTH }} onPointerDown={onPointerDown} onPointerMove={onPointerMove}>
      <div className="ruler-inner" style={{ width }}>
        {ticks.map((t) => (
          <span key={t} className="ruler-tick" style={{ left: t * zoom }}>
            <em>{formatTime(t, fps, step < 1)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

function niceStep(zoom: number) {
  const target = 90 / zoom; // aim for a label roughly every 90px
  const steps = [1 / 30, 1 / 10, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => s >= target) ?? 900;
}

function TrackRow({
  track,
  project,
  zoom,
  width,
  selection,
  dropHint,
  onDragOver,
  onDragLeave,
  onDrop,
  onClipPointerDown,
  onClipPointerMove,
  onClipPointerUp,
  onSelect,
}: {
  track: Track;
  project: Project;
  zoom: number;
  width: number;
  selection: string[];
  dropHint: number | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onClipPointerDown: (e: React.PointerEvent, clip: Clip, track: Track, mode: DragMode) => void;
  onClipPointerMove: (e: React.PointerEvent) => void;
  onClipPointerUp: (e: React.PointerEvent) => void;
  onSelect: (clip: Clip, additive: boolean) => void;
}) {
  const commit = useEditor((s) => s.commit);
  const height = track.height ?? TRACK_HEIGHT[track.kind];

  return (
    <div className={`track track-${track.kind}${track.locked ? ' is-locked' : ''}`} style={{ height }}>
      <div className="track-header" style={{ width: HEADER_WIDTH }}>
        <span className="track-name" title={track.name}>
          {track.name}
        </span>
        <div className="track-controls">
          {track.kind === 'video' ? (
            <button
              type="button"
              className={track.hidden ? 'is-off' : ''}
              title={track.hidden ? 'Show track' : 'Hide track'}
              onClick={() => commit(track.hidden ? 'Showed track' : 'Hid track', (d) => {
                const t = d.tracks.find((x) => x.id === track.id);
                if (t) t.hidden = !t.hidden;
              })}
            >
              {track.hidden ? Icon.eyeOff : Icon.eye}
            </button>
          ) : null}
          <button
            type="button"
            className={track.muted ? 'is-off' : ''}
            title={track.muted ? 'Unmute track' : 'Mute track'}
            onClick={() => commit(track.muted ? 'Unmuted track' : 'Muted track', (d) => {
              const t = d.tracks.find((x) => x.id === track.id);
              if (t) t.muted = !t.muted;
            })}
          >
            {track.muted ? Icon.mute : Icon.volume}
          </button>
          <button
            type="button"
            className={track.locked ? 'is-active' : ''}
            title={track.locked ? 'Unlock track' : 'Lock track'}
            onClick={() => commit(track.locked ? 'Unlocked track' : 'Locked track', (d) => {
              const t = d.tracks.find((x) => x.id === track.id);
              if (t) t.locked = !t.locked;
            })}
          >
            {Icon.lock}
          </button>
        </div>
      </div>

      <div
        className="track-lane"
        data-track-id={track.id}
        data-track-kind={track.kind}
        style={{ width }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {dropHint != null ? <span className="drop-hint" style={{ left: dropHint * zoom }} /> : null}
        {track.clips.map((clip) => (
          <ClipView
            key={clip.id}
            clip={clip}
            track={track}
            project={project}
            zoom={zoom}
            height={height}
            selected={selection.includes(clip.id)}
            onPointerDown={onClipPointerDown}
            onPointerMove={onClipPointerMove}
            onPointerUp={onClipPointerUp}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

function ClipView({
  clip,
  track,
  project,
  zoom,
  height,
  selected,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onSelect,
}: {
  clip: Clip;
  track: Track;
  project: Project;
  zoom: number;
  height: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, clip: Clip, track: Track, mode: DragMode) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onSelect: (clip: Clip, additive: boolean) => void;
}) {
  const media = project.media.find((m) => m.id === clip.mediaId);
  const left = clip.start * zoom;
  const width = Math.max(4, clip.duration * zoom);
  const showThumbs = track.kind === 'video' && media?.hasVideo && width > 40;
  const showWave = Boolean(media?.hasAudio) && width > 24 && !clip.muted;
  const label = clip.type === 'text' ? clip.text?.content?.split('\n')[0] || 'Title' : media?.name || clip.name || 'Clip';

  return (
    <div
      className={`clip clip-${clip.type}${selected ? ' is-selected' : ''}`}
      style={{ left, width, height: height - 8 }}
      onPointerDown={(e) => onPointerDown(e, clip, track, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(e) => onSelect(clip, e.shiftKey)}
      title={`${label} — ${formatTime(clip.duration, project.settings.fps, true)}`}
    >
      {showThumbs && media ? <ClipFilmstrip clip={clip} media={media} width={width} height={height - 8} /> : null}
      {showWave && media ? <ClipWaveform clip={clip} media={media} width={width} height={height - 8} /> : null}
      {clip.type === 'text' ? <span className="clip-texticon">{Icon.text}</span> : null}
      <span className="clip-label">{label}</span>
      {clip.speed !== 1 ? <span className="clip-badge">{clip.speed.toFixed(2)}×</span> : null}
      {clip.fadeIn > 0 ? <span className="clip-fade clip-fade-in" style={{ width: clip.fadeIn * zoom }} /> : null}
      {clip.fadeOut > 0 ? <span className="clip-fade clip-fade-out" style={{ width: clip.fadeOut * zoom }} /> : null}
      <span className="clip-handle clip-handle-start" onPointerDown={(e) => onPointerDown(e, clip, track, 'trim-start')} />
      <span className="clip-handle clip-handle-end" onPointerDown={(e) => onPointerDown(e, clip, track, 'trim-end')} />
    </div>
  );
}

function ClipFilmstrip({ clip, media, width, height }: { clip: Clip; media: Media; width: number; height: number }) {
  const [strip, setStrip] = useState<{ count: number; tileWidth: number; tileHeight: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    stripMeta(media.key)
      .then((meta) => !cancelled && setStrip(meta))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [media.key]);

  if (!strip || !media.duration) return null;
  const sourceSpan = Math.max(0.05, clip.duration * (clip.speed || 1));
  const fullWidth = width * (media.duration / sourceSpan);
  const offset = (clip.inPoint / media.duration) * fullWidth;

  return (
    <span
      className="clip-strip"
      style={{
        backgroundImage: `url(${api.filmstripUrl(media.key, 72)})`,
        backgroundSize: `${fullWidth}px ${height}px`,
        backgroundPositionX: `${-offset}px`,
      }}
    />
  );
}

const stripCache = new Map<string, Promise<{ count: number; tileWidth: number; tileHeight: number }>>();
function stripMeta(key: string) {
  if (!stripCache.has(key)) stripCache.set(key, api.filmstripMeta(key, 72));
  return stripCache.get(key)!;
}

const waveCache = new Map<string, Promise<{ peaks: number[]; duration: number }>>();
function waveData(key: string) {
  if (!waveCache.has(key)) waveCache.set(key, api.waveform(key, 3000));
  return waveCache.get(key)!;
}

function ClipWaveform({ clip, media, width, height }: { clip: Clip; media: Media; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<{ peaks: number[]; duration: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    waveData(media.key)
      .then((d) => !cancelled && setData(d))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [media.key]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data?.peaks.length) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height * 0.42));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';

    const buckets = data.peaks.length / 2;
    const sourceSpan = clip.duration * (clip.speed || 1);
    const mid = h / 2;
    for (let x = 0; x < w; x += 1) {
      const sourceTime = clip.inPoint + (x / w) * sourceSpan;
      const index = Math.floor((sourceTime / (data.duration || 1)) * buckets);
      if (index < 0 || index >= buckets) continue;
      const min = data.peaks[index * 2];
      const max = data.peaks[index * 2 + 1];
      const top = mid - max * mid;
      const bottom = mid - min * mid;
      ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
    }
  }, [data, width, height, clip.inPoint, clip.duration, clip.speed]);

  return <canvas className="clip-wave" ref={canvasRef} />;
}
