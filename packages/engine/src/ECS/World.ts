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
    this.alive.delete(entity);
    this.freeIds.push(entity);
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
}
