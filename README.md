# JumpCut

A Clipchamp-style video editor for making YouTube content. It runs on your own
machine — the editor is a web UI, the rendering is real `ffmpeg`. Your footage
never leaves your computer, there's no account, no subscription, no upload
limits, and no watermark.

```bash
npm install
npm start        # then open http://localhost:5174
```

That's it. If `ffmpeg` isn't already on your system, `npm install` pulls down a
bundled build automatically.

---

## What it does

The layout will look familiar if you've used Clipchamp: a tool rail down the
left, your video in the middle with drag-to-move handles on it, properties on
the right, timeline along the bottom.

**The left rail**

| | |
| --- | --- |
| **Your media** | Import by drag-and-drop, or link files already on disk without copying them |
| **Record & create** | Record your camera, your screen, or a voiceover straight into the project |
| **Content library** | Solid backgrounds and vector shapes — rectangles, circles, arrows, stars |
| **Templates** | Five layouts that arrange titles and shapes around *your* footage |
| **Transitions** | 24 transitions — fades, wipes, slides, circles, pixelise, blur |
| **Text** | Eight title styles with entrance animations |
| **Captions** | Import `.srt`, re-wrap, restyle, burn in or export |
| **Brand kit** | Your colours, font and logo, applied to new titles and shapes |

**Editing**

- Multi-track timeline — drag clips around, trim their edges, drag them between
  tracks, split at the playhead, ripple-delete to close the gap
- **Drag, resize and rotate right on the video** — corner handles to scale, a
  stem above to rotate (hold Shift to snap to 15°)
- Live preview that composites on a canvas using the same layout maths as the
  export, so what you see is what you render
- Filmstrip thumbnails and audio waveforms drawn on the clips
- Canvas shape switcher — 16:9, 9:16, 1:1, 4:5, 21:9 — from the top bar
- Unlimited undo/redo, autosave, multiple projects

**Effects**

- **Transitions** between touching clips. Dropping one overlaps the two clips
  and pulls the rest of the timeline back, exactly as you'd expect; the audio
  cross-fades with the picture.
- **12 filter presets** — Vivid, Punch, Warm, Cool, Faded, Vintage, Sepia,
  Mono, Noir, Cinematic, Dreamy
- **Adjust colours** — exposure, contrast, saturation, temperature, hue,
  vignette, film fade, blur, sharpen
- **Green screen** — chroma key with tolerance, edge softness and spill removal
- Per-clip transform, crop, speed (0.1×–8×) and fades

**The YouTube-specific parts**

- **Remove silences** — one click turns a rambling take into tight jump cuts.
  Finds every pause, drops it, closes the gaps, keeps a little breathing room
  either side so words aren't clipped.
- **Music ducking** — the music bed automatically drops under your voice
- **Loudness normalisation** aimed at YouTube's −14 LUFS target
- **Grab frame** saves the current frame as a full-resolution PNG for thumbnails
- **Export presets** for 4K / 1440p / 1080p / 1080p60 / 720p, plus vertical
  Shorts, square, GIF, and audio-only. Exporting a 16:9 edit as a 9:16 Short
  offers crop-to-fill, letterbox, or blurred-edges reframing.

**Under the hood**

- Hardware encoding when your machine has it (VideoToolbox, NVENC, QSV, VAAPI, AMF)
- Preview proxies built automatically for footage the browser can't decode —
  iPhone HEVC, ProRes, 4K. Exports always use the original file.
- Media is linked by path by default, so importing a 40 GB folder is instant

---

## Getting started

### 1. Install

```bash
git clone <this repo>
cd video-edit
npm install
```

`npm install` reports which `ffmpeg` it found. To check later:

```bash
npm run doctor
```

Using your own `ffmpeg` build is usually faster (hardware encoders, more codecs):

- macOS — `brew install ffmpeg`
- Debian/Ubuntu — `sudo apt install ffmpeg`
- Windows — `winget install Gyan.FFmpeg`

JumpCut prefers a system `ffmpeg` over the bundled one. Override with
`FFMPEG_PATH=/path/to/ffmpeg`.

