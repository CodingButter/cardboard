# Audio system — sound effects, music, positional + groups

A plan for adding a proper audio surface to the engine. Source of
truth for `api.audio.*`, the Web Audio backend that powers it, the
`manifest.audio` registry packs use to declare playable assets,
and the live-settings volume controls that let players mix the
game in real time.

Cross-refs: the materials plan (shipped; see git log) for the
ECS-attached subsystem pattern this borrows, [EDITOR.md](./EDITOR.md) §6 for
where audio authoring will eventually surface in the editor,
[PACK_CHAIN.md](./PACK_CHAIN.md) for multi-pack sound id
override semantics, [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md)
for the engine/pack boundary the audio layer sits at.

Last revised: 2026-05-16.

---

## 1. Goals & non-goals

### Goals

- **First-class `api.audio.*` ModAPI surface.** Pack scripts call
  `api.audio.play("gunshot")` and get back a handle they can stop,
  retune, or reposition. No more `new Audio()` raw-DOM hacks.
- **Spatial audio for free.** Positional sounds attach to a world
  position and attenuate by distance from the player; HRTF panning
  drops in via Web Audio's `PannerNode`. Listener position +
  facing auto-track the player's `Position` + `Facing` components.
- **Sound groups + live volume sliders.** `master`, `sfx`, `music`,
  `ambient`, `voice` each have their own gain node and Settings UI
  slider. Sliders apply instantly via gain updates — no reload, no
  audio dropout.
- **Pack-declared sound registry.** Same pattern as
  `manifest.sprites`. <!-- historical: `manifest.items` removed 2026-05-20 — item defs now live on entities (Item + Stackable components); pack-side item registry seeded from `data/items.json` via `scripts/setup/load-items.js`. --> Each sound has a stable
  id, a file path inside the pack, optional default volume +
  group. Scripts reference sounds by id; the pack-loader preloads
  every sfx-group sound to `AudioBuffer` at boot.
- **Crossfaded music.** `api.audio.crossfadeMusic("battle", 1.5)`
  fades out whatever's playing and fades in the new track over
  1.5 seconds. The engine guarantees exactly one music track is
  the "current" track at a time.
- **Modal-aware ducking.** When `api.modals.any()` is true, the
  master mix ducks (× 0.3 by default) so menus don't fight game
  audio. No code change required in pack scripts.
- **Zero-config baseline.** A pack with no `sounds` field and no
  `api.audio.*` calls behaves identically to today — no `AudioContext`
  is created, no gain graph is built, no extra bytes ship.

### Non-goals

- **DAW-style mixing.** No buses beyond the five flat groups, no
  per-sound EQ, no compression, no sidechain ducking. The Web
  Audio graph supports all of these; exposing them is a future
  follow-up if a pack needs it.
- **Streaming audio.** Sounds load as decoded `AudioBuffer`s into
  RAM. A 5-minute music track at 128 kbps OGG decodes to ~50 MB
  of float32 PCM — that's the upper bound we're willing to spend
  RAM on for one-pack-at-a-time loading. Long ambient tracks
  should be looped via `loop: true` rather than length.
- **Microphone input.** Voice chat lives in the multiplayer pack
  ([MULTIPLAYER_PLAN.md](./MULTIPLAYER_PLAN.md) M6). The audio
  system surface a `voice` group, but populating it with mic
  capture is the multiplayer pack's job.
- **Format transcoding at runtime.** The browser decodes whatever
  the pack ships (`.ogg` / `.mp3` / `.wav` / `.opus`). Cross-format
  fallback (ship `.mp3` for Safari, `.ogg` elsewhere) is the
  pack-builder's responsibility, not the runtime's. Au1 ships
  with `.ogg` only — see §11 open question.
- **Generative / procedural audio.** No oscillator wiring, no
  shader-style DSP graphs. Web Audio supports it; exposing it is
  a future Au4 task.
- **MIDI / tracker module playback.** `.xm` / `.mod` would be cute
  but the format zoo isn't worth the wrapper code. Modders who
  want chiptune ship pre-rendered `.ogg`.

---

## 2. Status quo (no audio)

The engine ships **zero** audio code today. The script-authoring
cookbook (`apps/docs/content/docs/cookbook.mdx`) explicitly flags
this gap and tells modders to fall back to raw DOM `new Audio()`
calls. That works in the narrowest sense — a `<audio>` element
will play a `.ogg` URL — but it's a dead end:

- **No positional attenuation.** A gunshot 30 tiles away plays at
  the same volume as one in your face. The modder would have to
  hand-roll distance math and feed it back into `element.volume`
  every frame.
- **No group mixing.** The player's Settings → Audio → "music
  volume" slider has nothing to bind to. Every sound is its own
  island.
- **No autoplay-policy handling.** Browsers won't let an
  `AudioContext` start until the user has clicked the page; an
  `<audio>` tag created at boot will hit a console warning. The
  engine should own the user-gesture trigger.
- **No coordination with modals.** A pack script can't easily duck
  itself when the Settings modal opens.
- **No preloading guarantee.** `<audio src=...>` may stream or may
  buffer depending on the browser; the first play of a sound can
  hitch if it hasn't been preloaded.
- **No reuse / pooling.** Each playback is its own DOM node and GC
  pressure; Web Audio's `AudioBufferSourceNode` is the proper
  primitive.

