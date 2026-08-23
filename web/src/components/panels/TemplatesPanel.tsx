import React from 'react';
import { useEditor } from '../../state/store';
import { ASPECT_RATIOS, clipEnd, makeShapeClip, makeTextClip, uid } from '../../lib/model';
import type { Clip, Project, Track } from '../../lib/types';
import { Empty, Icon, Panel } from '../ui';

interface Template {
  id: string;
  label: string;
  hint: string;
  aspect?: string;
  build: (project: Project) => void;
}

const videoTracks = (p: Project) => p.tracks.filter((t) => t.kind === 'video');
const topTrack = (p: Project) => videoTracks(p)[0];
const mainTrack = (p: Project) => videoTracks(p).at(-1)!;
const timelineEnd = (t: Track) => t.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);

const push = (track: Track, clip: Clip) => {
  track.clips.push(clip);
  track.clips.sort((a, b) => a.start - b.start);
};

/**
 * Templates arrange *your* footage — we don't ship stock media, so each one
 * lays titles, shapes and settings over whatever is already on the timeline.
 */
const TEMPLATES: Template[] = [
  {
    id: 'talking-head',
    label: 'Talking head',
    hint: 'Intro title, lower third, captions on',
    build: (p) => {
      const top = topTrack(p);
      const brand = p.brandKit?.colors?.[0] ?? '#7b61ff';
      push(top, makeTextClip(0.4, 2.6, { content: 'Your video title', size: 120, y: 0.44, uppercase: true, strokeWidth: 8, animation: 'pop' }));
      push(top, makeShapeClip(3.4, 3.4, { kind: 'roundrect', x: 0.26, y: 0.82, width: 0.34, height: 0.12, color: brand, radius: 0.35 }));
      push(top, makeTextClip(3.5, 3.2, { content: 'Your Name\nWhat you do', size: 44, x: 0.11, y: 0.82, align: 'left', strokeWidth: 0, shadow: false, animation: 'slideup' }));
      p.captions.enabled = true;
      p.audio.ducking.enabled = true;
    },
  },
  {
    id: 'tutorial',
    label: 'Tutorial',
    hint: 'Chapter cards every 30 seconds',
    build: (p) => {
      const top = topTrack(p);
      const end = Math.max(30, timelineEnd(mainTrack(p)));
      let index = 1;
      for (let at = 0; at < end; at += 30) {
        push(top, makeTextClip(at + 0.2, 2.4, {
          content: `${String(index).padStart(2, '0')} — Step ${index}`,
          size: 76,
          y: 0.5,
          strokeWidth: 0,
          shadow: true,
          animation: 'slideup',
        }));
        index += 1;
      }
      p.captions.enabled = true;
    },
  },
  {
    id: 'short',
    label: 'Vertical short',
    hint: '9:16 canvas with punch captions',
    aspect: '9:16',
    build: (p) => {
      p.settings.width = 1080;
      p.settings.height = 1920;
      // Fill the taller frame rather than letterboxing the footage.
      for (const track of videoTracks(p)) {
        for (const clip of track.clips) {
          if (clip.type === 'video' || clip.type === 'image') clip.transform = { ...clip.transform, fit: 'cover', scale: 1 };
        }
      }
      p.captions.enabled = true;
      p.captions.style = { ...p.captions.style, size: 64, position: 'middle', outline: 5, marginV: 200 };
      push(topTrack(p), makeTextClip(0.2, 2, { content: 'WAIT FOR IT', size: 92, y: 0.2, uppercase: true, color: '#ffe600', strokeWidth: 10, animation: 'pop' }));
    },
  },
  {
    id: 'promo',
    label: 'Product promo',
    hint: 'Brand bar, big claim, end card',
    build: (p) => {
      const top = topTrack(p);
      const brand = p.brandKit?.colors?.[0] ?? '#7b61ff';
      const end = Math.max(8, timelineEnd(mainTrack(p)));
      push(top, makeShapeClip(0, 2.4, { kind: 'rect', x: 0.5, y: 0.94, width: 1, height: 0.035, color: brand }));
      push(top, makeTextClip(0.3, 2.2, { content: 'Built for creators', size: 104, y: 0.5, strokeWidth: 0, shadow: true, animation: 'slideup' }));
      push(top, makeShapeClip(end - 2.5, 2.5, { kind: 'rect', x: 0.5, y: 0.5, width: 1, height: 1, color: '#0b1020' }));
      push(top, makeTextClip(end - 2.3, 2.3, { content: 'Get started today', size: 88, y: 0.5, strokeWidth: 0, shadow: false, animation: 'fade' }));
    },
  },
  {
    id: 'vlog',
    label: 'Vlog day',
    hint: 'Time-stamp corner labels',
    build: (p) => {
      const top = topTrack(p);
      const brand = p.brandKit?.colors?.[0] ?? '#7b61ff';
      const stamps = ['7:00 AM', 'Midday', 'Golden hour'];
      const end = Math.max(12, timelineEnd(mainTrack(p)));
      stamps.forEach((label, i) => {
        const at = (end / stamps.length) * i + 0.2;
        push(top, makeTextClip(at, 2.2, {
          content: label,
          size: 40,
          x: 0.13,
          y: 0.12,
          align: 'left',
          background: brand,
          backgroundOpacity: 1,
          padding: 0.35,
          strokeWidth: 0,
          animation: 'slidedown',
        }));
      });
    },
  },
];

export function TemplatesPanel() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const setStatus = useEditor((s) => s.setStatus);

  if (!project) return <Panel title="Templates" />;
  const hasFootage = project.tracks.some((t) => t.clips.length);

  return (
    <Panel title="Templates">
      <div className="panel-note">
        <strong>Layouts for your own footage</strong>
        <span>Each one adds titles, shapes and settings over what's already on the timeline.</span>
      </div>

      {!hasFootage ? (
        <Empty icon={Icon.templates} title="Add a clip first" hint="Templates arrange titles around your footage, so put something on the timeline before applying one." />
      ) : null}

      <div className="template-grid">
        {TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className="template-card"
            onClick={() => {
              commit(`Applied ${template.label}`, (draft) => template.build(draft));
              setStatus(`${template.label} applied`);
            }}
          >
            <span className={`template-art template-art-${template.id}`}>
              {template.aspect ? <em className="template-badge">{template.aspect}</em> : null}
            </span>
            <strong>{template.label}</strong>
            <small>{template.hint}</small>
          </button>
        ))}
      </div>
    </Panel>
  );
}
