import type { OpDescriptor } from "../types";
import { glslFloat, glslVec2, glslVec4, readEnum, readNumber, readVec } from "../paramHelpers";

/**
 * Linear / radial 2-stop gradient — IMAGE_LAB.md §4.1 `gradient`.
 *
 * Multi-stop gradients defer to IL6 — `colorRamp` covers the
 * intermediate need by mapping any input luminance through an N-stop
 * lookup. Here we cover the common case (sky, vignette base, floor
 * tint) cheaply.
 *
 * Params:
 *   kind: "linear" | "radial" — axis or distance lookup (default "linear").
 *   angle: float — degrees (linear only; default 0 = left→right).
 *   center: vec2 — UV center (radial; default [0.5, 0.5]).
 *   radius: float — falloff radius (radial; default 0.7).
 *   color1: vec4 — start color (default black).
 *   color2: vec4 — end color (default white).
 */
export const gradientOp: OpDescriptor = {
  id: "gradient",
  inputs: [],
  output: "rgba",
  emit(ctx) {
    const kind = readEnum(ctx.params, "kind", ["linear", "radial"] as const, "linear");
    const angleDeg = readNumber(ctx.params, "angle", 0);
    const [cx, cy] = readVec(ctx.params, "center", [0.5, 0.5]);
    const radius = readNumber(ctx.params, "radius", 0.7);
    const [r1, g1, b1, a1] = readVec(ctx.params, "color1", [0, 0, 0, 1]);
    const [r2, g2, b2, a2] = readVec(ctx.params, "color2", [1, 1, 1, 1]);
    const c1 = glslVec4(r1!, g1!, b1!, a1!);
    const c2 = glslVec4(r2!, g2!, b2!, a2!);
    if (kind === "radial") {
      return `
        float dist = length(uv - ${glslVec2(cx!, cy!)});
        float t = saturate1(dist / ${glslFloat(radius)});
        return mix(${c1}, ${c2}, t);
      `;
    }
    const angle = (angleDeg * Math.PI) / 180;
    return `
      vec2 dir = vec2(${glslFloat(Math.cos(angle))}, ${glslFloat(Math.sin(angle))});
      float t = saturate1(dot(uv - vec2(0.5), dir) + 0.5);
      return mix(${c1}, ${c2}, t);
    `;
  },
};
