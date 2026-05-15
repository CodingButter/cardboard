/**
 * Default pack — "player" prefab registration.
 *
 * Engine has zero hardcoded knowledge of "the player" after R2 of the
 * engine/pack split (see docs/plans/ENGINE_PACK_SPLIT.md). What used
 * to be `packages/engine/src/Prefabs/createPlayer.ts` is now this JS
 * module: it registers a `"player"` prefab through the ModAPI; the
 * engine calls `api.spawnPrefab("player", { x, y, facing })` after
 * the scene loads.
 *
 * The factory builds the same component cocktail the engine's TS
 * version did — Position, Facing, Movement, PlayerInput, Aim, Weapon,
 * Inventory, Camera, MinimapMarker — using component refs and helpers
 * the ModAPI exposes (no engine imports). Inventory is seeded from
 * the pack manifest's `defaultInventory` block.
 *
 * Boot order is fixed by the engine: `runPackScripts()` runs (and so
 * this `registerPrefab` call lands) BEFORE `spawnInitialEntities()`
 * invokes the prefab. If you reorder by hand and the player ever
 * fails to register, `api.spawnPrefab` throws a clear error.
 */
export default (api) => {
  // DEFAULT_CAMERA was a small constant in `packages/engine/src/Prefabs/
  // defaults.ts`. Nothing else needed it, so it folds in here as a
  // local — built from the live `api.config.camera` block so settings
  // overrides still take effect on first spawn.
  const defaultCamera = () => ({
    fov: (api.config.camera.fovDegrees * Math.PI) / 180,
    ceiling: api.config.camera.ceiling,
    floor: api.config.camera.floor,
    fogDistance: api.config.camera.fogDistance,
    maxRaySteps: api.config.camera.maxRaySteps,
    cameraZ: 0.5,
  });

  api.registerPrefab("player", (opts = {}) => {
    const { x = 1.5, y = 1.5, facing = 0 } = opts;
    const world = api.world;
    const C = api.components;
    const cfg = api.config;
    const manifest = api.pack.manifest;

    const entity = world.spawn();

    const inventory = {
      bag: new Array(api.inventory.BAG_SIZE).fill(null),
      hotbar: new Array(api.inventory.HOTBAR_SIZE).fill(null),
      equipment: api.inventory.emptyEquipment(),
      activeHotbarIndex: 0,
    };
    api.inventory.seedInventory(inventory, manifest, manifest.defaultInventory ?? []);

    world
      .add(entity, C.Position, new api.Vec2(x, y))
      .add(entity, C.Facing, facing)
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
      .add(entity, C.Aim, { screenY: 0 })
      .add(entity, C.Weapon, {
        lastFireTime: -100,
        walkPhase: 0,
        wasFiring: false,
        reloadStart: -Infinity,
      })
      .add(entity, C.Inventory, inventory)
      .add(entity, C.Camera, defaultCamera())
      .add(entity, C.MinimapMarker, {
        color: cfg.minimap.playerMarker.color,
        radius: cfg.minimap.playerMarker.radius,
        drawForwardRay: true,
      });

    return entity;
  });
};
