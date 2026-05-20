# Sound Lab — procedural audio recipes + editor tab

A canonical plan for cardboard's **Sound Lab**: a procedural audio
generation engine (JSON recipes → Web Audio node graphs) plus the
top-level editor tab that authors them. Sibling to
[IMAGE_LAB.md](./IMAGE_LAB.md) — the two share the same 4-column
editor shell; this doc cross-references Image Lab's §7.1 rather
than duplicating the shell grammar.

Cross-refs: [IDEAS.md](../IDEAS.md) (the 2026-05-16 "Procedural
assets (image + audio recipe DSL)" entry that seeded both labs),
[AUDIO.md](./AUDIO.md) (cardboard's main audio plan — Sound Lab is
an authoring layer on top of `manifest.sounds` and `api.audio.*`;
specifically dovetails with AUDIO §11 question 10 "AudioWorklet
for future DSP"), [IMAGE_LAB.md](./IMAGE_LAB.md) (sibling — shared
4-column shell, canonical in its §7.1),
[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) (visual palette + tab
strip — Sound Lab joins the PrimaryTabs list, taking the count
from 7 to 10 once Image Lab + UI Builder + Sound Lab all land),
the materials plan (shipped — tone / density reference for this
plan doc; see git log), [PACK_CHAIN.md](./PACK_CHAIN.md) (recipe-id collision +
last-wins override semantics, identical to `sounds`),
[ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md) (bake-and-preview
pattern precedent — `apps/editor/src/views/AnimationEditor.tsx`
shows the source-vs-baked split this plan reuses), `Editor
Design/SoundLab.png` (visual reference — illustrative, **not**
authoritative; tab strip + property names may diverge).

Last revised: 2026-05-16.

---

## 0. tl;dr

Sound Lab ships a node-graph authoring surface for procedural
audio. Authors compose oscillators, filters, envelopes,
modulators and samplers in a visual graph; the engine compiles
that JSON recipe into a Web Audio node graph at pack-load time.

Three output modes share one recipe schema:

1. **Static one-shot** — graph is rendered to an `AudioBuffer`
   via `OfflineAudioContext` once (at pack load, then cached in
   IDB). Cheapest at runtime — same cost as a hand-authored
   `.ogg` sample. Best for sfx.
2. **Loop** — same as static, but `BufferSource.loop = true` and
   the renderer is asked for a clean seam. Best for ambient beds.
3. **Realtime instrument** — graph is instantiated *live* per
   voice trigger. No bake. Best for music synths and reactive
   sfx that need per-trigger modulation.

The shipped asset is the JSON recipe — typically a few hundred
bytes. Authors get the cardboard-y win the IDEAS.md entry
described: a 50KB rasterized sfx replaced by a 300-byte recipe
plus the engine's compiler.

Sound Lab is a sibling of **Image Lab**. The editor's 4-column
shell is identical between the two — see [IMAGE_LAB.md
§7.1](./IMAGE_LAB.md#71-shared-shell-architecture-image-lab--sound-lab--canonical) for the canonical shell
spec. Sound Lab's §7 below documents only the audio-specific
adaptations: spectrogram + waveform preview, Source Files
browser, audio-rate inspector controls, virtual MIDI keyboard
audition.

---

## 1. Goals & non-goals

### Goals

- **Node graph as the primary authoring surface.** Like Image
  Lab; like a software modular synth. Generators → modifiers →
  routing → output. No DAW timeline, no piano roll (until a far
  future iteration).
- **Top-level tab named "Sound Lab".** Sibling to "Image Lab" in
  the cardboard editor's PrimaryTabs strip. Forward-looking
  10-tab list per [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) §6.3
  (current 7 + Image Lab + Sound Lab + UI Builder once all three
  land).
- **One schema, three output modes.** Static one-shot / Loop /
  Realtime instrument all use the same JSON recipe. The
  difference is which compiler path (`OfflineAudioContext` bake
  vs live `AudioContext` instantiation) the engine takes at
  pack-load / voice-trigger time.
- **Tiny shipped artefact.** A recipe is ~200B–2KB JSON. The
  rendered buffer (for static + loop) is cached in IDB sidecar
  storage keyed by recipe content hash — so player downloads the
  recipe, the engine renders it once, then plays from cache for
  the rest of the install.
- **Per-parameter automation.** Every `AudioParam`-shaped value
  on every op can accept a keyframe array, mapped to Web Audio's
  `linearRampToValueAtTime` / `exponentialRampToValueAtTime` /
  `setValueAtTime` / `setValueCurveAtTime` scheduling.
- **Deterministic where it matters.** Noise generators and
  Random modulators are seeded so the same recipe + seed
  produces sample-identical output across editor preview and
  pack runtime.
- **Source Files browser.** Authors can drag `.wav` / `.mp3` /
  `.ogg` samples into the lab and feed them into Sampler /
  Granular / Tape ops as input sources. Project-scoped, stored
  in IDB.
- **Live preview as edits land.** Spectrogram + waveform update
  as the user edits node params; play / loop / virtual-keyboard
  audition without leaving the lab.
- **Visible everywhere it's used.** Any place in the editor that
  picks an audio asset (Entity audio component, scene ambience
  config, music slot, Settings test-sound override) shows the
  recipe's name + a small "SL" badge + a right-click "Edit
  recipe…" jump-into-Sound-Lab action.
- **Zero overhead when unused.** A pack with no
  `manifest.soundRecipes` ships, loads, and runs byte-identically
  to today. No additional `AudioContext`, no IDB writes, no
  worklet shipped.

### Non-goals

- **Full DAW.** No timeline, no per-track recording, no mixing
  console beyond the Mixer op. Authors who want a DAW use a DAW
  and import the rendered `.ogg` via Sound Lab's Sampler op.
- **MIDI sequencing.** A `Sequencer` modulator op exists for
  step patterns (drum machines, arpeggios), but Sound Lab is not
  a MIDI editor. Defer to SL7+.
- **Voice / speech synthesis.** No TTS, no formant synth, no
  phoneme editor. Authors who want voice ship pre-recorded
  samples and play them through the Sampler op. Could revisit
  once browser TTS APIs stabilise.
- **Per-recipe custom JS.** Recipes are pure declarative JSON. No
  user-authored JS DSP inside a recipe — that path is reserved
  for the engine's own AudioWorklet bodies (Bitcrush, FFT, etc.)
  shipped with the engine.
- **External plugin formats.** No VST / AU / LV2 import. The Web
  Audio node graph is the model; that's the universe.
- **Replace `manifest.sounds`.** Sound Lab does not deprecate
  hand-authored sample assets. A pack can mix-and-match —
  `manifest.sounds.gunshot` is a recorded `.ogg`,
  `manifest.soundRecipes.alien_alarm` is a procedural recipe.
  Both addressed by id through the same `api.audio.play(id)`
  call (see §8.5).
- **Streaming audio.** Same constraint as
  [AUDIO.md](./AUDIO.md) §1: rendered buffers live in RAM as
  decoded `AudioBuffer`s. A 30-second loop is fine; a 5-minute
  procedural music track is not (use realtime instrument mode
  instead so it generates samples on the audio thread, no full
  buffer in RAM).
- **Hot-reload of recipes during a play session.** Editor
  rebakes + reseeds when the user edits a node; runtime packs
  do not watch IDB for recipe edits mid-frame. Same constraint
  as pack-shader edits in the materials plan (shipped; see git log).

---

## 2. Status quo

Cardboard ships hand-authored audio only.
[AUDIO.md](./AUDIO.md) Au1 has shipped (commit `52d8e27`): the
engine has `api.audio.play(id)`, a manifest `sounds` registry,
five group `GainNode`s, lazy `AudioContext` bootstrap, the
Settings audio sliders. Au2 (positional + crossfade + ducking)
and Au3 (editor authoring of `SoundDef` rows) are designed but
unshipped. There is no procedural audio anywhere.

What "audio authoring" looks like today:

1. Author records or finds a `.ogg` / `.mp3`.
2. Drops it in `packages/<pack>/audio/sfx/`.
3. Adds a `manifest.sounds.<id>` entry pointing at the file.
4. Scripts call `api.audio.play("<id>")`.

This works, but:

- **No per-instance variation cheaply.** Author who wants 10
  "footstep" variants ships 10 OGG files (~50KB each = 500KB).
  A procedural footstep recipe is ~400B; per-step variation is
  free via a seeded Random modulator.
- **No quick iteration.** Change the gunshot's pitch envelope =
  re-record / re-export / rebuild pack / reload page. Sound Lab
  closes the loop to seconds.
- **No remixable assets.** A pack that depends on a base pack
  can override `manifest.sounds.gunshot` with its own OGG. It
  cannot tweak the base pack's recipe — there isn't one.
- **No live audition during authoring.** Today the only way to
  hear a sound at-mix is to playtest the game. Sound Lab plays
  the recipe through the engine's actual `AudioBackend` (same
  gain graph, same group routing, same ducking), so what
  authors hear in the lab is exactly what plays in the game.
- **Voice acting and music are hand-authored.** Procedural music
  isn't a goal for SL1; what changes is that small interactive
  music elements (combat stings, ambience swells) can become
  realtime instrument recipes that react to gameplay state via
  parameter automation rather than crossfade-and-pray.

Sound Lab plus its sibling Image Lab together close the loop
the IDEAS.md "procedural assets" entry described: tiny recipes
replace rasterized + recorded assets, with the engine doing the
heavy lifting at load time.

---

## 3. JSON recipe schema

### 3.1 Top-level shape

A recipe is a single JSON object:

```jsonc
{
  // Stable id within the pack, referenced by api.audio.play(id).
  // Same flat-namespace convention as manifest.sounds keys.
  "id": "alien_alarm",

  // Schema version. Bumped on any breaking change.
  "version": 1,

  // Output mode — picks the compiler path. See §3.3 / §3.4 / §3.5.
  "mode": "static",        // | "loop" | "instrument"

  // Duration (seconds). For "static" + "loop": clamps the
  // OfflineAudioContext render. For "instrument": ignored
  // (voices end via envelope release or explicit note-off).
  "duration": 1.5,

  // Output sample rate. Default: match the host AudioContext
  // (usually 48000 on desktop, 44100 on older hardware).
  "sampleRate": 48000,

  // Number of output channels. 1 = mono, 2 = stereo. Default 2.
  "channels": 2,

  // Group routing — overrides any per-call group in PlayOpts.
  // Same vocabulary as SoundDef.group from AUDIO.md.
  "group": "sfx",

  // Determinism seed for noise + Random modulators. Identical
  // recipe + seed → sample-identical render.
  "seed": 1337,

  // Tempo (BPM). Read by Sequencer modulator + any op with
  // tempo-synced parameters. Default 120.
  "tempo": 120,

  // Polyphony cap for instrument mode (voices). Ignored for
  // static + loop. Default 16.
  "polyphony": 16,

  // Node graph. Order doesn't matter — edges are explicit.
  "nodes": [ /* see §3.2 */ ],

  // Optional metadata — surfaces in the SL recipe browser.
  "displayName": "Alien Alarm",
  "tags": ["sfx", "alarm", "alien"],
  "author": "@codingbutter",
  "license": "CC0-1.0"
}
```

### 3.2 Node graph representation

A node is `{ id, op, params, inputs }`. Inputs are explicit by
node id; one node connects to another by referencing it from the
consumer's `inputs` array. Matches the IMAGE_LAB.md pattern. One
node has `op: "output"` — the terminal node whose audio routes to
the destination.

```jsonc
{
  "nodes": [
    {
      "id": "carrier",
      "op": "oscillator",
      "params": {
        "type": "sine",
        "frequency": 440,
        "detune": 0
      },
      "inputs": []
    },
    {
      "id": "amp_env",
      "op": "envelope",
      "params": {
        "shape": "adsr",
        "attack": 0.005,
        "decay": 0.2,
        "sustain": 0.6,
        "release": 0.3
      },
      "inputs": [],
      "trigger": "gate"  // see §3.5 + §5.5
    },
    {
      "id": "vca",
      "op": "gain",
      "params": { "gain": 0 },
      "inputs": ["carrier"],
      // Per-AudioParam modulation: amp_env's output drives
      // vca.params.gain (added on top of the static value).
      "modulation": [
        { "param": "gain", "source": "amp_env", "amount": 1.0 }
      ]
    },
    {
      "id": "out",
      "op": "output",
      "params": {},
      "inputs": ["vca"]
    }
  ]
}
```

Node-id namespace is per-recipe. Duplicate ids → load-time
error. A node referencing an undefined input id → load-time
error. Cycles → load-time error (the compiler does a topological
sort; cycles raise). Web Audio supports feedback via `DelayNode`,
which we model as an explicit `delay` op with a feedback
parameter — there's no need for graph-level cycles.

### 3.3 Static (one-shot) recipes

`mode: "static"` recipes render once to an `AudioBuffer` via
`OfflineAudioContext(channels, sampleRate * duration,
sampleRate)`. The buffer is cached in IDB keyed by recipe content
hash. Subsequent plays hit the cache and use a normal
`BufferSourceNode` — same cost as a hand-authored OGG.

The recipe's terminal `output` node has its output captured by
the OfflineAudioContext destination; everything happens in one
shot.

Use for: sfx (gunshots, footsteps, pickups, UI clicks), short
voice-like one-shots (alarm beeps, alerts), per-shot weapon
sounds.

```jsonc
{
  "id": "pickup_chime",
  "mode": "static",
  "duration": 0.6,
  "nodes": [
    { "id": "osc1", "op": "oscillator", "params": { "type": "sine", "frequency": 880 }, "inputs": [] },
    { "id": "osc2", "op": "oscillator", "params": { "type": "sine", "frequency": 1320 }, "inputs": [] },
    {
      "id": "env",
      "op": "envelope",
      "params": { "shape": "ad", "attack": 0.005, "decay": 0.5 },
      "inputs": [],
      "trigger": "immediate"
    },
    {
      "id": "mixer", "op": "mixer", "params": { "channels": 2 },
      "inputs": ["osc1", "osc2"]
    },
    {
      "id": "vca", "op": "gain", "params": { "gain": 0 },
      "inputs": ["mixer"],
      "modulation": [{ "param": "gain", "source": "env", "amount": 0.7 }]
    },
    { "id": "out", "op": "output", "params": {}, "inputs": ["vca"] }
  ]
}
```

### 3.4 Loop recipes

`mode: "loop"`. Same compilation path as static (OfflineAudioContext
→ AudioBuffer → cache), but the output is consumed with
`BufferSource.loop = true`. The lab enforces a clean seam: the
last quantum of the rendered buffer is checked against the first
quantum and a console warning fires if the discontinuity exceeds
a threshold (likely candidate: 0.1 of full-scale amplitude). Loop
duration is `duration` from §3.1 verbatim.

Use for: ambient beds (wind, drone, rain), looping engine hums,
sustained alarms.

A `loopRamp` field on the recipe optionally fades the first +
last 20 ms to mask hard seams — convenient when the recipe is a
single sustain that doesn't naturally loop.

```jsonc
{
  "id": "ambient_wind",
  "mode": "loop",
  "duration": 8.0,
  "loopRamp": 0.02,
  "nodes": [
    { "id": "noise", "op": "noise", "params": { "type": "brown", "seed": 7 }, "inputs": [] },
    { "id": "lfo", "op": "lfo", "params": { "frequency": 0.13, "depth": 1.0, "type": "sine" }, "inputs": [] },
    {
      "id": "filt", "op": "filter",
      "params": { "type": "lpf", "cutoff": 800, "Q": 2 },
      "inputs": ["noise"],
      "modulation": [{ "param": "cutoff", "source": "lfo", "amount": 600 }]
    },
    { "id": "vca", "op": "gain", "params": { "gain": 0.4 }, "inputs": ["filt"] },
    { "id": "out", "op": "output", "params": {}, "inputs": ["vca"] }
  ]
}
```

### 3.5 Realtime instrument recipes

`mode: "instrument"`. **No bake.** At runtime, every voice
trigger instantiates a fresh subgraph of Web Audio nodes,
schedules its envelope at `ctx.currentTime`, and connects to
the appropriate group gain. When the envelope finishes its
release stage the engine disconnects + GCs the subgraph.

The graph runs *live* on the audio thread. Every node in the
recipe is instantiated per voice; modulators (LFO, Envelope) get
fresh phase per trigger. This is by design — interactive
instruments behave like polyphonic synthesizers.

Use for: interactive sfx that need per-trigger modulation
(weapon charges, vocalizations that pitch with context), music
synths driven by Sequencer, anything that needs to react to live
parameter automation.

Trigger model:

- The recipe's envelope nodes carry a `trigger` field. Values:
  `"gate"` (released by note-off — instrument-mode default),
  `"immediate"` (fires at voice start, no release — for
  one-shot envelopes inside a longer instrument voice),
  `"manual"` (driven by automation; never auto-triggers).
- `api.audio.play(id)` of an instrument recipe sends a synthetic
  "infinite gate" — the voice plays until `handle.stop()`. The
  envelope's release stage governs how long after stop the voice
  lingers before disconnect.
- A new ModAPI method (proposed for SL6+):
  `api.audio.playInstrument(id, opts: { frequency?, gateMs?, velocity? })`
  exposes per-voice parameters. Static + loop recipes throw if
  called via this method (mode mismatch).

```jsonc
{
  "id": "lead_synth",
  "mode": "instrument",
  "polyphony": 8,
  "nodes": [
    { "id": "osc1", "op": "oscillator", "params": { "type": "saw", "frequency": 440 }, "inputs": [] },
    { "id": "osc2", "op": "oscillator", "params": { "type": "saw", "frequency": 440, "detune": 12 }, "inputs": [] },
    { "id": "mix",  "op": "mixer", "params": {}, "inputs": ["osc1", "osc2"] },
    {
      "id": "filt", "op": "filter",
      "params": { "type": "lpf", "cutoff": 800, "Q": 6, "drive": 0.0 },
      "inputs": ["mix"]
    },
    {
      "id": "fenv", "op": "envelope",
      "params": { "shape": "adsr", "attack": 0.01, "decay": 0.3, "sustain": 0.5, "release": 0.4 },
      "inputs": [], "trigger": "gate"
    },
    {
      "id": "aenv", "op": "envelope",
      "params": { "shape": "adsr", "attack": 0.005, "decay": 0.2, "sustain": 0.8, "release": 0.3 },
      "inputs": [], "trigger": "gate"
    },
    {
      "id": "vca", "op": "gain", "params": { "gain": 0 },
      "inputs": ["filt"],
      "modulation": [
        { "param": "gain", "source": "aenv", "amount": 1.0 }
      ]
    },
    { "id": "out", "op": "output", "params": {}, "inputs": ["vca"] }
  ],
  // Filter cutoff modulated by fenv — across the entire graph
  // any param can name any modulator source.
  // (Modulation can also live on the consumer node — both are
  // legal; the second form is more local.)
}
```

The engine pools voice subgraphs (one allocation per voice, plus
a small free-list per recipe) to keep voice-on latency below the
2 ms target in §6.7.

### 3.6 Parameter automation (keyframes)

Any numeric `param` on any node can be a constant **or** an
automation block. Automation = keyframe array + per-segment ramp
type. Implementing this is what unlocks "the gunshot pitches
down 200 cents over its half-second tail" without per-frame
script intervention.

```jsonc
{
  "params": {
    "frequency": {
      "default": 880,
      "keyframes": [
        { "t": 0.0,  "v": 880,  "ramp": "linear" },
        { "t": 0.05, "v": 1200, "ramp": "exp" },
        { "t": 0.5,  "v": 200,  "ramp": "hold" }
      ]
    }
  }
}
```

Times `t` are seconds relative to the recipe's start (or to
note-on, for instrument mode). The first keyframe at `t: 0` is
optional — if absent, the engine uses `default` and schedules
the ramp from `t: 0` to the first explicit keyframe's value.

