/**
 * Helpers for reading typed values out of an op's `params` blob.
 *
 * Each helper does best-effort coercion + supplies a default. Op
 * `emit()` functions call these inline to keep their GLSL code
 * generation terse. The compiler folds the resulting concrete values
 * into the shader as GLSL constants — there are no per-recipe param
 * uniforms in IL2.
 */

/** Format a JS number as a GLSL `float` literal that preserves precision. */
export function glslFloat(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  // Keep enough digits that a re-parse round-trips; appending ".0"
  // ensures integer values stay typed as float in GLSL.
  let s = n.toString();
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) s = `${s}.0`;
  return s;
}

/** Format a JS int as a GLSL `int` literal (or fall back to a default). */
export function glslInt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Math.trunc(n).toString();
}

/** Format a 2-vec as a GLSL `vec2` literal. */
export function glslVec2(x: number, y: number): string {
  return `vec2(${glslFloat(x)}, ${glslFloat(y)})`;
}

/** Format a 3-vec as a GLSL `vec3` literal. */
export function glslVec3(r: number, g: number, b: number): string {
  return `vec3(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)})`;
}

/** Format a 4-vec as a GLSL `vec4` literal. */
export function glslVec4(r: number, g: number, b: number, a: number): string {
  return `vec4(${glslFloat(r)}, ${glslFloat(g)}, ${glslFloat(b)}, ${glslFloat(a)})`;
}

/** Coerce a param to a JS number, falling back to a default. */
export function readNumber(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  if (!params) return fallback;
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** Coerce a param to a tuple of numbers (defaults override per-channel). */
export function readVec(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: readonly number[],
): number[] {
  const v = params?.[key];
  if (Array.isArray(v)) {
    return fallback.map((dflt, i) => {
      const cell = v[i];
      return typeof cell === "number" && Number.isFinite(cell) ? cell : dflt;
    });
  }
  return [...fallback];
}

/** Coerce a param to an enum value from a fixed set. */
export function readEnum<T extends string>(
  params: Record<string, unknown> | undefined,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const v = params?.[key];
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) {
    return v as T;
  }
  return fallback;
}

/** Coerce a param to a boolean. */
export function readBool(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const v = params?.[key];
  return typeof v === "boolean" ? v : fallback;
}
