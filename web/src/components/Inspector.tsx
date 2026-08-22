import React, { useState } from 'react';
import { api } from '../lib/api';
import type { Clip, Project, Track } from '../lib/types';
import { useEditor, useSelectedClip } from '../state/store';
import { applySegments, DEFAULT_TEXT, DEFAULT_TRANSFORM, formatTime, maxDuration, TEXT_PRESETS } from '../lib/model';
import { Button, ColorField, Empty, Field, Icon, NumberField, Panel, SegmentedControl, Select, Slider, Toggle, useAsyncAction } from './ui';

export function Inspector() {
  const selected = useSelectedClip();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);

  if (!project) return <Panel title="Inspector"><Empty title="No project" /></Panel>;
  if (selection.length > 1) {
    return (
      <Panel title="Inspector">
        <MultiSelection count={selection.length} />
      </Panel>
    );
  }
  if (!selected) {
    return (
      <Panel title="Project">
        <ProjectSettings project={project} />
      </Panel>
    );
  }
  return (
    <Panel title={selected.clip.type === 'text' ? 'Title' : 'Clip'}>
      <ClipInspector clip={selected.clip} track={selected.track} project={project} />
    </Panel>
  );
}

function useClipEdit(clipId: string) {
  const update = useEditor((s) => s.update);
  const commit = useEditor((s) => s.commit);
  const endInteraction = useEditor((s) => s.endInteraction);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const started = React.useRef(false);

  /** Live edit while dragging a control; history is written once on release. */
  const live = (mutate: (clip: Clip) => void) => {
    if (!started.current) {
      beginInteraction();
      started.current = true;
    }
    update((draft) => {
      for (const track of draft.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) mutate(clip);
      }
    });
  };
  const done = (label: string) => {
    if (!started.current) return;
    started.current = false;
    endInteraction(label);
  };
  const once = (label: string, mutate: (clip: Clip) => void) => {
    commit(label, (draft) => {
      for (const track of draft.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) mutate(clip);
      }
    });
  };
  return { live, done, once };
}

