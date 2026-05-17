/**
 * Static + loop renderer — runs the compiled graph through an
 * `OfflineAudioContext` and returns the rendered `AudioBuffer`.
 *
 * SOUND_LAB.md §6.3 path A. The result is then cached in IDB via
 * `IdbCache.ts` so subsequent loads hit the cache (warm) instead of
 * re-rendering (cold).
 *
 * For `mode: "loop"` the rendered buffer is the loop body — callers
 * play it with `BufferSource.loop = true`. An optional `loopRamp`
 * field on the recipe fades the first + last `loopRamp` seconds to
 * mask hard discontinuities (§3.4). SL2 implements the ramp; the
 * end-of-buffer discontinuity warning (§6.3) lands in SL3.
 */

import type { CachedBakeRecord, SoundRecipeJson } from "./types";
import { compileRecipe } from "./Compiler";
import { recipeContentHash } from "./Hash";
import { loadCachedBake, storeCachedBake } from "./IdbCache";

/**
 * Construct an `AudioBuffer` from a cached PCM record. Uses the live
 * context's `createBuffer` so the buffer can be used directly with
 * `AudioBufferSourceNode.buffer = …` in the live graph.
 */
export function audioBufferFromCachedRecord(
  liveCtx: BaseAudioContext,
  record: CachedBakeRecord,
): AudioBuffer {
  const buf = liveCtx.createBuffer(
    record.channels.length,
    record.length,
    record.sampleRate,
  );
  for (let ch = 0; ch < record.channels.length; ch++) {
    // Defensive copy via getChannelData so we don't run into TS's
    // strict Float32Array<ArrayBuffer> vs ArrayBufferLike mismatch
    // when the cached record's PCM is backed by an arbitrary buffer.
    const src = record.channels[ch]!;
    const dst = buf.getChannelData(ch);
    dst.set(src);
  }
  return buf;
}

/** Extract a serialisable PCM record from a freshly-rendered AudioBuffer. */
function recordFromAudioBuffer(buf: AudioBuffer, hash: string): CachedBakeRecord {
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    // Pull a defensive copy so the IDB record outlives buffer disposal.
    const data = new Float32Array(buf.length);
    buf.copyFromChannel(data, ch);
    channels.push(data);
  }
  return {
    hash,
    channels,
    sampleRate: buf.sampleRate,
    length: buf.length,
    writtenAt: Date.now(),
  };
}

/** In-place fade-in / fade-out of the first + last `rampSeconds` of `buf`. */
function applyLoopRamp(buf: AudioBuffer, rampSeconds: number): void {
  if (rampSeconds <= 0) return;
  const sr = buf.sampleRate;
  const rampFrames = Math.min(Math.floor(rampSeconds * sr), Math.floor(buf.length / 2));
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < rampFrames; i++) {
      const g = i / rampFrames;
      data[i] = (data[i] ?? 0) * g;
      data[buf.length - 1 - i] = (data[buf.length - 1 - i] ?? 0) * g;
    }
  }
}

/**
 * Render a static/loop recipe to an AudioBuffer. Pipeline:
 *
 *   1. Compute content hash → IDB lookup.
 *   2. Cache hit → rebuild buffer against `liveCtx` and return.
 *   3. Cache miss → instantiate `OfflineAudioContext`, compile the
 *      recipe, render, optionally apply loop ramp, write to IDB,
 *      rebuild against `liveCtx`.
 *
 * `liveCtx` is the AudioContext the runtime will play the buffer
 * through. The render itself happens against an OfflineAudioContext;
 * the returned buffer is then created on `liveCtx`'s sample rate so
 * `AudioBufferSourceNode.buffer = …` works without resampling.
 */
export async function renderRecipeOffline(
  recipe: SoundRecipeJson,
  liveCtx: BaseAudioContext,
): Promise<AudioBuffer> {
  const hash = await recipeContentHash(recipe);

  const cached = await loadCachedBake(hash);
  if (cached) {
    return audioBufferFromCachedRecord(liveCtx, cached);
  }

  const channels = (recipe.channels ?? 2) === 1 ? 1 : 2;
  const sampleRate = recipe.sampleRate ?? liveCtx.sampleRate ?? 48000;
  const duration = Math.max(0.01, recipe.duration ?? 1);
  const frames = Math.max(1, Math.floor(sampleRate * duration));

  const OfflineCtor =
    typeof window !== "undefined"
      ? (window as { OfflineAudioContext?: typeof OfflineAudioContext })
          .OfflineAudioContext ??
        (window as { webkitOfflineAudioContext?: typeof OfflineAudioContext })
          .webkitOfflineAudioContext
      : (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext })
          .OfflineAudioContext;
  if (!OfflineCtor) {
    throw new Error("[procedural-audio] OfflineAudioContext not available");
  }
  const offline = new OfflineCtor(channels, frames, sampleRate);

  const compiled = compileRecipe(recipe, offline, null);
  compiled.output.connect(offline.destination);

  const rendered = await offline.startRendering();
  compiled.dispose();

  if (recipe.mode === "loop") {
    applyLoopRamp(rendered, recipe.loopRamp ?? 0);
  }

  const record = recordFromAudioBuffer(rendered, hash);
  // Fire-and-forget — bakes go to IDB best-effort. A storage failure
  // doesn't block playback.
  void storeCachedBake(record);

  return audioBufferFromCachedRecord(liveCtx, record);
}
