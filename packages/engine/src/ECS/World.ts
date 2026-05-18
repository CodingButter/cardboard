import { Component } from "./Component";
import type { Entity } from "./types";

/**
 * Turn a tuple of `Component<X>` into a tuple of the underlying `X` types.
 * Lets `each(Position, Facing, ...)` infer the callback's argument types
 * from the components it was passed.
 */
type ValueTuple<C extends readonly Component<unknown>[]> = {
  [K in keyof C]: C[K] extends Component<infer V> ? V : never;
};

/**
 * The container for everything in a running game.
 *
 * A `World` is a bag of numeric `Entity` ids, the components attached to
 * each, and the few bookkeeping fields needed to recycle ids and tear down
 * an entity in one call. It deliberately holds no rendering or simulation
 * logic — that lives in systems that operate over the world.
 */
export class World {
  private nextId: Entity = 1;

  /** Ids returned by `despawn`, ready to be reused on the next `spawn`. */
  private readonly freeIds: Entity[] = [];

  /** Entities currently alive. */
  private readonly alive: Set<Entity> = new Set();

  /**
   * Every component ever touched via `add`. `despawn` walks this to delete
   * the entity's data without each component having to register manually.
   */
  private readonly knownComponents: Set<Component<unknown>> = new Set();

  /**
   * Optional teardown hook — `ModAPIImpl` wires this to fire the
   * canonical `entity:despawned` event (Ev1 of EVENTS.md §4.2). Called
   * SYNCHRONOUSLY before component removal so handlers can read the
   * dying entity's components one last time. Engine internals (`new
   * World()` callers without ModAPI) leave it unset; the despawn path
   * stays byte-identical to pre-Ev1.
   */
  onDespawn: ((entity: Entity) => void) | null = null;

  /**
   * Optional name → Component resolver, installed by `ModAPIImpl` so
   * the string-based `query` / `getComponentByName` paths can look
   * names up through `ComponentRegistry`. Bare-`World` callers
   * (engine internals, tests) leave it unset; in that mode the
   * string-named helpers no-op (empty iterator / undefined).
   * WORLD_STATE.md §9.
   */
  resolveComponentName: ((name: string) => Component<unknown> | undefined) | null =
    null;

  /**
   * Optional component-name → schema lookup, installed by `ModAPIImpl`
   * so `add(entity, C, value)` can fill in schema-declared `default`
   * fields before storage. Returns the manifest-declared schema (or
   * `undefined` when the component has no schema or is unknown).
   * WORLD_STATE.md §4 ("schema is a natural extension for defaults").
   *
   * Bare-`World` callers leave this unset; defaults application
   * becomes a no-op in that mode (engine internals + tests behave
   * byte-identically to pre-defaults).
   */
  resolveComponentSchema: ((name: string) => Record<string, unknown> | undefined) | null =
    null;

  /**
   * Optional name → entity id index. Pack-side spawn paths (the engine's
   * scene-entity loader, the world-entity loader, pack scripts calling
   * `world.spawn() + setName`) write to this so `world.findByName("player")`
   * resolves O(1). WORLD_STATE.md §3 + "world.json full-scope" (2026-05-17).
   *
   * Cleared on `despawn` for any entity whose id appears as a value.
   * Names are unique within a `World` — the second `setName(e2, "player")`
   * call overwrites the first registration with a console warning.
   */
  private readonly nameIndex: Map<string, Entity> = new Map();
  private readonly entityNames: Map<Entity, string> = new Map();

  /** Allocate a new entity id. Reuses ids freed by `despawn` when possible. */
  spawn(): Entity {
    const id = this.freeIds.pop() ?? this.nextId++;
    this.alive.add(id);
    return id;
  }

  /**
   * Tear down an entity: every component it has is removed and the id is
   * returned to the free pool for reuse.
   */
  despawn(entity: Entity): void {
    if (!this.alive.has(entity)) return;
    // Pre-removal hook (Ev1 entity:despawned). Throws here would
    // prevent the entity tear-down; the hook implementation wraps
    // emit in try/catch so handler throws never reach this far.
    if (this.onDespawn !== null) this.onDespawn(entity);
    for (const component of this.knownComponents) component.remove(entity);
    const name = this.entityNames.get(entity);
    if (name !== undefined) {
      this.entityNames.delete(entity);
      if (this.nameIndex.get(name) === entity) this.nameIndex.delete(name);
    }
    this.alive.delete(entity);
    this.freeIds.push(entity);
  }

