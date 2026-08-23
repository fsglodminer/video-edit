import React, { useState } from 'react';
import { api } from '../lib/api';
import type { Clip, Project, Track } from '../lib/types';
import { useEditor, useSelectedClip } from '../state/store';
import { applySegments, DEFAULT_SHAPE, DEFAULT_TEXT, DEFAULT_TRANSFORM, formatTime, maxDuration } from '../lib/model';
import { Button, ColorField, Empty, Field, Icon, NumberField, Panel, SegmentedControl, Select, Slider, Tabs, Toggle, useAsyncAction } from './ui';

type Tab = 'style' | 'fade' | 'filters' | 'adjust' | 'speed' | 'audio' | 'key';

/** Right-hand properties panel — appears when a clip is selected. */
export function Properties() {
  const selected = useSelectedClip();
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const [tab, setTab] = useState<Tab>('style');

  if (!project) return null;

  if (selection.length > 1) {
    return (
      <aside className="properties">
        <Panel title={`${selection.length} clips`}>
          <Empty title={`${selection.length} clips selected`} hint="Move, delete or ripple-delete them together.">
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                commit(`Deleted ${selection.length} clips`, (d) => {
                  for (const track of d.tracks) track.clips = track.clips.filter((c) => !selection.includes(c.id));
                });
                select(null);
              }}
            >
              {Icon.trash} Delete
            </Button>
          </Empty>
        </Panel>
      </aside>
    );
  }

  if (!selected) return null;

  const { clip, track } = selected;
  const media = project.media.find((m) => m.id === clip.mediaId);
  const isText = clip.type === 'text';
  const isShape = clip.type === 'shape';
  const isVisual = track.kind === 'video' && !isText && !isShape;
  const hasAudio = Boolean(media?.hasAudio) && !isText && !isShape;

  const tabs: { value: Tab; label: string; icon?: React.ReactNode }[] = [
    { value: 'style', label: isText ? 'Text' : isShape ? 'Shape' : 'Layout', icon: isText ? Icon.text : Icon.crop },
    ...(isVisual ? [{ value: 'filters' as Tab, label: 'Filters', icon: Icon.filters }] : []),
    ...(isVisual ? [{ value: 'adjust' as Tab, label: 'Adjust', icon: Icon.adjust }] : []),
    { value: 'fade', label: 'Fade', icon: Icon.fade },
    ...(!isText && !isShape ? [{ value: 'speed' as Tab, label: 'Speed', icon: Icon.speed }] : []),
    ...(hasAudio ? [{ value: 'audio' as Tab, label: 'Audio', icon: Icon.audio }] : []),
    ...(isVisual ? [{ value: 'key' as Tab, label: 'Green screen', icon: Icon.greenscreen }] : []),
  ];
  const active = tabs.some((t) => t.value === tab) ? tab : 'style';

  return (
    <aside className="properties">
      <header className="properties-head">
        <div className="properties-title">
          <strong>{isText ? clip.text?.content?.split('\n')[0] || 'Title' : isShape ? `${clip.shape?.kind} shape` : media?.name || clip.name}</strong>
          <small>
            {formatTime(clip.start, project.settings.fps)} → {formatTime(clip.start + clip.duration, project.settings.fps)}
          </small>
        </div>
        <button type="button" className="icon-button" onClick={() => select(null)} title="Close">
          {Icon.close}
        </button>
      </header>

      <Tabs value={active} onChange={setTab} tabs={tabs} />

      <div className="properties-body">
        {active === 'style' ? <StyleTab clip={clip} track={track} project={project} /> : null}
        {active === 'filters' ? <FiltersTab clip={clip} /> : null}
        {active === 'adjust' ? <AdjustTab clip={clip} /> : null}
        {active === 'fade' ? <FadeTab clip={clip} /> : null}
        {active === 'speed' ? <SpeedTab clip={clip} project={project} /> : null}
        {active === 'audio' && media ? <AudioTab clip={clip} track={track} mediaKey={media.key} /> : null}
        {active === 'key' ? <ChromaTab clip={clip} /> : null}
      </div>
    </aside>
  );
}

