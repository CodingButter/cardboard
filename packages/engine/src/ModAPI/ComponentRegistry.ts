import { Component } from "ECS";
import {
  Position,
  Facing,
  Movement,
  PlayerInput,
  Aim,
  Camera,
  MinimapMarker,
  Weapon,
  Inventory,
  Sprite,
  Animation,
  Pickup,
  Light,
  Shader,
} from "Components";
import type { BuiltInComponents } from "./types";

/**
 * Tracks mod-defined components alongside the engine's built-in set.
 * Mods call `defineComponent` to add new ones; `getComponent` resolves
 * either kind by name.
 */
export class ComponentRegistry {
  readonly builtIns: BuiltInComponents = {
    Position,
    Facing,
    Movement,
    PlayerInput,
    Aim,
    Camera,
    MinimapMarker,
    Weapon,
    Inventory,
    Sprite,
    Animation,
    Pickup,
    Light,
    Shader,
  };

  private readonly customComponents = new Map<string, Component<unknown>>();

  /**
   * Create a new component, registered by name so other scripts (and
   * `getComponent`) can find it. Throws if `name` is already taken.
   */
  defineComponent<T>(name: string): Component<T> {
    if (this.getComponent(name)) {
      throw new Error(`Component "${name}" is already defined`);
    }
    const c = new Component<T>(name);
    this.customComponents.set(name, c as Component<unknown>);
    return c;
  }

  /** Look up a previously defined component (built-in or mod). */
  getComponent(name: string): Component<unknown> | undefined {
    return (
      this.customComponents.get(name) ??
      (this.builtIns as unknown as Record<string, Component<unknown>>)[name]
    );
  }
}
