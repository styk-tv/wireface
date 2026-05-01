# SPEC.WIREFACE.GRAMMAR.v1.0

Authoritative grammar for **wireface** — naming, vocabulary, and shape of the
runtime. Written 2026-05-01.

This document distinguishes three orthogonal axes:

- **CHANNELS** — live, time-varying expression signals (28 of them). Driven by
  audio analysis, idle micro-motion, mood blending, recorded tracks, or
  manual override. Read every frame by the renderer.
- **CONFIG** — static knobs that shape *how* the face is built and styled.
  Persisted in presets. Changed via UI sliders, color pickers, toggles, or
  `setRenderConfig()`. Mostly orthogonal to channels.
- **ELEMENTS** — concrete renderables: meshes, materials, layers. The
  channels and config jointly drive these every frame.

Use this doc as the single source of truth for what something is called and
what it does. The library code, the editor UI, and the preset format all
derive their vocabulary from here.

---

## 0. Coordinate spaces

| Space | Meaning |
|---|---|
| **`u, v`** | UV grid coordinate, `0..1` left-to-right and top-to-bottom. The triangulated mesh is parameterised on this grid. |
| **`xRel, yRel`** | Normalised face-centre coords: `xRel = (u-0.5)*2`, `yRel = (0.5-v)*2`. Range `-1..+1`. Used inside `warpToFace` for gaussian feature falloffs. |
| **world (`x,y,z`)** | Babylon scene units after `warpToFace`. Front of face is `+z`, back is `-z`. The face silhouette spans roughly `[-0.022, 0.44]` in z. |

---

## 1. CHANNELS (live signals — 28 total)

Channels are floats with a fixed range, smoothed each frame. Audio analysis
writes targets, idle code adds breathing/blinks, mood blending overlays
expression, manual UI drag locks for ~1.2s. Each channel can be scaled by a
**gain** (default 1.0, persisted per preset).

### 1.1 Visemes (15) — mouth-shape primitives, range `[0, 1]`

Oculus-15 phoneme alphabet. Audio FFT estimates an active viseme; the renderer
weighted-sums their `(open, width, round, smile, lipPress, jaw)` targets.

| Channel | Audio cue (rough) |
|---|---|
| `viseme_sil` | silence |
| `viseme_PP` | bilabial closure (P, B, M) |
| `viseme_FF` | labiodental (F, V) |
| `viseme_TH` | dental (TH) |
| `viseme_DD` | alveolar (D, T) |
| `viseme_kk` | velar (K, G) |
| `viseme_CH` | palatal affricate (CH, J, SH) |
| `viseme_SS` | sibilant (S, Z) |
| `viseme_nn` | nasal (N, L) |
| `viseme_RR` | rhotic (R) |
| `viseme_aa` | open back vowel (father) |
| `viseme_E`  | mid front vowel (bed) |
| `viseme_I`  | high front vowel (bee) |
| `viseme_O`  | mid back rounded (bone) |
| `viseme_U`  | high back rounded (boot) |

### 1.2 Mouth shape modifiers (3) — ARKit-style additive layer

| Channel | Range | Purpose |
|---|---|---|
| `jawOpen` | `[0, 1]` | additional jaw drop on top of viseme jaw |
| `mouthSmile` | `[-1, 1]` | smile (positive) or frown (negative) |
| `mouthPucker` | `[0, 1]` | pucker / kiss shape |

### 1.3 Eyes (5)

| Channel | Range | Purpose |
|---|---|---|
| `eyeBlinkLeft` | `[0, 1]` | left eyelid closure |
| `eyeBlinkRight` | `[0, 1]` | right eyelid closure |
| `eyeLookH` | `[-1, 1]` | horizontal gaze direction |
| `eyeLookV` | `[-1, 1]` | vertical gaze direction |
| `eyeSquint` | `[0, 1]` | squint, lid-narrowing |

### 1.4 Brows (3)

| Channel | Range | Purpose |
|---|---|---|
| `browInnerUp` | `[0, 1]` | inner-brow lift (sad/concerned shape) |
| `browOuterUp` | `[-1, 1]` | outer-brow lift (positive) or pull-down (negative) |
| `browDown` | `[0, 1]` | full-brow furrow |

### 1.5 Nose (1)

| Channel | Range | Purpose |
|---|---|---|
| `noseSneer` | `[0, 1]` | nostril flare |

### 1.6 Head pose (3) — drives the parent transform's rotation

