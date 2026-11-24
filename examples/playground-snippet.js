// wireface — Babylon Playground snippet (v7 candidate)
// paste into https://playground.babylonjs.com/, hit Run (don't save until verified).
// minimal: face + audio + keyboard. NO DOM injection — that belongs in
// examples/playground.html (which we own). Keep this snippet polite.

export const createScene = function () {
  // ── tear down previous instance (multiple Run presses) ───────────────────
  if (window.wf && window.wf.dispose) { try { window.wf.dispose(); } catch (e) {} }
  if (window._wfKey)  { document.removeEventListener('keydown', window._wfKey); window._wfKey = null; }
  if (window._wfPoll) { clearInterval(window._wfPoll); window._wfPoll = null; }

  const canvas = engine.getRenderingCanvas();
  const scene  = new BABYLON.Scene(engine);   // placeholder so the Playground is happy

  // ── PRESETS (4) ──────────────────────────────────────────────────────────
  const PRESETS = [
    {"version":"wireface-v010","createdAt":"2026-05-01T14:17:22.023Z","renderConfig":{"meshCols":17,"meshRows":23,"scaleNose":0.7000000000000001,"scaleEyes":0.45,"scaleMouth":1.1,"reactivity":0.22,"spread":1,"mode":"wire","pupils":true,"meshVisible":true,"minimal":true,"fragment":true,"glow":true,"flipFace":true,"loopAudio":true,"mouthHole":true,"mouthHoleSize":0.9,"eyeHoleSize":1.9500000000000002,"eyeHoles":true,"eyeDepth":0,"mouthAnchor":true,"eyeAnchor":true,"lineThickness":1,"lipVertAmp":0.5,"lipPressForce":0,"overlayTracksMesh":true,"moodTransitionTime":0.6000000000000001,"lineColor":"#ffffff","pupilColor":"#3e0f0f","baseColor":"#ca5858","fadeColor":"#000000","depthFade":1,"irisColor":"#121212","irisSize":1.6,"browColor":"#ffffff","jawExtend":1.1500000000000001,"mouthGrow":0,"depthFadeCurve":3,"upperJawProtrude":1.4500000000000002,"lowerJawProtrude":2.45,"mouthColor":"#454a1c","eyeColor":"#2c2b2b","noseColor":"#ffffff","minimalMouth":true,"minimalEyes":true,"minimalNose":false,"minimalBrows":false,"mouthLineThickness":0.2,"eyeLineThickness":0.2,"noseLineThickness":0.2,"browLineThickness":4},"channelGains":{},"activeMood":"neutral","moodTargetWeights":{"neutral":1},"id":"8pgwi9","name":"Wireface-001_8pgwi9"},
    {"version":"wireface-v010","createdAt":"2026-05-01T15:13:02.043Z","renderConfig":{"meshCols":9,"meshRows":9,"scaleNose":1.05,"scaleEyes":1.4,"scaleMouth":1.5500000000000003,"reactivity":0.3,"spread":1.6500000000000001,"mode":"wire","pupils":true,"meshVisible":true,"minimal":true,"fragment":true,"glow":true,"flipFace":true,"loopAudio":true,"mouthHole":true,"mouthHoleSize":0.9,"eyeHoleSize":0.9500000000000001,"eyeHoles":true,"eyeDepth":3.1500000000000004,"mouthAnchor":true,"eyeAnchor":true,"lineThickness":1,"lipVertAmp":0.5,"lipPressForce":0,"overlayTracksMesh":true,"moodTransitionTime":0.6000000000000001,"lineColor":"#ffffff","pupilColor":"#3e0f0f","baseColor":"#ca5858","fadeColor":"#000000","depthFade":1,"irisColor":"#121212","irisSize":1.6,"browColor":"#ffffff","jawExtend":1.1500000000000001,"mouthGrow":0,"depthFadeCurve":3,"upperJawProtrude":1.4500000000000002,"lowerJawProtrude":2.45,"mouthColor":"#454a1c","eyeColor":"#2c2b2b","noseColor":"#ffffff","minimalMouth":true,"minimalEyes":true,"minimalNose":false,"minimalBrows":false,"mouthLineThickness":0.2,"eyeLineThickness":0.2,"noseLineThickness":0.2,"browLineThickness":4},"channelGains":{},"activeMood":"neutral","moodTargetWeights":{"neutral":1},"id":"kln33e","name":"Wireface-001_kln33e"},
    {"version":"wireface-v010","createdAt":"2026-05-01T02:19:44.566Z","renderConfig":{"meshCols":21,"meshRows":21,"scaleNose":0.4,"scaleEyes":1.35,"scaleMouth":0.4,"reactivity":0.24,"spread":0.9,"mode":"wire","pupils":true,"meshVisible":true,"minimal":true,"fragment":true,"glow":true,"flipFace":true,"loopAudio":true,"mouthHole":true,"mouthHoleSize":1.15,"eyeHoles":true,"eyeDepth":5,"mouthAnchor":true,"eyeAnchor":true,"lineThickness":0.4,"lipVertAmp":4,"lipPressForce":3,"overlayTracksMesh":true,"moodTransitionTime":0.05,"lineColor":"#541717","pupilColor":"#c4b0b0","baseColor":"#ff8585","fadeColor":"#f00000","depthFade":1,"irisColor":"#ff0000","irisSize":3.3,"browColor":"#616161","jawExtend":0,"mouthGrow":0},"channelGains":{},"activeMood":"neutral","moodTargetWeights":{"neutral":1},"id":"th5rha","name":"asset__post__th5rha"},
    {"version":"wireface-v010","createdAt":"2026-05-01T02:00:12.074Z","renderConfig":{"meshCols":7,"meshRows":9,"scaleNose":1.15,"scaleEyes":2,"scaleMouth":2,"reactivity":0.26,"spread":0.8,"mode":"wire","pupils":true,"meshVisible":true,"minimal":true,"fragment":true,"glow":true,"flipFace":true,"loopAudio":true,"mouthHole":true,"mouthHoleSize":1.85,"eyeHoles":false,"eyeDepth":1,"mouthAnchor":true,"eyeAnchor":false,"lineThickness":1,"lipVertAmp":1.6,"lipPressForce":0,"overlayTracksMesh":true,"moodTransitionTime":0.05,"lineColor":"#181616","pupilColor":"#3a2727","baseColor":"#7a86c2","fadeColor":"#f00000","depthFade":0.4,"irisColor":"#170303","irisSize":2,"browColor":"#616161","jawExtend":0,"mouthGrow":0},"channelGains":{},"activeMood":"neutral","moodTargetWeights":{"neutral":1},"id":"ydr7de","name":"asset__post__ydr7de"},
  ];

  // ── load wireface@1.1.5 from CDN, then init ──────────────────────────────
  const init = () => {
    // wireface creates its OWN engine on the canvas. Stop the Playground's
    // render loop so the two engines don't fight for pointer input — that's
    // what was causing inverted-drag in left-handed-vs-right-handed mode.
    try { engine.stopRenderLoop(); } catch (e) {}

    const wf = createWireface(canvas);
    wf.setLoop(true);

    let idx = 0;
    const apply = () => wf.loadPreset(PRESETS[idx]);
    apply();

    window._wfKey = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        idx = (idx + 1) % PRESETS.length; apply();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        idx = (idx - 1 + PRESETS.length) % PRESETS.length; apply();
      } else if (e.key === ' ') {
        wf.isPlaying() ? wf.pause() : wf.play();
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', window._wfKey);

    fetch('https://cdn.jsdelivr.net/gh/styk-tv/wireface@main/examples/Wireface-001-kokoro-santa.mp3')
      .then(r => r.blob())
      .then(blob => wf.loadAudio(new File([blob], 'sample.mp3')))
      .then(() => wf.play())
      .catch(() => {});

    window.wf = wf;
  };

  if (window.createWireface) {
    init();
  } else {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/wireface@1.1.5/dist/wireface.min.js';
    s.onload = init;
    document.head.appendChild(s);
  }

  return scene;
};