### 2. Run

```bash
npm start          # build the editor and serve it at http://localhost:5174
```

For development with hot reload:

```bash
npm run dev        # server on :5174, editor on :5173
```

### 3. Verify the engine works on your machine

```bash
npm test
```

This generates test footage, renders real projects through the full pipeline,
and checks the output — 22 checks covering probing, waveforms, silence
detection, compositing, transitions, filters, green screen, vertical reframing
and still export.

---

## A first edit

1. **Import** — drag files onto Your media, or hit **Browse** to link footage
   already on disk without copying it. **Record & create** captures your camera
   or screen if you'd rather film something now.
2. **Build the timeline** — drag a clip onto V1. Drop b-roll onto V2 and it
   layers on top; drag it around directly on the video, or hit
   **Picture-in-picture** in the properties panel to tuck it into a corner.
3. **Join the cuts** — click the **+** badge that appears between two touching
   clips, then pick a transition. Right-click the badge to remove it.
4. **Cut the fat** — select your talking-head clip, open the **Audio** tab and
   use **Remove silences**. Start at −32 dB with a 0.45 s minimum pause.
5. **Add a title** — open **Text**, click a style. Change the animation, colour
   and position in the properties panel, or drag it on the video.
6. **Grade it** — the **Filters** tab has twelve looks; **Adjust** has the
   manual sliders underneath.
7. **Add music** — drop a track onto A2 Music. Ducking is on by default, so it
   pulls back automatically whenever you speak.
8. **Captions** — the Captions tab imports `.srt` files, re-wraps them and
   styles them. Turn on "Burn captions into the video" for Shorts.
9. **Export** — <kbd>⌘E</kbd>, pick a preset, go. Files land in
   `~/JumpCut/exports`.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>Space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Step one frame (hold <kbd>Shift</kbd> for a second) |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to start / end |
| <kbd>S</kbd> | Split at the playhead |
| <kbd>T</kbd> | Add a title |
| <kbd>Delete</kbd> | Delete selected clips (<kbd>Shift</kbd> to ripple) |
| <kbd>L</kbd> | Toggle loop |
| <kbd>N</kbd> | Toggle snapping (hold <kbd>Alt</kbd> while dragging to bypass) |
| <kbd>+</kbd> / <kbd>−</kbd> | Zoom the timeline |
| <kbd>⌘/Ctrl</kbd> + scroll | Zoom around the pointer |
| <kbd>⌘/Ctrl</kbd> <kbd>Z</kbd> | Undo (<kbd>Shift</kbd> to redo) |
| <kbd>⌘/Ctrl</kbd> <kbd>D</kbd> | Duplicate selection |
| <kbd>⌘/Ctrl</kbd> <kbd>S</kbd> | Save |
| <kbd>⌘/Ctrl</kbd> <kbd>E</kbd> | Export |
| <kbd>Esc</kbd> | Deselect |

---

## Where your files live

Everything sits in `~/JumpCut` (override with `JUMPCUT_HOME`):

```
~/JumpCut/
  projects/   project files (plain JSON, with a .bak of the previous save)
  media/      files you uploaded through the browser
  exports/    finished videos, stills and .srt files
  cache/      thumbnails, waveforms and preview proxies (safe to delete)
  fonts/      drop .ttf/.otf files here to use them in titles and captions
```

Projects are readable JSON — diff them, script them, check them into git.

---

## Configuration

| Variable | What it does |
| --- | --- |
| `JUMPCUT_HOME` | Where projects, media and exports live (default `~/JumpCut`) |
| `PORT` | Server port (default `5174`) |
| `HOST` | Bind address (default `127.0.0.1`) |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Use a specific ffmpeg build |
| `JUMPCUT_FONT` | Default font file for titles and captions |
| `WHISPER_PATH` / `WHISPER_MODEL` | Enable local auto-transcription |

### Auto-transcription (optional)

Caption generation runs locally through Whisper if you have it:

