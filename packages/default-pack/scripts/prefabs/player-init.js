/**
 * Default-pack "player" prefab — init script.
 *
 * Canonical worked example of a HYBRID DECLARATIVE PREFAB (Phase #196
 * of `docs/PLAN.md`). Static component shape lives in
 * `manifest.json` under `prefabs.player.components`; the dynamic
 * pieces — anything that reads `api.config`, `api.pack.manifest`, or
 * spawn-time `opts` outside what the engine's `applyOpts` shortcut
 * already merges — live here.
 *
 * Engine boot order:
 *
 *   runPackScripts() → registerDeclarativePrefabsFromManifestAsync()
 *                    → api.spawnPrefab("player", { x, y, facing })
 *
 * For every prefab in `manifest.prefabs`, the engine:
 *
 *   1. Spawns a fresh entity.
 *   2. Walks `prefab.components` and attaches each (with `applyOpts`
 *      merging `opts.x`/`opts.y`/`opts.facing` into the Position +
 *      Facing shortcuts — see `registerDeclarativePrefabs.ts`).
 *   3. Calls this init script's default export with `(entity, opts, api)`.
 *
 * That means by the time we get here, `entity` already carries:
 *   - Position (from opts.x / opts.y, materialised into a `Vec2`)
 *   - Facing (from opts.facing)
 *   - Aim ({ screenY: 0 } — purely static)
 *
 * Everything else — Movement, PlayerInput, Weapon, Inventory, Camera,
 * MinimapMarker — is attached here because every one of those reads
 * live config or pack-manifest state that's only resolvable at spawn
 * time. (Weapon could in theory be static, but its sentinel
 * `reloadStart: -Infinity` doesn't roundtrip through JSON, so it stays
 * imperative too.)
 *
 * Modders who run the JS-to-declarative converter (`apps/editor/src/
 * lib/prefabConverter.ts`) on their own prefab scripts see this file
 * as the worked end-to-end example of what a clean hybrid output
 * looks like.
 */
export default function init(entity, opts, api) {
  const world = api.world;
  const C = api.components;
  const cfg = api.config;
  const manifest = api.pack.manifest;

  // Inventory — seeded from `manifest.defaultInventory`. Uses
  // `api.inventory.*` helpers that don't exist at declarative-time.
  const inventory = {
    bag: new Array(api.inventory.BAG_SIZE).fill(null),
    hotbar: new Array(api.inventory.HOTBAR_SIZE).fill(null),
    equipment: api.inventory.emptyEquipment(),
    activeHotbarIndex: 0,
  };
  api.inventory.seedInventory(
    inventory,
    manifest,
    manifest.defaultInventory ?? [],
  );

  world
    .add(entity, C.Movement, {
      speed: cfg.player.speed,
      rotationSpeed: cfg.player.rotationSpeed,
      runMultiplier: cfg.player.runMultiplier,
      isRunning: false,
      z: 0,
      vz: 0,
      crouching: false,
    })
    .add(entity, C.PlayerInput, { bindings: cfg.bindings })
    .add(entity, C.Weapon, {
      // `-Infinity` is the load-bearing "haven't reloaded yet"
      // sentinel; it would JSON.stringify to `null` in the static
      // manifest, so Weapon stays imperative.
      lastFireTime: -100,
      walkPhase: 0,
      wasFiring: false,
      reloadStart: -Infinity,
    })
    .add(entity, C.Inventory, inventory)
    .add(entity, C.Camera, {
      fov: (cfg.camera.fovDegrees * Math.PI) / 180,
      ceiling: cfg.camera.ceiling,
      floor: cfg.camera.floor,
      fogDistance: cfg.camera.fogDistance,
      maxRaySteps: cfg.camera.maxRaySteps,
      cameraZ: 0.5,
    })
    .add(entity, C.MinimapMarker, {
      color: cfg.minimap.playerMarker.color,
      radius: cfg.minimap.playerMarker.radius,
      drawForwardRay: true,
    });
}