The compiler maps each keyframe to the right `AudioParam` method:

| Ramp | Compiled call | Audio behaviour |
|---|---|---|
| `"linear"` | `linearRampToValueAtTime(v, t)` | Linear interpolation from current value to `v` by time `t`. |
| `"exp"` | `exponentialRampToValueAtTime(v, t)` | Exponential interpolation. Web Audio constraint: values must be > 0; the compiler clamps and warns if `v ≤ 0`. |
| `"hold"` | `setValueAtTime(v, t)` | Hard step — no interpolation. |
| `"cubic"` | `setValueCurveAtTime(curve, t0, dt)` | Custom cubic-bezier curve sampled into a `Float32Array` at quantum resolution before scheduling. See §5.2. |
| `"expDecay"` | Multi-quantum schedule of `exponentialRampToValueAtTime` slices | Models `value * exp(-k * t)` for emulated synth-style envelopes that don't quite match Web Audio's built-in exp. |

A constant `"frequency": 440` is sugar for `{ "default": 440,
"keyframes": [] }`.

For static + loop modes, the OfflineAudioContext executes the
schedule once during render. For instrument mode, schedules are
laid down on every voice trigger relative to `ctx.currentTime`;
the envelope-driven release phase trims the schedule when
note-off fires.

### 3.7 Versioning + migration

