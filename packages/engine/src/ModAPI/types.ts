import { Component, type Entity, type World } from "ECS";
import type { Scene } from "Scene";
import type { GameConfig } from "GameConfig";
import type { AssetPack } from "AssetPack";
import { Vec2 } from "Libs/Vector";
import type { KeyCode } from "Controllers/KeyboardController";
import type { SceneRenderer } from "Renderers";
import type { ComponentType } from "preact";
import type { PartialGameConfig } from "Settings";
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
import { EQUIP_SLOTS, type SoundGroup } from "AssetPack";
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

/**
 * Modal-screen mount surface. Pack scripts register a Preact component
 * by name; the engine renders it into a top-level mount whenever
 * `api.modals.isOpen(name)` is true. The optional `props()` callback
 * is invoked on every render so components can see fresh live state
 * (current CONFIG, current inventory) without the pack having to wire
 * its own re-render loop.
 *
 * Pack-side `.tsx` scripts go through the pack-builder's TSX pipeline
 * — `import { h } from "preact"` resolves at runtime to the engine's
 * own Preact instance (see `apps/pack-builder/src/build-packs.ts`),
 * so the engine's mount and the pack's components share one renderer.
 */
export interface UIAPI {
  registerModal<P>(
    name: string,
    component: ComponentType<P>,
    props?: () => P,
  ): void;
  unregisterModal(name: string): void;
  /**
   * `true` if a component is currently registered for `name`. Used by
   * the engine's default-modal auto-registration to detect whether a
   * pack already claimed the slot (override-by-re-registering pattern).
   */
  has(name: string): boolean;
}

/**
 * Settings persistence surface. Wraps `Settings.ts` for pack-side
 * settings UIs that need to round-trip the user's saved overlay to a
 * file (export/import JSON) and re-apply changes to the live CONFIG.
 *
 * Pack scripts shouldn't reach into engine-internal `Settings.ts`
 * directly because pack code only sees the ModAPI — the engine
 * re-exposes the four functions the settings modal actually needs.
 */
export interface SettingsAPI {
  /** Last-known user overlay (the persisted delta from baseline + pack). */
  load(): PartialGameConfig;
  /** Persist a new overlay AND re-apply it to live CONFIG (pack layer included). */
  save(overlay: PartialGameConfig): void;
  /** Trigger a JSON download of the supplied overlay. */
  export(overlay: PartialGameConfig): void;
  /** Pop a file picker; resolves with the parsed overlay. */
  import(): Promise<PartialGameConfig>;
}

/**
 * Bindings helpers. Just `label` today — wraps the engine's
 * `bindingLabel` so the settings UI can show "Mouse L" instead of
 * "Mouse0" without pulling in `Controllers/Bindings`.
 */
export interface BindingsAPI {
  /** Human-readable label for a binding code (`"KeyW"` → `"KeyW"`, `"Mouse0"` → `"Mouse L"`). */
  label(code: KeyCode): string;
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
  /**
   * Frame-based sprite animation playback state (A1 of
   * `docs/plans/ANIMATIONS.md`). Attach alongside `Sprite` to drive
   * named-animation playback through `api.anim`. Entities without an
   * `Animation` component render frame 0 of angle 0 (= pre-A1
   * single-image path).
   */
  Animation: typeof Animation;
  Pickup: typeof Pickup;
  Light: typeof Light;
  /**
   * Per-entity shader-hook attachment (M1 of MATERIALS.md). Attach a
   * `Shader` component to ride pack-supplied `.glsl` hook overrides
   * for just this entity. Sprites only in M1.
   */
  Shader: typeof Shader;
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
  /** Ordered list of equipment slot ids (helmet, chest, ...). */
  readonly EQUIP_SLOTS: typeof EQUIP_SLOTS;
  readonly emptyEquipment: typeof emptyEquipment;
  readonly seedInventory: typeof seedInventory;
  readonly addItem: typeof addItem;
  readonly removeItem: typeof removeItem;
  readonly countItem: typeof countItem;
  readonly getActiveItem: typeof getActiveItem;
  /** Maximum stack size for an item def (from `stackMax` or type default). */
  readonly defaultStackMax: typeof defaultStackMax;
  /** Shift-click flow — moves a stack between bag/hotbar/equipment. */
  readonly quickTransfer: typeof quickTransfer;
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
 * Sprite-animation control surface — A1 of `docs/plans/ANIMATIONS.md`.
 *
 * All helpers operate on the entity's `Animation` component (added by
 * the pack when the entity is spawned, or lazily by `play` itself).
 * Calls are write-now-read-on-next-tick: the changes land before the
 * next `AnimationSystem.update` so the next frame renders the right
 * cell.
 *
 * `onComplete` is A2 work — it rides `api.events` (MULTIPLAYER M1)
 * once that surface lands. Not exposed in A1.
 */
