import { useMemo } from 'react';
import { create } from 'zustand';
import { api } from '../lib/api';
import type { CaptionItem, Health, Job, Library, Media, Project, Track } from '../lib/types';
import type { PanelId } from '../components/Rail';
import { clipEnd, findClip, projectDuration, uid } from '../lib/model';

type Mutator = (draft: Project) => void;

interface EditorState {
  project: Project | null;
  health: Health | null;
  library: Library | null;
  fonts: { name: string; path: string }[];
  status: string;
  error: string | null;
  dirty: boolean;
  saving: boolean;

  past: Project[];
  future: Project[];
  pendingSnapshot: Project | null;

  playhead: number;
  playing: boolean;
  loop: boolean;
  selection: string[];
  activePanel: PanelId;
  panelOpen: boolean;
  zoom: number;               // pixels per second
  scroll: number;             // timeline scroll offset in pixels
  snapping: boolean;
  rippleMode: boolean;
  previewQuality: 'auto' | 'full';
  jobs: Job[];

  init: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  newProject: (name: string, settings?: Partial<Project['settings']>) => Promise<void>;
  save: () => Promise<void>;

  update: (mutator: Mutator) => void;
  commit: (label: string, mutator: Mutator) => void;
  beginInteraction: () => void;
  endInteraction: (label?: string) => void;
  undo: () => void;
  redo: () => void;

  setPlayhead: (t: number, options?: { scrub?: boolean }) => void;
  setPlaying: (playing: boolean) => void;
  toggleLoop: () => void;
  select: (ids: string[] | string | null, options?: { additive?: boolean }) => void;
  setPanel: (panel: PanelId) => void;
  setPanelOpen: (open: boolean) => void;
  setZoom: (zoom: number) => void;
  setScroll: (scroll: number) => void;
  toggleSnapping: () => void;
  toggleRipple: () => void;

  addMedia: (media: Media[]) => void;
  setStatus: (status: string) => void;
  setError: (error: string | null) => void;
  refreshJobs: () => Promise<void>;
  setCaptions: (items: CaptionItem[]) => void;
}

