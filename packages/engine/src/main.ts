import { DEFAULT_PACK_URL, resolveChain, type AssetPack } from "AssetPack";
import { applyConfigOverride } from "GameConfig";
import type { Game as GameClass, GameState } from "Game";
import { Scene } from "Scene";
import { loadLocalSettings, loadUrlSettings, type PartialGameConfig } from "Settings";
import { deepMerge } from "Libs/DeepMerge";

/**
 * Register the PWA service worker. We only register in production
 * builds — in HMR dev (`bun --hot`) the SW would intercept the bundle
 * fetches and break live reload. Bun's bundler exposes `import.meta.hot`
 * only in dev, so its presence is a reliable HMR signal.
 */
if (
  typeof navigator !== "undefined" &&
  "serviceWorker" in navigator &&
  !import.meta.hot &&
  // Skip SW registration when running inside the editor iframe — the
  // editor origin doesn't serve /sw.js, and we don't want a SW to cache
  // the editor's bundle anyway.
  !new URLSearchParams(window.location.search).has("source")
) {
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
export async function main(
  previous?: Partial<GameState>,
  packUrls?: string[],
): Promise<GameClass> {
  const canvas = document.getElementById("main-canvas") as HTMLCanvasElement;
  canvas.width = 600;
  canvas.height = 600;

  const params = new URLSearchParams(window.location.search);
  // Fall back to the URL query string when the caller didn't pre-parse
  // it (the standard flow for `apps/game/index.ts` is to pre-parse
  // and pass `packUrls`; bun smoke tests / future embedders can call
  // `main()` directly).
  const urlsFromQuery = params.getAll("pack");
  const chainUrls = (packUrls && packUrls.length > 0 ? packUrls : urlsFromQuery).filter(
    (u) => u && u.length > 0,
  );
  const rootUrl = chainUrls.length > 0 ? chainUrls[chainUrls.length - 1]! : DEFAULT_PACK_URL;
  const sceneOverride = params.get("scene");

  // 1. Pack — P1 of PACK_CHAIN.md: resolve the chain (root + any
  //    transitive `requires`) but still hand the ROOT pack to Game.
  //    Override / merge semantics across the chain are P2/P3 work.
  //
  //    Multiple `?pack=` params (`?pack=A&pack=B`) are treated as an
  //    explicit chain (§ 3) — every URL's sub-chain is resolved, the
  //    LAST URL is the "root" handed to Game, and earlier explicit
  //    URLs become prepended dependencies. Single-URL flows hit the
  //    fast path with `chainUrls.length <= 1`.
  bootStatus("Downloading asset pack…");
  const explicitChain = chainUrls.length > 1 ? chainUrls : [rootUrl];
  const chain: AssetPack[] = [];
  const seen = new Set<AssetPack>();
  for (const url of explicitChain) {
    const sub = await resolveChain(url);
    for (const p of sub) {
      if (!seen.has(p)) {
        seen.add(p);
        chain.push(p);
      }
    }
  }
  const pack: AssetPack = chain[chain.length - 1]!;
  if (chain.length > 1) {
    const arrow = chain
      .map((p) => `${p.manifest.name}@${p.manifest.version}`)
      .join(" → ");
    console.log(`Loaded pack chain (${chain.length}): ${arrow}`);
  } else {
    console.log(`Loaded asset pack: ${pack.manifest.name} v${pack.manifest.version}`);
  }

  return bootFromChain(chain, previous, sceneOverride);
}

/**
 * The post-pack-resolution half of `main`. Takes a fully-formed
 * pack chain (single-pack callers wrap their pack in `[pack]`) and
 * drives the rest of boot — config merge, scene load, renderer
 * pick, pack scripts, initial spawn, shader variants, assets ready.
 *
 * Reusable for callers that built the pack themselves (the editor
 * iframe constructs an `IdbAssetPack` from URL params and hands it
 * here). Kept exported so the engine's bootstrap is a public
 * surface, not a private implementation detail.
 */
export async function bootFromChain(
  chain: ReadonlyArray<AssetPack>,
  previous?: Partial<GameState>,
  sceneOverride?: string | null,
): Promise<GameClass> {
  const canvas = document.getElementById("main-canvas") as HTMLCanvasElement;
  canvas.width = 600;
  canvas.height = 600;

  if (chain.length === 0) {
    throw new Error("bootFromChain: empty chain");
  }
  const pack: AssetPack = chain[chain.length - 1]!;

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
  if (!scenePath) {
    throw new Error(
      `Pack ${pack.manifest.id ?? pack.manifest.name} has no startScene` +
        ` declared and no scene override was supplied. Game packs must` +
        ` set manifest.startScene.`,
    );
  }
  const scene: Scene = await pack.scene(scenePath);
  console.log(`Loaded scene: ${scenePath} (${scene.size.x}×${scene.size.y})`);

  // 4. Game (dynamic import — defers renderer module-load until after
  //    applyConfigOverride has run, so renderer captures see merged config)
  bootStatus("Initialising renderer…");
  const { Game } = await import("Game");
  const { CONFIG } = await import("GameConfig");
  const { WebGLRenderer } = await import("Renderers");
  const anyPackShipsShaders = chain.some((p) => p.manifest.shaders !== undefined);
  const shaderSources =
    CONFIG.rendering.backend === "webgl" && anyPackShipsShaders
      ? chain.length > 1
        ? await WebGLRenderer.prefetchShaderSourcesFromChain(chain)
        : await WebGLRenderer.prefetchShaderSources(pack)
      : undefined;
  const game = new Game(canvas, pack, scene, previous, packConfig, shaderSources, chain);
  // Ev1 of EVENTS.md — record the resolved scene path on Game so the
  // `scene:loaded` event payload reflects the actual loaded scene
  // (`?scene=` override or manifest default), not whatever the engine
  // would derive at emit time.
  game.setInitialScenePath(scenePath);

  // 5. Mod scripts
  bootStatus("Running pack scripts…");
  await game.runPackScripts();

  // 5a. Au1 of AUDIO.md — kick off eager audio decode now that pack
  // scripts have run (so the manifest is final). Decode work happens
  // off the main thread; the bootstrap doesn't await it — sounds
  // become playable as their buffers complete and the first
  // `api.audio.play("...")` call resolves once the buffer lands. A
  // pack without `manifest.audio` no-ops here without creating an
  // AudioContext.
  void game.api.audio.preloadAll();

  // 5a'. SL2 of SOUND_LAB.md — scan the pack for `recipes/*.sound.json`
  // and register every valid recipe in the procedural-audio store.
  // No render at this point — static + loop recipes lazily render on
  // first `load(id)` / `api.audio.play(id)`; instrument recipes
  // instantiate per voice. A pack without any recipes loads byte-
  // identically to pre-SL2 (no AudioContext, no IDB writes).
  await game.api.proceduralAudio.loadFromPack();

  // 5a'. SL2 of SOUND_LAB.md — scan the pack for `recipes/*.sound.json`
  // and register every valid recipe in the procedural-audio store.
  // No render at this point — static + loop recipes lazily render on
  // first `load(id)` / `api.audio.play(id)`; instrument recipes
  // instantiate per voice. A pack without any recipes loads byte-
  // identically to pre-SL2 (no AudioContext, no IDB writes).
  await game.api.proceduralAudio.loadFromPack();

  // 5b. Spawn the initial world entities (player today). Async now
  // that `world.json` singleton seeding (WORLD_STATE.md §10.2) reads
  // a pack body inside the boot path.
  await game.spawnInitialEntities();

  // 5c. Collect per-entity shader variants (M1 of materials plan,
  // shipped 2026-05-16 — see git log).
  bootStatus("Compiling shader variants…");
  await game.collectShaderVariants();

  // 6. Wait for tile/sprite/item assets to finish decoding so the
  //    first visible frame doesn't flash the pink fallback.
  bootStatus("Decoding textures…");
  await game.renderer.assetsReady;

  bootDone();
  game.start();
  return game;
}

export type { GameState };
