export type MediaKind = 'video' | 'audio' | 'image';

export interface Media {
  id: string;
  key: string;
  name: string;
  path: string;
  kind: MediaKind;
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  channels: number;
  sampleRate: number;
  bitrate: number;
  size: number;
}

export type ClipType = 'video' | 'audio' | 'image' | 'text' | 'solid' | 'shape';

export interface Transform {
  fit: 'contain' | 'cover' | 'stretch';
  scale: number;
  x: number;          // offset as a fraction of canvas width, 0 = centred
  y: number;
  rotation: number;   // degrees, clockwise
  opacity: number;
}

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ChromaKey {
  enabled: boolean;
  color: string;
  similarity: number;
  blend: number;
  despill?: boolean;
}

export interface ShapeStyle {
  kind: 'rect' | 'roundrect' | 'ellipse' | 'triangle' | 'arrow' | 'star';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  radius?: number;
  filled?: boolean;
}

export interface Transition {
  type: string;
  duration: number;
}

export interface Effects {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  gamma?: number;
  hue?: number;
  blur?: number;
  sharpen?: number;
  grayscale?: boolean;
  invert?: boolean;
  temperature?: number;
  vignette?: number;
  filmFade?: number;
}

export interface TextStyle {
  content: string;
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  x: number;          // 0..1 across the canvas
  y: number;          // 0..1 down the canvas
  bold?: boolean;
  italic?: boolean;
  uppercase?: boolean;
  strokeWidth?: number;
  strokeColor?: string;
  shadow?: boolean;
  shadowColor?: string;
  background?: string | 'none';
  backgroundOpacity?: number;
  padding?: number;
  letterSpacing?: number;
  lineHeight?: number;
  maxWidth?: number;
  fontName?: string | null;
  fontFile?: string | null;
  animation?: 'none' | 'fade' | 'slideup' | 'slidedown' | 'pop' | 'typewriter';
  animationDuration?: number;
}

export interface Clip {
  id: string;
  type: ClipType;
  mediaId?: string;
  name?: string;
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  volume: number;
  muted?: boolean;
  fadeIn: number;
  fadeOut: number;
  audioFadeIn?: number;
  audioFadeOut?: number;
  denoise?: boolean;
  highpass?: boolean;
  color?: string;
  transform: Transform;
  crop?: Crop;
  effects: Effects;
  text?: TextStyle;
  shape?: ShapeStyle;
  filter?: string;
  chromaKey?: ChromaKey;
  transitionIn?: Transition | null;
}

export type TrackKind = 'video' | 'audio';
export type TrackRole = 'main' | 'overlay' | 'voice' | 'music' | 'sfx';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  role: TrackRole;
  clips: Clip[];
  hidden?: boolean;
  muted?: boolean;
  locked?: boolean;
  volume: number;
  height?: number;
}

export interface CaptionItem {
  start: number;
  end: number;
  text: string;
}

export interface CaptionStyle {
  fontName: string | null;
  size: number;
  color: string;
  outlineColor: string;
  outline: number;
  shadow: number;
  boxed: boolean;
  boxColor: string;
  position: 'top' | 'middle' | 'bottom' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  marginV: number;
  marginH?: number;
  bold: boolean;
  italic?: boolean;
  letterSpacing?: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  background: string;
  font?: string | null;
}

export interface Project {
  id: string;
  schemaVersion: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  media: Media[];
  tracks: Track[];
  captions: { enabled: boolean; items: CaptionItem[]; style: CaptionStyle };
  audio: {
    masterVolume: number;
    normalize: boolean;
    loudnessTarget: number;
    ducking: { enabled: boolean; amount: number; attack: number; release: number };
  };
  brandKit: {
    colors: string[];
    font: string | null;
    logoPath: string | null;
  };
  watermark: {
    enabled: boolean;
    path: string | null;
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    size: number;
    margin: number;
    opacity: number;
  };
}

export interface ExportPreset {
  id: string;
  label: string;
  width?: number;
  height?: number;
  fps?: number;
  videoBitrate?: string;
  crf?: number;
  speed?: string;
  group: string;
  audioOnly?: boolean;
  gif?: boolean;
  default?: boolean;
}

export interface Job {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  projectName: string;
  preset: string;
  presetLabel: string;
  outPath: string;
  filename: string;
  duration: number;
  progress: number;
  speed: number | null;
  eta: number | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  size?: number;
  log?: string;
}

export interface Health {
  ok: boolean;
  ffmpeg: { path: string | null; source: string };
  ffprobe: { path: string | null; source: string };
  hardwareEncoders: string[];
  font: string | null;
  speechToText: boolean;
  dirs: Record<string, string>;
  platform: string;
  cpus: number;
}

export interface LibraryItem {
  id: string;
  label: string;
}

export interface Library {
  filters: { id: string; label: string; css: string }[];
  transitions: { id: string; label: string; group: string }[];
  textAnimations: LibraryItem[];
  shapes: LibraryItem[];
  backgrounds: { id: string; label: string; color: string }[];
}
