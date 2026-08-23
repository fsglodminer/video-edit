import React, { useCallback, useRef } from 'react';
import type { Clip, Project } from '../lib/types';
import { useEditor } from '../state/store';
import { DEFAULT_TRANSFORM } from '../lib/model';

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'rotate';

interface DragState {
  handle: Handle;
  startX: number;
  startY: number;
  originScale: number;
  originX: number;
  originY: number;
  originRotation: number;
  originWidth: number;
  originHeight: number;
  centreX: number;
  centreY: number;
  startAngle: number;
}

/** Where a clip's box sits inside the preview, as fractions of the frame. */
function boxFor(clip: Clip, project: Project): { x: number; y: number; w: number; h: number } | null {
  const W = project.settings.width;
  const H = project.settings.height;

  if (clip.type === 'text' && clip.text) {
    const size = (clip.text.size ?? 64) * (Math.min(W, H) / 1080);
    const lines = String(clip.text.content ?? '').split('\n').length;
    const w = Math.min(1, clip.text.maxWidth ?? 0.86);
    const h = Math.min(1, (lines * size * 1.25) / H);
    const align = clip.text.align ?? 'center';
    const cx = clip.text.x ?? 0.5;
    return { x: align === 'left' ? cx : align === 'right' ? cx - w : cx - w / 2, y: (clip.text.y ?? 0.5) - h / 2, w, h };
  }

  if (clip.type === 'shape' && clip.shape) {
    const w = clip.shape.width;
    const h = clip.shape.height;
    return { x: (clip.shape.x ?? 0.5) - w / 2, y: (clip.shape.y ?? 0.5) - h / 2, w, h };
  }

  const media = project.media.find((m) => m.id === clip.mediaId);
  const t = { ...DEFAULT_TRANSFORM, ...clip.transform };
  if (clip.type === 'solid') return { x: 0, y: 0, w: 1, h: 1 };
  if (!media?.width || !media?.height) return null;

  const crop = clip.crop;
  const srcW = media.width * (crop ? Math.max(0.05, 1 - (crop.left || 0) - (crop.right || 0)) : 1);
  const srcH = media.height * (crop ? Math.max(0.05, 1 - (crop.top || 0) - (crop.bottom || 0)) : 1);
  const ratio = t.fit === 'stretch' ? 1 : t.fit === 'cover' ? Math.max(W / srcW, H / srcH) : Math.min(W / srcW, H / srcH);
  let drawW = t.fit === 'stretch' ? W * t.scale : srcW * ratio * t.scale;
  let drawH = t.fit === 'stretch' ? H * t.scale : srcH * ratio * t.scale;
  if (t.fit === 'cover') {
    drawW = Math.min(W, drawW);
    drawH = Math.min(H, drawH);
  }
  return {
    x: (W - drawW) / 2 / W + t.x,
    y: (H - drawH) / 2 / H + t.y,
    w: drawW / W,
    h: drawH / H,
  };
}

/**
 * Selection box drawn over the preview: drag to move, corners to scale, the
 * stem above to rotate. Edits go straight into the clip's transform.
 */
