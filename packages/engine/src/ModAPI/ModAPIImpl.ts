import { Component, type Entity, type World } from "ECS";
import type { Scene } from "Scene";
import type { GameConfig } from "GameConfig";
import { CONFIG } from "GameConfig";
import type { AssetPack } from "AssetPack";
import { Vec2 } from "Libs/Vector";
import {
  BAG_SIZE,
  HOTBAR_SIZE,
  addItem,
  countItem,
  emptyEquipment,
  getActiveItem,
  removeItem,
  seedInventory,
} from "Libs/Inventory";
import { castRayToWall } from "Libs/Raycast";
import type KeyboardController from "Controllers/KeyboardController";
import type MouseController from "Controllers/MouseController";
import type ModalRegistry from "ModalRegistry";
import type ItemImages from "ItemImages";
import type { SceneRenderer } from "Renderers";
import type {
  BuiltInComponents,
  FrameFn,
  InputAPI,
  InventoryAPI,
  ItemImagesAPI,
  ModAPI,
  ModalsAPI,
  PrefabFn,
  RaycastAPI,
  RendererSystemFn,
  RenderPhase,
} from "./types";
import { ComponentRegistry } from "./ComponentRegistry";
import { SystemRegistry } from "./SystemRegistry";
import { PrefabRegistry } from "./PrefabRegistry";
import { InputRegistry } from "./InputRegistry";
import { ModalsRegistry } from "./ModalsRegistry";
import { RendererSystemRegistry } from "./RendererSystemRegistry";

/**
 * Dependencies the engine wires into the ModAPI implementation. Kept
 * as a struct so additions don't change the ctor's argument order.
 */
export interface ModAPIDeps {
  readonly world: World;
  readonly scene: Scene;
  readonly pack: AssetPack;
  readonly keyboard: KeyboardController;
  readonly mouse: MouseController;
  readonly modals: ModalRegistry;
  readonly itemImages: ItemImages;
}

/**
 * Concrete implementation. `Game` owns one of these for the lifetime of
 * the session and exposes it via `game.api`. `Game.update` calls
 * `runFrame(dt)` to fan out to every registered system; `Game.render`
 * calls `runRendererPhase` at each phase boundary; `Game` also calls
 * `runWorldReadyCallbacks` after `spawnInitialEntities`.
 */
export class ModAPIImpl implements ModAPI {
  readonly Vec2: typeof Vec2 = Vec2;
  readonly Component: typeof Component = Component;

  private readonly componentRegistry = new ComponentRegistry();
  private readonly systemRegistry = new SystemRegistry();
  private readonly prefabRegistry = new PrefabRegistry();
  private readonly rendererSystemRegistry = new RendererSystemRegistry();

  readonly components: BuiltInComponents = this.componentRegistry.builtIns;

  readonly inventory: InventoryAPI = {
    BAG_SIZE,
    HOTBAR_SIZE,
    emptyEquipment,
    seedInventory,
    addItem,
    removeItem,
    countItem,
    getActiveItem,
  };

  readonly raycast: RaycastAPI = {
    castRayToWall,
  };

  readonly world: World;
  readonly scene: Scene;
  readonly pack: AssetPack;
  readonly input: InputAPI;
  readonly modals: ModalsAPI;
  readonly itemImages: ItemImagesAPI;

  /**
   * Queued onWorldReady callbacks. Fired once by
   * `runWorldReadyCallbacks` (after `Game.spawnInitialEntities`), then
   * cleared. Subsequent registrations after that fire-and-clear point
   * are stored here too in case the engine ever runs the lifecycle
   * again (e.g. world reload).
   */
  private worldReadyCallbacks: Array<(api: ModAPI) => void> = [];
  private worldReady = false;

  constructor(deps: ModAPIDeps) {
    this.world = deps.world;
    this.scene = deps.scene;
    this.pack = deps.pack;
    this.input = new InputRegistry(deps.keyboard, deps.mouse);
    this.modals = new ModalsRegistry(deps.modals);
    this.itemImages = deps.itemImages;
  }

  /**
   * Throwing wrapper around `spawn` for engine-internal call sites that
   * expect a specific prefab to exist (e.g. `Game` invoking `"player"`
   * after pack scripts run). Provides a more actionable error than the
   * generic registry miss.
   */
  spawnPrefab(name: string, ...args: unknown[]): Entity {
    if (!this.prefabRegistry.has(name)) {
      throw new Error(
        `pack didn't register a '${name}' prefab — is this the default pack? ` +
          `Did boot scripts run before scene load?`,
      );
    }
    return this.prefabRegistry.spawn(name, ...args);
  }

  /** Live binding — reads see whatever's in `CONFIG` right now. */
  get config(): GameConfig {
    return CONFIG;
  }

  defineComponent<T>(name: string): Component<T> {
    return this.componentRegistry.defineComponent<T>(name);
  }

  getComponent(name: string): Component<unknown> | undefined {
    return this.componentRegistry.getComponent(name);
  }

  registerSystem(fn: FrameFn): () => void {
    return this.systemRegistry.registerSystem(fn);
  }

  registerPrefab(name: string, factory: PrefabFn): void {
    this.prefabRegistry.registerPrefab(name, factory);
  }

  spawn(name: string, ...args: unknown[]): Entity {
    return this.prefabRegistry.spawn(name, ...args);
  }

  onWorldReady(fn: (api: ModAPI) => void): void {
    if (this.worldReady) {
      // Late registration — fire immediately so scripts loaded after
      // the world-ready point don't silently miss the event.
      fn(this);
      return;
    }
    this.worldReadyCallbacks.push(fn);
  }

  registerRendererSystem(fn: RendererSystemFn, phase: RenderPhase): () => void {
    return this.rendererSystemRegistry.register(fn, phase);
  }

  /** Called by `Game.update`. Runs every mod-registered system in order. */
  runFrame(deltaTime: number): void {
    this.systemRegistry.runFrame(this.world, deltaTime);
  }

  /**
   * Called by `Game.render` at each phase boundary. Fans out to every
   * renderer system registered against `phase` in registration order.
   */
  runRendererPhase(phase: RenderPhase, renderer: SceneRenderer, deltaTime: number): void {
    this.rendererSystemRegistry.run(phase, renderer, this.world, deltaTime);
  }

  /**
   * Called by `Game.spawnInitialEntities` after the player + scene
   * entities have been spawned. Fires every queued `onWorldReady`
   * callback in registration order, clears the queue, and marks the
   * world ready so any later `onWorldReady` registrations fire
   * synchronously.
   */
  runWorldReadyCallbacks(): void {
    const callbacks = this.worldReadyCallbacks;
    this.worldReadyCallbacks = [];
    this.worldReady = true;
    for (const fn of callbacks) fn(this);
  }
}
