# Changelog

All notable changes to **wireface** are recorded here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [SemVer](https://semver.org/).

## [Unreleased]

## [1.1.4] — 2026-05-01

### Fixed
- **The 180° bug, finally finally.** Three releases of "fix" attempts all
  missed the actual root cause: `updateFace` writes
  `faceRoot.rotation.y = state.headRotateY * 0.50` every frame to drive
  the head-pose channel, which **wipes out** the π rotation set by
  `applyFaceFlip` at init. The flip lasted exactly one frame, then got
  stomped. The face has therefore been at its native orientation since
  v1.0 — back of head facing camera. Front view hid this because the
  face is L-R symmetric; user reported the bug was only visible at
  3/4 view, where you can see depth ordering (irises sat behind the
  wireframe).

  Confirmed empirically with bounding-box probes:
  - Before fix: `faceRoot.rotation.y ≈ -0.045` (just idle micro-motion);
    face's nose at z=+0.469 → distance to camera = 4.869 (FAR);
    face's back at z=-0.060 → distance = 4.340 (CLOSE) ⇒ camera saw back
  - After fix: `faceRoot.rotation.y ≈ 3.122` (= π + idle);
    rotated nose at z=-0.453 → distance = 3.947 (CLOSE);
    rotated back at z=+0.039 → distance = 4.439 (FAR) ⇒ camera sees front

  Fix: include the flipFace base rotation in the per-frame Y write so
  it persists.
  ```js
  // before:  faceRoot.rotation.y = state.headRotateY * 0.50;
  // after:   const flipBase = config.flipFace ? Math.PI : 0;
  //          faceRoot.rotation.y = flipBase + state.headRotateY * 0.50;
  ```
  Reverted the bogus 1.1.3 inversion of `applyFaceFlip` (the original
  semantic was right; the bug was elsewhere). Both lib and editor get
  the same two-line fix.

### Reverted
- 1.1.3's `applyFaceFlip` inversion (`flipFace ? 0 : Math.PI`). It
  produced visually-correct front view by accident (mesh symmetry) but
  was structurally backwards. Restored to `flipFace ? Math.PI : 0`.

## [1.1.3] — 2026-05-01

### Fixed
- **The 180° bug, finally.** v1.1.2 successfully switched the Scene to
  `useRightHandedSystem: true` (verified at runtime), but I missed the
  consequence: in RH the face's native orientation (built by
  `warpToFace` with `+Z = nose forward`) already faces the default
  `ArcRotateCamera`. Applying `flipFace: true` (the legacy default)
  then rotated the face **180° AWAY** from the camera — exactly the
  reversed view the user reported, including in incognito.

  Fix: invert `applyFaceFlip`'s effect.
  - `flipFace: true` (legacy default) → **no rotation** → face toward
    camera (correct, the visible behavior of every preset saved under
    LH is preserved).
  - `flipFace: false` → 180° rotation around Y → face away from camera
    (matches the OLD `flipFace: false` visual; toggle still does
    "flip the face").

  Two-line fix in lib + editor:
  ```js
  // before:  faceRoot.rotation.y = config.flipFace ? Math.PI : 0;
  // after:   faceRoot.rotation.y = config.flipFace ? 0 : Math.PI;
  ```
  Existing presets render visually identical to their LH-era behavior.
  New default first-load shows face front-on. Verified in editor (fresh
  load + incognito): front view face front-on, profile view face's
  right side, three-quarter the conventional portrait angle.

## [1.1.2] — 2026-05-01

### Fixed
- **`useRightHandedSystem` now actually sticks at scene init.** v1.1.1 set
  `scene.useRightHandedSystem = true` via property assignment AFTER the
  Scene constructor returned. Empirically, on Babylon 9.5.0 that
  assignment does not survive the rest of scene initialisation — a
  runtime probe shortly after createWireface returned read
  `scene.useRightHandedSystem === false` despite the source assignment.
  The face still rendered visibly because of the default `flipFace: true`
  rotation, but profile / three-quarter views were mirrored (camera at
  `+X` saw the face's left because the geometry was implicitly flipped
  by the runtime LH→fix-by-rotation path).

  Fix: pass the option to the Scene constructor —
  `new BABYLON.Scene(engine, { useRightHandedSystem: true })`. Verified
  with playwright: scene now reports `useRightHandedSystem: true` from
  the first frame and profile / three-quarter views render the
  conventionally-correct sides of the face. Both lib and editor get
  the fix; the editor's view buttons now map naturally without any
  view-alpha rewiring or geometry flip. The post-construction property
  assign is also kept (belt-and-braces).