export interface AnimAPI {
  /**
   * Switch to a named animation. Resets `frame` + `elapsed` to 0,
   * unpauses, and (for entities without an `Animation` component) adds
   * one so callers can author `Sprite`-first prefabs and start playback
   * later. No-op if the entity already plays `animName` and isn't paused.
   */
  play(entity: Entity, animName: string): void;
  /** Pause playback. Frame state preserved. No-op if no Animation. */
  stop(entity: Entity): void;
  /** Resume playback. No-op if no Animation. */
  resume(entity: Entity): void;
  /**
   * `true` if the entity has an `Animation` component, isn't paused,
   * AND (when `animName` is given) `current === animName`.
   */
  isPlaying(entity: Entity, animName?: string): boolean;
}

/**
 * Shared item-image cache, exposed on `api.itemImages`. Pack-side HUD
 * systems (gun viewmodel, inventory bar) blit these decoded images
 * into the canvas — keeping the cache engine-owned means every system
 * reads from the same `HTMLImageElement` instances and the textures
 * decode once at boot.
 */
export type ItemImagesAPI = ItemImages;

// ─── Events (Ev1 of docs/plans/EVENTS.md) ────────────────────────────

/**
 * Handle returned by `EventsAPI.on` / `once`. Idempotent `.off()` —
 * calling twice is a no-op. Most pack scripts won't stash the handle;
 * auto-cleanup on pack-script HMR (§6 of EVENTS.md) covers the common
 * case where a script subscribes once at load-time.
 */
export interface EventSubscription {
  readonly name: string;
  /** Remove this subscription. Idempotent — safe to call multiple times. */
  off(): void;
}

/**
 * Pub/sub event bus — Ev1 of `docs/plans/EVENTS.md`. Synchronous
 * dispatch: `emit` runs every subscribed handler in registration order
 * before returning. Handlers that throw are logged + skipped; later
 * handlers still run. `emit` returns `void` — request/response patterns
 * use a correlation-id on top of two events (see §1 non-goals).
 *
 * Topics use `:` as a namespace separator (`scene:loaded`,
 * `inventory:added`). Canonical engine events ship in
 * `canonical-events.ts`; pack scripts emit their own free-form topics,
 * conventionally prefixed with the pack id (`acme_rpg:level_up`).
 *
 * Subscriptions registered inside a pack script auto-cleanup when that
 * pack script reloads via HMR. The pack-script context is tracked by
 * `ModAPIImpl.setActiveScript`, called around each script's run.
 * Subscriptions registered outside any pack script (engine internals)
 * are not auto-cleaned and live until `Game.destroy()`.
 *
 * Wildcards (`name:*`, `*`) are Ev2 — not exposed in this surface yet.
 */
export interface EventsAPI {
  /** Subscribe to `name`. Returns a handle whose `.off()` removes the subscription. */
  on<T = unknown>(
    name: string,
    handler: (payload: T) => void,
  ): EventSubscription;
  /**
   * Subscribe for a single fire. Auto-removes BEFORE invoking the
   * handler — so a `once` handler that re-emits the same topic doesn't
   * re-trigger itself.
   */
  once<T = unknown>(
    name: string,
    handler: (payload: T) => void,
  ): EventSubscription;
  /**
   * Remove a subscription. Two forms — pass the subscription handle
   * (canonical, `O(1)` path) OR the original `(name, handler)` pair
   * (DOM-ish parity; `O(handlers on topic)`, exact-ref match).
   */
  off(name: string, handler: (payload: unknown) => void): void;
  off(subscription: EventSubscription): void;
  /**
   * Fire `name` with `payload`. Every subscribed handler runs
   * synchronously in registration order before `emit` returns. Handler
   * throws are logged + skipped. Returns `void` — emit is fire-and-
   * forget.
   *
   * Cost when nothing's subscribed: a single `Map.get` returning
   * `undefined` plus a size check, ~5 ns. Hot-path call sites
   * (`frame:before`, `frame:after`) lean on this fast path.
   */
  emit<T = unknown>(name: string, payload?: T): void;
}

