/**
 * ModAPI ambient typings for the Monaco editor.
 *
 * Per EDITOR_REDESIGN.md §7.5, pack scripts get IntelliSense + type
 * hints for `api.events.on`, `api.world.spawn`, `api.audio.play`,
 * etc. via `monaco.languages.typescript.javascriptDefaults.addExtraLib`.
 *
 * Why a hand-rolled subset instead of feeding Monaco the engine's
 * actual `.ts` files:
 *
 *   - The engine package's source uses internal bare-name aliases
 *     (`ECS`, `Components`, `AssetPack`) that only resolve under the
 *     editor's tsconfig — Monaco's TS service can't follow them.
 *   - The full engine type-graph is hundreds of files; pack scripts
 *     never see ~95% of those types. Inlining a curated surface keeps
 *     the in-editor IntelliSense focused on what mods actually call.
 *   - The ModAPI shape is stable across phases — when it changes we
 *     update this string in lock-step with `ModAPI/types.ts`. WIRING:
 *     a future codegen step could derive this string from the engine
 *     sources via the `Bundle .d.ts` pipeline; for R4e we hand-author.
 *
 * Conventions:
 *   - Every member documented here mirrors `packages/engine/src/ModAPI/
 *     types.ts`. Keep the doc comments terse — full docs live in the
 *     engine source.
 *   - The declaration is loaded as a `.d.ts` file under the synthetic
 *     path `ts:filename/cardboard.d.ts` so Monaco's TS service treats
 *     it as a global ambient lib. Pack scripts can then write
 *     `const api: ModAPI = ...` or rely on the editor's
 *     `JsxModAPIGlobal` pattern (a stub `declare const api: ModAPI` is
 *     also appended so loose JS files get hover hints without an
 *     explicit annotation).
 */

