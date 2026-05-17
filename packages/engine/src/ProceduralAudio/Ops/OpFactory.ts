/**
 * Op-factory protocol for the Sound Lab compiler.
 *
 * The compiler walks the recipe's nodes in topological order and, for
 * each node, calls into the matching op factory below. Factories
 * receive everything they need to instantiate a Web Audio sub-graph:
 *
 *   - `ctx` — the destination context (Audio OR OfflineAudio).
 *   - `node` — the JSON node, including its `params`.
 *   - `recipe` — the whole recipe (for seed defaults, tempo, etc.).
 *   - `voice` — per-voice context (instrument mode only). `null` for
 *     static + loop bakes. Carries the voice's gate / frequency / etc.
 *
 * The return value is a `BuiltNode` — an `AudioNode` whose `connect()`
 * /  `disconnect()` semantics match Web Audio. The compiler treats
 * the returned node as opaque audio.
 *
 * For ops that need to expose multiple ports (e.g. envelope's "trigger"
 * input vs its "control" output), the `inputAt(port)` method lets the
 * compiler look up the right `AudioNode` to wire upstream sources
 * into. Most ops only have a default "input" port and can skip this.
 */

import type { AudioNodeJson, PlayInstrumentOpts, SoundRecipeJson } from "../types";

export interface VoiceContext {
  /** Per-voice playback options forwarded from `playInstrument(opts)`. */
  readonly opts: PlayInstrumentOpts;
  /** Live AudioContext for instrument voices. Same one each voice shares. */
  readonly ctx: AudioContext;
  /** Voice on-time in `ctx.currentTime` seconds. */
  readonly startTime: number;
  /** Voice gate length in seconds (Infinity for "until stop"). */
  readonly gateSeconds: number;
}

export interface BuiltNode {
  /**
   * The op's audio output. Compiler calls `.connect(consumer)` on this
   * to wire to downstream nodes (or to the offline destination / group
   * gain at the terminal output node).
   */
  output: AudioNode;
  /**
   * Per-port input lookup. Compiler calls `inputAt(portName)` to find
   * the upstream connection point for a named port. If the op accepts
   * a default audio input only, returning `this.output` for the default
   * port is wrong — the implementation should expose the actual input
   * GainNode here.
   *
   * Ports that aren't audio inputs but `AudioParam`s (e.g. an op's
   * modulatable `frequency`) live under `paramAt` below.
   */
  inputAt?(port: string): AudioNode | undefined;
  /**
   * Per-param lookup for modulation routing. The compiler walks each
   * node's `modulation` array, then calls `consumer.paramAt(route.param)`
   * to fetch the target `AudioParam`. Web Audio supports
   * `connect(audioParam)` — the modulator's signal sums into the param.
   */
  paramAt?(name: string): AudioParam | undefined;
  /**
   * Optional dispose hook — called by the compiler when the compiled
   * recipe is torn down. Most ops don't need this; ones that retain
   * timers, listeners, or worklet ports should release them here.
   */
  dispose?(): void;
}

/**
 * Factory signature. Receives the compile-time context, returns a
 * ready-to-wire node. Factories may schedule AudioParam events on the
 * spot — for offline contexts the schedule executes during
 * `startRendering`; for live contexts it executes against
 * `ctx.currentTime`.
 */
export type OpFactory = (
  ctx: BaseAudioContext,
  node: AudioNodeJson,
  recipe: SoundRecipeJson,
  voice: VoiceContext | null,
) => BuiltNode;

/** Look up a numeric parameter, falling back to the supplied default. */
export function numParam(
  params: Record<string, unknown> | undefined,
  name: string,
  fallback: number,
): number {
  const v = params?.[name];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Automation blocks land in SL4 — for SL2 we accept the constant
  // form only; an automation object falls through to the default.
  if (
    typeof v === "object" &&
    v !== null &&
    "default" in (v as Record<string, unknown>) &&
    typeof (v as { default: unknown }).default === "number"
  ) {
    return (v as { default: number }).default;
  }
  return fallback;
}

/** Look up a string parameter (e.g. a waveform type). */
export function strParam<T extends string>(
  params: Record<string, unknown> | undefined,
  name: string,
  fallback: T,
): T {
  const v = params?.[name];
  if (typeof v === "string") return v as T;
  return fallback;
}

/** Look up a boolean parameter. */
export function boolParam(
  params: Record<string, unknown> | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const v = params?.[name];
  if (typeof v === "boolean") return v;
  return fallback;
}
