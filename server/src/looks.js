// Filter presets ("looks"), transitions and shape geometry.
//
// Each look carries both an ffmpeg chain and a CSS approximation so the canvas
// preview and the export agree without the two lists drifting apart.

export const FILTER_PRESETS = [
  { id: 'none', label: 'Original', ff: [], css: '' },
  { id: 'vivid', label: 'Vivid', ff: ['eq=saturation=1.35:contrast=1.12'], css: 'saturate(1.35) contrast(1.12)' },
  { id: 'punch', label: 'Punch', ff: ['eq=contrast=1.28:saturation=1.22', 'unsharp=5:5:0.6:5:5:0'], css: 'contrast(1.28) saturate(1.22)' },
  { id: 'warm', label: 'Warm', ff: ['colortemperature=temperature=8200:mix=0.85', 'eq=saturation=1.06'], css: 'sepia(0.18) saturate(1.14) hue-rotate(-8deg)' },
  { id: 'cool', label: 'Cool', ff: ['colortemperature=temperature=4600:mix=0.85'], css: 'hue-rotate(9deg) saturate(0.98) brightness(1.02)' },
  { id: 'fade', label: 'Faded', ff: ["curves=all='0/0.09 0.5/0.52 1/0.94'", 'eq=saturation=0.82'], css: 'contrast(0.84) saturate(0.82) brightness(1.07)' },
  { id: 'vintage', label: 'Vintage', ff: ['colorbalance=rs=0.08:gs=-0.02:bs=-0.08:rm=0.05:bm=-0.05', "curves=all='0/0.07 1/0.93'", 'eq=saturation=0.78'], css: 'sepia(0.36) saturate(0.86) contrast(1.04)' },
  { id: 'sepia', label: 'Sepia', ff: ['colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131'], css: 'sepia(0.85)' },
  { id: 'mono', label: 'Mono', ff: ['hue=s=0', 'eq=contrast=1.1'], css: 'grayscale(1) contrast(1.1)' },
  { id: 'noir', label: 'Noir', ff: ['hue=s=0', 'eq=contrast=1.4:brightness=-0.04'], css: 'grayscale(1) contrast(1.4) brightness(0.96)' },
  { id: 'cinematic', label: 'Cinematic', ff: ['colorbalance=rs=-0.06:bs=0.09:gm=-0.03:rh=0.09:bh=-0.07', 'eq=contrast=1.12:saturation=1.04'], css: 'contrast(1.12) saturate(1.04) hue-rotate(-5deg)' },
  { id: 'dreamy', label: 'Dreamy', ff: ['gblur=sigma=1.4', 'eq=brightness=0.05:saturation=0.92'], css: 'blur(1.1px) brightness(1.05) saturate(0.92)' },
];

export function findFilter(id) {
  return FILTER_PRESETS.find((f) => f.id === id) || FILTER_PRESETS[0];
}

/** xfade transitions, grouped the way the picker presents them. */
export const TRANSITIONS = [
  { id: 'fade', label: 'Fade', xfade: 'fade', group: 'Basic' },
  { id: 'dissolve', label: 'Dissolve', xfade: 'dissolve', group: 'Basic' },
  { id: 'fadeblack', label: 'Fade to black', xfade: 'fadeblack', group: 'Basic' },
  { id: 'fadewhite', label: 'Fade to white', xfade: 'fadewhite', group: 'Basic' },
  { id: 'wipeleft', label: 'Wipe left', xfade: 'wipeleft', group: 'Wipe' },
  { id: 'wiperight', label: 'Wipe right', xfade: 'wiperight', group: 'Wipe' },
  { id: 'wipeup', label: 'Wipe up', xfade: 'wipeup', group: 'Wipe' },
  { id: 'wipedown', label: 'Wipe down', xfade: 'wipedown', group: 'Wipe' },
  { id: 'slideleft', label: 'Slide left', xfade: 'slideleft', group: 'Slide' },
  { id: 'slideright', label: 'Slide right', xfade: 'slideright', group: 'Slide' },
  { id: 'slideup', label: 'Slide up', xfade: 'slideup', group: 'Slide' },
  { id: 'slidedown', label: 'Slide down', xfade: 'slidedown', group: 'Slide' },
  { id: 'circleopen', label: 'Circle open', xfade: 'circleopen', group: 'Shape' },
  { id: 'circleclose', label: 'Circle close', xfade: 'circleclose', group: 'Shape' },
  { id: 'circlecrop', label: 'Circle crop', xfade: 'circlecrop', group: 'Shape' },
  { id: 'rectcrop', label: 'Rectangle', xfade: 'rectcrop', group: 'Shape' },
  { id: 'vertopen', label: 'Split vertical', xfade: 'vertopen', group: 'Shape' },
  { id: 'horzopen', label: 'Split horizontal', xfade: 'horzopen', group: 'Shape' },
  { id: 'pixelize', label: 'Pixelise', xfade: 'pixelize', group: 'Stylised' },
  { id: 'hblur', label: 'Blur', xfade: 'hblur', group: 'Stylised' },
  { id: 'radial', label: 'Radial', xfade: 'radial', group: 'Stylised' },
  { id: 'diagtl', label: 'Diagonal', xfade: 'diagtl', group: 'Stylised' },
  { id: 'fadegrays', label: 'Fade greys', xfade: 'fadegrays', group: 'Stylised' },
  { id: 'distance', label: 'Distance', xfade: 'distance', group: 'Stylised' },
];