/**
 * Per-play tuning passed to `api.audio.play` / `playLoop` /
 * `playReplace`. Each field stacks on top of the SoundDef's defaults
 * (volume × `SoundDef.volume`, etc.). See `docs/plans/AUDIO.md` §4.1.
 */
export interface PlayOpts {
  /** Multiplied onto `SoundDef.volume × groupGain`. Default 1.0. */
  volume?: number;
  /** Playback rate. 1.0 = normal, 0.5 = octave down, 2.0 = octave up. */
  pitch?: number;
  /** Override the SoundDef's group for this single playback. */
  group?: SoundGroup;
  /**
   * Detune in cents (±100 = ±1 semitone). Stacks with `pitch`. Useful
   * for "play the same footstep N× without sounding mechanical" —
   * randomize ±50 cents.
   */
  detune?: number;
}

/**
 * Live handle returned by every `play*` call. Cheap proxy (~80 bytes);
 * once the underlying source ends (or `.stop()` is called) the handle
 * becomes inert — `.setVolume` / `.setPitch` / etc. silently no-op
 * and `.isPlaying()` returns `false`. See AUDIO.md §4.3.
 */
export interface AudioHandle {
  /** The sound id this handle was created for. */
  readonly id: string;
  /** Which group's gain node this handle routes through. */
  readonly group: SoundGroup;
  /** `true` until the BufferSource has finished or been stopped. */
  isPlaying(): boolean;
  /** Re-set the per-handle gain (0..1). Live, no fade. */
  setVolume(v: number): void;
  /** Re-set playback rate. */
  setPitch(p: number): void;
  /** Fade out over `seconds`, then stop. Default 0 = hard stop. */
  stop(seconds?: number): void;
}

/**
 * Per-voice options forwarded to `api.proceduralAudio.playInstrument`.
 * Mirrors `PlayInstrumentOpts` from the engine's procedural-audio
 * module (re-declared here so the ModAPI surface doesn't drag
 * `ProceduralAudio` types into pack-side `.d.ts` consumers).
 *
 * Sound Lab SL2 of `docs/plans/SOUND_LAB.md` §3.5.
 */
export interface ProceduralPlayInstrumentOpts {
  /** Note frequency in Hz — drives oscillators tagged `voiceNote: true`. */
  frequency?: number;
  /** Gate length in seconds. Voices auto-release after the gate. */
  gateMs?: number;
  /** Velocity 0..1 — scales the output gain. Default 1. */
  velocity?: number;
  /** Group override. Defaults to recipe.group or `"sfx"`. */
  group?: SoundGroup;
  /** Volume multiplier. Default 1. */
  volume?: number;
}

/**
 * Procedural-audio surface — SL2 of `docs/plans/SOUND_LAB.md`. Sound
 * recipes (JSON files at `recipes/*.sound.json`) compile to Web Audio
 * node graphs at pack-load time. Three modes: `static` + `loop`
 * render once to an `AudioBuffer` (cached in IDB); `instrument`
 * instantiates per-voice live.
 *
 * Static + loop recipes also resolve through the existing
 * `api.audio.play(id)` path — the registry checks the recipe store
 * first, then `manifest.sounds` (per §6.6 + §12 Q11 RESOLVED:
 * shared namespace). This `proceduralAudio` surface gives pack scripts
 * direct access to the underlying recipe machinery for advanced use
 * — most pack scripts can stick with `api.audio.play(...)`.
 */
