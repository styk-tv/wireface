/* ============================================================================
 * wireface.js — minimal embeddable lipsync face renderer
 * ----------------------------------------------------------------------------
 * Repository:  https://github.com/styk-tv/wireface
 * npm:         https://www.npmjs.com/package/wireface
 * Copyright (c) 2026 Peter Styk
 * Released under the MIT License — see LICENSE in the repository root.
 * ----------------------------------------------------------------------------
 * Each call to createWireface(canvas, options) builds a fully independent
 * instance: its own Babylon engine + scene, its own audio context, its own
 * channel state, its own materials and meshes. Multiple instances can live on
 * the same page side-by-side without sharing state.
 *
 * Requires: BABYLON.js loaded as a global (e.g. from cdn.babylonjs.com) BEFORE
 * this script is loaded.
 *
 * Public API returned by createWireface:
 *   loadAudio(file_or_blob)       → Promise<void>
 *   loadPreset(presetObject)      → void     (the JSON saved by the v010+ UI)
 *   setRenderConfig(partial)      → void     (apply one or more renderConfig fields)
 *   getRenderConfig()             → object   (snapshot of current config)
 *   play(fromOffset?)             → void
 *   pause()                       → void
 *   stop()                        → void
 *   setMood(name)                 → void     ('neutral','happy','sad','angry','fear','surprise','sleep')
 *   setChannel(name, value)       → void     (manual override, auto-releases ~1.2s)
 *   setChannelGain(name, gain)    → void     (multiplier on channel before render)
 *   getChannel(name)              → number   (current smoothed value)
 *   getChannelTarget(name)        → number   (latest target before smoothing)
 *   getChannelGain(name)          → number
 *   getChannelNames()             → string[]
 *   getMoodNames()                → string[]
 *   setLoop(bool)                 → void
 *   setView(view)                 → void     ('front','three-q','profile','orbit')
 *   isPlaying()                   → bool
 *   getDuration()                 → number   (seconds, 0 if no audio)
 *   getPosition()                 → number   (seconds since start)
 *   getActiveMood()               → string
 *   dispose()                     → void
 * ========================================================================== */

