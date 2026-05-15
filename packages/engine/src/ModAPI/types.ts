import { Component, type Entity, type World } from "ECS";
import type { Scene } from "Scene";
import type { GameConfig } from "GameConfig";
import type { AssetPack } from "AssetPack";
import { Vec2 } from "Libs/Vector";
import type { KeyCode } from "Controllers/KeyboardController";
import type { SceneRenderer } from "Renderers";
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
  Pickup,
  Light,
} from "Components";
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
import type ItemImages from "ItemImages";
import { castRayToWall } from "Libs/Raycast";

/**
 * The modding surface exposed to pack scripts.
 *
 * Each script in `manifest.scripts` is loaded as an ES module and called
 * with a single argument — an instance of `ModAPI`. The script registers
 * components, prefabs, and systems through this object; the engine runs
 * them alongside the built-in pipeline.
 *
 * ## Example script
 *
 * ```js
 * export default (api) => {
 *   const Health = api.defineComponent("Health");
 *
 *   api.registerPrefab("imp", (x, y) => {
 *     const e = api.world.spawn();
 *     api.world.add(e, api.components.Position, new api.Vec2(x, y));
 *     api.world.add(e, Health, { hp: 30 });
 *     return e;
 *   });
 *
 *   api.registerSystem((world, dt) => {
 *     world.each(api.components.Position, Health, (e, pos, hp) => {
 *       hp.hp -= dt * 5;
 *       if (hp.hp <= 0) world.despawn(e);
 *     });
 *   });
 * };
 * ```
 *
 * The surface is intentionally small in phase 3 — scripts get the
 * primitives they need to spawn entities and run per-frame logic.
 * Future phases can add hooks (onStart, onCollide, onShot, ...) without
 * breaking existing mods.
 */

/** Mod-registered per-frame logic. Runs after the built-in update systems. */
export type FrameFn = (world: World, deltaTime: number) => void;

/** Mod-registered factory. Free-form args; mods document their own signatures. */
export type PrefabFn = (...args: any[]) => Entity;

/**
 * Render-phase slots a mod-registered renderer system can attach to.
 * `Game.render` fires the registered systems for each phase at the
 * point in the draw flow named by the phase:
 *
 *   - `before-world`   — before sky/world; e.g. sky overlays.
 *   - `after-world`    — after `drawWorld`, before sprites; viewmodel.
 *   - `after-sprites`  — after sprites, before `endFrame`; world overlays.
 *   - `hud`            — after `endFrame` on the HUD ctx; minimap, reticle, etc.
 */
export type RenderPhase = "before-world" | "after-world" | "after-sprites" | "hud";

/** Mod-registered renderer system. Receives the active renderer + world. */
export type RendererSystemFn = (
  renderer: SceneRenderer,
  world: World,
  deltaTime: number,
) => void;

/** Read-only keyboard view exposed on `api.input.keyboard`. */
export interface KeyboardInputAPI {
  isKeyPressed(code: KeyCode): boolean;
  isAnyKeyPressed(codes: readonly KeyCode[]): boolean;
}

/** Read-only mouse view exposed on `api.input.mouse`. */
export interface MouseInputAPI {
  isButtonPressed(button: number): boolean;
  /** Cumulative motion since last call. Resets after read. */
  consumeMovement(): Vec2;
  /** Signed notch count since last call. Resets after read. */
  consumeWheel(): number;
  /** Cursor position in target-element coordinates. */
  readonly position: Vec2;
}

/**
 * Input surface exposed to pack scripts. Wraps the engine's
 * `KeyboardController` / `MouseController` without handing out the
 * controller objects themselves. `isBindingPressed` dispatches across
 * keyboard + mouse codes via the engine's existing helper.
 */
export interface InputAPI {
  readonly keyboard: KeyboardInputAPI;
  readonly mouse: MouseInputAPI;
  /** Unified bindings helper — accepts keyboard or `MouseN` codes. */
  isBindingPressed(codes: readonly KeyCode[]): boolean;
}

/**
 * Modal registry surface for pack-side modal systems. Lets them
 * coordinate so multiple modals don't fight over Escape / clicks.
 */
export interface ModalsAPI {
  setOpen(modalId: string, isOpen: boolean): void;
  isOpen(modalId: string): boolean;
  /** `true` when any modal is open. */
  any(): boolean;
  /** `true` when a modal other than `modalId` is open. */
  anyOther(modalId: string): boolean;
}

/** Engine-defined components exposed to mods by name. */
export interface BuiltInComponents {
  Position: typeof Position;
  Facing: typeof Facing;
  Movement: typeof Movement;
  PlayerInput: typeof PlayerInput;
  Aim: typeof Aim;
  Camera: typeof Camera;
  MinimapMarker: typeof MinimapMarker;
  Weapon: typeof Weapon;
  Inventory: typeof Inventory;
  Sprite: typeof Sprite;
  Pickup: typeof Pickup;
  Light: typeof Light;
}

