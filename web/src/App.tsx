import React, { useEffect, useState } from 'react';
import { Preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { MediaBin } from './components/MediaBin';
import { Inspector } from './components/Inspector';
import { CaptionsPanel } from './components/CaptionsPanel';
import { ExportDialog } from './components/ExportDialog';
import { TopBar } from './components/TopBar';
import { StatusBar } from './components/StatusBar';
import { Icon } from './components/ui';
import { useEditor } from './state/store';
import { clipEnd, rippleDelete, splitClip } from './lib/model';

export default function App() {
  const init = useEditor((s) => s.init);
  const project = useEditor((s) => s.project);
  const panel = useEditor((s) => s.activePanel);
  const setPanel = useEditor((s) => s.setPanel);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    void init();
  }, [init]);

  useKeyboardShortcuts(() => setExporting(true));

  return (
    <div className="app">
      <TopBar onExport={() => setExporting(true)} />

      <div className="workspace">
        <aside className="sidebar sidebar-left">
          <nav className="sidebar-tabs">
            <button type="button" className={panel === 'media' ? 'is-active' : ''} onClick={() => setPanel('media')} title="Media">
              {Icon.film} Media
            </button>
            <button type="button" className={panel === 'captions' ? 'is-active' : ''} onClick={() => setPanel('captions')} title="Captions">
              {Icon.captions} Captions
            </button>
          </nav>
          {panel === 'captions' ? <CaptionsPanel /> : <MediaBin />}
        </aside>

        <main className="stage">
          <Preview />
        </main>

        <aside className="sidebar sidebar-right">
          <Inspector />
        </aside>
      </div>

      <Timeline />
      <StatusBar />

      {exporting ? <ExportDialog onClose={() => setExporting(false)} /> : null}
      {!project ? <div className="boot">Loading JumpCut…</div> : null}
    </div>
  );
}

/** Editing shortcuts. Ignored while typing into a field. */
function useKeyboardShortcuts(openExport: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      const state = useEditor.getState();
      const { project, playhead, selection } = state;
      const mod = e.metaKey || e.ctrlKey;
      if (!project) return;

      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? state.redo() : state.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void state.save();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        openExport();
        return;
      }
      if (mod && e.key.toLowerCase() === 'd' && selection.length) {
        e.preventDefault();
        state.commit('Duplicated clip', (draft) => {
          for (const track of draft.tracks) {
            for (const clip of [...track.clips]) {
              if (!selection.includes(clip.id)) continue;
              const copy = structuredClone(clip);
              copy.id = `c_${Math.random().toString(36).slice(2, 10)}`;
              copy.start = clipEnd(clip);
              track.clips.push(copy);
            }
            track.clips.sort((a, b) => a.start - b.start);
          }
        });
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          state.setPlaying(!state.playing);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(playhead - (e.shiftKey ? 1 : 1 / project.settings.fps));
          break;
        case 'ArrowRight':
          e.preventDefault();
          state.setPlaying(false);
          state.setPlayhead(playhead + (e.shiftKey ? 1 : 1 / project.settings.fps));
          break;
        case 'Home':
          state.setPlayhead(0);
          break;
        case 'End': {
          let end = 0;
          for (const t of project.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
          state.setPlayhead(end);
          break;
        }
        case 's':
        case 'S':
          state.commit('Split clip', (draft) => {
            for (const track of draft.tracks) {
              if (track.locked) continue;
              for (const clip of [...track.clips]) {
                if (selection.length && !selection.includes(clip.id)) continue;
                if (playhead > clip.start && playhead < clipEnd(clip)) splitClip(track, clip, playhead);
              }
            }
          });
          break;
        case 'Delete':
        case 'Backspace': {
          if (!selection.length) break;
          e.preventDefault();
          const ripple = state.rippleMode || e.shiftKey;
          state.commit(ripple ? 'Ripple deleted' : 'Deleted clip', (draft) => {
            for (const track of draft.tracks) {
              for (const clip of [...track.clips]) {
                if (!selection.includes(clip.id)) continue;
                if (ripple) rippleDelete(track, clip);
                else track.clips = track.clips.filter((c) => c.id !== clip.id);
              }
            }
          });
          state.select(null);
          break;
        }
        case 'l':
        case 'L':
          state.toggleLoop();
          break;
        case 'n':
        case 'N':
          state.toggleSnapping();
          break;
        case 't':
        case 'T': {
          const target = project.tracks.find((t) => t.kind === 'video' && !t.locked);
          if (!target) break;
          let newId: string | null = null;
          state.commit('Added title', (draft) => {
            const track = draft.tracks.find((t) => t.id === target.id);
            if (!track) return;
            const clip = {
              id: `c_${Math.random().toString(36).slice(2, 10)}`,
              type: 'text' as const,
              start: playhead,
              duration: 3,
              inPoint: 0,
              speed: 1,
              volume: 1,
              fadeIn: 0.25,
              fadeOut: 0.25,
              transform: { fit: 'contain' as const, scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
              effects: {},
              text: {
                content: 'Your title here',
                size: 72,
                color: '#ffffff',
                align: 'center' as const,
                x: 0.5,
                y: 0.5,
                bold: true,
                strokeWidth: 6,
                strokeColor: '#000000',
                shadow: true,
                background: 'none',
                maxWidth: 0.86,
              },
            };
            track.clips.push(clip);
            track.clips.sort((a, b) => a.start - b.start);
            newId = clip.id;
          });
          if (newId) state.select(newId);
          break;
        }
        case '+':
        case '=':
          state.setZoom(state.zoom * 1.3);
          break;
        case '-':
        case '_':
          state.setZoom(state.zoom / 1.3);
          break;
        case 'Escape':
          state.select(null);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openExport]);
}
