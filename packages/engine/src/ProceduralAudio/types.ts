/**
 * Sound Lab — JSON recipe types.
 *
 * SL2 MVP shape from `docs/plans/SOUND_LAB.md` §3. The runtime engine
 * accepts (and the lab editor will eventually emit) JSON conforming to
 * this schema, compiles it to a Web Audio node graph, and renders
 * (static / loop) or instantiates per voice (instrument).
 *
 * The full SOUND_LAB.md surface lists many more ops; SL2 ships a
 * focused subset — oscillator, noise, filter, envelope, lfo, gain,
 * mixer, pan, delay, reverb, output. Op-specific param shapes live
 * in `Ops/*.ts` files; this module exposes the catch-all
 * `AudioNodeJson` shape and discriminating fields.
 */

import type { SoundGroup } from "../AssetPack/types";

/** Top-level recipe object. See SOUND_LAB.md §3.1. */
export interface SoundRecipeJson {
  /** Stable id within the pack — referenced by `api.audio.play(id)`. */
  id: string;
  /** Schema version. SL2 ships v1. */
  version?: number;
  /** Output mode — picks the compiler path. */
  mode: "static" | "loop" | "instrument";
  /**
   * Duration in seconds. For static/loop: clamps the OfflineAudioContext
   * render. For instrument: ignored (voices end via envelope release or
   * explicit stop). Default 1.0.
   */
  duration?: number;
  /**
   * Output sample rate. Default: match the host context (live mode) or
   * 48000 (offline render). Some browsers refuse `OfflineAudioContext`
   * sample rates outside 8000..96000.
   */
  sampleRate?: number;
  /** 1 = mono, 2 = stereo. Default 2. */
  channels?: 1 | 2;
  /** Group routing. Defaults to the call-site PlayOpts.group or "sfx". */
  group?: SoundGroup;
  /** Deterministic seed for noise + random ops. Default 1. */
  seed?: number;
  /** Tempo (BPM). Reserved for sequencer + tempo-synced ops. Default 120. */
  tempo?: number;
  /** Polyphony cap for instrument mode. Default 16. */
  polyphony?: number;
  /** Optional loop-seam ramp duration in seconds (loop mode). Default 0. */
  loopRamp?: number;
  /** Node graph. Order doesn't matter — edges are explicit by id. */
  nodes: AudioNodeJson[];
  // Optional metadata. Surfaced in editor browsing UI.
  displayName?: string;
  tags?: string[];
  author?: string;
  license?: string;
}

/**
 * One node in a recipe. Op-specific param shapes are declared in
 * `Ops/*.ts`. The `inputs` map keys to source node ids — the canonical
 * Sound Lab shape — and the `modulation` array drives per-AudioParam
 * modulation.
 *
 * Two `inputs` shapes are accepted for ergonomic recipes:
 *   1. `inputs: ["nodeA", "nodeB"]` — bag of audio-graph inputs,
 *      consumed positionally by ops like `mixer`.
 *   2. `inputs: { input: "nodeA", trigger: "envOut" }` — named-port
 *      form, used when an op has multiple input slots (envelopes
 *      consume a `trigger`; gain consumes `input`).
 *
 * SL2 ops normalize both at compile time.
 */
export interface AudioNodeJson {
  /** Per-recipe-unique node id. */
  id: string;
  /** Op type — drives which factory in `Ops/*` instantiates it. */
  op: string;
  /** Op-specific parameters. Numeric values may be automation blocks (SL4+). */
  params?: Record<string, unknown>;
  /** Audio-graph inputs. Array OR named-port object. Default: none. */
  inputs?: string[] | Record<string, string>;
  /** Modulation routes targeting AudioParams on this node. */
  modulation?: ModulationRouteJson[];
  /**
   * Envelope-trigger mode. Only meaningful on envelope ops. Values:
   *   - "immediate" — fires at recipe / voice start. Static + loop default.
   *   - "gate" — fires on note-on, releases on note-off. Instrument default.
   *   - "manual" — never auto-fires; trigger source required.
   */
  trigger?: "immediate" | "gate" | "manual";
}

/**
 * One modulation route. `source` is a node id whose audio-rate output
 * is connected (via `connect(audioParam)`) to the consumer's named
 * AudioParam. `amount` is multiplied in via a small per-route GainNode
 * so authors can dial modulation depth without retuning the source.
 */
export interface ModulationRouteJson {
  /** Source node id — its audio output drives the target param. */
  source: string;
  /** Name of the AudioParam on the consumer node (e.g. "gain", "frequency"). */
  param: string;
  /** Multiplier on the source signal. Default 1.0. */
  amount?: number;
}

/**
 * Options the engine passes to `playInstrument(id, opts)`. Per-voice
 * overrides for note frequency, gate length, and velocity. See
 * SOUND_LAB.md §3.5.
 */
export interface PlayInstrumentOpts {
  /** Note frequency in Hz. Maps to `frequency` on any oscillator marked `voiceNote: true`. */
  frequency?: number;
  /** Gate length in seconds. Voices auto-release after this duration. */
  gateMs?: number;
  /** Velocity 0..1 — scales the output gain. Default 1. */
  velocity?: number;
  /** Group override. Defaults to recipe.group or "sfx". */
  group?: SoundGroup;
  /** Volume multiplier. Default 1. */
  volume?: number;
}

/**
 * Cached buffer + metadata stashed for the bake of a static/loop recipe.
 * Lives in IDB keyed by content hash. The engine version is folded into
 * the hash so a renderer upgrade auto-invalidates stale bakes.
 */
export interface CachedBakeRecord {
  /** SHA-256 of the recipe's canonical JSON (incl. engine version). */
  hash: string;
  /** Raw PCM channel data, one Float32Array per channel. */
  channels: Float32Array[];
  sampleRate: number;
  /** Total frames per channel. */
  length: number;
  /** Wall-clock at write time — for LRU eviction. */
  writtenAt: number;
}