function ClipInspector({ clip, track, project }: { clip: Clip; track: Track; project: Project }) {
  const { live, done, once } = useClipEdit(clip.id);
  const media = project.media.find((m) => m.id === clip.mediaId);
  const isText = clip.type === 'text';
  const isVisual = track.kind === 'video' && !isText;
  const hasAudio = Boolean(media?.hasAudio) && clip.type !== 'text';
  const limit = maxDuration(project, clip);

  return (
    <>
      <div className="inspector-summary">
        <strong>{isText ? clip.text?.content?.split('\n')[0] || 'Title' : media?.name || clip.name}</strong>
        <small>
          {formatTime(clip.start, project.settings.fps, true)} → {formatTime(clip.start + clip.duration, project.settings.fps, true)} ·{' '}
          {formatTime(clip.duration, project.settings.fps, true)}
        </small>
      </div>

      <Section title="Timing">
        <Field label="Start" inline>
          <NumberField value={clip.start} min={0} step={0.05} onChange={(v) => live((c) => (c.start = v))} onCommit={() => done('Moved clip')} suffix="s" />
        </Field>
        <Field label="Duration" inline>
          <NumberField
            value={clip.duration}
            min={0.05}
            max={Number.isFinite(limit) ? limit : undefined}
            step={0.05}
            onChange={(v) => live((c) => (c.duration = v))}
            onCommit={() => done('Trimmed clip')}
            suffix="s"
          />
        </Field>
        {clip.type !== 'text' && clip.type !== 'solid' && media?.kind !== 'image' ? (
          <Field label="Source in" inline hint="where this clip starts inside the file">
            <NumberField
              value={clip.inPoint}
              min={0}
              max={media ? media.duration : undefined}
              step={0.05}
              onChange={(v) => live((c) => (c.inPoint = v))}
              onCommit={() => done('Set in-point')}
              suffix="s"
            />
          </Field>
        ) : null}
        <Field label="Speed">
          <span className="row row-wrap">
            <NumberField value={clip.speed} min={0.1} max={8} step={0.05} width={78} onChange={(v) => live((c) => (c.speed = v))} onCommit={() => done('Changed speed')} suffix="×" />
            {[0.5, 1, 1.5, 2].map((s) => (
              <button key={s} type="button" className={`chip${clip.speed === s ? ' is-active' : ''}`} onClick={() => once('Changed speed', (c) => (c.speed = s))}>
                {s}×
              </button>
            ))}
          </span>
        </Field>
        <Field label="Fade in" inline>
          <Slider value={clip.fadeIn} min={0} max={Math.max(0.1, clip.duration / 2)} step={0.05} onChange={(v) => live((c) => (c.fadeIn = v))} onCommit={() => done('Set fade')} format={(v) => `${v.toFixed(2)}s`} />
        </Field>
        <Field label="Fade out" inline>
          <Slider value={clip.fadeOut} min={0} max={Math.max(0.1, clip.duration / 2)} step={0.05} onChange={(v) => live((c) => (c.fadeOut = v))} onCommit={() => done('Set fade')} format={(v) => `${v.toFixed(2)}s`} />
        </Field>
      </Section>

      {isText && clip.text ? <TextSection clip={clip} live={live} done={done} once={once} /> : null}

      {isVisual ? (
        <>
          <Section title="Transform">
            <Field label="Fit" inline>
              <SegmentedControl
                value={clip.transform?.fit ?? 'contain'}
                onChange={(v) => once('Changed fit', (c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, fit: v }))}
                options={[
                  { value: 'contain', label: 'Fit', title: 'Whole frame visible, letterboxed' },
                  { value: 'cover', label: 'Fill', title: 'Fills the frame, edges cropped' },
                  { value: 'stretch', label: 'Stretch', title: 'Ignores aspect ratio' },
                ]}
              />
            </Field>
            <Field label="Scale" inline>
              <Slider value={clip.transform?.scale ?? 1} min={0.05} max={4} step={0.01} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, scale: v }))} onCommit={() => done('Scaled clip')} format={(v) => `${Math.round(v * 100)}%`} />
            </Field>
            <Field label="Position" inline>
              <span className="row">
                <NumberField value={clip.transform?.x ?? 0} min={-2} max={2} step={0.005} precision={3} width={70} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, x: v }))} onCommit={() => done('Moved clip')} suffix="x" />
                <NumberField value={clip.transform?.y ?? 0} min={-2} max={2} step={0.005} precision={3} width={70} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, y: v }))} onCommit={() => done('Moved clip')} suffix="y" />
              </span>
            </Field>
            <Field label="Rotation" inline>
              <Slider value={clip.transform?.rotation ?? 0} min={-180} max={180} step={1} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, rotation: v }))} onCommit={() => done('Rotated clip')} format={(v) => `${Math.round(v)}°`} />
            </Field>
            <Field label="Opacity" inline>
              <Slider value={clip.transform?.opacity ?? 1} min={0} max={1} step={0.01} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, opacity: v }))} onCommit={() => done('Set opacity')} format={(v) => `${Math.round(v * 100)}%`} />
            </Field>
            <div className="row row-end">
              <Button size="sm" variant="ghost" onClick={() => once('Reset transform', (c) => (c.transform = { ...DEFAULT_TRANSFORM, fit: 'cover' }))}>
                Reset
              </Button>
              <Button size="sm" variant="ghost" title="Shrink into a corner, like a webcam inset" onClick={() => once('Made picture-in-picture', (c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, fit: 'cover', scale: 0.3, x: 0.32, y: -0.3 }))}>
                Make PiP
              </Button>
            </div>
          </Section>

          <Section title="Crop" collapsed>
            {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
              <Field key={edge} label={edge[0].toUpperCase() + edge.slice(1)} inline>
                <Slider
                  value={clip.crop?.[edge] ?? 0}
                  min={0}
                  max={0.45}
                  step={0.005}
                  onChange={(v) => live((c) => (c.crop = { left: 0, top: 0, right: 0, bottom: 0, ...c.crop, [edge]: v }))}
                  onCommit={() => done('Cropped clip')}
                  format={(v) => `${Math.round(v * 100)}%`}
                />
              </Field>
            ))}
          </Section>

          <Section title="Look" collapsed>
            {(
              [
                ['brightness', 'Brightness', -0.5, 0.5, 0],
                ['contrast', 'Contrast', 0.2, 2.5, 1],
                ['saturation', 'Saturation', 0, 3, 1],
                ['hue', 'Hue shift', -180, 180, 0],
                ['blur', 'Blur', 0, 20, 0],
                ['sharpen', 'Sharpen', 0, 2, 0],
              ] as const
            ).map(([key, label, min, max, base]) => (
              <Field key={key} label={label} inline>
                <Slider
                  value={(clip.effects?.[key] as number) ?? base}
                  min={min}
                  max={max}
                  step={0.01}
                  onChange={(v) => live((c) => (c.effects = { ...c.effects, [key]: v }))}
                  onCommit={() => done('Adjusted look')}
                />
              </Field>
            ))}
            <Field label="Black & white" inline>
              <Toggle checked={Boolean(clip.effects?.grayscale)} onChange={(v) => once('Adjusted look', (c) => (c.effects = { ...c.effects, grayscale: v }))} />
            </Field>
            <div className="row row-end">
              <Button size="sm" variant="ghost" onClick={() => once('Reset look', (c) => (c.effects = {}))}>
                Reset look
              </Button>
            </div>
          </Section>
        </>
      ) : null}

      {hasAudio ? (
        <Section title="Audio">
          <Field label="Volume" inline>
            <Slider value={clip.volume} min={0} max={2} step={0.01} onChange={(v) => live((c) => (c.volume = v))} onCommit={() => done('Set volume')} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
          <Field label="Mute" inline>
            <Toggle checked={Boolean(clip.muted)} onChange={(v) => once(v ? 'Muted clip' : 'Unmuted clip', (c) => (c.muted = v))} />
          </Field>
          <Field label="Noise reduction" inline hint="tames hiss and room tone">
            <Toggle checked={Boolean(clip.denoise)} onChange={(v) => once('Toggled noise reduction', (c) => (c.denoise = v))} />
          </Field>
          <Field label="Rumble filter" inline hint="cuts below 80 Hz">
            <Toggle checked={Boolean(clip.highpass)} onChange={(v) => once('Toggled rumble filter', (c) => (c.highpass = v))} />
          </Field>
          {media ? <SilenceTool clip={clip} trackId={track.id} mediaKey={media.key} /> : null}
        </Section>
      ) : null}
    </>
  );
}

