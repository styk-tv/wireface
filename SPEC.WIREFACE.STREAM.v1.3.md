# SPEC.WIREFACE.STREAM.v1.3

How **wireface 1.3** takes streamed speech: on a clock, in runs, with events.
It replaces §3.1 of [`SPEC.WIREFACE.BEHAVIOURS.v1.2`](SPEC.WIREFACE.BEHAVIOURS.v1.2.md)
(`pushAudio`); the rest of that document stands.

Audience: someone feeding a face from a conversation — a TTS stream, a voice
loop, a call — who needs the mouth to open with the sound, close with it, and
stop when a person cuts in. Written 2026-11-24 / v1.3.0.

---

## 0. What changed, and why

In 1.2 a chunk was played into a live analyser and the lips followed what the
analyser heard. That is faithful but late: the face cannot know the sound is
ending until it has ended, and every channel is smoothed. Measured on 1.2.0 in
a live voice loop: the mouth opened within 7–24 ms of the sound, but was still
open 207 ms after it stopped, and took about 300 ms to close after a cut.

Streamed speech is known **before** it sounds. So 1.3 analyses each chunk the
moment it arrives and places the result on a clock:

| | 1.2 | 1.3 |
|---|---|---|
| Lips come from | a live `AnalyserNode` | the same spectrum, computed on the samples, ahead of time |
| When a chunk plays | after the previous one; a run starts `delay` after its first chunk **arrives** | at an absolute time (`at`), or as before |
| Mouth opens | 7–24 ms after the sound | 50 ms before it |
| Mouth closed | 207 ms after the sound ends | 66 ms after; 18% open as it ends |
| Cut → mouth closed | about 300 ms | 83 ms |
| A late chunk of a cut utterance | moves the mouth again | dropped |
| Silent stream needs an `AudioContext` | yes (suspended until a user gesture) | no |
| "Is it speaking?" | the page's own timers | `speechstart` / `speechend` events |

The 1.2 column is the live voice loop above. The 1.3 column is this
repository's suite (`npm test`, group `timing`): a steady test tone at 60 fps.
The same suite with `lead` and `release` at 0 — the 1.2 behaviour — gives
+34 / +250 ms, and at 16 fps under software rendering the defaults give
−2 / +79 ms and 117 ms after a cut.

The lips themselves did not change. Same sample, 3 s: the live analyser gives
3.93 visemes active at once and a mean jaw opening of 0.526; the timeline
gives 3.92 and 0.529.

---

## 1. The call

```ts
pushAudio(samples, sampleRate, opts?) → secondsQueued

samples     Float32Array (−1 … 1) | Int16Array | ArrayBuffer of little-endian int16.  Mono.
sampleRate  the chunk's own rate, any value (8000 … 96000).
```

| Option | Type | Default | Meaning |
|---|---|---|---|
| `at` | ms | — | when this chunk's **first sample sounds**, on the wall clock (`Date.now()` scale) |
| `delay` | s | `0.05` | for chunks without `at`: the lead before a new run |
| `run` | string \| number | — | the utterance this chunk belongs to (§3) |
| `end` | bool | `false` | this is the run's last chunk (§3) |
| `audible` | bool | `false` | also sound the chunk. Default is silent: the speech is sounded elsewhere |
| `lead` | s | `0.08` | how far the lips run ahead of the sound (§5). Sticky: stays until set again |
| `release` | s | `0.18` | how early the mouth starts closing into a silence it can see coming (§5). Sticky |

Returns the seconds of audio queued ahead of now. An **empty chunk** queues
nothing and reports that figure; it may carry `{ run, end: true }` to flag a
run as finished after the fact.

Everything a 1.2 caller passed still means the same thing.

---

## 2. The clock

Each chunk is given a start time on the page's clock.

- **With `at`** — the chunk says when it sounds. Use this whenever the sender
  knows: a voice loop that plays the audio itself knows when each chunk reaches
  its speakers (`time it was made + seconds until the speakers get to it`).
  `at` is wall-clock milliseconds, the scale of `Date.now()` and of
  `time.time() * 1000` on the same machine. Arrival jitter no longer matters:
  ten chunks arriving 0–80 ms late each still open the mouth at the same
  moment (suite: `timing › arrival jitter`).
