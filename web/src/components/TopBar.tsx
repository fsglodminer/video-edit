import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useEditor } from '../state/store';
import { ASPECT_RATIOS } from '../lib/model';
import { Button, Icon, Menu } from './ui';

export function TopBar({ onExport }: { onExport: () => void }) {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const save = useEditor((s) => s.save);
  const commit = useEditor((s) => s.commit);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const past = useEditor((s) => s.past.length);
  const future = useEditor((s) => s.future.length);
  const status = useEditor((s) => s.status);
  const health = useEditor((s) => s.health);
  const loadProject = useEditor((s) => s.loadProject);
  const newProject = useEditor((s) => s.newProject);

  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(project?.name ?? '');
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => setName(project?.name ?? ''), [project?.name]);
  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.projects)).catch(() => undefined);
  }, [project?.id, status]);

  const current = ASPECT_RATIOS.find(
    (r) => project && Math.abs(r.width / r.height - project.settings.width / project.settings.height) < 0.02
  );

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="brandmark" aria-hidden>
          <svg viewBox="0 0 24 24">
            <path d="M5 4.2 19 12 5 19.8z" />
          </svg>
        </span>
        <Menu
          align="left"
          trigger={({ toggle }) => (
            <button type="button" className="project-chip" onClick={toggle} title="Projects">
              <span>{project?.name ?? 'Loading…'}</span>
              {Icon.chevronDown}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-head">Projects</div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className={`menu-item${p.id === project?.id ? ' is-active' : ''}`}
                  onClick={() => {
                    void loadProject(p.id);
                    close();
                  }}
                >
                  {p.name}
                </button>
              ))}
              <div className="menu-divider" />
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  void newProject('Untitled video');
                  close();
                }}
              >
                {Icon.plus} New project
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setRenaming(true);
                  close();
                }}
              >
                Rename this project
              </button>
            </>
          )}
        </Menu>
        {renaming ? (
          <input
            autoFocus
            className="text-field rename-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name !== project?.name) commit('Renamed project', (d) => (d.name = name.trim()));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : null}
        <span className={`save-state${dirty ? ' is-dirty' : ''}`}>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'All changes saved'}</span>
      </div>

      <div className="topbar-centre">
        <button type="button" className="icon-button" onClick={undo} disabled={!past} title="Undo (⌘Z)">
          {Icon.undo}
        </button>
        <button type="button" className="icon-button" onClick={redo} disabled={!future} title="Redo (⇧⌘Z)">
          {Icon.redo}
        </button>
      </div>

      <div className="topbar-right">
        <Menu
          trigger={({ toggle }) => (
            <button type="button" className="aspect-chip" onClick={toggle} title="Canvas shape">
              {Icon.aspect}
              <span>{current?.label ?? 'Custom'}</span>
              {Icon.chevronDown}
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-head">Canvas shape</div>
              {ASPECT_RATIOS.map((ratio) => (
                <button
                  key={ratio.id}
                  type="button"
                  className={`menu-item${current?.id === ratio.id ? ' is-active' : ''}`}
                  onClick={() => {
                    commit(`Canvas ${ratio.label}`, (d) => {
                      d.settings.width = ratio.width;
                      d.settings.height = ratio.height;
                    });
                    close();
                  }}
                >
                  <span className={`ratio-glyph ratio-${ratio.id.replace(':', '-')}`} />
                  <span className="menu-item-body">
                    <strong>{ratio.label}</strong>
                    <small>{ratio.hint}</small>
                  </span>
                  {current?.id === ratio.id ? Icon.check : null}
                </button>
              ))}
            </>
          )}
        </Menu>

        <Button variant="ghost" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          Save
        </Button>
        <Button variant="primary" size="md" onClick={onExport} disabled={!health?.ok} className="export-button">
          {Icon.export} Export
        </Button>
      </div>
    </header>
  );
}
