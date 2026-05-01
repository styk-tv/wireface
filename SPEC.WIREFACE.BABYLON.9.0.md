# SPEC.WIREFACE.BABYLON.9.0

How **wireface** uses **Babylon.js v9**. Pair with
[`SPEC.WIREFACE.GRAMMAR.v1.0`](SPEC.WIREFACE.GRAMMAR.v1.0.md) — that one
defines the *what* (channels, configs, elements); this one defines the
*how* (which Babylon APIs, in which order, with which trade-offs).

Audience: someone embedding wireface in a Babylon project, or
authoring/extending the renderer. Last updated 2026-05-01 / v1.1.1.

---

## 0. Versions

| Layer | Version | Why |
|---|---|---|
| Babylon.js (peer) | **`9.x`** (latest `9.5.0` at time of writing) | v9 is the current LTS. v8 also works (everything wireface uses dates back to v6) but v9 has Parallel Shader Compilation on by default, which gives noticeable mount-time speedup with multiple instances. |
| WebGL | **WebGL 2** | Babylon falls back to WebGL 1 automatically; wireface doesn't use WebGL2-only features, so it works on either. |
| Engine | `BABYLON.Engine` | The standard `WebGLEngine`. The `WebGPUEngine` should work but isn't tested — open an issue if you try it and it doesn't. |
| Coordinate system | **Right-handed** (`scene.useRightHandedSystem = true`) | See §3 — this matters. |

---

## 1. What wireface needs from Babylon

A small but specific subset:

| Babylon API | Used for |
|---|---|
| `BABYLON.Engine` | renders the canvas |
| `BABYLON.Scene` | one per instance |
| `BABYLON.ArcRotateCamera` | orbit / zoom / preset views |
| `BABYLON.HemisphericLight` | minimal ambient (lit only when `mode='shaded'` or `'edges'`) |
| `BABYLON.TransformNode` | `faceRoot` (parent for all face geometry) and `minimalGroup` (parent for overlay tubes) |
| `BABYLON.StandardMaterial` | one for the mesh wireframe (`wireMat`), one for the shaded mesh (`faceMat`), one per overlay feature (`mouthMat`/`eyeMat`/`noseMat`/`browMat`) |
| `BABYLON.Mesh` | the parametric face grid |
| `BABYLON.MeshBuilder.CreateTube` | every overlay feature line (mouth, eyes, brows, nose) |
| `BABYLON.MeshBuilder.CreateDisc` | pupils + iris discs |
| `BABYLON.GlowLayer` | bloom on emissive lines (gated by `config.glow`) |
| `BABYLON.VertexBuffer.{Position,Normal,Color}Kind` | per-frame buffer updates for mesh deformation + depth-fade gradient |
| `BABYLON.VertexData.ComputeNormals` | recompute normals each frame in `edges`/`shaded` modes |
| `BABYLON.Color3 / Color4` | colour assignment everywhere |
| `BABYLON.Vector3` | every geometric calculation |

Roughly **15 named symbols**. No imports of inspector / GUI / loaders /
materials-library / post-process — wireface ships clean against the
core engine bundle.

---

## 2. Library linking — what's actually required

Babylon ships in many flavours. Pick the smallest that satisfies §1.

| Bundle | Size (gz) | Contains | Works for wireface? |
|---|---|---|---|
| `babylonjs/Engines/Engine` (UMD `babylon.js`) | ~1.4 MB | everything in core: engine, scene, cameras, lights, mesh builder, materials, layers, post-process | ✅ — what we recommend, what the demo and editor use |
| `@babylonjs/core` ESM tree-shaken | depends on usage; ~400 KB realistic | only what you import | ✅ — recommended for bundled apps; see §2.2 |
| `@babylonjs/core` + `@babylonjs/loaders` + `@babylonjs/gui` | varies | full stack | ✅ overkill — wireface doesn't need any of it |
| `@babylonjs/viewer` (high-level) | huge | wraps Engine + scene loading | ❌ — viewer assumes a glTF model; wireface needs a raw scene |

### 2.1 CDN form (the demo + editor + most playgrounds)

```html
<script src="https://cdn.jsdelivr.net/npm/babylonjs@9/babylon.js"></script>
<script src="https://cdn.jsdelivr.net/npm/wireface@1/dist/wireface.min.js"></script>

<canvas id="face" style="width:480px;height:480px"></canvas>

<script>
  const wf = createWireface(document.getElementById('face'));
  wf.setMood('happy');
</script>
```

This is the smallest possible bring-up. `babylon.js` from CDN is the
full UMD core (~1.4 MB gz). `wireface@1/dist/wireface.min.js` is ~9 KB
gz. Total over-the-wire: roughly 1.41 MB — almost entirely Babylon.

