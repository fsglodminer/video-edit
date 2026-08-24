import React, { useState } from 'react';
import { addTrack, useEditor } from '../../state/store';
import { findFreeSlot, makeShapeClip, makeSolidClip } from '../../lib/model';
import type { ShapeStyle } from '../../lib/types';
import { Panel, Tabs } from '../ui';

/** Backgrounds and shapes — the parts of a stock library we can generate. */
export function ContentPanel() {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const playhead = useEditor((s) => s.playhead);
  const [tab, setTab] = useState<'backgrounds' | 'shapes'>('backgrounds');

  const addClip = (label: string, make: (start: number) => ReturnType<typeof makeShapeClip>, bottom = false) => {
    if (!project) return;
    let newId: string | null = null;
    commit(`Added ${label}`, (draft) => {
      const videoTracks = draft.tracks.filter((t) => t.kind === 'video' && !t.locked);
      // Backgrounds belong under everything; shapes go on top.
      const track = (bottom ? videoTracks.at(-1) : videoTracks[0]) || addTrack(draft, 'video');
      const clip = make(playhead);
      clip.start = findFreeSlot(track, playhead, clip.duration);
      track.clips.push(clip);
      track.clips.sort((a, b) => a.start - b.start);
      newId = clip.id;
    });
    if (newId) select(newId);
  };

  const brandColors = project?.brandKit?.colors ?? [];

  return (
    <Panel title="Content library">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'backgrounds', label: 'Backgrounds' },
          { value: 'shapes', label: 'Shapes' },
        ]}
      />

      {tab === 'backgrounds' ? (
        <>
          <div className="panel-note">
            <strong>Solid backgrounds</strong>
            <span>Dropped on the bottom track, behind your footage.</span>
          </div>
          <div className="swatch-grid">
            {(library?.backgrounds ?? []).map((b) => (
              <button
                key={b.id}
                type="button"
                className="swatch"
                style={{ background: b.color }}
                title={b.label}
                onClick={() => addClip(`${b.label} background`, (start) => makeSolidClip(start, 5, b.color), true)}
              />
            ))}
          </div>
          {brandColors.length ? (
            <>
              <h4 className="panel-subhead">From your brand kit</h4>
              <div className="swatch-grid">
                {brandColors.map((color) => (
                  <button
                    key={color}
                    type="button"
                    className="swatch"
                    style={{ background: color }}
                    title={color}
                    onClick={() => addClip('brand background', (start) => makeSolidClip(start, 5, color), true)}
                  />
                ))}
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <div className="panel-note">
            <strong>Shapes</strong>
            <span>Vector overlays — highlight boxes, arrows, name plates.</span>
          </div>
          <div className="tile-grid">
            {(library?.shapes ?? []).map((s) => (
              <button
                key={s.id}
                type="button"
                className="tile"
                onClick={() =>
                  addClip(s.label, (start) =>
                    makeShapeClip(start, 4, {
                      kind: s.id as ShapeStyle['kind'],
                      color: brandColors[0] || '#7b61ff',
                      width: s.id === 'ellipse' || s.id === 'star' ? 0.22 : 0.32,
                      height: s.id === 'ellipse' || s.id === 'star' ? 0.36 : 0.22,
                    })
                  )
                }
              >
                <span className="tile-art">
                  <span className={`shape-art shape-${s.id}`} />
                </span>
                <span className="tile-label">{s.label}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </Panel>
  );
}
