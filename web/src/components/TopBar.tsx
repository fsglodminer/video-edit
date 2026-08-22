import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useEditor } from '../state/store';
import { Button, Icon } from './ui';

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

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="logo">✂</span>
        <span>JumpCut</span>
      </div>

      <div className="topbar-project">
        {renaming ? (
          <input
            autoFocus
            className="text-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (name.trim() && name !== project?.name) commit('Renamed project', (d) => (d.name = name.trim()));
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        ) : (
          <button type="button" className="project-name" onClick={() => setRenaming(true)} title="Rename">
            {project?.name ?? 'Loading…'}
          </button>
        )}
        <span className={`save-state${dirty ? ' is-dirty' : ''}`}>{saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'}</span>
      </div>

      <div className="topbar-actions">
        <Button variant="ghost" size="sm" onClick={undo} disabled={!past} title="Undo (⌘Z)">
          {Icon.undo}
        </Button>
        <Button variant="ghost" size="sm" onClick={redo} disabled={!future} title="Redo (⇧⌘Z)">
          {Icon.redo}
        </Button>
        <span className="toolbar-divider" />
        <select
          className="select select-compact"
          value={project?.id ?? ''}
          onChange={(e) => {
            if (e.target.value === '__new') void newProject('Untitled project');
            else void loadProject(e.target.value);
          }}
          title="Switch project"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new">+ New project…</option>
        </select>
        <Button variant="ghost" size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          Save
        </Button>
        <Button variant="primary" size="sm" onClick={onExport} disabled={!health?.ok}>
          {Icon.export} Export
        </Button>
      </div>
    </header>
  );
}