Adding `api.audio.*` once, in the engine, fixes all of this for
every present + future pack.

---

## 3. Manifest schema

### 3.1 Full shape

```jsonc
{
  "name": "Example Pack",
  "version": "1.0.0",

  // EXISTING fields ...

  "sounds": {
    "gunshot":      { "file": "audio/sfx/gunshot.ogg",   "volume": 0.8, "group": "sfx" },
    "footstep":     { "file": "audio/sfx/footstep.ogg",                  "group": "sfx" },
    "pickup_chime": { "file": "audio/sfx/pickup.ogg",    "volume": 0.6 },
    "ambient_wind": { "file": "audio/ambient/wind.ogg",  "loop": true,  "group": "ambient" },
    "music_main":   { "file": "audio/music/theme.ogg",   "group": "music" },
    "music_battle": { "file": "audio/music/battle.ogg",  "group": "music" }
  }
}
```

### 3.2 `SoundDef`

```ts
// packages/engine/src/AssetPack/types.ts
export type SoundGroup = "master" | "sfx" | "music" | "ambient" | "voice";

export interface SoundDef {
  /**
   * Path inside the pack. Browser-decodable: `.ogg`, `.mp3`, `.wav`,
   * `.opus`, `.m4a`. Recommend `.ogg` for cross-browser + license
   * friendliness. See §7.
   */
  file: string;
  /**
   * Per-sound base volume (0..1). Applied as a static gain on top of
   * the group's live volume. Defaults to 1.0.
   *
   * Use this to bake mastering into the manifest — if `gunshot.ogg`
   * was authored hot, set `volume: 0.7` here and authors never need
   * to remember to scale it at every call site.
   */
  volume?: number;
  /**
   * Group the sound routes to. Drives which Settings slider mixes
   * it. Defaults to `"sfx"`. `"master"` is exotic — use it for
   * notification sounds that should bypass the per-group sliders.
   */
  group?: SoundGroup;
  /**
   * Default looping behaviour. `playLoop(id)` ignores this; `play(id)`
   * respects it (a `loop: true` sound played via the one-shot API
   * still loops, which is the obvious thing for ambient beds).
   * Defaults to `false`.
   */
  loop?: boolean;
  /**
   * Eager-preload hint. `true` (default for `sfx` / `voice`) loads
   * + decodes the buffer at pack boot. `false` (default for
   * `music` / `ambient`) defers the fetch to the first play call.
   * Override here per sound. See §5.5.
   */
  preload?: boolean;
}
```

### 3.3 PackManifest extension

```ts
export interface PackManifest {
  // ... existing fields ...
  /**
   * Sound registry. Keys are referenced by `api.audio.play(id)`
   * et al. Files live anywhere in the pack — convention:
   * `audio/sfx/`, `audio/music/`, `audio/ambient/`. See §7.
   */
  sounds?: Record<string, SoundDef>;
}
```

### 3.4 Naming + namespacing

Sound ids follow the same flat-namespace convention as item ids
(`pickup_chime`, not `sfx.pickup.chime`). The pack-chain resolver
treats later packs as last-wins on collision, same semantics as
`items` / `sprites`. See [PACK_CHAIN.md](./PACK_CHAIN.md) §6 for
the override report format.

---

## 4. ModAPI surface (full)

### 4.1 `AudioAPI` interface