### 2.2 ESM / bundler form

```js
// app.js
import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { GlowLayer } from '@babylonjs/core/Layers/glowLayer';
import { VertexBuffer, VertexData } from '@babylonjs/core/Meshes/buffer';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';

// expose as global because wireface.js reads BABYLON.* from window
window.BABYLON = { Engine, Scene, ArcRotateCamera, HemisphericLight,
  TransformNode, Mesh, MeshBuilder, StandardMaterial, GlowLayer,
  VertexBuffer, VertexData, Color3, Color4, Vector3 };

import { createWireface } from 'wireface';
const wf = createWireface(document.getElementById('face'));
```

The lib is currently UMD-style (reads `window.BABYLON` at call time),
not native ESM. A future revision will export a `createWireface(BABYLON,
canvas, …)` form that takes BABYLON as a parameter so tree-shaken
bundles don't need the global-window shim.

### 2.3 What the lib does NOT use (so you don't have to ship)

- Inspector (`@babylonjs/inspector`)
- GUI (`@babylonjs/gui`) — wireface's UI is HTML/CSS, not Babylon GUI
- Loaders (`@babylonjs/loaders`) — no glTF, OBJ, etc.
- Materials library (`@babylonjs/materials`) — only `StandardMaterial`
- Procedural textures
- Particles
- Physics
- Audio engine (`@babylonjs/core/Audio` — wireface uses raw Web Audio)

If your bundler is correctly configured, none of those should land in
your output.

---

## 3. Coordinate system — `scene.useRightHandedSystem = true`

> "find a way to flip or relax those on init so we can use view as
> designed" — user, 2026-05-01

Babylon defaults to a **left-handed** coordinate system: `+X` right,
`+Y` up, `+Z` *into* the screen (forward / away from viewer). The
default `ArcRotateCamera(α=-π/2, β=π/2)` sits at `(0, 0, -radius)`
looking toward the origin (looking down `+Z`).

`warpToFace` (the parametric face surface) builds with `+Z` = nose
forward — i.e. positive Z protrudes away from the surface plane. In
Babylon's LH default, that means **the nose points away from the
camera**: front view shows the back of the head, three-quarter and
profile show mirrored sides.

The fix is a single line at scene creation:

```js
scene.useRightHandedSystem = true;
```

In the right-handed system `+Z` is *out of the screen* (toward viewer).
The same camera at `α=-π/2, β=π/2` now sits at `(0, 0, +radius)`
looking down `-Z`, and the same face geometry naturally faces the
camera. **No geometry change, no `faceRoot.rotation` flip needed, no
view-alpha rewiring.** The four view presets