(function (global) {
  'use strict';

  /* ─── module-level constants ─────────────────────────────────────────── */

  const CHANNELS = {
    viseme_sil: { range: [0,1], def: 1.0 }, viseme_PP: { range: [0,1], def: 0 },
    viseme_FF:  { range: [0,1], def: 0 },   viseme_TH: { range: [0,1], def: 0 },
    viseme_DD:  { range: [0,1], def: 0 },   viseme_kk: { range: [0,1], def: 0 },
    viseme_CH:  { range: [0,1], def: 0 },   viseme_SS: { range: [0,1], def: 0 },
    viseme_nn:  { range: [0,1], def: 0 },   viseme_RR: { range: [0,1], def: 0 },
    viseme_aa:  { range: [0,1], def: 0 },   viseme_E:  { range: [0,1], def: 0 },
    viseme_I:   { range: [0,1], def: 0 },   viseme_O:  { range: [0,1], def: 0 },
    viseme_U:   { range: [0,1], def: 0 },
    jawOpen:        { range: [0,1],   def: 0 },
    mouthSmile:     { range: [-1,1],  def: 0 },
    mouthPucker:    { range: [0,1],   def: 0 },
    eyeBlinkLeft:   { range: [0,1],   def: 0 },
    eyeBlinkRight:  { range: [0,1],   def: 0 },
    eyeLookH:       { range: [-1,1],  def: 0 },
    eyeLookV:       { range: [-1,1],  def: 0 },
    eyeSquint:      { range: [0,1],   def: 0 },
    browInnerUp:    { range: [0,1],   def: 0 },
    browOuterUp:    { range: [-1,1],  def: 0 },
    browDown:       { range: [0,1],   def: 0 },
    noseSneer:      { range: [0,1],   def: 0 },
    headRotateX:    { range: [-1,1],  def: 0 },
    headRotateY:    { range: [-1,1],  def: 0 },
    headRotateZ:    { range: [-1,1],  def: 0 },
  };
  const CHANNEL_NAMES = Object.keys(CHANNELS);

  const VISEME_PARAMS = {
    sil: { open: 0.00, width: 0.00, round: 0.00, smile: 0.00, lipPress: 0.30, jaw: 0.00 },
    PP:  { open: 0.00, width: 0.00, round: 0.20, smile: 0.00, lipPress: 0.95, jaw: 0.00 },
    FF:  { open: 0.10, width: 0.05, round: 0.00, smile: 0.05, lipPress: 0.55, jaw: 0.10 },
    TH:  { open: 0.20, width: 0.15, round: 0.00, smile: 0.00, lipPress: 0.10, jaw: 0.18 },
    DD:  { open: 0.28, width: 0.25, round: 0.00, smile: 0.05, lipPress: 0.05, jaw: 0.25 },
    kk:  { open: 0.32, width: 0.20, round: 0.00, smile: 0.00, lipPress: 0.05, jaw: 0.30 },
    CH:  { open: 0.32, width: 0.00, round: 0.55, smile: 0.00, lipPress: 0.10, jaw: 0.25 },
    SS:  { open: 0.18, width: 0.45, round: 0.00, smile: 0.20, lipPress: 0.20, jaw: 0.10 },
    nn:  { open: 0.18, width: 0.18, round: 0.00, smile: 0.00, lipPress: 0.30, jaw: 0.18 },
    RR:  { open: 0.35, width: 0.00, round: 0.50, smile: 0.00, lipPress: 0.05, jaw: 0.25 },
    aa:  { open: 0.85, width: 0.45, round: 0.00, smile: 0.00, lipPress: 0.00, jaw: 0.85 },
    E:   { open: 0.50, width: 0.65, round: 0.00, smile: 0.20, lipPress: 0.00, jaw: 0.45 },
    I:   { open: 0.28, width: 0.85, round: 0.00, smile: 0.30, lipPress: 0.00, jaw: 0.18 },
    O:   { open: 0.55, width: 0.00, round: 0.75, smile: 0.00, lipPress: 0.00, jaw: 0.45 },
    U:   { open: 0.35, width: -0.15, round: 0.95, smile: 0.00, lipPress: 0.05, jaw: 0.25 },
  };

  const MOODS = {
    neutral: { browInnerUp: 0, browOuterUp: 0, browDown: 0, mouthSmile: 0, eyeSquint: 0 },
    happy:   { browOuterUp: 0.4, mouthSmile: 0.7, eyeSquint: 0.25 },
    sad:     { browInnerUp: 0.7, browDown: 0.2, mouthSmile: -0.5, eyeBlinkLeft: 0.15, eyeBlinkRight: 0.15 },
    angry:   { browInnerUp: 0, browOuterUp: -0.4, browDown: 0.7, mouthSmile: -0.4, noseSneer: 0.5, eyeSquint: 0.4 },
    fear:    { browInnerUp: 0.7, browOuterUp: 0.5, mouthSmile: -0.3, eyeBlinkLeft: -0.2, eyeBlinkRight: -0.2 },
    surprise:{ browInnerUp: 0.6, browOuterUp: 0.8, jawOpen: 0.5, mouthSmile: 0 },
    sleep:   { eyeBlinkLeft: 1, eyeBlinkRight: 1, browDown: 0.3, mouthSmile: 0 },
  };
  const MOOD_NAMES = Object.keys(MOODS);
  const MOOD_CHANNELS = ['browInnerUp','browOuterUp','browDown','mouthSmile',
                         'eyeSquint','noseSneer','eyeBlinkLeft','eyeBlinkRight'];

  const SMOOTH = {
    default: 0.35,
    eyeBlinkLeft: 0.55, eyeBlinkRight: 0.55,
    ...Object.fromEntries(Object.keys(VISEME_PARAMS).map(v => ['viseme_' + v, 0.45])),
    browInnerUp: 0.18, browOuterUp: 0.18, browDown: 0.18,
    headRotateX: 0.10, headRotateY: 0.10, headRotateZ: 0.10,
    eyeLookH: 0.25, eyeLookV: 0.25,
  };

  /* SHAPES table — fields use plain arrays for direction so we don't need
     BABYLON at module-init time. They're converted to Vector3 inside the
     factory. */
  const SHAPE_DEFS = {
    mouth_jaw_drop:    { uv:[0.50, 0.78], d:[ 0.00,-0.20,-0.02], r: 0.28 },
    mouth_open_lower:  { uv:[0.50, 0.71], d:[ 0.00,-0.10, 0.00], r: 0.16 },
    mouth_open_upper:  { uv:[0.50, 0.66], d:[ 0.00, 0.04, 0.00], r: 0.13 },
    mouth_smile_L:     { uv:[0.32, 0.69], d:[-0.06, 0.07,-0.02], r: 0.13 },
    mouth_smile_R:     { uv:[0.68, 0.69], d:[ 0.06, 0.07,-0.02], r: 0.13 },
    mouth_frown_L:     { uv:[0.32, 0.69], d:[ 0.02,-0.07, 0.00], r: 0.13 },
    mouth_frown_R:     { uv:[0.68, 0.69], d:[-0.02,-0.07, 0.00], r: 0.13 },
    mouth_round_L:     { uv:[0.32, 0.69], d:[ 0.07, 0.00, 0.03], r: 0.13 },
    mouth_round_R:     { uv:[0.68, 0.69], d:[-0.07, 0.00, 0.03], r: 0.13 },
    mouth_round_top:   { uv:[0.50, 0.66], d:[ 0.00,-0.02, 0.04], r: 0.12 },
    mouth_round_bot:   { uv:[0.50, 0.71], d:[ 0.00, 0.02, 0.04], r: 0.12 },
    mouth_press_top:   { uv:[0.50, 0.66], d:[ 0.00,-0.025,0.00], r: 0.12 },
    mouth_press_bot:   { uv:[0.50, 0.71], d:[ 0.00, 0.025,0.00], r: 0.12 },
    mouth_width_L:     { uv:[0.32, 0.69], d:[-0.05, 0.00, 0.00], r: 0.13 },
    mouth_width_R:     { uv:[0.68, 0.69], d:[ 0.05, 0.00, 0.00], r: 0.13 },
    eye_blink_L_up:    { uv:[0.30, 0.36], d:[ 0.00,-0.05,-0.02], r: 0.08 },
    eye_blink_L_lo:    { uv:[0.30, 0.45], d:[ 0.00, 0.03, 0.00], r: 0.08 },
    eye_blink_R_up:    { uv:[0.70, 0.36], d:[ 0.00,-0.05,-0.02], r: 0.08 },
    eye_blink_R_lo:    { uv:[0.70, 0.45], d:[ 0.00, 0.03, 0.00], r: 0.08 },
    eye_squint_L:      { uv:[0.30, 0.42], d:[ 0.00,-0.015,0.00], r: 0.10 },
    eye_squint_R:      { uv:[0.70, 0.42], d:[ 0.00,-0.015,0.00], r: 0.10 },
    brow_inner_L:      { uv:[0.42, 0.25], d:[ 0.00, 0.06, 0.02], r: 0.10 },
    brow_inner_R:      { uv:[0.58, 0.25], d:[ 0.00, 0.06, 0.02], r: 0.10 },
    brow_outer_L:      { uv:[0.20, 0.27], d:[ 0.00, 0.05, 0.00], r: 0.12 },
    brow_outer_R:      { uv:[0.80, 0.27], d:[ 0.00, 0.05, 0.00], r: 0.12 },
    brow_down_L:       { uv:[0.30, 0.27], d:[ 0.00,-0.05, 0.00], r: 0.14 },
    brow_down_R:       { uv:[0.70, 0.27], d:[ 0.00,-0.05, 0.00], r: 0.14 },
    nose_sneer_L:      { uv:[0.42, 0.55], d:[ 0.00, 0.03, 0.02], r: 0.08 },
    nose_sneer_R:      { uv:[0.58, 0.55], d:[ 0.00, 0.03, 0.02], r: 0.08 },
  };

  const DEFAULT_CONFIG = {
    mode: 'wire',          // 'wire' | 'edges' | 'shaded'
    meshCols: 17,
    meshRows: 21,
    spread: 1.0,
    reactivity: 0.25,
    scaleNose: 1.0, scaleEyes: 1.0, scaleMouth: 1.0,
    flipFace: true,
    glow: false,
    pupils: true,
    fragment: true,
    minimal: true,
    meshVisible: true,
    loopAudio: true,
    mouthHole: true, mouthHoleSize: 1.0,
    eyeHoles: false, eyeHoleSize: 1.0, eyeDepth: 1.0,
    mouthAnchor: true, eyeAnchor: false,
    lineThickness: 1.0,
    lipVertAmp: 1.6, lipPressForce: 1.0,
    overlayTracksMesh: true,
    moodTransitionTime: 0.6,
    lineColor: '#ffffff', pupilColor: '#ffffff',
    // Per-feature minimal-line overrides. null = inherit lineColor (backward
    // compat with v1.0.x presets). Each feature can be hidden individually
    // even when the master `minimal` is on. Each has its own thickness
    // multiplier on top of the global `lineThickness`.
    mouthColor: null, eyeColor: null, noseColor: null,
    minimalMouth: true, minimalEyes: true, minimalNose: true, minimalBrows: true,
    mouthLineThickness: 1.0, eyeLineThickness: 1.0, noseLineThickness: 1.0, browLineThickness: 1.0,
    baseColor: '#ffffff', fadeColor: '#000000', depthFade: 0.0,
    // exponent applied to the per-vertex fade weight. >1 darkens the back
    // faster (so silhouette edges actually reach fadeColor in wire mode);
    // <1 brightens it. 1.0 = linear, original behavior.
    depthFadeCurve: 1.0,
    irisColor: '#000000', irisSize: 1.6,
    browColor: '#ffffff',
    jawExtend: 0.0, mouthGrow: 0.0,
    // experimental — static z push of upper-mouth and lower-jaw regions for
    // animal / crocodile-mouth distortions. Stack on top of jawExtend (which
    // is jawOpen-driven). Default 0 = current behavior.
    upperJawProtrude: 0.0, lowerJawProtrude: 0.0,
    cameraView: 'three-q', // initial view
  };

  /* ─── module helpers ─────────────────────────────────────────────────── */

  function hex2rgb(hex) {
    const h = (hex || '#ffffff').replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  /* ──────────────────────────────────────────────────────────────────────
   *                          F A C T O R Y
   * ────────────────────────────────────────────────────────────────────── */

  function createWireface(canvas, options) {
    if (typeof BABYLON === 'undefined') {
      throw new Error('wireface: BABYLON.js not loaded — include babylon.js before wireface.js');
    }

    const config = Object.assign({}, DEFAULT_CONFIG, options || {});
    const V = (x, y, z) => new BABYLON.Vector3(x, y, z);

    /* convert SHAPE_DEFS → SHAPES with Vector3 directions */
    const SHAPES = {};
    for (const k of Object.keys(SHAPE_DEFS)) {
      const s = SHAPE_DEFS[k];
      SHAPES[k] = { uv: s.uv, dir: V(s.d[0], s.d[1], s.d[2]), radius: s.r };
    }

    /* ── per-instance state ── */
    const state = {};
    const stateTarget = {};
    const manualLock = {};
    const channelGains = {};
    CHANNEL_NAMES.forEach(n => {
      state[n] = CHANNELS[n].def;
      stateTarget[n] = CHANNELS[n].def;
      channelGains[n] = 1.0;
    });

    const moodTargetWeights = {};
    const moodCurrentWeights = {};
    for (const m of MOOD_NAMES) {
      moodTargetWeights[m] = 0;
      moodCurrentWeights[m] = 0;
    }
    moodTargetWeights.neutral = 1;
    moodCurrentWeights.neutral = 1;
    let activeMood = 'neutral';

    /* ── Babylon scene ── */
    const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: false, stencil: false, antialias: true });
    // v1.1.2: useRightHandedSystem MUST be set via Scene constructor options
    // (not by post-construction property assignment) — the post-assign path
    // gets silently no-op'd somewhere in Babylon 9.5's scene init pipeline,
    // so the scene boots in LH despite our request. The constructor option
    // sticks. Verified empirically with playwright: post-assign showed
    // `scene.useRightHandedSystem === false` at first frame, but options-form
    // shows true.
    //
    // Why we want RH at all: Babylon's LH default puts +Z into the screen.
    // warpToFace builds the face with +Z = nose-forward, so in LH the face
    // would render facing AWAY from the default ArcRotateCamera at -Z (user
    // sees back of head, profile shows wrong side). RH flips Z so +Z is
    // out-of-screen, geometry naturally faces the camera, and the camera
    // view alphas (front=-π/2, profile=0, three-q=-π/2-0.6) map to the
    // conventionally-correct sides of the face — front shows the front,
    // profile shows the face's right, three-quarter is a proper portrait
    // angle. No geometry change, no faceRoot.rotation flip, no view-alpha
    // rewiring.
    const scene = new BABYLON.Scene(engine, { useRightHandedSystem: true });
    scene.useRightHandedSystem = true;  // belt and braces — also assign post-ctor
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);
    // we never pick on pointer-move; saves a per-frame ray test
    scene.skipPointerMovePicking = true;

    /* glow layer — bloom on the emissive wire/overlay/iris materials. Gated by
       config.glow; intensity 0 disables it. Created once and toggled, not
       added/removed per frame. */
    const glowLayer = new BABYLON.GlowLayer('glow', scene, { mainTextureFixedSize: 1024, blurKernelSize: 32 });
    glowLayer.intensity = 0;

    const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI/2 - 0.6, Math.PI/2 - 0.15, 4.0, BABYLON.Vector3.Zero(), scene);
    camera.minZ = 0.1; camera.maxZ = 100;
    camera.lowerRadiusLimit = 1.5; camera.upperRadiusLimit = 12;
    camera.wheelDeltaPercentage = 0.01;
    // sandboxed iframes can throw on getGamepads — neutralize
    const _origGet = navigator.getGamepads;
    try { navigator.getGamepads = () => []; } catch (_) {}
    camera.attachControl(canvas, true);
    try { navigator.getGamepads = _origGet; } catch (_) {}

    const hemi = new BABYLON.HemisphericLight('h', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 0.9;
    hemi.groundColor = new BABYLON.Color3(0.10, 0.10, 0.14);

    const faceRoot = new BABYLON.TransformNode('faceRoot', scene);

    /* ── materials ── */
    const faceMat = new BABYLON.StandardMaterial('faceMat', scene);
    faceMat.diffuseColor  = new BABYLON.Color3(0.05, 0.05, 0.07);
    faceMat.emissiveColor = new BABYLON.Color3(0.012, 0.012, 0.020);
    faceMat.specularColor = new BABYLON.Color3(0.20, 0.22, 0.28);
    faceMat.specularPower = 48;
    faceMat.backFaceCulling = false;
    faceMat.useVertexColor = true;

    const wireMat = new BABYLON.StandardMaterial('wireMat', scene);
    wireMat.emissiveColor = new BABYLON.Color3(1, 1, 1);
    wireMat.disableLighting = true;
    wireMat.wireframe = true;
    wireMat.backFaceCulling = false;
    wireMat.alpha = 1;
    wireMat.useVertexColor = true;

    /* one material per minimal-line feature so each can have its own color
       independent of the others. lineColor is the shared fallback; if a
       per-feature color (mouthColor/eyeColor/noseColor) is null the feature
       inherits lineColor at apply time. */
    function makeMinimalMat(name) {
      const m = new BABYLON.StandardMaterial(name, scene);
      m.emissiveColor = new BABYLON.Color3(1, 1, 1);
      m.disableLighting = true;
      m.specularColor = new BABYLON.Color3(0, 0, 0);
      return m;
    }
    const mouthMat = makeMinimalMat('mouthMat');
    const eyeMat   = makeMinimalMat('eyeMat');
    const noseMat  = makeMinimalMat('noseMat');
    const browMat  = makeMinimalMat('browMat');
    // legacy alias — some downstream code still references minimalMat
    const minimalMat = mouthMat;

    const minimalGroup = new BABYLON.TransformNode('minimal', scene);
    minimalGroup.parent = faceRoot;

    /* ─── 4a. parametric warp: grid (u,v) → face surface (x,y,z) ───
       Ported verbatim from the v011 editor. Uses an elliptical taper so the
       silhouette is oval, not rectangular. Then layers feature bumps (eye
       sockets, brow ridge, nose, mouth, cheeks) as gaussian falloffs in
       xRel/yRel space (xRel = (u-0.5)*2, yRel = (0.5-v)*2). This shape's
       z-range (≈0.10..0.30) is what lets depthFade produce a visible
       gradient instead of pinning the silhouette to black. */
    function warpToFace(u, v) {
      const xRel = (u - 0.5) * 2;     // -1..1 left to right
      const yRel = (0.5 - v) * 2;     //  1..-1 top to bottom

      // strong elliptical taper — boundary of the grid maps to an oval
      const yNorm = yRel * 0.95;
      const ovalT = Math.max(0, 1 - yNorm * yNorm);
      const widthAtY = Math.sqrt(ovalT) * 0.80;
      let x = xRel * widthAtY;

      // y stays linear; chin extends + forehead squashes
      let y = yRel * 1.0;
      if (yRel < -0.4) y = -0.4 + (yRel + 0.4) * 1.55;
      if (yRel >  0.7) y =  0.7 + (yRel - 0.7) * 0.45;

      // base z bulge — quadratic falloff from center
      let z = (1 - xRel*xRel * 0.55 - yRel*yRel * 0.55) * 0.22;
      if (z < -0.05) z = -0.05;

      // eye sockets recess (gaussian — broad and bowl-shaped).
      // Centered at yRel=0.20 → UV v=0.40 to align with the eye opening
      // (eye-hole puncture, minimal-line eyelid overlay, eye_blink shapes
      // are all at v=0.40). Original v011 used yRel=0.30 which placed the
      // bowl above the eye opening.
      const eyeY = 0.20;
      const eyeL_d = ((xRel + 0.45) / 0.30) ** 2 + ((yRel - eyeY) / 0.18) ** 2;
      const eyeR_d = ((xRel - 0.45) / 0.30) ** 2 + ((yRel - eyeY) / 0.18) ** 2;
      const eyeRecess = 0.045 * config.eyeDepth;
      z -= eyeRecess * Math.exp(-eyeL_d);
      z -= eyeRecess * Math.exp(-eyeR_d);

      // brow ridge bumps forward
      const brow_d = (xRel / 0.7) ** 2 + ((yRel - 0.55) / 0.10) ** 2;
      z += 0.045 * Math.exp(-brow_d);

      // nose — the dominant z bump
      const nose_d = (xRel / 0.18) ** 2 + ((yRel - 0.05) / 0.40) ** 2;
      z += 0.22 * Math.exp(-nose_d);

      // mouth area pushed slightly forward
      const mouth_d = (xRel / 0.55) ** 2 + ((yRel + 0.45) / 0.20) ** 2;
      z += 0.06 * Math.exp(-mouth_d);

      // cheekbones
      const cheekL_d = ((xRel + 0.55) / 0.30) ** 2 + ((yRel - 0.05) / 0.28) ** 2;
      const cheekR_d = ((xRel - 0.55) / 0.30) ** 2 + ((yRel - 0.05) / 0.28) ** 2;
      z += 0.04 * Math.exp(-cheekL_d);
      z += 0.04 * Math.exp(-cheekR_d);

      return V(x, y, z);
    }

    /* mouth center constants */
    const mouthCenterUV = warpToFace(0.50, 0.69);
    const mouthBaseHW = 0.27;

    /* lip target — SAME formula used by both the bezier overlay and the mesh
       anchor pass so they animate identically */
    function lipTarget(xRel, isUpper, p) {
      const cx = mouthCenterUV.x, cy = mouthCenterUV.y, cz = mouthCenterUV.z;
      const hw = mouthBaseHW * (1 + p.width * 0.40) * (1 - p.round * 0.40);
      const vAmp = config.lipVertAmp;
      const closeF = config.lipPressForce;
      const sep = p.open * 0.16 * vAmp;
      const compress = p.lipPress * 0.012 * vAmp * closeF;
      const jawDrop = p.jaw * 0.09 * vAmp;
      const smileLift = p.smile * 0.05;
      const roundFwd = p.round * 0.07;
      const upperDip = 0.007 * (1 - p.lipPress * 0.55);
      const lowerDip = 0.022 * (1 - p.lipPress * 0.55);
      let cp;
      if (isUpper) {
        const upperY = cy + sep / 2 - compress + smileLift * 0.4;
        cp = [
          [-1.00, cy + smileLift,    -roundFwd * 0.5],
          [-0.45, upperY + 0.012,     0.012],
          [ 0.00, upperY - upperDip,  0.018 + roundFwd],
          [ 0.45, upperY + 0.012,     0.012],
          [ 1.00, cy + smileLift,    -roundFwd * 0.5],
        ];
      } else {
        const lowerY = cy - sep / 2 + compress - jawDrop;
        cp = [
          [-1.00, cy + smileLift,        -roundFwd * 0.5],
          [-0.50, lowerY - 0.005,         0.014],
          [ 0.00, lowerY - lowerDip,      0.022 + roundFwd * 1.1],
          [ 0.50, lowerY - 0.005,         0.014],
          [ 1.00, cy + smileLift,        -roundFwd * 0.5],
        ];
      }
      xRel = Math.max(-1, Math.min(1, xRel));
      let i = 0;
      while (i < cp.length - 1 && xRel > cp[i + 1][0]) i++;
      i = Math.min(i, cp.length - 2);
      const t = (xRel - cp[i][0]) / (cp[i + 1][0] - cp[i][0]);
      const yT = cp[i][1] * (1 - t) + cp[i + 1][1] * t;
      const zO = cp[i][2] * (1 - t) + cp[i + 1][2] * t;
      return V(cx + xRel * hw, yT, cz + zO);
    }

    function eyeLidTargetFor(xRel, isUpper, eyeDef, blink, squint) {
      const a = ((xRel + 1) / 2) * Math.PI;
      const x = eyeDef.center.x + Math.cos(Math.PI - a) * eyeDef.hw;
      const baseY = eyeDef.center.y + (isUpper ? 1 : -1) * Math.sin(a) * eyeDef.hh;
      const y = baseY * (1 - blink) + eyeDef.center.y * blink;
      const squintShift = squint * 0.012;
      const yWithSquint = y + (isUpper ? -squintShift : squintShift * 0.5);
      const z = eyeDef.center.z + 0.018 + Math.sin(a) * 0.012;
      return V(x, yWithSquint, z);
    }

    /* ── viseme aggregator ── */
    function computeMouthParams() {
      let totalW = 0;
      const out = { open: 0, width: 0, round: 0, smile: 0, lipPress: 0, jaw: 0 };
      for (const v of Object.keys(VISEME_PARAMS)) {
        const w = state['viseme_' + v] || 0;
        if (w <= 0) continue;
        totalW += w;
        const p = VISEME_PARAMS[v];
        out.open += p.open * w; out.width += p.width * w; out.round += p.round * w;
        out.smile += p.smile * w; out.lipPress += p.lipPress * w; out.jaw += p.jaw * w;
      }
      if (totalW > 1) {
        const k = 1 / totalW;
        out.open *= k; out.width *= k; out.round *= k;
        out.smile *= k; out.lipPress *= k; out.jaw *= k;
      }
      out.smile += state.mouthSmile;
      const pucker = state.mouthPucker;
      out.round += pucker * 0.7; out.width += -pucker * 0.4;
      out.open += state.jawOpen * 0.6;
      out.jaw  += state.jawOpen * 0.7;
      return out;
    }

    /* ── mesh state (per instance) ── */
    let mesh = null;
    let baseVertices = [];
    let baseUVs = [];
    let triIndices = [];
    let adjacency = [];
    let _dispBuf = null, _posBuf = null, _normBuf = null, _colBuf = null;
    let _zMin = 0, _zMax = 0;
    let _baseRGB = [1,1,1], _fadeRGB = [0,0,0];
    let _dirtyBaseColor = false;

    let mouthRingVerts = [];
    let eyeRingVerts = [];

    const NEUTRAL_MOUTH = { open: 0, width: 0, round: 0, smile: 0, lipPress: 0.30, jaw: 0 };

    function computeAdjacency(tris, n) {
      const adj = Array.from({ length: n }, () => new Set());
      for (let i = 0; i < tris.length; i += 3) {
        const a = tris[i], b = tris[i+1], c = tris[i+2];
        adj[a].add(b); adj[a].add(c);
        adj[b].add(a); adj[b].add(c);
        adj[c].add(a); adj[c].add(b);
      }
      return adj.map(s => Array.from(s));
    }

    function rebuildMesh() {
      if (mesh) { mesh.dispose(); mesh = null; }
      const cols = config.meshCols;
      const rows = config.meshRows;
      baseVertices = []; baseUVs = []; triIndices = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u = c / (cols - 1);
          const v = r / (rows - 1);
          baseUVs.push({ u, v });
          baseVertices.push(warpToFace(u, v));
        }
      }
      // optional oval clip
      const passes = (i) => {
        if (!config.fragment) return true;
        const u = baseUVs[i].u, v = baseUVs[i].v;
        const xRel = (u - 0.5) * 2;
        const yRel = (0.5 - v) * 2;
        return (xRel * xRel * 1.2 + yRel * yRel * 0.95) < 1.0;
      };
      const insideHole = (i, cu, cv, ru, rv) => {
        const du = (baseUVs[i].u - cu) / ru;
        const dv = (baseUVs[i].v - cv) / rv;
        return du*du + dv*dv < 1;
      };
      const triAllowed = (a, b, c) => {
        if (!passes(a) || !passes(b) || !passes(c)) return false;
        if (config.mouthHole) {
          const cu = 0.50, cv = 0.69;
          const ru = 0.18 * config.mouthHoleSize, rv = 0.075 * config.mouthHoleSize;
          // skip if centroid is inside the mouth ellipse
          const ucen = (baseUVs[a].u + baseUVs[b].u + baseUVs[c].u) / 3;
          const vcen = (baseUVs[a].v + baseUVs[b].v + baseUVs[c].v) / 3;
          const du = (ucen - cu) / ru, dv = (vcen - cv) / rv;
          if (du*du + dv*dv < 1) return false;
        }
        if (config.eyeHoles) {
          // eye-hole ellipse — sized to roughly match the eye feature radius
          // so the cut is visibly meaningful at typical mesh densities.
          // eyeHoleSize is a multiplier (mirrors mouthHoleSize).
          const eRU = 0.105 * config.eyeHoleSize;
          const eRV = 0.075 * config.eyeHoleSize;
          const ucen = (baseUVs[a].u + baseUVs[b].u + baseUVs[c].u) / 3;
          const vcen = (baseUVs[a].v + baseUVs[b].v + baseUVs[c].v) / 3;
          const dl = ((ucen-0.30)/eRU)**2 + ((vcen-0.40)/eRV)**2;
          const dr = ((ucen-0.70)/eRU)**2 + ((vcen-0.40)/eRV)**2;
          if (dl < 1 || dr < 1) return false;
        }
        return true;
      };
      const maybeAdd = (a, b, c) => { if (triAllowed(a,b,c)) triIndices.push(a, b, c); };
      for (let r = 0; r < rows - 1; r++) {
        for (let c = 0; c < cols - 1; c++) {
          const i00 = r*cols + c, i10 = r*cols + (c+1);
          const i01 = (r+1)*cols + c, i11 = (r+1)*cols + (c+1);
          if ((r + c) % 2 === 0) { maybeAdd(i00, i10, i11); maybeAdd(i00, i11, i01); }
          else { maybeAdd(i00, i10, i01); maybeAdd(i10, i11, i01); }
        }
      }
      adjacency = computeAdjacency(triIndices, baseVertices.length);
      mesh = new BABYLON.Mesh('face', scene);
      mesh.parent = faceRoot;
      const N = baseVertices.length;
      _posBuf  = new Float32Array(N * 3);
      _normBuf = new Float32Array(N * 3);
      _colBuf  = new Float32Array(N * 4);
      _dispBuf = new Array(N);
      _zMin = +Infinity; _zMax = -Infinity;
      for (let i = 0; i < N; i++) {
        _posBuf[3*i]   = baseVertices[i].x;
        _posBuf[3*i+1] = baseVertices[i].y;
        _posBuf[3*i+2] = baseVertices[i].z;
        if (baseVertices[i].z < _zMin) _zMin = baseVertices[i].z;
        if (baseVertices[i].z > _zMax) _zMax = baseVertices[i].z;
        _dispBuf[i] = V(0, 0, 0);
        _colBuf[4*i] = 1; _colBuf[4*i+1] = 1; _colBuf[4*i+2] = 1; _colBuf[4*i+3] = 1;
      }
      BABYLON.VertexData.ComputeNormals(_posBuf, triIndices, _normBuf);
      const vd = new BABYLON.VertexData();
      vd.positions = Array.from(_posBuf);
      vd.indices   = triIndices;
      vd.normals   = Array.from(_normBuf);
      vd.colors    = Array.from(_colBuf);
      vd.applyToMesh(mesh, true);
      applyRenderMode(); applyFaceFlip(); applyMeshVisibility();
      identifyAnchorRings();
      _dirtyBaseColor = true;
    }

    function identifyAnchorRings() {
      mouthRingVerts = []; eyeRingVerts = [];
      const mRU = 0.18 * config.mouthHoleSize;
      const mRV = 0.075 * config.mouthHoleSize;
      const mCU = 0.50, mCV = 0.69;
      for (let i = 0; i < baseUVs.length; i++) {
        const du = (baseUVs[i].u - mCU) / mRU;
        const dv = (baseUVs[i].v - mCV) / mRV;
        const d2 = du*du + dv*dv;
        if (d2 < 4) {
          const isUpper = baseUVs[i].v < mCV;
          const xRel = Math.max(-1, Math.min(1, du));
          let weight = (d2 <= 1) ? d2 : (4 - d2) / 3;
          weight = Math.max(0, Math.min(1, weight));
          mouthRingVerts.push({
            idx: i, isUpper, xRel, weight,
            baselineTarget: lipTarget(xRel, isUpper, NEUTRAL_MOUTH)
          });
        }
      }
      const eyeRingDef = [
        { side: 'L', cu: 0.30, cv: 0.40, ru: 0.085, rv: 0.045, hw: 0.10, hh: 0.040 },
        { side: 'R', cu: 0.70, cv: 0.40, ru: 0.085, rv: 0.045, hw: 0.10, hh: 0.040 },
      ];
      for (const e of eyeRingDef) {
        for (let i = 0; i < baseUVs.length; i++) {
          const du = (baseUVs[i].u - e.cu) / e.ru;
          const dv = (baseUVs[i].v - e.cv) / e.rv;
          const d2 = du*du + dv*dv;
          if (d2 < 4) {
            const isUpper = baseUVs[i].v < e.cv;
            const xRel = Math.max(-1, Math.min(1, du));
            let weight = (d2 <= 1) ? d2 : (4 - d2) / 3;
            weight = Math.max(0, Math.min(1, weight));
            const center = warpToFace(e.cu, e.cv);
            eyeRingVerts.push({
              idx: i, side: e.side, isUpper, xRel, weight,
              eyeDef: { center, hw: e.hw, hh: e.hh },
              baselineTarget: eyeLidTargetFor(xRel, isUpper, { center, hw: e.hw, hh: e.hh }, 0, 0)
            });
          }
        }
      }
    }

    /* ── displacement passes ── */
    function applyShape(disp, shape, weight, spread) {
      if (Math.abs(weight) < 0.001) return;
      const cu = shape.uv[0], cv = shape.uv[1];
      const r = shape.radius * spread;
      const r2 = r * r;
      const dx = shape.dir.x * weight, dy = shape.dir.y * weight, dz = shape.dir.z * weight;
      for (let i = 0; i < baseUVs.length; i++) {
        const du = baseUVs[i].u - cu;
        const dv = baseUVs[i].v - cv;
        const d2 = du*du + dv*dv;
        if (d2 > 4 * r2) continue;
        const w = Math.exp(-d2 / r2);
        disp[i].x += dx * w; disp[i].y += dy * w; disp[i].z += dz * w;
      }
    }

    function computeMorphs(disp) {
      const spread = config.spread;
      const p = computeMouthParams();
      // mouth
      applyShape(disp, SHAPES.mouth_jaw_drop,    p.jaw,         spread);
      applyShape(disp, SHAPES.mouth_open_lower,  p.open,        spread);
      applyShape(disp, SHAPES.mouth_open_upper,  p.open * 0.4,  spread);
      const sm = p.smile;
      if (sm > 0) { applyShape(disp, SHAPES.mouth_smile_L, sm, spread); applyShape(disp, SHAPES.mouth_smile_R, sm, spread); }
      else if (sm < 0) { applyShape(disp, SHAPES.mouth_frown_L, -sm, spread); applyShape(disp, SHAPES.mouth_frown_R, -sm, spread); }
      applyShape(disp, SHAPES.mouth_round_L,   p.round, spread);
      applyShape(disp, SHAPES.mouth_round_R,   p.round, spread);
      applyShape(disp, SHAPES.mouth_round_top, p.round, spread);
      applyShape(disp, SHAPES.mouth_round_bot, p.round, spread);
      applyShape(disp, SHAPES.mouth_press_top, p.lipPress, spread);
      applyShape(disp, SHAPES.mouth_press_bot, p.lipPress, spread);
      if (p.width > 0) {
        applyShape(disp, SHAPES.mouth_width_L,  p.width, spread);
        applyShape(disp, SHAPES.mouth_width_R,  p.width, spread);
      }
      // eyes
      applyShape(disp, SHAPES.eye_blink_L_up, state.eyeBlinkLeft,  spread);
      applyShape(disp, SHAPES.eye_blink_L_lo, state.eyeBlinkLeft,  spread);
      applyShape(disp, SHAPES.eye_blink_R_up, state.eyeBlinkRight, spread);
      applyShape(disp, SHAPES.eye_blink_R_lo, state.eyeBlinkRight, spread);
      applyShape(disp, SHAPES.eye_squint_L,   state.eyeSquint,     spread);
      applyShape(disp, SHAPES.eye_squint_R,   state.eyeSquint,     spread);
      // brows
      applyShape(disp, SHAPES.brow_inner_L,  state.browInnerUp,    spread);
      applyShape(disp, SHAPES.brow_inner_R,  state.browInnerUp,    spread);
      // v011: browOuterUp >= 0 lifts outer brow; < 0 drives brow_down at 0.6x
      if (state.browOuterUp >= 0) {
        applyShape(disp, SHAPES.brow_outer_L,  state.browOuterUp,         spread);
        applyShape(disp, SHAPES.brow_outer_R,  state.browOuterUp,         spread);
      } else {
        applyShape(disp, SHAPES.brow_down_L,   -state.browOuterUp * 0.6,  spread);
        applyShape(disp, SHAPES.brow_down_R,   -state.browOuterUp * 0.6,  spread);
      }
      applyShape(disp, SHAPES.brow_down_L,   state.browDown,              spread);
      applyShape(disp, SHAPES.brow_down_R,   state.browDown,              spread);
      // nose
      applyShape(disp, SHAPES.nose_sneer_L,  state.noseSneer,      spread);
      applyShape(disp, SHAPES.nose_sneer_R,  state.noseSneer,      spread);
    }

    function couple(disp, factor) {
      if (factor <= 0) return;
      const N = disp.length;
      const out = new Array(N);
      for (let i = 0; i < N; i++) {
        const adj = adjacency[i];
        if (adj.length === 0) { out[i] = V(disp[i].x, disp[i].y, disp[i].z); continue; }
        let sx = 0, sy = 0, sz = 0;
        for (const j of adj) { sx += disp[j].x; sy += disp[j].y; sz += disp[j].z; }
        sx /= adj.length; sy /= adj.length; sz /= adj.length;
        out[i] = V(
          disp[i].x * (1 - factor) + sx * factor,
          disp[i].y * (1 - factor) + sy * factor,
          disp[i].z * (1 - factor) + sz * factor,
        );
      }
      for (let i = 0; i < N; i++) { disp[i].x = out[i].x; disp[i].y = out[i].y; disp[i].z = out[i].z; }
    }

    const FEATURE_CENTERS = [
      { name: 'nose',  uv: [0.50, 0.50], radiusUV: 0.16, get scale() { return config.scaleNose;  } },
      { name: 'eyeL',  uv: [0.30, 0.40], radiusUV: 0.11, get scale() { return config.scaleEyes;  } },
      { name: 'eyeR',  uv: [0.70, 0.40], radiusUV: 0.11, get scale() { return config.scaleEyes;  } },
      { name: 'mouth', uv: [0.50, 0.70], radiusUV: 0.18, get scale() { return config.scaleMouth; } },
    ];

    function applyFeatureScales(disp) {
      for (const f of FEATURE_CENTERS) {
        const s = f.scale;
        if (Math.abs(s - 1) < 0.001) continue;
        const center = warpToFace(f.uv[0], f.uv[1]);
        const r2 = f.radiusUV * f.radiusUV;
        const cutoff = r2 * 4;
        for (let i = 0; i < baseUVs.length; i++) {
          const du = baseUVs[i].u - f.uv[0];
          const dv = baseUVs[i].v - f.uv[1];
          const d2 = du*du + dv*dv;
          if (d2 > cutoff) continue;
          const w = Math.exp(-d2 / r2);
          const ox = baseVertices[i].x - center.x;
          const oy = baseVertices[i].y - center.y;
          const oz = baseVertices[i].z - center.z;
          const k = (s - 1) * w;
          disp[i].x += ox * k; disp[i].y += oy * k; disp[i].z += oz * k;
        }
      }
    }

    function applyJawExtension(disp) {
      const amt = config.jawExtend;
      if (amt < 0.001) return;
      const open = state.jawOpen || 0;
      if (open < 0.001) return;
      const push = open * amt * 0.10;
      for (let i = 0; i < baseUVs.length; i++) {
        const v = baseUVs[i].v;
        if (v < 0.55) continue;
        const w = Math.min(1, (v - 0.55) / 0.45);
        disp[i].z += push * w;
      }
    }

    function applyMouthGrow(disp) {
      const amt = config.mouthGrow;
      if (amt < 0.001) return;
      const p = computeMouthParams();
      const openness = p.open;
      if (openness < 0.001) return;
      const scale = openness * amt;
      const r = 0.25, r2 = r * r;
      const cu = 0.50, cv = 0.69;
      for (let i = 0; i < baseUVs.length; i++) {
        const du = baseUVs[i].u - cu;
        const dv = baseUVs[i].v - cv;
        const d2 = du*du + dv*dv;
        if (d2 > r2) continue;
        const w = 1 - Math.sqrt(d2 / r2);
        const base = baseVertices[i];
        disp[i].x += (base.x - mouthCenterUV.x) * scale * w * 0.40;
        disp[i].y += (base.y - mouthCenterUV.y) * scale * w * 0.40;
        disp[i].z += scale * w * 0.05;
      }
    }

    /* Static jaw-protrude passes — push the upper-mouth and lower-jaw
       regions forward (z+) independent of jawOpen. Used together they
       form the snout / animal / crocodile-mouth distortion. Each is a
       smooth tent ramp in v-space:
         - upper: peaks at v=0.62 (just above the mouth), tapers off by
           v=0.45 (top) and v=0.72 (mouth line)
         - lower: peaks at v=0.85 (chin tip), tapers off by v=0.70 (mouth)
           and v=1.0 (bottom of grid)
       Magnitude is `protrude * 0.18` for both — at amt=3 (slider max),
       lower jaw juts forward ~0.54 z-units which is comparable to the
       nose tip's z=0.22, giving a clearly elongated jaw silhouette. */
    function applyUpperJawProtrude(disp) {
      const amt = config.upperJawProtrude;
      if (amt < 0.001) return;
      const push = amt * 0.18;
      for (let i = 0; i < baseUVs.length; i++) {
        const v = baseUVs[i].v;
        if (v < 0.45 || v > 0.72) continue;
        // tent: 0 at edges, 1 at v=0.62
        const w = v < 0.62 ? (v - 0.45) / 0.17 : (0.72 - v) / 0.10;
        disp[i].z += push * w;
      }
    }
    function applyLowerJawProtrude(disp) {
      const amt = config.lowerJawProtrude;
      if (amt < 0.001) return;
      const push = amt * 0.18;
      for (let i = 0; i < baseUVs.length; i++) {
        const v = baseUVs[i].v;
        if (v < 0.70) continue;
        // tent: 0 at v=0.70, 1 at v=0.85, tapers to 0.5 at v=1.0
        let w;
        if (v < 0.85) w = (v - 0.70) / 0.15;
        else          w = 1 - (v - 0.85) / 0.30;   // ramp down past chin tip
        if (w < 0) w = 0;
        disp[i].z += push * w;
      }
    }

    function applyMouthAnchors(disp) {
      if (!config.mouthAnchor) return;
      const p = computeMouthParams();
      for (const v of mouthRingVerts) {
        const target = lipTarget(v.xRel, v.isUpper, p);
        const dx = target.x - v.baselineTarget.x;
        const dy = target.y - v.baselineTarget.y;
        const dz = target.z - v.baselineTarget.z;
        const w = v.weight;
        disp[v.idx].x = disp[v.idx].x * (1 - w) + dx * w;
        disp[v.idx].y = disp[v.idx].y * (1 - w) + dy * w;
        disp[v.idx].z = disp[v.idx].z * (1 - w) + dz * w;
      }
    }

    function applyEyeAnchors(disp) {
      if (!config.eyeAnchor) return;
      const blinkL = state.eyeBlinkLeft, blinkR = state.eyeBlinkRight;
      const squint = state.eyeSquint;
      for (const v of eyeRingVerts) {
        const blink = v.side === 'L' ? blinkL : blinkR;
        const target = eyeLidTargetFor(v.xRel, v.isUpper, v.eyeDef, blink, squint);
        const dx = target.x - v.baselineTarget.x;
        const dy = target.y - v.baselineTarget.y;
        const dz = target.z - v.baselineTarget.z;
        const w = v.weight;
        disp[v.idx].x = disp[v.idx].x * (1 - w) + dx * w;
        disp[v.idx].y = disp[v.idx].y * (1 - w) + dy * w;
        disp[v.idx].z = disp[v.idx].z * (1 - w) + dz * w;
      }
    }

    function applyFaceFlip() {
      // Original semantic: flipFace=true rotates 180° around Y so face's
      // nose ends up at -z, which is closer to the default ArcRotateCamera
      // at world z=-radius. RH coord system (set on the scene) doesn't
      // change ArcRotateCamera's position, only material/winding behavior,
      // so the face still NEEDS this rotation in RH.
      if (faceRoot) faceRoot.rotation.y = config.flipFace ? Math.PI : 0;
    }
    function applyMeshVisibility() {
      if (mesh) mesh.isVisible = !!config.meshVisible;
    }
    function applyMinimalVisibility() {
      if (minimalGroup) {
        minimalGroup.getChildMeshes().forEach(m => m.isVisible = !!config.minimal);
      }
    }
    function applyRenderMode() {
      if (!mesh) return;
      if (mesh._edgesRenderer) mesh.disableEdgesRendering();
      const w = config.lineThickness;
      switch (config.mode) {
        case 'wire':
          mesh.material = wireMat;
          wireMat.wireframe = true;
          wireMat.alpha = 1.0;
          break;
        case 'edges':
          mesh.material = faceMat;
          faceMat.alpha = 1.0;
          faceMat.wireframe = false;
          mesh.enableEdgesRendering(0.9999);
          mesh.edgesWidth = 4 * w;
          mesh.edgesColor = new BABYLON.Color4(_baseRGB[0], _baseRGB[1], _baseRGB[2], 1);
          break;
        case 'shaded':
          mesh.material = faceMat;
          faceMat.alpha = 1.0;
          faceMat.wireframe = false;
          break;
      }
    }

    /* ── pupils + iris ── */
    let pupilMat = null, pupilL = null, pupilR = null;
    let irisMat = null,  irisL  = null,  irisR  = null;

    function rebuildPupils() {
      if (pupilL) { pupilL.dispose(); pupilL = null; }
      if (pupilR) { pupilR.dispose(); pupilR = null; }
      if (irisL)  { irisL.dispose();  irisL  = null; }
      if (irisR)  { irisR.dispose();  irisR  = null; }
      if (!config.pupils) return;
      if (!pupilMat) {
        pupilMat = new BABYLON.StandardMaterial('pupilMat', scene);
        pupilMat.emissiveColor = BABYLON.Color3.FromHexString(config.pupilColor);
        pupilMat.disableLighting = true;
        pupilMat.backFaceCulling = false;
      }
      if (!irisMat) {
        irisMat = new BABYLON.StandardMaterial('irisMat', scene);
        irisMat.emissiveColor = BABYLON.Color3.FromHexString(config.irisColor);
        irisMat.disableLighting = true;
        irisMat.backFaceCulling = false;
      }
      const irisRsize = 0.035 * config.irisSize;
      irisL = BABYLON.MeshBuilder.CreateDisc('irisL', { radius: irisRsize, tessellation: 24 }, scene);
      irisR = BABYLON.MeshBuilder.CreateDisc('irisR', { radius: irisRsize, tessellation: 24 }, scene);
      irisL.material = irisR.material = irisMat;
      irisL.parent = irisR.parent = faceRoot;
      pupilL = BABYLON.MeshBuilder.CreateDisc('pupilL', { radius: 0.035, tessellation: 14 }, scene);
      pupilR = BABYLON.MeshBuilder.CreateDisc('pupilR', { radius: 0.035, tessellation: 14 }, scene);
      pupilL.material = pupilR.material = pupilMat;
      pupilL.parent = pupilR.parent = faceRoot;
    }

    function updatePupils() {
      if (!pupilL || !pupilR) return;
      const lookH = state.eyeLookH * 0.05;
      const lookV = state.eyeLookV * 0.035;
      const eyeL = warpToFace(0.30, 0.40);
      const eyeR = warpToFace(0.70, 0.40);
      if (irisL && irisR) {
        irisL.position.set(eyeL.x + lookH * 0.6, eyeL.y + lookV * 0.6, eyeL.z + 0.045);
        irisR.position.set(eyeR.x + lookH * 0.6, eyeR.y + lookV * 0.6, eyeR.z + 0.045);
      }
      pupilL.position.set(eyeL.x + lookH, eyeL.y + lookV, eyeL.z + 0.05);
      pupilR.position.set(eyeR.x + lookH, eyeR.y + lookV, eyeR.z + 0.05);
      const blink = (state.eyeBlinkLeft + state.eyeBlinkRight) * 0.5;
      pupilL.isVisible = pupilR.isVisible = blink < 0.85;
      if (irisL && irisR) irisL.isVisible = irisR.isVisible = blink < 0.85;
    }

    /* ── minimal-line overlay ── */
    function sampleDispAtUV(u, v) {
      if (!_dispBuf) return V(0, 0, 0);
      const r2 = 0.06 * 0.06;
      let totalW = 0, sx = 0, sy = 0, sz = 0;
      for (let i = 0; i < baseUVs.length; i++) {
        const du = baseUVs[i].u - u, dv = baseUVs[i].v - v;
        const d2 = du*du + dv*dv;
        if (d2 < r2) {
          const w = 1 - Math.sqrt(d2 / r2);
          totalW += w;
          sx += _dispBuf[i].x * w; sy += _dispBuf[i].y * w; sz += _dispBuf[i].z * w;
        }
      }
      if (totalW === 0) return V(0, 0, 0);
      return V(sx/totalW, sy/totalW, sz/totalW);
    }
    function deformedPoint(u, v) {
      const base = warpToFace(u, v);
      if (!config.overlayTracksMesh) return base;
      const d = sampleDispAtUV(u, v);
      return V(base.x + d.x, base.y + d.y, base.z + d.z);
    }

    function smoothPath(controls, samples = 18) {
      const out = [];
      const N = controls.length;
      const get = i => controls[Math.max(0, Math.min(N - 1, i))];
      for (let i = 0; i < N - 1; i++) {
        const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
        for (let s = 0; s < samples; s++) {
          const t = s / samples;
          const t2 = t*t, t3 = t*t2;
          const x = 0.5 * ((2*p1.x) + (-p0.x + p2.x)*t + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*t2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*t3);
          const y = 0.5 * ((2*p1.y) + (-p0.y + p2.y)*t + (2*p0.y - 5*p1.y + 4*p2.y - p3.y)*t2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y)*t3);
          const z = 0.5 * ((2*p1.z) + (-p0.z + p2.z)*t + (2*p0.z - 5*p1.z + 4*p2.z - p3.z)*t2 + (-p0.z + 3*p1.z - 3*p2.z + p3.z)*t3);
          out.push(V(x, y, z));
        }
      }
      out.push(controls[N - 1]);
      return out;
    }

    /* makeTube creates a new tube OR updates an existing one in-place.
       Final radius = baseRadius * featureMul * config.lineThickness — applied
       in BOTH new and instance forms. Babylon's CreateTube instance-form
       applies opts.radius every call (it does not preserve the radius from
       construction), so updateMinimal MUST pass the current featureMul each
       frame or the tube collapses to (base × 1 × lineThickness). */
    function makeTube(name, points, radius, mat, featureMul, instance) {
      const r = radius * (featureMul == null ? 1 : featureMul) * config.lineThickness;
      const opts = { path: points, radius: r, tessellation: 6, updatable: true };
      if (instance) opts.instance = instance;
      const tube = BABYLON.MeshBuilder.CreateTube(name, opts, scene);
      if (!instance) { tube.material = mat || mouthMat; tube.parent = minimalGroup; }
      return tube;
    }

    let mouthUpperMesh = null, mouthLowerMesh = null;
    function mouthLipPaths() {
      const p = computeMouthParams();
      const upperXR = [-1.0, -0.45, 0.0, 0.45, 1.0];
      const lowerXR = [-1.0, -0.5,  0.0, 0.5,  1.0];
      const upper = smoothPath(upperXR.map(x => lipTarget(x, true,  p)), 18);
      const lower = smoothPath(lowerXR.map(x => lipTarget(x, false, p)), 18);
      return { upper, lower };
    }

    const eyeData = [
      { side: 'L', uv: [0.30, 0.40], hw: 0.10, hh: 0.040 },
      { side: 'R', uv: [0.70, 0.40], hw: 0.10, hh: 0.040 },
    ];
    let eyeMeshes = [];
    function eyePath(eye, isUpper) {
      const blink = eye.side === 'L' ? state.eyeBlinkLeft : state.eyeBlinkRight;
      const squint = state.eyeSquint;
      const center = deformedPoint(eye.uv[0], eye.uv[1]);
      const N = 12, pts = [], squintShift = squint * 0.012;
      for (let i = 0; i <= N; i++) {
        const t = i / N, a = t * Math.PI;
        const x = center.x + Math.cos(Math.PI - a) * eye.hw;
        const baseY = center.y + (isUpper ? 1 : -1) * Math.sin(a) * eye.hh;
        const y = baseY * (1 - blink) + center.y * blink;
        const yWithSquint = y + (isUpper ? -squintShift : squintShift * 0.5);
        const z = center.z + 0.018 + Math.sin(a) * 0.012;
        pts.push(V(x, yWithSquint, z));
      }
      return pts;
    }

    const browData = [
      { side: 'L', uv: [0.27, 0.27] },
      { side: 'R', uv: [0.73, 0.27] },
    ];
    let browMeshes = [];
    function browPath(brow) {
      const center = deformedPoint(brow.uv[0], brow.uv[1]);
      const sign = brow.side === 'L' ? -1 : 1;
      const innerLift = state.browInnerUp * 0.085 - state.browDown * 0.05;
      const outerLift = (state.browOuterUp >= 0 ? state.browOuterUp : 0) * 0.07 - state.browDown * 0.05;
      const innerX = center.x + sign * (-0.10);
      const midX   = center.x;
      const outerX = center.x + sign * 0.10;
      const innerY = center.y + innerLift;
      const midY   = center.y + (innerLift + outerLift) * 0.5 + 0.005;
      const outerY = center.y + outerLift - 0.005;
      const z = center.z + 0.018;
      return smoothPath([V(innerX, innerY, z), V(midX, midY, z + 0.01), V(outerX, outerY, z)], 12);
    }

    let noseBridgeMesh = null, noseLeftMesh = null, noseRightMesh = null;
    function nosePaths() {
      const flair = state.noseSneer * 0.025;
      const top = deformedPoint(0.50, 0.40);
      const tip = deformedPoint(0.50, 0.55);
      const bridge = smoothPath([
        V(top.x, top.y - 0.02, top.z + 0.02),
        V(top.x - 0.005, (top.y + tip.y) * 0.5, (top.z + tip.z) * 0.5 + 0.05),
        V(tip.x, tip.y + 0.03, tip.z + 0.05),
      ], 14);
      const baseY = tip.y + 0.01;
      const leftN = smoothPath([
        V(tip.x, baseY, tip.z + 0.05),
        V(tip.x - 0.06 - flair, baseY - 0.03, tip.z + 0.02),
        V(tip.x - 0.04, baseY - 0.05, tip.z + 0.005),
        V(tip.x - 0.01, baseY - 0.02, tip.z + 0.03),
      ], 10);
      const rightN = smoothPath([
        V(tip.x, baseY, tip.z + 0.05),
        V(tip.x + 0.06 + flair, baseY - 0.03, tip.z + 0.02),
        V(tip.x + 0.04, baseY - 0.05, tip.z + 0.005),
        V(tip.x + 0.01, baseY - 0.02, tip.z + 0.03),
      ], 10);
      return { bridge, leftN, rightN };
    }

    function rebuildMinimalLines() {
      if (mouthUpperMesh) { mouthUpperMesh.dispose(); mouthUpperMesh = null; }
      if (mouthLowerMesh) { mouthLowerMesh.dispose(); mouthLowerMesh = null; }
      for (const em of eyeMeshes) { em.upper.dispose(); em.lower.dispose(); }
      eyeMeshes = [];
      for (const bm of browMeshes) bm.mesh.dispose();
      browMeshes = [];
      if (noseBridgeMesh) { noseBridgeMesh.dispose(); noseBridgeMesh = null; }
      if (noseLeftMesh)   { noseLeftMesh.dispose();   noseLeftMesh   = null; }
      if (noseRightMesh)  { noseRightMesh.dispose();  noseRightMesh  = null; }
      const { upper, lower } = mouthLipPaths();
      mouthUpperMesh = makeTube('mouth_u', upper, 0.010, mouthMat, config.mouthLineThickness);
      mouthLowerMesh = makeTube('mouth_l', lower, 0.010, mouthMat, config.mouthLineThickness);
      for (const eye of eyeData) {
        const u = makeTube('eye_' + eye.side + '_u', eyePath(eye, true),  0.0085, eyeMat, config.eyeLineThickness);
        const l = makeTube('eye_' + eye.side + '_l', eyePath(eye, false), 0.0085, eyeMat, config.eyeLineThickness);
        eyeMeshes.push({ eye, upper: u, lower: l });
      }
      for (const brow of browData) {
        const m = makeTube('brow_' + brow.side, browPath(brow), 0.011, browMat, config.browLineThickness);
        browMeshes.push({ brow, mesh: m });
      }
      const np = nosePaths();
      noseBridgeMesh = makeTube('nose_b', np.bridge, 0.009,  noseMat, config.noseLineThickness);
      noseLeftMesh   = makeTube('nose_l', np.leftN,  0.0085, noseMat, config.noseLineThickness);
      noseRightMesh  = makeTube('nose_r', np.rightN, 0.0085, noseMat, config.noseLineThickness);
      applyMinimalVisibility();
      applyMinimalSubVisibility();
    }

    function updateMinimal() {
      if (!mouthUpperMesh) return;
      // Babylon's CreateTube instance-form applies opts.radius EVERY call —
      // it doesn't preserve the radius from construction. So we must pass the
      // current per-feature thickness multiplier on every frame, otherwise
      // the tube collapses back to (base × 1 × lineThickness) and the
      // per-feature slider has no visible effect.
      const mp = mouthLipPaths();
      makeTube('', mp.upper, 0.010, null, config.mouthLineThickness, mouthUpperMesh);
      makeTube('', mp.lower, 0.010, null, config.mouthLineThickness, mouthLowerMesh);
      for (const em of eyeMeshes) {
        makeTube('', eyePath(em.eye, true),  0.0085, null, config.eyeLineThickness, em.upper);
        makeTube('', eyePath(em.eye, false), 0.0085, null, config.eyeLineThickness, em.lower);
      }
      for (const bm of browMeshes) makeTube('', browPath(bm.brow), 0.011, null, config.browLineThickness, bm.mesh);
      const np = nosePaths();
      makeTube('', np.bridge, 0.009,  null, config.noseLineThickness, noseBridgeMesh);
      makeTube('', np.leftN,  0.0085, null, config.noseLineThickness, noseLeftMesh);
      makeTube('', np.rightN, 0.0085, null, config.noseLineThickness, noseRightMesh);
    }

    /* ── per-frame face update ── */
    const _stateRawSnap = {};
    function updateFace() {
      if (!mesh) return;
      // gain sandwich
      for (let i = 0; i < CHANNEL_NAMES.length; i++) {
        const ch = CHANNEL_NAMES[i];
        _stateRawSnap[ch] = state[ch];
        state[ch] = state[ch] * (channelGains[ch] || 1);
      }
      for (let i = 0; i < _dispBuf.length; i++) {
        _dispBuf[i].x = _dispBuf[i].y = _dispBuf[i].z = 0;
      }
      computeMorphs(_dispBuf);
      if (config.reactivity > 0) couple(_dispBuf, config.reactivity);
      applyFeatureScales(_dispBuf);
      applyJawExtension(_dispBuf);
      applyMouthGrow(_dispBuf);
      applyUpperJawProtrude(_dispBuf);
      applyLowerJawProtrude(_dispBuf);
      applyMouthAnchors(_dispBuf);
      applyEyeAnchors(_dispBuf);
      // write final positions
      for (let i = 0; i < baseVertices.length; i++) {
        _posBuf[3*i  ] = baseVertices[i].x + _dispBuf[i].x;
        _posBuf[3*i+1] = baseVertices[i].y + _dispBuf[i].y;
        _posBuf[3*i+2] = baseVertices[i].z + _dispBuf[i].z;
      }
      mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, _posBuf);
      // depth fade colors. raw t = (zMax - z) / zRange, then exponentiated by
      // depthFadeCurve. >1 darkens back faster (so silhouette edges actually
      // hit fadeColor in wire mode despite line interpolation lifting them);
      // <1 brightens back. Then scaled by depthFade.
      if (config.depthFade > 0.001) {
        const zRange = (_zMax - _zMin) || 1;
        const f = config.depthFade;
        const curve = config.depthFadeCurve > 0 ? config.depthFadeCurve : 1;
        for (let i = 0; i < baseVertices.length; i++) {
          const z = _posBuf[3*i + 2];
          let t = (_zMax - z) / zRange;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          if (curve !== 1) t = Math.pow(t, curve);
          t *= f;
          _colBuf[4*i  ] = _baseRGB[0] * (1 - t) + _fadeRGB[0] * t;
          _colBuf[4*i+1] = _baseRGB[1] * (1 - t) + _fadeRGB[1] * t;
          _colBuf[4*i+2] = _baseRGB[2] * (1 - t) + _fadeRGB[2] * t;
          _colBuf[4*i+3] = 1;
        }
        mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, _colBuf);
      } else if (_dirtyBaseColor) {
        for (let i = 0; i < baseVertices.length; i++) {
          _colBuf[4*i  ] = _baseRGB[0];
          _colBuf[4*i+1] = _baseRGB[1];
          _colBuf[4*i+2] = _baseRGB[2];
          _colBuf[4*i+3] = 1;
        }
        mesh.updateVerticesData(BABYLON.VertexBuffer.ColorKind, _colBuf);
        _dirtyBaseColor = false;
      }
      if (config.mode === 'edges' || config.mode === 'shaded') {
        BABYLON.VertexData.ComputeNormals(_posBuf, triIndices, _normBuf);
        mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, _normBuf);
      }
      updatePupils();
      if (config.minimal) updateMinimal();
      // head pose drives parent. The Y rotation must include the flipFace
      // base rotation, otherwise this per-frame write would wipe out the
      // π flip set by applyFaceFlip and the face would render with its
      // back to the camera (it lasted only the first frame). v1.1.4 fix.
      const flipBase = config.flipFace ? Math.PI : 0;
      faceRoot.rotation.x = state.headRotateX * 0.35;
      faceRoot.rotation.y = flipBase + state.headRotateY * 0.50;
      faceRoot.rotation.z = state.headRotateZ * 0.30;
      // restore
      for (let i = 0; i < CHANNEL_NAMES.length; i++) state[CHANNEL_NAMES[i]] = _stateRawSnap[CHANNEL_NAMES[i]];
    }

    /* ── channel smoothing + mood blend + idle ── */
    function smoothChannels(dt) {
      for (const ch of CHANNEL_NAMES) {
        if (manualLock[ch]) { state[ch] = stateTarget[ch]; continue; }
        const k = SMOOTH[ch] || SMOOTH.default;
        const a = 1 - Math.exp(-k * dt * 30);
        state[ch] = state[ch] + (stateTarget[ch] - state[ch]) * a;
      }
    }

    function updateMoodBlend(dt) {
      const T = Math.max(0.05, config.moodTransitionTime);
      const halflife = T / 4;
      const a = 1 - Math.pow(0.5, dt / halflife);
      for (const m of MOOD_NAMES) {
        moodCurrentWeights[m] += (moodTargetWeights[m] - moodCurrentWeights[m]) * a;
      }
      for (const ch of MOOD_CHANNELS) {
        let target = 0;
        for (const m of MOOD_NAMES) target += (MOODS[m][ch] || 0) * moodCurrentWeights[m];
        stateTarget[ch] = target;
      }
    }

    /* ── idle micro-animations: blinks + saccades + head bob ── */
    let _nextBlink = 1.5 + Math.random() * 3;
    let _blinkAccum = 0;
    let _nextSaccade = 0.8 + Math.random() * 2;
    let _saccadeAccum = 0;
    let _saccTargetH = 0, _saccTargetV = 0;
    let _bobT = 0;
    function idleAnimate(dt) {
      // blinks
      _blinkAccum += dt;
      if (_blinkAccum > _nextBlink && !manualLock.eyeBlinkLeft && !manualLock.eyeBlinkRight) {
        // start a quick blink: target=1, then return to 0
        stateTarget.eyeBlinkLeft = 1;
        stateTarget.eyeBlinkRight = 1;
        setTimeout(() => {
          stateTarget.eyeBlinkLeft = moodCurrentWeights.sleep > 0.5 ? 1 : 0;
          stateTarget.eyeBlinkRight = moodCurrentWeights.sleep > 0.5 ? 1 : 0;
        }, 110);
        _blinkAccum = 0;
        _nextBlink = 1.5 + Math.random() * 3.5;
      }
      // micro-saccades
      _saccadeAccum += dt;
      if (_saccadeAccum > _nextSaccade && !manualLock.eyeLookH) {
        _saccTargetH = (Math.random() - 0.5) * 0.6;
        _saccTargetV = (Math.random() - 0.5) * 0.4;
        _saccadeAccum = 0;
        _nextSaccade = 0.7 + Math.random() * 2.5;
      }
      stateTarget.eyeLookH = _saccTargetH;
      stateTarget.eyeLookV = _saccTargetV;
      // head bob — gentle sway
      _bobT += dt;
      stateTarget.headRotateX = Math.sin(_bobT * 0.27) * 0.04;
      stateTarget.headRotateY = Math.sin(_bobT * 0.19) * 0.06;
      stateTarget.headRotateZ = Math.sin(_bobT * 0.11) * 0.03;
    }

    /* ── audio analysis for live lip-sync ── */
    let audioCtx = null;
    let audioBuffer = null;
    let audioSource = null;
    let analyser = null;
    let audioStartCtxTime = 0;
    let pausedAt = 0;
    let isPlayingFlag = false;
    let audioFreqData = null;

    function ensureAudioCtx() {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      // Some browsers start AudioContext suspended until a user gesture
      if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    async function loadAudio(fileOrBlob) {
      ensureAudioCtx();
      const arrBuf = await fileOrBlob.arrayBuffer();
      audioBuffer = await audioCtx.decodeAudioData(arrBuf.slice(0));
      pausedAt = 0;
    }

    function startPlayback(fromOffset) {
      if (!audioBuffer) return;
      ensureAudioCtx();
      audioSource = audioCtx.createBufferSource();
      audioSource.buffer = audioBuffer;
      audioSource.loop = !!config.loopAudio;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.4;
      audioFreqData = new Uint8Array(analyser.frequencyBinCount);
      audioSource.connect(analyser);
      analyser.connect(audioCtx.destination);
      audioStartCtxTime = audioCtx.currentTime - (fromOffset || 0);
      audioSource.start(0, fromOffset || 0);
      audioSource.onended = () => {
        if (!config.loopAudio) {
          isPlayingFlag = false;
          // dampen visemes back to silence
          for (const v of Object.keys(VISEME_PARAMS)) stateTarget['viseme_' + v] = 0;
          stateTarget.viseme_sil = 1;
          stateTarget.jawOpen = 0;
        }
      };
      isPlayingFlag = true;
    }

    function stopPlayback() {
      if (audioSource) {
        try { audioSource.stop(); } catch (_) {}
        try { audioSource.disconnect(); } catch (_) {}
        audioSource = null;
      }
      if (analyser) { try { analyser.disconnect(); } catch (_) {} analyser = null; }
      isPlayingFlag = false;
    }

    function getPlaybackTime() {
      if (!audioCtx || !audioBuffer) return 0;
      if (isPlayingFlag) return audioCtx.currentTime - audioStartCtxTime;
      return pausedAt || 0;
    }

    function freqEnergyHz(lo, hi) {
      if (!audioFreqData) return 0;
      const sr = audioCtx.sampleRate;
      const binHz = sr / 2 / audioFreqData.length;
      const i0 = Math.max(0, Math.floor(lo / binHz));
      const i1 = Math.min(audioFreqData.length - 1, Math.ceil(hi / binHz));
      let s = 0, n = 0;
      for (let i = i0; i <= i1; i++) { s += audioFreqData[i]; n++; }
      return n ? (s / n) / 255 : 0;
    }

    function analyzeAudioFrame() {
      if (!analyser) return;
      analyser.getByteFrequencyData(audioFreqData);
      // overall amplitude
      const eLow = freqEnergyHz(200, 700);
      const eMid = freqEnergyHz(700, 2000);
      const eHi  = freqEnergyHz(2000, 4000);
      const eSib = freqEnergyHz(4000, 8000);
      const eAir = freqEnergyHz(1500, 5000);
      const amp = Math.max(eLow, eMid, eHi, eSib);
      if (amp < 0.08) {
        for (const v of Object.keys(VISEME_PARAMS)) stateTarget['viseme_' + v] = 0;
        stateTarget.viseme_sil = 1;
        stateTarget.jawOpen = 0;
        return;
      }
      stateTarget.viseme_sil = 0;
      stateTarget.jawOpen = amp * 0.7;
      // Reset all visemes
      for (const v of Object.keys(VISEME_PARAMS)) {
        if (v !== 'sil') stateTarget['viseme_' + v] = 0;
      }
      // Heuristic mapping
      if (eSib > 0.35 && eSib > eMid * 0.8) {
        stateTarget.viseme_SS = Math.min(1, eSib * 1.3);
        stateTarget.viseme_FF = Math.min(0.6, eAir * 1.2);
      }
      if (eLow > eMid && eLow > 0.18) {
        if (eHi > 0.25) {
          stateTarget.viseme_aa = Math.min(1, eLow * 1.2);
        } else {
          stateTarget.viseme_O  = Math.min(1, eLow * 1.2);
          stateTarget.viseme_U  = Math.min(0.7, eLow * 0.9);
        }
      } else if (eMid > 0.20) {
        if (eHi > eMid * 0.6) {
          stateTarget.viseme_I = Math.min(1, eHi * 1.4);
          stateTarget.viseme_E = Math.min(0.7, eMid * 1.1);
        } else {
          stateTarget.viseme_E = Math.min(1, eMid * 1.3);
          stateTarget.viseme_aa = Math.min(0.4, eLow * 0.9);
        }
      }
    }

    /* ── color application ──
       Per-feature mouth/eye/nose materials inherit lineColor when their
       per-feature override is null. So applyLineColor pushes into all three
       inheriting materials; the per-feature setters override that. */
    function applyLineColor(hex) {
      config.lineColor = hex;
      const c = BABYLON.Color3.FromHexString(hex);
      if (!config.mouthColor) mouthMat.emissiveColor = c;
      if (!config.eyeColor)   eyeMat.emissiveColor   = c;
      if (!config.noseColor)  noseMat.emissiveColor  = c;
    }
    function applyMouthColor(hex) {
      config.mouthColor = hex;
      mouthMat.emissiveColor = BABYLON.Color3.FromHexString(hex || config.lineColor);
    }
    function applyEyeColor(hex) {
      config.eyeColor = hex;
      eyeMat.emissiveColor = BABYLON.Color3.FromHexString(hex || config.lineColor);
    }
    function applyNoseColor(hex) {
      config.noseColor = hex;
      noseMat.emissiveColor = BABYLON.Color3.FromHexString(hex || config.lineColor);
    }
    function applyBrowColor(hex) {
      config.browColor = hex;
      browMat.emissiveColor = BABYLON.Color3.FromHexString(hex);
    }
    /* per-feature visibility — independent of master `minimal` (which still
       hides the whole minimalGroup). Each feature toggles its own meshes. */
    function applyMinimalSubVisibility() {
      const setVis = (m, v) => { if (m) m.isVisible = v; };
      setVis(mouthUpperMesh, !!config.minimalMouth);
      setVis(mouthLowerMesh, !!config.minimalMouth);
      for (const em of eyeMeshes) { setVis(em.upper, !!config.minimalEyes); setVis(em.lower, !!config.minimalEyes); }
      for (const bm of browMeshes) setVis(bm.mesh, !!config.minimalBrows);
      setVis(noseBridgeMesh, !!config.minimalNose);
      setVis(noseLeftMesh,   !!config.minimalNose);
      setVis(noseRightMesh,  !!config.minimalNose);
    }
    function applyPupilColor(hex) {
      config.pupilColor = hex;
      if (pupilMat) pupilMat.emissiveColor = BABYLON.Color3.FromHexString(hex);
    }
    function applyBaseColor(hex) {
      config.baseColor = hex;
      _baseRGB = hex2rgb(hex);
      _dirtyBaseColor = true;
      wireMat.emissiveColor = new BABYLON.Color3(_baseRGB[0], _baseRGB[1], _baseRGB[2]);
      if (mesh && mesh._edgesRenderer) mesh.edgesColor = new BABYLON.Color4(_baseRGB[0], _baseRGB[1], _baseRGB[2], 1);
    }
    function applyFadeColor(hex) {
      config.fadeColor = hex;
      _fadeRGB = hex2rgb(hex);
      _dirtyBaseColor = true;
    }
    function applyIrisColor(hex) {
      config.irisColor = hex;
      if (irisMat) irisMat.emissiveColor = BABYLON.Color3.FromHexString(hex);
    }

    /* ── views ── */
    const VIEWS = {
      front:    { alpha: -Math.PI/2,        beta: Math.PI/2,        radius: 4.4 },
      'three-q':{ alpha: -Math.PI/2 - 0.6,  beta: Math.PI/2 - 0.15, radius: 4.0 },
      profile:  { alpha: 0,                 beta: Math.PI/2,        radius: 4.6 },
      orbit:    null,
    };
    let orbiting = false;
    function setView(view) {
      if (view === 'orbit') { orbiting = true; return; }
      orbiting = false;
      const v = VIEWS[view];
      if (!v) return;
      camera.alpha  = v.alpha;
      camera.beta   = v.beta;
      camera.radius = v.radius;
    }

    function applyGlow() {
      glowLayer.intensity = config.glow ? 0.85 : 0;
    }

    /* ── initial build ── */
    rebuildMesh();
    rebuildPupils();
    rebuildMinimalLines();
    applyBaseColor(config.baseColor);
    applyFadeColor(config.fadeColor);
    applyLineColor(config.lineColor);
    applyBrowColor(config.browColor);
    if (config.mouthColor) applyMouthColor(config.mouthColor);
    if (config.eyeColor)   applyEyeColor(config.eyeColor);
    if (config.noseColor)  applyNoseColor(config.noseColor);
    applyPupilColor(config.pupilColor);
    applyIrisColor(config.irisColor);
    applyMinimalSubVisibility();
    applyGlow();
    setView(config.cameraView);

    /* ── render loop ── */
    let lastT = performance.now();
    let _disposed = false;
    engine.runRenderLoop(() => {
      if (_disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastT) / 1000);
      lastT = now;
      idleAnimate(dt);
      if (isPlayingFlag) analyzeAudioFrame();
      updateMoodBlend(dt);
      smoothChannels(dt);
      updateFace();
      if (orbiting) camera.alpha += dt * 0.3;
      scene.render();
    });
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    /* ── preset loader (consumes JSON saved by v010+ UI) ── */
    function loadPreset(p) {
      if (!p) return;
      const rc = p.renderConfig || {};
      let needRebuild = false;
      if (rc.meshCols !== undefined && rc.meshCols !== config.meshCols) needRebuild = true;
      if (rc.meshRows !== undefined && rc.meshRows !== config.meshRows) needRebuild = true;
      if (rc.fragment !== undefined && rc.fragment !== config.fragment) needRebuild = true;
      if (rc.mouthHole !== undefined && rc.mouthHole !== config.mouthHole) needRebuild = true;
      if (rc.eyeHoles !== undefined && rc.eyeHoles !== config.eyeHoles) needRebuild = true;
      if (rc.mouthHoleSize !== undefined && rc.mouthHoleSize !== config.mouthHoleSize) needRebuild = true;
      if (rc.eyeHoleSize !== undefined && rc.eyeHoleSize !== config.eyeHoleSize) needRebuild = true;
      if (rc.eyeDepth !== undefined && rc.eyeDepth !== config.eyeDepth) needRebuild = true;

      // any per-feature thickness change requires rebuilding the affected
      // tubes (CreateTube radius is fixed at construction)
      const featureThicknessChanged =
        rc.lineThickness !== undefined ||
        rc.mouthLineThickness !== undefined ||
        rc.eyeLineThickness !== undefined ||
        rc.noseLineThickness !== undefined ||
        rc.browLineThickness !== undefined;

      Object.assign(config, rc);
      if (p.lineColor) applyLineColor(p.lineColor);
      if (p.pupilColor) applyPupilColor(p.pupilColor);
      if (rc.baseColor)  applyBaseColor(rc.baseColor);
      if (rc.fadeColor)  applyFadeColor(rc.fadeColor);
      if (rc.lineColor)  applyLineColor(rc.lineColor);
      if (rc.pupilColor) applyPupilColor(rc.pupilColor);
      if (rc.irisColor)  applyIrisColor(rc.irisColor);
      if (rc.browColor)  applyBrowColor(rc.browColor);
      if (rc.mouthColor !== undefined) applyMouthColor(rc.mouthColor);
      if (rc.eyeColor   !== undefined) applyEyeColor(rc.eyeColor);
      if (rc.noseColor  !== undefined) applyNoseColor(rc.noseColor);

      if (needRebuild) {
        rebuildMesh();
        rebuildMinimalLines();
        rebuildPupils();
      } else {
        // partial refreshes
        applyRenderMode();
        applyFaceFlip();
        applyMeshVisibility();
        applyMinimalVisibility();
        if (featureThicknessChanged) rebuildMinimalLines();
        if (rc.irisSize !== undefined || rc.pupils !== undefined) rebuildPupils();
        if (rc.lipVertAmp !== undefined || rc.lipPressForce !== undefined) identifyAnchorRings();
      }
      // per-feature visibility toggles always apply (cheap; no rebuild)
      if (rc.minimalMouth !== undefined || rc.minimalEyes !== undefined ||
          rc.minimalNose  !== undefined || rc.minimalBrows !== undefined) {
        applyMinimalSubVisibility();
      }
      if (rc.glow !== undefined) applyGlow();
      // channel gains
      if (p.channelGains) {
        for (const ch of CHANNEL_NAMES) if (p.channelGains[ch] !== undefined) channelGains[ch] = p.channelGains[ch];
      }
      if (p.activeMood && MOODS[p.activeMood]) {
        activeMood = p.activeMood;
        for (const m of MOOD_NAMES) moodTargetWeights[m] = (m === activeMood) ? 1 : 0;
      }
    }

    /* ── public API ── */
    return {
      loadAudio,
      play(fromOffset) {
        if (!audioBuffer) return;
        startPlayback(fromOffset !== undefined ? fromOffset : pausedAt);
      },
      pause() {
        if (!isPlayingFlag) return;
        pausedAt = getPlaybackTime();
        stopPlayback();
      },
      stop() {
        pausedAt = 0;
        stopPlayback();
        for (const v of Object.keys(VISEME_PARAMS)) stateTarget['viseme_' + v] = 0;
        stateTarget.viseme_sil = 1;
        stateTarget.jawOpen = 0;
      },
      setLoop(b)        { config.loopAudio = !!b; if (audioSource) audioSource.loop = !!b; },
      setMood(name) {
        if (!MOODS[name]) return;
        activeMood = name;
        for (const m of MOOD_NAMES) moodTargetWeights[m] = (m === name) ? 1 : 0;
      },
      setChannel(name, value) {
        if (!CHANNELS[name]) return;
        const r = CHANNELS[name].range;
        const v = Math.max(r[0], Math.min(r[1], value));
        stateTarget[name] = v; state[name] = v;
        manualLock[name] = true;
        clearTimeout(manualLock['_t_' + name]);
        manualLock['_t_' + name] = setTimeout(() => { manualLock[name] = false; }, 1200);
      },
      setView,
      loadPreset,
      /* lighter than loadPreset — apply a partial renderConfig without touching
         channelGains/activeMood. Intended for live UI controls (sliders, toggles,
         color pickers) where you change one field per call. */
      setRenderConfig(partial) { loadPreset({ renderConfig: partial }); },
      getRenderConfig() { return Object.assign({}, config); },
      /* live channel introspection — useful for editor channel meters that
         display the smoothed audio-driven values and gain knobs. */
      getChannel(name)       { return state[name] !== undefined ? state[name] : 0; },
      getChannelTarget(name) { return stateTarget[name] !== undefined ? stateTarget[name] : 0; },
      getChannelGain(name)   { return channelGains[name] !== undefined ? channelGains[name] : 1; },
      setChannelGain(name, gain) { if (CHANNELS[name]) channelGains[name] = gain; },
      getChannelNames()      { return CHANNEL_NAMES.slice(); },
      getMoodNames()         { return MOOD_NAMES.slice(); },
      isPlaying() { return isPlayingFlag; },
      getDuration() { return audioBuffer ? audioBuffer.duration : 0; },
      getPosition() { return getPlaybackTime(); },
      getActiveMood() { return activeMood; },
      dispose() {
        _disposed = true;
        try { stopPlayback(); } catch (_) {}
        if (audioCtx) { try { audioCtx.close(); } catch (_) {} audioCtx = null; }
        window.removeEventListener('resize', onResize);
        try { engine.stopRenderLoop(); } catch (_) {}
        try { scene.dispose(); } catch (_) {}
        try { engine.dispose(); } catch (_) {}
      },
    };
  }

  /* ── exports ── */
  global.createWireface = createWireface;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createWireface };
  }
})(typeof window !== 'undefined' ? window : globalThis);