`version: 1` is the launch shape. Breaking schema changes bump
this and add a migrator in
`packages/engine/src/Audio/recipeMigrate.ts`. Migrators run at
recipe load time; the editor warns the author and offers a
"save migrated copy" button. Non-breaking additions (a new op,
a new ramp type, a new param) don't bump the version — older
recipes ignore them.

---

## 4. Ops library

Mirrors the mockup's left-rail categories. Each op below: short
description, key params (with units), audio-graph shape (which
Web Audio node it compiles to). All numeric params can be
automated per §3.6 unless flagged "init-only".

### 4.1 Generators

These are the entry points — nodes with no audio inputs.

- **`oscillator`** — `OscillatorNode`. `type:
  "sine" | "saw" | "pulse" | "triangle" | "wavetable"`.
  `frequency` (Hz), `detune` (cents). `pulseWidth` (0..1) for
  pulse — implemented via two phase-shifted saw oscillators
  through a delay (Web Audio has no native pulse). `wavetable`
  carries an additional init-only `partials: Float32Array`
  describing the harmonic content (24-partial cap for cheap
  setup).
- **`noise`** — `AudioBufferSourceNode` fed by a precomputed
  noise buffer. `type: "white" | "pink" | "brown"`. `seed` (int)
  init-only — same seed across editor + pack runtime gives
  sample-identical output. Internally precomputes a 4-second
  buffer per type at recipe-compile time, loops it; longer
  recipes get a longer buffer.
- **`sample`** — `AudioBufferSourceNode` reading a source file
  loaded from the Source Files browser (§7.2). Params:
  `file` (Source-Files id, init-only), `playbackRate`,
  `detune`, `loop` (boolean), `loopStart`, `loopEnd`,
  `startOffset`.
- **`granular`** — granular synthesis op. Internally spawns N
  short overlapping `AudioBufferSourceNode`s per grain (typical
  N ≈ 16 grains). Params: `file` (init-only), `grainSize`
  (seconds; ~0.005–0.5), `grainDensity` (grains/sec),
  `pitchJitter` (cents), `positionJitter` (seconds),
  `windowShape: "hann" | "gauss" | "rectangular"`. Heavy — flag
  in the inspector when active.
- **`mic`** — `MediaStreamAudioSourceNode`. **Instrument mode
  only.** Throws at compile time if used in static / loop.
  Params: `deviceId` (string, init-only — exposed via a
  `navigator.mediaDevices.enumerateDevices()` dropdown in the
  inspector). Permission gated on first use.
- **`wav`** — alias for `sample` with `loop: false`. Sugar.

### 4.2 Modifiers

Audio-in, audio-out transforms.

- **`filter`** — `BiquadFilterNode`. `type: "lpf" | "hpf" |
  "bpf" | "notch" | "allpass" | "lowshelf" | "highshelf" |
  "peaking"`. `cutoff` (Hz), `Q`, `gain` (dB, for shelves +
  peaking). `drive` (0..1) — a pre-filter waveshaper for
  "filter character" without a separate Distort node, useful
  for synth leads.
- **`distort`** — `WaveShaperNode`. `curve: "tanh" | "fold" |
  "fuzz" | "softclip" | "hardclip" | "custom"`. `drive` (0..1)
  blends dry/wet. `custom` carries an init-only
  `curve: Float32Array` (the waveshape).