| Channel | Range | Purpose |
|---|---|---|
| `headRotateX` | `[-1, 1]` | pitch (×0.35 rad) |
| `headRotateY` | `[-1, 1]` | yaw (×0.50 rad) |
| `headRotateZ` | `[-1, 1]` | roll (×0.30 rad) |

### 1.7 Smoothing constants

Every channel is lerped each frame from `state[ch]` toward `stateTarget[ch]`
with a per-channel time constant. Visemes snap fast (`k=0.45`), brows are
slower (`k=0.18`), head rotation slowest (`k=0.10`). Manual UI drag locks
the channel at the set value for ~1.2s, then auto-releases back to the
audio-driven target. Defined in the `SMOOTH` table.

---

## 2. CONFIG (renderConfig — static knobs)

All persisted in `preset.renderConfig`. Grouped by purpose. **Range** is the
sane authoring range; the type system doesn't enforce these.

### 2.1 Mesh geometry

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `meshCols` | int (odd) | 17 | `5..21`, step 2 | grid columns. Triggers `rebuildMesh`. Odd → preserves centerline symmetry. |
| `meshRows` | int (odd) | 21 | `7..25`, step 2 | grid rows. Triggers `rebuildMesh`. |
| `scaleNose` | float | 1.0 | `0.4..2` | local feature scale around the nose centre |
| `scaleEyes` | float | 1.0 | `0.4..2` | local feature scale around each eye |
| `scaleMouth` | float | 1.0 | `0.4..2` | local feature scale around the mouth |
| `reactivity` | float | 0.25 | `0..0.6` | Laplacian neighbour-coupling factor — propagates morphs to surrounding vertices |
| `spread` | float | 1.0 | `0.5..2` | global multiplier on every blendshape's radius (gaussian falloff width) |
| `meshVisible` | bool | `true` | — | render the underlying triangulated mesh |
| `fragment` | bool | `true` | — | clip mesh triangles to an oval silhouette |
| `mode` | enum | `'wire'` | `'wire' \| 'edges' \| 'shaded'` | render mode for the mesh |

### 2.2 Mouth

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `mouthHole` | bool | `true` | — | cut a real hole in the mesh at the mouth |
| `mouthHoleSize` | float | 1.0 | `0.4..2` | mouth-hole ellipse multiplier |
| `mouthAnchor` | bool | `true` | — | drive mouth-ring vertices directly from `lipTarget()` formula |
| `lipVertAmp` | float | 1.6 | `0.5..4` | vertical amplitude of lip motion |
| `lipPressForce` | float | 1.0 | `0..3` | extra closing pressure for PP/FF/MM phonetics |
| `mouthGrow` | float | 0.0 | `0..1.5` | scale mouth region outward as it opens |

### 2.3 Eyes

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `eyeHoles` | bool | `false` | — | cut sockets through the mesh |
| `eyeHoleSize` | float | 1.0 | `0.4..2` | eye-hole ellipse multiplier (per eye) |
| `eyeAnchor` | bool | `false` | — | drive eye-ring vertices from `eyeLidTargetFor()` |
| `eyeDepth` | float | 1.0 | `0..5` | depth of the parametric eye-socket recess in `warpToFace` |

### 2.4 Jaw distortion (static, independent of channels)

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `jawExtend` | float | 0.0 | `0..3` | z-forward push of lower face — **scaled by `jawOpen`** |
| `upperJawProtrude` | float | 0.0 | `0..3` | static z push of upper-mouth region (`v` ∈ `[0.45, 0.72]`) |
| `lowerJawProtrude` | float | 0.0 | `0..3` | static z push of lower jaw (`v` ∈ `[0.70, 1.0]`, peaks at chin) |

`upperJawProtrude` + `lowerJawProtrude` together produce the snout / animal
/ crocodile-mouth distortion. `jawExtend` is the dynamic version that only
fires while the mouth is open.

### 2.5 Camera & framing

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `flipFace` | bool | `true` | — | mirror face L↔R via parent rotation |
| `cameraView` | enum | `'three-q'` | `'front' \| 'three-q' \| 'profile' \| 'orbit'` | camera preset |

### 2.6 Overlay (minimal-line) — feature curves rendered as Babylon tubes

The overlay is a stylised curve drawn ON TOP of the mesh, made of thick lines
for mouth, eyes, brows, nose. Tubes are real geometry, so thickness DOES work
in wire mode (the WebGL `gl.LINES` 1px lock only affects the underlying mesh
wireframe, not these tubes).