export interface ProceduralAudioAPI {
  /**
   * Load (render or cache-hit) the rendered `AudioBuffer` for a
   * static/loop recipe. Returns `null` for unknown ids or
   * instrument-mode recipes (which have no bake).
   */
  load(recipeId: string): Promise<AudioBuffer | null>;
  /**
   * Instantiate a per-voice instrument-mode recipe. Returns `null`
   * for unknown ids, non-instrument recipes, or when the AudioContext
   * isn't ready (pre-user-gesture). The handle's `dispose()` stops
   * the voice; the engine's voice-pool also auto-cleans after the
   * gate + release tail completes.
   */
  playInstrument(
    recipeId: string,
    opts?: ProceduralPlayInstrumentOpts,
  ): { dispose(): void } | null;
  /** `true` when a recipe with this id is registered. */
  has(recipeId: string): boolean;
  /** Currently-registered recipe ids. */
  ids(): readonly string[];
}

/**
 * Audio playback surface — Au1 of `docs/plans/AUDIO.md`. Pack scripts
 * call `api.audio.play("gunshot")` and get back a handle they can stop
 * or retune. The engine owns the `AudioContext`, the per-group gain
 * graph, and the live-volume settings binding so pack scripts don't
 * reach for raw Web Audio primitives. See AUDIO.md §4.1 + §5.
 *
 * The context is lazily bootstrapped on the first `play*` call — a
 * pack that never plays a sound never touches Web Audio at all, and
 * an `AudioContext` is never instantiated. Au2+ adds spatial audio
 * (`playPositional`) and music crossfade (`crossfadeMusic`); those
 * methods are intentionally NOT part of the Au1 surface.
 */
export interface AudioAPI {
  /**
   * Fire-and-forget. Plays the sound once (or loops, if the SoundDef
   * has `loop: true`). Returns a handle the caller can use to stop it
   * mid-play.
   */
  play(id: string, opts?: PlayOpts): AudioHandle;

  /**
   * Force-loop the sound regardless of its SoundDef. Returns a handle
   * whose `.stop()` is the only way to end it.
   */
  playLoop(id: string, opts?: PlayOpts): AudioHandle;

  /**
   * Cancel-and-replay variant of `play`. If the same id is already
   * playing, stop it first, then start fresh. Useful for UI
   * confirmations where overlapping playback sounds bad.
   */
  playReplace(id: string, opts?: PlayOpts): AudioHandle;

  /** Stop a single handle. No-op if already stopped. */
  stop(handle: AudioHandle): void;

  /**
   * Stop every active handle, optionally restricted to one group.
   * `stopAll()` with no arg stops everything.
   */
  stopAll(group?: SoundGroup): void;

  /** Returns `true` if the AudioContext is running. Diagnostic. */
  isReady(): boolean;

  /**
   * Live per-group volume read/write. `set(group, v)` is what the
   * Settings slider calls; equivalent to writing to the corresponding
   * `GameConfig.audio.<group>Volume` and saving.
   */
  readonly groupVolume: {
    get(group: SoundGroup): number;
    set(group: SoundGroup, v: number): void;
  };
}

/**
 * Engine telemetry surface — Q5 of `docs/plans/EDITOR_REDESIGN.md` §12.
 *
 * Pack scripts and the iframe bridge (EDITOR_IFRAME.md I2) read
 * `api.debug.stats()` for the per-frame perf snapshot. The current
 * implementation is a minimal pass-through that reads the live
 * `World` + `Scene`; renderer / audio counters report 0 until the
 * full `StatsCollector` wiring lands (see `Debug/stats.ts`).
 */
export interface DebugStatsSnapshot {
  readonly fps: number;
  readonly frameMs: number;
  readonly drawCalls: number;
  readonly entityCount: number;
}

export interface DebugAPI {
  /** Snapshot of recent frame timing + counters. Safe to call any time. */
  stats(): DebugStatsSnapshot;
}

/**
 * Output of `api.serialize(entityId)` — WORLD_STATE.md §9. The shape
 * matches `scene.entities[]` records so a serialised entity round-trips
 * through `api.deserialize` byte-for-byte (modulo `_*` opaque metadata
 * which carries forward verbatim).
 */
export interface SerializedEntity {
  /** Optional name — round-trips with the entity. */
  name?: string;
  /** componentName → componentData (JSON-clean). */
  components: Record<string, unknown>;
  /** Editor-only metadata (`_prefabSource`, `_persistent`, …). Opaque round-trip. */
  [editorOnly: `_${string}`]: unknown;
}

