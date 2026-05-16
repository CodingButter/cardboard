import { CANVAS_SIZE } from "Config";
import Engine from "Engine";
import { Scene } from "Scene";
import { World } from "ECS";
import { KeyboardController, MouseController } from "Controllers";
import {
  TwoDRenderer,
  WebGLRenderer,
  type SceneRenderer,
  collectSpriteVariants,
  collectWorldVariants,
  collectSceneShaderLayer,
} from "Renderers";
import {
  AnimationSystem,
  LightCollectionSystem,
  SpriteRenderSystem,
} from "Systems";
import ModalRegistry from "ModalRegistry";
import type { PartialGameConfig } from "Settings";
import { Aim, Camera, Facing, Movement, PlayerInput, Position } from "Components";
import { Vec2 } from "Libs/Vector";
import { CONFIG } from "GameConfig";
import type { AssetPack, ShaderRole } from "AssetPack";
import {
  registerDeclarativePrefabs,
  registerDeclarativePrefabsAsync,
} from "AssetPack/registerDeclarativePrefabs";
import { ModAPIImpl, PLAYER_MOVED_FRAME_THROTTLE } from "ModAPI";
import ItemImages from "ItemImages";
import { installPreactRuntime } from "PreactRuntime";

/**
 * Long-lived state preserved across HMR reloads. Re-using the `World`
 * across reloads keeps every entity (and so the player's position, facing,
 * etc.) where it was; re-using `keyboard`/`mouse` keeps DOM listeners bound
 * to the same instances rather than stacking up.
 */
export interface GameState {
  world: World;
  keyboard: KeyboardController;
  mouse: MouseController;
}

/**
 * Wires the engine, world, input devices, and systems together.
 *
 * The render flow is now thin: query the camera entity, hand its pose to
 * the `SceneRenderer`, then let the HUD systems paint on top of
 * `renderer.ctx`. The renderer owns the world pass (walls/floor/ceiling)
 * end-to-end, so swapping backends (e.g. CPU → WebGL) is a one-line
 * change to the `renderer` field's concrete type.
 */
export class Game {
  readonly engine: Engine;
  /**
   * Currently-active scene. Mutable so `loadScene` / `reloadScene`
   * can swap to a fresh scene without re-constructing `Game`. Every
   * per-frame consumer reads through `this.scene` so the swap
   * propagates on the next render tick.
   */
  scene: Scene;
  readonly world: World;
  readonly keyboard: KeyboardController;
  readonly mouse: MouseController;
  readonly renderer: SceneRenderer;

  readonly spriteRender: SpriteRenderSystem;
  readonly lightCollection: LightCollectionSystem;
  /**
   * Animation advance system — A1 of `docs/plans/ANIMATIONS.md`. Runs
   * every update tick (before render) to drain elapsed time on every
   * `Animation` component and advance the active frame. The render
   * pass then reads stable frame state to compute the atlas UV region.
   * Pack-agnostic at construction; wired with `pack` directly below so
   * the system can look up `manifest.sprites[<id>].animations`.
   */
  readonly animationSystem: AnimationSystem;
  readonly modals: ModalRegistry;
  readonly itemImages: ItemImages;
  readonly api: ModAPIImpl;
  readonly pack: AssetPack;
  /**
   * Ordered pack chain (deps-first → root-last) — M4 of
   * `docs/plans/MATERIALS.md` §10. `pack` is the chain's last entry
   * (root); earlier entries are transitive dependencies whose
   * `manifest.shaders` files cascade into the assembled shader
   * programs. Stored on Game so post-load passes (variant rebuild,
   * post-pass compile) can reach the full cascade without re-
   * threading the chain through every call site.
   *
   * Defaults to `[pack]` for single-pack callers — length-1 chains
   * short-circuit the cascade machinery so behaviour is byte-
   * identical to pre-M4.
   */
  readonly chain: ReadonlyArray<AssetPack>;

  private readonly canvas: HTMLCanvasElement;
  /**
   * `true` when this `Game` instantiated a brand-new `World` (no HMR
   * snapshot was handed back in). `spawnInitialEntities()` reads it to
   * decide whether to spawn the player — across HMR reloads the player
   * entity already exists in the preserved world and re-spawning would
   * duplicate it.
   */
  private readonly freshWorld: boolean;

