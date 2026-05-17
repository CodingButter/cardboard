import type { OpDescriptor } from "../types";
import { glslFloat, glslVec2, readNumber, readVec } from "../paramHelpers";

/**
 * 2D simplex noise — IMAGE_LAB.md §4.1 `simplex-noise`.
 *
 * Uses the canonical Ashima/McEwan simplex implementation (no `sin`)
 * for deterministic output across drivers. Params mirror `perlin`
 * for orthogonality.
 *
 * Params:
 *   scale: float — UV-space scale factor (default 4).
 *   amplitude: float — final scale (default 1).
 *   uvOffset: vec2 — phase offset (default [0, 0]).
 *   seed: number — uv offset based on seed (default = recipe.seed).
 */
export const simplexOp: OpDescriptor = {
  id: "simplex",
  inputs: [{ name: "input", kind: "rgba" }],
  output: "greyscale",
  emit(ctx) {
    const scale = readNumber(ctx.params, "scale", 4);
    const amplitude = readNumber(ctx.params, "amplitude", 1);
    const [ox, oy] = readVec(ctx.params, "uvOffset", [0, 0]);
    const seed = readNumber(ctx.params, "seed", ctx.recipeSeed);
    return `
      vec2 p = uv * ${glslFloat(scale)} + ${glslVec2(ox!, oy!)} + vec2(${glslFloat(seed * 0.181)}, ${glslFloat(seed * 0.293)});
      float v = simplex2D(p);
      v = saturate1(v * ${glslFloat(amplitude)});
      return vec4(v, v, v, 1.0);
    `;
  },
};