```ts
// packages/engine/src/ModAPI/types.ts (additions)
export interface AudioAPI {
  /**
   * Fire-and-forget. Plays the sound once (or loops, if the
   * SoundDef has `loop: true`). Returns a handle the caller can
   * use to stop it mid-play.
   */
  play(id: string, opts?: PlayOpts): AudioHandle;

  /**
   * Force-loop the sound regardless of its SoundDef. Returns a
   * handle whose `.stop()` is the only way to end it.
   */
  playLoop(id: string, opts?: PlayOpts): AudioHandle;

  /**
   * Cancel-and-replay variant of `play`. If the same id is already
   * playing, stop it first, then start fresh. Useful for UI
   * confirmations where overlapping playback sounds bad.
   */
  playReplace(id: string, opts?: PlayOpts): AudioHandle;

  /**
   * Distance-attenuated playback at a world position. The
   * listener follows the player's Position; this handle exposes
   * `.setPosition(p)` so callers can re-emit movement (footsteps
   * from a moving enemy, etc.).
   */
  playPositional(id: string, worldPos: Vec2, opts?: PositionalOpts): AudioHandle;

  /**
   * Stop the current music track (fade out over `fadeSeconds`) and
   * start `id` (fade in over the same span). If no music is
   * currently playing, just fades the new one in. Returns the
   * NEW music's handle. The previous handle is invalidated.
   *
   * Default fade: 1.0 s. Pass 0 for a hard cut.
   */
  crossfadeMusic(id: string, fadeSeconds?: number): AudioHandle;

  /** Stop a single handle. No-op if already stopped. */
  stop(handle: AudioHandle): void;

  /**
   * Stop every active handle, optionally restricted to one group.
   * `stopAll()` with no arg stops everything (including music).
   */
  stopAll(group?: SoundGroup): void;

  /**
   * Listener position. Auto-tracked to the player's Position
   * component every frame. Writable for exotic cases — e.g. an
   * "out of body" cutscene that overrides the listener.
   */
  listenerPosition: Vec2;

  /**
   * Listener facing as a unit vector. Drives stereo panning so a
   * sound to the player's left actually pans left. Auto-tracked
   * to the player's Facing component.
   */
  listenerFacing: Vec2;

  /**
   * Live per-group volume read/write. `set(group, v)` is what the
   * Settings slider calls; equivalent to writing to the
   * corresponding `GameConfig.audio.<group>Volume` and saving.
   */
  groupVolume: {
    get(group: SoundGroup): number;
    set(group: SoundGroup, v: number): void;
  };

  /** Returns `true` if the AudioContext is running. Diagnostic. */
  isReady(): boolean;
}

export interface PlayOpts {
  /** Multiplied onto `SoundDef.volume × groupGain`. Default 1.0. */
  volume?: number;
  /** Playback rate. 1.0 = normal, 0.5 = octave down, 2.0 = octave up. */
  pitch?: number;
  /** Override the SoundDef's group for this single playback. */
  group?: SoundGroup;
  /**
   * Detune in cents (±100 = ±1 semitone). Stacks with `pitch`.
   * Useful for "play the same footstep 10× without it sounding
   * mechanical" — randomize ±50 cents.
   */
  detune?: number;
}

export interface PositionalOpts extends PlayOpts {
  /**
   * Distance (tile units) past which the sound is inaudible.
   * Default 16.
   */
  falloffRadius?: number;
  /**
   * Reference distance — within this radius the sound plays at
   * full volume. Beyond it, attenuation kicks in. Default 1.
   */
  refDistance?: number;
  /**
   * Distance model. `"inverse"` (default) matches real-world
   * 1/r falloff; `"linear"` is artier; `"exponential"` is more
   * aggressive cutoff. Maps 1:1 to PannerNode's `distanceModel`.
   */
  distanceModel?: "inverse" | "linear" | "exponential";
}

export interface AudioHandle {
  /** The sound id this handle was created for. */
  readonly id: string;
  /** Which group's gain node this handle routes through. */
  readonly group: SoundGroup;
  /** `true` until the BufferSource has finished or been stopped. */
  isPlaying(): boolean;
  /** Re-set the per-handle gain (0..1). Live, no fade. */
  setVolume(v: number): void;
  /** Re-set playback rate. */
  setPitch(p: number): void;
  /** Re-set detune (cents). */
  setDetune(cents: number): void;
  /**
   * For positional handles only. Moves the emitter. No-op on
   * non-positional handles (with a console warning).
   */
  setPosition(worldPos: Vec2): void;
  /** Fade out over `seconds`, then stop. Default 0 = hard stop. */
  stop(seconds?: number): void;
}
```

### 4.2 ModAPI wiring

`ModAPI` gains one new readonly property:

```ts
export interface ModAPI {
  // ... existing fields ...
  /**
   * Audio playback surface — sfx, music, ambient, voice. See
   * `AudioAPI`. Pack scripts should NOT instantiate their own
   * `AudioContext`; use these calls so the engine owns mixing,
   * grouping, and modal ducking.
   */
  readonly audio: AudioAPI;
}
```

No other ModAPI methods added. Sounds are pure data and the
`registerSystem` / `registerPrefab` surface already covers
"when do we play it?" — pack scripts decide.

### 4.3 Handle lifecycle

```ts
const handle = api.audio.play("gunshot");
// ... time passes ...
if (handle.isPlaying()) handle.stop(0.2);  // 200ms fade-out
```

Handles are cheap proxies — about 80 bytes each. The engine
holds them in a `Set<AudioHandle>` so `stopAll` works; once a
handle's underlying `BufferSource` emits `ended`, the engine
drops it from the set automatically.

A handle that's been stopped becomes inert — `.setVolume`,
`.setPitch`, `.setPosition` are no-ops. `.isPlaying()` returns
`false`. This is safer than throwing and matches the
fire-and-forget contract of `play()`.

---

## 5. Web Audio architecture

### 5.1 The graph

```
                                         [PannerNode]──┐
                       ┌──── sfx ────────[BufferSource]─┤
                       │                                ├─── sfxGain ────┐
                       │  ── (one source per playback)  │                │
                       │                                                 │
                       ├──── music ──── BufferSource ── musicGain ───────┤
                       │                                                 │
[AudioContext.destination]────── master ── ambient ── BufferSource ──────┤
                       │                              ambientGain        │
                       │                                                 │
                       ├──── voice ──── BufferSource ── voiceGain ───────┤
                       │                                                 │
                       └─── masterGain ────────────────────────────── ───┘
```

Five `GainNode`s in front of the destination — one per group plus
one master:

```ts
masterGain.gain.value = CONFIG.audio.masterVolume * (anyModalOpen ? 0.3 : 1.0);
sfxGain.gain.value      = CONFIG.audio.sfxVolume;
musicGain.gain.value    = CONFIG.audio.musicVolume;
ambientGain.gain.value  = CONFIG.audio.ambientVolume;
voiceGain.gain.value    = CONFIG.audio.voiceVolume;

masterGain.connect(ctx.destination);
sfxGain.connect(masterGain);
musicGain.connect(masterGain);
ambientGain.connect(masterGain);
voiceGain.connect(masterGain);
```