  /**
   * Monotonic frame counter — incremented at the top of `update`.
   * Threaded into `frame:before` / `frame:after` payloads (EVENTS.md
   * §4.7) so subscribers can detect frame deltas / build their own
   * throttles. Also gates `player:moved` (every Nth frame, §4.3).
   */
  private frameIndex = 0;

  /**
   * Path of the currently-loaded scene — threaded into the
   * `scene:loaded` / `scene:beforeLoad` / `scene:beforeUnload` event
   * payloads (EVENTS.md §4.1). Initialised on first spawn (boot scene
   * is `pack.manifest.startScene` or the `?scene=` override); updated
   * by `loadScene` + `reloadScene`.
   */
  private currentScenePath: string = "";

  /**
   * Per-player tracking for the throttled `player:moved` event.
   * Stores last-emitted cell + frame index per entity so we can emit
   * on cell-boundary cross OR every Nth frame, whichever first
   * (EVENTS.md §4.3). Entity-keyed so multi-player setups (future)
   * track each independently.
   */
  private readonly playerMoveTrack: Map<
    number,
    { cellX: number; cellY: number; lastFrame: number }
  > = new Map();

  constructor(
    canvas: HTMLCanvasElement,
    pack: AssetPack,
    scene: Scene,
    previous?: Partial<GameState>,
    packConfig: PartialGameConfig = {},
    /**
     * Pre-resolved per-role fragment shaders, produced by
     * `WebGLRenderer.prefetchShaderSources(pack)` or
     * `WebGLRenderer.prefetchShaderSourcesFromChain(chain)` (M4).
     * Forwarded to the WebGL renderer; the canvas2d renderer ignores
     * it (pack shaders are a WebGL-only feature —
     * `ENGINE_PACK_SHADERS.md` § 2).
     */
    shaderSources?: Partial<Record<ShaderRole, string>>,
    /**
     * Optional ordered pack chain (deps-first → root-last) — M4 of
     * `docs/plans/MATERIALS.md` §10. When omitted, defaults to
     * `[pack]` so single-pack callers see no behaviour change.
     * Multi-pack chains feed the renderer's hook / Mode 1 / post-pass
     * cascades.
     */
    chain?: ReadonlyArray<AssetPack>,
  ) {
    this.pack = pack;
    this.chain = chain && chain.length > 0 ? chain : [pack];
    this.canvas = canvas;
    // Canvas fills its parent container — game runner's body is sized
    // to viewport via apps/game CSS, editor viewport pane is bounded.
    // The buffer matches the host via fitCanvasToWindow on every
    // resize event + ResizeObserver tick.
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.display = "block";
    this.fitCanvasToWindow();
    window.addEventListener("resize", this.fitCanvasToWindow);
    // ResizeObserver picks up host-pane resizes (editor viewport
    // changing size, container reflow) that don't fire window resize.
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.fitCanvasToWindow);
      const parent = this.canvas.parentElement;
      if (parent) this.resizeObserver.observe(parent);
    }
    // Canvas click → pointer lock. Fullscreen is opt-in via the
    // settings menu — auto-fullscreening on click felt aggressive and
    // didn't reliably suppress Ctrl+W in all browsers anyway.
    this.canvas.onclick = () => {
      this.canvas.requestPointerLock();
    };

    // Pick the renderer backend at startup based on config. Switching
    // afterwards requires a page reload (a canvas can only have one
    // context type). The pack drives texture loading.
    const rendererProps = { canvas, pack, width: CANVAS_SIZE.x, height: CANVAS_SIZE.y };
    this.renderer =
      CONFIG.rendering.backend === "webgl"
        ? new WebGLRenderer({ ...rendererProps, shaderSources, chain: this.chain })
        : new TwoDRenderer(rendererProps);
    // Now that the renderer is ready, size the pixel buffer to the
    // actual window (was a no-op on the earlier `fitCanvasToWindow`
    // call because the renderer didn't exist yet).
    this.fitCanvasToWindow();

    // Reuse devices and the world across HMR reloads. On the first ever
    // load, build a fresh world; the player (and any other content
    // entities) is spawned from a pack-registered prefab via
    // `spawnInitialEntities()`, which `main()` calls AFTER
    // `runPackScripts()` has had a chance to register prefabs.
    this.keyboard = previous?.keyboard ?? new KeyboardController();
    this.mouse = previous?.mouse ?? new MouseController(canvas);
    this.freshWorld = previous?.world === undefined;
    this.world = previous?.world ?? new World();

    this.scene = scene;
    // Engine-side systems still in the engine after R4: sprite + light
    // collection are renderer bridges (not gameplay). The two modal
    // screens (inventory + settings) moved to the default-pack in R4
    // and now mount via `api.ui.registerModal`. The 7 pack-migrated
    // systems from R3 (player-input, gun-render, pickup, minimap,
    // reticle, stats, inventory-bar) are loaded by `runPackScripts`.
    this.itemImages = new ItemImages(pack);
    this.spriteRender = new SpriteRenderSystem();
    this.lightCollection = new LightCollectionSystem();
    // A1 of ANIMATIONS.md — engine-side AnimationSystem runs
    // unconditionally. Wired with `pack` so it can look up sprite
    // animation definitions; the SpriteRenderSystem reuses the same
    // pack reference for atlas UV-region resolution.
    this.animationSystem = new AnimationSystem();
    this.animationSystem.pack = pack;
    this.spriteRender.pack = pack;
    this.modals = new ModalRegistry();

    // Pack-side `.tsx` scripts (e.g. modal screens) import `"preact"`
    // and `"preact/hooks"`; the pack-builder bundled those imports
    // against virtual modules that read from `globalThis` slots.
    // Install the engine's Preact instance into those slots before
    // pack scripts execute so the imports resolve.
    installPreactRuntime();

    // Modding surface — handed to every pack script via `runPackScripts`.
    // We wire keyboard / mouse / modals references in so pack-side
    // systems can read input + coordinate modals through the API in R3
    // without reaching for the controllers directly. `itemImages` is
    // shared so pack HUD systems blit from the same decoded `<img>` set
    // the engine uses (one decode per asset, not per system).
    this.api = new ModAPIImpl({
      world: this.world,
      scene: this.scene,
      pack,
      keyboard: this.keyboard,
      mouse: this.mouse,
      modals: this.modals,
      itemImages: this.itemImages,
      packConfig,
    });

    this.engine = new Engine();
    this.engine.onUpdate(this.update);
    this.engine.onRender(this.render);

    // Esc-during-pointer-lock is eaten by the browser, but it still
    // fires a `pointerlockchange`. When the lock is lost and no modal
    // owns the screen, open settings — so one Esc press feels like
    // "release + open" instead of two presses.
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
  }

  private readonly onPointerLockChange = (): void => {
    // Esc-during-pointer-lock is swallowed by the browser, but it
    // still triggers `pointerlockchange`. Flip the "settings" modal
    // open via the registry so the pack-side `SettingsScreenSystem`
    // reacts on the next frame just as it would on a normal Esc edge.
    // The engine never reads the modal's contents — only that it's
    // open — so this stays content-agnostic.
    if (document.pointerLockElement === null && !this.modals.any()) {
      this.modals.setOpen("settings", true);
    }
  };

  /**
   * Load and execute every script listed in the pack's manifest. Each
   * script gets a Blob URL and is dynamic-imported as an ES module; its
   * default export (or `setup` named export) is called with the
   * `ModAPI`.
   *
   * Run after the game is fully constructed, so scripts can immediately
   * spawn entities and register systems that interact with the world.
   * Loading failures are logged but don't crash the engine — one broken
   * script shouldn't take the whole pack down.
   */
  async runPackScripts(): Promise<void> {
    const scripts = await this.pack.scripts();
    for (const { path, source } of scripts) {
      try {
        const blob = new Blob([source], { type: "application/javascript" });
        const url = URL.createObjectURL(blob);
        // Ev1 of EVENTS.md §6.1 — tag every subscription registered
        // during this script's setup() so HMR reloads of the single
        // script can drop only its subscriptions. setActiveScript
        // returns to null in the `finally`, so subscriptions made
        // OUTSIDE the wrapper (engine internals, late
        // onWorldReady callbacks) stay un-tagged and live for the
        // session.
        this.api.events.setActiveScript(path);
        try {
          const mod = (await import(/* @vite-ignore */ url)) as Record<string, unknown>;
          const setup = (mod.default ?? mod.setup) as ((api: ModAPIImpl) => void) | undefined;
          if (typeof setup === "function") {
            setup(this.api);
            console.log(`Script ${path}: loaded`);
          } else {
            console.warn(`Script ${path}: no default export or setup() function`);
          }
        } finally {
          URL.revokeObjectURL(url);
          this.api.events.setActiveScript(null);
        }
      } catch (err) {
        console.error(`Script ${path}: failed to load —`, err);
      }
    }
    // Editor-authored declarative prefabs land AFTER JS scripts have
    // had their crack at the ModAPI — that way prefabs can reference
    // components defined by `api.defineComponent(...)` in scripts.
    // EDITOR.md §6.3 + `registerDeclarativePrefabs.ts`.
    //
    // Phase #196: we use the async variant during boot so any
    // `prefab.initScript` referenced by a declarative prefab is
    // pre-warmed (fetched + module-loaded) before the first spawn.
    // That keeps the contract — spawn → entity carries init-attached
    // components synchronously — even for the first spawn of a session.
    await this.registerDeclarativePrefabsFromManifestAsync();
  }

  /**
   * Walk `pack.manifest.prefabs` and register each entry as a
   * declarative prefab. Per EDITOR.md §6.3 these coexist with the
   * JS-based `api.registerPrefab(...)` path; the prefab registry warns
   * on collisions and the later registration wins.
   *
   * Called from `runPackScripts()` (after scripts) and from the editor
   * when the user "Save & Test"s a manifest with new prefabs without a
   * full engine reload. Idempotent — re-registering with the same name
   * just replaces the factory.
   *
   * The synchronous form here keeps backwards-compat with the editor's
   * existing call site. The async sibling below pre-warms `initScript`
   * modules so the first spawn doesn't pay a cold-start cost; the boot
   * path uses that variant.
   */
  registerDeclarativePrefabsFromManifest(): void {
    if (!this.pack.manifest.prefabs) return;
    registerDeclarativePrefabs(this.api, this.pack.manifest, this.pack);
  }

  /** Phase #196 — async variant; pre-loads any referenced initScripts. */
  async registerDeclarativePrefabsFromManifestAsync(): Promise<void> {
    if (!this.pack.manifest.prefabs) return;
    await registerDeclarativePrefabsAsync(
      this.api,
      this.pack.manifest,
      this.pack,
    );
  }

  /**
   * Spawn the entities the scene + engine expect to exist before the
   * first frame renders. Today that's just the player — assembled by
   * the default pack's `"player"` prefab against `scene.spawn`.
   *
   * Must be called AFTER `runPackScripts()` so the pack has had a
   * chance to register the prefab. Skipped when this `Game` inherited
   * a world from an HMR snapshot — that world already has the player.
   *
   * Throws a clear message if the pack didn't register `"player"`
   * (typically: wrong pack loaded, or the pack's boot scripts didn't
   * run before scene load).
   */
  spawnInitialEntities(): void {
    if (!this.freshWorld) return;
    const { x, y, facing } = this.scene.spawn;
    // Boot scene's name comes from the manifest's startScene; main.ts
    // can override it, but in either case the path is the canonical
    // identifier for `scene:loaded` event listeners.
    if (this.currentScenePath === "") {
      this.currentScenePath = this.pack.manifest.startScene;
    }
    this.api.spawnPrefab("player", { x, y, facing });
    // Fire any pack-registered `onWorldReady` callbacks now that the
    // player + scene entities exist. Scripts use this to locate named
    // entities and attach extra components without "if entity exists
    // yet" guards.
    this.api.runWorldReadyCallbacks();
    // Ev1 of EVENTS.md §4.1 / §4.6 — scene:loaded fires AFTER
    // `spawnInitialEntities()` + every `onWorldReady` callback, so
    // subscribers can safely query the freshly-built world. pack:loaded
    // fires once at boot for the same reason. Both ride the post-
    // worldReady moment to give pack scripts a chance to register
    // their handlers BEFORE these events fire.
    this.api.events.emit("scene:loaded", {
      name: this.currentScenePath,
      size: { x: this.scene.size.x, y: this.scene.size.y },
    });
    this.api.events.emit("pack:loaded", { manifest: this.pack.manifest });
  }

  /**
   * Allow the bootstrap (`main.ts`) to seed the initial scene path
   * before `spawnInitialEntities` runs. Without this the canonical
   * scene-name in event payloads would fall back to the manifest's
   * startScene even when `?scene=` overrode it.
   */
  setInitialScenePath(path: string): void {
    this.currentScenePath = path;
  }

  /**
   * Switch to a different scene from the current pack. I1 of
   * EDITOR_IFRAME.md §7 — handler for the `switch-scene` message.
   *
   * The world (ECS entities) is preserved: the player keeps its
   * Position / Inventory / etc., but `Position` is reset to the
   * new scene's spawn so the player doesn't start mid-wall in the
   * destination map.
   *
   * Tile / wall geometry comes from `this.scene` per-frame, so
   * swapping the reference is all the renderer needs to draw the
   * new map on the next tick.
   */
  async loadScene(path: string): Promise<void> {
    // Ev1 of EVENTS.md §4.1 — emit `scene:beforeLoad` BEFORE the swap
    // begins so subscribers can capture the outgoing scene's id, and
    // `scene:beforeUnload` so they can read entity state one last
    // time before the player's Position resets to the new spawn.
    const from = this.currentScenePath || undefined;
    this.api.events.emit("scene:beforeLoad", { from, to: path });
    if (from) this.api.events.emit("scene:beforeUnload", { name: from });

    const fresh = await this.pack.scene(path);
    this.scene = fresh;
    this.api.scene = fresh;
    this.currentScenePath = path;
    // Reset the player to the new scene's spawn. Keeping the world
    // intact across scene swaps is a deliberate I1 choice — full
    // entity teardown on each load is I2 territory.
    const playerEntity = this.world.first(Camera, Position, Facing);
    if (playerEntity !== undefined) {
      // Vec2 is immutable — overwrite the component with a fresh
      // instance instead of trying to mutate `pos.x` / `pos.y`.
      this.world.add(playerEntity, Position, new Vec2(fresh.spawn.x, fresh.spawn.y));
      Facing.set(playerEntity, fresh.spawn.facing);
    }
    // `scene:loaded` mirrors the boot-time emit in
    // `spawnInitialEntities`. Subscribers can re-run their per-scene
    // setup logic each time the player switches.
    this.api.events.emit("scene:loaded", {
      name: path,
      size: { x: fresh.size.x, y: fresh.size.y },
    });
  }

  /**
   * Re-read the active scene from the pack. I1 of EDITOR_IFRAME.md
   * §7 — handler for the `scene-changed` message after the editor
   * persists an edit to IDB.
   *
   * Differs from `loadScene` in that it preserves the player's
   * position (the geometry may have been retiled around the
   * player, but the player itself shouldn't teleport on a paint).
   * If the destination cell is unwalkable post-edit, downstream
   * collision systems will resolve it on the next tick.
   */
  async reloadScene(path: string): Promise<void> {
    const fresh = await this.pack.scene(path);
    this.scene = fresh;
    this.api.scene = fresh;
    // Player position deliberately NOT reset — see method docstring.
  }

  /**
   * Material-variant collection + program recompiles (M1 + M2 + M3 of
   * MATERIALS.md). Three things happen here:
   *
   *  1. **Per-entity sprite variants** (M1) — every entity carrying a
   *     `Shader` component contributes a unique combination of hook-
   *     file paths. Each unique value gets a non-zero variant id; the
   *     sprite-frag dispatcher routes per-fragment by per-vertex
   *     `a_variant`.
   *  2. **Per-cell world variants** (M2) — every tile preset whose
   *     `shader.worldHooks` is set gets a non-zero variant id. The
   *     world-frag dispatcher routes per-fragment by sampling
   *     `u_sceneShaderVariants` at the cell coord.
   *  3. **Scene-level overrides** (M3) — if the active scene's JSON
   *     declares a `shaders` field, those hooks merge on top of pack-
   *     level overrides to form variant 0. M1 + M2 variants build on
   *     top of THAT, inheriting scene-level for hooks they don't
   *     explicitly redefine.
   *
   * Fast paths:
   *
   *  - No `Shader` entities + no `preset.shader` + no `scene.shaders`
   *    → the renderer's `rebuildSpriteProgram` / `rebuildWorldProgram`
   *    no-op and the constructor's pack-default programs stay bound
   *    (byte-identical to pre-MATERIALS rendering).
   *  - Canvas2D backend → both rebuilds skip (the backend ignores
   *    per-fragment shaders entirely).
   *
   * Live-edit of `Shader` components / preset shaders after this
   * point falls back to variant 0 at render time. Reload the scene
   * to compile new variants — see MATERIALS.md §7.
   */
  async collectShaderVariants(): Promise<void> {
    // Material smoke-test gate. M1 + M2 + M3 share the
    // `materialsSmokeTest` manifest flag so the default pack ships
    // with the wet-floor preset + scene-fog hooks present but
    // visually inert. Flipping the flag to `true` enables every
    // attached `Shader` component, every preset `shader.*` field,
    // and every scene-level `shaders` block. With it off, the
    // renderer compiles its pack-default programs and rendering is
    // byte-identical to pre-MATERIALS today.
    const flag = (this.pack.manifest as unknown as { materialsSmokeTest?: boolean })
      .materialsSmokeTest === true;

    // Sprite + world rebuilds both come from the same scene-level
    // shader layer so the merge order stays consistent (engine →
    // pack → scene → material).
    const sceneLayer = flag
      ? await collectSceneShaderLayer(this.pack, this.scene.shaders)
      : undefined;

    if (this.renderer.rebuildSpriteProgram !== undefined) {
      const spriteVariants = flag
        ? await collectSpriteVariants(this.world, this.pack)
        : null;
      if (spriteVariants !== null) {
        await this.renderer.rebuildSpriteProgram(
          spriteVariants,
          sceneLayer?.spriteHookBodies,
        );
      }
    }

    if (this.renderer.rebuildWorldProgram !== undefined && flag) {
      const resolver = await this.pack.presets();
      const worldVariants = await collectWorldVariants(resolver, this.pack);
      await this.renderer.rebuildWorldProgram(worldVariants, sceneLayer?.worldHookBodies);
    }

    // S4: compile the Mode-2 post-process chain (if the manifest
    // declares any). Async; reads every fragment body via
    // `pack.textBody`. WebGL2 only — `initPostPasses` is optional on
    // the SceneRenderer interface and the canvas2d backend doesn't
    // implement it, so this is a silent no-op there. No-op when the
    // manifest has no `postPasses` field either (chain stays null).
    if (this.renderer.initPostPasses !== undefined) {
      await this.renderer.initPostPasses();
    }
  }

  /** Begin the frame loop. */
  start(): void {
    this.engine.start();
  }

  /** Halt the frame loop. Does *not* detach input — see `destroy`. */
  stop(): void {
    this.engine.stop();
  }

  /** Stop the loop and detach all input listeners. */
  destroy(): void {
    this.stop();
    this.keyboard.destroy();
    this.mouse.destroy();
    window.removeEventListener("resize", this.fitCanvasToWindow);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    // Ev1 of EVENTS.md §6 — drop every subscription so a fresh Game
    // doesn't inherit handlers via lingering closures. The registry
    // itself will be GC'd along with `this.api`, but disposeAll makes
    // the teardown explicit + cheap.
    this.api.events.disposeAll();
  }

  /**
   * Re-fit the canvas to its host container:
   *
   *   - Reads the canvas's parent `clientWidth/clientHeight` so the
   *     engine adapts to whatever box the host gives it (game runner =
   *     full window via body CSS; editor viewport = bounded pane).
   *   - Pixel buffer = `host dims × resolutionScale`, clamped to
   *     `[0.25, 1.0]`. Lower scales upscale via CSS — cheaper at high
   *     resolutions, useful for the canvas2d backend on 4K monitors.
   *   - Does NOT force inline CSS width/height on the canvas — the
   *     host controls layout. The buffer matches the host's chosen
   *     CSS dimensions so the displayed image has 1:1 pixel mapping.
   *
   * Renderer call-sites use `canvas.width / .height` per frame, so the
   * aspect ratio adapts naturally — wider hosts show more world
   * horizontally without stretching the image. WebGL's HUD canvas is
   * resized alongside the main one.
   */
  private readonly fitCanvasToWindow = (): void => {
    const parent = this.canvas.parentElement;
    const hostW = parent?.clientWidth || window.innerWidth;
    const hostH = parent?.clientHeight || window.innerHeight;
    const scale = Math.max(0.25, Math.min(1, CONFIG.rendering.resolutionScale ?? 1));
    const bufW = Math.max(1, Math.round(hostW * scale));
    const bufH = Math.max(1, Math.round(hostH * scale));
    if (this.renderer) this.renderer.resize(bufW, bufH);
  };

  private resizeObserver: ResizeObserver | null = null;

  /** Cache the most recently-applied UI-scale font size so we only
   *  touch the DOM when the value actually changed. */
  private lastUiFontSize = "";

  private readonly syncUiScale = (): void => {
    const scale = CONFIG.ui?.scale ?? 1;
    const clamped = Math.max(0.5, Math.min(3, scale));
    const next = `${(16 * clamped).toFixed(2)}px`;
    if (next === this.lastUiFontSize) return;
    document.documentElement.style.fontSize = next;
    this.lastUiFontSize = next;
  };

  /** State to preserve across an HMR reload. */
  snapshot(): GameState {
    return { world: this.world, keyboard: this.keyboard, mouse: this.mouse };
  }

  private readonly update = (deltaTime: number): void => {
    this.frameIndex += 1;
    // `frame:before` — Ev1 §4.7. Fires at the top of update before any
    // system runs. EventsRegistry's no-subscriber fast path keeps idle
    // cost ~5 ns (Map.get + size check, no work).
    this.api.events.emit("frame:before", {
      deltaTime,
      frameIndex: this.frameIndex,
    });

    if (!this.modals.any()) {
      // World-affecting systems (mod-registered after R3 — see
      // `packages/default-pack/scripts/systems/*`) pause while any
      // modal owns the screen. The pack-side modal systems register
      // their open-toggle polling through the same `registerSystem`
      // path; they only need to fire while no modal is open. Their
      // close-side path runs inside the Preact component itself
      // (window keydown listener) and so doesn't need a frame tick.
      this.api.runFrame(deltaTime);
      // A1 of ANIMATIONS.md — engine-side animation advance runs in
      // the update phase (gameplay-paused while a modal is open), so
      // when the inventory / settings UI is up the world freezes
      // including any animated sprites. Runs AFTER pack systems so a
      // mod that calls `api.anim.play(...)` reacting to input sees
      // its `play` reset land BEFORE this tick's frame advance.
      this.animationSystem.update(this.world, deltaTime);
      // Throttled `player:moved` (EVENTS.md §4.3) — emit when the
      // player crosses a cell boundary OR every Nth frame, whichever
      // first. Skipped while paused so handlers don't fire during
      // modal screens.
      this.emitPlayerMoved();
    }
    // Reconcile pack-registered modal components (Preact) against the
    // engine's open-modal set. Runs every frame so live-prop callbacks
    // see fresh state (CONFIG, inventory, etc).
    this.api.flushUI();
    // Au1 of AUDIO.md — push CONFIG.audio.* into the live gain nodes
    // every frame. The pack-side settings system already mutates
    // CONFIG via `applyConfigOverride` when the user drags a slider;
    // this loop reflects writes that didn't come through
    // `api.audio.groupVolume.set(...)` (e.g. JSON import). Cheap —
    // five float comparisons — and a no-op while audio is dormant.
    this.api.audio.syncFromConfig();

    // UI scale → <html>.style.fontSize. Tailwind rem-based classes
    // pick this up automatically so modals scale without per-class
    // multiplication. Pack-side HUD systems multiply canvas2d coords
    // by api.config.ui.scale themselves (rem doesn't apply to canvas).
    // Cheap — single string comparison via the cached font size below.
    this.syncUiScale();

    // `frame:after` — Ev1 §4.7. Fires at the bottom of update after
    // every system + UI flush. Symmetric with `frame:before`.
    this.api.events.emit("frame:after", {
      deltaTime,
      frameIndex: this.frameIndex,
    });
  };

  /**
   * Throttled `player:moved` emit (EVENTS.md §4.3). Walks the player
   * entity (`PlayerInput + Position`) and fires when the player
   * crosses a cell boundary OR every Nth frame, whichever first.
   * Velocity is reconstructed from the `Movement` component when
   * present; future versions can feed the input system's per-frame
   * intent vector directly.
   */
  private emitPlayerMoved(): void {
    const e = this.world.first(PlayerInput, Position);
    if (e === undefined) return;
    const pos = Position.getOrThrow(e);
    const cellX = Math.floor(pos.x);
    const cellY = Math.floor(pos.y);
    let track = this.playerMoveTrack.get(e);
    if (track === undefined) {
      track = { cellX, cellY, lastFrame: this.frameIndex };
      this.playerMoveTrack.set(e, track);
      this.fireMoved(e, pos, cellX, cellY, track);
      return;
    }
    const crossed = cellX !== track.cellX || cellY !== track.cellY;
    const elapsed =
      this.frameIndex - track.lastFrame >= PLAYER_MOVED_FRAME_THROTTLE;
    if (!crossed && !elapsed) return;
    this.fireMoved(e, pos, cellX, cellY, track);
  }

  private fireMoved(
    entity: number,
    pos: Vec2,
    cellX: number,
    cellY: number,
    track: { cellX: number; cellY: number; lastFrame: number },
  ): void {
    track.cellX = cellX;
    track.cellY = cellY;
    track.lastFrame = this.frameIndex;
    const mv = Movement.get(entity);
    const vmag = mv
      ? mv.speed * (mv.isRunning ? mv.runMultiplier : 1)
      : 0;
    this.api.events.emit("player:moved", {
      position: pos,
      velocity: new Vec2(vmag, 0),
      cellX,
      cellY,
    });
  }

  private readonly render = (deltaTime: number): void => {
    // 0. `before-world` phase — pack-registered renderer systems that
    //    want to draw under everything (sky overlays, etc.) run before
    //    the world pass kicks off. No-op until something registers.
    this.api.runRendererPhase("before-world", this.renderer, deltaTime);

    // 1. World pass — the SceneRenderer owns everything from sky/floor
    //    backdrop through walls, floor, ceiling, reflections, AO.
    this.renderer.beginFrame();

    // Dynamic lights MUST be uploaded before drawWorld / drawSprites so
    // both passes see the same list — the WebGL backend stages uniforms
    // for the world shader, the TwoD backend stashes them in a member
    // for the per-pixel hot loops.
    this.lightCollection.render(this.renderer, this.world);

    const cameraEntity = this.world.first(Camera, Position, Facing);
    if (cameraEntity !== undefined) {
      const camera = Camera.getOrThrow(cameraEntity);
      const position = Position.getOrThrow(cameraEntity);
      const facing = Facing.getOrThrow(cameraEntity);
      // Sync per-frame config-driven camera fields so the settings
      // sliders feel live. cameraZ is dynamic (jump/crouch) and stays
      // owned by the input system.
      camera.fov = (CONFIG.camera.fovDegrees * Math.PI) / 180;
      camera.fogDistance = CONFIG.camera.fogDistance;
      camera.maxRaySteps = CONFIG.camera.maxRaySteps;
      // Fake-pitch: horizon line shifts opposite the reticle so looking
      // down (reticle low) reveals more floor.
      const aim = Aim.get(cameraEntity);
      const horizonOffset = aim ? -aim.screenY * CONFIG.camera.pitchFraction : 0;
      this.renderer.drawSky(camera.ceiling, camera.floor);
      this.renderer.drawWorld(this.scene, position, facing, camera, horizonOffset);
      // `after-world` phase — viewmodel slot. The default pack's
      // `gun-render` system registers here (engine no longer owns the
      // viewmodel pass after R3).
      this.api.runRendererPhase("after-world", this.renderer, deltaTime);
      // Sprites land on top of the world pass but before endFrame, so
      // for canvas2d they composite into the pixel buffer and for WebGL
      // they share the same framebuffer the world pass wrote to.
      this.spriteRender.render(this.renderer, this.world);
      // `after-sprites` phase — wall reflections / world overlays slot.
      this.api.runRendererPhase("after-sprites", this.renderer, deltaTime);
    }

    this.renderer.endFrame();

    // 2. `hud` phase — every HUD overlay (inventory bar, minimap,
    //    stats, reticle) is now pack-registered after R3 and paints
    //    here in registration order.
    this.api.runRendererPhase("hud", this.renderer, deltaTime);
  };
}
