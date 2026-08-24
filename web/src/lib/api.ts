import type { CaptionItem, ExportPreset, Health, Job, Library, Media, Project } from './types';

// In dev, Vite proxies /api to the server; in production the server serves us.
const BASE = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init?.headers : { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') || '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  health: () => request<Health>('/api/health'),
  presets: () => request<{ presets: ExportPreset[] }>('/api/presets'),
  library: () => request<Library>('/api/library'),
  fonts: () => request<{ fonts: { name: string; path: string }[]; default: string | null }>('/api/fonts'),

  browse: (dir?: string) =>
    request<{ dir: string; parent: string | null; home: string; items: { name: string; path: string; isDir: boolean; kind: string | null }[] }>(
      `/api/browse${dir ? `?dir=${encodeURIComponent(dir)}` : ''}`
    ),
  reveal: (path: string) => request<{ ok: boolean }>('/api/reveal', { method: 'POST', body: JSON.stringify({ path }) }),

  importPaths: (paths: string[]) =>
    request<{ media: Media[]; errors: { path: string; error: string }[] }>('/api/media/import', {
      method: 'POST',
      body: JSON.stringify({ paths }),
    }),
  upload: (files: File[], onProgress?: (fraction: number) => void) =>
    new Promise<{ media: Media[]; errors: { path: string; error: string }[] }>((resolve, reject) => {
      const form = new FormData();
      for (const f of files) form.append('files', f);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE}/api/media/upload`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          xhr.status >= 200 && xhr.status < 300 ? resolve(body) : reject(new Error(body.error || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed — is the server running?'));
      xhr.send(form);
    }),
  relink: (key: string, path: string) => request<{ media: Media }>(`/api/media/${key}/relink`, { method: 'POST', body: JSON.stringify({ path }) }),

  waveform: (key: string, buckets = 2000) => request<{ peaks: number[]; duration: number; buckets: number }>(`/api/media/${key}/waveform?buckets=${buckets}`),
  filmstripMeta: (key: string, height = 72) =>
    request<{ count: number; interval: number; tileWidth: number; tileHeight: number }>(`/api/media/${key}/filmstrip?height=${height}&meta=1`),
  silence: (key: string, options: { threshold?: number; minSilence?: number; padding?: number }) =>
    request<{ silences: { start: number; end: number }[]; segments: { start: number; end: number }[]; removed: number }>(
      `/api/media/${key}/silence`,
      { method: 'POST', body: JSON.stringify(options) }
    ),
  makeProxy: (key: string, height = 720) =>
    request<{ path: string | null; cached: boolean }>(`/api/media/${key}/proxy`, { method: 'POST', body: JSON.stringify({ height }) }),
  getProxy: (key: string, height = 720) => request<{ path: string | null; recommended: boolean }>(`/api/media/${key}/proxy?height=${height}`),
  loudness: (key: string) => request<{ loudness: { integrated: number; truePeak: number; range: number } | null }>(`/api/media/${key}/loudness`),

  listProjects: () => request<{ projects: { id: string; name: string; updatedAt: number; duration: number; clipCount: number }[] }>('/api/projects'),
  createProject: (name: string, settings?: Partial<Project['settings']>) =>
    request<{ project: Project }>('/api/projects', { method: 'POST', body: JSON.stringify({ name, settings }) }),
  getProject: (id: string) => request<{ project: Project }>(`/api/projects/${id}`),
  saveProject: (project: Project) => request<{ project: Project }>(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify({ project }) }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' }),

  parseCaptions: (text: string, filename?: string) =>
    request<{ items: CaptionItem[] }>('/api/captions/parse', { method: 'POST', body: JSON.stringify({ text, filename }) }),
  formatCaptions: (items: CaptionItem[], mode: 'rewrap' | 'words', options: Record<string, number> = {}) =>
    request<{ items: CaptionItem[] }>('/api/captions/format', { method: 'POST', body: JSON.stringify({ items, mode, ...options }) }),
  exportCaptions: (items: CaptionItem[], name: string, format: 'srt' | 'vtt') =>
    request<{ path: string; filename: string; text: string }>('/api/captions/export', { method: 'POST', body: JSON.stringify({ items, name, format }) }),
  transcribe: (mediaKey: string, language = 'auto') =>
    request<{ items: CaptionItem[] }>('/api/captions/transcribe', { method: 'POST', body: JSON.stringify({ mediaKey, language }) }),

  exportVideo: (project: Project, options: Record<string, unknown>) =>
    request<{ job: Job }>('/api/export', { method: 'POST', body: JSON.stringify({ project, options }) }),
  jobs: () => request<{ jobs: Job[] }>('/api/jobs'),
  cancelJob: (id: string) => request<{ cancelled: boolean }>(`/api/jobs/${id}`, { method: 'DELETE' }),
  still: (project: Project, time: number, filename?: string) =>
    request<{ path: string; filename: string; size: number }>('/api/still', { method: 'POST', body: JSON.stringify({ project, time, filename }) }),

  fileUrl: (path: string) => `${BASE}/api/file?path=${encodeURIComponent(path)}`,
  posterUrl: (key: string) => `${BASE}/api/media/${key}/poster`,
  filmstripUrl: (key: string, height = 72) => `${BASE}/api/media/${key}/filmstrip?height=${height}`,
  jobEvents: (id: string) => new EventSource(`${BASE}/api/jobs/${id}/events`),
};