```bash
brew install whisper-cpp                       # or build whisper.cpp yourself
mkdir -p ~/JumpCut/models
# download a model, e.g. ggml-base.en.bin, into ~/JumpCut/models
```

JumpCut finds it automatically and the **Auto-transcribe** button lights up.
Without it, import an `.srt` — YouTube Studio will also generate one for you
after upload.

---

## Notes and limits

- **Titles and captions need a text renderer in ffmpeg.** Almost every build has
  libass; JumpCut uses it for both. If yours has neither libass nor `drawtext`,
  the export still works but text won't burn in — the editor tells you and you
  can export an `.srt` instead. `npm test` reports which renderer you have.
- **Titles, shapes and captions always render above the footage**, regardless
  of which track they sit on. Among themselves the order is shapes, then
  titles, then captions. In practice that's what you want; it's a deliberate
  simplification.
- **Transitions need two touching clips on the same track.** They overlap the
  clips, so the timeline gets shorter by the transition's length.
- **Green screen previews at reduced resolution** — keying is a per-pixel job,
  so the canvas does it on a small scratch buffer. The export keys at full
  resolution in ffmpeg.
- **Loudness normalisation is single-pass**, so it lands within a couple of LU
  of the target rather than exactly on it. YouTube normalises on their side
  anyway, so this only matters if you're mastering for somewhere else.
- **Ducking isn't previewed** — the preview plays raw track levels. It's applied
  on export.
- **The preview is a canvas composite, not a decode of the final file.** Colour
  handling in the browser can differ slightly from ffmpeg's, and transitions
  are approximated with clipping and alpha rather than ffmpeg's exact `xfade`
  maths. Framing, timing, scale and type size all match.
- **Recording needs a secure context.** `localhost` counts as one, so it works
  out of the box; if you serve JumpCut from another machine, use HTTPS or the
  browser will refuse camera and screen access.

---

## Scripting the editor

The editor store is exposed on `window.jumpcut`, which makes tedious bulk edits
easy from the browser console:

```js
// Trim 200ms off the head of every clip on V1
jumpcut.getState().commit('Tighten V1', (project) => {
  const v1 = project.tracks.find((t) => t.name === 'V1');
  for (const clip of v1.clips) {
    clip.inPoint += 0.2;
    clip.duration -= 0.2;
  }
});
```

The HTTP API is equally scriptable — `POST /api/export` takes a project as JSON,
so you can render from a script or a cron job. See `server/src/index.js` for the
full surface.

---

## How it's put together

```
server/src/
  ffmpeg.js     finds ffmpeg/ffprobe, detects capabilities, runs jobs
  compile.js    the core: turns a project into one ffmpeg filter graph
  presets.js    export targets and encoder selection
  media.js      probing, thumbnails, waveforms, silence detection, proxies
  captions.js   .srt/.vtt parsing, re-wrapping, local speech-to-text
  looks.js      filter presets, transitions, shape geometry
  render.js     export jobs with progress, cancellation and readable errors
  projects.js   project files on disk
  index.js      HTTP API

web/src/
  engine/preview.ts   canvas compositor — the browser twin of compile.js
  components/         rail, timeline, preview, canvas handles, properties
  components/panels/  media, record, content, templates, transitions, text,
                      captions, brand kit
  state/store.ts      editor state, undo/redo, autosave
```

`server/src/looks.js` holds the filter presets, transition list and shape
geometry, and the editor fetches them from `/api/library` — so the preview and
the export can never drift apart on what "Cinematic" means.

The interesting part is `compile.js`. Every clip becomes its own ffmpeg input
with `-ss`/`-t` applied *before* `-i`, so ffmpeg seeks instead of decoding whole
files. The graph then only has to position, transform and mix streams that are
already trimmed — which is why exports are fast even with a lot of cuts.

Clips joined by transitions are grouped into chains, composited onto
transparent full-size frames and joined with `xfade` (which insists both inputs
share a size and a constant frame rate); everything else is overlaid directly.
Titles, shapes and captions are compiled into a single ASS subtitle file and
burned in with one libass pass, so a hundred captions cost one filter rather
than a hundred.

## Licence

MIT.
