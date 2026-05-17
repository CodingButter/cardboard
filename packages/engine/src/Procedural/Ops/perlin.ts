import type { OpDescriptor } from "../types";
import { glslFloat, glslInt, glslVec2, readNumber, readVec } from "../paramHelpers";

/**
 * 2D Perlin noise — IMAGE_LAB.md §4.1 `perlin-noise`.
 *
 * The chunk computes a fractal-Brownian-motion sum of `octaves`
 * perlin layers via the integer-hash `perlin2D` helper. Output is
 * packed greyscale in `rgb` with alpha=1.
 *
 * Params:
 *   scale: float — UV-space scale factor (default 4).
 *   octaves: int [1, 8] — fBm layers (default 1).
 *   persistence: float — per-octave amplitude falloff (default 0.5).
 *   amplitude: float — final scale (default 1).
 *   uvOffset: vec2 — phase offset for animation (default [0, 0]).
 *   seed: number — additional uv offset based on seed (default 0).
 *
 * The input port (`"input"`) is accepted for chaining but ignored —
 * generators don't read upstream values. Kept on the descriptor so
 * editor wiring stays orthogonal.
 */
export const perlinOp: OpDescriptor = {
  id: "perlin",
  inputs: [{ name: "input", kind: "rgba" }],
  output: "greyscale",
  emit(ctx) {
    const scale = readNumber(ctx.params, "scale", 4);
    const octaves = Math.max(1, Math.min(8, Math.round(readNumber(ctx.params, "octaves", 1))));
    const persistence = readNumber(ctx.params, "persistence", 0.5);
    const amplitude = readNumber(ctx.params, "amplitude", 1);
    const [ox, oy] = readVec(ctx.params, "uvOffset", [0, 0]);
    const seed = readNumber(ctx.params, "seed", ctx.recipeSeed);
    return `
      vec2 p = uv * ${glslFloat(scale)} + ${glslVec2(ox!, oy!)} + vec2(${glslFloat(seed * 0.137)}, ${glslFloat(seed * 0.231)});
      float v = fbm2D(p, ${glslInt(octaves)}, ${glslFloat(persistence)});
      v = saturate1(v * ${glslFloat(amplitude)});
      return vec4(v, v, v, 1.0);
    `;
  },
};
