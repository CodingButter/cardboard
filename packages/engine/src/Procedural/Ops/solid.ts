import type { OpDescriptor } from "../types";
import { glslVec4, readVec } from "../paramHelpers";

/**
 * Solid color generator — IMAGE_LAB.md §4.1 `solid`.
 *
 * Params:
 *   color: [r, g, b] or [r, g, b, a] — channels in [0, 1].
 */
export const solidOp: OpDescriptor = {
  id: "solid",
  inputs: [],
  output: "rgba",
  emit(ctx) {
    const [r, g, b, a] = readVec(ctx.params, "color", [1, 1, 1, 1]);
    return `return ${glslVec4(r!, g!, b!, a!)};`;
  },
};
