/**
 * Recursive merge of `override` over `base`. Arrays and primitives are
 * replaced wholesale; plain objects are merged key-by-key.
 *
 * Used by the asset-pack pipeline: the baseline `GameConfig` from
 * `game.config.json` is the `base`, and a pack's own `config.json`
 * (whatever subset of fields the modder cares to override) is the
 * `override`. The merge produces a complete `GameConfig` ready for
 * runtime.
 *
 * Type-erased internally because the surface is "shape-of-base with
 * optional partials" and TS gives up gracefully on deep `Partial`s.
 * Callers should cast the result back to the concrete type.
 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  if (!isPlainObject(base)) return override as T;

  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(override as Record<string, unknown>)) {
    const baseVal = (base as Record<string, unknown>)[key];
    const overrideVal = (override as Record<string, unknown>)[key];
    if (isPlainObject(baseVal) && isPlainObject(overrideVal)) {
      result[key] = deepMerge(baseVal, overrideVal);
    } else {
      result[key] = overrideVal;
    }
  }
  return result as T;
}

/** True for `{ ... }` literals; false for arrays, null, primitives, instances. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
