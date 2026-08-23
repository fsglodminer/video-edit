import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useEditor } from '../../state/store';
import { Button, Empty, Icon, Panel, Select } from '../ui';

type Mode = 'webcam' | 'screen' | 'voice';

/** Pick the best container the browser will actually give us. */
function pickMimeType(withVideo: boolean): string | undefined {
  const candidates = withVideo
    ? ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type));
}

export function RecordPanel() {
  const addMedia = useEditor((s) => s.addMedia);
  const setError = useEditor((s) => s.setError);
  const setStatus = useEditor((s) => s.setStatus);

  const [mode, setMode] = useState<Mode>('webcam');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [withMic, setWithMic] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const supported = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices) && typeof MediaRecorder !== 'undefined';

  const stopStream = () => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  };

  useEffect(() => () => stopStream(), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream;
  }, [stream]);

  const start = async () => {
    try {
      let next: MediaStream;
      if (mode === 'screen') {
        next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
        if (withMic) {
          // Screen capture rarely carries the mic, so mix it in as a second track.
          try {
            const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
            mic.getAudioTracks().forEach((t) => next.addTrack(t));
          } catch {
            /* no mic permission — carry on with system audio only */
          }
        }
      } else if (mode === 'voice') {
        next = await navigator.mediaDevices.getUserMedia({ audio: true });
      } else {
        next = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: withMic });
      }
      setStream(next);
    } catch (err) {
      setError(`Could not start recording: ${(err as Error).message}`);
    }
  };

  const beginCapture = () => {
    if (!stream) return;
    const mimeType = pickMimeType(mode !== 'voice');
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = async () => {
      const type = recorder.mimeType || (mode === 'voice' ? 'audio/webm' : 'video/webm');
      const extension = type.includes('mp4') ? (mode === 'voice' ? 'm4a' : 'mp4') : mode === 'voice' ? 'weba' : 'webm';
      const blob = new Blob(chunksRef.current, { type });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const file = new File([blob], `${mode}-${stamp}.${extension}`, { type });
      try {
        setStatus('Saving recording…');
        const result = await api.upload([file]);
        addMedia(result.media);
        setStatus(`Recording saved — ${result.media[0]?.name ?? 'done'}`);
      } catch (err) {
        setError(`Could not save the recording: ${(err as Error).message}`);
      }
    };
    recorder.start(1000);
    recorderRef.current = recorder;
    setRecording(true);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((v) => v + 1), 1000);
  };

  const endCapture = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    stopStream();
  };

  if (!supported) {
    return (
      <Panel title="Record & create">
        <Empty title="Recording unavailable" hint="This browser doesn't expose MediaRecorder. Chrome, Edge and Firefox all support it." />
      </Panel>
    );
  }

  return (
    <Panel title="Record & create">
      <div className="record-modes">
        {([
          { id: 'webcam', label: 'Camera', icon: Icon.webcam },
          { id: 'screen', label: 'Screen', icon: Icon.screen },
          { id: 'voice', label: 'Voice', icon: Icon.mic },
        ] as { id: Mode; label: string; icon: React.ReactNode }[]).map((m) => (
          <button
            key={m.id}
            type="button"
            className={`record-mode${mode === m.id ? ' is-active' : ''}`}
            disabled={recording}
            onClick={() => {
              stopStream();
              setMode(m.id);
            }}
          >
            {m.icon}
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      <div className="record-stage">
        {stream && mode !== 'voice' ? (
          <video ref={videoRef} autoPlay muted playsInline />
        ) : stream ? (
          <div className="record-audio-live">{Icon.mic} Listening…</div>
        ) : (
          <div className="record-placeholder">
            {mode === 'screen' ? 'Share a window or tab' : mode === 'voice' ? 'Record a voiceover' : 'Camera preview'}
          </div>
        )}
        {recording ? (
          <span className="record-badge">
            <span className="record-dot" />
            {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
          </span>
        ) : null}
      </div>

      {mode !== 'voice' ? (
        <label className="field field-inline">
          <span className="field-label">Include microphone</span>
          <span className="field-control">
            <input type="checkbox" checked={withMic} disabled={Boolean(stream)} onChange={(e) => setWithMic(e.target.checked)} />
          </span>
        </label>
      ) : null}

      <div className="record-actions">
        {!stream ? (
          <Button variant="primary" onClick={start}>
            {Icon.record} Set up {mode === 'screen' ? 'screen' : mode === 'voice' ? 'mic' : 'camera'}
          </Button>
        ) : !recording ? (
          <>
            <Button variant="ghost" onClick={stopStream}>
              Cancel
            </Button>
            <Button variant="primary" onClick={beginCapture}>
              {Icon.record} Start recording
            </Button>
          </>
        ) : (
          <Button variant="danger" onClick={endCapture}>
            Stop and save
          </Button>
        )}
      </div>

      <p className="hint">Recordings are saved straight into Your media, ready to drag onto the timeline.</p>
    </Panel>
  );
}