Per-playback fragment:

```ts
const src = ctx.createBufferSource();
src.buffer = decodedBuffer;
src.playbackRate.value = opts.pitch ?? 1;
src.loop = soundDef.loop ?? false;

const perPlay = ctx.createGain();
perPlay.gain.value = (soundDef.volume ?? 1) * (opts.volume ?? 1);

src.connect(perPlay);
perPlay.connect(groupGainFor(group));   // sfxGain / musicGain / ...
src.start();
src.onended = () => liveHandles.delete(handle);
```

For positional playback the fragment becomes:

```ts
const panner = ctx.createPanner();
panner.distanceModel = opts.distanceModel ?? "inverse";
panner.refDistance = opts.refDistance ?? 1;
panner.maxDistance = opts.falloffRadius ?? 16;
panner.panningModel = "HRTF";        // free spatial audio in stereo
panner.positionX.value = worldPos.x;
panner.positionY.value = 0;          // 2.5D — we ignore Z
panner.positionZ.value = worldPos.y; // engine Y → audio Z

src.connect(perPlay);
perPlay.connect(panner);
panner.connect(groupGainFor(group));
```

### 5.2 The listener

Web Audio's `AudioListener` is updated every frame to track the
player's `Position` + `Facing`:

```ts
// In AudioSystem (engine-owned per-frame system):
const player = world.first(Position, Facing, Camera);
if (player) {
  const [pos, facing] = world.read(player, Position, Facing);
  ctx.listener.positionX.value = pos.x;
  ctx.listener.positionY.value = 0;
  ctx.listener.positionZ.value = pos.y;
  ctx.listener.forwardX.value = facing.x;
  ctx.listener.forwardY.value = 0;
  ctx.listener.forwardZ.value = facing.y;
  ctx.listener.upX.value = 0;
  ctx.listener.upY.value = 1;
  ctx.listener.upZ.value = 0;
}
```

The `api.audio.listenerPosition` / `.listenerFacing` writable
fields short-circuit this — when a pack writes to them, the
auto-tracker holds off for that frame and writes the supplied
values instead. Useful for cutscenes.

### 5.3 Lazy context bootstrap

