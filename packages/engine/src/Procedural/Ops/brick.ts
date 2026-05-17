import type { OpDescriptor } from "../types";
import { glslFloat, glslVec2, glslVec4, readNumber, readVec } from "../paramHelpers";

/**
 * Brick / running-bond tiling — IMAGE_LAB.md §4.1 `brick-pattern`.
 *
 * Mixes a `base` input (the brick color) with `mortarColor` along
 * the mortar gaps. Bricks on odd rows shift horizontally by
 * `cellSize.x * 0.5` for running bond. Output alpha is always 1.
 *
 * Inputs:
 *   base — RGBA color used inside each brick (e.g. from noise).
 *
 * Params:
 *   size: vec2 — brick dimensions in UV-pixels (default [16, 8]).
 *   mortarWidth: float — mortar gap thickness (default 1.0).
 *   mortarColor: vec4 — color of the mortar (default dark grey).
 *   offsetEveryOtherRow: float — running-bond offset fraction (default 0.5).
 */
export const brickOp: OpDescriptor = {
  id: "brick",
  inputs: [{ name: "base", kind: "rgba" }],
  output: "rgba",
  emit(ctx) {
    const [sx, sy] = readVec(ctx.params, "size", [16, 8]);
    const mortarWidth = readNumber(ctx.params, "mortarWidth", 1);
    const [mr, mg, mb, ma] = readVec(ctx.params, "mortarColor", [0.15, 0.12, 0.10, 1]);
    const offset = readNumber(ctx.params, "offsetEveryOtherRow", 0.5);
    return `
      vec2 cell = ${glslVec2(sx!, sy!)};
      vec2 px = uv * u_resolution;
      float row = floor(px.y / cell.y);
      float rowOffset = mod(row, 2.0) * ${glslFloat(offset)} * cell.x;
      vec2 local = vec2(mod(px.x + rowOffset, cell.x), mod(px.y, cell.y));
      float mortarX = step(local.x, ${glslFloat(mortarWidth)})
                    + step(cell.x - ${glslFloat(mortarWidth)}, local.x);
      float mortarY = step(local.y, ${glslFloat(mortarWidth)})
                    + step(cell.y - ${glslFloat(mortarWidth)}, local.y);
      float mortarMask = saturate1(mortarX + mortarY);
      vec4 brickColor = ${ctx.inputs.base ?? "vec4(0.6, 0.3, 0.2, 1.0)"};
      vec4 mortarColor = ${glslVec4(mr!, mg!, mb!, ma!)};
      return mix(brickColor, mortarColor, mortarMask);
    `;
  },
};
