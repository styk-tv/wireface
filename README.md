# wireface

[![npm](https://img.shields.io/npm/v/wireface.svg?logo=npm&color=cb3837&label=npm)](https://www.npmjs.com/package/wireface)
[![downloads](https://img.shields.io/npm/dm/wireface.svg?color=blue)](https://www.npmjs.com/package/wireface)
[![bundle](https://img.shields.io/bundlephobia/minzip/wireface?label=min%2Bgzip)](https://bundlephobia.com/package/wireface)
[![jsDelivr](https://img.shields.io/jsdelivr/npm/hm/wireface.svg?label=jsDelivr)](https://www.jsdelivr.com/package/npm/wireface)
[![license](https://img.shields.io/npm/l/wireface.svg?color=blue)](LICENSE)
[![stars](https://img.shields.io/github/stars/styk-tv/wireface?style=flat&logo=github)](https://github.com/styk-tv/wireface)
[![babylon](https://img.shields.io/badge/babylon.js-v9-bb464b)](https://www.babylonjs.com/)

**A drop-in lipsync renderer for stylized character profiles — no rigged avatar, no ML inference, no server roundtrip.** wireface analyses voice or TTS audio in the browser and drives a wireframe face mesh through 28 expression channels (15 visemes + jaw, lips, blinks, eye gaze, squint, brows, nose, head rotation). Each character is one JSON preset — mesh resolution, colors, depth fade, glow, mood weights, channel gains — saved from the bundled editor and replayed by a single JS file. One canvas, one peer dependency (Babylon.js v9), one `createWireface(canvas)` call. Each instance is fully independent, so a page can host as many talking heads as it has audio sources.

![wireface](docs/wireface.png)

- repo: <https://github.com/styk-tv/wireface>
- npm: <https://www.npmjs.com/package/wireface>
- one source file: [`wireface.js`](wireface.js)
- two runnable examples: [`examples/demo.html`](examples/demo.html) (consumer), [`examples/editor.html`](examples/editor.html) (preset authoring)
- two preset samples: [`examples/presets/`](examples/presets/)
- preset format: plain JSON (drop a `.json` saved by the editor onto a panel)
- audio: any browser-decodable file (`mp3`, `wav`, `ogg`, `m4a`, `flac`, `aac`, `opus`)

---

## Install

### npm

```bash
npm install wireface
```

### CDN (no build step)

Two flavors are published — pick by file extension:

| Flavor | jsDelivr | unpkg |
|---|---|---|
| **indented** (readable, debuggable) | `https://cdn.jsdelivr.net/npm/wireface@1/wireface.js` | `https://unpkg.com/wireface@1/wireface.js` |
| **minified** (smaller, production) | `https://cdn.jsdelivr.net/npm/wireface@1/dist/wireface.min.js` | `https://unpkg.com/wireface@1/dist/wireface.min.js` |

Pin to a major (`@1`), a minor (`@1.0`), or an exact version (`@1.0.0`) — `latest` works too but isn't recommended for production.

`wireface` has one **peer dependency**: [Babylon.js](https://www.babylonjs.com/) (`babylonjs >= 6.0.0`). Load it from CDN or bundle it yourself before `wireface.js` runs.

---

## Quick start

```html
<!-- Babylon.js v9 as a global, loaded BEFORE wireface.js -->
<script src="https://cdn.jsdelivr.net/npm/babylonjs@9/babylon.js"></script>
<!-- pick one — minified for production, indented for debugging -->
<script src="https://cdn.jsdelivr.net/npm/wireface@1/dist/wireface.min.js"></script>

<canvas id="face" style="width:480px;height:480px"></canvas>

<script>
  const wf = createWireface(document.getElementById('face'));

  // Optional: load a saved preset (see "Preset JSON" below)
  fetch('preset.json').then(r => r.json()).then(p => wf.loadPreset(p));

  // Pull an audio file (or use a File from a drop / file input)
  fetch('voice.mp3').then(r => r.blob()).then(blob => wf.loadAudio(blob));

  // Drive it
  wf.setMood('happy');
  wf.setLoop(true);
  wf.play();
</script>
```

That's the entire surface. Everything else is presets, channels, and moods.

---

## Public API

```ts
createWireface(canvas: HTMLCanvasElement, options?: object) → WireFace

interface WireFace {
  // audio + preset
  loadAudio(file_or_blob): Promise<void>
  loadPreset(presetObject): void           // the JSON saved by the editor
  setRenderConfig(partial): void           // apply one-or-more renderConfig fields live
  getRenderConfig(): object                // snapshot of current renderConfig

  // transport
  play(fromOffset?: number): void
  pause(): void
  stop(): void
  setLoop(bool): void
  isPlaying(): boolean
  getDuration(): number                    // seconds (0 if no audio loaded)
  getPosition(): number                    // seconds since playback start

  // expression
  setMood(name): void                      // 'neutral'|'happy'|'sad'|'angry'|'fear'|'surprise'|'sleep'
  getActiveMood(): string
  setChannel(name, value): void            // manual override (auto-releases after ~1.2s)
  setChannelGain(name, gain): void
  getChannel(name): number                 // current smoothed value (0..1 or -1..1)
  getChannelTarget(name): number           // latest target before smoothing
  getChannelGain(name): number
  getChannelNames(): string[]
  getMoodNames(): string[]

  // camera
  setView(view): void                      // 'front'|'three-q'|'profile'|'orbit'

  // teardown
  dispose(): void
}
```

Multiple instances are independent — see [`examples/demo.html`](examples/demo.html) for a two-panel example with per-panel drag/drop, transport buttons, and mood pills.

---

## Preset JSON

A preset is one plain object — exactly the shape produced by the editor's **save** button. Two examples ship with this repo:

- [`examples/presets/asset-th5rha.json`](examples/presets/asset-th5rha.json) — dense `21×21` red-wire face, glowy iris, deep eye sockets
- [`examples/presets/asset-ydr7de.json`](examples/presets/asset-ydr7de.json) — sparse `7×9` low-poly blue-wire face, exaggerated mouth scale

### Top-level fields

| Field | Type | Meaning |
|---|---|---|
| `version` | string | preset format version (e.g. `"wireface-v010"`) |
| `createdAt` | ISO string | when the preset was saved |
| `renderConfig` | object | mesh + render + style — see below |
| `channelGains` | object | per-channel gain (`0..N`); scales how much each input drives the face |
| `channelGainSliders` | object | UI-side slider position; `loadPreset` reads `channelGains` |
| `activeMood` | string | one of `neutral`, `happy`, `sad`, `angry`, `fear`, `surprise`, `sleep` |
| `moodTargetWeights` | object | per-mood target weight `0..1` (sum is normally 1) |
| `audioName` | string | hint of the audio that was paired with this preset (informational) |
| `lineColor` / `pupilColor` | hex | top-level color overrides applied after `renderConfig` |
| `id` / `name` | string | UI identifier |

### `renderConfig` fields

| Group | Field | Range | Notes |
|---|---|---|---|
| **mesh** | `meshCols` / `meshRows` | int | grid resolution; rebuild on change. e.g. `21×21` (smooth) or `7×9` (low-poly) |
|  | `mode` | `"wire"` / `"solid"` / etc. | render mode |
|  | `meshVisible` | bool | show the underlying grid |
|  | `minimal` | bool | thin line overlays for mouth/eyes/brows/nose |
|  | `fragment` | bool | break the wire mesh into per-tri fragments |
|  | `flipFace` | bool | mirror the face left↔right |
|  | `lineThickness` | `0.1..2` | overlay tube radius |
| **face shape** | `scaleNose` / `scaleEyes` / `scaleMouth` | `0..2+` | per-feature scaling |
|  | `spread` | `0..1` | how widely shapes spread across the mesh |
|  | `reactivity` | `0..1` | overall morph amplitude in response to audio |
|  | `lipVertAmp` | `0..N` | vertical amplitude of lip motion |
|  | `lipPressForce` | `0..N` | "press" force for closure visemes (`PP`, `MM`-like) |
|  | `jawExtend` / `mouthGrow` | offsets | static mouth shape biases |
| **holes / depth** | `mouthHole` / `eyeHoles` | bool | cut holes in the mesh |
|  | `mouthHoleSize` | `~1..2` | radius multiplier |
|  | `eyeDepth` | int | how deep eye sockets push into the mesh |
|  | `mouthAnchor` / `eyeAnchor` | bool | pin anchor rings to track shape changes |
|  | `overlayTracksMesh` | bool | minimal-line overlays follow mesh deformation |
| **style** | `lineColor` | hex | wire color |
|  | `baseColor` | hex | mesh base color |
|  | `fadeColor` | hex | depth-fade target |
|  | `depthFade` | `0..1` | depth attenuation strength |
|  | `pupilColor` / `irisColor` / `irisSize` | hex / `1..4` | eye styling |
|  | `browColor` | hex | brow line color |
|  | `glow` | bool | bloom-style glow on emissive lines |
|  | `pupils` | bool | render pupils at all |
| **mood** | `moodTransitionTime` | seconds | crossfade time between moods |

### Channels (drives)

Channels are the live signal surface. Audio analysis writes them; `setChannel()` overrides them; `channelGains` scales them; the renderer reads them every frame.

```
viseme_sil viseme_PP viseme_FF viseme_TH viseme_DD viseme_kk
viseme_CH  viseme_SS viseme_nn viseme_RR viseme_aa viseme_E
viseme_I   viseme_O  viseme_U
jawOpen mouthSmile mouthPucker
eyeBlinkLeft eyeBlinkRight eyeLookH eyeLookV eyeSquint
browInnerUp browOuterUp browDown
noseSneer
headRotateX headRotateY headRotateZ
```

Manual overrides via `setChannel(name, value)` lock the channel for ~1.2s, then auto-release back to audio-driven control.

### Moods

Moods are convenience presets that fade across a fixed subset of channels (`browInnerUp`, `browOuterUp`, `browDown`, `mouthSmile`, `eyeSquint`, `noseSneer`, `eyeBlinkLeft`, `eyeBlinkRight`):

| Mood | Effect |
|---|---|
| `neutral` | all-zero |
| `happy` | brows up, smile, slight squint |
| `sad` | inner-brow up, slight brow down, frown, half-blink |
| `angry` | brow down, frown, sneer, squint |
| `fear` | brows up, frown, eyes wide |
| `surprise` | brows up, jaw open |
| `sleep` | eyes closed, brows down |

Crossfade time is controlled by `renderConfig.moodTransitionTime`.

### Views

`setView(view)` snaps the camera; `'orbit'` engages a slow auto-orbit.

| View | Camera |
|---|---|
| `front` | dead-on |
| `three-q` | three-quarter |
| `profile` | side |
| `orbit` | slow continuous orbit |

---

## Examples

| File | Purpose |
|---|---|
| [`examples/demo.html`](examples/demo.html) | minimal **library consumer** — two side-by-side instances, drag-drop preset/audio, transport buttons, mood pills. Use this as your reference for embedding wireface into your own page. |
| [`examples/editor.html`](examples/editor.html) | full **preset authoring** UI — sliders, knobs, color pickers, mood weights, save/load. Currently self-contained (ships its own copy of the rendering pipeline) for offline authoring; produces the `.json` shape the library consumes. |

To run them locally:

```bash
npm run demo
# → opens a static server at http://localhost:5173 — visit /examples/demo.html
#   or /examples/editor.html
```

Then drop the bundled presets onto each panel of the demo:

```
examples/presets/asset-th5rha.json   →   left
examples/presets/asset-ydr7de.json   →   right
```

…and drop any `.mp3` of speech on top of either panel.

---

## How it sounds → how it moves

1. `loadAudio()` decodes via `AudioContext` and wires through an `AnalyserNode`.
2. Each frame, the renderer reads frequency-band energies and translates them into viseme channel targets (`viseme_aa`, `viseme_O`, …) plus jaw open / lip press / smile.
3. Active mood blends in across mood-channels with `moodTransitionTime` crossfade.
4. Idle micro-motion adds breathing, blinks, and head sway when no audio is playing.
5. Per-channel smoothing prevents the face from snapping (visemes get heavier smoothing, brows lighter — see `SMOOTH` table in [`wireface.js`](wireface.js)).
6. Final channel state drives mesh morphs + minimal overlay line meshes (mouth lips, eyelids, brows, nose).

---

## Contribute

Issues, PRs, and ideas are very welcome. Anything that's fair game:

- new viseme / expression channels, or better channel mapping for non-English phonetics
- mood blends, idle micro-motion presets, eye-look behaviors
- performance / memory tweaks (smaller draws, tighter geometry rebuilds, WebGPU path)
- alternative renderers (svg, 2d-canvas) sharing the same channel surface
- new preset packs (drop them in [`examples/presets/`](examples/presets/))
- editor UX: keyboard shortcuts, undo, multi-channel keyframing
- docs, typos, clearer onboarding

Open an [issue](https://github.com/styk-tv/wireface/issues) or send a PR — small ones are perfect.

## Show & tell

Built something with wireface? Please share it. There's a dedicated space:

- 👉 **[GitHub Discussions → Show & Tell](https://github.com/styk-tv/wireface/discussions/categories/show-and-tell)** — drop a screenshot, a video, a CodePen, a deployed URL, or a `.json` preset you're proud of. Other people's presets are the best kind of docs.

If you build a public tool / site / experiment with it, a star on the repo is a small thank-you that makes a real difference.

---

## License

MIT © 2026 Peter Styk — see [`LICENSE`](LICENSE).
