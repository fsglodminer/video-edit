import React, { useEffect } from 'react';
import { useEditor } from '../state/store';
import { Icon } from './ui';

export function StatusBar() {
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const setError = useEditor((s) => s.setError);
  const health = useEditor((s) => s.health);
  const jobs = useEditor((s) => s.jobs);
  const refreshJobs = useEditor((s) => s.refreshJobs);

  useEffect(() => {
    void refreshJobs();
    const timer = setInterval(() => void refreshJobs(), 4000);
    return () => clearInterval(timer);
  }, [refreshJobs]);

  const running = jobs.filter((j) => j.status === 'running');

  return (
    <>
      <footer className="statusbar">
        <span className="statusbar-message">{status}</span>
        {running.length ? (
          <span className="statusbar-jobs">
            {running.length} render{running.length > 1 ? 's' : ''} in progress — {Math.round(running[0].progress * 100)}%
          </span>
        ) : null}
        <span className="statusbar-spacer" />
        {health ? (
          <span className="statusbar-engine" title={health.ffmpeg.path ?? 'ffmpeg not found'}>
            ffmpeg: {health.ffmpeg.source === 'missing' ? 'not found' : health.ffmpeg.source}
            {health.hardwareEncoders.length ? ` · GPU ${health.hardwareEncoders[0]}` : ''}
          </span>
        ) : null}
      </footer>

      {error ? (
        <div className="toast toast-error" role="alert">
          <span>{error}</span>
          <button type="button" className="icon-button" onClick={() => setError(null)}>
            {Icon.close}
          </button>
        </div>
      ) : null}
    </>
  );
}
