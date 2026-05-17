import type { OpDescriptor } from "../types";
import { glslFloat, readEnum, readNumber } from "../paramHelpers";

/**
 * Photoshop-style blend compositor — IMAGE_LAB.md §4.3 `blend`.
 *
 * Inputs:
 *   bottom — base layer (RGBA).
 *   top — overlay layer (RGBA).
 *
 * The blend mode formula consumes `top.rgb` + `bottom.rgb`; the
 * resulting `rgb` is alpha-blended back using `top.a * opacity`.
 *
 * Params:
 *   mode: "normal" | "multiply" | "screen" | "overlay" | "add" — blend formula (default "normal").
 *   opacity: float — top's contribution multiplier (default 1.0).
 *
 * Single-input convenience: this op also accepts `"input"` as an
 * alias for `"top"` (with `bottom` defaulting to opaque black). The
 * user-prompt examples wire it both ways; the compiler resolves
 * unspecified inputs to a black-vec4 chunk.
 */
export const blendOp: OpDescriptor = {
  id: "blend",
  inputs: [
    { name: "bottom", kind: "rgba" },
    { name: "top", kind: "rgba" },
    { name: "input", kind: "rgba" },
  ],
  output: "rgba",
  emit(ctx) {
    const mode = readEnum(
      ctx.params,
      "mode",
      ["normal", "multiply", "screen", "overlay", "add"] as const,
      "normal",
    );
    const opacity = readNumber(ctx.params, "opacity", 1);
    // `input` aliases `top` when `top` isn't wired (user-prompt
    // examples use `inputs.input` to chain a perlin onto a brick).
    const top = ctx.inputs.top ?? ctx.inputs.input ?? "vec4(0.0)";
    const bottom = ctx.inputs.bottom ?? "vec4(0.0, 0.0, 0.0, 1.0)";
    let mix: string;
    switch (mode) {
      case "multiply":
        mix = `B.rgb * T.rgb`;
        break;
      case "screen":
        mix = `vec3(1.0) - (vec3(1.0) - B.rgb) * (vec3(1.0) - T.rgb)`;
        break;
      case "overlay":
        mix = `mix(2.0 * B.rgb * T.rgb, vec3(1.0) - 2.0 * (vec3(1.0) - B.rgb) * (vec3(1.0) - T.rgb), step(0.5, B.rgb))`;
        break;
      case "add":
        mix = `saturate3(B.rgb + T.rgb)`;
        break;
      case "normal":
      default:
        mix = `T.rgb`;
        break;
    }
    return `
      vec4 B = ${bottom};
      vec4 T = ${top};
      vec3 blended = ${mix};
      float alpha = T.a * ${glslFloat(opacity)};
      return vec4(mix(B.rgb, blended, alpha), max(B.a, alpha));
    `;
  },
};