/** Live edits during a drag, one history entry when it settles. */
function useClipEdit(clipId: string) {
  const update = useEditor((s) => s.update);
  const commit = useEditor((s) => s.commit);
  const beginInteraction = useEditor((s) => s.beginInteraction);
  const endInteraction = useEditor((s) => s.endInteraction);
  const started = React.useRef(false);

  const forEachClip = (draft: Project, mutate: (c: Clip) => void) => {
    for (const track of draft.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) mutate(clip);
    }
  };

  return {
    live(mutate: (clip: Clip) => void) {
      if (!started.current) {
        beginInteraction();
        started.current = true;
      }
      update((draft) => forEachClip(draft, mutate));
    },
    done(label: string) {
      if (!started.current) return;
      started.current = false;
      endInteraction(label);
    },
    once(label: string, mutate: (clip: Clip) => void) {
      commit(label, (draft) => forEachClip(draft, mutate));
    },
  };
}

function StyleTab({ clip, track, project }: { clip: Clip; track: Track; project: Project }) {
  const { live, done, once } = useClipEdit(clip.id);
  const library = useEditor((s) => s.library);
  const brandColors = project.brandKit?.colors ?? [];

  if (clip.type === 'text' && clip.text) {
    const text = clip.text;
    const set = (patch: Partial<typeof text>) => live((c) => (c.text = { ...DEFAULT_TEXT, ...c.text, ...patch }));
    const setOnce = (label: string, patch: Partial<typeof text>) => once(label, (c) => (c.text = { ...DEFAULT_TEXT, ...c.text, ...patch }));
    return (
      <>
        <textarea
          className="text-input"
          value={text.content}
          rows={3}
          onChange={(e) => set({ content: e.target.value })}
          onBlur={() => done('Edited title')}
          placeholder="Type your title…"
        />
        <Field label="Animation" inline>
          <Select
            value={text.animation ?? 'none'}
            onChange={(v) => setOnce('Text animation', { animation: v as typeof text.animation })}
            options={(library?.textAnimations ?? [{ id: 'none', label: 'None' }]).map((a) => ({ value: a.id, label: a.label }))}
          />
        </Field>
        <Field label="Size" inline>
          <Slider value={text.size} min={16} max={260} step={1} onChange={(v) => set({ size: v })} onCommit={() => done('Resized title')} format={(v) => `${Math.round(v)}`} />
        </Field>
        <Field label="Colour" inline>
          <ColorField value={text.color} onChange={(v) => set({ color: v })} onCommit={() => done('Recoloured title')} />
        </Field>
        {brandColors.length ? <BrandSwatches colors={brandColors} onPick={(c) => setOnce('Brand colour', { color: c })} /> : null}
        <Field label="Align" inline>
          <SegmentedControl
            value={text.align}
            onChange={(v) => setOnce('Aligned title', { align: v })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </Field>
        <Field label="Bold" inline>
          <Toggle checked={text.bold !== false} onChange={(v) => setOnce('Styled title', { bold: v })} />
        </Field>
        <Field label="ALL CAPS" inline>
          <Toggle checked={Boolean(text.uppercase)} onChange={(v) => setOnce('Styled title', { uppercase: v })} />
        </Field>
        <Field label="Outline" inline>
          <Slider value={text.strokeWidth ?? 0} min={0} max={20} step={0.5} onChange={(v) => set({ strokeWidth: v })} onCommit={() => done('Styled title')} />
        </Field>
        <Field label="Outline colour" inline>
          <ColorField value={text.strokeColor ?? '#000000'} onChange={(v) => set({ strokeColor: v })} onCommit={() => done('Styled title')} />
        </Field>
        <Field label="Drop shadow" inline>
          <Toggle checked={Boolean(text.shadow)} onChange={(v) => setOnce('Styled title', { shadow: v })} />
        </Field>
        <Field label="Background" inline>
          <span className="row">
            <Toggle checked={Boolean(text.background && text.background !== 'none')} onChange={(v) => setOnce('Styled title', { background: v ? brandColors[0] || '#000000' : 'none' })} />
            {text.background && text.background !== 'none' ? (
              <ColorField value={text.background} onChange={(v) => set({ background: v })} onCommit={() => done('Styled title')} />
            ) : null}
          </span>
        </Field>
        <Field label="Line width" inline hint="wraps long titles">
          <Slider value={text.maxWidth ?? 0.86} min={0.2} max={1} step={0.01} onChange={(v) => set({ maxWidth: v })} onCommit={() => done('Styled title')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
      </>
    );
  }

  if (clip.type === 'shape' && clip.shape) {
    const shape = clip.shape;
    const set = (patch: Partial<typeof shape>) => live((c) => (c.shape = { ...DEFAULT_SHAPE, ...c.shape, ...patch }));
    const setOnce = (label: string, patch: Partial<typeof shape>) => once(label, (c) => (c.shape = { ...DEFAULT_SHAPE, ...c.shape, ...patch }));
    return (
      <>
        <Field label="Shape" inline>
          <Select
            value={shape.kind}
            onChange={(v) => setOnce('Changed shape', { kind: v as typeof shape.kind })}
            options={(library?.shapes ?? []).map((s) => ({ value: s.id, label: s.label }))}
          />
        </Field>
        <Field label="Fill" inline>
          <ColorField value={shape.color} onChange={(v) => set({ color: v })} onCommit={() => done('Recoloured shape')} />
        </Field>
        {brandColors.length ? <BrandSwatches colors={brandColors} onPick={(c) => setOnce('Brand colour', { color: c })} /> : null}
        <Field label="Filled" inline>
          <Toggle checked={shape.filled !== false} onChange={(v) => setOnce('Styled shape', { filled: v })} />
        </Field>
        <Field label="Outline" inline>
          <Slider value={shape.strokeWidth ?? 0} min={0} max={24} step={0.5} onChange={(v) => set({ strokeWidth: v })} onCommit={() => done('Styled shape')} />
        </Field>
        <Field label="Outline colour" inline>
          <ColorField value={shape.strokeColor ?? '#ffffff'} onChange={(v) => set({ strokeColor: v })} onCommit={() => done('Styled shape')} />
        </Field>
        {shape.kind === 'roundrect' ? (
          <Field label="Corner radius" inline>
            <Slider value={shape.radius ?? 0.15} min={0} max={0.5} step={0.01} onChange={(v) => set({ radius: v })} onCommit={() => done('Styled shape')} format={(v) => `${Math.round(v * 100)}%`} />
          </Field>
        ) : null}
        <Field label="Width" inline>
          <Slider value={shape.width} min={0.02} max={1.5} step={0.01} onChange={(v) => set({ width: v })} onCommit={() => done('Resized shape')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
        <Field label="Height" inline>
          <Slider value={shape.height} min={0.02} max={1.5} step={0.01} onChange={(v) => set({ height: v })} onCommit={() => done('Resized shape')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
        <Field label="Rotation" inline>
          <Slider value={clip.transform?.rotation ?? 0} min={-180} max={180} step={1} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, rotation: v }))} onCommit={() => done('Rotated shape')} format={(v) => `${Math.round(v)}°`} />
        </Field>
        <Field label="Opacity" inline>
          <Slider value={clip.transform?.opacity ?? 1} min={0} max={1} step={0.01} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, opacity: v }))} onCommit={() => done('Set opacity')} format={(v) => `${Math.round(v * 100)}%`} />
        </Field>
      </>
    );
  }

  return (
    <>
      <Field label="Fit" inline>
        <SegmentedControl
          value={clip.transform?.fit ?? 'contain'}
          onChange={(v) => once('Changed fit', (c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, fit: v }))}
          options={[
            { value: 'contain', label: 'Fit', title: 'Whole frame visible' },
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
          <NumberField value={clip.transform?.x ?? 0} min={-2} max={2} step={0.005} precision={3} width={72} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, x: v }))} onCommit={() => done('Moved clip')} suffix="x" />
          <NumberField value={clip.transform?.y ?? 0} min={-2} max={2} step={0.005} precision={3} width={72} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, y: v }))} onCommit={() => done('Moved clip')} suffix="y" />
        </span>
      </Field>
      <Field label="Rotation" inline>
        <Slider value={clip.transform?.rotation ?? 0} min={-180} max={180} step={1} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, rotation: v }))} onCommit={() => done('Rotated clip')} format={(v) => `${Math.round(v)}°`} />
      </Field>
      <Field label="Opacity" inline>
        <Slider value={clip.transform?.opacity ?? 1} min={0} max={1} step={0.01} onChange={(v) => live((c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, opacity: v }))} onCommit={() => done('Set opacity')} format={(v) => `${Math.round(v * 100)}%`} />
      </Field>

      <h4 className="props-subhead">{Icon.crop} Crop</h4>
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

      <div className="row row-end props-actions">
        <Button size="sm" variant="ghost" onClick={() => once('Reset layout', (c) => { c.transform = { ...DEFAULT_TRANSFORM, fit: 'cover' }; c.crop = undefined; })}>
          Reset
        </Button>
        <Button size="sm" variant="ghost" title="Shrink into a corner, like a webcam inset" onClick={() => once('Made picture-in-picture', (c) => (c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, fit: 'cover', scale: 0.3, x: 0.32, y: -0.3 }))}>
          Picture-in-picture
        </Button>
      </div>
    </>
  );
}

