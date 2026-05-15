import type { Entity } from "./types";

/**
 * Typed storage for a single component kind.
 *
 * Each `Component<T>` is a singleton (`new Component<Vec2>("Position")`) and
 * acts as both the schema *and* the storage: the value associated with an
 * entity lives inside this object, not on the entity itself. This is the
 * classic ECS inversion — entities are bare numeric ids; components are
 * tables indexed by entity.
 *
 * Storage is a `Map<Entity, T>` for now. That's `O(1)` add / remove / lookup
 * with a tiny per-cell overhead and zero-allocation iteration via the map's
 * own iterator. If the entity count ever climbs into the tens of thousands
 * we can swap to a sparse-set without changing any consumer code.
 */
export class Component<T> {
  /** Human-readable label, useful in error messages and devtools. */
  readonly name: string;

  /** Map from entity id → component value. */
  private readonly store: Map<Entity, T> = new Map();

  constructor(name: string) {
    this.name = name;
  }

  /** Attach this component to `entity`, replacing any existing value. */
  set(entity: Entity, value: T): void {
    this.store.set(entity, value);
  }

  /** `true` if `entity` has this component attached. */
  has(entity: Entity): boolean {
    return this.store.has(entity);
  }

  /** Read this component's value for `entity`, or `undefined`. */
  get(entity: Entity): T | undefined {
    return this.store.get(entity);
  }

  /**
   * Read this component's value for `entity`, throwing if absent.
   * Use inside systems where the query has already proven it exists.
   */
  getOrThrow(entity: Entity): T {
    const value = this.store.get(entity);
    if (value === undefined) {
      throw new Error(`Entity ${entity} has no ${this.name} component`);
    }
    return value;
  }

  /** Remove this component from `entity`. No-op if it isn't attached. */
  remove(entity: Entity): void {
    this.store.delete(entity);
  }

  /** Number of entities that have this component. */
  size(): number {
    return this.store.size;
  }

  /** All entities that have this component. */
  entities(): IterableIterator<Entity> {
    return this.store.keys();
  }
}
