import type { Entity } from "ECS";
import type { ModAPI } from "ModAPI";
import type { AssetPack } from "./AssetPack";
import type { DeclarativePrefab, PackManifest } from "./types";
import { Vec2 } from "Libs/Vector";

/**
 * The shape an init-script's default export takes. Phase #196.
 *
 * Init scripts are regular pack scripts (compiled through the same
 * `.ts`/`.tsx` pipeline as `manifest.scripts[]`) whose default export
 * is called once per spawn, AFTER all the prefab's static components
 * have been attached. Three args:
 *
 *  - `entity` — the freshly-spawned entity id. Already carries every
 *    `prefab.components` entry.
 *  - `opts` — the same object the caller passed to
 *    `api.spawn(name, opts)`. The same opts have already been folded
 *    into well-known component shortcuts (Position x/y/z, Facing) by
 *    the static path, so this is mainly for keys the declarative
 *    side doesn't know how to merge.
 *  - `api` — the regular `ModAPI` surface; same instance the rest of
 *    the pack uses.
 *
 * The return value is ignored.
 */
export type PrefabInitScript = (
  entity: Entity,
  opts: Record<string, unknown>,
  api: ModAPI,
) => void;

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
  pack?: AssetPack,
): void {
  const prefabs = manifest.prefabs;
  if (!prefabs) return;
  for (const [id, prefab] of Object.entries(prefabs)) {
    registerOne(api, id, prefab, pack);
  }
}

/**
 * Async sibling of `registerDeclarativePrefabs` that PRE-LOADS every
 * referenced `initScript` before registering the prefab factories. Use
 * this when callers need init-script-attached components to be visible
 * synchronously immediately after `api.spawn(...)` returns — typically
 * the engine's boot path and the smoke test.
 *
 * The sync `registerDeclarativePrefabs` registers the factories
 * immediately and fires-and-forgets init-script loads; that's fine for
 * spawns that don't need to read the init-attached state inside the
 * same call stack, but it doesn't give callers a way to await the
 * pre-warm. This variant exists for the "I need the init script ready
 * before any spawn happens" case.
 *
 * Phase #196.
 */
export async function registerDeclarativePrefabsAsync(
  api: ModAPI,
  manifest: PackManifest,
  pack?: AssetPack,
): Promise<void> {
  const prefabs = manifest.prefabs;
  if (!prefabs) return;
  // Pre-warm every init script in parallel so we don't serialise the
  // network / blob-URL spin-up across N prefabs. Capture the resolved
  // PrefabInitScript per prefab in a sync map; registerOne passes the
  // resolved value through so the spawn factory can call it
  // synchronously without an extra microtask hop.
  const resolved = new Map<string, PrefabInitScript | null>();
  await Promise.all(
    Object.entries(prefabs).map(async ([id, p]) => {
      if (!p.initScript) return;
      const fn = await loadInitScript(pack, p.initScript);
      resolved.set(id, fn);
    }),
  );
  for (const [id, prefab] of Object.entries(prefabs)) {
    registerOne(api, id, prefab, pack, resolved.get(id) ?? undefined);
  }
}

/**
 * Resolve a prefab init script's default export. We dynamic-import a
 * Blob URL constructed from the pack's text body for the script path.
 * The resulting module is cached so re-spawning the same prefab in a
 * tight loop doesn't re-pay the import + blob cost every call.
 *
 * Returns `null` (after console.warn / console.error) when:
 *  - the pack reference is absent (no way to read the script source),
 *  - the path isn't present in the pack,
 *  - the module fails to evaluate,
 *  - or the module's default export isn't a function.
 *
 * Init-script failures are non-fatal: the static components attached
 * before the script ran are still on the entity, and the engine logs
 * the error so the pack author sees it.
 */
let initScriptCache = new WeakMap<
  AssetPack,
  Map<string, Promise<PrefabInitScript | null>>
>();