export function findTransition(id) {
  return TRANSITIONS.find((t) => t.id === id) || null;
}

/** Text entrance animations, expressed as ASS override tags. */
export const TEXT_ANIMATIONS = [
  { id: 'none', label: 'None' },
  { id: 'fade', label: 'Fade' },
  { id: 'slideup', label: 'Slide up' },
  { id: 'slidedown', label: 'Slide down' },
  { id: 'pop', label: 'Pop' },
  { id: 'typewriter', label: 'Typewriter' },
];

const K = 0.5523; // circle-to-bezier constant

/**
 * ASS vector drawing for a shape, in a `w`×`h` box with its origin at 0,0.
 * Used with `{\p1}` so shapes render in the same libass pass as the titles.
 */
export function shapePath(kind, w, h, radius = 0) {
  const W = Math.round(w);
  const H = Math.round(h);
  switch (kind) {
    case 'ellipse': {
      const rx = W / 2;
      const ry = H / 2;
      const kx = Math.round(rx * K);
      const ky = Math.round(ry * K);
      return [
        `m 0 ${Math.round(ry)}`,
        `b 0 ${Math.round(ry - ky)} ${Math.round(rx - kx)} 0 ${Math.round(rx)} 0`,
        `b ${Math.round(rx + kx)} 0 ${W} ${Math.round(ry - ky)} ${W} ${Math.round(ry)}`,
        `b ${W} ${Math.round(ry + ky)} ${Math.round(rx + kx)} ${H} ${Math.round(rx)} ${H}`,
        `b ${Math.round(rx - kx)} ${H} 0 ${Math.round(ry + ky)} 0 ${Math.round(ry)}`,
      ].join(' ');
    }
    case 'triangle':
      return `m ${Math.round(W / 2)} 0 l ${W} ${H} l 0 ${H}`;
    case 'arrow': {
      const shaft = Math.round(H * 0.34);
      const headW = Math.round(W * 0.36);
      const top = Math.round((H - shaft) / 2);
      return [
        `m 0 ${top}`,
        `l ${W - headW} ${top}`,
        `l ${W - headW} 0`,
        `l ${W} ${Math.round(H / 2)}`,
        `l ${W - headW} ${H}`,
        `l ${W - headW} ${top + shaft}`,
        `l 0 ${top + shaft}`,
      ].join(' ');
    }
    case 'star': {
      const cx = W / 2;
      const cy = H / 2;
      const outer = Math.min(W, H) / 2;
      const inner = outer * 0.42;
      const points = [];
      for (let i = 0; i < 10; i += 1) {
        const r = i % 2 === 0 ? outer : inner;
        const angle = (Math.PI / 5) * i - Math.PI / 2;
        points.push(`${Math.round(cx + r * Math.cos(angle))} ${Math.round(cy + r * Math.sin(angle))}`);
      }
      return `m ${points[0]} ${points.slice(1).map((p) => `l ${p}`).join(' ')}`;
    }
    case 'roundrect': {
      const r = Math.max(0, Math.min(radius, Math.min(W, H) / 2));
      if (r < 1) return shapePath('rect', W, H);
      const k = Math.round(r * (1 - K));
      return [
        `m ${r} 0`,
        `l ${W - r} 0`,
        `b ${W - k} 0 ${W} ${k} ${W} ${r}`,
        `l ${W} ${H - r}`,
        `b ${W} ${H - k} ${W - k} ${H} ${W - r} ${H}`,
        `l ${r} ${H}`,
        `b ${k} ${H} 0 ${H - k} 0 ${H - r}`,
        `l 0 ${r}`,
        `b 0 ${k} ${k} 0 ${r} 0`,
      ].join(' ');
    }
    case 'rect':
    default:
      return `m 0 0 l ${W} 0 l ${W} ${H} l 0 ${H}`;
  }
}

export const SHAPES = [
  { id: 'rect', label: 'Rectangle' },
  { id: 'roundrect', label: 'Rounded' },
  { id: 'ellipse', label: 'Circle' },
  { id: 'triangle', label: 'Triangle' },
  { id: 'arrow', label: 'Arrow' },
  { id: 'star', label: 'Star' },
];

/** Ready-made backgrounds available from the content library. */
export const BACKGROUNDS = [
  { id: 'black', label: 'Black', color: '#000000' },
  { id: 'white', label: 'White', color: '#ffffff' },
  { id: 'slate', label: 'Slate', color: '#1e2430' },
  { id: 'violet', label: 'Violet', color: '#6b4dff' },
  { id: 'coral', label: 'Coral', color: '#ff5a5f' },
  { id: 'mint', label: 'Mint', color: '#22c9a0' },
  { id: 'sun', label: 'Sun', color: '#ffb020' },
  { id: 'ink', label: 'Ink', color: '#0b1020' },
];