## [1.1.1] — 2026-05-01

### Fixed
- **`scene.useRightHandedSystem = true`** at scene creation in both
  lib (`wireface.js`) and editor (`examples/editor.html`). Babylon's
  default left-handed coordinate system put the face's `+Z`
  nose-forward away from the default `ArcRotateCamera`, so `front`
  view showed the back of the head and `profile` showed the wrong
  side of the face. The right-handed system makes `+Z` out-of-screen,
  so geometry naturally faces the camera and the four view presets
  (`front`, `three-q`, `profile`, `orbit`) map to conventionally
  correct sides — no geometry change, no `faceRoot.rotation` flip,
  no view-alpha rewiring. This is the canonical Babylon answer the
  user hinted at ("find a way to flip or relax those on init"). See
  [`SPEC.WIREFACE.BABYLON.9.0` §3](SPEC.WIREFACE.BABYLON.9.0.md#3-coordinate-system--sceneuserighthandedsystem--true).

### Added
- **`SPEC.WIREFACE.BABYLON.9.0.md`** — how wireface uses Babylon.
  Covers: minimum API surface (~15 symbols), CDN vs ESM bundling,
  the right-handed coordinate decision, multi-instance pages,
  multi-canvas pages, multi-face-in-one-scene status (not yet
  supported, workarounds documented), the playground.babylonjs.com
  approach, per-frame cost breakdown, known gotchas, forward grammar.
- **`examples/playground.html`** — minimal CDN-loaded consumer in
  ~100 lines. Two baked-in presets (red wire / low-poly blue) +
  audio drag-drop + play/stop. Designed as the "reference example" a
  Babylon Playground snippet derives from.
- **README**: References section explaining the 30-channel grammar's
  origin — 15 visemes from
  [Oculus Lipsync](https://developer.oculus.com/documentation/native/audio-ovrlipsync-viseme-reference/)'s
  phoneme alphabet plus 15 [ARKit-style](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation)
  face blendshapes (curated subset of Apple's 52). Fixes the prior
  "28 channels" claim in the abstract — actual count is 30.

## [1.1.0] — 2026-05-01

Geometry knobs, fade fix, per-feature minimal-line controls, full
editor UI reorg + a comprehensive grammar spec.

### Added
- **Per-feature minimal-line overlay controls** for mouth / eyes / nose /
  brows. Each feature now has its own:
  - **color** (`mouthColor`, `eyeColor`, `noseColor` — `browColor` was
    already separate). All default `null` = inherit `lineColor`, so v1.0
    presets render identically. Setting any to a hex overrides the
    inherited color for that feature only.
  - **line thickness multiplier** (`mouthLineThickness`,
    `eyeLineThickness`, `noseLineThickness`, `browLineThickness`) —
    multiplies on top of the global `lineThickness`. Lets you make the
    mouth thick + nose thin without changing the others. Range `0.2..4`,
    default `1.0`.
  - **visibility toggle** (`minimalMouth`, `minimalEyes`, `minimalNose`,
    `minimalBrows`) — independent of the master `minimal` toggle (which
    still hides the whole overlay). Default `true`.
  - Internally backed by separate Babylon materials (`mouthMat`, `eyeMat`,
    `noseMat`, `browMat`) so colors don't bleed between features.
- `depthFadeCurve` config (`0.3..3`, default `1.0`) — exponent applied to the
  per-vertex fade weight so edges can reach **true black** even when the wire
  segments interpolate from inner-bright vertices. `>1` darkens the back
  faster, `<1` brightens it.
- `upperJawProtrude` and `lowerJawProtrude` config (`0..3`, default `0`) —
  static z push of the upper-mouth and lower-jaw regions. Stack on top of the
  existing `jawExtend` (which is jawOpen-driven). Used together they form the
  forward snout / animal / crocodile-mouth distortion the editor couldn't
  previously achieve. Independent so you can dial only the chin or only the
  upper lip out.
- **Editor UI** for all of the above:
  - new **OVERLAY FEATURES** panel section (4 visibility toggles + 4
    thickness sliders).
  - new **upper jaw fwd** and **lower jaw fwd** sliders in the JAW + GROWTH
    section.
  - new **fade curve** slider in the COLORS section.
  - new **mouth / eyes / nose** colour pickers in the COLORS section
    (next to the existing line / brow / pupil / iris pickers).

### Changed
- Eye-socket warp recess moved from `yRel = 0.30` (UV `v ≈ 0.35`) down to
  `yRel = 0.20` (UV `v = 0.40`), aligning the parametric recess centre with
  the eye opening / minimal-line eyelid overlay / eye-hole puncture
  (all at `v = 0.40`). Fixes the visual mismatch where the bowl sat above
  where the eyes actually were. Editor's `warpToFace` updated to match.
- `makeTube(name, points, radius, mat, featureMul, instance)` — signature
  changed to accept a per-feature material and per-feature thickness
  multiplier. Backward compat: passing `null` for either uses the
  `mouthMat` and `featureMul = 1` defaults respectively.

### Fixed
- `loadPreset` now correctly re-applies `glow` (and re-registers the
  GlowLayer with the freshly-rebuilt mesh) on preset load. Previously the
  glow flag was stored but the GlowLayer's intensity wasn't always updated
  after a `rebuildMesh()`, so toggling glow on, saving, and loading another
  preset left the user's last glow state stuck on screen.
- Editor `applyPreset` previously updated `renderConfig.glow` and the
  toggle UI class but never re-applied `glow.intensity`. Now syncs glow +
  rebuilds pupils on preset load.
- **Editor `setRcfgVal` rounding bug** for `step=2` odd-only sliders
  (`meshCols`, `meshRows`): old `Math.round(v/step)*step` shifted every
  saved odd value up by 2 on reload (`9 → 11`, `11 → 13`). User's preset
  with `meshCols=9, meshRows=11` was reloading as `11/13`, distorting the
  face geometry. Fixed by snapping relative to `min`:
  `min + Math.round((v-min)/step)*step`.
- **Editor `applyPreset` rebuild ordering**: boolean fields (`fragment`,
  `mouthHole`, `eyeHoles`, `pupils`) were assigned via direct property
  write inside the iteration loop, which doesn't trigger their
  corresponding rebuild. The mesh therefore reflected the *previous*
  state of those flags. Now `applyPreset` ends with a coordinated
  `rebuildMesh + rebuildPupils + rebuildMinimalLines + applyMinimalSubVisibility`
  so a preset roundtrip is faithful.
- **Per-feature line thickness was a one-frame ghost in WIRE mode**
  (lib + editor). `rebuildMinimalLines` correctly built each tube with
  `radius × featureMul × lineThickness`, but `updateMinimal` (called
  every frame to refresh the tube path) used Babylon's
  `MeshBuilder.CreateTube` *instance form* — which **re-applies
  `opts.radius` on every call**, it does not preserve the construction
  radius. The per-frame `makeTube` invocations passed `featureMul =
  null` (defaulting to 1), so each frame the tube collapsed back to
  `base × 1 × lineThickness`. The per-feature slider's visible effect
  lasted exactly one frame after each rebuild — too brief to see while
  dragging. Fix: `updateMinimal` now passes the current per-feature
  multiplier from config on every call, and `makeTube` always applies
  the multiplier in both new and instance forms. Verified visually in
  WIRE mode at `mouthLineThickness = 0.20` (hairline) vs `4.00` (thick
  bar).

### Added (continued)
- **Editor: `eyeHoleSize` slider** in the EYES panel (was missing from the
  editor UI even though the lib supported it since v1.0.1). Editor's
  rebuildMesh now applies `eyeHoleSize` multiplier to the eye-puncture
  ellipse, matching the lib's behavior. Default `1.0`.

### Changed (continued)
- **Editor UI completely reorganised** per
  [`SPEC.WIREFACE.GRAMMAR.v1.0` §5](SPEC.WIREFACE.GRAMMAR.v1.0.md#5-editor-ui-organisation-target).
  The single oversize "render" panel was split into eight focused panels:
  **MESH · MOUTH · EYES · JAW · OVERLAY · STYLE · COLOURS · MOOD**. Each
  panel groups a single concern. Per-feature overlay controls
  (visibility toggles + thickness sliders) are now interleaved per
  feature for easier scanning. The CHANNELS panel on the left and the
  AUDIO / MOODS / VIEW / SESSION panels are unchanged.

### Documentation
- **`SPEC.WIREFACE.GRAMMAR.v1.0.md`** added — authoritative grammar of
  the runtime: 28 channels, ~50 renderConfig fields, all element types,
  preset format, channel→element drive map, config→pass map, UI
  organisation, invariants, and future-grammar notes. Use this as the
  single source of truth for naming and shape.

---

## [1.0.2] — 2026-05-01

### Fixed
- **`warpToFace` ported verbatim from the v011 editor source.** The previous
  lib version was a rewrite with different math — cosine-product base z
  (peak 0.18) with linear feature falloffs, leaving silhouette vertices at
  z=0. v011's quadratic base z (peak 0.22) plus gaussian feature bumps gives
  a real z-spread of ~0.46, which:
  - restored deep eye sockets (gaussian recess scaled by `eyeDepth` —
    `eyeDepth=5` from the th5rha preset bowls 0.225 deep instead of the old
    tight 0.150 with sharp falloff)
  - made `depthFade` visibly correct — old code put silhouette at z=0 so
    any `depthFade > 0` painted the whole outline pitch black; new range
    gives a smooth front-bright / edge-shaded gradient
  - added chin extension + forehead squash (`yRel` y-remap)
  - added mouth z push and proper cheekbone bumps
- `computeMorphs` drift: `mouth_open_upper` was driven at `p.open` instead
  of `p.open * 0.4` — upper lip was over-aggressive on jaw-open.
- `computeMorphs` drift: negative `browOuterUp` was lumped into `brow_down`
  at `1.0×` instead of v011's `0.6×` branch — angry brows pulled too far.

## [1.0.1] — 2026-05-01

### Fixed
- Eye-hole puncture too small to be visible at typical mesh densities.
  Bumped base ellipse from `0.085 × 0.045` to `0.105 × 0.075` so the cut
  roughly matches the eye feature radius (`0.11`) used elsewhere. ~20 tris
  cut per eye on 21×21 mesh, clearly visible (was ~12, effectively
  invisible).
- `loadPreset` partial-refresh: `rebuildPupils()` now also fires when
  `rc.pupils` changes (was only firing on `rc.irisSize`, so toggling pupils
  off left existing iris/pupil discs floating).

### Added
- `eyeHoleSize` config field (multiplier, default `1.0`) mirroring the
  existing `mouthHoleSize` design.

## [1.0.0] — 2026-05-01

Initial release.

### Added
- `wireface.js` — minimal embeddable wireframe lipsync face renderer.
  Single source file, one peer dep on Babylon.js v9.
- `createWireface(canvas)` factory — fully independent instances, multi-mount
  on the same page.
- 28 expression channels: 15 visemes + jaw/lips/blinks/eye-gaze/squint/
  brows/nose/head rotation.
- 7 mood presets (`neutral`, `happy`, `sad`, `angry`, `fear`, `surprise`,
  `sleep`) with `moodTransitionTime` crossfade.
- `BABYLON.GlowLayer` integration gated by `config.glow`.
- `setRenderConfig` / `getRenderConfig` / `getChannel` getters for editor
  consumption.
- `examples/demo.html` — two-instance side-by-side consumer reference,
  drag-drop preset/audio.
- `examples/editor.html` — full preset authoring UI (currently still
  self-contained; library-consuming rewrite tracked separately).
- `examples/presets/asset-th5rha.json`, `examples/presets/asset-ydr7de.json`
  — bundled sample presets.
- GitHub Actions `publish.yml` — npm publish on `v*` tag push, with SLSA v1
  provenance attestation.
- CDN distribution via jsDelivr + unpkg, both indented (`wireface.js`) and
  minified (`dist/wireface.min.js`) flavors.

[Unreleased]: https://github.com/styk-tv/wireface/compare/v1.1.4...HEAD
[1.1.4]: https://github.com/styk-tv/wireface/compare/v1.1.3...v1.1.4
[1.1.3]: https://github.com/styk-tv/wireface/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/styk-tv/wireface/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/styk-tv/wireface/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/styk-tv/wireface/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/styk-tv/wireface/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/styk-tv/wireface/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/styk-tv/wireface/releases/tag/v1.0.0
