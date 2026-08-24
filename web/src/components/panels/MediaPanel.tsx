import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { Media } from '../../lib/types';
import { addTrack, appendPosition, useEditor } from '../../state/store';
import { findFreeSlot, formatBytes, formatTime, makeClip } from '../../lib/model';
import { Button, Empty, Icon, Panel, useAsyncAction } from '../ui';

export function MediaPanel() {
  const project = useEditor((s) => s.project);
  const addMedia = useEditor((s) => s.addMedia);
  const commit = useEditor((s) => s.commit);
  const setError = useEditor((s) => s.setError);
  const setStatus = useEditor((s) => s.setStatus);
  const select = useEditor((s) => s.select);

  const fileInput = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [busy, run] = useAsyncAction(setError);

  const upload = useCallback(
    (files: File[]) =>
      run(async () => {
        if (!files.length) return;
        setUploadProgress(0);
        try {
          const result = await api.upload(files, setUploadProgress);
          addMedia(result.media);
          if (result.errors.length) setError(result.errors.map((e) => `${e.path}: ${e.error}`).join('\n'));
          else setStatus(`Imported ${result.media.length} file${result.media.length > 1 ? 's' : ''}`);
        } finally {
          setUploadProgress(null);
        }
      }),
    [addMedia, run, setError, setStatus]
  );

  /** Drop straight onto the bin: browser drops give Files, not paths. */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = [...e.dataTransfer.files];
    if (files.length) void upload(files);
  };

  const addToTimeline = (media: Media) => {
    let newId: string | null = null;
    commit(`Added ${media.name}`, (draft) => {
      const wantsAudio = !media.hasVideo && media.kind !== 'image';
      let track = draft.tracks.find((t) => (wantsAudio ? t.kind === 'audio' : t.kind === 'video') && !t.locked);
      if (wantsAudio) {
        // Prefer the music bed for long audio, the voice track for anything else.
        track = draft.tracks.find((t) => t.kind === 'audio' && t.role === (media.duration > 60 ? 'music' : 'voice')) || track;
      } else {
        track = draft.tracks.filter((t) => t.kind === 'video').at(-1) || track;
      }
      if (!track) track = addTrack(draft, wantsAudio ? 'audio' : 'video');
      const clip = makeClip(media, appendPosition(track));
      clip.start = findFreeSlot(track, clip.start, clip.duration);
      track.clips.push(clip);
      track.clips.sort((a, b) => a.start - b.start);
      newId = clip.id;
    });
    if (newId) select(newId);
  };

  const media = project?.media ?? [];

  return (
    <Panel
      title="Media"
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()} disabled={busy}>
            {Icon.plus} Import
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBrowsing(true)} title="Add files already on this computer without copying them">
            {Icon.folder} Browse
          </Button>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        multiple
        accept="video/*,audio/*,image/*"
        hidden
        onChange={(e) => {
          void upload([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />

      <div className="media-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        {uploadProgress != null ? (
          <div className="upload-progress">
            <span style={{ width: `${uploadProgress * 100}%` }} />
            <em>Uploading… {Math.round(uploadProgress * 100)}%</em>
          </div>
        ) : null}

        {media.length === 0 ? (
          <Empty
            icon={Icon.film}
            title="No footage yet"
            hint="Drop video, audio or images here — or use Browse to link files already on this machine (no copying, no waiting)."
          />
        ) : (
          <ul className="media-list">
            {media.map((m) => (
              <li
                key={m.id}
                className="media-item"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/x-jumpcut-media', m.id);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onDoubleClick={() => addToTimeline(m)}
                title={`${m.path}\nDouble-click to add, or drag onto a track`}
              >
                <span className="media-thumb">
                  {m.kind === 'audio' ? Icon.wave : <img src={api.posterUrl(m.key)} alt="" loading="lazy" />}
                  <em className="media-duration">{formatTime(m.duration)}</em>
                </span>
                <span className="media-meta">
                  <strong>{m.name}</strong>
                  <small>
                    {m.kind === 'audio'
                      ? `${m.audioCodec ?? 'audio'} · ${m.channels}ch`
                      : `${m.width}×${m.height}${m.fps ? ` · ${Math.round(m.fps)}fps` : ''}`}
                    {m.size ? ` · ${formatBytes(m.size)}` : ''}
                  </small>
                </span>
                <button type="button" className="media-add" onClick={() => addToTimeline(m)} title="Add to timeline">
                  {Icon.plus}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {browsing ? (
        <FileBrowser
          onClose={() => setBrowsing(false)}
          onPick={(paths) =>
            run(async () => {
              const result = await api.importPaths(paths);
              addMedia(result.media);
              if (result.errors.length) setError(result.errors.map((e) => `${e.path}: ${e.error}`).join('\n'));
              setBrowsing(false);
            })
          }
        />
      ) : null}
    </Panel>
  );
}

function FileBrowser({ onClose, onPick }: { onClose: () => void; onPick: (paths: string[]) => void }) {
  const [dir, setDir] = useState<string | undefined>(undefined);
  const [state, setState] = useState<Awaited<ReturnType<typeof api.browse>> | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .browse(dir)
      .then((r) => !cancelled && (setState(r), setLocalError(null)))
      .catch((e) => !cancelled && setLocalError(e.message));
    return () => {
      cancelled = true;
    };
  }, [dir]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-browser">
        <header>
          <h3>Add media from this computer</h3>
          <button type="button" onClick={onClose} className="icon-button">
            {Icon.close}
          </button>
        </header>
        <div className="browser-path">
          <button type="button" disabled={!state?.parent} onClick={() => setDir(state?.parent ?? undefined)}>
            ↑ Up
          </button>
          <code>{state?.dir ?? '…'}</code>
        </div>
        {error ? <p className="inline-error">{error}</p> : null}
        <ul className="browser-list">
          {(state?.items ?? []).map((item) => (
            <li key={item.path}>
              {item.isDir ? (
                <button type="button" className="browser-dir" onClick={() => setDir(item.path)}>
                  {Icon.folder} {item.name}
                </button>
              ) : (
                <label className="browser-file">
                  <input
                    type="checkbox"
                    checked={picked.has(item.path)}
                    onChange={(e) => {
                      const next = new Set(picked);
                      e.target.checked ? next.add(item.path) : next.delete(item.path);
                      setPicked(next);
                    }}
                  />
                  {item.kind === 'audio' ? Icon.wave : item.kind === 'image' ? Icon.image : Icon.film}
                  <span>{item.name}</span>
                </label>
              )}
            </li>
          ))}
          {state && !state.items.length ? <li className="browser-empty">Nothing playable in this folder.</li> : null}
        </ul>
        <footer>
          <span>{picked.size} selected</span>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!picked.size} onClick={() => onPick([...picked])}>
            Add {picked.size || ''}
          </Button>
        </footer>
      </div>
    </div>
  );
}
