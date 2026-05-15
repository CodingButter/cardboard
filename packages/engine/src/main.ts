import { loadAssetPack, type AssetPack } from "AssetPack";
import { applyConfigOverride } from "GameConfig";
import type { Game as GameClass, GameState } from "Game";
import { loadLocalSettings, loadUrlSettings, type PartialGameConfig } from "Settings";
import { deepMerge } from "Libs/DeepMerge";

/**
 * Register the PWA service worker. We only register in production
 * builds — in HMR dev (`bun --hot`) the SW would intercept the bundle
 * fetches and break live reload. Bun's bundler exposes `import.meta.hot`
 * only in dev, so its presence is a reliable HMR signal.
 */
if (typeof navigator !== "undefined" && "serviceWorker" in navigator && !import.meta.hot) {
  // Defer until after first paint so it doesn't compete with the
  // initial bundle/pack fetches.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("SW registration failed:", err);
    });
  });
}

/**
 * Update the boot-time overlay's status line, if it's still in the DOM.
 * HMR re-runs `main()` after the overlay was already removed — that's a
 * silent no-op, the overlay simply isn't there to update.
 */
function bootStatus(message: string): void {
  const el = document.getElementById("boot-loading-status");
  if (el) el.textContent = message;
}

/** Remove the boot-time overlay just before the first frame draws. */
function bootDone(): void {
  document.getElementById("boot-loading")?.remove();
}

/**
 * Bootstrap entry. The startup sequence is intentionally ordered so
 * pack config overrides land *before* anything reads `CONFIG`:
 *
 *   1. Fetch + unzip the asset pack.
 *   2. If the pack has a `config.json`, deep-merge it over baseline.
 *   3. Load the start scene from the pack.
 *   4. **Dynamically import `Game`** — the renderer modules only
 *      capture `CONFIG` here, so by step 4 they see the merged values.
 *   5. Construct the game, load + run any pack scripts via the ModAPI.
 *
 * Returns the live game so HMR-aware callers can snapshot state across
 * module reloads.
 */
export async function main(previous?: Partial<GameState>): Promise<GameClass> {
  const canvas = document.getElementById("main-canvas") as HTMLCanvasElement;
  canvas.width = 600;
  canvas.height = 600;

  const params = new URLSearchParams(window.location.search);
  const packUrl = params.get("pack");
  const sceneOverride = params.get("scene");

  // 1. Pack
  bootStatus("Downloading asset pack…");
  const pack: AssetPack = await loadAssetPack(packUrl);
  console.log(`Loaded asset pack: ${pack.manifest.name} v${pack.manifest.version}`);

  // 2. Config overrides — pack config + user settings (localStorage),
  //    plus an optional hosted profile from ?settings=<url>. Combined
  //    BEFORE Game is dynamically imported so renderer module-load
  //    captures see the final merged values.
  bootStatus("Reading configuration…");
  const packConfig = ((await pack.config()) ?? {}) as PartialGameConfig;
  const localSettings = loadLocalSettings();
  const userSettings = await loadUrlSettings(localSettings);
  const merged = deepMerge<PartialGameConfig>(packConfig, userSettings);
  applyConfigOverride(merged);
  if (pack.manifest.config) {
    console.log(`Applied config override from ${pack.manifest.config}`);
  }

  // 3. Scene
  bootStatus("Loading scene…");
  const scenePath = sceneOverride ?? pack.manifest.startScene;
  const scene = await pack.scene(scenePath);
  console.log(`Loaded scene: ${scenePath} (${scene.size.x}×${scene.size.y})`);

  // 4. Game (dynamic import — defers renderer module-load until after
  //    applyConfigOverride has run, so renderer captures see merged config)
  bootStatus("Initialising renderer…");
  const { Game } = await import("Game");
  // Resolve any `manifest.shaders` overrides BEFORE constructing the
  // renderer. WebGL-only; canvas2d gets `undefined` and silently
  // ignores the override (ENGINE_PACK_SHADERS.md § 2). The prefetch is
  // a small handful of `pack.textBody` reads — pack files are already
  // in memory after step 1, so this is microseconds.
  const { CONFIG } = await import("GameConfig");
  const { WebGLRenderer } = await import("Renderers");
  const shaderSources =
    CONFIG.rendering.backend === "webgl" && pack.manifest.shaders
      ? await WebGLRenderer.prefetchShaderSources(pack)
      : undefined;
  const game = new Game(canvas, pack, scene, previous, packConfig, shaderSources);

  // 5. Mod scripts — must run BEFORE we spawn the player, because the
  //    "player" prefab is pack-side content. The default pack's
  //    `scripts/prefabs/player.js` registers it during this step.
  bootStatus("Running pack scripts…");
  await game.runPackScripts();

  // 5b. Spawn the initial world entities (player today) via prefabs
  //     the pack just registered. No-op when an HMR snapshot already
  //     carries a populated world.
  game.spawnInitialEntities();

  // 6. Wait for tile/sprite/item assets to finish decoding so the
  //    first visible frame doesn't flash the pink fallback. Same await
  //    serves canvas2d + WebGL because `assetsReady` is on the
  //    SceneRenderer interface.
  bootStatus("Decoding textures…");
  await game.renderer.assetsReady;

  bootDone();
  game.start();
  return game;
}

export type { GameState };
