import type { OpDescriptor } from "../types";
import { glslFloat, readEnum, readNumber } from "../paramHelpers";

/**
 * Worley / Voronoi cellular noise — IMAGE_LAB.md §4.1 `worley`.
 *
 * Output channels:
 *   r = F1 distance (closest cell feature point)
 *   g = F2 distance (second-closest)
 *   b = F2 - F1 (cell edge mask — bright at cell boundaries)
 *   a = 1
 *
 * Params:
 *   scale: float — cells per UV unit (default 8).
 *   metric: "f1" | "f2" | "edge" — output channel to broadcast to rgb (default "f1").
 *   amplitude: float — multiplier (default 1).
 */
export const worleyOp: OpDescriptor = {
  id: "worley",
  inputs: [{ name: "input", kind: "rgba" }],
  output: "rgba",
  emit(ctx) {
    const scale = readNumber(ctx.params, "scale", 8);
    const amplitude = readNumber(ctx.params, "amplitude", 1);
    const metric = readEnum(ctx.params, "metric", ["f1", "f2", "edge"] as const, "f1");
    const channel =
      metric === "f1" ? "f.x"
      : metric === "f2" ? "f.y"
      : "(f.y - f.x)";
    return `
      vec2 f = worley2D(uv * ${glslFloat(scale)});
      float v = saturate1(${channel} * ${glslFloat(amplitude)});
      return vec4(v, v, v, 1.0);
    `;
  },
};
