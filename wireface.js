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
 *   setMuted(bool) / isMuted()    → void/bool (analyse the loaded audio without sounding it)
 *   attachAudio(source)           → void     (lips follow a MediaStream or AudioNode the
 *                                             library does not play; never made audible)
 *   pushAudio(samples, rate, opts?)→ number  (streamed PCM chunks drive the lips, on a clock;
 *                                             opts { at, run, end, delay, lead, audible };
 *                                             returns seconds queued)
 *   cutAudio(run?)                → void     (drop queued speech now; late chunks of the run too)
 *   isSpeaking()                  → bool
 *   on(event, fn)                 → () => void  ('speechstart','speechend','underrun','behaviour';
 *                                             returns the unsubscribe function)
 *   detachAudio()                 → void
 *   getPreset()                   → object   (the face's design, as loadPreset() takes it)
 *   setMood(name)                 → void     ('neutral','happy','sad','angry','fear','surprise','sleep')
 *   setBehaviour(name, opts?)     → bool     (named framing recipe: yaw, pitch, zoom, dim, mood —
 *                                             glides there; opts { side, glide, for }; null clears)
 *   defineBehaviours(recipes)     → void     (add / override recipes; accepts { recipes, glide_s })
 *   getBehaviour()                → string|null
 *   getBehaviourNames()           → string[]
 *   getBehaviours()               → object   (copy of the recipe table)
 *   setChannel(name, value, opts?)→ void     (manual override, auto-releases ~1.2s;
 *                                             opts { hold } keeps it until releaseChannel,
 *                                             opts { smooth } eases to the value)
 *   releaseChannel(name)          → void
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
    // scene clear colour behind the face. Saved with the preset like every
    // other colour, so each face can carry its own backdrop.
    backgroundColor: '#000000',
  };

  /* Named behaviours — framing recipes a face glides to, set by name the same
     way a mood is (setBehaviour('attend')). The caller says what is going on;
     the library owns the camera physics, so no camera object is exposed.
       yaw    radians the face is turned away from the viewer (0 = facing you)
       pitch  radians, positive looks down
       zoom   1 = normal, bigger = closer
       dim    0..1 brightness
       mood   a mood name, or 'persona' (the face's own mood)
       toward advisory for the page: turn the yaw toward whoever holds the
              floor — pass opts.side (-1 | 1) to setBehaviour
       focus  what the shot centres on: 'face' | 'center' | 'eyes' | 'nose' | 'mouth'
       hop    height of a short bounce on entry (scene units)
       for    seconds; a transient behaviour returns to the previous one
     The first ten are states of a face in a group; the rest are shots.
     Full table: SPEC.WIREFACE.BEHAVIOURS.v1.2.md §2. */
  const BEHAVIOURS = {
    asleep:    { yaw: 0.60, pitch: 0.10, zoom: 0.80, dim: 0.55, mood: 'sleep',    toward: false },
    parked:    { yaw: 0.65, pitch: 0.05, zoom: 0.82, dim: 0.60, mood: 'neutral',  toward: true  },
    idle:      { yaw: 0.45, pitch: 0.00, zoom: 0.90, dim: 0.75, mood: 'neutral',  toward: true  },
    waiting:   { yaw: 0.30, pitch: 0.00, zoom: 0.95, dim: 0.85, mood: 'neutral',  toward: true  },
    busy:      { yaw: 0.25, pitch: 0.22, zoom: 1.00, dim: 0.90, mood: 'fear',     toward: false },
    listen:    { yaw: 0.00, pitch:-0.04, zoom: 1.10, dim: 1.00, mood: 'neutral',  toward: false },
    speak:     { yaw: 0.00, pitch: 0.00, zoom: 1.22, dim: 1.00, mood: 'persona',  toward: false },
    attend:    { yaw: 0.00, pitch:-0.06, zoom: 1.35, dim: 1.00, mood: 'happy',    toward: false },
    important: { yaw: 0.00, pitch:-0.08, zoom: 1.35, dim: 1.00, mood: 'surprise', toward: false },
    cut:       { yaw: 0.15, pitch: 0.08, zoom: 1.05, dim: 0.90, mood: 'surprise', toward: false },
    // shots
    point:     { yaw: 0.00, pitch:-0.03, zoom: 1.70, dim: 1.00, mood: 'persona' },
    distant:   { yaw: 0.50, pitch: 0.04, zoom: 0.55, dim: 0.70, mood: 'neutral',  toward: true },
    away:      { yaw: 0.80, pitch: 0.06, zoom: 0.90, dim: 0.80, mood: 'neutral' },
    work:      { yaw: 0.30, pitch: 0.32, zoom: 0.95, dim: 0.85, mood: 'neutral' },
    jump:      { yaw: 0.00, pitch:-0.06, zoom: 1.30, dim: 1.00, mood: 'surprise', hop: 0.30, for: 1.6 },
    closeup:         { yaw: 0, pitch: 0, zoom: 2.20, dim: 1, mood: 'persona', focus: 'center' },
    'closeup-eyes':  { yaw: 0, pitch: 0, zoom: 2.40, dim: 1, mood: 'persona', focus: 'eyes'  },
    'closeup-nose':  { yaw: 0, pitch: 0, zoom: 3.00, dim: 1, mood: 'persona', focus: 'nose'  },
    'closeup-mouth': { yaw: 0, pitch: 0, zoom: 2.80, dim: 1, mood: 'persona', focus: 'mouth' },
  };
  /* camera radius at zoom 1, and the height each focus centres on (face-local
     y; warpToFace puts the eyes at +0.20 and the mouth at −0.38). */
  const BEHAVIOUR_RADIUS = 3.3;
  const FOCUS_Y = { face: 0, center: -0.08, eyes: 0.20, nose: -0.05, mouth: -0.38 };
  const HEAD_CHANNELS = { headRotateX: 1, headRotateY: 1, headRotateZ: 1 };
  const LIP_CHANNELS = { jawOpen: 1 };
  for (const v of Object.keys(VISEME_PARAMS)) LIP_CHANNELS['viseme_' + v] = 1;

  /* ─── module helpers ─────────────────────────────────────────────────── */

  function hex2rgb(hex) {
    const h = (hex || '#ffffff').replace('#', '');
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }

  /* ── spectrum for the speech timeline ──
     What an AnalyserNode computes, done here on the samples themselves:
     fftSize 1024 at 48 kHz, one frame every 800 samples (60 per second),
     smoothingTimeConstant 0.4. Radix-2 FFT, in place. */
  const AN_RATE = 48000, FFT_N = 1024, AN_HOP = 800, AN_SMOOTH = 0.4;
  const HOP_MS = 1000 * AN_HOP / AN_RATE;
  const FFT_REV = new Uint16Array(FFT_N), FFT_COS = new Float32Array(FFT_N / 2), FFT_SIN = new Float32Array(FFT_N / 2);
  const BLACKMAN = new Float32Array(FFT_N);
  for (let i = 0; i < FFT_N; i++) {
    let r = 0;
    for (let b = 0; b < 10; b++) r |= ((i >> b) & 1) << (9 - b);
    FFT_REV[i] = r;
    BLACKMAN[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / FFT_N) + 0.08 * Math.cos(4 * Math.PI * i / FFT_N);
  }
  for (let i = 0; i < FFT_N / 2; i++) { FFT_COS[i] = Math.cos(2 * Math.PI * i / FFT_N); FFT_SIN[i] = Math.sin(2 * Math.PI * i / FFT_N); }
  function fft(re, im) {
    for (let i = 0; i < FFT_N; i++) {
      const j = FFT_REV[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= FFT_N; size <<= 1) {
      const half = size >> 1, stride = FFT_N / size;
      for (let i = 0; i < FFT_N; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += stride) {
          const c = FFT_COS[k], sn = -FFT_SIN[k];
          const a = i + j, b = a + half;
          const tr = re[b] * c - im[b] * sn, ti = re[b] * sn + im[b] * c;
          re[b] = re[a] - tr; im[b] = im[a] - ti;
          re[a] += tr; im[a] += ti;
        }
      }
    }
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
    /* what a caller set through setChannel, kept apart from stateTarget: the
       drivers (idle, mood blend, audio) keep writing stateTarget every frame,
       and before v1.2 that overwrote any manual value on a driven channel in
       the same frame it was set. */
    const manualValue = {};
    const manualSmooth = {};
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
    scene.clearColor = new BABYLON.Color4(0, 0, 0, 1);   // applyBackgroundColor() sets the configured one
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
      const snapping = tl.snapUntil > performance.now();
      for (const ch of CHANNEL_NAMES) {
        let target = stateTarget[ch];
        if (manualLock[ch]) {
          target = manualValue[ch];
          // a held head pose keeps the idle sway on top of it
          if (HEAD_CHANNELS[ch]) {
            const r = CHANNELS[ch].range;
            target = Math.max(r[0], Math.min(r[1], target + _bob[ch]));
          }
          if (!manualSmooth[ch]) { state[ch] = target; continue; }
        }
        let k = SMOOTH[ch] || SMOOTH.default;
        if (snapping && LIP_CHANNELS[ch]) k *= 3;
        const a = 1 - Math.exp(-k * dt * 30);
        state[ch] = state[ch] + (target - state[ch]) * a;
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
    const _bob = { headRotateX: 0, headRotateY: 0, headRotateZ: 0 };
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
      _bob.headRotateX = Math.sin(_bobT * 0.27) * 0.04;
      _bob.headRotateY = Math.sin(_bobT * 0.19) * 0.06;
      _bob.headRotateZ = Math.sin(_bobT * 0.11) * 0.03;
      stateTarget.headRotateX = _bob.headRotateX;
      stateTarget.headRotateY = _bob.headRotateY;
      stateTarget.headRotateZ = _bob.headRotateZ;
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
    let outGain = null;      // playback volume: 0 when muted, so the analyser still runs
    let muted = false;
    let ext = null;          // outside audio attached with attachAudio()

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
      outGain = audioCtx.createGain();
      outGain.gain.value = muted ? 0 : 1;
      audioSource.connect(analyser);
      analyser.connect(outGain);
      outGain.connect(audioCtx.destination);
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
      if (outGain) { try { outGain.disconnect(); } catch (_) {} outGain = null; }
      isPlayingFlag = false;
    }

    function silenceLips() {
      for (const v of Object.keys(VISEME_PARAMS)) stateTarget['viseme_' + v] = 0;
      stateTarget.viseme_sil = 1;
      stateTarget.jawOpen = 0;
    }

    /* An analyser whose input goes quiet can stop being processed, and then
       keeps answering with its last spectrum — the mouth would freeze open
       when a stream ends. A constant source far below audibility (−180 dB,
       at 0 Hz, outside every band read here) keeps it running. */
    function keepAnalysing(ctx, an) {
      if (!ctx.createConstantSource) return null;
      const k = ctx.createConstantSource();
      k.offset.value = 1e-9;
      k.connect(an);
      k.start();
      return k;
    }

    /* Outside audio: speech the library does not play itself (a WebRTC or
       microphone stream, another graph's node). It runs through the same
       analyser → viseme pipeline as loadAudio()/play(), so the lips match the
       built-in path. The tap ends in a zero gain: wireface never makes
       attached audio audible — whoever owns the source plays it. */
    function attachAudio(source) {
      detachAudio();
      let node = null, owned = false;
      if (source && typeof source.connect === 'function' && source.context) {
        node = source;
      } else if (typeof MediaStream !== 'undefined' && source instanceof MediaStream) {
        ensureAudioCtx();
        node = audioCtx.createMediaStreamSource(source);
        owned = true;
      } else {
        throw new Error('wireface.attachAudio: expected a MediaStream or an AudioNode');
      }
      const ctx = node.context;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.4;
      const sink = ctx.createGain();
      sink.gain.value = 0;
      node.connect(an);
      an.connect(sink);
      sink.connect(ctx.destination);
      ext = { node, an, sink, owned, keep: keepAnalysing(ctx, an), data: new Uint8Array(an.frequencyBinCount) };
    }

    /* ── the lip analysis, as a pure function of five band energies ──
       One allocation, two callers: the live analyser (playback, attached
       audio) and the speech timeline (pushAudio). A lip frame is nine values:
       [sil, jaw, SS, FF, O, aa, U, E, I]. */
    const LIP_SLOTS = ['viseme_sil', 'jawOpen', 'viseme_SS', 'viseme_FF', 'viseme_O',
                       'viseme_aa', 'viseme_U', 'viseme_E', 'viseme_I'];
    const LIP_SILENT = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0]);
    function lipFrame(eLow, eMid, eHi, eSib, eAir, out) {
      out.fill(0);
      const amp = Math.max(eLow, eMid, eHi, eSib);
      if (amp < 0.08) { out[0] = 1; return out; }
      out[1] = amp * 0.7;
      // Proportional viseme allocation. v1.1.5: previous version was a
      // winner-takes-all branch tree where viseme_aa fired for any vowel-
      // like sound with low+mid energy, dominating with avg ~0.77 on TTS
      // input and leaving the mouth stuck wide-open. This approach instead
      // distributes amp across visemes by their corresponding band's share
      // of total energy, so the mouth shape blends through the audio's
      // formant spectrum frame-by-frame.
      const totalE = eLow + eMid + eHi + eSib + 1e-6;
      // Sibilants — sharp, high-energy fricatives. Boost separately because
      // they need to register as distinct mouth shapes (close lips + teeth)
      // even at modest absolute energy.
      if (eSib > 0.20) {
        out[2] = Math.min(1, eSib * 1.4);
        if (eAir > 0.20) out[3] = Math.min(0.7, eAir * 0.9);
      }
      // Vowels — proportional distribution across F1/F2 bands.
      // viseme_O uses low energy when low dominates (back rounded vowel).
      // viseme_aa uses mid energy (open vowel — F1 mid+low balanced).
      // viseme_E uses mid energy in front vowel range.
      // viseme_I uses high energy (high F2 = front close vowel).
      // viseme_U uses low when low dominates AND amp moderate (closed back).
      const wLow = eLow / totalE, wMid = eMid / totalE, wHi = eHi / totalE;
      if (eLow > eMid && eLow > 0.18) {
        // back vowel territory
        out[4] = Math.min(1, eLow * 1.1 * (eHi < 0.20 ? 1.1 : 0.8));
        out[5] = Math.min(1, wMid * amp * 1.6);
        if (eHi < 0.18) out[6] = Math.min(0.7, eLow * 0.9);
      } else if (eMid >= eLow * 0.9) {
        // mid / front vowel territory
        out[5] = Math.min(1, wLow * amp * 1.6);
        out[7] = Math.min(1, wMid * amp * 1.4);
        if (eHi > 0.18) out[8] = Math.min(1, wHi * amp * 1.5);
      }
      return out;
    }
    function applyLipFrame(f) {
      for (const v of Object.keys(VISEME_PARAMS)) stateTarget['viseme_' + v] = 0;
      for (let i = 0; i < LIP_SLOTS.length; i++) stateTarget[LIP_SLOTS[i]] = f[i];
    }
    /* mean of a byte spectrum over a band, 0..1 */
    function bandEnergy(data, rate, lo, hi) {
      const binHz = rate / 2 / data.length;
      const i0 = Math.max(0, Math.floor(lo / binHz));
      const i1 = Math.min(data.length - 1, Math.ceil(hi / binHz));
      let s = 0, n = 0;
      for (let i = i0; i <= i1; i++) { s += data[i]; n++; }
      return n ? (s / n) / 255 : 0;
    }
    function lipFrameFromSpectrum(data, rate, out) {
      return lipFrame(bandEnergy(data, rate, 200, 700), bandEnergy(data, rate, 700, 2000),
                      bandEnergy(data, rate, 2000, 4000), bandEnergy(data, rate, 4000, 8000),
                      bandEnergy(data, rate, 1500, 5000), out);
    }

    const _liveFrame = new Float32Array(9);
    function analyzeAudioFrame() {
      // attached outside audio takes the lips ahead of the library's own playback
      const an = ext ? ext.an : (isPlayingFlag ? analyser : null);
      if (!an) return;
      const data = ext ? ext.data : audioFreqData;
      an.getByteFrequencyData(data);
      applyLipFrame(lipFrameFromSpectrum(data, an.context.sampleRate, _liveFrame));
    }

    /* ── events ── */
    const listeners = {};
    function on(name, fn) {
      if (typeof fn !== 'function') return () => {};
      (listeners[name] = listeners[name] || []).push(fn);
      return () => { const l = listeners[name]; const i = l ? l.indexOf(fn) : -1; if (i >= 0) l.splice(i, 1); };
    }
    function emit(name, detail) {
      const l = listeners[name];
      if (!l) return;
      for (const fn of l.slice()) { try { fn(detail); } catch (e) { if (typeof console !== 'undefined') console.error('[wireface] ' + name + ' listener', e); } }
    }

    /* ── the speech timeline (pushAudio) ──
       Streamed speech is known before it sounds, so it is not analysed live.
       Each chunk is analysed the moment it arrives — the same windowed
       spectrum an AnalyserNode produces, at a fixed 48 kHz / 1024 / 60 frames
       per second — and the lip frames are placed on the page clock
       (performance.now) at the time their samples will sound. The render loop
       reads the frame for now + lead. So: the lips can run slightly ahead of
       the sound and close with it; a chunk can carry an absolute play time;
       and a silent stream needs no AudioContext at all. */
    const tl = {
      frames: [], head: 0,            // queued lip frames { t, v, run }, time-ordered
      prev: null,                     // the last frame at or before the clock
      ring: new Float32Array(FFT_N), ringPos: 0, sinceHop: 0,
      mag: new Float32Array(FFT_N / 2), bytes: new Uint8Array(FFT_N / 2),
      re: new Float32Array(FFT_N), im: new Float32Array(FFT_N),
      end: -1,                        // clock time where the queued audio ends
      segT0: 0, segN: 0,              // current segment: start time, 48 kHz samples written
      phase: 0, last: 0, inRate: 0,   // resampler carry between chunks
      run: undefined, ended: false,   // the run being queued, and whether its last chunk was flagged
      cut: [],                        // run ids that were cut: their late chunks are dropped
      active: false, spoke: false, spokeRun: undefined, dry: 0,
      // Defaults measured at 60 fps on a steady tone: the mouth starts to open
      // 40 ms before the sound, is 80% closed as the sound ends and under 0.05
      // 80 ms after it. With lead 0 and release 0 that is +33 ms and +250 ms.
      lead: 0.08,                     // seconds the lips run ahead of the sound
      release: 0.18,                  // seconds over which the mouth closes into a known silence
      snapUntil: 0,                   // after a cut: close fast until this clock time
      gain: null, sources: [],        // audible chunks
    };
    const _mix = new Float32Array(9);
    const queuedSeconds = () => Math.max(0, (tl.end - performance.now()) / 1000);

    function emitLipFrame(t, run) {
      // the window an AnalyserNode sees: the latest FFT_N samples, Blackman, |X|/N,
      // smoothed over time, in dB, mapped −100…−30 dB onto 0…255
      const re = tl.re, im = tl.im, ring = tl.ring;
      for (let i = 0; i < FFT_N; i++) { re[i] = ring[(tl.ringPos + i) & (FFT_N - 1)] * BLACKMAN[i]; im[i] = 0; }
      fft(re, im);
      const mag = tl.mag, bytes = tl.bytes;
      for (let k = 0; k < FFT_N / 2; k++) {
        const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / FFT_N;
        mag[k] = AN_SMOOTH * mag[k] + (1 - AN_SMOOTH) * m;
        const b = mag[k] > 0 ? Math.floor((255 / 70) * (20 * Math.log10(mag[k]) + 100)) : 0;
        bytes[k] = b < 0 ? 0 : b > 255 ? 255 : b;
      }
      tl.frames.push({ t, run, v: lipFrameFromSpectrum(bytes, AN_RATE, new Float32Array(9)) });
    }

    function playChunk(f32, rate, startP, run) {
      ensureAudioCtx();
      if (!tl.gain) { tl.gain = audioCtx.createGain(); tl.gain.connect(audioCtx.destination); }
      const buf = audioCtx.createBuffer(1, f32.length, rate);
      buf.getChannelData(0).set(f32);
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(tl.gain);
      // page clock → audio clock. getOutputTimestamp pairs the two at the output
      // device, so the chunk is HEARD at startP; without it, fall back to the
      // context's own latency figures.
      let when;
      const ts = audioCtx.getOutputTimestamp ? audioCtx.getOutputTimestamp() : null;
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) when = ts.contextTime + (startP - ts.performanceTime) / 1000;
      else when = audioCtx.currentTime + (startP - performance.now()) / 1000 - ((audioCtx.outputLatency || 0) + (audioCtx.baseLatency || 0));
      const late = audioCtx.currentTime - when;
      if (late <= 0) src.start(when);
      else if (late < buf.duration) src.start(0, late);
      else return;
      const rec = { src, run, startP };
      tl.sources.push(rec);
      src.onended = () => { const i = tl.sources.indexOf(rec); if (i >= 0) tl.sources.splice(i, 1); };
    }

    /* drop queued lip frames and sounding chunks: all of them, or one run's */
    function dropQueued(run, fromT) {
      const all = run === undefined;
      const keep = [];
      for (let i = tl.head; i < tl.frames.length; i++) {
        const f = tl.frames[i];
        if ((all || f.run === run) && (fromT === undefined || f.t >= fromT)) continue;
        keep.push(f);
      }
      tl.frames = keep; tl.head = 0;
      for (const s of tl.sources.slice()) {
        if ((all || s.run === run) && (fromT === undefined || s.startP >= fromT)) {
          try { s.src.onended = null; s.src.stop(); s.src.disconnect(); } catch (_) {}
          tl.sources.splice(tl.sources.indexOf(s), 1);
        }
      }
    }

    /* Streamed speech: PCM chunks handed over as they arrive — no file, no
       MediaStream.
         samples     Float32Array (−1..1), Int16Array, or an ArrayBuffer of int16; mono
         sampleRate  of the chunk; any rate
         opts.at       when the chunk's first sample SOUNDS, in wall-clock ms
                       (Date.now() scale). Omitted: chunks follow each other,
                       and a new run starts opts.delay seconds from now.
         opts.delay    lead before a run that has no `at` (default 0.05)
         opts.run      an id for the utterance this chunk belongs to. Chunks of
                       a run that was cut are dropped when they arrive late.
         opts.end      true on the last chunk of a run: speechend fires exactly
                       when it has played
         opts.audible  also sound the chunk (default: silent — the speech is
                       sounded elsewhere)
         opts.lead     seconds the lips run ahead of the sound (default 0.08)
         opts.release  seconds over which the mouth closes into a silence it
                       can see coming (default 0.18; 0 turns it off)
       Returns the seconds of audio queued ahead, so a sender can pace itself;
       an empty chunk just reports that figure (and may carry `end`). */
    function pushAudio(samples, sampleRate, opts) {
      opts = opts || {};
      const run = opts.run;
      if (run !== undefined && tl.cut.indexOf(run) >= 0) return queuedSeconds();
      if (!samples || (!samples.length && !samples.byteLength)) {
        if (opts.end && run === tl.run) tl.ended = true;
        return queuedSeconds();
      }
      let f32 = samples;
      if (!(samples instanceof Float32Array)) {
        const i16 = (samples instanceof Int16Array) ? samples
                  : new Int16Array(samples.buffer || samples, samples.byteOffset || 0, Math.floor(samples.byteLength / 2));
        f32 = new Float32Array(i16.length);
        for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;
      }
      const rate = sampleRate > 0 ? sampleRate : AN_RATE;
      if (typeof opts.lead === 'number') tl.lead = Math.max(0, Math.min(0.5, opts.lead));
      if (typeof opts.release === 'number') tl.release = Math.max(0, Math.min(0.5, opts.release));
      const nowP = performance.now();

      // where this chunk starts on the page clock
      let start;
      if (typeof opts.at === 'number' && isFinite(opts.at)) start = nowP + (opts.at - Date.now());
      else start = tl.end > nowP ? tl.end : nowP + Math.max(0, num(opts.delay, 0.05)) * 1000;
      // a chunk that follows the previous one (within 40 ms) continues its
      // segment: the analysis window and the resampler carry across the seam
      if (run === tl.run && rate === tl.inRate && tl.end > 0 && Math.abs(start - tl.end) < 40) start = tl.end;
      else {
        if (start < tl.end) dropQueued(undefined, start);      // an earlier play time replaces what was queued after it
        tl.ring.fill(0); tl.ringPos = 0; tl.sinceHop = 0; tl.mag.fill(0);
        tl.phase = 0; tl.last = 0; tl.inRate = rate;
        tl.segT0 = start; tl.segN = 0;
        if (run !== tl.run) { tl.run = run; tl.ended = false; }
      }

      // resample to 48 kHz (linear), sliding the analysis window; one lip frame per hop
      const step = rate / AN_RATE;
      const ring = tl.ring, n = f32.length;
      let pos = tl.phase;                       // in input samples; −1…0 reaches back to the previous chunk
      while (pos < n - 1) {
        let s;
        if (pos < 0) s = tl.last * -pos + f32[0] * (1 + pos);
        else { const i = pos | 0, fr = pos - i; s = f32[i] * (1 - fr) + f32[i + 1] * fr; }
        ring[tl.ringPos] = s; tl.ringPos = (tl.ringPos + 1) & (FFT_N - 1);
        tl.segN++;
        if (++tl.sinceHop === AN_HOP) { tl.sinceHop = 0; emitLipFrame(tl.segT0 + tl.segN * 1000 / AN_RATE, run); }
        pos += step;
      }
      tl.phase = pos - n; tl.last = f32[n - 1];

      const dur = n / rate * 1000;
      if (opts.audible) playChunk(f32, rate, start, run);
      tl.end = start + dur;
      if (opts.end) tl.ended = true;
      tl.active = true; tl.dry = 0;
      return queuedSeconds();
    }

    /* Stop streamed speech now — a person cut in. With no argument: everything
       queued is dropped. With a run id: that run only. Either way the run is
       remembered as cut, so chunks of it still on the wire are dropped when
       they land. */
    function cutAudio(run) {
      const id = run !== undefined ? run : tl.run;
      if (id !== undefined && tl.cut.indexOf(id) < 0) { tl.cut.push(id); if (tl.cut.length > 256) tl.cut.shift(); }
      dropQueued(run);
      if (run === undefined || run === tl.run) {
        // the queue now ends where what is left of other runs ends
        const lastLeft = tl.frames.length ? tl.frames[tl.frames.length - 1] : null;
        tl.end = lastLeft ? lastLeft.t : -1;
        tl.ended = false; tl.run = lastLeft ? lastLeft.run : undefined; tl.inRate = 0;
      }
      if (tl.spoke && (run === undefined || run === tl.spokeRun)) {
        tl.spoke = false; tl.prev = null;
        tl.snapUntil = performance.now() + 400;      // sound stopped dead: so does the mouth
        silenceLips();
        emit('speechend', { run: tl.spokeRun, reason: 'cut' });
      }
      if (tl.head >= tl.frames.length && !tl.spoke) { tl.active = false; tl.prev = null; if (!isPlayingFlag && !ext) silenceLips(); }
    }

    /* the lips for this moment, from the timeline. Returns true while it owns them. */
    function updateSpeech(nowP) {
      if (!tl.active) return false;
      const t = nowP + tl.lead * 1000;
      const frames = tl.frames;
      while (tl.head < frames.length && frames[tl.head].t <= t) tl.prev = frames[tl.head++];
      if (tl.head > 512) { frames.splice(0, tl.head); tl.head = 0; }
      const prev = tl.prev, next = frames[tl.head];
      const fresh = prev && t - prev.t < 2.5 * HOP_MS;
      let f = LIP_SILENT;
      if (fresh) {
        f = prev.v;
        if (next && next.t - prev.t < 2.5 * HOP_MS) {       // between two frames: blend, so any frame rate reads smoothly
          const a = (t - prev.t) / (next.t - prev.t);
          for (let i = 0; i < 9; i++) _mix[i] = prev.v[i] + (next.v[i] - prev.v[i]) * a;
          f = _mix;
        }
      }
      // Closing into silence. The channels are smoothed, so a mouth told to
      // close when the sound stops is still open ~200 ms later. The timeline
      // knows the silence is coming: over the last `release` seconds before
      // it, the open shapes taper off, and the mouth is shut as the sound ends.
      if (fresh && f[0] < 0.5 && tl.release > 0) {
        const R = tl.release * 1000;
        let toSilence = Infinity, lastT = prev.t;
        for (let i = tl.head; i < frames.length; i++) {
          const fr = frames[i];
          if (fr.t - t > R || fr.t - lastT > 2.5 * HOP_MS) { if (fr.t - lastT > 2.5 * HOP_MS) toSilence = lastT + HOP_MS - t; lastT = -1; break; }
          if (fr.v[0] >= 0.5) { toSilence = fr.t - t; lastT = -1; break; }
          lastT = fr.t;
        }
        // the queue ends inside the window: silence follows only if the run was flagged as ended
        if (lastT >= 0 && tl.ended && prev.run === tl.run) toSilence = lastT + HOP_MS - t;
        if (toSilence < R) {
          const k = Math.max(0, toSilence / R);
          if (f !== _mix) { _mix.set(f); f = _mix; }
          for (let i = 1; i < 9; i++) _mix[i] *= k;
        }
      }
      applyLipFrame(f);

      if (fresh) {
        tl.dry = 0;
        if (tl.spoke && prev.run !== tl.spokeRun) { tl.spoke = false; emit('speechend', { run: tl.spokeRun, reason: 'end' }); }
        if (!tl.spoke && f[0] < 0.5) { tl.spoke = true; tl.spokeRun = prev.run; emit('speechstart', { run: prev.run }); }
        return true;
      }
      if (next) return true;                                 // a gap before audio scheduled later: silent, still ours
      // nothing left to say
      if (tl.spoke) {
        const flagged = tl.ended && tl.spokeRun === tl.run;
        if (!flagged && !tl.dry) { tl.dry = nowP; emit('underrun', { run: tl.spokeRun }); }
        if (flagged || nowP - tl.dry > 250) {
          tl.spoke = false;
          emit('speechend', { run: tl.spokeRun, reason: flagged ? 'end' : 'dry' });
        } else return true;                                  // dry, but the run may still be coming
      }
      tl.active = false; tl.prev = null;
      return false;
    }

    function detachAudio() {
      cutAudio();
      if (!ext) return;
      if (ext.node) { try { ext.node.disconnect(ext.an); } catch (_) {} }
      if (ext.keep) { try { ext.keep.stop(); ext.keep.disconnect(); } catch (_) {} }
      try { ext.an.disconnect(); } catch (_) {}
      try { ext.sink.disconnect(); } catch (_) {}
      ext = null;
      if (!isPlayingFlag) silenceLips();
    }

    function getPlaybackTime() {
      if (!audioCtx || !audioBuffer) return 0;
      if (isPlayingFlag) return audioCtx.currentTime - audioStartCtxTime;
      return pausedAt || 0;
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
    function applyBackgroundColor(hex) {
      if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return;
      config.backgroundColor = hex;
      const c = hex2rgb(hex);
      scene.clearColor = new BABYLON.Color4(c[0], c[1], c[2], 1);
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
      // a fixed view ends any behaviour framing (its dim and mood stay), and
      // is what a later transient behaviour returns to
      behGliding = false;
      behName = null;
      behBase = null;
      clearTimeout(behTimer);
      behTimer = null;
      behPendingBack = null;
      camera.target.y = 0;
      camera.alpha  = v.alpha;
      camera.beta   = v.beta;
      camera.radius = v.radius;
    }

    /* ── behaviours: named framing recipes ──
       Each instance owns a copy of the recipe table, so one page can give
       every face its own. The camera stays private: a behaviour is the only
       way framing is asked for, and the glide is the library's. */
    const behaviours = {};
    for (const k of Object.keys(BEHAVIOURS)) behaviours[k] = Object.assign({}, BEHAVIOURS[k]);
    let behGlide = 0.5;          // default seconds to settle (overridable per recipe / call)
    let behGlideNow = 0.5;
    let behName = null;
    let behGliding = false;
    let behBase = null;          // the lasting behaviour a transient one returns to
    let behTimer = null;
    let behPendingBack = null;   // where the pending transient returns to
    let behHopAmp = 0, behHopT = 0;
    let personaMood = activeMood;
    const POSE_KEYS = ['yaw', 'pitch', 'zoom', 'dim', 'ty'];
    const pose       = { yaw: 0, pitch: 0, zoom: 1, dim: 1, ty: 0 };
    const poseTarget = { yaw: 0, pitch: 0, zoom: 1, dim: 1, ty: 0 };
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

    function applyMood(name) {
      if (!MOODS[name]) return;
      activeMood = name;
      for (const m of MOOD_NAMES) moodTargetWeights[m] = (m === name) ? 1 : 0;
    }

    /* brightness: a black foreground layer whose alpha is 1 − dim. In-engine,
       so the host's canvas styles are left alone. */
    let dimLayer = null;
    function applyDim(v) {
      const a = 1 - clamp(v, 0, 1);
      if (a < 0.004) { if (dimLayer) dimLayer.isEnabled = false; return; }
      if (!dimLayer) {
        dimLayer = new BABYLON.Layer('wfDim', null, scene, false);
        dimLayer.texture = BABYLON.RawTexture.CreateRGBATexture(
          new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false,
          BABYLON.Texture.NEAREST_SAMPLINGMODE);
        dimLayer.alphaBlendingMode = BABYLON.Engine.ALPHA_COMBINE;
      }
      dimLayer.isEnabled = true;
      dimLayer.color = new BABYLON.Color4(0, 0, 0, a);
    }

    /* start every glide from where the camera really is — the user may have
       dragged it, or setView() may have moved it. */
    function readCameraPose() {
      const a = -(camera.alpha + Math.PI / 2);
      pose.yaw   = Math.atan2(Math.sin(a), Math.cos(a));
      pose.pitch = Math.PI / 2 - camera.beta;
      pose.zoom  = BEHAVIOUR_RADIUS / Math.max(0.01, camera.radius);
      pose.ty    = camera.target.y;
    }

    function setBehaviour(name, opts, _quiet) {
      opts = opts || {};
      // a transient interrupted by another one still returns to the original place
      const pending = behTimer ? behPendingBack : null;
      clearTimeout(behTimer);
      behTimer = null;
      behPendingBack = null;
      if (name == null) {
        // release: brightness and focus return, the camera stays where it is
        readCameraPose();
        poseTarget.yaw = pose.yaw; poseTarget.pitch = pose.pitch; poseTarget.zoom = pose.zoom;
        poseTarget.dim = 1; poseTarget.ty = 0;
        behGlideNow = num(opts.glide, behGlide);
        behName = null; behBase = null; behGliding = true;
        if (!_quiet) emit('behaviour', { name: null });
        return true;
      }
      const r = (typeof name === 'object') ? name : behaviours[name];
      if (!r) return false;
      const label = (typeof name === 'string') ? name : '(custom)';
      const lasts = num(opts.for, num(r.for, 0));
      // what a transient behaviour comes back to: the lasting one before it,
      // or — when there was none — the framing and mood it interrupted
      let back = behBase || pending;
      readCameraPose();
      if (!back) back = { recipe: { yaw: pose.yaw, pitch: pose.pitch, zoom: pose.zoom, dim: pose.dim, _ty: pose.ty, mood: activeMood }, opts: {} };
      if (!(lasts > 0)) behBase = { recipe: name, opts: { side: opts.side, glide: opts.glide } };

      orbiting = false;
      const side = opts.side < 0 ? -1 : 1;
      poseTarget.yaw   = num(r.yaw, 0) * side;
      poseTarget.pitch = num(r.pitch, 0);
      poseTarget.zoom  = clamp(num(r.zoom, 1), 0.3, 6);
      poseTarget.dim   = clamp(num(r.dim, 1), 0, 1);
      poseTarget.ty    = num(r._ty, num(FOCUS_Y[r.focus], 0));
      behGlideNow = num(opts.glide, num(r.glide, behGlide));
      // the wheel-zoom limits must not clip a close-up or a distant shot
      const radius = BEHAVIOUR_RADIUS / poseTarget.zoom;
      camera.lowerRadiusLimit = Math.min(camera.lowerRadiusLimit, radius);
      camera.upperRadiusLimit = Math.max(camera.upperRadiusLimit, radius);
      // a hop already in the air is left to land
      if (num(r.hop, 0)) { behHopAmp = r.hop; behHopT = 0; }
      if (r.mood) applyMood(r.mood === 'persona' ? personaMood : r.mood);
      behName = label;
      behGliding = true;
      if (lasts > 0) {
        behPendingBack = back;
        behTimer = setTimeout(() => {
          behTimer = null;
          behPendingBack = null;
          if (_disposed) return;
          const keep = behBase;
          setBehaviour(back.recipe, back.opts, true);
          behBase = keep;
          if (!keep) behName = null;
          emit('behaviour', { name: behName, returned: true });
        }, lasts * 1000);
      }
      if (!_quiet) emit('behaviour', { name: behName });
      return true;
    }

    function defineBehaviours(input) {
      if (!input || typeof input !== 'object') return;
      const recipes = (input.recipes && typeof input.recipes === 'object') ? input.recipes : input;
      if (input.recipes && typeof input.glide_s === 'number') behGlide = Math.max(0, input.glide_s);
      for (const k of Object.keys(recipes)) {
        const r = recipes[k];
        if (r && typeof r === 'object') behaviours[k] = Object.assign({}, r);
      }
    }

    function updateBehaviour(dt) {
      if (behHopAmp) {
        behHopT += dt;
        if (behHopT > 1.2) { behHopAmp = 0; faceRoot.position.y = 0; }
        else faceRoot.position.y = behHopAmp * Math.abs(Math.sin(Math.PI * behHopT / 0.3)) * Math.exp(-3.5 * behHopT);
      }
      if (!behGliding) return;
      // exponential approach: ~95% of the way after behGlideNow seconds
      const k = 1 - Math.exp(-dt / Math.max(0.02, behGlideNow / 3));
      let rest = 0;
      for (const key of POSE_KEYS) {
        const d = poseTarget[key] - pose[key];
        pose[key] += d * k;
        rest = Math.max(rest, Math.abs(d));
      }
      if (rest < 0.0015) {
        // settled: stop writing the camera, so pointer drag works again
        for (const key of POSE_KEYS) pose[key] = poseTarget[key];
        behGliding = false;
      }
      camera.alpha    = -Math.PI / 2 - pose.yaw;
      camera.beta     = Math.PI / 2 - pose.pitch;
      camera.radius   = BEHAVIOUR_RADIUS / pose.zoom;
      camera.target.y = pose.ty;
      applyDim(pose.dim);
    }

    function applyGlow() {
      glowLayer.intensity = config.glow ? 0.85 : 0;
      // an effect layer at intensity 0 still renders its passes every frame;
      // switch it off entirely when the face has no glow
      glowLayer.isEnabled = !!config.glow;
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
    applyBackgroundColor(config.backgroundColor);
    applyMinimalSubVisibility();
    applyGlow();
    setView(config.cameraView);

    /* ── render loop ── */
    let lastT = performance.now();
    let _disposed = false;
    engine.runRenderLoop(() => {
      if (_disposed) return;
      const now = performance.now();
      // Real elapsed time, so glides, hops and lip smoothing keep their pace
      // on a slow device (every update here is an exponential approach or a
      // function of time — stable for any step). The cap only swallows the
      // jump after a hidden tab or a stall. Until v1.2.0 it was 0.05, which
      // ran everything in slow motion below 20 fps.
      const dt = Math.min(0.25, (now - lastT) / 1000);
      lastT = now;
      idleAnimate(dt);
      if (!updateSpeech(now) && (isPlayingFlag || ext)) analyzeAudioFrame();
      updateMoodBlend(dt);
      smoothChannels(dt);
      updateFace();
      updateBehaviour(dt);
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

      const prevBackground = config.backgroundColor;
      Object.assign(config, rc);
      // an unusable colour must not replace the stored one
      if (rc.backgroundColor !== undefined) {
        config.backgroundColor = prevBackground;
        applyBackgroundColor(rc.backgroundColor);
      }
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
        // the preset's mood is the face's own ('persona' in a behaviour recipe)
        personaMood = p.activeMood;
        applyMood(p.activeMood);
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
        if (!ext && !tl.active) silenceLips();
      },
      setLoop(b)        { config.loopAudio = !!b; if (audioSource) audioSource.loop = !!b; },
      /* muted playback still drives the lips: use it when the same speech is
         sounded somewhere else (another element, another process). */
      setMuted(b)       { muted = !!b; if (outGain) outGain.gain.value = muted ? 0 : 1; },
      isMuted()         { return muted; },
      attachAudio,
      pushAudio,
      cutAudio,
      detachAudio,
      isSpeaking()      { return tl.spoke; },
      on,
      setMood(name) {
        if (!MOODS[name]) return;
        personaMood = name;
        applyMood(name);
      },
      setBehaviour,
      defineBehaviours,
      getBehaviour()      { return behName; },
      getBehaviourNames() { return Object.keys(behaviours); },
      getBehaviours() {
        const out = {};
        for (const k of Object.keys(behaviours)) out[k] = Object.assign({}, behaviours[k]);
        return out;
      },
      /* opts.hold   keep the value until releaseChannel(name) (default: ~1.2s)
         opts.smooth ease to the value with the channel's own smoothing instead
                     of jumping — for values pushed at a low rate */
      setChannel(name, value, opts) {
        if (!CHANNELS[name]) return;
        const r = CHANNELS[name].range;
        const v = Math.max(r[0], Math.min(r[1], value));
        const smooth = !!(opts && opts.smooth);
        manualValue[name] = v;
        manualSmooth[name] = smooth;
        stateTarget[name] = v;
        if (!smooth) state[name] = v;
        manualLock[name] = true;
        clearTimeout(manualLock['_t_' + name]);
        manualLock['_t_' + name] = (opts && opts.hold)
          ? null
          : setTimeout(() => { manualLock[name] = false; }, 1200);
      },
      releaseChannel(name) {
        if (!CHANNELS[name]) return;
        clearTimeout(manualLock['_t_' + name]);
        manualLock[name] = false;
      },
      setView,
      loadPreset,
      /* lighter than loadPreset — apply a partial renderConfig without touching
         channelGains/activeMood. Intended for live UI controls (sliders, toggles,
         color pickers) where you change one field per call. */
      setRenderConfig(partial) { loadPreset({ renderConfig: partial }); },
      getRenderConfig() { return Object.assign({}, config); },
      /* the face's whole design as a preset — the JSON loadPreset() takes.
         Store it, and load it back to get the same face. */
      getPreset() {
        const gains = {};
        for (const ch of CHANNEL_NAMES) if (channelGains[ch] !== 1) gains[ch] = channelGains[ch];
        return {
          version: 'wireface-v010',
          createdAt: new Date().toISOString(),
          renderConfig: Object.assign({}, config),
          channelGains: gains,
          activeMood: personaMood,
        };
      },
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
        clearTimeout(behTimer);
        for (const n of CHANNEL_NAMES) clearTimeout(manualLock['_t_' + n]);
        try { detachAudio(); } catch (_) {}
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