- **`bitcrush`** — AudioWorklet processor. `bits` (1..16),
  `sampleRateReduction` (1..32; "play every Nth sample").
  Implemented as a single AudioWorkletNode shipped with the
  engine (see [§12 Q2](#12-open-questions)).
- **`compressor`** — `DynamicsCompressorNode`. `threshold` (dB),
  `knee` (dB), `ratio`, `attack` (s), `release` (s).
- **`reverb`** — `ConvolverNode`. `impulse: "small_room" |
  "medium_room" | "large_hall" | "plate" | "spring" | "custom"`
  — built-in impulses ship with the engine; `custom` references
  a Source Files id. `wet` (0..1) blends.
- **`delay`** — `DelayNode` + a feedback path through a
  `GainNode` and optional `BiquadFilterNode`. Params:
  `time` (s), `feedback` (0..0.99), `feedbackFilter` (Hz, LPF
  on feedback path). Tempo-syncable: `time: { "syncTo":
  "tempo", "noteValue": "1/8" }`.
- **`chorus`** / **`flanger`** — modulated delays. Internally
  `DelayNode` + `OscillatorNode` LFO modulating the delay time.
  Params: `rate` (Hz), `depth` (s), `mix` (0..1), `feedback`
  (flanger only).

### 4.3 Modulators

Control-rate sources that don't output audio — they modulate
other nodes' `AudioParam`s via the `modulation` array described
in §3.2.

- **`lfo`** — sub-audio-rate `OscillatorNode` plus a `GainNode`
  to scale its output. `type` (waveform), `frequency` (Hz),
  `depth` (target-param units), `phase` (0..1, init-only —
  starting phase offset). Tempo-syncable.
- **`envelope`** — ADSR / AHDSR / AD / AR via a scheduled
  `GainNode` whose gain is automated. Params: `shape: "ad" |
  "ar" | "adsr" | "ahdsr"`, `attack` / `hold` / `decay` /
  `sustain` / `release` (s). `trigger` (§3.5).
- **`sequencer`** — step pattern. `steps: Array<{ active: bool,
  value: number }>`, `stepDuration` (s OR tempo-synced).
  Outputs a value that holds for each step's duration. Useful
  for arp / drum patterns when wired into an oscillator's
  frequency or an envelope's gate trigger.
- **`random`** — sample-and-hold. Outputs a new random value
  every `rate` seconds, range `[min, max]`. Seeded (per §3.6
  determinism rule).

### 4.4 Routing

- **`mixer`** — N-input `GainNode` tree. `channels` (1 or 2 for
  mono/stereo). Per-input gain via `inputGains: number[]`
  matched positionally to the `inputs` array. The mixer's own
  output `gain` is a separate param.
- **`send`** — splits a signal into two paths: dry passthrough
  + a wet send through a gain. Used for "reverb send" patterns
  where one source feeds both a main mix and a reverb tail.
- **`gain`** — single `GainNode`. The default for "VCA"
  (voltage-controlled-amplifier) wiring where an envelope
  modulates a static gain.
- **`pan`** — `StereoPannerNode`. `pan` (-1..1).
- **`output`** — terminal node. Exactly one per recipe.
  Connects to the OfflineAudioContext destination (static +
  loop) or the engine's group gain node (instrument). Params:
  `gain` (overall mix level — applied as a final `GainNode`
  upstream of group routing).

### 4.5 Tools

- **`tape`** — record-and-loop op for advanced recipes.
  Records its input into a rolling buffer over `duration`
  seconds, then plays back. Useful for "freeze the last 2
  seconds and loop it" patterns. Implemented as an
  AudioWorklet (records on the audio thread, plays back as a
  `BufferSource` allocated on the main thread on demand).
- **`fft`** — `AnalyserNode`. Pure introspection — outputs no
  audio (its audio-out is the passthrough). The editor reads
  its FFT data for spectrogram visualizations bound to that
  node. Compile-time check: an `fft` node MUST also pass-
  through its input or be terminal-passive (the renderer
  surfaces a warning if it's dangling).
- **`granular_synthesis`** — alias of `granular` (mockup uses
  this longer form). Both names accepted.
- **`fft_analyzer`** — alias of `fft`.

### 4.6 Determinism + seeding

Only `noise` and `random` ops produce non-deterministic output
by default. Both accept a `seed: number` param (init-only).
Same recipe + same seed + same engine version = sample-identical
render across editor preview, pack-load static bake, and
sample-by-sample recompare in tests.

Other ops are deterministic by construction (Web Audio's
`OscillatorNode` + `BiquadFilterNode` etc. are deterministic
given the same scheduling). `mic` is by definition
non-deterministic; the compiler refuses `mic` in static or loop
modes.

A recipe-level `seed` field (§3.1) provides a per-recipe default
that flows into any noise / random op without its own seed. A
seed of `0` triggers "use a random seed each load" — useful for
"every gunshot subtly different" cases when the author *wants*
that variation.

---

## 5. Parameter automation + keyframes

### 5.1 Keyframe model

A param's automation block:

```ts
interface ParamAutomation {
  default: number;
  keyframes: Array<{
    t: number;       // seconds (relative to recipe start or note-on)
    v: number;       // target value at time t
    ramp: "linear" | "exp" | "hold" | "cubic" | "expDecay";
    // ramp-specific options:
    bezier?: [number, number, number, number]; // for cubic
    decay?: number;                              // for expDecay
  }>;
}
```

`t` values strictly increasing. Out-of-order keyframes → load
error. Two keyframes with identical `t` → load error (use one
or the other, not both; if you want a hard step, use `"hold"`).

The first keyframe schedules with `setValueAtTime` at `t: 0` to
its target value `v`, unless the first keyframe is already at
`t: 0` (in which case it's redundant and skipped). Subsequent
keyframes schedule per their `ramp` field. After the last
keyframe the value holds at its final value.

### 5.2 Ramp types

Detailed compilation per ramp:

- **`linear`** — `param.linearRampToValueAtTime(v, t)`. Web
  Audio interpolates linearly from the value at the previous
  scheduling event up to `v` at `t`.
- **`exp`** — `param.exponentialRampToValueAtTime(v, t)`. Web
  Audio constraint: both endpoints must be > 0. Compiler clamps
  any non-positive endpoints to `1e-4` and surfaces a warning
  in the editor's problems pane.
- **`hold`** — `param.setValueAtTime(v, t)`. Hard step.
- **`cubic`** — author supplies a 4-tuple cubic bezier
  `[x1, y1, x2, y2]` in the conventional CSS shape. The
  compiler samples the curve at quantum-resolution (~3ms) into
  a `Float32Array` of `(t - tPrev) / quantum` samples and
  schedules `param.setValueCurveAtTime(curve, tPrev, t - tPrev)`.
- **`expDecay`** — author supplies a `decay` time-constant in
  seconds; the curve is `v_prev * exp(-(t - tPrev) / decay)`.
  Compiled to `setValueCurveAtTime` like `cubic`. Useful for
  natural-sounding pluck envelopes where Web Audio's built-in
  `exponentialRampToValueAtTime` (which targets a specific
  value at a specific time) feels too rigid.

### 5.3 Per-parameter automation

Every numeric `param` accepts automation. The renderer detects
the shape (`number` vs `ParamAutomation`) and either calls
`param.value = n` (constant) or walks the keyframes (automation).

Modulator outputs (LFO, envelope, sequencer, random) **add** to
the static value of their target params at audio rate. This is
the standard Web Audio modulation pattern — a `GainNode` between
modulator and target scales the modulator's contribution; the
target param's `.value` is the unmodulated baseline.

### 5.4 Looped automation

LFO modulators provide implicit looped automation — they're
periodic by definition. For a *custom* periodic shape (e.g. an
8-bar gate pattern), authors use a `sequencer` op.

For loop-mode recipes specifically, all keyframe automations
restart on each loop iteration. Static automation that spans
beyond the loop endpoint is clipped at the endpoint and warned
about in the editor.

### 5.5 Trigger automation (envelope events)

Envelopes carry a `trigger` field controlling when their
schedule fires:

- **`"immediate"`** — fires at recipe / voice start.
  Static + loop default.
- **`"gate"`** — fires on note-on, releases on note-off.
  Instrument default.
- **`"manual"`** — never auto-fires; the recipe must connect a
  trigger source (sequencer step output, another envelope's
  end-of-stage signal) to fire it. Used for sequenced patterns.

A future extension (SL7+) lets external sources (sequencer
steps, MIDI input, gameplay events via `api.audio.gate(id)`)
fire envelopes in instrument-mode recipes. For SL2–SL6 only
`"immediate"` + `"gate"` ship.

---

## 6. Runtime engine

### 6.1 Recipe JSON → Web Audio node graph compilation

The compiler is a single module
`packages/engine/src/Audio/recipeCompile.ts`. Pure function:

```ts
export function compileRecipe(
  recipe: SoundRecipe,
  ctx: BaseAudioContext,     // AudioContext OR OfflineAudioContext
  source?: SourceFileStore,  // for `sample` / `granular` / convolver impulses
): CompiledRecipe;

export interface CompiledRecipe {
  /** Map of node id → Web Audio node instance. */
  readonly nodes: ReadonlyMap<string, AudioNode>;
  /** The terminal `output` node — connect this to destination / group gain. */
  readonly output: AudioNode;
  /** All scheduled automations, keyed by node + param. Set up at compile time. */
  readonly automations: ReadonlyArray<ScheduledAutomation>;
  /** Disconnect + drop all nodes. */
  dispose(): void;
}
```

Compile steps:

1. **Validate.** Schema check via `recipeSchema.ts`. Unknown
   ops, unknown ramp types, undefined input ids, cycles → throw
   with a structured error the editor surfaces as a problem
   row.
2. **Topological sort.** Produce a DAG order so each node is
   built before any consumer.
3. **Per-op factory.** Walk each node, call its op's factory
   (`opFactories[node.op](ctx, node.params, source)`), get back
   an `AudioNode`. Store in the id→node map.
4. **Wire audio inputs.** For each node, call
   `.connect(consumer)` from each input.
5. **Wire modulation.** For each node's `modulation` array,
   connect the source's audio output to the consumer's target
   `AudioParam` (Web Audio supports `connect(audioParam)`
   directly; the modulator's signal is summed into the param).
6. **Schedule automation.** Walk each node's keyframed params,
   compile the keyframes to the right `AudioParam` calls (per
   §5.2). For OfflineAudioContext these execute during render;
   for live AudioContext they're laid down at compile time and
   fire as the clock advances.
7. **Return the compiled bundle.** Caller decides whether to
   start playback (static: `ctx.startRendering()`; instrument:
   schedule envelopes against `ctx.currentTime`).

### 6.2 Node-graph evaluation order

Topological sort guarantees every input is wired before its
consumer is connected. Cycles → compile error (the
`feedbackPath` on `delay` is the engine's escape hatch for
explicit feedback; recipe authors never wire raw cycles).

Modulation edges are NOT part of the audio DAG for sort
purposes — a modulator may both modulate a target and be
modulated by it (LFO → filter cutoff, envelope → LFO depth) and
that's fine. Only audio-path edges count for cycle detection.

### 6.3 Three output modes (static / loop / instrument)

Implementation paths:

**Static** (`mode: "static"`):

```ts
const offline = new OfflineAudioContext(
  recipe.channels, recipe.sampleRate * recipe.duration, recipe.sampleRate,
);
const compiled = compileRecipe(recipe, offline, source);
compiled.output.connect(offline.destination);
const buf = await offline.startRendering();  // AudioBuffer
await idbCache.put(recipeHash, buf);
compiled.dispose();
```

**Loop** (`mode: "loop"`): Same as static, but the resulting
buffer is played with `BufferSource.loop = true`. Seam check
runs after render — first quantum and last quantum compared,
warning emitted if discontinuity > threshold.

**Realtime instrument** (`mode: "instrument"`):

```ts
// One template compile per recipe at pack-load time:
const template = recipe;   // JSON, immutable

// One subgraph instantiation per voice trigger:
function trigger(opts: { frequency?, gateMs?, velocity? }) {
  const compiled = compileRecipe(template, ctx, source);
  compiled.output.connect(groupGain);
  scheduleEnvelopes(compiled, opts);  // §6.4
  // When the last envelope's release ends:
  setTimeout(() => compiled.dispose(), totalReleaseMs + 10);
}
```

No bake. Each voice gets fresh state. The engine pools recipe
templates (one parse + validate per recipe) so per-voice setup
is just construction of Web Audio nodes (~1ms in practice).

### 6.4 AudioContext lifecycle

Static + loop renders use **OfflineAudioContext** so they don't
interfere with live audio and can run on a background tick
without scheduling pressure. They also don't require user
gesture — `decodeAudioData` + `startRendering` are unrestricted.

Instrument-mode subgraphs are instantiated on the **live
AudioContext** that the engine's existing `AudioBackend` (per
[AUDIO.md](./AUDIO.md) §5.7) already manages — same lazy
bootstrap, same gain graph, same user-gesture resume. Sound Lab
adds zero new AudioContexts to the runtime. The lab editor's
audition uses the same live context.

`MediaStreamAudioSourceNode` (the `mic` op) requires explicit
user permission. The compiler defers `getUserMedia` until the
node's host voice triggers, then `await`s the permission grant
before connecting. Permission denial → voice silent + console
warning + the node falls through as a `GainNode(0)`.

### 6.5 IDB cache for rendered buffers

Static + loop renders are cached. Key: SHA-256 of the recipe's
canonical JSON (keys sorted, whitespace stripped) + the engine
version. Value: serialized `AudioBuffer` as raw Float32Array(s)
+ sampleRate + numberOfChannels. Stored in a per-project IDB
object store `soundRecipeBakes`.

Cache invalidation:

- **Recipe content change** → new hash → miss → re-render.
- **Engine version bump** → new hash component → miss → re-render.
- **Source-file change** (a recipe's `sample` op points at a
  source file that the author edited) → recipe hash already
  includes the source file's content hash via the recipe →
  miss → re-render.

Cache eviction: LRU once the IDB store hits a soft limit
(default 200 MB total bakes). Stale entries log a console line.

Cross-tab / cross-project sharing: the cache is per-project.
Project ids namespace the store. Shared community recipes
fetched from the Store ([PACK_CHAIN.md](./PACK_CHAIN.md) §11
Store) cache against the recipe content hash so the same recipe
used by two projects bakes once.

### 6.6 Pack load flow

When a pack with `manifest.soundRecipes` loads:

1. Parse the manifest, collect recipe ids.
2. For each recipe with `mode` in `{ "static", "loop" }`:
   a. Compute the recipe content hash.
   b. Look up in IDB. Cache hit → load `AudioBuffer`, stash in
      the engine's decode cache keyed by recipe id, done.
   c. Cache miss → render via OfflineAudioContext (§6.3),
      stash in the live decode cache, write to IDB.
3. For each recipe with `mode: "instrument"`:
   a. Stash the recipe JSON in an "instrument templates" map.
   b. No render at load — voices instantiate on trigger.
4. Expose recipe ids alongside `manifest.sounds` ids in the
   `api.audio.play(id)` resolver — both are lookups; the
   resolver checks the sound registry first then the recipe
   registry. Collision → pack-load warning, last-write-wins
   (matching `manifest.sounds` collision semantics).

Step 2 happens **in parallel** across all recipes. Each render
is one async `await` — they all kick off and complete as fast
as their compile time allows. Browser typically allows 8–16
concurrent OfflineAudioContext renders; we don't cap.

### 6.7 Performance budget

Targets:

| Operation | Budget |
|---|---|
| Recipe parse + validate | < 1ms |
| Compile recipe (graph build, no render) | < 3ms |
| Static one-shot render (1s, modest graph) | < 20ms |
| Static one-shot render (1s, granular + reverb) | < 100ms |
| Loop render (4s) | < 80ms |
| Voice trigger (instrument mode) | < 2ms |
| IDB cache hit retrieval | < 5ms |
| Spectrogram analysis frame (live preview) | < 8ms |

Pack-load budget: 50 recipes per pack with the typical
distribution (~70% static, ~20% loop, ~10% instrument) costs
**~2–5 seconds** on first load (cold cache), **<200 ms** on
warm cache. Both within the player's tolerance window for
"loading a level."

Cache hit ratio in practice: ~99%. The miss case is "I just
edited a recipe" — once per author iteration. End players never
miss after first install.

---

## 7. Editor tab layout (Sound Lab)

### 7.1 Shared shell — see [IMAGE_LAB.md §7.1](./IMAGE_LAB.md#71-shared-shell-architecture-image-lab--sound-lab--canonical)

Sound Lab uses the **identical 4-column shell** as Image Lab:
left rail with Layers + Ops library, center canvas with the
Procedural Graph workspace, right rail with Preview pane +
Node Properties inspector, bottom strip with Source Files
browser + Compiled Output status + Export Outputs targets. The
layout grammar, keyboard shortcuts (`Tab` to toggle inspector,
`Space` to play / pause preview, `B` to bake, `R` to reset
graph view, `Cmd+drag` to pan, `Cmd+wheel` to zoom, etc.),
drag-and-drop semantics (drag ops from rail into graph, drag
edges between ports, multi-select + box-select on graph
canvas), node-graph wiring affordances (port colour coding —
audio vs control, input vs output; cycle prevention; auto-
layout on tidy), are all canonical in IMAGE_LAB.md §7.1.

**Read IMAGE_LAB.md §7.1 first.** The rest of §7 here documents
only what is unique to the audio domain.

### 7.2 Audio-specific adaptations

Where the shells diverge:

- **Preview pane** is a **spectrogram + waveform**, not an
  image. Top panel: live spectrogram (FFT analyzer rendered to
  canvas, time on X, frequency on Y, magnitude as a heat-map).
  Bottom panel: real-time waveform scroll for the same signal.
  For static + loop recipes the preview shows the *rendered
  buffer*. For instrument recipes it shows live output of any
  currently-playing voices.
- **Source Files browser** replaces "Recent Bakes" in the
  bottom-left strip. Authors drop `.wav` / `.mp3` / `.ogg`
  files in; the lab uploads them into IDB sidecar storage
  (project-scoped, addressable by `file:<id>` in `sample` and
  `granular` ops). Each source file shows: filename, duration,
  sample rate, file size, a mini waveform thumbnail. Right-
  click context: Rename, Trim (opens a sub-modal with a
  start/end trimmer), Delete (with reference-checking — refuses
  to delete a source still referenced by a recipe).
- **Modulators category in the Ops library** — sibling to
  Generators / Modifiers / Routing / Tools. Mockup-illustrative
  category names; the canonical list of ops is §4.
- **Output node mode dropdown** — the terminal `output` node's
  inspector has a `mode: "static" | "loop" | "instrument"`
  dropdown that drives the whole recipe's compilation path
  (§3). Inline preview controls (§7.5) reconfigure when the
  mode changes.

### 7.3 Node Properties inspector — audio-specific controls

The inspector on the right rail surfaces, per selected node:

- **Numeric params** as labeled sliders + numeric inputs. Right-
  click any param → "Automate…" opens a per-param keyframe
  editor (mini-timeline + ramp dropdown). Automated params
  display a small amber "keyframed" indicator and the static
  value is replaced by a "Default ↦ N keyframes" affordance.
- **Frequency knobs** (oscillator frequency, filter cutoff, LFO
  rate) — log-scale slider 20 Hz–20 kHz, with note-name + cents
  display alongside the Hz value (e.g. "440 Hz / A4 +0¢").
- **ADSR sliders** for envelope nodes — four sliders + a live
  envelope-curve mini-preview (300×80 px) that updates as the
  user drags. Same curve renderer reused in the keyframe
  editor.
- **Filter response visualizer** — for filter nodes, a 300×120
  px frequency-response plot showing the filter's transfer
  function at the current params. Live, updates as cutoff / Q /
  type change.
- **Waveshape preview** — for distort nodes, a 200×200 plot of
  the WaveShaper curve.
- **Step-pattern grid** for sequencer nodes — N step buttons
  (default 16) with active/inactive toggle + per-step value
  slider.
- **Modulation router** — the `modulation` array shows as a
  collapsible "Modulators" sub-section: each modulator listed
  with its source node id, target param, and amount slider.
  Drag from a modulator node's output port directly onto a
  numeric param to auto-add a modulation row.

Audio-rate visualizers (spectrogram, waveform, filter response,
ADSR curve, FFT) all update at ~30 FPS via `requestAnimationFrame`
reading from an internal `AnalyserNode` chained off the
inspector's selected node (a separate analyzer per inspected
node, instantiated only while that node is selected).

### 7.4 Output node — selects mode

The `output` node's inspector is the source of truth for the
recipe's compilation mode:

- **Static (one-shot)** — locks the preview pane to a "Render +
  audition" workflow. Pressing Play renders the recipe via
  OfflineAudioContext, displays the spectrogram + waveform of
  the resulting buffer, and plays the buffer. A duration slider
  governs render length.
- **Loop** — same as Static but the audition loops the rendered
  buffer. Spectrogram shows the looped playback; an overlay
  marks the loop boundary.
- **Realtime instrument** — switches the preview to live audio.
  Spectrogram shows the live signal. A virtual MIDI keyboard
  (§7.5) becomes available. No render — every keypress
  instantiates a fresh voice.

Switching modes mid-edit warns the author if the current graph
contains nodes incompatible with the new mode (`mic` only in
instrument mode; `tape` only in instrument mode; granular sane
in all three).

### 7.5 Audition controls

Top-right of the preview pane:

- **Play / Stop** — `Space`. For static + loop: play the
  rendered buffer. For instrument: open a sustain-tone preview
  at a default pitch (A4, velocity 0.8, gate 500ms).
- **Loop preview** — toggle. For loop recipes the preview loops
  natively. For static recipes "loop preview" replays on end —
  useful for iterating short sfx.
- **A/B compare** — two slots (A and B). Each slot stores a
  reference to the current recipe's compiled state. Authors
  swap between slots to compare two parameter sets without
  losing either. `[` and `]` keys cycle slots.
- **Virtual MIDI keyboard** — bottom of the preview pane in
  instrument mode. 2-octave QWERTY-mapped keyboard (Z–M lower
  row, Q–U upper row, +/- octave shift). Mouse + touch supported.
  Trigger sends `{ frequency: midiToHz(note), gateMs: held,
  velocity: 0.8 }` to the live recipe instance.
- **Audition envelope** — A waveform inset showing the
  envelope of the last triggered voice — useful for tuning
  ADSR ramps visually.
- **Loop region scrub** — for loop recipes, a small thumb-
  scrubbable bar across the rendered buffer length lets the
  author preview the loop seam (jump to start, jump to end,
  watch the spectrogram cross the loop boundary).

### 7.6 Recipe list / browser

Left rail, **above** the Ops library: a collapsible "Recipes"
section. Each row: recipe id, mode badge ("static" / "loop" /
"instrument" tag pills colored amber / sky / purple
respectively), display name. Right-click context: Rename,
Duplicate, Delete (with reference-checking — refuses to delete a
recipe still referenced by an entity audio component, scene
ambience, music slot, etc.), Export JSON, Copy id.

The Recipes section's "+" button opens a "New Recipe" modal:
choose mode + a starter template (Empty / Beep / Drone /
Footstep / Synth Lead) → opens a fresh graph in the canvas.

---

## 8. Asset visibility across editor

### 8.1 Entity audio component shows baked waveform + name

Any place an entity's `Audio` component (sound id picker — see
[AUDIO.md](./AUDIO.md) §4.1 future Au3) appears, recipe-backed
ids show:

- A 60×24 px static waveform thumbnail (for static / loop
  recipes — generated from the rendered buffer).
- For instrument recipes, a mode-badge instead of a waveform.
- An "SL" badge in the bottom-right corner of the row to
  distinguish from hand-authored sounds (those get no badge or
  a "📁" icon).
- A small play button to audition right from the picker.

### 8.2 Ambience config shows the recipe

Scene metadata's `ambience` field (per [AUDIO.md](./AUDIO.md)
§8.6) accepts any sound id — including recipe ids. The Scene
inspector's "Ambience" picker shows the recipe's name + mode +
"SL" badge + a right-click "Edit recipe…" jump-into-Sound-Lab
affordance.

### 8.3 Music slot shows the recipe

Pack music slots (`manifest.music` once it lands; today
referenced via `api.audio.crossfadeMusic(id)`) similarly accept
recipe ids. Particularly compelling for `instrument`-mode
recipes: a music slot that's a procedural synth playing a
sequenced melody, automated by gameplay parameters
(`battle_intensity`, `enemy_count`) routed in as control inputs.

### 8.4 "SL" badge + right-click "Edit recipe…" anywhere

The badge is a 14×14 px pill with "SL" centred, amber on dark
zinc — distinct from Image Lab's "IL" badge (which is on the
same palette but contains "IL"). Both badges are part of the
shared primitive in §6.4 (Component Reference rendering).