/** The jump-cut maker: find the silences, drop them, close the gaps. */
function SilenceTool({ clip, trackId, mediaKey }: { clip: Clip; trackId: string; mediaKey: string }) {
  const commit = useEditor((s) => s.commit);
  const setError = useEditor((s) => s.setError);
  const setStatus = useEditor((s) => s.setStatus);
  const [threshold, setThreshold] = useState(-32);
  const [minSilence, setMinSilence] = useState(0.45);
  const [padding, setPadding] = useState(0.08);
  const [busy, run] = useAsyncAction(setError);

  const apply = () =>
    run(async () => {
      const result = await api.silence(mediaKey, { threshold, minSilence, padding });
      if (!result.segments.length) {
        setStatus('No speech detected — try a lower threshold.');
        return;
      }
      let created = 0;
      commit('Removed silences', (draft) => {
        const track = draft.tracks.find((t) => t.id === trackId);
        const target = track?.clips.find((c) => c.id === clip.id);
        if (!track || !target) return;
        created = applySegments(track, target, result.segments).length;
      });
      setStatus(`Cut ${result.removed.toFixed(1)}s of silence into ${created} clips`);
    });

  return (
    <div className="tool-card">
      <header>
        {Icon.scissors}
        <div>
          <strong>Remove silences</strong>
          <small>Splits this clip at every pause and closes the gaps — instant jump cuts.</small>
        </div>
      </header>
      <Field label="Silence below" inline>
        <Slider value={threshold} min={-60} max={-10} step={1} onChange={setThreshold} format={(v) => `${Math.round(v)} dB`} />
      </Field>
      <Field label="Shortest pause" inline>
        <Slider value={minSilence} min={0.1} max={2} step={0.05} onChange={setMinSilence} format={(v) => `${v.toFixed(2)}s`} />
      </Field>
      <Field label="Keep breathing room" inline>
        <Slider value={padding} min={0} max={0.5} step={0.01} onChange={setPadding} format={(v) => `${v.toFixed(2)}s`} />
      </Field>
      <Button variant="primary" size="sm" onClick={apply} disabled={busy}>
        {busy ? 'Analysing…' : 'Cut the silences'}
      </Button>
    </div>
  );
}

