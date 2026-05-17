import type { OpDescriptor } from "../types";
import { glslFloat, glslVec2, glslVec4, readNumber, readVec } from "../paramHelpers";

/**
 * Antialiased circle SDF — IMAGE_LAB.md §4.1 `circle`.
 *
 * Params:
 *   center: vec2 — UV center (default [0.5, 0.5]).
 *   radius: float — UV radius (default 0.3).
 *   feather: float — antialias width (default 0.005).
 *   color: vec4 — fill color (default white).
 *   background: vec4 — outside color (default transparent).
 */
export const circleOp: OpDescriptor = {
  id: "circle",
  inputs: [],
  output: "rgba",
  emit(ctx) {
    const [cx, cy] = readVec(ctx.params, "center", [0.5, 0.5]);
    const radius = readNumber(ctx.params, "radius", 0.3);
    const feather = readNumber(ctx.params, "feather", 0.005);
    const [r, g, b, a] = readVec(ctx.params, "color", [1, 1, 1, 1]);
    const [br, bg, bb, ba] = readVec(ctx.params, "background", [0, 0, 0, 0]);
    return `
      float d = sdfCircle(uv, ${glslVec2(cx!, cy!)}, ${glslFloat(radius)});
      float inside = 1.0 - smoothstep(-${glslFloat(feather)}, ${glslFloat(feather)}, d);
      return mix(${glslVec4(br!, bg!, bb!, ba!)}, ${glslVec4(r!, g!, b!, a!)}, inside);
    `;
  },
};