Browsers block `AudioContext.resume()` until the user has
clicked somewhere on the page (Chrome's autoplay policy). The
engine handles this transparently:

1. At engine boot, **don't** create the AudioContext.
2. On the first call to any `api.audio.*` method, lazily
   construct the context + gain graph + start decoding any
   `preload: true` sounds.
3. If the context is still in `suspended` state (the user hasn't
   clicked yet), the engine attaches a one-shot `pointerdown` /
   `keydown` listener that calls `ctx.resume()` and removes
   itself. Any `play()` calls before that gesture get queued
   for ≤ 1 second; queued sounds beyond the window are dropped
   with a console warning.
4. The Settings modal's "Audio" tab gets a "Click to enable
   audio" prompt if the context can't be resumed after page load
   (the user opened the page but hasn't interacted yet).

The first `play()` call from inside an event handler (mouse
click, key press) Just Works — the user's gesture context
satisfies the autoplay policy and the queue is empty.

### 5.4 Preloading + decode

At pack-load time, after the manifest is parsed:

1. Walk `manifest.audio`, partition by `preload` (default `true`
   for `sfx` + `voice`, `false` for `music` + `ambient`).
2. For each eager sound, fetch the bytes via
   `pack.binaryBlob(soundDef.file)` (new `AssetPack` method —
   today there's only `textureBlob` / `textBody`), then
   `ctx.decodeAudioData(arrayBuffer)`.
3. Cache the resulting `AudioBuffer` in a `Map<id, AudioBuffer>`.
4. Lazy sounds get a placeholder `LoadingSound` entry; the first
   `play()` call awaits the decode (returns a "pending" handle
   whose `.stop()` aborts the load).

Decode is async per sound — the engine doesn't block on it;
sounds become playable as their buffers complete. A pack with
zero `sounds` skips all of this entirely.

### 5.5 Preload strategy

Two-tier:

| Tier | When loaded | Suitable for |
|---|---|---|
| **Eager** (`preload: true`) | At pack-load time, decoded into RAM | sfx, voice, short ambient one-shots |
| **Lazy** (`preload: false`) | On first `play()`, with a brief wait | music, long ambient beds |

Defaults: sfx + voice = eager, music + ambient = lazy. Override
per sound in the manifest. The total eager budget is intentionally
unbounded — the engine logs the cumulative decoded-PCM RAM at
boot so authors can see when they've overspent (a console line
like `[two_5_d] audio: 42 eager sounds, 28.4 MB decoded`).

### 5.6 BufferSource per playback

Web Audio's `AudioBufferSourceNode` is **single-use** — once
`start()` is called it can't be reused. Every `play()` creates a
fresh `BufferSource`, wires it through the per-play gain →
group gain → master gain, and trusts the GC to clean up after
`onended`. Modern browsers handle this efficiently (the
internal pool is small and reused); we don't try to pool ourselves.

### 5.7 Where it lives

```
packages/engine/src/Audio/
├── AudioBackend.ts        // AudioContext + gain graph + decode cache
├── AudioHandle.ts         // The handle proxy class
├── AudioAPI.ts            // ModAPI binding — wraps backend in the AudioAPI shape
└── AudioSystem.ts         // Per-frame system — listener updates + modal ducking
```

`AudioBackend` is the only module that touches Web Audio
primitives. `AudioAPI` is what the ModAPI exposes. The system is
registered as a built-in (engine-owned, not pack-side) and runs
after PlayerInput but before render.

---

## 6. Settings integration

### 6.1 GameConfig extension

```ts
// packages/engine/src/GameConfig.ts (additions)
export interface GameConfig {
  // ... existing fields ...
  audio: {
    /** Global volume multiplier (0..1). Slider in Settings → Audio. */
    masterVolume: number;
    /** Per-group volumes (0..1). */
    sfxVolume: number;
    musicVolume: number;
    ambientVolume: number;
    voiceVolume: number;
    /**
     * Modal-open ducking multiplier applied to masterGain when any
     * modal is open. 1.0 = no duck; 0.0 = mute; 0.3 = default.
     */
    modalDuck: number;
  };
}
```

Baseline values in `game.config.json`:

```jsonc
{
  "audio": {
    "masterVolume": 0.8,
    "sfxVolume": 1.0,
    "musicVolume": 0.7,
    "ambientVolume": 0.8,
    "voiceVolume": 1.0,
    "modalDuck": 0.3
  }
}
```

### 6.2 Settings modal UI

The default pack's Settings modal (registered via `api.ui`) gains
an "Audio" tab with six sliders:

```
┌─ Audio ───────────────────────────────────────────┐
│  Master       [████████░░░] 80 %                  │
│                                                   │
│  SFX          [██████████░] 100 %                 │
│  Music        [███████░░░░] 70 %                  │
│  Ambient      [████████░░░] 80 %                  │
│  Voice        [██████████░] 100 %                 │
│                                                   │
│  Modal duck   [███░░░░░░░░] 30 %                  │
│  ☐ Test sound  [▶]                                │
└───────────────────────────────────────────────────┘
```

Every slider is **live**:

- `onInput` (the slider drag event, NOT just `onChange`) fires
  `api.audio.groupVolume.set("sfx", v)`, which writes the new gain
  to the corresponding `GainNode.gain.value` immediately.
- On release, the change persists via `api.settings.save()` —
  same flow as every other live setting today.

A "Test sound" button plays `audio.testSound` (engine ships a
short triangle-wave blip the pack can override by declaring a
sound with that id).

### 6.3 Why GainNode and not multiplying everywhere

`GainNode.gain` is an `AudioParam` — assignments to `.value`
take effect at the next audio quantum (~3 ms). Adjusting the
master gain by writing a single float is cheaper and click-free
compared to walking every live `BufferSource` to recompute its
volume. It also handles new playbacks for free: a sound started
*after* the slider moved sees the new gain by virtue of being
connected to the updated node.

---

## 7. Pack format

### 7.1 Directory conventions

Recommended (not enforced) layout:

```
mypack.apg
├── manifest.json
├── audio/
│   ├── sfx/
│   │   ├── gunshot.ogg
│   │   ├── footstep.ogg
│   │   └── pickup.ogg
│   ├── ambient/
│   │   └── wind.ogg
│   ├── music/
│   │   ├── theme.ogg
│   │   └── battle.ogg
│   └── voice/
│       └── intro.ogg
└── ...
```

Sounds can live anywhere in the pack — `manifest.audio.<id>.file`
is the source of truth. The `audio/` convention is purely for
human authors; the pack-builder doesn't enforce it.

### 7.2 File format recommendation

**Ship `.ogg` Vorbis.** Reasons:

1. **Cross-browser.** Plays in every browser the engine targets
   (Chromium, Firefox, Safari ≥ 15).
2. **Patent-clean.** Vorbis is unencumbered. MP3 patents expired
   in 2017 but the encoder ecosystem is still messier.
3. **Size.** OGG at q=4 (~80 kbps) is indistinguishable from MP3
   at 128 kbps for sfx; q=6 (~160 kbps) is fine for music.
4. **Loop-friendly.** OGG can loop without the encoder gap that
   plagues MP3 at file boundaries.

`.mp3` works as a fallback if a pack already has MP3 assets;
`.wav` works for tiny sfx where decode cost matters more than
download size; `.opus` is excellent quality-per-bit but Safari
support is recent enough that we don't recommend it as the only
format. The runtime treats them all identically — the browser
decodes whatever the URL serves.

### 7.3 Pack-builder integration

`apps/pack-builder/src/build-packs.ts` already copies arbitrary
files into the zip. Adding audio support requires:

1. **File discovery.** Walk `audio/**/*.{ogg,mp3,wav,opus,m4a}`
   in the pack source dir; include each in the zip verbatim.
2. **Validation.** Every id in `manifest.audio` must resolve to
   an actual file. Missing files → warning + skip (same severity
   as missing texture paths today).
3. **Cumulative size report.** Print total audio bytes added to
   the zip so authors can see when they've overspent. (60 MB of
   `.ogg` in a pack is unusual; flag at ≥ 25 MB with a note.)
4. **Optional transcode pass (future).** A `--audio-transcode`
   flag could run `ffmpeg` (if installed) to normalize loudness
   and ensure consistent bitrate. Out of scope for Au1.

### 7.4 Pack-chain semantics

[PACK_CHAIN.md](./PACK_CHAIN.md) §6 last-pack-wins on id collision
applies verbatim. A pack that redeclares `gunshot` overrides the
upstream pack's; the soft-override report lists the conflict.

Useful pattern: a "high-fi audio pack" that depends on the
default pack and redeclares every default sound id with louder /
remastered files. Players install it; the engine uses the new
sounds with zero script changes.

---

## 8. Worked examples

### 8.1 Weapon fire (one-shot sfx)

```js
// In packages/default-pack/scripts/systems/gun-render.js, inside the
// fire branch of the per-frame update:
function fireWeapon(api) {
  // ... existing logic that decrements mag, applies recoil, etc. ...

  api.audio.play("gunshot", {
    volume: 0.8,
    // Slight detune per shot so rapid-fire doesn't sound mechanical:
    detune: (Math.random() - 0.5) * 100,
  });
}
```

The handle is discarded — fire-and-forget. The `SoundDef`'s
`group: "sfx"` routes it through `sfxGain`, so the player's "SFX
volume" slider mixes every gunshot in real time.

### 8.2 Pickup chime (event-driven sfx)

```js
// In a pack-side pickup system:
api.registerSystem((world) => {
  world.each(api.components.Pickup, (e, pickup) => {
    if (pickup.collectedThisFrame) {
      api.audio.play("pickup_chime");
    }
  });
});
```

No options — uses the SoundDef's default volume + group. Plays at
a consistent loudness whether the chime is for a 9mm round or
a plate-armor pickup; the gameplay-side distinction is in the
UI, not the audio.

### 8.3 Looping footsteps with per-step pitch jitter

```js
// In a player-locomotion system:
let stepTimer = 0;
const STEP_INTERVAL = 0.35;  // seconds between steps

api.registerSystem((world, dt) => {
  const player = world.first(api.components.PlayerInput, api.components.Movement);
  if (!player) return;
  const [_, move] = world.read(player, api.components.PlayerInput, api.components.Movement);
  const moving = move.velocity.length() > 0.01;
  if (!moving) { stepTimer = 0; return; }

  stepTimer += dt;
  if (stepTimer >= STEP_INTERVAL) {
    stepTimer = 0;
    api.audio.play("footstep", {
      volume: 0.5,
      // ±10% pitch variation per step:
      pitch: 0.9 + Math.random() * 0.2,
    });
  }
});
```

Notice: even though the player can fire ten footsteps in two
seconds, each one is a fresh `BufferSource` from the same
decoded buffer. No allocation of audio data, just node objects.

### 8.4 Spatial enemy growl

```js
// In an AI system, when an enemy enters "alerted" state:
function alertEnemy(api, enemyEntity) {
  const [pos] = api.world.read(enemyEntity, api.components.Position);
  api.audio.playPositional("zombie_growl", pos, {
    falloffRadius: 12,
    refDistance: 2,
    volume: 0.9,
  });
}
```

The growl pans + attenuates as the player walks around the
enemy. If the enemy walks too, the system can hold the handle
and call `.setPosition` per frame:

```js
const handle = api.audio.playLoop("zombie_growl", { /* ... */ });
api.registerSystem(() => {
  if (!handle.isPlaying()) return;
  const [pos] = api.world.read(enemyEntity, api.components.Position);
  handle.setPosition(pos);
});
```

### 8.5 Combat music transition (crossfade)

```js
// In a combat-state system:
let inCombat = false;
let musicHandle = api.audio.crossfadeMusic("music_main", 0);

api.registerSystem(() => {
  const enemiesNearby = countAlertedEnemies(api) > 0;
  if (enemiesNearby && !inCombat) {
    inCombat = true;
    musicHandle = api.audio.crossfadeMusic("music_battle", 1.5);
  } else if (!enemiesNearby && inCombat) {
    inCombat = false;
    musicHandle = api.audio.crossfadeMusic("music_main", 3.0);
  }
});
```

The engine guarantees exactly one music track is "current" —
`crossfadeMusic` stops whatever was playing (with a fade) and
starts the new one. Pack scripts don't have to track previous
handles.

### 8.6 Ambient bed for a scene

```js
// In a scene-load hook:
api.onWorldReady((api) => {
  if (api.scene.metadata?.ambience === "outdoor_windy") {
    api.audio.playLoop("ambient_wind", { volume: 0.4 });
  }
});
```

Pack-side decision; the engine doesn't know about "ambience" as a
concept. A future iteration might expose scene metadata fields
the engine reads directly, but the layered approach today keeps
the engine narrow.

### 8.7 UI confirmation (cancel-and-replay)

```js
// Player tabs through the inventory grid:
function onSlotFocus(api) {
  // playReplace, not play — overlapping tick noises sound terrible:
  api.audio.playReplace("ui_tick", { volume: 0.4 });
}
```

`playReplace` stops any in-flight `ui_tick` before starting the
new one, so rapidly cycling slots produces clean discrete ticks
instead of a layered drone.

---

## 9. Editor UX (brief — defer)

[EDITOR.md](./EDITOR.md) §5.1 already lists **Assets** mode as one
of the four workflow modes, and §6 punts on the per-asset-type
inspector forms. Audio will surface there as a future task.

Minimum useful Editor surface (deferred to **Au3**):

- **Asset sidebar entry.** "Sounds" group in Assets mode listing
  every `manifest.audio` id with its file path + group + volume.
- **Preview / audition.** Click a sound → inspector shows a play
  button + a waveform thumbnail. Plays through the engine's
  AudioBackend so the user hears the result of the per-sound
  volume + group mixing exactly as the game would.
- **Drop-to-import.** Drag a `.ogg` into the sidebar → creates a
  new `SoundDef` with the file path filled in and a UUID-ish id
  the user can rename.
- **Per-id inspector form.** Editable group dropdown, volume
  slider, loop checkbox, preload toggle. Writes back to
  `manifest.audio` in IDB; the running engine picks up the
  changes on next preload.
- **Scene-level audio metadata.** A scene's `metadata.ambience`
  string + a "drop a sound here" target for the default
  ambient-bed pattern from §8.6. Stretch — only useful once
  scene-level audio metadata is a thing the engine recognizes.

None of this is on the critical path for the audio system itself.
Au1 ships zero editor support and audio still works (modders
edit `manifest.json` by hand).

---

## 10. Phases

| Phase | Scope | Where it lives | State |
|---|---|---|---|
| **Au1** | **Core surface.** `manifest.audio` schema + `SoundDef`. `api.audio.play` / `playLoop` / `playReplace` / `stop` / `stopAll`. Web Audio gain graph (master + 5 groups). Lazy AudioContext bootstrap with one-shot user-gesture resume. `GameConfig.audio` + Settings sliders (live). Default-pack ships 2 sample sounds (gunshot + pickup chime) wired into the existing gun-render + pickup systems. | engine/src/ModAPI/AudioRegistry.ts (Au1 shipped surface — see §12), engine/src/ModAPI/types.ts, engine/src/GameConfig.ts, engine/src/AssetPack/types.ts, default-pack/audio/, default-pack/scripts/systems/gun-render.js + pickup.js | ✅ Shipped (commit `52d8e27`). Surface landed in `packages/engine/src/ModAPI/AudioRegistry.ts` rather than a standalone `engine/src/Audio/` directory; §12 implementation summary describes the as-shipped layout. |
| **Au2** | **Spatial audio + music.** `playPositional` with PannerNode + HRTF. Listener auto-tracking. `crossfadeMusic`. Modal-open ducking via `api.modals.any()` driving `masterGain × CONFIG.audio.modalDuck`. Default-pack adds an ambient bed + theme music + battle music. | packages/engine/src/ModAPI/AudioRegistry.ts (PannerNode path), AudioSystem (listener tracking + ducking), packages/default-pack/audio/{music,ambient}/ | Designed. Depends on Au1. |
| **Au3** | **Editor authoring.** Assets-mode sidebar entry for sounds. Preview + audition. Drag-to-import `.ogg` files. Per-sound inspector form. Manifest writes round-trip through IDB. | apps/editor/src/components/AssetsMode/Sounds*, apps/editor/src/lib/audioPreview.ts | Designed. Depends on Au1 + [EDITOR.md](./EDITOR.md) E5. |
| **Au4** | **Advanced mixing.** Per-scene convolution reverb (a "room ambience" tag drives an impulse-response file). Dynamic per-handle EQ. Optional `pack-builder --audio-transcode` ffmpeg pass for loudness normalization. Future-proofing for procedural / DSP graphs. | engine/src/Audio/Reverb.ts, apps/pack-builder/src/audio-transcode.ts | Designed at high level; spec to come once Au1–Au3 ship. |

---

## 11. Open questions

1. **File format strategy.** Ship `.ogg` only (Au1
   recommendation), or support multi-format fallback
   (`<source>`-style "first decodable format wins" lookup at
   play time)? Multi-format is straightforward — `decodeAudioData`
   succeeds or fails per format and the engine can try the next
   — but doubles pack size for every sound that has both formats.
   Recommend `.ogg` only for Au1; revisit if a Safari-specific
   regression appears.

2. **Eager vs lazy default split.** Au1 ships
   `preload: true` for `sfx` + `voice` and `preload: false` for
   `music` + `ambient`. Open: what does an `"ambient"` one-shot
   (a single thunderclap, say) do? Author has to override to
   `preload: true` if they want it ready instantly. Possibly the
   default should be: short files (< 500 KB encoded) eager,
   regardless of group; long files lazy. Defer — try the simple
   group-based rule first and see how often authors override.

3. **Modal-open behaviour: duck vs pause.** Au1 ducks
   (multiply masterGain by `CONFIG.audio.modalDuck`, default
   0.3). Some games hard-pause music in menus. The two are easy
   to support side-by-side with a `CONFIG.audio.modalBehaviour:
   "duck" | "pause"` field; defer until anyone asks. Recommend
   duck-only for Au1.

4. **Multi-instance play of one sound id.** `play(id)` of an
   already-playing sound layers (each call = new
   `BufferSource`). `playReplace(id)` stops the previous one
   first. Open: should there be a per-sound cap (e.g.
   `SoundDef.maxInstances?: number`) to prevent an out-of-control
   pack-script bug from spawning 1000 simultaneous gunshots?
   Recommend deferring — the cost of an overplay bug is annoying
   audio, not a crash, and the engine logs a warning when total
   live handles exceeds 64.

5. **PannerNode listener axis convention.** Web Audio's listener
   uses 3D coords (X right, Y up, Z forward). Our engine is 2.5D
   with X / Y in the floor plane. The mapping in §5.1 sets
   `panner.positionY = 0` and treats engine's Y as the listener's
   Z. Consequence: there's no "height" component to audio. If
   we ever add per-light Z (per LIGHTING_OVERHAUL.md) and want
   per-source Z, we'd promote `worldPos` to `Vec3` for
   `playPositional`. Defer.

6. **Sound id vs file path as ModAPI key.** `api.audio.play("gunshot")`
   takes the manifest id. Open: should there be an escape hatch
   `api.audio.playRaw(url, opts)` for pack scripts that want to
   play arbitrary URLs (e.g. server-supplied voice clips in
   multiplayer)? Useful but security-adjacent — a script that
   takes URLs from network input could be tricked into fetching
   anywhere. Defer. Multiplayer voice will route through the
   `voice` group via a higher-level API anyway.

7. **Crossfade gain curve.** §4.1's `crossfadeMusic` uses a
   linear gain ramp (`gain.linearRampToValueAtTime`). For
   constant-power crossfade (no perceived dip in the middle),
   we'd want an equal-power curve (`sin(t × π/2)` /
   `cos(t × π/2)`). Linear is good enough for Au1; revisit if it
   sounds dippy. Probably surface a `CONFIG.audio.crossfadeCurve:
   "linear" | "equal-power"` in Au2.

