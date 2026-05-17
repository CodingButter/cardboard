import type { OpDescriptor } from "../types";
import { glslFloat, glslVec2, glslVec4, readNumber, readVec } from "../paramHelpers";

/**
 * Antialiased rectangle SDF — IMAGE_LAB.md §4.1 `rect`.
 *
 * Params:
 *   center: vec2 — UV center (default [0.5, 0.5]).
 *   size: vec2 — full width / height in UV (default [0.6, 0.4]).
 *   feather: float — antialias width (default 0.005).
 *   color: vec4 — fill color (default white).
 *   background: vec4 — outside color (default transparent).
 */
export const rectOp: OpDescriptor = {
  id: "rect",
  inputs: [],
  output: "rgba",
  emit(ctx) {
    const [cx, cy] = readVec(ctx.params, "center", [0.5, 0.5]);
    const [sx, sy] = readVec(ctx.params, "size", [0.6, 0.4]);
    const feather = readNumber(ctx.params, "feather", 0.005);
    const [r, g, b, a] = readVec(ctx.params, "color", [1, 1, 1, 1]);
    const [br, bg, bb, ba] = readVec(ctx.params, "background", [0, 0, 0, 0]);
    return `
      float d = sdfRect(uv, ${glslVec2(cx!, cy!)}, ${glslVec2(sx! * 0.5, sy! * 0.5)});
      float inside = 1.0 - smoothstep(-${glslFloat(feather)}, ${glslFloat(feather)}, d);
      return mix(${glslVec4(br!, bg!, bb!, ba!)}, ${glslVec4(r!, g!, b!, a!)}, inside);
    `;
  },
};