Right-click context on any badged asset: "Edit recipe…" jumps
the user to Sound Lab with that recipe loaded. The current view
state is preserved (`localStorage` `editor.workflowMode`); on
Sound-Lab unload, Back button or `Esc` returns the user to the
referencing view.

### 8.5 Re-bake propagation

When a recipe is edited:

1. Editor recomputes the recipe's content hash.
2. Marks any cached IDB bake stale (deletes the old entry,
   queues a re-render).
3. Walks the project's references — entity audio components,
   ambience configs, music slots — and refreshes their preview
   thumbnails.
4. If a Playtest iframe is currently running, posts a
   `recipe-changed` message on the existing
   [EDITOR_IFRAME.md](./EDITOR_IFRAME.md) channel so the live
   game reloads the recipe (engine receives the message → drops
   the recipe from its in-memory decode cache → next play() of
   that id re-fetches from IDB → loads the new buffer).

The same propagation path applies when a Source File is edited
(any recipe referencing it transitively rebakes).

---

## 9. Editor bake pipeline

### 9.1 Bake button + auto-bake on save

Each recipe's editor view exposes a **Bake** button (top of the
preview pane). Behaviour by mode:

- **Static / Loop** — pressing Bake renders via OfflineAudioContext
  (§6.3), writes the buffer to IDB (§6.5), refreshes the
  preview spectrogram + waveform from the freshly baked buffer.
