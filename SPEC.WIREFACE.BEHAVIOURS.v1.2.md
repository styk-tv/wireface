# SPEC.WIREFACE.BEHAVIOURS.v1.2

What **wireface 1.2** adds for pages that run one or more faces from live
events and streamed speech: **behaviours** (named framing), **stream input**
(lips from audio the library does not load as a file), **designs** (presets as
the stored look of a face, background included), and **held channels**.

Pair with [`SPEC.WIREFACE.GRAMMAR.v1.0`](SPEC.WIREFACE.GRAMMAR.v1.0.md)
(channels, moods, `renderConfig`) and
[`SPEC.WIREFACE.BABYLON.9.0`](SPEC.WIREFACE.BABYLON.9.0.md) (how the scene is
built). Reference page: [`examples/behaviours.html`](examples/behaviours.html).

Audience: someone wiring wireface into a page that already knows *what is
happening* (who speaks, who waits, what just arrived) and wants the faces to
show it without owning any camera or lip-sync code. Written 2026-11-24 / v1.2.0.

---

## 0. The rule this release follows

The page says **what is going on**. The library owns **how the face shows it**.

| The page used to do | From 1.2 the page calls |
|---|---|
| reach into the Babylon scene and move the camera | `setBehaviour(name)` |
| set `canvas.style.filter = brightness(…)` | the behaviour's `dim` |
| set `scene.clearColor` | `renderConfig.backgroundColor` |
| compute loudness + one mouth shape and push viseme channels | `pushAudio(chunk, rate)` or `attachAudio(source)` |
| keep a private copy of each face's settings | `getPreset()` / `loadPreset()` |

No camera object, angle or zoom setter is exposed. `setView()` keeps its four
fixed views.

---

## 1. API added in 1.2

```ts
interface WireFace {
  // behaviours
  setBehaviour(name | recipe | null, opts?: { side?: 1 | -1, glide?: number, for?: number }): boolean
  defineBehaviours(recipes | { recipes, glide_s }): void
  getBehaviour(): string | null
  getBehaviourNames(): string[]
  getBehaviours(): { [name]: recipe }

  // lips from audio the library did not load
  pushAudio(samples, sampleRate, opts?: { audible?: boolean, delay?: number }): number
  attachAudio(source: MediaStream | AudioNode): void
  detachAudio(): void
  setMuted(bool): void
  isMuted(): boolean

  // designs
  getPreset(): Preset                       // the JSON loadPreset() takes
  // renderConfig.backgroundColor: '#rrggbb'

  // held channels
  setChannel(name, value, opts?: { hold?: boolean, smooth?: boolean }): void
  releaseChannel(name): void
}
```

Everything in 1.1.5 is still there with the same signatures.

---

## 2. Behaviours

A behaviour is a named **recipe**. Setting one glides the face there — framing,
brightness and mood together — the same way `setMood(name)` fades an expression.

### 2.1 Recipe fields

| Field | Unit | Meaning |
|---|---|---|
| `yaw` | radians | how far the face is turned away from the viewer. `0` faces you; `0.6` is a three-quarter turn |
| `pitch` | radians | positive looks down, negative looks up |
| `zoom` | ratio | `1` is normal, bigger is closer. Clamped to `0.3 … 6` |
| `dim` | `0 … 1` | brightness of the whole frame, background included |
| `mood` | name | a mood name, or `"persona"` for the face's own mood (§2.5). Omitted: the mood is left alone |
| `focus` | name | what the shot centres on: `face` (default), `center` (eyes-nose-mouth), `eyes`, `nose`, `mouth` |
| `hop` | scene units | height of a short bounce on entry (the face is about 2.2 units tall) |
| `for` | seconds | makes the behaviour **transient**: after this long the face returns to where it was (§2.4) |
| `glide` | seconds | settle time for this recipe; default `0.5` |
| `toward` | bool | advisory, for the page: this behaviour is meant to turn toward someone — pass `opts.side` (§2.3) |

Unknown fields are kept and returned by `getBehaviours()`, so a page can carry
its own annotations in the same table.

### 2.2 Built-in names

States — what a face in a group is doing:

| Name | yaw | pitch | zoom | dim | mood | toward |
|---|---|---|---|---|---|---|
| `asleep` | 0.60 | 0.10 | 0.80 | 0.55 | sleep | |
| `parked` | 0.65 | 0.05 | 0.82 | 0.60 | neutral | yes |
| `idle` | 0.45 | 0.00 | 0.90 | 0.75 | neutral | yes |
| `waiting` | 0.30 | 0.00 | 0.95 | 0.85 | neutral | yes |
| `busy` | 0.25 | 0.22 | 1.00 | 0.90 | fear | |
| `listen` | 0.00 | −0.04 | 1.10 | 1.00 | neutral | |
| `speak` | 0.00 | 0.00 | 1.22 | 1.00 | persona | |
| `attend` | 0.00 | −0.06 | 1.35 | 1.00 | happy | |
| `important` | 0.00 | −0.08 | 1.35 | 1.00 | surprise | |
| `cut` | 0.15 | 0.08 | 1.05 | 0.90 | surprise | |

Shots — framing to make a moment:

| Name | yaw | pitch | zoom | dim | mood | extra | Use |
|---|---|---|---|---|---|---|---|
| `point` | 0.00 | −0.03 | 1.70 | 1.00 | persona | | zoom in to make a point |
| `distant` | 0.50 | 0.04 | 0.55 | 0.70 | neutral | `toward` | far off, looking a bit away |
| `away` | 0.80 | 0.06 | 0.90 | 0.80 | neutral | | turned away at normal distance |
| `work` | 0.30 | 0.32 | 0.95 | 0.85 | neutral | | head down, focused on work |
| `jump` | 0.00 | −0.06 | 1.30 | 1.00 | surprise | `hop 0.30`, `for 1.6` | jumps for attention, then returns |
| `closeup` | 0 | 0 | 2.20 | 1.00 | persona | `focus center` | extreme close-up: eyes, nose and mouth fill the frame |
| `closeup-eyes` | 0 | 0 | 2.40 | 1.00 | persona | `focus eyes` | |
| `closeup-nose` | 0 | 0 | 3.00 | 1.00 | persona | `focus nose` | |
| `closeup-mouth` | 0 | 0 | 2.80 | 1.00 | persona | `focus mouth` | |

### 2.3 Calls

```js
wf.setBehaviour('speak');                       // glide to a named recipe → true
wf.setBehaviour('idle', { side: -1 });          // mirror the yaw: turn the other way
wf.setBehaviour('point', { glide: 0.2 });       // faster settle for this call
wf.setBehaviour('attend', { for: 1.6 });        // any behaviour can be made transient
wf.setBehaviour({ yaw: 0.2, zoom: 1.5 });       // a one-off recipe, not stored
wf.setBehaviour(null);                          // release: brightness and focus return, camera stays
wf.setBehaviour('nope');                        // unknown name → false, nothing changes
```

`side` is how a page turns faces **toward** whoever holds the floor: for a row
of faces, pass `Math.sign(myIndex - floorIndex) || 1`.

```js
wf.defineBehaviours({ thinking: { yaw: 0.2, pitch: 0.25, zoom: 1.0, dim: 0.9, mood: 'neutral' } });
wf.defineBehaviours({ recipes: { … }, glide_s: 0.5 });   // a whole file: recipes + default glide
```

`defineBehaviours` adds or replaces recipes **on that instance only**. Each
face owns its table, so faces on one page may differ.

### 2.4 Rules

1. **Glide.** Every value approaches its target exponentially and is about 95%
   there after `glide` seconds. The glide starts from where the camera actually
   is, so it is correct after a pointer drag or a `setView()`.
2. **Settled means hands off.** Once the glide has settled the library stops
   writing the camera; pointer orbit and wheel zoom work until the next
   `setBehaviour`.
3. **Transient behaviours return.** A behaviour with `for` goes back to the
   last lasting behaviour (with its `side`), or — if there was none — to the
   framing and mood it interrupted. A transient interrupted by another
   transient still returns to the original place.
4. **`setView()` ends the framing.** It snaps to its fixed view, recentres the
   shot and clears `getBehaviour()`. Brightness and mood stay as they are; call
   `setBehaviour(null)` to bring brightness back.
5. **Zoom limits.** The wheel-zoom limits widen as needed so a close-up or a
   distant shot is never clipped.
6. **Idle motion continues.** Blinks, eye saccades and the head sway run under
   every behaviour.

### 2.5 Persona

`"persona"` in a recipe means *this face's own mood*: the `activeMood` of the
last preset loaded, or the last mood the page set with `setMood()`. A behaviour
that sets a mood (`busy` → fear) does not change the persona, so `speak` brings
the face's own mood back.

---

