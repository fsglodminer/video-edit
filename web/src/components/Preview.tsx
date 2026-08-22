import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { PreviewEngine } from '../engine/preview';
import { formatTime, projectDuration } from '../lib/model';
import { useEditor } from '../state/store';
import { Button, Icon } from './ui';

export function Preview() {
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const setPlaying = useEditor((s) => s.setPlaying);
  const playhead = useEditor((s) => s.playhead);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const loop = useEditor((s) => s.loop);
  const toggleLoop = useEditor((s) => s.toggleLoop);
  const setStatus = useEditor((s) => s.setStatus);
  const setError = useEditor((s) => s.setError);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  const duration = project ? projectDuration(project) : 0;
  const fps = project?.settings.fps ?? 30;

  // The engine owns the clock while playing; React only follows along.
  useEffect(() => {
    const engine = new PreviewEngine(api.fileUrl);
    engineRef.current = engine;
    // If the browser cannot decode a file (iPhone HEVC, ProRes, …), quietly
    // build a preview proxy and carry on. Exports still use the original.
    engine.setProxyResolver(async (media) => {
      useEditor.getState().setStatus(`Preparing a preview copy of ${media.name}…`);
      try {
        const { path } = await api.makeProxy(media.key, 720);
        useEditor.getState().setStatus(path ? `Preview ready for ${media.name}` : 'Ready');
        return path;
      } catch (err) {
        useEditor.getState().setError(`Could not prepare a preview for ${media.name}: ${(err as Error).message}`);
        return null;
      }
    });
    if (canvasRef.current) {
      engine.attach(canvasRef.current, {
        onTimeUpdate: (t) => useEditor.setState({ playhead: t }),
        onEnded: () => {
          if (useEditor.getState().loop) {
            engine.seek(0);
            engine.play();
            useEditor.setState({ playhead: 0 });
          } else {
            useEditor.setState({ playing: false });
          }
        },
      });
    }
    return () => {
      engine.detach();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (project) engineRef.current?.setProject(project);
  }, [project]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (playing) engine.play();
    else engine.pause();
  }, [playing]);

  // Only push the playhead into the engine when *we* moved it (scrub, jump).
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (Math.abs(engine.currentTime - playhead) > 0.03) engine.seek(playhead);
  }, [playhead]);

  const aspect = project ? `${project.settings.width} / ${project.settings.height}` : '16 / 9';

  const step = (frames: number) => {
    setPlaying(false);
    setPlayhead(Math.max(0, playhead + frames / fps));
  };

  const grabFrame = async () => {
    if (!project) return;
    setGrabbing(true);
    try {
      const result = await api.still(project, playhead, `${project.name}-thumb`);
      setStatus(`Saved still → ${result.filename}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGrabbing(false);
    }
  };

  return (
    <div className="preview">
      <div className="preview-stage">
        <div className="preview-frame" style={{ aspectRatio: aspect }}>
          <canvas ref={canvasRef} />
          {!project?.tracks.some((t) => t.clips.length) ? (
            <div className="preview-placeholder">
              <p>Drop footage into the timeline to start editing</p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="transport">
        <div className="transport-time">
          <strong>{formatTime(playhead, fps, true)}</strong>
          <span>/ {formatTime(duration, fps, true)}</span>
        </div>

        <div className="transport-buttons">
          <Button variant="ghost" size="sm" title="Go to start (Home)" onClick={() => { setPlaying(false); setPlayhead(0); }}>
            {Icon.skipStart}
          </Button>
          <Button variant="ghost" size="sm" title="Back one frame (←)" onClick={() => step(-1)}>
            ◀|
          </Button>
          <Button variant="primary" size="md" title="Play / pause (Space)" onClick={() => setPlaying(!playing)}>
            {playing ? Icon.pause : Icon.play}
          </Button>
          <Button variant="ghost" size="sm" title="Forward one frame (→)" onClick={() => step(1)}>
            |▶
          </Button>
          <Button variant="ghost" size="sm" title="Go to end (End)" onClick={() => { setPlaying(false); setPlayhead(duration); }}>
            {Icon.skipEnd}
          </Button>
        </div>

        <div className="transport-right">
          <Button variant="ghost" size="sm" active={loop} onClick={toggleLoop} title="Loop playback (L)">
            Loop
          </Button>
          <Button variant="ghost" size="sm" onClick={grabFrame} disabled={grabbing || !project} title="Save this frame as a PNG for your thumbnail">
            {Icon.camera} {grabbing ? 'Saving…' : 'Grab frame'}
          </Button>
        </div>
      </div>

      <Scrubber duration={duration} playhead={playhead} onSeek={(t) => setPlayhead(t)} />
    </div>
  );
}

function Scrubber({ duration, playhead, onSeek }: { duration: number; playhead: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const seekTo = (clientX: number) => {
    const el = ref.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    onSeek(Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration)));
  };
  return (
    <div
      className="scrubber"
      ref={ref}
      onPointerDown={(e) => {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && seekTo(e.clientX)}
    >
      <span className="scrubber-fill" style={{ width: duration > 0 ? `${(playhead / duration) * 100}%` : '0%' }} />
      <span className="scrubber-knob" style={{ left: duration > 0 ? `${(playhead / duration) * 100}%` : '0%' }} />
    </div>
  );
}