- **Instrument** — Bake is disabled (greyed). Hover tooltip:
  "Instrument recipes don't bake. They render live per voice."

Auto-bake: on any structural recipe edit (node added / removed,
edge added / removed, op type changed, param keyframed) the
editor schedules a debounced re-bake (300 ms quiet period). On
param tweaks the live preview reflects the change via
audition's compiled-on-the-fly path; the canonical IDB bake
updates on the debounced tick.

The user can disable auto-bake from the inspector (preference:
"Auto-bake on edit") — useful when authoring large recipes
where each bake takes >100 ms.

### 9.2 Realtime instrument mode — no bake

Instrument recipes never bake. Their "ship artefact" is the
recipe JSON itself. On pack load the engine validates + compiles
the JSON into an instrument template (§6.6) and the audition
preview just instantiates voices live.

### 9.3 Offline AudioContext for deterministic render

The bake path strictly uses `OfflineAudioContext` so that:

- Seed → output is deterministic across editor preview, pack-
  load bake, and test-time recompare.
- Render speed isn't gated by realtime audio thread scheduling
  (offline renders run as fast as the browser can crunch them).
- No live audio side effects (no clicks, no permission
  prompts, no AudioContext-state changes).

### 9.4 IDB sidecar storage for rendered AudioBuffers