function BrandSwatches({ colors, onPick }: { colors: string[]; onPick: (c: string) => void }) {
  return (
    <div className="brand-swatches">
      {colors.map((c) => (
        <button key={c} type="button" className="brand-swatch" style={{ background: c }} title={c} onClick={() => onPick(c)} />
      ))}
    </div>
  );
}

function FiltersTab({ clip }: { clip: Clip }) {
  const library = useEditor((s) => s.library);
  const { once } = useClipEdit(clip.id);
  const current = clip.filter || 'none';
  return (
    <div className="filter-grid">
      {(library?.filters ?? []).map((f) => (
        <button
          key={f.id}
          type="button"
          className={`filter-tile${current === f.id ? ' is-active' : ''}`}
          onClick={() => once(`Applied ${f.label}`, (c) => (c.filter = f.id))}
        >
          <span className="filter-art" style={{ filter: f.css || undefined }} />
          <span>{f.label}</span>
        </button>
      ))}
    </div>
  );
}

function AdjustTab({ clip }: { clip: Clip }) {
  const { live, done, once } = useClipEdit(clip.id);
  const rows = [
    ['brightness', 'Exposure', -0.5, 0.5, 0],
    ['contrast', 'Contrast', 0.2, 2.5, 1],
    ['saturation', 'Saturation', 0, 3, 1],
    ['temperature', 'Temperature', -1, 1, 0],
    ['hue', 'Hue', -180, 180, 0],
    ['vignette', 'Vignette', 0, 1, 0],
    ['filmFade', 'Fade', 0, 1, 0],
    ['blur', 'Blur', 0, 20, 0],
    ['sharpen', 'Sharpen', 0, 2, 0],
  ] as const;
  return (
    <>
      {rows.map(([key, label, min, max, base]) => (
        <Field key={key} label={label} inline>
          <Slider
            value={(clip.effects?.[key] as number) ?? base}
            min={min}
            max={max}
            step={0.01}
            onChange={(v) => live((c) => (c.effects = { ...c.effects, [key]: v }))}
            onCommit={() => done('Adjusted colours')}
          />
        </Field>
      ))}
      <Field label="Black & white" inline>
        <Toggle checked={Boolean(clip.effects?.grayscale)} onChange={(v) => once('Adjusted colours', (c) => (c.effects = { ...c.effects, grayscale: v }))} />
      </Field>
      <div className="row row-end props-actions">
        <Button size="sm" variant="ghost" onClick={() => once('Reset colours', (c) => (c.effects = {}))}>
          Reset
        </Button>
      </div>
    </>
  );
}