## 3. Stream input — lips from audio that is not a file

The lips are driven by one analysis (five spectral bands → proportional viseme
weights + jaw opening, every rendered frame). 1.2 lets three more kinds of
audio into that same analysis. Use whichever matches how the speech reaches
the page.

| The speech is… | Call | Sound from wireface |
|---|---|---|
| PCM chunks arriving over a socket / SSE / worker | `pushAudio(chunk, rate)` | silent, unless `{ audible: true }` |
| a `MediaStream` (WebRTC, microphone, `captureStream()`) | `attachAudio(stream)` | never |
| a node in your own Web Audio graph | `attachAudio(node)` | never (you play it) |
| a file or blob, sounded somewhere else | `loadAudio(blob)`, `setMuted(true)`, `play(offset)` | none while muted |

### 3.1 `pushAudio(samples, sampleRate, opts?) → secondsQueued`

- `samples`: `Float32Array` (−1 … 1), `Int16Array`, or an `ArrayBuffer` of
  little-endian int16. Mono.
- `sampleRate`: the chunk's own rate (e.g. `22050`, `24000`); the audio context
  resamples.
- Chunks are queued back to back. A new run — the first chunk, or the first
  after the queue ran dry — starts `opts.delay` seconds from now (default
  `0.05`). When the same speech is sounded by another process, set `delay` to
  that path's latency so lips and sound line up.
- `opts.audible: true` also plays the chunks, for pages where wireface is the
  speaker.
- Returns the seconds of audio queued ahead. An **empty chunk** queues nothing
  and just reports that figure — use it to pace a sender:

```js
const EMPTY = new Int16Array(0);
function pump() {                       // every ~40 ms
  let ahead = wf.pushAudio(EMPTY, RATE);
  while (ahead < 0.15 && haveChunk()) ahead = wf.pushAudio(nextChunk(), RATE);
}
```

- When the queue runs dry the mouth closes by itself within about 100 ms; the
  next chunk starts a new run. No "end of speech" call is needed.
- One face, one stream: push each speaker's chunks to that speaker's instance.

### 3.2 `attachAudio(source)` / `detachAudio()`

- `source` is a `MediaStream` or any `AudioNode`. A node may belong to your own
  `AudioContext`; the analysis is created in that context.
- wireface taps the source into a zero-gain sink. It never makes attached
  audio audible and never disconnects your node from anything else.
- While a source is attached (or a chunk stream is running) it owns the lips,
  ahead of the library's own playback. `detachAudio()` ends either kind and
  closes the mouth.

### 3.3 Muted playback

`setMuted(true)` keeps `loadAudio()`/`play()` analysing while producing no
sound; `play(offset)` seeks. It is the simplest path when the page can fetch
the same audio that is being sounded elsewhere.

### 3.4 Why not push mouth shapes

Pushing shapes with `setChannel('viseme_*', …)` still works, and `{ smooth:
true }` (§5) makes low-rate values ease instead of step. But it cannot match
the analysis. Measured on the bundled speech sample, 6 s, 60 fps:

| Lips driven by | Visemes active at once | Frames where the mouth changes | Mean jaw opening |
|---|---|---|---|
| `loadAudio` + `play` (the reference) | 4.0 | 98% | 0.50 |
| muted playback | 4.0 | 99% | 0.50 |
| `attachAudio(MediaStream)` | 4.0 | 98% | 0.50 |
| `attachAudio(AudioNode)` | 4.0 | 99% | 0.50 |
| `pushAudio`, 50 ms chunks of 22.05 kHz int16 | 4.0 | 100% | 0.51 |
| one loudness + one shape every 50 ms via `setChannel` | 1.0 | 29% | 0.00 |

The four stream paths are indistinguishable from the reference. The pushed
shape is one viseme at a time, changes on fewer than a third of the frames,
and never opens the jaw.

---

## 4. Designs — presets as the stored look of a face

A **design** is a preset: the JSON object `loadPreset()` takes. Pick one as the
starting point, vary it, store the result.

```js
const base = await fetch('examples/presets/asset-8pgwi9.json').then(r => r.json());
wf.loadPreset(base);                                   // pick the design
wf.setRenderConfig({ backgroundColor: '#0d0707',       // make it this face's own
                     meshCols: 19, scaleEyes: 1.2 });
const design = wf.getPreset();                         // store this JSON
// later, anywhere:
wf.loadPreset(design);                                 // the same face
```

### 4.1 Stored format