Bakes live in `soundRecipeBakes` IDB store. Schema:

```ts
interface RecipeBakeRow {
  recipeHash: string;        // SHA-256 of canonical recipe JSON
  projectId: string;
  recipeId: string;
  bakedAt: number;           // ms epoch
  sampleRate: number;
  channels: number;
  duration: number;
  buffers: Float32Array[];   // one Float32Array per channel
  engineVersion: string;
}
```

Stored as a `Blob` (serialized binary) for compactness. Read
path: deserialize on first access into an `AudioBuffer` via
`ctx.createBuffer + buffer.copyToChannel`. Cache the
deserialized `AudioBuffer` in RAM for the rest of the session.

### 9.5 Invalidation on parameter change

The bake invalidates on:

- Any recipe field change (`mode`, `duration`, `sampleRate`,
  `channels`, `seed`, `tempo`, `nodes`, any nested params).
- Any source file change (Source Files browser edit) that the
  recipe transitively references via `sample` / `granular` /
  custom convolver impulse.
- Engine version change.

Invalidation = delete the IDB row + drop the in-memory decode
cache entry. Next play of the recipe triggers a fresh bake.

---

## 10. Engine-to-editor parity

### 10.1 Same compiler in both contexts

`packages/engine/src/Audio/recipeCompile.ts` is shared between
the engine's runtime (pack load) and the editor (audition +
bake). No editor-specific compile path — the editor calls the
engine's compiler with the editor's live `AudioContext` (or its
own `OfflineAudioContext` for bakes), gets back the same
`CompiledRecipe`, and plays it the same way.

This means a sample-by-sample diff between editor audition and
pack runtime should be zero given the same seed + same engine
version. Test in §10.3.

### 10.2 Seed governs reproducibility

The recipe's top-level `seed` (§3.1) flows into every op that
needs it. The pack-load bake and the editor bake see identical
seeds, so noise + random modulators produce identical samples.

For an "every play subtly different" recipe, set `seed: 0` —
the engine picks a fresh random seed on each `play()` call.
That's a runtime-instrument-style behaviour and works for
static + loop too via per-play-deferred render (rarely useful;
typically authors achieve variation through a sequencer +
random modulator on detune, not by reseeding the whole recipe).

### 10.3 Test plan

In `packages/engine/test/audio/`:

- `recipeCompile.test.ts` — schema validation cases, cycle
  detection, undefined-input detection, version migration.
- `recipeBakeParity.test.ts` — for each of N curated recipes,
  bake via OfflineAudioContext, capture the buffer, then bake
  again in a fresh context, sample-compare. Must match
  bit-exactly within `Float32Array` precision. Recipes:
  - Pure-sine 440 Hz.
  - Noise + filter + envelope (footstep-shaped).
  - Granular with seed 42.
  - Loop recipe (windy ambient).
- `instrumentVoiceParity.test.ts` — trigger same instrument
  recipe ten times with identical opts, sample-compare each
  voice's output. Must match (post-noise-reseed deterministic
  envelope).
- Smoke test in `apps/editor/test/SoundLab.test.tsx` — render
  the editor with a curated recipe, simulate Bake button, read
  IDB, recompare to expected fixture.

These run under `bun test` against `node-web-audio-api` (or a
fallback shim — see §12 Q8).

---

## 11. Phased rollout SL1–SL7

| Phase | Scope | Where it lives | Depends on |
|---|---|---|---|
| **SL1** | **This plan doc.** No code. Settles the recipe schema, three output modes, ops library shape, cross-doc cross-references. | `docs/plans/SOUND_LAB.md` | — |
| **SL2** | **Engine runtime + JSON schema + ops MVP.** `recipeCompile.ts` shipping with: `oscillator`, `noise`, `filter`, `envelope`, `gain`, `pan`, `mixer`, `output`. Static-mode renderer + IDB cache. Plus `manifest.soundRecipes` field on `PackManifest` and resolver in `api.audio.play(id)`. Engine validates + bakes at pack-load. Default-pack ships one sample static recipe ("synth_beep") wired into the gun-render `fire` branch behind a flag. | `packages/engine/src/Audio/recipeCompile.ts` (NEW), `packages/engine/src/Audio/recipeSchema.ts` (NEW), `packages/engine/src/Audio/idbCache.ts` (NEW), extend `manifest.soundRecipes`, extend `AudioRegistry.ts` resolver. | SL1, [AUDIO.md](./AUDIO.md) Au1 (shipped). |
| **SL3** | **Editor tab MVP.** New PrimaryTab "Sound Lab" in `apps/editor/`. 4-column shell (per IMAGE_LAB.md §7.1). Graph canvas. Node Properties inspector. Static-recipe authoring + live audition via the engine compiler. Spectrogram + waveform preview pane. Recipe list. No automation editor yet; no Source Files yet. | `apps/editor/src/views/SoundLab/` (NEW). `apps/editor/src/lib/recipeStore.ts` (NEW — IDB). Extend `EDITOR_REDESIGN.md` §6.3 tab list. | SL2, [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) R3 (shell + PrimaryTabs land). |
| **SL4** | **Automation + envelopes + loop mode + Source Files browser.** Keyframe editor sub-modal. Full envelope op (ADSR/AHDSR + curve preview). Loop-mode renderer + seam check + scrubber. Source Files browser (drag-drop, trim, reference check). `sample` + `granular` ops. | Extend SoundLab views; add `apps/editor/src/views/SoundLab/SourceFiles/`. Add `granular` worklet. | SL3. |
| **SL5** | **Bake pipeline + asset visibility everywhere.** Bake button + auto-bake debounce. IDB invalidation propagation. Entity audio component picker shows recipe badges. Ambience + music pickers ditto. Right-click "Edit recipe…" affordance everywhere. Hot-reload propagation through EDITOR_IFRAME. | Wide — entity inspectors (`apps/editor/src/views/EntitiesEditor.tsx`), scene inspectors, ProjectSettings audio tab, EDITOR_IFRAME message channel. | SL4, [EDITOR_IFRAME.md](./EDITOR_IFRAME.md) I2. |
| **SL6** | **Realtime instrument mode + virtual keyboard audition.** Instrument compile path (no bake). Voice pool. Virtual MIDI keyboard in audition. New `api.audio.playInstrument(id, opts)` ModAPI surface. Default-pack ships a "lead_synth" instrument recipe used in the title screen menu music. | Extend recipeCompile.ts with instrument path. Voice pooling in `AudioBackend`. Keyboard component in `SoundLab/Audition/`. | SL5, polyphony validation (§12 Q5). |
| **SL7** | **Pack export + community recipes via Store.** Recipe export from Sound Lab to `manifest.soundRecipes` block + JSON sidecar. Browse community recipes via the cardboard Store. Drag-and-drop import from Store into a project (recipe content addressable across projects). Optional: MIDI input via WebMIDI for instrument-mode audition. | `apps/pack-builder/src/build-packs.ts` — include `manifest.soundRecipes` validation. Store integration per [PACK_CHAIN.md](./PACK_CHAIN.md) §11. | SL6, [PACK_CHAIN.md](./PACK_CHAIN.md) §11. |

Each phase is a single coherent commit. SL2–SL3 are
parallelizable behind a feature flag (`?soundLab=1` URL param)
so the editor tab can land while engine work is in flight.
SL4–SL6 are sequential — each builds on the prior. SL7 depends
on the Store landing.

---

## 12. Open questions

1. **Q1**: TTS/voice generation scope — synth-only or include
   speech? Lean **synth-only** for the MVP. Voice acting via
   the Sampler op consuming curated speech samples is the
   intended path. Modern browser TTS (`SpeechSynthesisUtterance`)
   could be a future op — interesting for procedurally-generated
   character dialogue — but TTS voices vary per browser and
   the determinism story breaks. Defer to SL8+ if anyone asks.

   **RESOLVED**: Synth-only for MVP. Voice via Sampler + curated speech assets. Full TTS deferred to SL7+ (community feature).

2. **Q2**: AudioWorklet vs ScriptProcessor for custom DSP (Bitcrush /
   Tape / FFT). Lean **AudioWorklet** — it's the modern path
   and ScriptProcessor is deprecated. Requires shipping a
   separate worklet module file alongside the engine (small
   build configuration change, see
   [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md)). Worklets
   bring their own complexity (cross-thread messaging, no
   direct AudioBuffer access on the worklet side). Alternative:
   implement Bitcrush as a `WaveShaperNode` curve approximation
   for the bit-reduction part (cheap, works without worklet);
   sample-rate reduction needs the worklet either way. Final
   decision pending — recommend AudioWorklet for SL4+ once we
   have the worklet build path settled.

   **RESOLVED**: AudioWorklet. Modern standard, lower latency, ScriptProcessor is deprecated.

