import type { Entity } from "ECS";
import type { ModAPI } from "ModAPI";
import type { DeclarativePrefab, PackManifest } from "./types";
import { Vec2 } from "Libs/Vector";

/**
 * Register every declarative prefab on `manifest.prefabs` against the
 * supplied `ModAPI`. Companion to JS-based `api.registerPrefab(...)`
 * calls inside pack scripts — both live in the same `PrefabRegistry`
 * so collisions emit the usual "replacing" warning.
 *
 * MUST run AFTER `runPackScripts()` so pack-defined components are in
 * the registry before declarative shapes reference them. See
 * `docs/plans/EDITOR.md` §6.3 + `packages/engine/src/main.ts`.
 *
 * Each prefab's factory:
 *   1. Spawns a fresh entity via `api.world.spawn()`.
 *   2. For every (componentName, componentData) pair, resolves the
 *      component class via `api.getComponent(name)` and adds it.
 *      Missing components log a warning + are skipped — one bad
 *      component shouldn't take down spawning the whole entity.
 *   3. Merges spawn-time `opts` over each component's defaults.
 *      Convention: top-level `opts.{componentName}` is a shallow
 *      override of that component's data (e.g.
 *      `api.spawn("zombie", { Position: { x: 4, y: 5 } })`).
 *      For ergonomics the well-known shortcut `{ x, y, z }` rolls
 *      into the prefab's Position component if one is declared, so
 *      callers can write `api.spawn("zombie", { x, y })` like the
 *      JS-based prefabs do.
 */
export function registerDeclarativePrefabs(
  api: ModAPI,
  manifest: PackManifest,
): void {
  const prefabs = manifest.prefabs;
  if (!prefabs) return;
  for (const [id, prefab] of Object.entries(prefabs)) {
    registerOne(api, id, prefab);
  }
}

function registerOne(
  api: ModAPI,
  id: string,
  prefab: DeclarativePrefab,
): void {
  api.registerPrefab(id, (rawOpts: unknown = {}): Entity => {
    const opts = (typeof rawOpts === "object" && rawOpts !== null
      ? (rawOpts as Record<string, unknown>)
      : {});
    const entity = api.world.spawn();
    for (const [compName, baseData] of Object.entries(prefab.components)) {
      const ComponentClass = api.getComponent(compName);
      if (!ComponentClass) {
        console.warn(
          `Prefab "${id}": unknown component "${compName}" — skipping`,
        );
        continue;
      }
      const merged = applyOpts(compName, baseData, opts);
      const value = materialize(compName, merged);
      // `world.add` is chainable; the typing on Component<T> requires
      // a `T` that matches the registered shape. Declarative prefabs
      // are intentionally untyped at this seam — the schema-driven
      // editor enforces shape, but the engine treats data as opaque.
      api.world.add(entity, ComponentClass as never, value as never);
    }
    return entity;
  });
}

/**
 * Shallow-merge spawn-time options over a component's authored data.
 *
 * Three forms are honoured:
 *  - `opts[compName]` — an object whose keys overlay the authored data
 *    (e.g. `{ Position: { x: 4 } }` overrides `Position.x`).
 *  - For the well-known `Position` component, top-level `opts.x` /
 *    `opts.y` / `opts.z` roll in — matches the JS-prefab convention
 *    used by `default-pack/scripts/prefabs/player.js`.
 *  - For the well-known `Facing` component, top-level `opts.facing`
 *    rolls in (same convention).
 *
 * Unknown opts keys are ignored at this seam — the prefab declares
 * its surface, callers don't get to invent fields.
 */
function applyOpts(
  compName: string,
  baseData: unknown,
  opts: Record<string, unknown>,
): unknown {
  // Position shorthand — opts.x / opts.y / opts.z override.
  if (compName === "Position") {
    const base = baseData as Record<string, unknown> | undefined;
    const explicit = opts.Position as Record<string, unknown> | undefined;
    return {
      x: explicit?.x ?? opts.x ?? base?.x ?? 0,
      y: explicit?.y ?? opts.y ?? base?.y ?? 0,
      z: explicit?.z ?? opts.z ?? base?.z ?? 0,
    };
  }
  // Facing shorthand — opts.facing overrides.
  if (compName === "Facing") {
    if (typeof opts.facing === "number") {
      return opts.facing;
    }
    const explicit = opts.Facing;
    if (typeof explicit === "number") return explicit;
    return baseData;
  }
  // Generic — opts[compName] is an object overlay.
  const explicit = opts[compName];
  if (
    explicit !== undefined &&
    explicit !== null &&
    typeof explicit === "object" &&
    typeof baseData === "object" &&
    baseData !== null
  ) {
    return { ...(baseData as Record<string, unknown>), ...(explicit as Record<string, unknown>) };
  }
  if (explicit !== undefined) return explicit;
  return baseData;
}

/**
 * Convert a JSON-shaped data blob into the runtime instance the engine
 * expects. Today that's just `Position` → `Vec2(x, y)` (the engine
 * stores positions as `Vec2` instances, not plain objects). Everything
 * else round-trips verbatim.
 */
function materialize(compName: string, data: unknown): unknown {
  if (compName === "Position" && typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;
    const x = typeof obj.x === "number" ? obj.x : 0;
    const y = typeof obj.y === "number" ? obj.y : 0;
    // `Vec2` only carries (x, y); z lives on the prefab's Movement /
    // Position metadata downstream — pass it as a property on the
    // returned vector so callers reading `.z` see it (the engine's
    // built-in Position component sits on a Vec2 instance).
    const v = new Vec2(x, y);
    if (typeof obj.z === "number") (v as unknown as Record<string, unknown>).z = obj.z;
    return v;
  }
  return data;
}