function FadeTab({ clip }: { clip: Clip }) {
  const { live, done } = useClipEdit(clip.id);
  const max = Math.max(0.1, clip.duration / 2);
  return (
    <>
      <Field label="Fade in" inline>
        <Slider value={clip.fadeIn} min={0} max={max} step={0.05} onChange={(v) => live((c) => (c.fadeIn = v))} onCommit={() => done('Set fade')} format={(v) => `${v.toFixed(2)}s`} />
      </Field>
      <Field label="Fade out" inline>
        <Slider value={clip.fadeOut} min={0} max={max} step={0.05} onChange={(v) => live((c) => (c.fadeOut = v))} onCommit={() => done('Set fade')} format={(v) => `${v.toFixed(2)}s`} />
      </Field>
      <p className="hint">Fades apply to the picture and the sound together. For a fade between two clips, use Transitions.</p>
    </>
  );
}

function SpeedTab({ clip, project }: { clip: Clip; project: Project }) {
  const { live, done, once } = useClipEdit(clip.id);
  const limit = maxDuration(project, clip);
  return (
    <>
      <Field label="Speed">
        <span className="row row-wrap">
          <NumberField value={clip.speed} min={0.1} max={8} step={0.05} width={80} onChange={(v) => live((c) => (c.speed = v))} onCommit={() => done('Changed speed')} suffix="×" />
          {[0.25, 0.5, 1, 1.5, 2, 4].map((s) => (
            <button key={s} type="button" className={`chip${clip.speed === s ? ' is-active' : ''}`} onClick={() => once('Changed speed', (c) => (c.speed = s))}>
              {s}×
            </button>
          ))}
        </span>
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
      <p className="hint">Audio pitch is corrected automatically, so sped-up speech still sounds natural.</p>
    </>
  );
}

