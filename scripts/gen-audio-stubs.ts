#!/usr/bin/env bun
/**
 * Au1 of `docs/plans/AUDIO.md` — generate sample sounds for the
 * default pack.
 *
 * The audio system can't ship without something to play, but bundling
 * a real `.ogg` would mean either (a) licensing audio from a stock
 * library — fine but adds process — or (b) shipping a binary in git
 * with no provenance. Instead we synthesize tiny WAV files at build
 * time. WAV decodes natively in Web Audio and the encoder is ~30
 * lines of JS, so there's no toolchain dependency.
 *
 *  - `gunshot.wav` — 120 ms 200 Hz square wave with a fast exponential
 *    decay. Sounds like a percussive "pop" — fine for a placeholder.
 *  - `pickup.wav`  — 180 ms 800 Hz sine wave with a slow exponential
 *    decay. Sounds like a quick chime.
 *
 * Modders authoring their own asset packs should replace these with
 * real samples; the manifest schema (`SoundDef.file`) accepts any
 * format the browser decodes (`.ogg`, `.mp3`, `.wav`, `.opus`).
 *
 * Run with: `bun run scripts/gen-audio-stubs.ts`.
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const SAMPLE_RATE = 22050;
const root = new URL("../", import.meta.url).pathname;
const outDir = join(root, "packages", "default-pack", "audio", "sfx");

/**
 * Encode a mono Float32 sample array as a 16-bit PCM .wav file.
 * The header layout is straight RIFF/WAVE format — see
 * http://soundfile.sapp.org/doc/WaveFormat/ for the field-by-field
 * walkthrough.
 */
function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2; // 16-bit mono
  const header = 44;
  const buf = new ArrayBuffer(header + dataBytes);
  const view = new DataView(buf);

  // "RIFF" chunk descriptor
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  // "fmt " sub-chunk
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);         // PCM header size
  view.setUint16(20, 1, true);          // PCM format
  view.setUint16(22, 1, true);          // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (1ch × 16bit)
  view.setUint16(32, 2, true);          // block align
  view.setUint16(34, 16, true);         // bits per sample
  // "data" sub-chunk
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  // Samples (clipped to int16 range)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(header + i * 2, (s * 0x7fff) | 0, true);
  }
  return new Uint8Array(buf);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * 120 ms 200 Hz square wave with exponential amplitude decay
 * (tau ≈ 30 ms). Percussive — reads as a flat "pop" without
 * dominating the mix when stacked.
 */
function synthGunshot(): Float32Array {
  const lengthSec = 0.12;
  const N = Math.floor(SAMPLE_RATE * lengthSec);
  const samples = new Float32Array(N);
  const freq = 200;
  for (let i = 0; i < N; i++) {
    const t = i / SAMPLE_RATE;
    const phase = (t * freq) % 1;
    const square = phase < 0.5 ? 1 : -1;
    const env = Math.exp(-t / 0.03);
    samples[i] = square * env * 0.7;
  }
  return samples;
}

/**
 * 180 ms 800 Hz sine with a slower exponential decay (tau ≈ 80 ms).
 * Reads as a soft chime — the kind of "got it" cue inventory
 * pickups expect.
 */
function synthPickup(): Float32Array {
  const lengthSec = 0.18;
  const N = Math.floor(SAMPLE_RATE * lengthSec);
  const samples = new Float32Array(N);
  const freq = 800;
  for (let i = 0; i < N; i++) {
    const t = i / SAMPLE_RATE;
    const sine = Math.sin(2 * Math.PI * freq * t);
    const env = Math.exp(-t / 0.08);
    samples[i] = sine * env * 0.6;
  }
  return samples;
}

await mkdir(outDir, { recursive: true });

const stubs: Array<[string, Float32Array]> = [
  ["gunshot.wav", synthGunshot()],
  ["pickup.wav", synthPickup()],
];

for (const [name, samples] of stubs) {
  const bytes = encodeWav(samples, SAMPLE_RATE);
  const target = join(outDir, name);
  await Bun.write(target, bytes);
  console.log(`  wrote ${target}  (${bytes.byteLength} bytes, ${(samples.length / SAMPLE_RATE * 1000).toFixed(0)} ms)`);
}

console.log(`\nDone. Re-run with \`bun run scripts/gen-audio-stubs.ts\`.`);
