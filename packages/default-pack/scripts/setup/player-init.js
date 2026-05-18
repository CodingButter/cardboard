/**
 * Default-pack player init — entity-attach script (WORLD_STATE.md §8).
 *
 * Runs ONCE during boot when the engine spawns the `player` entity
 * declared in `world.json.entities[]`. The world.json record carries
 * the stable shape (Position / Facing / Aim) — this script attaches
 * the runtime-dependent components (Movement / PlayerInput / Weapon /
 * Camera / MinimapMarker / Inventory) that need `api.config` +
 * `api.pack.manifest` at attach time. Those fields aren't safe in a
 * static scene record because:
 *
 *   - Weapon.reloadStart is `-Infinity`, which JSON-stringifies to
 *     `null` and would lose its "haven't reloaded yet" sentinel.
 *   - Inventory is built by `api.inventory.seedInventory`, which
 *     deduplicates against `manifest.defaultInventory` and the
 *     per-item `stackMax` defaults from the live registry.
 *   - PlayerInput.bindings, Movement.{speed,…}, Camera.{fov,…} all
 *     read from `api.config` which is the merged baseline + pack
 *     overlay — capturing those at scene-author time would freeze the
 *     pack-author's overrides into the JSON.
 *
 * The player is persistent across scene swaps (engine marks every
 * world.json.entities[] entry `_worldPersistent` and the scene-unload
 * despawn pass skips them). `scripts/systems/scene-transition.js`
 * subscribes to `scene:loaded` and repositions the player by reading
 * the active scene-controller's `SpawnerList.points[0]`.
 *
 * Signature: `(entity, world, api) => void`.
 */
export default function playerInit(entity, world, api) {
  const C = api.components;
  const cfg = api.config;
  const manifest = api.pack.manifest;

  // Inventory — seeded from `manifest.defaultInventory`. Mirrors what
  // the deprecated `player-spawn.js` boot script did before this
  // entity-attach refactor.
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
      // sentinel; it would JSON.stringify to `null` in a static
      // scene record, so Weapon stays imperative.
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
