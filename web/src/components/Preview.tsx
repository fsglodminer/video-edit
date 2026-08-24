import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { PreviewEngine } from '../engine/preview';
import { formatTime, projectDuration } from '../lib/model';
import { useEditor } from '../state/store';
import { Button, Icon, Menu } from './ui';
import { CanvasHandles } from './CanvasHandles';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1];

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
  const select = useEditor((s) => s.select);
  const library = useEditor((s) => s.library);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<PreviewEngine | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [fit, setFit] = useState<number | 'fit'>('fit');

  const duration = project ? projectDuration(project) : 0;
  const fps = project?.settings.fps ?? 30;

  useEffect(() => {
    const engine = new PreviewEngine(api.fileUrl);
    engineRef.current = engine;
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

  // Keep the canvas colour maths in step with the server's look presets.
  useEffect(() => {
    if (library) engineRef.current?.setFilterCss(Object.fromEntries(library.filters.map((f) => [f.id, f.css])));
  }, [library]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (playing) engine.play();
    else engine.pause();
  }, [playing]);

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
      const result = await api.still(project, playhead, `${project.name}-thumbnail`);
      setStatus(`Saved ${result.filename} to your exports folder`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGrabbing(false);
    }
  };

  const frameStyle: React.CSSProperties =
    fit === 'fit'
      ? { aspectRatio: aspect, maxWidth: '100%', maxHeight: '100%' }
      : { aspectRatio: aspect, width: `${(project?.settings.width ?? 1920) * fit}px`, maxWidth: '100%' };

  return (
    <div className="preview">
      <div className="preview-stage" onPointerDown={(e) => e.target === e.currentTarget && select(null)}>
        <div className="preview-frame" ref={frameRef} style={frameStyle}>
          <canvas ref={canvasRef} />
          <CanvasHandles frame={frameRef.current} />
          {!project?.tracks.some((t) => t.clips.length) ? (
            <div className="preview-placeholder">
              <span>{Icon.film}</span>
              <p>Add media from the left to get started</p>
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
          <button type="button" className="icon-button" title="Go to start (Home)" onClick={() => { setPlaying(false); setPlayhead(0); }}>
            {Icon.skipStart}
          </button>
          <button type="button" className="icon-button" title="Back one frame (←)" onClick={() => step(-1)}>
            {Icon.frameBack}
          </button>
          <button type="button" className="play-button" title="Play / pause (Space)" onClick={() => setPlaying(!playing)}>
            {playing ? Icon.pause : Icon.play}
          </button>
          <button type="button" className="icon-button" title="Forward one frame (→)" onClick={() => step(1)}>
            {Icon.frameNext}
          </button>
          <button type="button" className="icon-button" title="Go to end (End)" onClick={() => { setPlaying(false); setPlayhead(duration); }}>
            {Icon.skipEnd}
          </button>
        </div>

        <div className="transport-right">
          <button type="button" className={`icon-button${loop ? ' is-active' : ''}`} title="Loop playback (L)" onClick={toggleLoop}>
            {Icon.rotate}
          </button>
          <Button variant="ghost" size="sm" onClick={grabFrame} disabled={grabbing || !project} title="Save this frame as a PNG for your thumbnail">
            {Icon.camera} {grabbing ? 'Saving…' : 'Grab frame'}
          </Button>
          <Menu
            trigger={({ toggle }) => (
              <button type="button" className="zoom-trigger" onClick={toggle}>
                {fit === 'fit' ? 'Fit' : `${Math.round(fit * 100)}%`} {Icon.chevronDown}
              </button>
            )}
          >
            {(close) => (
              <>
                <button type="button" className="menu-item" onClick={() => { setFit('fit'); close(); }}>
                  Fit to window
                </button>
                {ZOOM_STEPS.map((z) => (
                  <button key={z} type="button" className="menu-item" onClick={() => { setFit(z); close(); }}>
                    {Math.round(z * 100)}%
                  </button>
                ))}
              </>
            )}
          </Menu>
        </div>
      </div>
    </div>
  );
}