`getPreset()` returns exactly the preset shape, nothing wireface-private:

```jsonc
{
  "version": "wireface-v010",
  "createdAt": "2026-11-24T13:11:40.512Z",
  "renderConfig": { "meshCols": 19, "backgroundColor": "#0d0707", … },   // every renderConfig field
  "channelGains": { "jawOpen": 1.4 },                                     // only gains that are not 1
  "activeMood": "neutral"                                                  // the face's persona (§2.5)
}
```

It is about 1.2 kB of JSON. Extra top-level keys (`id`, `name`, your own) are
ignored by `loadPreset()`, so a page may add its own bookkeeping. Behaviour
recipes are **not** part of a design; store them beside it and apply them with
`defineBehaviours()`.

### 4.2 Bundled designs

| File | Look |
|---|---|
| `examples/presets/asset-8pgwi9.json` | 17×23 red wire, heavy white brows, jaw pushed forward |
| `examples/presets/asset-kln33e.json` | 9×9 blocky low-poly red wire, wide spread |
| `examples/presets/asset-th5rha.json` | 21×21 dense rose wire, large glowing irises |
| `examples/presets/asset-ydr7de.json` | 7×9 sparse blue-grey wire, exaggerated mouth |

A face created with no preset uses the library defaults: a plain white 17×21
wire. From the CDN the files are at
`https://cdn.jsdelivr.net/npm/wireface@1/examples/presets/<file>`.

### 4.3 Making faces differ

Faces from the same base read as different with two or three small changes.
Fields that change character the most, cheapest first:

| Change | Fields |
|---|---|
| colour | `baseColor`, `lineColor`, `fadeColor`, `backgroundColor`, `irisColor`, `pupilColor`, `browColor` |
| density | `meshCols`, `meshRows` (7–9 is blocky, 17–23 is smooth) |
| proportions | `scaleEyes`, `scaleNose`, `scaleMouth`, `spread` |
| eyes | `eyeHoles`, `eyeHoleSize`, `eyeDepth`, `irisSize` |
| line weight | `lineThickness`, `browLineThickness`, `mouthLineThickness` |

### 4.4 `backgroundColor`

`renderConfig.backgroundColor` is a `#rrggbb` string, default `#000000`. It is
applied by `loadPreset()` and `setRenderConfig()`, returned by
`getRenderConfig()` and `getPreset()`, and has a picker in
[`examples/editor.html`](examples/editor.html). A value that is not `#rrggbb`
is ignored and the stored colour is kept. A preset without the field leaves
the current background unchanged.

---

## 5. Held channels

```js
wf.setChannel('headRotateY', 0.5);                   // as before: override for ~1.2 s
wf.setChannel('headRotateY', 0.5, { hold: true });   // stays until released
wf.releaseChannel('headRotateY');
wf.setChannel('jawOpen', 0.8, { smooth: true });     // eases there instead of jumping
```

- **Fix.** Before 1.2 a manual value on a channel that something else drives
  every frame — the head (idle sway), the eyes (saccades), the mood channels,
  the visemes during playback — was overwritten in the frame it was set. Manual
  values are now kept apart from the driven targets and win while the override
  lasts.
- A held head pose keeps the idle sway on top of it, so the head stays alive.
- `hold` and `smooth` combine. `releaseChannel` hands the channel back to its
  driver.

---

## 6. Compatibility with 1.1.5

Additive. No call was removed or changed in signature; presets saved by any
earlier version load unchanged.

Two behaviours differ, both fixes:

| Area | 1.1.5 | 1.2.0 |
|---|---|---|
| `setChannel` on a driven channel | overwritten in the same frame | holds for ~1.2 s, as documented |
| `setView()` | left the shot centre where it was | recentres the shot (only differs after a close-up) |

Pages that reach into the scene (`scene.activeCamera`, `scene.clearColor`,
canvas `filter`) keep working, but fight the library if they also call
`setBehaviour`. Move to the calls in §0 and drop the workaround.

---

## 7. Moving a page onto 1.2 — checklist

1. Load each face's design with `loadPreset()`; put the background in it.
2. Keep your event → behaviour mapping; replace the camera, brightness and mood
   code with one `setBehaviour(name, { side })` per face per change.
3. If your recipes differ from §2.2, pass your table to `defineBehaviours()`.
4. Send speech as audio (`pushAudio` or `attachAudio`), not as mouth shapes.
5. Store `getPreset()` wherever the page keeps a face's settings.
