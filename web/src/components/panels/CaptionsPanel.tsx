import React, { useRef, useState } from 'react';
import { api } from '../../lib/api';
import type { CaptionItem } from '../../lib/types';
import { useEditor } from '../../state/store';
import { formatTime } from '../../lib/model';
import { Button, ColorField, Empty, Field, Icon, Panel, SegmentedControl, Select, Slider, Toggle, useAsyncAction } from '../ui';

export function CaptionsPanel() {
  const project = useEditor((s) => s.project);
  const health = useEditor((s) => s.health);
  const commit = useEditor((s) => s.commit);
  const update = useEditor((s) => s.update);
  const setCaptions = useEditor((s) => s.setCaptions);
  const setError = useEditor((s) => s.setError);
  const setStatus = useEditor((s) => s.setStatus);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const playhead = useEditor((s) => s.playhead);
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, run] = useAsyncAction(setError);

  if (!project) return <Panel title="Captions"><Empty title="No project" /></Panel>;
  const captions = project.captions;
  const style = captions.style;

  const setStyle = (patch: Partial<typeof style>) => update((d) => Object.assign(d.captions.style, patch));
  const commitStyle = (label: string) => commit(label, () => {});

  const importFile = (file: File) =>
    run(async () => {
      const text = await file.text();
      const { items } = await api.parseCaptions(text, file.name);
      if (!items.length) {
        setError('That file did not contain any readable captions.');
        return;
      }
      setCaptions(items);
      setStatus(`Imported ${items.length} caption lines`);
    });

  const transcribe = () =>
    run(async () => {
      const source =
        project.tracks
          .flatMap((t) => t.clips)
          .map((c) => project.media.find((m) => m.id === c.mediaId))
          .find((m) => m?.hasAudio) ?? project.media.find((m) => m.hasAudio);
      if (!source) {
        setError('Add a clip with audio first.');
        return;
      }
      setStatus('Transcribing… this can take a while.');
      const { items } = await api.transcribe(source.key);
      setCaptions(items);
      setStatus(`Transcribed ${items.length} caption lines`);
    });

  return (
    <Panel
      title="Captions"
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
            Import .srt
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!captions.items.length}
            onClick={() =>
              run(async () => {
                const result = await api.exportCaptions(captions.items, project.name, 'srt');
                setStatus(`Saved ${result.filename} to your exports folder`);
              })
            }
          >
            Export .srt
          </Button>
        </>
      }
    >
      <input
        ref={fileInput}
        type="file"
        accept=".srt,.vtt,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />

      <div className="captions-head">
        <Field label="Burn captions into the video" inline>
          <Toggle checked={captions.enabled} onChange={(v) => commit(v ? 'Captions on' : 'Captions off', (d) => (d.captions.enabled = v))} />
        </Field>
        <p className="hint">
          Burned-in captions are baked into the picture — good for Shorts and silent autoplay. Leave this off and export an .srt
          to upload alongside your video instead.
        </p>
      </div>

      {!captions.items.length ? (
        <Empty icon={Icon.captions} title="No captions yet" hint="Import an .srt, or transcribe the audio locally if you have Whisper installed.">
          <div className="row row-center">
            <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
              Import .srt
            </Button>
            <Button size="sm" variant="primary" onClick={transcribe} disabled={busy || !health?.speechToText} title={health?.speechToText ? 'Transcribe with your local Whisper install' : 'Install whisper.cpp to enable local transcription'}>
              {Icon.sparkle} Auto-transcribe
            </Button>
          </div>
          {!health?.speechToText ? <p className="hint hint-center">Auto-transcribe needs a local Whisper build (`brew install whisper-cpp`).</p> : null}
        </Empty>
      ) : (
        <>
          <div className="captions-tools">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                run(async () => {
                  const { items } = await api.formatCaptions(captions.items, 'rewrap', { maxChars: 42, maxLines: 2 });
                  setCaptions(items);
                })
              }
            >
              Re-wrap lines
            </Button>
            <Button
              size="sm"
              variant="ghost"
              title="Split into short bursts, the style Shorts and TikTok use"
              onClick={() =>
                run(async () => {
                  const { items } = await api.formatCaptions(captions.items, 'words', { wordsPerChunk: 3 });
                  setCaptions(items);
                })
              }
            >
              Punch-word style
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCaptions([])}>
              Clear
            </Button>
          </div>

          <ul className="caption-list">
            {captions.items.map((item, index) => (
              <CaptionRow
                key={index}
                item={item}
                active={playhead >= item.start && playhead < item.end}
                onSeek={() => setPlayhead(item.start)}
                onChange={(patch) =>
                  update((d) => {
                    Object.assign(d.captions.items[index], patch);
                  })
                }
                onCommit={() => commit('Edited caption', () => {})}
                onDelete={() =>
                  commit('Deleted caption', (d) => {
                    d.captions.items.splice(index, 1);
                  })
                }
              />
            ))}
          </ul>
        </>
      )}

      <div className="captions-style">
        <h3>Caption look</h3>
        <Field label="Size" inline>
          <Slider value={style.size} min={20} max={140} step={1} onChange={(v) => setStyle({ size: v })} onCommit={() => commitStyle('Styled captions')} />
        </Field>
        <Field label="Colour" inline>
          <ColorField value={style.color} onChange={(v) => setStyle({ color: v })} onCommit={() => commitStyle('Styled captions')} />
        </Field>
        <Field label="Outline" inline>
          <Slider value={style.outline} min={0} max={10} step={0.5} onChange={(v) => setStyle({ outline: v })} onCommit={() => commitStyle('Styled captions')} />
        </Field>
        <Field label="Boxed background" inline>
          <Toggle checked={style.boxed} onChange={(v) => commit('Styled captions', (d) => (d.captions.style.boxed = v))} />
        </Field>
        <Field label="Placement" inline>
          <Select
            value={style.position}
            onChange={(v) => commit('Moved captions', (d) => (d.captions.style.position = v))}
            options={[
              { value: 'bottom', label: 'Bottom' },
              { value: 'middle', label: 'Middle' },
              { value: 'top', label: 'Top' },
            ]}
          />
        </Field>
        <Field label="Distance from edge" inline>
          <Slider value={style.marginV} min={20} max={500} step={5} onChange={(v) => setStyle({ marginV: v })} onCommit={() => commitStyle('Moved captions')} format={(v) => `${Math.round(v)}px`} />
        </Field>
      </div>
    </Panel>
  );
}

function CaptionRow({
  item,
  active,
  onSeek,
  onChange,
  onCommit,
  onDelete,
}: {
  item: CaptionItem;
  active: boolean;
  onSeek: () => void;
  onChange: (patch: Partial<CaptionItem>) => void;
  onCommit: () => void;
  onDelete: () => void;
}) {
  return (
    <li className={`caption-row${active ? ' is-active' : ''}`}>
      <button type="button" className="caption-time" onClick={onSeek} title="Jump here">
        {formatTime(item.start)} → {formatTime(item.end)}
      </button>
      <textarea value={item.text} rows={item.text.split('\n').length} onChange={(e) => onChange({ text: e.target.value })} onBlur={onCommit} />
      <button type="button" className="icon-button" onClick={onDelete} title="Delete line">
        {Icon.close}
      </button>
    </li>
  );
}