8. **AudioContext sample rate.** Web Audio picks a default
   (usually 48 kHz on modern hardware, 44.1 on older). Sounds
   authored at 44.1 play correctly through a 48 kHz context (the
   browser resamples in `decodeAudioData`). No action needed
   unless we want explicit control — defer.

9. **Test-coverage strategy.** Web Audio is hard to unit-test
   without a real browser (no `bun:test` mock for `AudioContext`).
   Plan: thin wrapper around `AudioContext` instantiation, plus
   a mock in tests. Validate handle lifecycle + group volume
   bookkeeping without actually decoding anything. Smoke test
   in the dev server.

10. **AudioWorklet for future DSP.** Au4 mentions procedural
    audio. The proper substrate for that is `AudioWorklet`
    (sample-accurate JS DSP on the audio thread). Out of scope
    for Au1–Au3; flag here so we don't accidentally architect
    away the option.

---

## 12. Implementation summary (Au1)

Files touched / added:

- `packages/engine/src/Audio/AudioBackend.ts` — **NEW.**
  AudioContext + gain graph + decode cache + buffer-source
  factory.
- `packages/engine/src/Audio/AudioHandle.ts` — **NEW.** Handle
  proxy class.
- `packages/engine/src/Audio/AudioAPI.ts` — **NEW.** ModAPI
  binding wrapping the backend.
