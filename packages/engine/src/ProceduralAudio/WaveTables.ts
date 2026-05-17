/**
 * Precomputed buffers for ops that need their own source data —
 * primarily `noise`. Web Audio's `OscillatorNode` ships with native
 * sine/sawtooth/square/triangle waveforms, so the `oscillator` op
 * doesn't need a wavetable here. SL2+ ops (`wavetable`, sampled
 * impulse responses, etc.) can grow this module.
 *
 * Noise buffers are generated lazily, keyed by `(type, seed, durationSeconds)`
 * so repeated `noise` ops in the same recipe share a single buffer.
 * Seed-determinism is enforced: same seed → byte-identical buffer.
 */

import { SeededRng } from "./Rng";

export type NoiseType = "white" | "pink" | "brown";

/** Fill a Float32Array with white noise from the given RNG. */
function fillWhite(rng: SeededRng, out: Float32Array): void {
  for (let i = 0; i < out.length; i++) out[i] = rng.nextBipolar();
}

/**
 * Paul Kellet's pink-noise filter. Spectrally flat in log space — the
 * canonical "warm" noise. Cheap (7 multiplies/add per sample).
 */
function fillPink(rng: SeededRng, out: Float32Array): void {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const white = rng.nextBipolar();
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

/** Brown (red) noise — integrated white. Lots of low end. */
function fillBrown(rng: SeededRng, out: Float32Array): void {
  let last = 0;
  for (let i = 0; i < out.length; i++) {
    const white = rng.nextBipolar();
    last = (last + 0.02 * white) * 0.999;
    // Clip to keep it bounded; brown integration drifts without it.
    if (last > 1) last = 1;
    else if (last < -1) last = -1;
    out[i] = last * 3.5;
  }
}

/**
 * Build a noise buffer of `durationSeconds` × `sampleRate` frames.
 * Mono — Web Audio's BufferSource handles mono → stereo upmix when
 * connected to a stereo destination.
 *
 * The buffer is deterministically seeded so editor preview and pack
 * runtime produce sample-identical output (SOUND_LAB.md §3.6).
 */
export function buildNoiseBuffer(
  ctx: BaseAudioContext,
  type: NoiseType,
  seed: number,
  durationSeconds: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const frames = Math.max(1, Math.floor(durationSeconds * sr));
  const buf = ctx.createBuffer(1, frames, sr);
  const data = buf.getChannelData(0);
  const rng = new SeededRng(seed);
  if (type === "white") fillWhite(rng, data);
  else if (type === "pink") fillPink(rng, data);
  else fillBrown(rng, data);
  return buf;
}

/**
 * Build a simple synthetic convolution impulse for the `reverb` op
 * MVP. Exponentially-decaying noise — cheap, audibly reverby, and
 * fully procedural so the engine doesn't have to ship pre-recorded
 * IR `.wav` files.
 *
 * `decay` is the seconds-to-(near)-silence; `preDelay` is silence
 * inserted at the head before the diffuse tail.
 */
export function buildReverbImpulse(
  ctx: BaseAudioContext,
  seed: number,
  durationSeconds: number,
  decay: number,
  preDelay: number,
): AudioBuffer {
  const sr = ctx.sampleRate;
  const frames = Math.max(1, Math.floor(durationSeconds * sr));
  const buf = ctx.createBuffer(2, frames, sr);
  const preDelayFrames = Math.max(0, Math.floor(preDelay * sr));
  const rng = new SeededRng(seed);
  // Two independent channels for natural stereo spread; same RNG
  // stream means the seed maps to one canonical impulse regardless
  // of host channel count.
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < frames; i++) {
      if (i < preDelayFrames) {
        data[i] = 0;
        continue;
      }
      const t = (i - preDelayFrames) / sr;
      const env = Math.pow(1 - t / decay, 2);
      data[i] = rng.nextBipolar() * Math.max(0, env);
    }
  }
  return buf;
}
