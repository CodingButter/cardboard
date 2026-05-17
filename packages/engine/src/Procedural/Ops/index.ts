import type { OpDescriptor } from "../types";
import { solidOp } from "./solid";
import { perlinOp } from "./perlin";
import { simplexOp } from "./simplex";
import { worleyOp } from "./worley";
import { brickOp } from "./brick";
import { checkerOp } from "./checker";
import { gradientOp } from "./gradient";
import { circleOp } from "./circle";
import { rectOp } from "./rect";
import { blendOp } from "./blend";
import { maskOp } from "./mask";
import { colorRampOp } from "./colorRamp";
import { outputOp } from "./output";

/**
 * IL2 op registry — `OpDescriptor` keyed by stable `op` id.
 *
 * Aliases are listed against the canonical descriptor so recipes
 * authored against either the user-prompt names (`perlin`, `brick`)
 * or the IMAGE_LAB.md dotted-kebab names (`perlin-noise`,
 * `brick-pattern`) compile identically.
 */
export const OPS: Readonly<Record<string, OpDescriptor>> = Object.freeze({
  solid: solidOp,
  perlin: perlinOp,
  "perlin-noise": perlinOp,
  simplex: simplexOp,
  "simplex-noise": simplexOp,
  worley: worleyOp,
  voronoi: worleyOp,
  brick: brickOp,
  "brick-pattern": brickOp,
  checker: checkerOp,
  gradient: gradientOp,
  circle: circleOp,
  rect: rectOp,
  blend: blendOp,
  mask: maskOp,
  colorRamp: colorRampOp,
  "color-ramp": colorRampOp,
  output: outputOp,
});

export function resolveOp(opId: string): OpDescriptor | undefined {
  return OPS[opId];
}
