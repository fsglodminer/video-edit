import React from 'react';
import { addTrack, useEditor } from '../../state/store';
import { findFreeSlot, makeTextClip, TEXT_PRESETS } from '../../lib/model';
import { Panel } from '../ui';

/** Click a style to drop a title at the playhead — Clipchamp's text gallery. */
export function TextPanel() {
  const project = useEditor((s) => s.project);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const playhead = useEditor((s) => s.playhead);

  const add = (preset: (typeof TEXT_PRESETS)[number]) => {
    if (!project) return;
    let newId: string | null = null;
    const brandColor = project.brandKit?.colors?.[0];
    commit(`Added ${preset.label}`, (draft) => {
      const track = draft.tracks.find((t) => t.kind === 'video' && !t.locked) || addTrack(draft, 'video');
      const clip = makeTextClip(playhead, 3.5, preset.text);
      // Brand-kit colour flows into styles that use a solid background.
      if (brandColor && clip.text && preset.id === 'ticker') clip.text.background = brandColor;
      clip.start = findFreeSlot(track, playhead, clip.duration);
      track.clips.push(clip);
      track.clips.sort((a, b) => a.start - b.start);
      newId = clip.id;
    });
    if (newId) select(newId);
  };

  return (
    <Panel title="Text">
      <div className="panel-note">
        <strong>Click a style to add it</strong>
        <span>It lands at the playhead on the top video track.</span>
      </div>
      <div className="text-gallery">
        {TEXT_PRESETS.map((preset) => (
          <button key={preset.id} type="button" className="text-card" onClick={() => add(preset)}>
            <span className={`text-card-art text-art-${preset.id}`}>
              <em>{(preset.text.content ?? 'Text').split('\n')[0].slice(0, 18)}</em>
            </span>
            <span className="text-card-meta">
              <strong>{preset.label}</strong>
              <small>{preset.hint}</small>
            </span>
          </button>
        ))}
      </div>
    </Panel>
  );
}
