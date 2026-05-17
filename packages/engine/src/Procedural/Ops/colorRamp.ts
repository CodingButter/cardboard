import type { OpDescriptor } from "../types";
import { glslFloat, glslVec4 } from "../paramHelpers";

/**
 * Color ramp / gradient lookup — IMAGE_LAB.md §4.3 `color-ramp`.
 *
 * Maps the input's luminance through an N-stop color table. Useful
 * for tinting noise (a perlin field becomes a colorful image), palette
 * swaps, hot-metal LUTs, etc.
 *
 * Inputs:
 *   input — the source whose luminance drives the lookup.
 *
 * Params:
 *   stops: Array<{t: number, color: [r, g, b, a?]}> — sorted by `t` ∈
 *     [0, 1]. Defaults to a two-stop black→white ramp.
 */
interface ColorStop {
  t: number;
  color: [number, number, number, number];
}

function parseStops(params: Record<string, unknown> | undefined): ColorStop[] {
  const raw = (params?.stops ?? []) as unknown[];
  const stops: ColorStop[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const obj = entry as Record<string, unknown>;
      const t = typeof obj.t === "number" ? obj.t : NaN;
      const c = obj.color;
      if (!Number.isFinite(t) || !Array.isArray(c)) continue;
      const [r, g, b, a] = c as unknown[];
      stops.push({
        t,
        color: [
          typeof r === "number" ? r : 0,
          typeof g === "number" ? g : 0,
          typeof b === "number" ? b : 0,
          typeof a === "number" ? a : 1,
        ],
      });
    }
  }
  if (stops.length === 0) {
    stops.push({ t: 0, color: [0, 0, 0, 1] }, { t: 1, color: [1, 1, 1, 1] });
  } else if (stops.length === 1) {
    stops.push({ t: 1, color: stops[0]!.color });
  }
  stops.sort((a, b) => a.t - b.t);
  return stops;
}

export const colorRampOp: OpDescriptor = {
  id: "colorRamp",
  inputs: [{ name: "input", kind: "rgba" }],
  output: "rgba",
  emit(ctx) {
    const stops = parseStops(ctx.params);
    const input = ctx.inputs.input ?? "vec4(0.0)";

    // Build an unrolled piecewise-linear lookup. For a stop sequence
    // (s0, s1, ..., sN-1), emit a chain of mix() calls that lerp
    // each adjacent pair by smoothstep(s_i.t, s_{i+1}.t, t). The
    // unrolling keeps the program one fragment pass with no loop
    // branching — better for cross-driver determinism.
    let body = `vec4 ramp = ${glslVec4(...stops[0]!.color)};`;
    for (let i = 0; i < stops.length - 1; i++) {
      const a = stops[i]!;
      const b = stops[i + 1]!;
      const denom = Math.max(b.t - a.t, 1e-6);
      body += `
        ramp = mix(ramp, ${glslVec4(...b.color)},
                   saturate1((t - ${glslFloat(a.t)}) / ${glslFloat(denom)}));`;
    }
    return `
      float t = luminance(${input}.rgb);
      ${body}
      return ramp;
    `;
  },
};