#### Master toggle

| Field | Type | Default | Effect |
|---|---|---|---|
| `minimal` | bool | `true` | hide/show the entire overlay group |
| `overlayTracksMesh` | bool | `true` | overlay endpoints follow the deformed mesh each frame |
| `lineThickness` | float | 1.0 | global multiplier on every overlay tube radius |

#### Per-feature (mouth / eyes / nose / brows)

| Field | Type | Default | Effect |
|---|---|---|---|
| `minimalMouth` | bool | `true` | mouth overlay tubes visible |
| `minimalEyes` | bool | `true` | eye-lid overlay tubes visible |
| `minimalNose` | bool | `true` | nose-bridge + nostril tubes visible |
| `minimalBrows` | bool | `true` | brow tubes visible |
| `mouthLineThickness` | float | 1.0 | mouth-tube radius multiplier (×`lineThickness`) |
| `eyeLineThickness` | float | 1.0 | eyelid-tube radius multiplier |
| `noseLineThickness` | float | 1.0 | nose-tube radius multiplier |
| `browLineThickness` | float | 1.0 | brow-tube radius multiplier |
| `mouthColor` | hex \| `null` | `null` | mouth tube colour. `null` = inherit `lineColor`. |
| `eyeColor` | hex \| `null` | `null` | eye tube colour. `null` = inherit `lineColor`. |
| `noseColor` | hex \| `null` | `null` | nose tube colour. `null` = inherit `lineColor`. |
| `browColor` | hex | `'#ffffff'` | brow tube colour (always explicit, no inherit). |

### 2.7 Style — global rendering

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `lineColor` | hex | `'#ffffff'` | — | shared default colour for any feature whose per-feature override is `null` |
| `baseColor` | hex | `'#ffffff'` | — | mesh wireframe / face emissive base colour |
| `fadeColor` | hex | `'#000000'` | — | back-of-mesh colour the depth fade lerps toward |
| `depthFade` | float | 0.0 | `0..1` | depth-fade strength. `0` = uniform `baseColor`, `1` = fully toward `fadeColor` at `zMin` |
| `depthFadeCurve` | float | 1.0 | `0.3..3` | exponent on the per-vertex fade weight. `>1` darkens edges harder; `<1` brightens |
| `glow` | bool | `false` | — | enable Babylon `GlowLayer` bloom on emissive lines/iris |
| `pupils` | bool | `true` | — | render pupil + iris discs |
| `pupilColor` | hex | `'#ffffff'` | — | pupil disc colour |
| `irisColor` | hex | `'#000000'` | — | iris ring colour (visible behind pupil) |
| `irisSize` | float | 1.6 | `1..4` | iris radius multiplier on pupil radius |

### 2.8 Mood

| Field | Type | Default | Range | Effect |
|---|---|---|---|---|
| `moodTransitionTime` | float | 0.6 | `0.05..5` | crossfade time when switching moods |
| `loopAudio` | bool | `true` | — | loop the AudioBuffer on playback |

### 2.9 Moods (7) — preset weight sets

A mood is a vector of `MOOD_CHANNELS` weights blended into `stateTarget` each
frame. The "active" mood gets weight 1; others fade to 0 over
`moodTransitionTime`.

| Mood | Effect |
|---|---|
| `neutral` | all-zero |
| `happy` | brows up, smile, slight squint |
| `sad` | inner-brow up, slight brow-down, frown, half-blink |
| `angry` | brow down, frown, sneer, squint |
| `fear` | brows up, frown, eyes wide |
| `surprise` | brows up, jaw open |
| `sleep` | eyes closed, brows down |

`MOOD_CHANNELS = [browInnerUp, browOuterUp, browDown, mouthSmile, eyeSquint,
noseSneer, eyeBlinkLeft, eyeBlinkRight]` — only these channels are mood-driven;
visemes / jawOpen / head pose remain audio-driven.

---

## 3. ELEMENTS (renderables)

What gets created in the Babylon scene:

| Element | Type | Notes |
|---|---|---|
| `face` | `BABYLON.Mesh` | the parametric grid; rebuilt on geometry-affecting config change |
| `wireMat` | `StandardMaterial` | wireframe material; `useVertexColor=true` so depth-fade colours show in `wire` mode |
| `faceMat` | `StandardMaterial` | shaded/edges material |
| `mouthMat`, `eyeMat`, `noseMat`, `browMat` | `StandardMaterial` × 4 | one per overlay feature; emissive-only so they don't react to scene lights |
| `mouthUpperMesh` / `mouthLowerMesh` | `Mesh` (tube) | upper + lower lip lines |
| `eyeMeshes[2]` | `{upper, lower}` × 2 | eyelid arcs |
| `browMeshes[2]` | `{mesh}` × 2 | brow curves |
| `noseBridgeMesh` / `noseLeftMesh` / `noseRightMesh` | `Mesh` (tube) | nose bridge + nostril arcs |
| `pupilL` / `pupilR` | `Disc` | pupil discs (when `pupils: true`) |
| `irisL` / `irisR` | `Disc` | iris rings, sized by `irisSize` |
| `glowLayer` | `BABYLON.GlowLayer` | created once, toggled via intensity |
| `faceRoot` | `TransformNode` | parent for all face geometry; receives head-pose rotation |
| `minimalGroup` | `TransformNode` | parent for the overlay tubes; toggled by `minimal` |

### 3.1 What channels drive what elements

```
visemes ─┐                             mouthRingVerts (anchor)
         ├─→ computeMouthParams ─→ ─→ ─┤
jawOpen ─┘                             mouth_* SHAPES (gaussian morphs)
                                       mouthUpperMesh / mouthLowerMesh (overlay tubes)

mouthSmile, mouthPucker     →   layered into mouth params

eyeBlink* / eyeSquint       →   eye_blink_* / eye_squint_* SHAPES
                                eyeMeshes[].upper/.lower (overlay)
                                eyeRingVerts (anchor)
eyeLookH/V                  →   pupilL/pupilR position offset

browInnerUp/OuterUp/Down    →   brow_* SHAPES
                                browMeshes[].mesh (overlay)

noseSneer                   →   nose_sneer_* SHAPES
                                noseLeftMesh / noseRightMesh (flare)

headRotateX/Y/Z             →   faceRoot.rotation
```

### 3.2 What config drives what elements

```
meshCols / meshRows / fragment / mouthHole / eyeHoles / mouthHoleSize /
eyeHoleSize / eyeDepth                            → triggers rebuildMesh

lineThickness / mouthLineThickness / eyeLineThickness / noseLineThickness /
browLineThickness                                 → triggers rebuildMinimalLines

pupils / irisSize                                 → triggers rebuildPupils

lipVertAmp / lipPressForce                         → triggers identifyAnchorRings

minimalMouth / minimalEyes / minimalNose /
minimalBrows                                       → applyMinimalSubVisibility

minimal                                            → minimalGroup.setEnabled

mouthColor / eyeColor / noseColor / browColor     → mat.emissiveColor
lineColor                                          → fallback for null overrides
baseColor / fadeColor                              → vertex-color buffer (depth fade)
depthFade / depthFadeCurve                         → per-frame fade pass
glow                                               → glowLayer.intensity
flipFace                                           → faceRoot.rotation.y
mode                                               → mesh.material + edgesRenderer
loopAudio                                          → audioSource.loop
```

---

## 4. PRESET JSON SHAPE

Top-level keys, all required:

```jsonc
{
  "version": "wireface-v010",            // format tag
  "createdAt": "ISO-8601 string",
  "renderConfig": { /* every key in §2 */ },
  "channelGains": { /* channel → number, default 1.0 */ },
  "channelGainSliders": { /* channel → slider position k in [-2,+2], gain = 2^k */ },
  "activeMood": "neutral",
  "moodTargetWeights": { "neutral":1, "happy":0, ... },
  "audioName": "asset__post__xxx.mp3",   // informational; cannot rehydrate audio
  "lineColor": "#ffffff",                // legacy duplicate of renderConfig.lineColor
  "pupilColor": "#ffffff",               // legacy duplicate
  "id": "<6-char base36>",
  "name": "asset__post__<id>"
}
```

**Backward compatibility rule:** new fields default to a value that
preserves prior behaviour. Per-feature colours default to `null` (inherit
`lineColor`). Per-feature visibilities default to `true`. Per-feature
thicknesses default to `1.0`. `depthFadeCurve` defaults to `1.0`.
`upperJawProtrude` / `lowerJawProtrude` default to `0.0`.

A v1.0.x preset loaded into a v1.1+ engine renders identically.

---

## 5. EDITOR UI ORGANISATION (target)

The right panel groups controls by the axes above, in this order:

