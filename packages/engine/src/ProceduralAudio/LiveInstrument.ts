/**
 * Live instrument-mode voice pool. SOUND_LAB.md §3.5 + §6.3.
 *
 * Each voice instantiates a fresh sub-graph of Web Audio nodes via
 * `compileRecipe` against the live AudioContext. The voice connects
 * to the engine's group gain node (so it routes through master /
 * sfx / etc.), schedules its envelopes at `ctx.currentTime`, and
 * disconnects when the voice's gate + release tail finishes.
 *
 * Polyphony cap: from SOUND_LAB.md §12 Q6 RESOLVED — 16 voices
 * default, oldest-first stealing. The `polyphony` field on the
 * recipe overrides the default.
 *
 * Lifecycle:
 *   - `trigger(opts)` allocates a voice. If the cap is hit, the
 *     oldest voice is stopped + disposed first.
 *   - Voice nodes are scheduled `start` + `stop` against
 *     `ctx.currentTime`; the GC tail (`stop + release + 0.5s`)
 *     lets the envelope close gracefully.
 *   - `stopAll()` drops every active voice.
 */

import type { SoundRecipeJson, PlayInstrumentOpts } from "./types";
import type { VoiceContext } from "./Ops";
import { compileRecipe, type CompiledRecipe } from "./Compiler";

interface ActiveVoice {
  compiled: CompiledRecipe;
  startedAt: number;
  /** Wall-clock millis at which this voice's audio should be done. */
  endAt: number;
  /** Cancel the scheduled GC if the voice is stolen / stopped early. */
  gcTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * One pool per instrument-mode recipe. Lives for the pack's lifetime;
 * `dispose()` tears down outstanding voices on pack swap.
 */
export class InstrumentVoicePool {
  private readonly recipe: SoundRecipeJson;
  private readonly cap: number;
  private readonly voices: ActiveVoice[] = [];

  constructor(recipe: SoundRecipeJson) {
    this.recipe = recipe;
    this.cap = Math.max(1, recipe.polyphony ?? 16);
  }

  /**
   * Allocate a voice. Connects the compiled sub-graph to `groupGain`
   * and schedules its envelopes against `ctx.currentTime`. Returns the
   * compiled voice so the caller can stop it via `stopVoice` or read
   * its compiled output for downstream effects.
   */
  trigger(ctx: AudioContext, groupGain: AudioNode, opts: PlayInstrumentOpts): CompiledRecipe {
    // Steal the oldest voice if we're at the cap.
    if (this.voices.length >= this.cap) {
      const oldest = this.voices.shift()!;
      this.stopVoiceInternal(oldest, /* gentleRelease */ false);
    }

    const now = ctx.currentTime;
    const gateSeconds =
      opts.gateMs !== undefined ? Math.max(0, opts.gateMs / 1000) : Infinity;

    const voiceCtx: VoiceContext = {
      opts,
      ctx,
      startTime: now,
      gateSeconds,
    };

    const compiled = compileRecipe(this.recipe, ctx, voiceCtx);

    // Voice-level velocity scaling — insert a GainNode between the
    // recipe's terminal output and the group bus so each voice can
    // ride opts.velocity without retuning the recipe's own gain.
    const velocity = Math.max(0, Math.min(2, opts.velocity ?? 1));
    const volume = Math.max(0, opts.volume ?? 1);
    const voiceGain = ctx.createGain();
    voiceGain.gain.value = velocity * volume;
    compiled.output.connect(voiceGain);
    voiceGain.connect(groupGain);

    // Schedule a hard cleanup after gate + a generous release tail.
    // The exact release length is whatever envelope ops scheduled
    // internally — we add 1s of slack so the voice's tail completes
    // before disconnect.
    const cleanupMs = Number.isFinite(gateSeconds)
      ? (gateSeconds + 1.0) * 1000
      : 60 * 1000; // 60s safety for "until stop()" voices
    const endAt = Date.now() + cleanupMs;
    const voice: ActiveVoice = {
      compiled,
      startedAt: Date.now(),
      endAt,
      gcTimer: setTimeout(() => {
        this.removeVoice(voice);
      }, cleanupMs),
    };
    // When the voice GCs we also disconnect the voice gain.
    const originalDispose = compiled.dispose;
    (compiled as { dispose: () => void }).dispose = () => {
      try { voiceGain.disconnect(); } catch { /* already disconnected */ }
      originalDispose.call(compiled);
    };

    this.voices.push(voice);
    return compiled;
  }

  /** Stop + dispose every voice. Called on pack swap. */
  stopAll(): void {
    for (const voice of [...this.voices]) {
      this.stopVoiceInternal(voice, /* gentleRelease */ false);
    }
    this.voices.length = 0;
  }

  private removeVoice(voice: ActiveVoice): void {
    const idx = this.voices.indexOf(voice);
    if (idx >= 0) this.voices.splice(idx, 1);
    this.stopVoiceInternal(voice, /* gentleRelease */ true);
  }

  private stopVoiceInternal(voice: ActiveVoice, _gentleRelease: boolean): void {
    if (voice.gcTimer) {
      clearTimeout(voice.gcTimer);
      voice.gcTimer = null;
    }
    try {
      voice.compiled.dispose();
    } catch (err) {
      console.warn("[procedural-audio] voice dispose failed:", err);
    }
  }
}