  /**
   * Register a human-readable name for an entity. The engine writes
   * to this index whenever it spawns a `name`-bearing record from
   * `scene.entities[]` / `world.json.entities[]`. Pack scripts call
   * `world.findByName(name)` to locate persistent entities (the
   * canonical "player" lookup). Re-using a name across two live entities
   * overwrites the index with a console warning — names are unique.
   * Pass `undefined` to clear an entity's name.
   */
  setName(entity: Entity, name: string | undefined): void {
    if (!this.alive.has(entity)) return;
    const prevName = this.entityNames.get(entity);
    if (prevName !== undefined) {
      this.entityNames.delete(entity);
      if (this.nameIndex.get(prevName) === entity) this.nameIndex.delete(prevName);
    }
    if (name === undefined) return;
    const existing = this.nameIndex.get(name);
    if (existing !== undefined && existing !== entity && this.alive.has(existing)) {
      console.warn(
        `[world] setName: name "${name}" reassigned from entity ${existing} → ${entity}`,
      );
    }
    this.nameIndex.set(name, entity);
    this.entityNames.set(entity, name);
  }

  /**
   * Resolve a previously-registered name to its entity id. Returns
   * `undefined` if the name isn't registered or its entity was
   * despawned. WORLD_STATE.md §3.
   */
  findByName(name: string): Entity | undefined {
    const id = this.nameIndex.get(name);
    if (id === undefined) return undefined;
    if (!this.alive.has(id)) {
      this.nameIndex.delete(name);
      return undefined;
    }
    return id;
  }

  /** Read-only view of `entity → name`. Used by `serialize`. */
  getName(entity: Entity): string | undefined {
    return this.entityNames.get(entity);
  }

  /** `true` while `entity` exists. */
  has(entity: Entity): boolean {
    return this.alive.has(entity);
  }

  /**
   * Attach (or overwrite) a component on `entity`. Registers the component
   * with the world so `despawn` knows to clean it up.
   *
   * When a `resolveComponentSchema` callback is installed (default
   * runtime path via `ModAPIImpl`) and the component has a manifest-
   * declared schema, missing fields are filled in from the schema's
   * `default` keyword before the value is stored. Schema-less
   * components (and bare-`World` callers with no resolver installed)
   * pass the value through unchanged — byte-identical to pre-defaults
   * behaviour.
   */
  add<T>(entity: Entity, component: Component<T>, value: T): this {
    this.knownComponents.add(component as Component<unknown>);
    const resolve = this.resolveComponentSchema;
    if (resolve !== null) {
      const schema = resolve(component.name);
      if (schema !== undefined) {
        const withDefaults = applyDefaults(schema, value) as T;
        component.set(entity, withDefaults);
        return this;
      }
    }
    component.set(entity, value);
    return this;
  }

  /** Detach a component from `entity`. */
  remove<T>(entity: Entity, component: Component<T>): void {
    component.remove(entity);
  }

  /**
   * Find the first entity that has all of the listed components.
   *
   * Useful for "singleton" components like `Camera` where there's only one
   * matching entity in the world.
   */
  first<C extends readonly Component<unknown>[]>(...components: C): Entity | undefined {
    if (components.length === 0) return undefined;
    outer: for (const entity of components[0]!.entities()) {
      for (let i = 1; i < components.length; i++) {
        if (!components[i]!.has(entity)) continue outer;
      }
      return entity;
    }
    return undefined;
  }

