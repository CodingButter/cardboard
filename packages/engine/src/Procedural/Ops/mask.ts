import type { OpDescriptor } from "../types";
import { readBool } from "../paramHelpers";

/**
 * Mask multiplier — IMAGE_LAB.md §4.3 `mask`.
 *
 * Multiplies the primary input's alpha by the mask's luminance.
 * Useful for cutting out shapes from a noise field, clipping
 * gradient layers to bricks, etc.
 *
 * Inputs:
 *   input — the layer to mask.
 *   mask — the alpha source (uses luminance).
 *
 * Params:
 *   invert: bool — flip the mask (default false).
 */
export const maskOp: OpDescriptor = {
  id: "mask",
  inputs: [
    { name: "input", kind: "rgba" },
    { name: "mask", kind: "rgba" },
  ],
  output: "rgba",
  emit(ctx) {
    const invert = readBool(ctx.params, "invert", false);
    const input = ctx.inputs.input ?? "vec4(0.0)";
    const mask = ctx.inputs.mask ?? "vec4(1.0)";
    const maskExpr = invert ? `(1.0 - luminance(${mask}.rgb))` : `luminance(${mask}.rgb)`;
    return `
      vec4 src = ${input};
      float m = ${maskExpr};
      return vec4(src.rgb, src.a * m);
    `;
  },
};