function TextSection({
  clip,
  live,
  done,
  once,
}: {
  clip: Clip;
  live: (m: (c: Clip) => void) => void;
  done: (label: string) => void;
  once: (label: string, m: (c: Clip) => void) => void;
}) {
  const text = clip.text!;
  const setText = (patch: Partial<typeof text>) => live((c) => (c.text = { ...DEFAULT_TEXT, ...c.text, ...patch }));
  const setTextOnce = (label: string, patch: Partial<typeof text>) => once(label, (c) => (c.text = { ...DEFAULT_TEXT, ...c.text, ...patch }));

  return (
    <>
      <Section title="Text">
        <textarea
          className="text-input"
          value={text.content}
          rows={3}
          onChange={(e) => setText({ content: e.target.value })}
          onBlur={() => done('Edited title')}
          placeholder="Type your title…"
        />
        <div className="preset-row">
          {TEXT_PRESETS.map((preset) => (
            <button key={preset.id} type="button" className="chip" onClick={() => setTextOnce(`Applied ${preset.label}`, preset.text)}>
              {preset.label}
            </button>
          ))}
        </div>
        <Field label="Size" inline>
          <Slider value={text.size} min={16} max={220} step={1} onChange={(v) => setText({ size: v })} onCommit={() => done('Resized title')} format={(v) => `${Math.round(v)}`} />
        </Field>
        <Field label="Colour" inline>
          <ColorField value={text.color} onChange={(v) => setText({ color: v })} onCommit={() => done('Recoloured title')} />
        </Field>
        <Field label="Align" inline>
          <SegmentedControl
            value={text.align}
            onChange={(v) => setTextOnce('Aligned title', { align: v })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </Field>
        <Field label="Position" inline>
          <span className="row">
            <NumberField value={text.x} min={0} max={1} step={0.005} precision={3} width={70} onChange={(v) => setText({ x: v })} onCommit={() => done('Moved title')} suffix="x" />
            <NumberField value={text.y} min={0} max={1} step={0.005} precision={3} width={70} onChange={(v) => setText({ y: v })} onCommit={() => done('Moved title')} suffix="y" />
          </span>
        </Field>
        <Field label="Bold" inline>
          <Toggle checked={text.bold !== false} onChange={(v) => setTextOnce('Styled title', { bold: v })} />
        </Field>
        <Field label="ALL CAPS" inline>
          <Toggle checked={Boolean(text.uppercase)} onChange={(v) => setTextOnce('Styled title', { uppercase: v })} />
        </Field>
      </Section>

      <Section title="Title styling" collapsed>
        <Field label="Outline" inline>
          <Slider value={text.strokeWidth ?? 0} min={0} max={20} step={0.5} onChange={(v) => setText({ strokeWidth: v })} onCommit={() => done('Styled title')} />
        </Field>
        <Field label="Outline colour" inline>
          <ColorField value={text.strokeColor ?? '#000000'} onChange={(v) => setText({ strokeColor: v })} onCommit={() => done('Styled title')} />
        </Field>
        <Field label="Drop shadow" inline>
          <Toggle checked={Boolean(text.shadow)} onChange={(v) => setTextOnce('Styled title', { shadow: v })} />
        </Field>
        <Field label="Background" inline>
          <span className="row">
            <Toggle checked={text.background !== 'none' && Boolean(text.background)} onChange={(v) => setTextOnce('Styled title', { background: v ? '#000000' : 'none' })} />
            {text.background && text.background !== 'none' ? (
              <ColorField value={text.background} onChange={(v) => setText({ background: v })} onCommit={() => done('Styled title')} />
            ) : null}
          </span>
        </Field>
        <Field label="Line width" inline hint="wraps long titles">
          <Slider value={text.maxWidth ?? 0.86} min={0.2} max={1} step={0.01} onChange={(v) => setText({ maxWidth: v })} onCommit={() => done('Styled title')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
      </Section>
    </>
  );
}

function ProjectSettings({ project }: { project: Project }) {
  const commit = useEditor((s) => s.commit);
  const update = useEditor((s) => s.update);
  const begin = useEditor((s) => s.beginInteraction);
  const end = useEditor((s) => s.endInteraction);

  const setSettings = (patch: Partial<Project['settings']>) => commit('Changed project settings', (d) => Object.assign(d.settings, patch));
  const setAudio = (patch: Partial<Project['audio']>) => commit('Changed audio settings', (d) => Object.assign(d.audio, patch));

  return (
    <>
      <Section title="Canvas">
        <Field label="Preset" inline>
          <Select
            value={`${project.settings.width}x${project.settings.height}`}
            onChange={(v) => {
              const [width, height] = v.split('x').map(Number);
              setSettings({ width, height });
            }}
            options={[
              { value: '1920x1080', label: '1080p landscape (16:9)' },
              { value: '2560x1440', label: '1440p landscape' },
              { value: '3840x2160', label: '4K landscape' },
              { value: '1080x1920', label: 'Shorts / Reels (9:16)' },
              { value: '1080x1080', label: 'Square (1:1)' },
              { value: '1280x720', label: '720p landscape' },
            ]}
          />
        </Field>
        <Field label="Frame rate" inline>
          <Select
            value={String(project.settings.fps)}
            onChange={(v) => setSettings({ fps: Number(v) })}
            options={[
              { value: '24', label: '24 fps (cinematic)' },
              { value: '25', label: '25 fps (PAL)' },
              { value: '30', label: '30 fps (standard)' },
              { value: '60', label: '60 fps (smooth)' },
            ]}
          />
        </Field>
        <Field label="Background" inline>
          <ColorField value={project.settings.background} onChange={(v) => update((d) => (d.settings.background = v))} onCommit={() => commit('Changed background', () => {})} />
        </Field>
      </Section>

      <Section title="Audio mix">
        <Field label="Master volume" inline>
          <Slider
            value={project.audio.masterVolume}
            min={0}
            max={2}
            step={0.01}
            onChange={(v) => {
              begin();
              update((d) => (d.audio.masterVolume = v));
            }}
            onCommit={() => end('Set master volume')}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </Field>
        <Field label="Normalise loudness" inline hint="aims for YouTube's −14 LUFS">
          <Toggle checked={project.audio.normalize} onChange={(v) => setAudio({ normalize: v })} />
        </Field>
        <Field label="Duck music under voice" inline>
          <Toggle checked={project.audio.ducking.enabled} onChange={(v) => commit('Toggled ducking', (d) => (d.audio.ducking.enabled = v))} />
        </Field>
        {project.audio.ducking.enabled ? (
          <Field label="Duck amount" inline>
            <Slider
              value={project.audio.ducking.amount}
              min={0}
              max={1}
              step={0.01}
              onChange={(v) => {
                begin();
                update((d) => (d.audio.ducking.amount = v));
              }}
              onCommit={() => end('Set ducking')}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </Field>
        ) : null}
      </Section>

      <Section title="Watermark / logo" collapsed>
        <Field label="Show watermark" inline>
          <Toggle checked={project.watermark.enabled} onChange={(v) => commit('Toggled watermark', (d) => (d.watermark.enabled = v))} />
        </Field>
        <Field label="Image" inline>
          <Select
            value={project.watermark.path ?? ''}
            onChange={(v) => commit('Set watermark', (d) => (d.watermark.path = v || null))}
            options={[{ value: '', label: 'Choose an imported image…' }, ...project.media.filter((m) => m.kind === 'image').map((m) => ({ value: m.path, label: m.name }))]}
          />
        </Field>
        <Field label="Corner" inline>
          <Select
            value={project.watermark.position}
            onChange={(v) => commit('Moved watermark', (d) => (d.watermark.position = v))}
            options={[
              { value: 'top-left', label: 'Top left' },
              { value: 'top-right', label: 'Top right' },
              { value: 'bottom-left', label: 'Bottom left' },
              { value: 'bottom-right', label: 'Bottom right' },
            ]}
          />
        </Field>
        <Field label="Size" inline>
          <Slider value={project.watermark.size} min={0.02} max={0.4} step={0.005} onChange={(v) => { begin(); update((d) => (d.watermark.size = v)); }} onCommit={() => end('Resized watermark')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
        <Field label="Opacity" inline>
          <Slider value={project.watermark.opacity} min={0} max={1} step={0.01} onChange={(v) => { begin(); update((d) => (d.watermark.opacity = v)); }} onCommit={() => end('Set watermark opacity')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
      </Section>
    </>
  );
}

function MultiSelection({ count }: { count: number }) {
  const commit = useEditor((s) => s.commit);
  const selection = useEditor((s) => s.selection);
  const select = useEditor((s) => s.select);
  return (
    <Empty title={`${count} clips selected`} hint="Nudge, delete or ripple-delete them together.">
      <div className="row row-center">
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            commit(`Deleted ${count} clips`, (d) => {
              for (const track of d.tracks) track.clips = track.clips.filter((c) => !selection.includes(c.id));
            });
            select(null);
          }}
        >
          {Icon.trash} Delete
        </Button>
      </div>
    </Empty>
  );
}

function Section({ title, children, collapsed }: { title: string; children: React.ReactNode; collapsed?: boolean }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <section className={`inspector-section${open ? ' is-open' : ''}`}>
      <button type="button" className="inspector-section-title" onClick={() => setOpen(!open)}>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        {title}
      </button>
      {open ? <div className="inspector-section-body">{children}</div> : null}
    </section>
  );
}