/**
 * Inventory helpers + sizing constants. Exposed on `api.inventory` so
 * pack-side prefabs (e.g. `player.js`) and systems (gun-render, pickup,
 * stats overlay, inventory bar) can manipulate inventories without
 * re-implementing the bag/hotbar layout.
 *
 * These helpers all live in `Libs/Inventory` in the engine; the ModAPI
 * just re-exposes them so pack scripts can reach them without
 * importing engine modules (pack scripts load as plain JS via a Blob
 * URL — no module resolution back into the engine).
 */
export interface InventoryAPI {
  readonly BAG_SIZE: number;
  readonly HOTBAR_SIZE: number;
  readonly emptyEquipment: typeof emptyEquipment;
  readonly seedInventory: typeof seedInventory;
  readonly addItem: typeof addItem;
  readonly removeItem: typeof removeItem;
  readonly countItem: typeof countItem;
  readonly getActiveItem: typeof getActiveItem;
}

/**
 * Raycast helpers re-exposed on `api.raycast` for pack-side systems
 * that need ray queries against the scene (today: the minimap's
 * forward-direction line for the player marker).
 */
export interface RaycastAPI {
  readonly castRayToWall: typeof castRayToWall;
}

/**
 * Shared item-image cache, exposed on `api.itemImages`. Pack-side HUD
 * systems (gun viewmodel, inventory bar) blit these decoded images
 * into the canvas — keeping the cache engine-owned means every system
 * reads from the same `HTMLImageElement` instances and the textures
 * decode once at boot.
 */
export type ItemImagesAPI = ItemImages;

/** The api passed to every pack script. */
export interface ModAPI {
  /** The active ECS world. Stable across the session. */
  readonly world: World;
  /** The currently loaded scene. */
  readonly scene: Scene;
  /** Live `GameConfig`. Reads see the merged baseline + pack overrides. */
  readonly config: GameConfig;
  /**
   * The active asset pack. Pack scripts use this to read `manifest`
   * (items, defaultInventory, etc.) when assembling entities — e.g. the
   * default pack's `player.js` prefab calls `seedInventory` against
   * `api.pack.manifest`.
   */
  readonly pack: AssetPack;
  /** Built-in components, by name. Use these to spawn entities the engine already understands. */
  readonly components: BuiltInComponents;
  /** Inventory helpers (sizes, seeding). See `InventoryAPI`. */
  readonly inventory: InventoryAPI;
  /** Raycast helpers — engine internals re-exposed for pack systems. */
  readonly raycast: RaycastAPI;
  /** Decoded item images, indexed by `itemId`. See `ItemImagesAPI`. */
  readonly itemImages: ItemImagesAPI;
  /**
   * Read-only views of the engine's keyboard + mouse controllers.
   * Pack-side systems consume these instead of importing the
   * `KeyboardController` / `MouseController` classes directly.
   */
  readonly input: InputAPI;
  /**
   * Modal registry. Pack-side modal systems toggle themselves
   * through this so the engine + sibling modals can coordinate (any
   * modal open → world systems pause; other-modal-open → suppress
   * own toggle keys).
   */
  readonly modals: ModalsAPI;
  /** Vec2 constructor — handy because positions are Vec2 instances. */
  readonly Vec2: typeof Vec2;
  /** Component class — for advanced use (most mods can use `defineComponent` instead). */
  readonly Component: typeof Component;

  /**
   * Create a new component, registered by name so other scripts (and
   * `getComponent`) can find it. Throws if `name` is already taken.
   */
  defineComponent<T>(name: string): Component<T>;

  /** Look up a previously defined component (built-in or mod). */
  getComponent(name: string): Component<unknown> | undefined;

  /**
   * Register a per-frame system. Runs once per frame, after the engine's
   * built-in update phase. Returns a function that removes the system.
   */
  registerSystem(fn: FrameFn): () => void;

  /**
   * Register a named prefab factory. The factory's args + return value
   * are documented by the mod that defines it.
   */
  registerPrefab(name: string, factory: PrefabFn): void;

  /** Invoke a named prefab. Throws if no prefab with that name exists. */
  spawn(name: string, ...args: unknown[]): Entity;

  /**
   * Register a callback that fires once, after the engine has spawned
   * the scene's initial entities (player, etc.). Pack scripts use this
   * to locate named entities and attach extra components without
   * "if entity exists yet" guards. Callbacks fire in registration
   * order. Re-registering after the world is ready fires the callback
   * synchronously on the next world-ready event.
   */
  onWorldReady(fn: (api: ModAPI) => void): void;

  /**
   * Attach a renderer system to one of the engine's render phases.
   * Returns an unsubscribe function. See `RenderPhase` for the
   * available slots. Order within a phase is registration order.
   */
  registerRendererSystem(fn: RendererSystemFn, phase: RenderPhase): () => void;
}
