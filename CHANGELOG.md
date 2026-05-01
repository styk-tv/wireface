# Changelog

All notable changes to **wireface** are recorded here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [SemVer](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/styk-tv/wireface/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/styk-tv/wireface/compare/v1.0.2...v1.1.0
[1.0.2]: https://github.com/styk-tv/wireface/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/styk-tv/wireface/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/styk-tv/wireface/releases/tag/v1.0.0
