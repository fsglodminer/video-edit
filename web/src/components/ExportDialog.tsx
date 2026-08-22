import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { ExportPreset, Job } from '../lib/types';
import { useEditor } from '../state/store';
import { formatBytes, formatTime, projectDuration } from '../lib/model';
import { Button, Field, Icon, SegmentedControl, Select, Toggle } from './ui';

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const health = useEditor((s) => s.health);
  const setError = useEditor((s) => s.setError);
  const setStatus = useEditor((s) => s.setStatus);

  const [presets, setPresets] = useState<ExportPreset[]>([]);
  const [presetId, setPresetId] = useState('youtube-1080');
  const [quality, setQuality] = useState<'low' | 'medium' | 'high' | 'max'>('high');
  const [reframe, setReframe] = useState<'fit' | 'fill' | 'blur'>('fill');
  const [hardware, setHardware] = useState(true);
  const [filename, setFilename] = useState(project?.name ?? 'export');
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    api.presets().then((r) => setPresets(r.presets)).catch(() => undefined);
  }, []);

  const preset = presets.find((p) => p.id === presetId);
  const duration = project ? projectDuration(project) : 0;
  const needsReframe = Boolean(
    project && preset?.width && preset?.height && Math.abs(preset.width / preset.height - project.settings.width / project.settings.height) > 0.01
  );

  // Follow the render with server-sent events rather than polling.
  useEffect(() => {
    if (!job || job.status !== 'running') return;
    const source = api.jobEvents(job.id);
    source.onmessage = (e) => {
      try {
        setJob(JSON.parse(e.data));
      } catch {
        /* keep the last known state */
      }
    };
    source.addEventListener('end', () => source.close());
    source.onerror = () => source.close();
    return () => source.close();
  }, [job?.id, job?.status]);

  const start = async () => {
    if (!project) return;
    try {
      const { job: created } = await api.exportVideo(project, {
        presetId,
        quality,
        reframe,
        hardware,
        filename,
      });
      setJob(created);
      setStatus('Exporting…');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ExportPreset[]>();
    for (const p of presets) {
      if (!map.has(p.group)) map.set(p.group, []);
      map.get(p.group)!.push(p);
    }
    return [...map.entries()];
  }, [presets]);

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal modal-export">
        <header>
          <h3>Export</h3>
          <button type="button" className="icon-button" onClick={onClose}>
            {Icon.close}
          </button>
        </header>

        {job ? (
          <JobProgress job={job} onDone={() => setJob(null)} onClose={onClose} />
        ) : (
          <div className="export-body">
            <div className="export-presets">
              {grouped.map(([group, items]) => (
                <div key={group} className="export-group">
                  <h4>{group}</h4>
                  {items.map((p) => (
                    <button key={p.id} type="button" className={`export-preset${presetId === p.id ? ' is-active' : ''}`} onClick={() => setPresetId(p.id)}>
                      <strong>{p.label}</strong>
                      <small>{p.audioOnly ? 'MP3 audio' : p.gif ? 'Looping GIF' : `${p.width}×${p.height} · ${p.fps}fps`}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>

            <div className="export-options">
              <Field label="File name">
                <input className="text-field" value={filename} onChange={(e) => setFilename(e.target.value)} />
              </Field>

              {!preset?.audioOnly && !preset?.gif ? (
                <Field label="Quality">
                  <SegmentedControl
                    value={quality}
                    onChange={setQuality}
                    options={[
                      { value: 'low', label: 'Draft' },
                      { value: 'medium', label: 'Good' },
                      { value: 'high', label: 'High' },
                      { value: 'max', label: 'Max' },
                    ]}
                  />
                </Field>
              ) : null}

              {needsReframe ? (
                <Field label="Different shape — how should it fit?" hint="your project is a different aspect ratio">
                  <SegmentedControl
                    value={reframe}
                    onChange={setReframe}
                    options={[
                      { value: 'fill', label: 'Crop to fill' },
                      { value: 'fit', label: 'Letterbox' },
                      { value: 'blur', label: 'Blurred edges' },
                    ]}
                  />
                </Field>
              ) : null}

              {health?.hardwareEncoders.length ? (
                <Field label="Hardware encoding" inline hint={health.hardwareEncoders[0]}>
                  <Toggle checked={hardware} onChange={setHardware} />
                </Field>
              ) : null}

              <dl className="export-summary">
                <div>
                  <dt>Length</dt>
                  <dd>{formatTime(duration, project?.settings.fps ?? 30, true)}</dd>
                </div>
                <div>
                  <dt>Saves to</dt>
                  <dd className="ellipsis" title={health?.dirs?.exports}>
                    {health?.dirs?.exports ?? '…'}
                  </dd>
                </div>
              </dl>

              <div className="row row-end">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={start} disabled={!project || duration <= 0}>
                  {Icon.export} Export
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function JobProgress({ job, onDone, onClose }: { job: Job; onDone: () => void; onClose: () => void }) {
  const setStatus = useEditor((s) => s.setStatus);
  const percent = Math.round(job.progress * 100);

  return (
    <div className="job-progress">
      {job.status === 'running' ? (
        <>
          <h4>Rendering {job.presetLabel}</h4>
          <div className="progress-bar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <p className="progress-meta">
            {percent}%
            {job.speed ? ` · ${job.speed.toFixed(1)}× realtime` : ''}
            {job.eta != null ? ` · about ${formatTime(job.eta)} left` : ''}
          </p>
          <div className="row row-end">
            <Button
              variant="danger"
              onClick={() => {
                void api.cancelJob(job.id);
              }}
            >
              Cancel render
            </Button>
          </div>
        </>
      ) : job.status === 'done' ? (
        <>
          <h4>Done</h4>
          <p className="job-file">{job.filename}</p>
          <p className="progress-meta">
            {job.size ? formatBytes(job.size) : ''} · rendered in {formatTime(Math.max(0, ((job.finishedAt ?? 0) - job.startedAt) / 1000))}
          </p>
          <code className="job-path">{job.outPath}</code>
          <div className="row row-end">
            <Button
              variant="ghost"
              onClick={() => {
                void api.reveal(job.outPath).catch(() => setStatus('Could not open the folder on this machine.'));
              }}
            >
              {Icon.folder} Show file
            </Button>
            <Button variant="ghost" onClick={onDone}>
              Export another
            </Button>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      ) : (
        <>
          <h4>{job.status === 'cancelled' ? 'Cancelled' : 'Export failed'}</h4>
          {job.error ? <p className="job-error">{job.error}</p> : null}
          <div className="row row-end">
            <Button variant="ghost" onClick={onDone}>
              Back
            </Button>
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