async function loadInitScript(
  pack: AssetPack | undefined,
  path: string,
): Promise<PrefabInitScript | null> {
  if (!pack) {
    console.warn(
      `Prefab initScript "${path}": no AssetPack supplied — skipping`,
    );
    return null;
  }
  let perPack = initScriptCache.get(pack);
  if (!perPack) {
    perPack = new Map();
    initScriptCache.set(pack, perPack);
  }
  let cached = perPack.get(path);
  if (cached) return cached;
  cached = (async () => {
    try {
      if (!pack.has(path)) {
        console.error(
          `Prefab initScript "${path}": not present in pack — skipping`,
        );
        return null;
      }
      const source = await pack.textBody(path);
      const blob = new Blob([source], { type: "application/javascript" });
      const url = URL.createObjectURL(blob);
      try {
        const mod = (await import(/* @vite-ignore */ url)) as Record<
          string,
          unknown
        >;
        const fn = (mod.default ?? mod.setup) as
          | PrefabInitScript
          | undefined;
        if (typeof fn !== "function") {
          console.error(
            `Prefab initScript "${path}": no default export function`,
          );
          return null;
        }
        return fn;
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(
        `Prefab initScript "${path}": failed to load —`,
        err,
      );
      return null;
    }
  })();
  perPack.set(path, cached);
  return cached;
}

/**
 * Test-only escape hatch — drops every memoised init-script module so
 * a second registration pass with different source bodies sees the
 * fresh JS. The runtime never calls this; it exists for the
 * `scripts/smoke-prefab-initscript.ts` regression suite where the same
 * pack reference is reused across mutation steps.
 */
export function _resetInitScriptCache(): void {
  initScriptCache = new WeakMap();
}

function registerOne(
  api: ModAPI,
  id: string,
  prefab: DeclarativePrefab,
  pack?: AssetPack,
  preResolvedInit?: PrefabInitScript | null,
): void {
  // Pre-warm the init-script load when the prefab has one. The promise
  // resolves to the script's default export (or null on failure). Firing
  // the load at registration time means the first spawn doesn't pay a
  // cold-start cost; callers that need the init script *resolved* before
  // the first spawn should call `registerDeclarativePrefabsAsync` instead
  // (which threads the resolved function through `preResolvedInit`).
  let resolvedInit: PrefabInitScript | null | undefined = preResolvedInit;
  const initLoad = prefab.initScript
    ? preResolvedInit !== undefined
      ? Promise.resolve(preResolvedInit)
      : loadInitScript(pack, prefab.initScript).then((fn) => {
          resolvedInit = fn;
          return fn;
        })
    : null;

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
    // ── Hybrid prefab — run the init script AFTER static attachment.
    //
    // Two paths:
    //  - Init script already resolved (pre-warmed via
    //    `registerDeclarativePrefabsAsync` or any earlier spawn that
    //    awaited it): call it synchronously so the entity carries the
    //    init-attached components by the time `api.spawn(...)` returns.
    //  - Init script still loading: fire-and-forget. The entity is
    //    returned immediately with only its static components; the
    //    init-attached state arrives one microtask later. Pack scripts
    //    that need to observe that state from outside the init flow
    //    should use the `entity:spawned` event or `onWorldReady`.
    //
    // Errors are caught and logged either way — one bad initScript
    // shouldn't take down a session, and the static components are
    // already on the entity by the time we reach this point.
    if (initLoad) {
      if (resolvedInit !== undefined) {
        const fn = resolvedInit;
        if (fn) {
          try {
            fn(entity, opts, api);
          } catch (err) {
            console.error(
              `Prefab "${id}" initScript threw —`,
              err,
            );
          }
        }
      } else {
        initLoad
          .then((fn) => {
            if (!fn) return;
            try {
              fn(entity, opts, api);
            } catch (err) {
              console.error(
                `Prefab "${id}" initScript threw —`,
                err,
              );
            }
          })
          .catch((err) => {
            console.error(
              `Prefab "${id}" initScript load rejected —`,
              err,
            );
          });
      }
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