const HISTORY_LIMIT = 120;
const clone = (p: Project) => structuredClone(p);

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  health: null,
  library: null,
  fonts: [],
  status: 'Starting up…',
  error: null,
  dirty: false,
  saving: false,

  past: [],
  future: [],
  pendingSnapshot: null,

  playhead: 0,
  playing: false,
  loop: false,
  selection: [],
  activePanel: 'media',
  panelOpen: true,
  zoom: 80,
  scroll: 0,
  snapping: true,
  rippleMode: false,
  previewQuality: 'auto',
  jobs: [],

  async init() {
    try {
      const health = await api.health();
      set({ health });
      // The effects/content pickers are served by the API so the two sides
      // can never drift out of sync.
      void api
        .library()
        .then((library) => set({ library }))
        .catch(() => undefined);
      void api
        .fonts()
        .then((r) => set({ fonts: r.fonts }))
        .catch(() => undefined);
      if (!health.ok) {
        set({ error: 'ffmpeg was not found. Run `npm run doctor` in the project folder for install instructions.' });
      }
      const { projects } = await api.listProjects();
      if (projects.length) await get().loadProject(projects[0].id);
      else await get().newProject('My first video');
      set({ status: 'Ready' });
    } catch (err) {
      set({ error: `Could not reach the JumpCut server. Is it running? (${(err as Error).message})`, status: 'Offline' });
    }
  },

  async loadProject(id) {
    const { project } = await api.getProject(id);
    set({ project, past: [], future: [], selection: [], playhead: 0, dirty: false, status: `Opened “${project.name}”` });
  },

  async newProject(name, settings) {
    const { project } = await api.createProject(name, settings);
    set({ project, past: [], future: [], selection: [], playhead: 0, dirty: false, status: `Created “${project.name}”` });
  },

  async save() {
    const project = get().project;
    if (!project) return;
    set({ saving: true });
    try {
      const saved = await api.saveProject(project);
      set({ project: { ...project, updatedAt: saved.project.updatedAt }, dirty: false, saving: false, status: 'Saved' });
    } catch (err) {
      set({ saving: false, error: `Could not save: ${(err as Error).message}` });
    }
  },

  /** Mutate without touching history — use during drags. */
  update(mutator) {
    const project = get().project;
    if (!project) return;
    const draft = clone(project);
    mutator(draft);
    set({ project: draft, dirty: true });
    scheduleAutosave(get);
  },

  /** Mutate and push an undo entry. */
  commit(label, mutator) {
    const project = get().project;
    if (!project) return;
    const snapshot = clone(project);
    const draft = clone(project);
    mutator(draft);
    set({
      project: draft,
      past: [...get().past, snapshot].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      status: label,
    });
    scheduleAutosave(get);
  },

  beginInteraction() {
    const project = get().project;
    if (project) set({ pendingSnapshot: clone(project) });
  },

  endInteraction(label = 'Edit') {
    const snapshot = get().pendingSnapshot;
    if (!snapshot) return;
    set({
      past: [...get().past, snapshot].slice(-HISTORY_LIMIT),
      future: [],
      pendingSnapshot: null,
      status: label,
    });
    scheduleAutosave(get);
  },

  undo() {
    const { past, project } = get();
    if (!past.length || !project) return;
    const previous = past[past.length - 1];
    set({ project: previous, past: past.slice(0, -1), future: [clone(project), ...get().future].slice(0, HISTORY_LIMIT), dirty: true, status: 'Undo' });
    scheduleAutosave(get);
  },

  redo() {
    const { future, project } = get();
    if (!future.length || !project) return;
    const next = future[0];
    set({ project: next, future: future.slice(1), past: [...get().past, clone(project)].slice(-HISTORY_LIMIT), dirty: true, status: 'Redo' });
    scheduleAutosave(get);
  },

  setPlayhead(t) {
    const project = get().project;
    const max = project ? Math.max(0, projectDuration(project)) : 0;
    set({ playhead: Math.max(0, Math.min(t, max)) });
  },

  setPlaying(playing) {
    set({ playing });
  },

  toggleLoop() {
    set({ loop: !get().loop });
  },

  select(ids, options) {
    const next = ids === null ? [] : Array.isArray(ids) ? ids : [ids];
    if (options?.additive) {
      const current = new Set(get().selection);
      for (const id of next) (current.has(id) ? current.delete(id) : current.add(id));
      set({ selection: [...current] });
    } else {
      set({ selection: next });
    }
  },

  setPanel(activePanel) {
    set({ activePanel });
  },
  setPanelOpen(panelOpen) {
    set({ panelOpen });
  },
  setZoom(zoom) {
    set({ zoom: Math.max(6, Math.min(600, zoom)) });
  },
  setScroll(scroll) {
    set({ scroll: Math.max(0, scroll) });
  },
  toggleSnapping() {
    set({ snapping: !get().snapping });
  },
  toggleRipple() {
    set({ rippleMode: !get().rippleMode });
  },

  addMedia(media) {
    if (!media.length) return;
    get().commit(`Imported ${media.length} file${media.length > 1 ? 's' : ''}`, (draft) => {
      for (const m of media) {
        // Match on `key` so re-importing the same file reuses the existing entry.
        const existing = draft.media.find((x) => x.key === m.key);
        if (existing) Object.assign(existing, { ...m, id: existing.id });
        else draft.media.push(m);
      }
    });
  },

  setStatus(status) {
    set({ status });
  },
  setError(error) {
    set({ error });
  },

  async refreshJobs() {
    try {
      const { jobs } = await api.jobs();
      set({ jobs });
    } catch {
      /* server may be restarting */
    }
  },

  setCaptions(items) {
    get().commit('Updated captions', (draft) => {
      draft.captions.items = items;
      if (items.length) draft.captions.enabled = true;
    });
  },
}));

// Expose the store for scripting from the browser console — handy for batch
// edits ("shorten every clip by 200ms") that would be tedious by hand.
declare global {
  interface Window {
    jumpcut: typeof useEditor;
  }
}
if (typeof window !== 'undefined') window.jumpcut = useEditor;

function scheduleAutosave(get: () => EditorState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const state = get();
    if (state.dirty && !state.saving) void state.save();
  }, 1200);
}

// ---- selectors -------------------------------------------------------------

export const useProject = () => useEditor((s) => s.project);
export const useDuration = () => useEditor((s) => (s.project ? projectDuration(s.project) : 0));

/**
 * The single selected clip, or null.
 *
 * Computed with useMemo rather than inside the selector: `findClip` builds a
 * new `{track, clip}` object every call, and an unstable snapshot sends
 * useSyncExternalStore into an infinite render loop.
 */
export function useSelectedClip() {
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  return useMemo(() => {
    if (!project || selection.length !== 1) return null;
    return findClip(project, selection[0]);
  }, [project, selection]);
}

/** Add an empty track of the given kind above the others of that kind. */
export function addTrack(project: Project, kind: Track['kind']): Track {
  const count = project.tracks.filter((t) => t.kind === kind).length + 1;
  const track: Track = {
    id: uid('t_'),
    kind,
    name: kind === 'video' ? `V${count}` : `A${count}`,
    role: kind === 'video' ? 'overlay' : 'sfx',
    clips: [],
    volume: 1,
  };
  const firstOfKind = project.tracks.findIndex((t) => t.kind === kind);
  project.tracks.splice(Math.max(0, firstOfKind), 0, track);
  return track;
}

/** Where a new clip should land on a track: after everything already there. */
export function appendPosition(track: Track): number {
  return track.clips.reduce((end, clip) => Math.max(end, clipEnd(clip)), 0);
}