1. **AUDIO** — file load, loop toggle, transport
2. **MOOD** — 7 mood pills + transition time
3. **VIEW** — 4 camera presets
4. **MESH** — geometry + clipping (cols, rows, scales, react, spread, fragment, show mesh)
5. **MOUTH** — mouth-specific (`mouthHoleSize`, lip amp/press, mouth grow, mouth hole / anchor toggles)
6. **EYES** — eye-specific (`eyeDepth`, `eyeHoleSize`, eye holes / anchor toggles)
7. **JAW DISTORTION** — `jawExtend`, `upperJawProtrude`, `lowerJawProtrude`
8. **OVERLAY** — minimal-line per-feature controls (toggles, thicknesses, colours)
9. **STYLE** — mode, glow, pupils, flipFace, overlayTracksMesh
10. **COLOURS** — base, fade, fade curve, line (default), per-feature override colours, pupil, iris, irisSize
11. **SESSION** — record / export / import / preset list

The CHANNELS panel on the left is unchanged — channels are signals, not
config.

---

## 6. API

`createWireface(canvas, options) → WireFace` (lib only). Editor still
ships its own self-contained renderer; a future revision will rewrite the
editor as a pure UI on top of `createWireface`. The lib's API surface:

```ts
interface WireFace {
  // audio + preset
  loadAudio(file_or_blob): Promise<void>
  loadPreset(presetObject): void
  setRenderConfig(partial): void
  getRenderConfig(): object

  // transport
  play(fromOffset?: number): void
  pause(): void
  stop(): void
  setLoop(bool): void
  isPlaying(): boolean
  getDuration(): number
  getPosition(): number

  // expression
  setMood(name): void
  getActiveMood(): string
  setChannel(name, value): void
  setChannelGain(name, gain): void
  getChannel(name): number
  getChannelTarget(name): number
  getChannelGain(name): number
  getChannelNames(): string[]
  getMoodNames(): string[]

  // camera
  setView(view): void

  // teardown
  dispose(): void
}
```

---

## 7. NORMS / INVARIANTS

1. **Channels and config never share names.** A channel is a signal, a config
   is a knob. Sets are disjoint.
2. **Defaults preserve identity.** A preset that omits a field gets the
   default from `DEFAULT_CONFIG`; the default is chosen so the rendered
   output is identical to the prior version that didn't have the field.
3. **One material per overlay feature.** Mouth, eyes, nose, brows each get
   their own `StandardMaterial`. The wire mesh has its own (`wireMat`).
4. **Live thickness updates require tube rebuild.** `BABYLON.MeshBuilder.CreateTube`
   fixes radius at construction. Any thickness slider change calls
   `rebuildMinimalLines`.
5. **Live geometry updates require mesh rebuild.** Any of `meshCols`,
   `meshRows`, `fragment`, `mouthHole`, `mouthHoleSize`, `eyeHoles`,
   `eyeHoleSize`, `eyeDepth` changing → `rebuildMesh`.
6. **Per-feature null = inherit `lineColor`.** `mouthColor`, `eyeColor`,
   `noseColor` may be `null` in JSON; renderer falls through to `lineColor`.
   `browColor` is not nullable (always explicit).
7. **Coordinate of the eye recess equals coordinate of the eye opening.**
   Both at `(u=0.30, v=0.40)` and `(u=0.70, v=0.40)`. The recess used to be
   at `v=0.35`; corrected in v1.1 to align with the overlay.
8. **`gl.LINES` is 1px-locked.** WebGL's line width can't be changed in
   modern drivers. Wireface uses tubes for the overlay so thickness IS
   meaningful in `wire` mode; the only thing locked at 1px is the mesh's
   internal wireframe.

---

## 8. UNRESOLVED / FUTURE GRAMMAR

- **Editor as pure consumer** of `createWireface`. Currently the editor
  has its own self-contained copy of the renderer. The lib already exposes
  enough getters/setters (`setRenderConfig`, `getChannel*`, …) for the
  editor to migrate.
- **Channel groups as first-class subjects** for binding in MIDI / OSC
  control surfaces.
- **Layered presets** — base preset + delta preset for character variants.
- **Per-channel cubic smoothing** instead of linear lerp.
- **Mode-aware overlay thickness**: in `edges` mode the overlay tubes
  visually dominate; consider auto-scaling them down.

---

End of `SPEC.WIREFACE.GRAMMAR.v1.0`. Edits and additions tracked in
[`CHANGELOG.md`](CHANGELOG.md).