  /**
   * Iterate every entity that has all listed components, calling `fn` with
   * the entity id followed by each component's value in declaration order.
   *
   * Driven by the *first* component listed — list the smallest / most
   * specific one first to minimize the inner check work. Example:
   *
   * ```ts
   * world.each(PlayerInput, Position, Facing, (e, input, pos, facing) => {
   *   // PlayerInput is rare (1 entity), so iterating it is cheapest.
   * });
   * ```
   *
   * The callback shape is type-checked against the component types, so
   * mis-ordering arguments is a compile error.
   */
  each<C extends readonly Component<unknown>[]>(
    ...args: [...C, (entity: Entity, ...values: ValueTuple<C>) => void]
  ): void {
    const fn = args[args.length - 1] as (entity: Entity, ...values: unknown[]) => void;
    const components = args.slice(0, -1) as unknown as Component<unknown>[];
    if (components.length === 0) return;

    const primary = components[0]!;
    const values: unknown[] = new Array(components.length);

    outer: for (const entity of primary.entities()) {
      values[0] = primary.get(entity);
      for (let i = 1; i < components.length; i++) {
        const c = components[i]!;
        const v = c.get(entity);
        if (v === undefined && !c.has(entity)) continue outer;
        values[i] = v;
      }
      fn(entity, ...values);
    }
  }

  /** Number of alive entities. Cheap to call. */
  entityCount(): number {
    return this.alive.size;
  }

  /**
   * Snapshot every currently-alive entity id. Returns a fresh array
   * so callers can mutate the world (e.g. `despawn` walk) without
   * tripping iteration. WORLD_STATE.md §6.2 — `Game.loadScene` uses
   * this for the scene-scoped despawn pass.
   */
  liveEntities(): Entity[] {
    return Array.from(this.alive);
  }

  /**
   * Generator that yields every entity carrying all `components`.
   * Same membership semantics as `each` but exposes the entity ids
   * to the caller — useful for serialise / despawn-loops / generic
   * introspection where the per-component values aren't needed.
   *
   * Walks the FIRST component's entity list and filters by the rest
   * (same iteration strategy as `each`). Pass the rarest component
   * first to minimise inner-check work.
   *
   * WORLD_STATE.md §9. The string-named counterpart
   * `api.world.query("Position", "Health")` lives on `ModAPIImpl`
   * and resolves names through `ComponentRegistry.getComponent`
   * before delegating here.
   */
  *queryComponents(
    ...components: ReadonlyArray<Component<unknown>>
  ): IterableIterator<Entity> {
    if (components.length === 0) return;
    const primary = components[0]!;
    outer: for (const entity of primary.entities()) {
      for (let i = 1; i < components.length; i++) {
        if (!components[i]!.has(entity)) continue outer;
      }
      yield entity;
    }
  }

  /**
   * Iterate every entity carrying the listed components, calling
   * `fn` with the entity id only (no per-component values). Cheap
   * when callers walk a wide query and only need the ids.
   *
   * Internally a `for-of` over `queryComponents`; kept as a method
   * so the registry-side `world.query(...names)` adapter has a
   * single call site to inline.
   */
  eachId(
    components: ReadonlyArray<Component<unknown>>,
    fn: (entity: Entity) => void,
  ): void {
    for (const entity of this.queryComponents(...components)) fn(entity);
  }

  /**
   * String-named query — generator yielding every entity carrying all
   * `names`. Resolves names through `resolveComponentName` (wired by
   * `ModAPIImpl`). Unknown names yield no entities. The component-
   * instance variant `queryComponents` is preferred inside engine
   * internals where the `Component` reference is already in hand;
   * pack scripts use this through `api.world.query(...names)`.
   * WORLD_STATE.md §9.
   */
  *query(...names: string[]): IterableIterator<Entity> {
    if (names.length === 0) return;
    const resolver = this.resolveComponentName;
    if (resolver === null) return;
    const components: Component<unknown>[] = [];
    for (const name of names) {
      const c = resolver(name);
      if (c === undefined) return; // unknown name → no matches
      components.push(c);
    }
    yield* this.queryComponents(...components);
  }

  /**
   * By-name component lookup. Returns the raw component value or
   * `undefined` if the name is unknown or the entity lacks the
   * component. WORLD_STATE.md §9.
   */
  getComponentByName(entity: Entity, name: string): unknown | undefined {
    const resolver = this.resolveComponentName;
    if (resolver === null) return undefined;
    const c = resolver(name);
    if (c === undefined) return undefined;
    return c.get(entity);
  }
}

