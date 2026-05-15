import { CANVAS_SIZE } from "Config";
import Engine from "Engine";
import { Scene } from "Scene";
import { World } from "ECS";
import { KeyboardController, MouseController } from "Controllers";
import { TwoDRenderer, WebGLRenderer, type SceneRenderer } from "Renderers";
import {
  LightCollectionSystem,
  SpriteRenderSystem,
} from "Systems";
import ModalRegistry from "ModalRegistry";
import type { PartialGameConfig } from "Settings";
import { Aim, Camera, Facing, Position } from "Components";
import { CONFIG } from "GameConfig";
import type { AssetPack, ShaderRole } from "AssetPack";
import { ModAPIImpl } from "ModAPI";
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
  readonly scene: Scene;
  readonly world: World;
  readonly keyboard: KeyboardController;
  readonly mouse: MouseController;
  readonly renderer: SceneRenderer;

  readonly spriteRender: SpriteRenderSystem;
  readonly lightCollection: LightCollectionSystem;
  readonly modals: ModalRegistry;
  readonly itemImages: ItemImages;
  readonly api: ModAPIImpl;
  readonly pack: AssetPack;

  private readonly canvas: HTMLCanvasElement;
  /**
   * `true` when this `Game` instantiated a brand-new `World` (no HMR
   * snapshot was handed back in). `spawnInitialEntities()` reads it to
   * decide whether to spawn the player — across HMR reloads the player
   * entity already exists in the preserved world and re-spawning would
   * duplicate it.
   */
  private readonly freshWorld: boolean;

  constructor(
    canvas: HTMLCanvasElement,
    pack: AssetPack,
    scene: Scene,
    previous?: Partial<GameState>,
    packConfig: PartialGameConfig = {},
    /**
     * Pre-resolved per-role fragment shaders, produced by
     * `WebGLRenderer.prefetchShaderSources(pack)`. Forwarded to the
     * WebGL renderer; the canvas2d renderer ignores it (pack shaders
     * are a WebGL-only feature — `ENGINE_PACK_SHADERS.md` § 2).
     */
    shaderSources?: Partial<Record<ShaderRole, string>>,
  ) {
    this.pack = pack;
    this.canvas = canvas;
    this.fitCanvasToWindow();
    window.addEventListener("resize", this.fitCanvasToWindow);
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
        ? new WebGLRenderer({ ...rendererProps, shaderSources })
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
        }
      } catch (err) {
        console.error(`Script ${path}: failed to load —`, err);
      }
    }
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
    this.api.spawnPrefab("player", { x, y, facing });
    // Fire any pack-registered `onWorldReady` callbacks now that the
    // player + scene entities exist. Scripts use this to locate named
    // entities and attach extra components without "if entity exists
    // yet" guards.
    this.api.runWorldReadyCallbacks();
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
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
  }

  /**
   * Re-fit the canvas to the current window:
   *
   *   - CSS box fills the window edge-to-edge (no letterboxing).
   *   - Pixel buffer = `window dims × resolutionScale`, clamped to
   *     `[0.25, 1.0]`. Lower scales upscale via CSS — cheaper at high
   *     resolutions, useful for the canvas2d backend on 4K monitors.
   *
   * Renderer call-sites use `canvas.width / .height` per frame, so the
   * aspect ratio adapts naturally — wider windows show more world
   * horizontally without stretching the image. WebGL's HUD canvas is
   * resized alongside the main one.
   */
  private readonly fitCanvasToWindow = (): void => {
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    this.canvas.style.width = `${winW}px`;
    this.canvas.style.height = `${winH}px`;
    const scale = Math.max(0.25, Math.min(1, CONFIG.rendering.resolutionScale ?? 1));
    const bufW = Math.max(1, Math.round(winW * scale));
    const bufH = Math.max(1, Math.round(winH * scale));
    if (this.renderer) this.renderer.resize(bufW, bufH);
  };

  /** State to preserve across an HMR reload. */
  snapshot(): GameState {
    return { world: this.world, keyboard: this.keyboard, mouse: this.mouse };
  }

  private readonly update = (deltaTime: number): void => {
    if (!this.modals.any()) {
      // World-affecting systems (mod-registered after R3 — see
      // `packages/default-pack/scripts/systems/*`) pause while any
      // modal owns the screen. The pack-side modal systems register
      // their open-toggle polling through the same `registerSystem`
      // path; they only need to fire while no modal is open. Their
      // close-side path runs inside the Preact component itself
      // (window keydown listener) and so doesn't need a frame tick.
      this.api.runFrame(deltaTime);
    }
    // Reconcile pack-registered modal components (Preact) against the
    // engine's open-modal set. Runs every frame so live-prop callbacks
    // see fresh state (CONFIG, inventory, etc).
    this.api.flushUI();
  };

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
