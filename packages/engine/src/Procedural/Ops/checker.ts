import type { OpDescriptor } from "../types";
import { glslFloat, glslVec2, glslVec4, readVec } from "../paramHelpers";

/**
 * Two-color checkerboard — IMAGE_LAB.md §4.1 `checker`.
 *
 * Params:
 *   cellSize: vec2 — cell dimensions in UV-pixels (default [16, 16]).
 *   color1: vec4 — primary color (default white).
 *   color2: vec4 — alternating color (default black).
 */
export const checkerOp: OpDescriptor = {
  id: "checker",
  inputs: [],
  output: "rgba",
  emit(ctx) {
    const [sx, sy] = readVec(ctx.params, "cellSize", [16, 16]);
    const [r1, g1, b1, a1] = readVec(ctx.params, "color1", [1, 1, 1, 1]);
    const [r2, g2, b2, a2] = readVec(ctx.params, "color2", [0, 0, 0, 1]);
    return `
      vec2 cell = ${glslVec2(sx!, sy!)};
      vec2 cellIdx = floor(uv * u_resolution / cell);
      float parity = mod(cellIdx.x + cellIdx.y, 2.0);
      return mix(${glslVec4(r1!, g1!, b1!, a1!)}, ${glslVec4(r2!, g2!, b2!, a2!)}, parity);
    `;
  },
};