/* -------------------------------------------------------------------------- */
/* Schema-driven defaults                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Fill in schema-declared `default` fields on `value`. Pure / idempotent:
 *   - Top-level primitive schema (`{ type: "number", default: 0 }`):
 *     returns `default` when `value === undefined`, else `value`.
 *   - Object schema: shallow-copies `value` and back-fills each
 *     property whose declared `default` is present and whose value
 *     is missing from `value`. Recurses into nested object properties
 *     so nested schemas with their own `default` fields propagate too.
 *   - Array properties: top-level array `default` is honoured when
 *     the field is missing; the function does NOT walk array items
 *     (per-item defaults only matter on `push` operations, not on
 *     the array as a whole).
 *
 * Returns a NEW object when defaults were applied; returns `value`
 * itself (no allocation) when no defaults were missing — keeps the
 * hot path cheap for components that are already fully specified.
 *
 * Exposed at module scope (not on `World`) so the engine + future
 * editor tooling can share the same definition.
 */
export function applyDefaults(
  schema: Record<string, unknown>,
  value: unknown,
): unknown {
  const type = (schema as { type?: unknown }).type;
  if (type === "object" || (type === undefined && hasProperties(schema))) {
    return applyObjectDefaults(schema, value);
  }
  // Top-level primitive / array / etc. — honour `default` when value is
  // undefined.
  if (value === undefined && "default" in schema) {
    return (schema as { default: unknown }).default;
  }
  return value;
}

function hasProperties(schema: Record<string, unknown>): boolean {
  const p = (schema as { properties?: unknown }).properties;
  return !!p && typeof p === "object";
}

function applyObjectDefaults(
  schema: Record<string, unknown>,
  value: unknown,
): Record<string, unknown> | unknown {
  const props = (schema as { properties?: Record<string, unknown> }).properties;
  if (!props || typeof props !== "object") {
    // No properties declared — pass-through (an opaque object schema).
    return value === undefined ? {} : value;
  }

  const input =
    value !== undefined && value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;

  // Decide whether anything actually needs filling in. Avoids the
  // shallow-copy allocation on the hot path where every field is
  // already set by the caller.
  let needsCopy = input === null;
  if (!needsCopy && input !== null) {
    for (const key of Object.keys(props)) {
      const sub = props[key] as Record<string, unknown> | undefined;
      if (!sub) continue;
      if (input[key] === undefined && "default" in sub) {
        needsCopy = true;
        break;
      }
      // A nested object property with its own defaults might still
      // need recursion even when the parent key exists.
      if (
        input[key] !== undefined &&
        sub &&
        (sub as { type?: unknown }).type === "object" &&
        hasProperties(sub)
      ) {
        // Recurse into the nested object; only triggers a copy if the
        // nested call returns a NEW reference.
        const recursed = applyObjectDefaults(sub, input[key]);
        if (recursed !== input[key]) {
          needsCopy = true;
          break;
        }
      }
    }
  }
  if (!needsCopy && input !== null) return input;

  const out: Record<string, unknown> = input !== null ? { ...input } : {};
  for (const key of Object.keys(props)) {
    const sub = props[key] as Record<string, unknown> | undefined;
    if (!sub) continue;
    if (out[key] === undefined) {
      if ("default" in sub) {
        out[key] = cloneDefault((sub as { default: unknown }).default);
      }
    } else if ((sub as { type?: unknown }).type === "object" && hasProperties(sub)) {
      out[key] = applyObjectDefaults(sub, out[key]);
    }
  }
  return out;
}

/**
 * Shallow clone of a literal `default` value so two `add(...)` calls
 * with no value-supplied don't share the same array / object instance.
 * Primitives pass through. Arrays / plain objects are one-level cloned;
 * deeper nesting in a `default` block is rare and the cost of full
 * deep-cloning isn't justified for this hot path.
 */
function cloneDefault(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return [...value];
  return { ...(value as Record<string, unknown>) };
}