3. **Q3**: Realtime instrument latency budget — what's acceptable for
   a Doom-style shooter? Web Audio's typical processing-block
   size is 128 samples (~2.7 ms at 48 kHz). Voice trigger
   latency includes node construction + scheduling overhead.
   Target **<30 ms total latency** (player presses fire →
   voice begins audible playback). Realistically achievable on
   modern desktop browsers; mobile / older hardware might push
   to 60–80 ms. If a future profile shows worse, we move the
   most-triggered instruments to a pre-baked static recipe and
   eat the per-shot variation loss.

   **RESOLVED**: <30ms target. Sufficient for Doom-pacing gameplay; tighter budgets require AudioContext-level tuning beyond Sound Lab's scope.

4. **Tempo / time signature — does Sound Lab need a global
   tempo per recipe?** Lean **yes** — added in §3.1 as a
   top-level `tempo` field (default 120 BPM). Read by Sequencer
   ops, by tempo-syncable delays / LFOs, by anywhere a
   `noteValue: "1/8"` shows up. Time signature isn't needed
   yet (we have no bar / beat concept beyond raw seconds);
   defer unless / until Sequencer grows into a piano roll.

5. **Q5**: WebMIDI input — accept WebMIDI events as a trigger
   source for instrument mode? **Defer to SL7+.** WebMIDI is
   well-supported but adds permission prompts and platform
   variance (Chrome / Edge / Firefox each have quirks). The
   virtual keyboard handles the audition case for SL6. Power
   users who want real MIDI playback can patch in via a small
   pack script that reads `navigator.requestMIDIAccess` and
   forwards note-on to `api.audio.playInstrument`.

   **RESOLVED**: SL7+ defer. Niche feature; not blocking MVP.

6. **Q6**: Polyphony cap + voice-stealing — default 16 voices?
   Configurable per recipe? **Configurable per recipe via
   `polyphony` field (§3.1, default 16).** Voice-stealing
   policy: oldest voice released first when the cap is hit. A
   per-recipe `voiceStealing: "oldest" | "quietest" | "newest"`
   field could land in SL6 if we see authors hitting the cap;
   default to oldest.

   **RESOLVED**: 16 voices default, oldest-first stealing strategy. Configurable per-instrument-recipe.

7. **Q7**: Source Files scoping — project-scoped or globally available?
   **Project-scoped** for SL4. Each project's IDB has its own
   `soundLabSourceFiles` store; copies of the same file across
   two projects are duplicated. Globally-shared source files
   would need a content-addressed store + reference counting +
   GC. Defer the global store to SL7 when the cardboard Store
   ships and provides a natural "community sounds" surface.

   **RESOLVED**: Project-scoped — each project's IDB sidecar holds its sources. Not pack-global; sources are user-imported per-project until promoted to pack assets.

8. **Q8**: AUDIO.md phase interaction — how does this interact with
   [AUDIO.md](./AUDIO.md)'s Au1-Au4 phases? Sound Lab slots
   in as effectively **Au5** — it doesn't replace the hand-
   authored `manifest.sounds` flow; it adds a procedural path
   that resolves alongside via the same `api.audio.play(id)`
   surface. AUDIO.md §11 question 10 ("AudioWorklet for future
   DSP") closes out here. AUDIO.md should add a line in §1's
   non-goals + in its phases table flagging Au5 as "Sound Lab —
   procedural recipes (see SOUND_LAB.md)." Update queued as a
   cross-doc edit (see "Cross-doc update recommendations" in
   the report).

   **RESOLVED**: Sound Lab slots in as Au5 (note: AUDIO.md cross-doc already updated).

9. **Q9**: Web Audio test framework in CI. `bun test`
   doesn't have an AudioContext shim. Options: (a) skip Web
   Audio tests in CI, run in dev only; (b) ship
   `node-web-audio-api` as a dev dep + thin polyfill;
   (c) write a manual deterministic DSP shim covering only the
   ops Sound Lab uses (likely 2-3 days of work). Recommend (b)
   for SL2; (c) becomes worth the effort if (b) shows
   precision issues.

   **RESOLVED**: OfflineAudioContext renders for deterministic tests. Pixel-equivalent for audio.

10. **Recipe content licensing — what do shared recipes carry?**
    Recipe JSON includes optional `license` field (§3.1, e.g.
    "CC0-1.0", "MIT", "All Rights Reserved"). Store
    integration (SL7) enforces a license declaration on
    upload. Default: "MIT" for first-party default-pack
    recipes; "CC0-1.0" recommended for community uploads.
    Belongs to Store policy work, not Sound Lab proper.

11. **Q11**: Recipe IDs vs `manifest.sounds` — share a namespace? **Yes** — they resolve through the
    same `api.audio.play(id)` and a collision is logged. This
    is the right thing for authors swapping a hand-authored
    sample for a procedural variant: the call sites don't
    change; only the manifest does. The downside: a typo in a
    recipe id that happens to match a sound id silently picks
    the wrong asset. The audit report flags collisions at
    pack-load time.

    **RESOLVED**: Shared namespace. Engine resolves through `api.audio.play(id)` checking recipes first, then static sounds.

12. **Q12**: Preset templates location — ship with the engine
    or with the default-pack? Lean **with the default-pack**
    as `default-pack/scripts/sound-recipes/*.json` so authors
    can fork the templates and the engine doesn't bloat with
    audio content. Engine ships only the empty starter
    template inline.

    **RESOLVED**: `pack/templates/sound/*.json`, parallel to other pack-shareable templates.

---

## 13. Cross-references

- [IDEAS.md](../IDEAS.md) — "Procedural assets (image + audio
  recipe DSL)" entry that seeded this plan. Sound Lab + Image
  Lab together fulfill that idea.
- [AUDIO.md](./AUDIO.md) — sibling audio plan. Sound Lab is an
  authoring layer on top of `api.audio.*` + `manifest.sounds`
  + the engine's `AudioBackend`. Specifically:
  - Au1 (shipped) provides the gain graph + group routing.
  - Au2 (positional + crossfade) is orthogonal — recipes route
    through `playPositional` just like recorded sounds.
  - Au3 (asset-mode editor surface for `SoundDef`) is the
    "hand-authored" counterpart to Sound Lab.
  - Au5 (proposed) = Sound Lab itself.
  - AUDIO.md §11 Q10 ("AudioWorklet for future DSP") resolves
    here.
- [IMAGE_LAB.md](./IMAGE_LAB.md) — sibling. Same 4-column shell;
  canonical in IMAGE_LAB.md §7.1.
- [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) — visual palette
  (zinc-950 panels, amber accents, uppercase-small-caps panel
  headers). Sound Lab joins the PrimaryTabs list (extending the
  current 7-tab strip to 8 + Image Lab + UI Builder = 10 when
  all land). §6.3 needs a follow-up edit to add "Sound Lab" to
  the canonical tab list.
- The materials plan (shipped; see git log) — plan-doc tone +
  density reference. This plan adopts its decision-oriented style.
- [PACK_CHAIN.md](./PACK_CHAIN.md) — multi-pack id resolution
  (`manifest.soundRecipes` is last-wins on collision, identical
  to `sounds`). §11 Store surface lands SL7's community
  recipes.
- [STORE.md](./STORE.md) — community asset Store. SL7
  publishes recipes here; Store policy governs licensing +
  attribution.
- [ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md) +
  `apps/editor/src/views/AnimationEditor.tsx` — bake-and-
  preview precedent. Sound Lab reuses the source-vs-baked
  split (Source Files = sources; rendered AudioBuffer + IDB
  cache = baked). UI primitives (canvas-based preview, source
  list with thumbnails, bake button, debounced auto-bake)
  parallel.
- [EDITOR_IFRAME.md](./EDITOR_IFRAME.md) — Playtest iframe
  message channel. Sound Lab's recipe-changed propagation
  rides this channel so live-running games pick up edited
  recipes mid-session.
- [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) — engine vs
  pack boundary. Sound Lab's compiler lives in
  `packages/engine/src/Audio/` (engine-side) so any pack can
  use recipes without reimplementing the runtime. The Sound
  Lab UI lives in `apps/editor/` (editor-side).
- `packages/engine/src/ModAPI/AudioRegistry.ts` — current
  audio resolver. SL2 extends it to look up recipe ids
  alongside sound ids.
- `apps/editor/src/views/AnimationEditor.tsx` — concrete
  precedent for the editor-side source-vs-baked split. Studied
  while drafting SL3.

---
