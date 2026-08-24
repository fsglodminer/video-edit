import React from 'react';
import { api } from '../../lib/api';
import { useEditor } from '../../state/store';
import { Button, ColorField, Field, Icon, Panel, Select, Toggle } from '../ui';

/** Brand kit: the colours, font and logo that text and shapes default to. */
export function BrandPanel() {
  const project = useEditor((s) => s.project);
  const fonts = useEditor((s) => s.fonts);
  const commit = useEditor((s) => s.commit);
  const update = useEditor((s) => s.update);

  if (!project) return <Panel title="Brand kit" />;
  const kit = project.brandKit ?? { colors: [], font: null, logoPath: null };
  const images = project.media.filter((m) => m.kind === 'image');

  return (
    <Panel title="Brand kit">
      <div className="panel-note">
        <strong>Your colours, font and logo</strong>
        <span>New titles and shapes start from these.</span>
      </div>

      <div className="panel-section">
        <h4 className="panel-subhead">Colours</h4>
        <div className="brand-colors">
          {kit.colors.map((color, index) => (
            <span key={index} className="brand-color">
              <ColorField
                value={color}
                onChange={(v) => update((d) => (d.brandKit.colors[index] = v))}
                onCommit={() => commit('Brand colour', () => {})}
              />
              <button
                type="button"
                className="icon-button"
                title="Remove"
                onClick={() => commit('Removed brand colour', (d) => d.brandKit.colors.splice(index, 1))}
              >
                {Icon.close}
              </button>
            </span>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={() => commit('Added brand colour', (d) => d.brandKit.colors.push('#7b61ff'))}>
          {Icon.plus} Add colour
        </Button>
      </div>

      <div className="panel-section">
        <h4 className="panel-subhead">Font</h4>
        <Select
          value={kit.font ?? ''}
          onChange={(v) => commit('Brand font', (d) => (d.brandKit.font = v || null))}
          options={[{ value: '', label: 'System default' }, ...fonts.map((f) => ({ value: f.path, label: f.name }))]}
        />
      </div>

      <div className="panel-section">
        <h4 className="panel-subhead">Logo</h4>
        <Select
          value={kit.logoPath ?? ''}
          onChange={(v) =>
            commit('Brand logo', (d) => {
              d.brandKit.logoPath = v || null;
              d.watermark.path = v || null;
            })
          }
          options={[{ value: '', label: 'None — import an image first' }, ...images.map((m) => ({ value: m.path, label: m.name }))]}
        />
        {kit.logoPath ? (
          <>
            <img className="brand-logo-preview" src={api.fileUrl(kit.logoPath)} alt="" />
            <Field label="Show on every export" inline>
              <Toggle checked={project.watermark.enabled} onChange={(v) => commit('Watermark', (d) => (d.watermark.enabled = v))} />
            </Field>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