function AudioTab({ clip, track, mediaKey }: { clip: Clip; track: Track; mediaKey: string }) {
  const { live, done, once } = useClipEdit(clip.id);
  return (
    <>
      <Field label="Volume" inline>
        <Slider value={clip.volume} min={0} max={2} step={0.01} onChange={(v) => live((c) => (c.volume = v))} onCommit={() => done('Set volume')} format={(v) => `${Math.round(v * 100)}%`} />
      </Field>
      <Field label="Mute" inline>
        <Toggle checked={Boolean(clip.muted)} onChange={(v) => once(v ? 'Muted clip' : 'Unmuted clip', (c) => (c.muted = v))} />
      </Field>
      <Field label="Noise reduction" inline hint="tames hiss and room tone">
        <Toggle checked={Boolean(clip.denoise)} onChange={(v) => once('Noise reduction', (c) => (c.denoise = v))} />
      </Field>
      <Field label="Rumble filter" inline hint="cuts below 80 Hz">
        <Toggle checked={Boolean(clip.highpass)} onChange={(v) => once('Rumble filter', (c) => (c.highpass = v))} />
      </Field>
      <SilenceTool clip={clip} trackId={track.id} mediaKey={mediaKey} />
    </>
  );
}

function ChromaTab({ clip }: { clip: Clip }) {
  const { live, done, once } = useClipEdit(clip.id);
  const key = clip.chromaKey ?? { enabled: false, color: '#00ff00', similarity: 0.3, blend: 0.12, despill: true };
  const set = (patch: Partial<typeof key>) => live((c) => (c.chromaKey = { ...key, ...c.chromaKey, ...patch }));
  return (
    <>
      <Field label="Remove background" inline>
        <Toggle checked={key.enabled} onChange={(v) => once(v ? 'Green screen on' : 'Green screen off', (c) => (c.chromaKey = { ...key, ...c.chromaKey, enabled: v }))} />
      </Field>
      {key.enabled ? (
        <>
          <Field label="Key colour" inline>
            <ColorField value={key.color} onChange={(v) => set({ color: v })} onCommit={() => done('Key colour')} />
          </Field>
          <div className="row row-wrap">
            {['#00ff00', '#0000ff', '#00b140'].map((c) => (
              <button key={c} type="button" className="brand-swatch" style={{ background: c }} onClick={() => once('Key colour', (x) => (x.chromaKey = { ...key, ...x.chromaKey, color: c }))} />
            ))}
          </div>
          <Field label="Tolerance" inline>
            <Slider value={key.similarity} min={0.02} max={0.8} step={0.01} onChange={(v) => set({ similarity: v })} onCommit={() => done('Key tolerance')} />
          </Field>
          <Field label="Edge softness" inline>
            <Slider value={key.blend} min={0} max={0.5} step={0.01} onChange={(v) => set({ blend: v })} onCommit={() => done('Key softness')} />
          </Field>
          <Field label="Remove colour spill" inline>
            <Toggle checked={key.despill !== false} onChange={(v) => once('Despill', (c) => (c.chromaKey = { ...key, ...c.chromaKey, despill: v }))} />
          </Field>
          <p className="hint">The preview keys at reduced resolution for speed; the export does it at full quality.</p>
        </>
      ) : (
        <p className="hint">Shoot against an evenly lit green or blue backdrop, then turn this on to drop the background out.</p>
      )}
    </>
  );
}

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
      <Field label="Breathing room" inline>
        <Slider value={padding} min={0} max={0.5} step={0.01} onChange={setPadding} format={(v) => `${v.toFixed(2)}s`} />
      </Field>
      <Button variant="primary" size="sm" onClick={apply} disabled={busy}>
        {busy ? 'Analysing…' : 'Cut the silences'}
      </Button>
    </div>
  );
}
