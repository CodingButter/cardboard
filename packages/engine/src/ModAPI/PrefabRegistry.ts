import type { Entity } from "ECS";
import type { PrefabFn } from "./types";

/**
 * Stores mod-registered prefab factories by name. Mods call
 * `registerPrefab` to add one, and `spawn` to invoke it.
 */
export class PrefabRegistry {
  private readonly prefabs = new Map<string, PrefabFn>();

  /**
   * Register a named prefab factory. The factory's args + return value
   * are documented by the mod that defines it.
   */
  registerPrefab(name: string, factory: PrefabFn): void {
    if (this.prefabs.has(name)) {
      console.warn(`Mod prefab "${name}" was already registered — replacing`);
    }
    this.prefabs.set(name, factory);
  }

  /** Invoke a named prefab. Throws if no prefab with that name exists. */
  spawn(name: string, ...args: unknown[]): Entity {
    const factory = this.prefabs.get(name);
    if (!factory) throw new Error(`No prefab named "${name}"`);
    return factory(...args);
  }

  /** `true` if a factory has been registered for `name`. */
  has(name: string): boolean {
    return this.prefabs.has(name);
  }
}