/**
 * View onto the synthetic scene-controller entity — WORLD_STATE.md
 * §5.2 + §6.2. Pack scripts read this to access per-scene state
 * (`SpawnerList`, `Music`, `Victory`, …). The controller entity is
 * spawned on every scene load and despawned on scene unload — the
 * id is stable only within a single scene.
 */
export interface SceneControllerView {
  /** Live entity id of the synthetic controller. */
  readonly id: Entity;
  /**
   * Live read-through map of components attached to the controller
   * entity, keyed by component name.
   */
  readonly components: Readonly<Record<string, unknown>>;
}

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
  /**
   * Pack-mounted modal screens (Preact). Pack scripts register a
   * component by name; the engine renders it when its modal name is
   * open. See `UIAPI`.
   */
  readonly ui: UIAPI;
  /**
   * Settings persistence + import/export for pack-side settings UIs.
   * Mirrors the four functions in the engine's `Settings.ts`.
   */
  readonly settings: SettingsAPI;
  /** Bindings label resolver — wraps `Controllers/Bindings#bindingLabel`. */
  readonly bindings: BindingsAPI;
  /**
   * Sprite-animation control surface. See `AnimAPI`. A1 of
   * `docs/plans/ANIMATIONS.md`.
   */
  readonly anim: AnimAPI;
  /**
   * Audio playback surface — sfx, music, ambient, voice. See
   * `AudioAPI`. Pack scripts should NOT instantiate their own
   * `AudioContext`; use these calls so the engine owns mixing,
   * grouping, and (post-Au1) modal ducking. Au1 of
   * `docs/plans/AUDIO.md`.
   */
  readonly audio: AudioAPI;
  /**
   * Pub/sub event bus — see `EventsAPI`. Engine fires canonical
   * lifecycle events (`scene:loaded`, `entity:spawned`,
   * `modal:opened`, `frame:before`, …); pack scripts subscribe by
   * name and emit their own custom topics. Ev1 of
   * `docs/plans/EVENTS.md`.
   */
  readonly events: EventsAPI;
  /**
   * Engine telemetry — `stats()` for the editor iframe bridge and
   * in-game dev console. See `DebugAPI`.
   */
  readonly debug: DebugAPI;
  /**
   * Developer-console recording surface — `docs/plans/CONSOLE.md` MVP.
   * Buffers `log` / `info` / `warn` / `error` calls + lets the editor's
   * live log panel subscribe for streaming entries. Future phases
   * (C1–C4) widen this with command registration, parsing, policy
   * gating, etc.; the recording methods declared here stay stable.
   */
  readonly console: import("./ConsoleAPI").ConsoleAPI;
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

  // ─── Data-first surface (WORLD_STATE.md §3 + §9) ─────────────────

  /**
   * View onto the synthetic scene-controller entity (WORLD_STATE.md
   * §5.2). `undefined` while no scene is loaded; populated by the
   * engine at every `scene:loaded` boundary. Pack scripts read it for
   * per-scene state (`SpawnerList`, `Music`, …) attached via the
   * scene's `controller.components` block.
   */
  readonly sceneController: SceneControllerView | undefined;

  /**
   * Get-or-create the world-singleton entity that carries
   * `componentName`. The engine maintains exactly one entity per name
   * across the whole session (survives scene swaps). Returns the live
   * component-data reference — mutations persist. See WORLD_STATE.md
   * §5.3.
   *
   * The component must be registered (built-in, manifest-declared, or
   * `api.defineComponent`) before calling. Throws otherwise.
   */
  singleton<T>(componentName: string): T;

  /**
   * Snapshot one entity into a JSON-clean `SerializedEntity`. Walks
   * every registered component and includes the ones the entity has.
   * Round-trips through `deserialize`. WORLD_STATE.md §9.
   */
  serialize(entityId: Entity): SerializedEntity;

  /**
   * Reconstruct an entity from a `SerializedEntity` snapshot. Default
   * spawns a fresh entity; pass `opts.targetId` to write the snapshot
   * onto an existing entity (used by multiplayer delta replication —
   * MULTIPLAYER.md M1). Returns the resulting entity id.
   */
  deserialize(
    json: SerializedEntity,
    opts?: { targetId?: Entity },
  ): Entity;
}
