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
   */
  add<T>(entity: Entity, component: Component<T>, value: T): this {
    this.knownComponents.add(component as Component<unknown>);
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