export function CanvasHandles({ frame }: { frame: HTMLElement | null }) {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const update = useEditor((s) => s.update);
  const begin = useEditor((s) => s.beginInteraction);
  const end = useEditor((s) => s.endInteraction);
  const drag = useRef<DragState | null>(null);

  const clip = project && selection.length === 1
    ? project.tracks.flatMap((t) => t.clips).find((c) => c.id === selection[0]) ?? null
    : null;

  const patch = useCallback(
    (mutate: (c: Clip) => void) => {
      update((draft) => {
        for (const track of draft.tracks) {
          const found = track.clips.find((c) => c.id === clip?.id);
          if (found) mutate(found);
        }
      });
    },
    [update, clip?.id]
  );

  if (!project || !clip) return null;
  const box = boxFor(clip, project);
  if (!box) return null;

  const rotation = clip.type === 'shape' || clip.type === 'text' ? clip.transform?.rotation ?? 0 : clip.transform?.rotation ?? 0;

  const onPointerDown = (handle: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const rect = frame?.getBoundingClientRect();
    const centreX = (rect?.left ?? 0) + ((box.x + box.w / 2) * (rect?.width ?? 1));
    const centreY = (rect?.top ?? 0) + ((box.y + box.h / 2) * (rect?.height ?? 1));
    begin();
    drag.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      originScale: clip.transform?.scale ?? 1,
      originX: clip.type === 'text' ? clip.text?.x ?? 0.5 : clip.type === 'shape' ? clip.shape?.x ?? 0.5 : clip.transform?.x ?? 0,
      originY: clip.type === 'text' ? clip.text?.y ?? 0.5 : clip.type === 'shape' ? clip.shape?.y ?? 0.5 : clip.transform?.y ?? 0,
      originRotation: rotation,
      originWidth: clip.type === 'shape' ? clip.shape?.width ?? 0.3 : clip.type === 'text' ? clip.text?.size ?? 64 : 0,
      originHeight: clip.type === 'shape' ? clip.shape?.height ?? 0.2 : 0,
      centreX,
      centreY,
      startAngle: (Math.atan2(e.clientY - centreY, e.clientX - centreX) * 180) / Math.PI,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const state = drag.current;
    const rect = frame?.getBoundingClientRect();
    if (!state || !rect) return;
    const dx = (e.clientX - state.startX) / rect.width;
    const dy = (e.clientY - state.startY) / rect.height;

    if (state.handle === 'move') {
      patch((c) => {
        if (c.type === 'text' && c.text) {
          c.text.x = Math.max(-0.5, Math.min(1.5, state.originX + dx));
          c.text.y = Math.max(-0.5, Math.min(1.5, state.originY + dy));
        } else if (c.type === 'shape' && c.shape) {
          c.shape.x = Math.max(-0.5, Math.min(1.5, state.originX + dx));
          c.shape.y = Math.max(-0.5, Math.min(1.5, state.originY + dy));
        } else {
          c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, x: state.originX + dx, y: state.originY + dy };
        }
      });
      return;
    }

    if (state.handle === 'rotate') {
      const angle = (Math.atan2(e.clientY - state.centreY, e.clientX - state.centreX) * 180) / Math.PI;
      let next = state.originRotation + (angle - state.startAngle);
      if (e.shiftKey) next = Math.round(next / 15) * 15;
      patch((c) => {
        c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, rotation: Math.round(next) };
      });
      return;
    }

    // Corner drags scale about the centre; sign flips so every corner grows outwards.
    const signX = state.handle === 'ne' || state.handle === 'se' ? 1 : -1;
    const signY = state.handle === 'sw' || state.handle === 'se' ? 1 : -1;
    const deltaW = (dx * signX) / Math.max(0.02, box.w);
    const deltaH = (dy * signY) / Math.max(0.02, box.h);
    const growth = 1 + (deltaW + deltaH);

    patch((c) => {
      if (c.type === 'shape' && c.shape) {
        c.shape.width = Math.max(0.02, state.originWidth * Math.max(0.05, 1 + deltaW));
        c.shape.height = Math.max(0.02, state.originHeight * Math.max(0.05, 1 + deltaH));
      } else if (c.type === 'text' && c.text) {
        c.text.size = Math.max(10, Math.min(400, state.originWidth * Math.max(0.1, growth)));
      } else {
        c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, scale: Math.max(0.05, Math.min(6, state.originScale * Math.max(0.05, growth))) };
      }
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const handle = drag.current.handle;
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    end(handle === 'rotate' ? 'Rotated' : handle === 'move' ? 'Moved' : 'Resized');
  };

  const style: React.CSSProperties = {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    transform: rotation ? `rotate(${rotation}deg)` : undefined,
  };

  return (
    <div className="canvas-handles" style={style} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      <div className="handle-body" onPointerDown={onPointerDown('move')} title="Drag to move" />
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <span key={corner} className={`handle handle-${corner}`} onPointerDown={onPointerDown(corner)} title="Drag to resize" />
      ))}
      <span className="handle handle-rotate" onPointerDown={onPointerDown('rotate')} title="Drag to rotate (hold Shift to snap)" />
      <span className="handle-stem" />
    </div>
  );
}