- `packages/engine/src/Audio/AudioSystem.ts` — **NEW.**
  Per-frame system (listener tracking + modal ducking).
- `packages/engine/src/Audio/index.ts` — **NEW.** Barrel.
- `packages/engine/src/ModAPI/types.ts` — extended `ModAPI` with
  `readonly audio: AudioAPI` + `AudioAPI` / `PlayOpts` /
  `PositionalOpts` / `AudioHandle` / `SoundGroup` interfaces.
- `packages/engine/src/ModAPI/ModAPI.ts` — wire `audio` field
  in the bootstrap.
- `packages/engine/src/AssetPack/types.ts` — `SoundDef` interface,
  `sounds?: Record<string, SoundDef>` field on `PackManifest`.
- `packages/engine/src/AssetPack/AssetPack.ts` — `binaryBlob`
  method (alias / sibling of `textureBlob`).
- `packages/engine/src/GameConfig.ts` — `GameConfig.audio` block.
- `packages/engine/game.config.json` — `audio` defaults.
- `packages/engine/src/Game.ts` — register `AudioSystem` in the
  built-in system list.
- `packages/default-pack/manifest.json` — `sounds` registry with
  `gunshot` + `pickup_chime`.
- `packages/default-pack/audio/sfx/gunshot.ogg` — **NEW.** Sample.
  (Historical: actually shipped as the synthesised `gunshot.wav`
  placeholder via `scripts/gen-audio-stubs.ts`. Replaced 2026-05-17 by
  wiring the `gunshot` id to the recorded `audio/sfx/riffle_shot.mp3`;
  the placeholder `gunshot.wav` was deleted.)
- `packages/default-pack/audio/sfx/pickup.ogg` — **NEW.** Sample.
- `packages/default-pack/scripts/systems/gun-render.js` —
  `api.audio.play("gunshot")` in the fire branch.
- `packages/default-pack/scripts/systems/pickup.js` —
  `api.audio.play("pickup_chime")` on collect.
- `packages/default-pack/scripts/screens/settings.tsx` — new
  "Audio" tab with five sliders + modal-duck slider.
- `apps/pack-builder/src/build-packs.ts` — include
  `audio/**/*.{ogg,mp3,wav,opus,m4a}` in the zip; validate that
  every `manifest.audio.<id>.file` resolves; size report.

No new ModAPI methods beyond the `audio` namespace. Canvas2d +
WebGL2 backends both work without modification (audio is
backend-independent).