- **Without `at`** — chunks follow one another. A new run (the first chunk, or
  the first after the queue ran dry) starts `delay` seconds after it arrives.

Rules:

1. A chunk whose start is within 40 ms of the end of the previous chunk **of
   the same run and rate** continues it seamlessly: the analysis window and
   the resampler carry across the seam, so chunk boundaries leave no mark.
2. A chunk that starts later leaves a silent gap; the mouth closes in it.
3. A chunk that starts **earlier** than audio already queued replaces
   everything queued from that moment on. Chunks are expected in order.
4. A chunk whose time has already passed is not replayed: its past part is
   skipped, lips and sound alike.
5. With `audible`, the sound is scheduled for the same instant, compensated
   for the output device's latency where the browser reports it.

---

## 3. Runs — utterances, endings, and cutting in

A **run** is one utterance. Give every chunk of it the same `run` id (a
string or number, unique per utterance — a counter is enough) and set
`end: true` on its last chunk.

```js
wf.pushAudio(chunk, 22050, { at, run: 'answer-17' });
wf.pushAudio(lastChunk, 22050, { at, run: 'answer-17', end: true });
```

- `end` makes `speechend` fire exactly when the run has played, instead of
  250 ms after the audio stops arriving.
- `end` also lets the mouth close **into** the ending rather than after it.

```ts
cutAudio(run?) → void
```

A person cut in. `cutAudio()` drops everything queued, lips and sound, now.
`cutAudio(id)` drops that run only and leaves any other playing. Either way
the run is remembered as cut, so chunks of it that are still on the wire are
**dropped when they land** — they cannot reopen the mouth. The mouth closes
at three times its normal rate after a cut: sound that stops dead, stops dead.

`detachAudio()` does `cutAudio()` and also releases a source attached with
`attachAudio()`.

Run ids are optional. Without them `cutAudio()` still drops what is queued;
the protection against late chunks is what the id buys.

---

## 4. Events

```ts
on(event, fn) → unsubscribe      // call the returned function to stop listening
isSpeaking() → boolean
```

| Event | Detail | Fires |
|---|---|---|
| `speechstart` | `{ run }` | when the lips first move for a run |
| `speechend` | `{ run, reason }` | `reason: 'end'` — a flagged run finished, or the next run took over · `'cut'` — `cutAudio` · `'dry'` — an unflagged stream stopped arriving, 250 ms ago |
| `underrun` | `{ run }` | the queue ran dry in a run that was not flagged as ended — the sender fell behind, or stopped without saying so |
| `behaviour` | `{ name, returned? }` | a behaviour was set; `returned: true` when a transient one gave way to the behaviour before it. `name` is `null` when the framing was released — `setBehaviour(null)`, or a transient returning to a plain view |

A pause inside an utterance is not a `speechend`: one run is one
`speechstart` and one `speechend`, however many chunks and silences it holds.

The events come from the lips, so they lead the sound by `lead`. A page that
drives behaviours from them needs no timers of its own:

```js
wf.on('speechstart', () => wf.setBehaviour('speak'));
wf.on('speechend',   () => wf.setBehaviour('listen'));
```

A listener that throws is reported to the console and does not stop the others.

---

## 5. Timing: `lead` and `release`

Two numbers decide how the mouth sits against the sound.

