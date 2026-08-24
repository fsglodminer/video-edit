import React, { useMemo } from 'react';
import { useEditor } from '../../state/store';
import { applyTransition, clipEnd, removeTransition, transitionPoints } from '../../lib/model';
import type { Clip } from '../../lib/types';
import { Empty, Icon, Panel, Slider } from '../ui';

interface Junction {
  trackId: string;
  clip: Clip;
  previous: Clip;
  at: number;
}

/**
 * A transition lives on the junction *before* a clip. We edit the selected
 * clip's junction, or fall back to whichever one is nearest the playhead.
 */
export function TransitionsPanel() {
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const selection = useEditor((s) => s.selection);
  const playhead = useEditor((s) => s.playhead);
  const commit = useEditor((s) => s.commit);
  const setStatus = useEditor((s) => s.setStatus);

  const target = useMemo<Junction | null>(() => {
    if (!project) return null;
    let nearest: (Junction & { distance: number }) | null = null;
    for (const track of project.tracks) {
      if (track.kind !== 'video') continue;
      for (const point of transitionPoints(track)) {
        if (selection.includes(point.clip.id)) return { trackId: track.id, ...point };
        const distance = Math.abs(point.at - playhead);
        if (!nearest || distance < nearest.distance) nearest = { trackId: track.id, ...point, distance };
      }
    }
    return nearest;
  }, [project, selection, playhead]);

  const grouped = useMemo(() => {
    const map = new Map<string, { id: string; label: string }[]>();
    for (const t of library?.transitions ?? []) {
      if (!map.has(t.group)) map.set(t.group, []);
      map.get(t.group)!.push(t);
    }
    return [...map.entries()];
  }, [library]);

  if (!project) return <Panel title="Transitions"><Empty title="No project" /></Panel>;

  const current = target?.clip.transitionIn ?? null;
  const overlap = target ? Math.max(0, clipEnd(target.previous) - target.clip.start) : 0;

  const apply = (type: string, length?: number) => {
    if (!target) return;
    commit(`Added ${type} transition`, (draft) => {
      const track = draft.tracks.find((t) => t.id === target.trackId);
      if (track) applyTransition(track, target.clip.id, type, length ?? (overlap || 0.6));
    });
    setStatus('Transition added');
  };

  return (
    <Panel title="Transitions">
      {!target ? (
        <Empty
          icon={Icon.transitions}
          title="Nothing to transition yet"
          hint="Transitions sit between two touching clips. Put a second clip on the timeline, then pick it to add one."
        />
      ) : (
        <>
          <div className="panel-note">
            <strong>
              {target.previous.name || 'Clip'} → {target.clip.name || 'Clip'}
            </strong>
            <span>{current ? `${current.type} · ${overlap.toFixed(2)}s` : 'No transition on this cut yet'}</span>
          </div>

          {current ? (
            <div className="panel-inset">
              <label className="field field-inline">
                <span className="field-label">Length</span>
                <span className="field-control">
                  <Slider
                    value={overlap}
                    min={0.15}
                    max={Math.max(0.3, Math.min(target.previous.duration, target.clip.duration) * 0.9)}
                    step={0.05}
                    onChange={(v) => apply(current.type, v)}
                    format={(v) => `${v.toFixed(2)}s`}
                  />
                </span>
              </label>
              <button
                type="button"
                className="link-button"
                onClick={() =>
                  commit('Removed transition', (draft) => {
                    const track = draft.tracks.find((t) => t.id === target.trackId);
                    if (track) removeTransition(track, target.clip.id);
                  })
                }
              >
                Remove transition
              </button>
            </div>
          ) : null}

          {grouped.map(([group, items]) => (
            <div key={group} className="tile-group">
              <h4>{group}</h4>
              <div className="tile-grid">
                {items.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`tile${current?.type === t.id ? ' is-active' : ''}`}
                    onClick={() => apply(t.id)}
                    title={t.label}
                  >
                    <span className={`tile-art transition-art transition-${t.id}`} />
                    <span className="tile-label">{t.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </Panel>
  );
}