export const MOD_API_TYPES = `
// ---------------------------------------------------------------
// ModAPI surface, mirrored from packages/engine/src/ModAPI/types.ts.
// Hand-curated; update in lock-step. See modApiTypes.ts header for
// rationale. WIRING: regenerate from engine sources in a future
// pass.
// ---------------------------------------------------------------

declare type KeyCode = string;

declare interface Vec2 {
  x: number;
  y: number;
  add(other: Vec2): Vec2;
  sub(other: Vec2): Vec2;
  scale(k: number): Vec2;
  length(): number;
  normalize(): Vec2;
  dot(other: Vec2): number;
}

declare interface Vec2Constructor {
  new (x: number, y: number): Vec2;
  (x: number, y: number): Vec2;
}

declare type Entity = number;

declare interface Component<T = unknown> {
  readonly name: string;
  readonly __t?: T;
}

declare interface World {
  spawn(): Entity;
  despawn(entity: Entity): void;
  add<T>(entity: Entity, component: Component<T>, value: T): void;
  remove<T>(entity: Entity, component: Component<T>): void;
  get<T>(entity: Entity, component: Component<T>): T | undefined;
  has<T>(entity: Entity, component: Component<T>): boolean;
  each<A>(c1: Component<A>, fn: (e: Entity, a: A) => void): void;
  each<A, B>(c1: Component<A>, c2: Component<B>, fn: (e: Entity, a: A, b: B) => void): void;
  each<A, B, C>(c1: Component<A>, c2: Component<B>, c3: Component<C>, fn: (e: Entity, a: A, b: B, c: C) => void): void;
  /** Iterate every entity carrying all named components. */
  query(...components: Component<unknown>[]): Entity[];
}

declare interface BuiltInComponents {
  Position: Component<Vec2>;
  Facing: Component<{ angle: number }>;
  Movement: Component<{ velocity: Vec2; speed: number }>;
  PlayerInput: Component<unknown>;
  Aim: Component<{ angle: number }>;
  Camera: Component<unknown>;
  MinimapMarker: Component<{ kind: string }>;
  Weapon: Component<{ itemId: string; ammo: number }>;
  Inventory: Component<unknown>;
  Sprite: Component<{ id: string; size?: number }>;
  /** Frame-based sprite animation playback state. Attach alongside
   *  Sprite to drive named-animation playback through api.anim. */
  Animation: Component<{ current: string; frame: number; paused: boolean }>;
  Pickup: Component<{ itemId: string; quantity?: number }>;
  Light: Component<{ color: number; intensity: number; radius: number }>;
  Shader: Component<{ name: string }>;
}

declare type FrameFn = (world: World, deltaTime: number) => void;
declare type PrefabFn = (...args: any[]) => Entity;
declare type RenderPhase = "before-world" | "after-world" | "after-sprites" | "hud";
declare type RendererSystemFn = (renderer: unknown, world: World, deltaTime: number) => void;

declare interface KeyboardInputAPI {
  isKeyPressed(code: KeyCode): boolean;
  isAnyKeyPressed(codes: readonly KeyCode[]): boolean;
}

declare interface MouseInputAPI {
  isButtonPressed(button: number): boolean;
  /** Cumulative motion since last call. Resets after read. */
  consumeMovement(): Vec2;
  /** Signed notch count since last call. Resets after read. */
  consumeWheel(): number;
  readonly position: Vec2;
}

declare interface InputAPI {
  readonly keyboard: KeyboardInputAPI;
  readonly mouse: MouseInputAPI;
  /** Unified bindings helper — accepts keyboard or \`MouseN\` codes. */
  isBindingPressed(codes: readonly KeyCode[]): boolean;
}

declare interface ModalsAPI {
  setOpen(modalId: string, isOpen: boolean): void;
  isOpen(modalId: string): boolean;
  /** \`true\` when any modal is open. */
  any(): boolean;
  /** \`true\` when a modal other than \`modalId\` is open. */
  anyOther(modalId: string): boolean;
}

declare interface UIAPI {
  registerModal<P = unknown>(name: string, component: unknown, props?: () => P): void;
  unregisterModal(name: string): void;
}

declare interface BindingsAPI {
  /** Human-readable label for a binding code. */
  label(code: KeyCode): string;
}

declare interface SettingsAPI {
  load(): Record<string, unknown>;
  save(overlay: Record<string, unknown>): void;
  export(overlay: Record<string, unknown>): void;
  import(): Promise<Record<string, unknown>>;
}

declare interface AnimAPI {
  /** Switch to a named animation. */
  play(entity: Entity, animName: string): void;
  /** Pause playback. Frame state preserved. */
  stop(entity: Entity): void;
  /** Resume playback. */
  resume(entity: Entity): void;
  /** True if the entity is currently playing \`animName\` (or any when omitted). */
  isPlaying(entity: Entity, animName?: string): boolean;
}

declare type SoundGroup = "master" | "sfx" | "music" | "ambient" | "voice";

declare interface PlayOpts {
  /** Multiplied onto SoundDef.volume × groupGain. Default 1.0. */
  volume?: number;
  /** Playback rate. 1.0 = normal. */
  pitch?: number;
  /** Override the SoundDef's group for this single playback. */
  group?: SoundGroup;
  /** Detune in cents (±100 = ±1 semitone). */
  detune?: number;
}

declare interface AudioHandle {
  readonly id: string;
  readonly group: SoundGroup;
  isPlaying(): boolean;
  setVolume(v: number): void;
  setPitch(p: number): void;
  stop(seconds?: number): void;
}

declare interface AudioAPI {
  /** Fire-and-forget. Plays the sound once (or loops if SoundDef.loop). */
  play(id: string, opts?: PlayOpts): AudioHandle;
  /** Force-loop regardless of SoundDef. */
  playLoop(id: string, opts?: PlayOpts): AudioHandle;
  /** Cancel-and-replay: stop any prior playback of \`id\`, then start fresh. */
  playReplace(id: string, opts?: PlayOpts): AudioHandle;
  stop(handle: AudioHandle): void;
  /** Stop everything in one group (or globally). */
  stopAll(group?: SoundGroup): void;
  isReady(): boolean;
  readonly groupVolume: {
    get(group: SoundGroup): number;
    set(group: SoundGroup, v: number): void;
  };
}

declare interface EventSubscription {
  readonly name: string;
  /** Remove this subscription. Idempotent. */
  off(): void;
}

declare interface EventsAPI {
  /** Subscribe to \`name\`. Returns a handle whose .off() removes it. */
  on<T = unknown>(name: string, handler: (payload: T) => void): EventSubscription;
  /** Subscribe for a single fire. */
  once<T = unknown>(name: string, handler: (payload: T) => void): EventSubscription;
  off(name: string, handler: (payload: unknown) => void): void;
  off(subscription: EventSubscription): void;
  /** Fire \`name\` with \`payload\`. */
  emit<T = unknown>(name: string, payload?: T): void;
}

declare interface InventoryAPI {
  readonly BAG_SIZE: number;
  readonly HOTBAR_SIZE: number;
  readonly EQUIP_SLOTS: ReadonlyArray<string>;
  emptyEquipment(): Record<string, unknown>;
  seedInventory(manifest: unknown): unknown;
  addItem(inv: unknown, itemId: string, qty?: number): boolean;
  removeItem(inv: unknown, itemId: string, qty?: number): boolean;
  countItem(inv: unknown, itemId: string): number;
  getActiveItem(inv: unknown): { itemId: string; quantity: number } | null;
  defaultStackMax(itemDef: unknown): number;
  quickTransfer(inv: unknown, slot: string): void;
}

declare interface RaycastAPI {
  castRayToWall(scene: unknown, origin: Vec2, angle: number): {
    distance: number;
    cellX: number;
    cellY: number;
  } | null;
}

/**
 * Debug helpers (api.debug). WIRING: not yet present in
 * \`packages/engine/src/ModAPI/types.ts\`; surfaced here for parity with
 * the docs/plans/EDITOR_REDESIGN.md §7.5 spec. Adding the real
 * implementation is a follow-up engine task — until then these
 * IntelliSense entries describe the eventual shape.
 */
declare interface DebugAPI {
  /** Per-frame performance + render stats. */
  stats(): {
    fps: number;
    drawCalls: number;
    entityCount: number;
    frameMs: number;
  };
  /** Engine + pack version triple. */
  version(): { engine: string; pack: string; runtime: string };
  /** Log to the engine's in-game console (visible in Playtest). */
  log(...args: unknown[]): void;
}

declare interface ModAPI {
  readonly world: World;
  readonly scene: unknown;
  readonly config: unknown;
  readonly pack: unknown;
  readonly components: BuiltInComponents;
  readonly inventory: InventoryAPI;
  readonly raycast: RaycastAPI;
  readonly itemImages: unknown;
  readonly input: InputAPI;
  readonly modals: ModalsAPI;
  readonly ui: UIAPI;
  readonly settings: SettingsAPI;
  readonly bindings: BindingsAPI;
  readonly anim: AnimAPI;
  readonly audio: AudioAPI;
  readonly events: EventsAPI;
  readonly debug: DebugAPI;
  readonly Vec2: Vec2Constructor;
  readonly Component: unknown;

  /** Create a new component, registered by name. */
  defineComponent<T = unknown>(name: string): Component<T>;
  /** Look up a previously defined component. */
  getComponent(name: string): Component<unknown> | undefined;
  /** Register a per-frame system. */
  registerSystem(fn: FrameFn): () => void;
  /** Register a named prefab factory. */
  registerPrefab(name: string, factory: PrefabFn): void;
  /** Invoke a named prefab. */
  spawn(name: string, ...args: unknown[]): Entity;
  /** Register a callback after the initial scene spawn. */
  onWorldReady(fn: (api: ModAPI) => void): void;
  /** Attach a renderer system to a render phase. */
  registerRendererSystem(fn: RendererSystemFn, phase: RenderPhase): () => void;
}

/**
 * Pack scripts are invoked with one argument — \`api: ModAPI\`. Declaring
 * it as a global gives loose JS files hover hints without an explicit
 * annotation.
 *
 *   // file: scripts/hello.js
 *   export default (api) => {
 *     api.events.on("scene:loaded", () => api.debug.log("hi"));
 *   };
 */
declare const api: ModAPI;
`;

/** The synthetic .d.ts filename Monaco uses to reference the lib. */
export const MOD_API_TYPES_PATH = "ts:filename/cardboard.d.ts";