- **`lead`** shifts the whole lip track earlier. Channels are smoothed (the
  jaw's time constant is about 95 ms), so lips that start *with* the sound
  look late. At `0.08` the mouth begins to open 50 ms ahead — which is also
  what mouths do.
- **`release`** is the closing. Over the last `release` seconds before a
  silence the timeline can see — a pause already queued, or the end of a run
  flagged with `end` — the open shapes taper off, so the mouth arrives closed
  instead of starting to close. `0` turns it off.

Measured on a steady tone at 60 fps, mouth-open and mouth-closed taken at a
jaw opening of 0.05:

| `lead` | `release` | opens | open as the sound ends | closed |
|---|---|---|---|---|
| 0 | 0 | +34 ms | 100% | +250 ms |
| 0.06 | 0 | −21 ms | 54% | +199 ms |
| 0.06 | 0.12 | −39 ms | 29% | +120 ms |
| **0.08** | **0.18** | **−50 ms** | **18%** | **+66 ms** |
| 0.10 | 0.20 | −60 ms | 13% | +40 ms |

Without `end`, the last word of an utterance cannot be anticipated — the
library does not know it is the last. Measured: closed at +166 ms and still
49% open as the sound ends, against +66 ms and 18% with the flag. Flag your
runs.

If your speech is sounded by another process and you only know its latency
roughly, tune with `lead`: raise it if the lips look late, lower it if early.

---

## 6. The analysis is the same one

`pushAudio` computes, on the samples, what an `AnalyserNode` with
`fftSize 1024` and `smoothingTimeConstant 0.4` reports at 60 frames a second:
the latest 1024 samples at 48 kHz, Blackman window, magnitude over N, smoothed
across frames, in dB, mapped −100 … −30 dB onto 0 … 255. Chunks at other rates
are resampled to 48 kHz first. The five band energies then go through the same
viseme allocation as `loadAudio()`/`play()` and `attachAudio()`.

Between two lip frames the render loop interpolates, so the lips are as smooth
at 50 or 120 fps as at 60.

`attachAudio()` and `loadAudio()`/`play()` still use the live analyser: a
`MediaStream` cannot be read ahead of time. They have no `lead` or `release`.

---

## 7. Compatibility with 1.2

Every 1.2 call keeps its signature and its meaning. What a 1.2 page will see
differently after upgrading, without changing a line:

| | 1.2.0 | 1.3.0 |
|---|---|---|
| Stream lips against the sound | open +7…+24 ms, closed ≈ +207 ms | open −50 ms, closed ≈ +165 ms (no `end` flag yet) |
| After `detachAudio()` | closed in ≈ 300 ms | closed in ≈ 85 ms |
| Silent `pushAudio` | created an `AudioContext` | creates none |
| Motion below 20 fps | glides, hops and lip smoothing ran in slow motion | real time |
| A face with `glow: false` | still paid for the glow passes | does not |
| `setView()` then a transient behaviour | returned to the behaviour before the `setView` | returns to the view |
| The `surprise` mood (and `important`, `cut`, `jump`) | brows only | brows and a dropped jaw, as documented |

To get the closing precision, add `run` and `end`. To get immunity from
arrival jitter, add `at`.

---

## 8. A sender, start to finish

```js
// one face per speaker; chunks arrive over any ordered transport
let n = 0;
function onUtteranceStart()        { run = 'u' + (++n); }
function onChunk(pcm, rate, playsAt, isLast) {
  wf.pushAudio(pcm, rate, { at: playsAt, run, end: isLast });
}
function onPersonCutsIn()          { wf.cutAudio(); }

wf.on('speechstart', () => wf.setBehaviour('speak'));
wf.on('speechend',   e => wf.setBehaviour(e.reason === 'cut' ? 'attend' : 'listen'));
wf.on('underrun',    e => console.warn('speech fell behind', e.run));
```

A sender with no clock omits `at` and paces itself on the return value:

```js
const EMPTY = new Int16Array(0);
function pump() {                                   // every ~40 ms
  let ahead = wf.pushAudio(EMPTY, RATE);
  while (ahead < 0.15 && haveChunk()) ahead = wf.pushAudio(nextChunk(), RATE, { run, end: isLast() });
}
```

Checklist:

1. One instance per speaker; push each speaker's chunks to its own face.
2. A new `run` id per utterance; `end: true` on its last chunk.
3. `at` if you know when the chunk sounds; otherwise let chunks follow.
4. `cutAudio()` when a person interrupts.
5. Drive `speak` / `listen` from the events.

---

## 9. Tests

```bash
npm test                 # the suite, headless, against wireface.js
npm run test:min         # the same checks against dist/wireface.min.js
node test/run.mjs --only=timing --headed
node test/run.mjs --software          # software WebGL, as CI runs it
```

The suite runs in a real browser against the real library — no mocks — and
prints the measurements quoted in this document. It needs Node 22+ and an
installed Chrome; it has no dependencies.
