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
  defaultStackMax,
  emptyEquipment,
  getActiveItem,
  quickTransfer,
  removeItem,
  seedInventory,
} from "Libs/Inventory";
import { EQUIP_SLOTS } from "AssetPack";
import { castRayToWall } from "Libs/Raycast";
import type KeyboardController from "Controllers/KeyboardController";
import type MouseController from "Controllers/MouseController";
import type ModalRegistry from "ModalRegistry";
import type ItemImages from "ItemImages";
import type { SceneRenderer } from "Renderers";
import type { PartialGameConfig } from "Settings";
import type {
  AnimAPI,
  AudioAPI,
  BindingsAPI,
  BuiltInComponents,
  DebugAPI,
  DebugStatsSnapshot,
  EventsAPI,
  FrameFn,
  InputAPI,
  InventoryAPI,
  ItemImagesAPI,
  ModAPI,
  ModalsAPI,
  PrefabFn,
  ProceduralAudioAPI,
  ProceduralPlayInstrumentOpts,
  RaycastAPI,
  RendererSystemFn,
  RenderPhase,
  SceneControllerView,
  SerializedEntity,
  SettingsAPI,
  UIAPI,
} from "./types";
import { ProceduralAPIImpl, type ProceduralAPI } from "Procedural";
import { ComponentRegistry } from "./ComponentRegistry";
import { SystemRegistry } from "./SystemRegistry";
import { PrefabRegistry } from "./PrefabRegistry";
import { InputRegistry } from "./InputRegistry";
import { ModalsRegistry } from "./ModalsRegistry";
import { RendererSystemRegistry } from "./RendererSystemRegistry";
import { UIRegistry } from "./UIRegistry";
import { SettingsRegistry } from "./SettingsRegistry";
import { BindingsRegistry } from "./BindingsRegistry";
import { AnimRegistry } from "./AnimRegistry";
import { AudioRegistry } from "./AudioRegistry";
import { RecipeStore } from "ProceduralAudio";
import { EventsRegistry } from "./EventsRegistry";
import { ConsoleRegistry, type ConsoleAPI } from "./ConsoleAPI";
import { SystemScheduler, type SystemPhase } from "./SystemScheduler";

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
  /**
   * Pack-supplied `config.json` overlay applied at boot. Threaded into
   * the `SettingsRegistry` so `api.settings.save` re-layers pack +
   * user when committing changes — without it, single-field edits
   * through the UI would erase the pack's own tweaks.
   */
  readonly packConfig: PartialGameConfig;
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
    EQUIP_SLOTS,
    emptyEquipment,
    seedInventory,
    addItem,
    removeItem,
    countItem,
    getActiveItem,
    defaultStackMax,
    quickTransfer,
  };

  readonly raycast: RaycastAPI = {
    castRayToWall,
  };

  readonly world: World;
  /**
   * Live scene reference. Mutable so the engine can swap to a
   * different scene at runtime via `Game.loadScene` /
   * `Game.reloadScene` (see EDITOR_IFRAME.md §7) without rebuilding
   * the entire ModAPI. Pack scripts read `api.scene.*` per frame so
   * the swap takes effect on the next tick.
   */
  scene: Scene;
  readonly pack: AssetPack;
  readonly input: InputAPI;
  readonly modals: ModalsAPI;
  readonly itemImages: ItemImagesAPI;
  readonly ui: UIAPI;
  readonly settings: SettingsAPI;
  readonly bindings: BindingsAPI;
  readonly anim: AnimAPI;
  /**
   * Audio surface — Au1 of `docs/plans/AUDIO.md`. Exposed as the
   * concrete `AudioRegistry` so the engine can reach `preloadAll()` /
   * `syncFromConfig()` without casting; pack scripts see only the
   * `AudioAPI` slice via the public `ModAPI` interface.
   */
  readonly audio: AudioAPI & {
    preloadAll(): Promise<void>;
    syncFromConfig(): void;
  };
  /**
   * Procedural-image surface — IL2 of `docs/plans/IMAGE_LAB.md`.
   * Recipes (`recipes/*.image.json`) compile + bake to a WebGL
   * texture on first `load(id)`; static texture + spritesheet bakes
   * are cached in IDB keyed by recipe content hash so cold loads on
   * subsequent sessions skip the bake.
   *
   * Held as the concrete shape (with `dispose()`) so the engine can
   * tear down the offscreen renderer on pack swap / shutdown without
   * casting; pack scripts see only the `ProceduralAPI` slice via the
   * public `ModAPI` interface.
   */
  readonly procedural: ProceduralAPI & {
    dispose(): void;
  };
  /**
   * Procedural-audio surface — SL2 of `docs/plans/SOUND_LAB.md`. The
   * concrete `RecipeStore` is held privately; pack scripts see only
   * the `ProceduralAudioAPI` slice exposed via the public `ModAPI`
   * interface. Same engine-internal-vs-pack-public split as `audio`
   * and `events` above.
   */
  readonly proceduralAudio: ProceduralAudioAPI & {
    loadFromPack(): Promise<void>;
    dispose(): void;
  };
  /**
   * Concrete recipe store. Held privately so the engine can pass it
   * to `AudioRegistry.setRecipeStore` after the boot scan completes.
   * Pack scripts reach it via the `proceduralAudio` surface above.
   */
  private readonly recipeStore: RecipeStore;
  /**
   * Event bus — Ev1 of `docs/plans/EVENTS.md`. Exposed as the concrete
   * `EventsRegistry` so the engine can reach `setActiveScript()` /
   * `disposeScript()` / `disposeAll()` for auto-cleanup; pack scripts
   * see only the `EventsAPI` slice via the public `ModAPI` interface.
   * Same pattern as `audio` above.
   */
  readonly events: EventsAPI & {
    setActiveScript(path: string | null): void;
    disposeScript(path: string): void;
    disposeAll(): void;
  };
  /**
   * Engine telemetry surface — Q5 of `docs/plans/EDITOR_REDESIGN.md`
   * §12. Minimal pass-through today: reads live `World.entityCount()`
   * and reports zeros for renderer / frame-timing counters. The full
   * `StatsCollector` wiring (frame timing + draw calls + audio voices)
   * lands when `Game.update` / `Game.render` start feeding the
   * collector — see `Debug/stats.ts`. The shape is stable so callers
   * (editor iframe bridge, in-game `stats` console command) don't
   * have to change when the real numbers come online.
   */
  readonly debug: DebugAPI;
  /**
   * Developer-console recording surface — CONSOLE.md MVP. Held as
   * the concrete `ConsoleRegistry` for parity with `events` / `audio`
   * above (so future engine internals can reach private extras
   * without casting); pack scripts see only the `ConsoleAPI` slice
   * exposed via `ModAPI`.
   */
  readonly console: ConsoleAPI;
  /**
   * Phased system scheduler — WORLD_STATE.md §7.2 + §11. Fed by
   * `Systems`-component attach handlers (not yet wired in this MVP);
   * `Game.update` / `Game.render` drive the `update` / `fixedUpdate` /
   * `render` phases every frame so any system that *is* registered
   * runs at the right boundary. Held publicly so future `Systems`
   * component handlers reach `register` / `unregisterEntity` without
   * casting.
   */
  readonly systemScheduler: SystemScheduler = new SystemScheduler();

  /**
   * Internal handle to the UI registry. The engine's `Game.update`
   * calls `flush()` once per frame to reconcile registered modal
   * components against the open-modal set.
   */
  private readonly uiRegistry: UIRegistry;

  /**
   * Queued onWorldReady callbacks. Fired once by
   * `runWorldReadyCallbacks` (after `Game.spawnInitialEntities`), then
   * cleared. Subsequent registrations after that fire-and-clear point
   * are stored here too in case the engine ever runs the lifecycle
   * again (e.g. world reload).
   */
  private worldReadyCallbacks: Array<(api: ModAPI) => void> = [];
  private worldReady = false;

  /**
   * World-singleton tracker — `componentName → entityId`. Persists
   * across scene swaps (the engine's scene-teardown loop skips these
   * ids). Created lazily on the first `api.singleton(name)` call per
   * name. WORLD_STATE.md §5.3.
   */
  private readonly singletonEntities = new Map<string, Entity>();

  /**
   * Currently-active scene controller view (WORLD_STATE.md §5.2).
   * Updated by `Game` on every `scene:loaded` boundary via
   * `setSceneController`. `undefined` between scenes (scene unloaded,
   * next not yet ready).
   */
  private sceneControllerState: SceneControllerView | undefined = undefined;

  /**
   * One-shot warn-set so non-serialisable components don't spam the
   * console on every save / replication tick. Cleared per `Game`
   * lifetime — re-flagging a problem after a hot-reload is fine.
   */
  private readonly serialiseWarned = new Set<string>();

  constructor(deps: ModAPIDeps) {
    this.world = deps.world;
    this.scene = deps.scene;
    this.pack = deps.pack;
    // Events must be constructed BEFORE any registry that emits — the
    // ModalsRegistry wrapper fires `modal:opened` / `modal:closed`
    // through the bus on every `setOpen` edge.
    this.events = new EventsRegistry();
    // Console recording surface — CONSOLE.md MVP. Built early so any
    // boot-time pack-script setup that uses `api.console.log` lands
    // entries in the buffer without ordering hazards.
    this.console = new ConsoleRegistry();
    // Wire DOM-event surfacing on the controllers (EVENTS.md §4.5).
    // Native keydown/up → bus AFTER the controller updates its
    // pressedKeys; pack handlers querying `isKeyPressed` inside an
    // `input:keyDown` handler see the new state.
    deps.keyboard.emitEvent = (topic, payload) => {
      this.events.emit(topic, payload);
    };
    deps.mouse.emitEvent = (topic, payload) => {
      this.events.emit(topic, payload);
    };
    this.input = new InputRegistry(deps.keyboard, deps.mouse);
    this.modals = new ModalsRegistry(deps.modals, this.events);
    this.itemImages = deps.itemImages;
    this.uiRegistry = new UIRegistry(deps.modals);
    this.ui = this.uiRegistry;
    this.settings = new SettingsRegistry(deps.packConfig);
    this.bindings = new BindingsRegistry();
    this.anim = new AnimRegistry(this.world);
    const audioRegistry = new AudioRegistry(deps.pack);
    this.audio = audioRegistry;
    this.procedural = new ProceduralAPIImpl(deps.pack);
    this.recipeStore = new RecipeStore();
    this.proceduralAudio = this.buildProceduralAudio(audioRegistry, deps.pack);
    // Wire the recipe store into the audio registry so `api.audio.play`
    // can resolve recipe ids first (SOUND_LAB.md §6.6).
    audioRegistry.setRecipeStore(this.recipeStore);
    // Wire World's despawn hook to the bus. Fires SYNCHRONOUSLY
    // before component removal so handlers can read the dying
    // entity's components one last time (EVENTS.md §4.2).
    this.world.onDespawn = (entity) => {
      this.events.emit("entity:despawned", { entity });
    };
    // Wire the World's name-resolver so the string-based query path
    // (api.world.query("Position", "Health")) resolves through the
    // shared ComponentRegistry. WORLD_STATE.md §9.
    this.world.resolveComponentName = (name) =>
      this.componentRegistry.getComponent(name);
    // Minimal debug surface — see the field's doc comment for why the
    // renderer / timing fields are stubbed. The closure captures
    // `this.world` so a later `world` reassignment (currently never
    // happens) would be picked up automatically.
    this.debug = {
      stats: (): DebugStatsSnapshot => ({
        fps: 0,
        frameMs: 0,
        drawCalls: 0,
        entityCount: this.world.entityCount(),
      }),
    };
  }

  /**
   * Reconcile pack-registered modal components against the engine's
   * modal-open set. Called by `Game.update` every frame so components
   * see fresh props (live CONFIG, inventory state).
   */
  flushUI(): void {
    this.uiRegistry.flush();
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
    return this.runPrefabAndEmit(name, args);
  }

  /**
   * Shared prefab-invocation path for `spawnPrefab` (engine internals)
   * and `spawn` (pack-facing). Centralises the canonical
   * `entity:spawned` emit (Ev1 §4.2) so both entry points produce
   * exactly one event per spawn. Raw `world.spawn()` from inside a
   * prefab factory does NOT emit a second time — only the outermost
   * prefab call generates the event, per EVENTS.md §12 open Q8.
   *
   * The fast-path `Map.get + size === 0` check in
   * `EventsRegistry.emit` keeps this ~free when nothing's subscribed.
   */
  private runPrefabAndEmit(name: string, args: unknown[]): Entity {
    const entity = this.prefabRegistry.spawn(name, ...args);
    this.events.emit("entity:spawned", { entity, prefabName: name });
    return entity;
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
    return this.runPrefabAndEmit(name, args);
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

  // ─── Data-first surface (WORLD_STATE.md §3 + §9) ─────────────────

  /** Active scene-controller view; updated by `Game.spawnSceneController`. */
  get sceneController(): SceneControllerView | undefined {
    return this.sceneControllerState;
  }

  /**
   * Called by `Game` after spawning the synthetic controller entity.
   * Passing `undefined` clears the view (scene-unload boundary). The
   * view's `components` proxy reads through live `Component.get`
   * lookups so writes via `world.add(controller.id, …)` are visible.
   * WORLD_STATE.md §5.2 + §6.2.
   */
  setSceneController(entity: Entity | undefined): void {
    if (entity === undefined) {
      this.sceneControllerState = undefined;
      return;
    }
    const componentRegistry = this.componentRegistry;
    // Build a Proxy whose get() walks the registry every read so
    // component attaches AFTER setSceneController are visible without
    // re-building the view.
    const componentsProxy = new Proxy(
      {} as Record<string, unknown>,
      {
        get(_target, prop) {
          if (typeof prop !== "string") return undefined;
          const c = componentRegistry.getComponent(prop);
          if (c === undefined) return undefined;
          return c.get(entity);
        },
        has(_target, prop) {
          if (typeof prop !== "string") return false;
          const c = componentRegistry.getComponent(prop);
          if (c === undefined) return false;
          return c.has(entity);
        },
        ownKeys() {
          const keys: string[] = [];
          for (const c of componentRegistry.allComponents()) {
            if (c.has(entity)) keys.push(c.name);
          }
          return keys;
        },
        getOwnPropertyDescriptor(_target, prop) {
          if (typeof prop !== "string") return undefined;
          const c = componentRegistry.getComponent(prop);
          if (c === undefined || !c.has(entity)) return undefined;
          return {
            enumerable: true,
            configurable: true,
            writable: false,
            value: c.get(entity),
          };
        },
      },
    ) as Readonly<Record<string, unknown>>;
    this.sceneControllerState = {
      id: entity,
      components: componentsProxy,
    };
  }

  /**
   * Snapshot every singleton entity id the engine tracks — used by
   * `Game.spawnSceneController` to skip these during scene-unload
   * despawn so per-world state survives swaps. WORLD_STATE.md §5.3.
   */
  getSingletonEntityIds(): ReadonlyArray<Entity> {
    return Array.from(this.singletonEntities.values());
  }

  /**
   * Register manifest-declared components against the shared
   * `ComponentRegistry`. Called by `Game.runPackScripts` before any
   * pack-script setup so component names referenced from scripts /
   * scene controllers / scene entities resolve at boot.
   * WORLD_STATE.md §4 + §10.3.
   */
  registerComponentsFromManifest(
    defs: ReadonlyArray<import("AssetPack").ComponentDef> | undefined,
    packLabel: string,
  ): void {
    const summary = this.componentRegistry.registerFromManifest(defs, packLabel);
    if (summary.created + summary.augmented + summary.conflicted > 0) {
      console.log(
        `[components] ${packLabel}: ${summary.created} new, ` +
          `${summary.augmented} augmented, ${summary.conflicted} conflicted`,
      );
    }
  }

  singleton<T>(componentName: string): T {
    const c = this.componentRegistry.getComponent(componentName);
    if (c === undefined) {
      throw new Error(
        `api.singleton: component "${componentName}" is not registered ` +
          "(declare it in manifest.components[] or call api.defineComponent first).",
      );
    }
    let entity = this.singletonEntities.get(componentName);
    if (entity === undefined || !this.world.has(entity)) {
      entity = this.world.spawn();
      this.singletonEntities.set(componentName, entity);
    }
    if (!c.has(entity)) {
      // Fresh singleton — attach an empty object as the seed value.
      // Pack authors mutate the returned reference; if a pack ships
      // a `world.json` initial value the engine attaches it before
      // any singleton(name) call (WORLD_STATE.md §10.2).
      this.world.add(entity, c as Component<unknown>, {} as unknown);
    }
    return c.get(entity) as T;
  }

  serialize(entityId: Entity): SerializedEntity {
    const out: SerializedEntity = { components: {} };
    if (!this.world.has(entityId)) return out;
    for (const c of this.componentRegistry.allComponents()) {
      if (!c.has(entityId)) continue;
      const raw = c.get(entityId);
      const clean = jsonClone(raw);
      if (clean === SERIALIZE_DROP) {
        if (!this.serialiseWarned.has(c.name)) {
          this.serialiseWarned.add(c.name);
          console.warn(
            `[serialize] component "${c.name}" carries non-JSON data — omitted from serialise output`,
          );
        }
        continue;
      }
      out.components[c.name] = clean;
    }
    return out;
  }

  deserialize(
    json: SerializedEntity,
    opts?: { targetId?: Entity },
  ): Entity {
    const target =
      opts?.targetId !== undefined && this.world.has(opts.targetId)
        ? opts.targetId
        : this.world.spawn();
    for (const [name, value] of Object.entries(json.components ?? {})) {
      const c = this.componentRegistry.getComponent(name);
      if (c === undefined) {
        console.warn(
          `[deserialize] unknown component "${name}" — skipping (entity ${target})`,
        );
        continue;
      }
      this.world.add(target, c as Component<unknown>, value as unknown);
    }
    return target;
  }

  /** Called by `Game.update`. Runs every mod-registered system in order. */
  runFrame(deltaTime: number): void {
    this.systemRegistry.runFrame(this.world, deltaTime);
  }

  /**
   * Run every system registered against `phase` on the
   * `SystemScheduler`. Driven by `Game.update` (`update` /
   * `fixedUpdate`) and `Game.render` (`render`) per WORLD_STATE.md
   * §7.2. Safe to call before any system attaches — `SystemScheduler.run`
   * short-circuits on an empty queue.
   */
  runSchedulerPhase(phase: SystemPhase, deltaTime: number): void {
    this.systemScheduler.run(phase, this.world, deltaTime, this);
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

  /**
   * Build the public `proceduralAudio` surface. Wraps the private
   * `RecipeStore` so pack scripts see only the four-method surface
   * declared on `ProceduralAudioAPI`; the engine reaches the
   * `loadFromPack()` / `dispose()` extras via the concrete shape
   * exposed on `this.proceduralAudio`.
   */
  private buildProceduralAudio(
    audioRegistry: AudioRegistry,
    pack: import("AssetPack").AssetPack,
  ): ProceduralAudioAPI & { loadFromPack(): Promise<void>; dispose(): void } {
    const store = this.recipeStore;
    return {
      load: (id: string) => {
        // Lazy-bootstrap the AudioContext if it hasn't been built yet.
        // OfflineAudioContext rendering uses its own context, but the
        // caller wants the resulting buffer playable through the live
        // context — so spin up the live ctx so its sampleRate is known.
        const ctx = audioRegistry.bootstrapContext();
        return store.loadBuffer(id, ctx);
      },
      playInstrument: (id: string, opts?: ProceduralPlayInstrumentOpts) => {
        const bus = audioRegistry.liveBus(opts?.group ?? "sfx");
        if (!bus) {
          // No live context yet — most likely pre-user-gesture. Pack
          // scripts that need this should call from inside a click /
          // keypress handler.
          return null;
        }
        return store.triggerInstrument(id, bus.ctx, bus.group, opts ?? {});
      },
      has: (id: string) => store.has(id),
      ids: () => store.ids(),
      loadFromPack: () => store.loadFromPack(pack),
      dispose: () => store.dispose(),
    };
  }
}

/**
 * Sentinel returned by `jsonClone` when a value carries non-JSON-clean
 * data (function, Symbol, circular reference). The caller treats it as
 * "drop this component from the serialise output, warn once".
 */
const SERIALIZE_DROP = Symbol("two_5_d/serialize-drop");

/**
 * JSON-clean an arbitrary component value. Vec2 instances render as
 * `{ x, y, z? }`; primitive + array + plain-object values pass through;
 * functions / Symbols / circular references trigger the drop sentinel.
 *
 * WORLD_STATE.md §9 — non-serialisable components emit a one-shot
 * warning + are omitted from the snapshot. Pack authors keeping
 * non-clean state on a component see the warning and can act on it.
 */
function jsonClone(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === "number" || t === "string" || t === "boolean") return value;
  if (t === "function" || t === "symbol") return SERIALIZE_DROP;
  if (t !== "object") return SERIALIZE_DROP;
  const obj = value as object;
  if (seen.has(obj)) return SERIALIZE_DROP;
  seen.add(obj);
  // Vec2 — duck-typed on { x: number, y: number } so this stays
  // independent of the Libs/Vector module's class identity.
  const vec = obj as { x?: unknown; y?: unknown; z?: unknown };
  if (
    typeof vec.x === "number" &&
    typeof vec.y === "number" &&
    Object.keys(obj).length <= 3
  ) {
    return typeof vec.z === "number"
      ? { x: vec.x, y: vec.y, z: vec.z }
      : { x: vec.x, y: vec.y };
  }
  if (Array.isArray(obj)) {
    const out: unknown[] = [];
    for (const item of obj) {
      const cleaned = jsonClone(item, seen);
      if (cleaned === SERIALIZE_DROP) return SERIALIZE_DROP;
      out.push(cleaned);
    }
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const cleaned = jsonClone(v, seen);
    if (cleaned === SERIALIZE_DROP) return SERIALIZE_DROP;
    out[k] = cleaned;
  }
  return out;
}