| Name | `α` | `β` | Shows |
|---|---|---|---|
| `front`   | `-π/2` | `π/2` | face front-on |
| `three-q` | `-π/2 - 0.6` | `π/2 - 0.15` | conventional three-quarter (face's right closer to camera) |
| `profile` | `0` | `π/2` | face's right side, nose pointing camera-left |
| `orbit`   | (animated) | — | continuous slow rotation around Y |

…all map to the conventionally-correct sides. Without this line, every
view shows the wrong face of the model.

### 3.1 What about the `flipFace` config field?

`flipFace` (boolean, default `true`) rotates `faceRoot` by `π` around
the Y axis. With the RH coordinate-system fix, this is **no longer
required for correct viewing** — it's now a stylistic L↔R mirror toggle.
With `flipFace: true` you get a "looking at someone face-to-face" view
(viewer's right = subject's left). With `flipFace: false` you get a
mirror view (viewer's right = subject's right, like looking at your own
reflection).

Both render correctly thanks to RH; only the L↔R orientation changes.
Existing v1.0/v1.1 presets default to `true` and continue rendering
identically.

### 3.2 Side effects of switching to RH

Anything that depended on Babylon's LH conventions for vertex winding
or face culling could in principle render incorrectly. In wireface's
case:

- **Mesh face winding** — `triIndices` are produced by quad-pair
  triangulation in `rebuildMesh`. Materials use `backFaceCulling =
  false` (mesh, wire, overlay materials all set it), so winding doesn't
  affect visible rendering.
- **Babylon-built primitives** (tubes, discs) — these adapt to the
  active handedness on construction.
- **Lighting** (`HemisphericLight`) — direction `(0, 1, 0)` is up in
  both LH and RH, so unchanged.

Verified visually with playwright across all four views; no regression.

---

## 4. Multiple instances on the same page

Each call to `createWireface(canvas)` builds a **fully independent**
runtime: its own engine, scene, camera, all materials, mesh, audio
context, render loop, channel state. Two instances share *nothing* in
JS land — no globals, no module-level variables.

The cost: each instance allocates its own
- `BABYLON.Engine` (one WebGL context per canvas — browsers cap this
  somewhere around 8–16 contexts; old contexts get killed if you exceed
  it).
- Babylon scene with materials and meshes (a few hundred KB of GPU
  buffers each).
- Web Audio `AudioContext` (browsers cap these too — chromes around 6,
  Safari fewer).
- A `requestAnimationFrame`-driven render loop.

Verified pattern (this is what `examples/demo.html` does):

```html
<canvas id="left"  style="width:480px;height:480px"></canvas>
<canvas id="right" style="width:480px;height:480px"></canvas>

<script src="https://cdn.jsdelivr.net/npm/babylonjs@9/babylon.js"></script>
<script src="https://cdn.jsdelivr.net/npm/wireface@1/dist/wireface.min.js"></script>
<script>
  const wfL = createWireface(document.getElementById('left'));
  const wfR = createWireface(document.getElementById('right'));

  wfL.loadAudio(blobA);  wfL.setMood('happy');  wfL.play();
  wfR.loadAudio(blobB);  wfR.setMood('angry');  wfR.play();
</script>
```

Two faces, two audio sources, two unrelated states. Works.

### 4.1 Many instances on one page (>4)

Within a single page, every instance shares the same JS execution thread,
so 60 fps × N instances = 16ms / N per instance per frame for animation
work. Wireface's per-frame cost on a 17×21 mesh with all features on is
roughly 0.5–1 ms; six instances is comfortable, ten starts to drop frames
on slower machines.

If you need many small faces (avatar grid, video-call gallery, etc.)
consider:

- using a smaller mesh (`meshCols=7, meshRows=9`)
- disabling per-frame `updateMinimal()` for offscreen instances (manually
  via `engine.stopRenderLoop()` when not visible — no API for this yet)
- sharing the AudioContext across instances by passing your own (also
  no API for this yet — open an issue)

---

## 5. Multiple faces in the same Babylon scene

Currently **not supported by the public API**. `createWireface(canvas)`
always builds its own scene; you can't say "add a face to this existing
scene".

**Why this matters**: integrating wireface into a Babylon Playground (or
any larger Babylon scene with other objects) requires running wireface
on a separate canvas. Hosting two faces in one scene would let you light
and post-process them as a unit, which we don't currently support.

**Workarounds**:

- **Side-by-side canvases** (most common — `demo.html` shows it). Each
  face is its own engine; layout is plain HTML grid. Works everywhere.
- **Hidden canvas + `RenderTargetTexture`** — render the wireface scene
  into a texture, then sample that texture in your main scene's
  material. Nontrivial, no helper API for it yet.
- **Future API**: `createWirefaceInScene(scene, options)` that adds a
  faceRoot transform node + meshes to an existing scene without owning
  the engine/scene. The lib is structured so this should be a small
  refactor — it's the natural next API after `createWireface(canvas)`.

If you need this for the Babylon Playground or a multi-character scene,
file an issue.

---

## 6. Babylon Playground

[playground.babylonjs.com](https://playground.babylonjs.com/) is an
in-browser editor that compiles a `createScene()` function and runs it
against a pre-existing engine + canvas.

Two complications for hosting wireface:

1. **Engine ownership** — the playground creates the engine. Wireface
   currently creates its own. They both attach to the same canvas →
   only one wins; the other one's render loop is wasted work.
2. **`window.BABYLON` is already set** — the playground exposes Babylon
   as a global (matching wireface's expectation), so loading wireface
   from CDN does work.

The pragmatic path: import wireface from CDN inside `createScene`,
construct it on the playground's canvas, and **return the Playground's
own scene object** (which will be empty, but the playground keeps it
alive). The wireface scene will render to the same canvas alongside the
empty playground scene; the playground's empty scene contributes
nothing to the output.

A working playground example lives in [`examples/playground.html`](examples/playground.html)
and on [playground.babylonjs.com/#2TG54D](https://playground.babylonjs.com/#2TG54D).
That snippet:

- loads `wireface@1` from jsDelivr inside the `createScene` callback
  using a dynamic `<script>` tag (the playground doesn't allow
  top-level `<script>` tags),
- attaches wireface to the playground's canvas (`engine.getRenderingCanvas()`),
- exposes a tiny audio drag-drop on the page and a preset switcher.

A future "playground-aware" wireface mode that accepts an existing
scene would simplify this — currently in the backlog.

---

## 7. Performance notes

### 7.1 Per-frame cost breakdown (one instance, 17×21 mesh, all features on)

Rough numbers from a Mac M1 in Chrome:

| Stage | Cost (ms) |
|---|---|
| `idleAnimate` + `analyzeAudioFrame` | <0.05 |
| `smoothChannels` | <0.05 |
| `computeMorphs` (gaussian falloff over 30 shapes × ~360 verts) | ~0.30 |
| `couple` (Laplacian, optional) | ~0.10 (if `reactivity > 0`) |
| `applyFeatureScales`, `applyJawExtension`, `applyMouthGrow`, `applyUpperJaw…`, `applyLowerJaw…`, `applyMouthAnchors`, `applyEyeAnchors` | ~0.10 total |
| Vertex buffer upload (`updateVerticesData`) | ~0.10 |
| Depth-fade colour buffer recompute (only if `depthFade > 0`) | ~0.05 |
| `updateMinimal` (8 tubes × `CreateTube` instance form) | ~0.30–0.50 |
| `scene.render()` — Babylon's own work | ~0.30 |
| **Total** | **~1.0–1.5 ms** |

At 60 fps that's 6–9% of frame budget — comfortably idle on a desktop,
real-time on a phone too.

### 7.2 What costs the most when scaling

- **Mesh density** quadratically: `meshCols × meshRows`. 21×21 is ~1.5×
  the cost of 17×21. 7×9 is half.
- **`reactivity > 0`** turns on Laplacian smoothing — costs proportional
  to mesh density × neighbour count.
- **`updateMinimal`** rebuilds all 8 tubes' paths each frame. Disabling
  individual overlay features (`minimalMouth=false`, etc.) doesn't skip
  the path computation — only the rendering. Not currently optimised.
- **`glow=true`** adds a `GlowLayer` post-process pass, ~0.3 ms extra.

### 7.3 What helps

- `scene.skipPointerMovePicking = true` — already on, saves a per-frame
  ray test.
- `BABYLON.Engine` constructed with `stencil: false, antialias: true`
  — no stencil buffer means cheaper depth tests.
- The `updateVerticesData` path uses pre-allocated `Float32Array`s
  (`_posBuf`, `_normBuf`, `_colBuf`) — no per-frame allocation.

---

## 8. Known gotchas / pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| "I see only the back of the head, profile is wrong" | LH coord system, face built with `+Z` forward | Set `scene.useRightHandedSystem = true` (lib does this since v1.1.1). |
| "The mouth thickness slider doesn't change anything" | `MeshBuilder.CreateTube` instance-form re-applies `opts.radius` every frame; if you don't pass the multiplier, it resets | Lib fixed in v1.1.0 — pass the per-feature thickness on every `updateMinimal` tube call. |
| "Loading a saved preset gives wrong mesh resolution" | `setRcfgVal`'s rounding shifted odd values up by 2 for `step=2` sliders | Editor fixed in v1.1.0. |
| "WebGL context lost" after creating many instances | Browser cap (~8–16 contexts) | Dispose unused instances with `wf.dispose()`. |
| Babylon error: `getGamepads is not allowed in this context` | Some sandboxed iframes (Claude artifacts, Stackblitz embeds) block `navigator.getGamepads()`, which Babylon's input manager probes | Lib stubs `getGamepads` for the duration of `camera.attachControl`. |
| Editor opens with all features visible but no face | If you've got `pupils=true` but iris/pupil position lookups fail (e.g. mesh not yet built), the editor used to throw | Always `rebuildMesh()` before `rebuildPupils()` — wireface ordering preserved. |

---

## 9. Forward grammar (proposed)

- **`createWirefaceInScene(scene, options)`** — multi-instance in one
  Babylon scene without owning the engine.
- **`createWireface(canvas, { babylon })`** — explicit BABYLON injection
  for ESM/tree-shaken builds without `window.BABYLON`.
- **`disposable wireface object`** — currently `wf.dispose()` is the
  manual hook; could expose as a `Symbol.dispose` for `using`.
- **`wf.useEngine(existingEngine)`** — share engine across multiple
  instances (one engine, one canvas, multiple wireface scenes
  multiplexed).
- **`wf.snapshotPNG()`** — single-frame PNG export. Trivial in Babylon
  via `BABYLON.Tools.CreateScreenshot`, just hasn't been wired through.
- **WebGPU engine support** — `BABYLON.WebGPUEngine` substitution.
  Should work; not tested.

---

End of `SPEC.WIREFACE.BABYLON.9.0`. Edits and additions tracked in
[`CHANGELOG.md`](CHANGELOG.md).
