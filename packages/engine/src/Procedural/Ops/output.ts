import type { OpDescriptor } from "../types";

/**
 * Terminal sink — IMAGE_LAB.md §4.6 `output`.
 *
 * Each recipe must contain exactly one `output` node. The compiler
 * locates it by scanning for `op === "output"` and walks the graph
 * upward from there. The op chunk simply forwards its `input` to
 * `gl_FragColor` (the compiler wires this through `main()`).
 *
 * Inputs:
 *   input — the texture to finalize.
 */
export const outputOp: OpDescriptor = {
  id: "output",
  inputs: [{ name: "input", kind: "rgba", required: true }],
  output: "rgba",
  emit(ctx) {
    const input = ctx.inputs.input ?? "vec4(0.0, 0.0, 0.0, 1.0)";
    return `return ${input};`;
  },
};
