/**
 * Default-pack player init — entity-attach script (WORLD_STATE.md §8).
 *
 * Runs ONCE during boot when the engine spawns the `player` entity
 * declared in `world.json.entities[]`. The world.json record carries
 * the stable shape (Position / Facing / Aim / Carrier) plus its
 * container + item entities — this script attaches the runtime-
 * dependent components (Movement / PlayerInput / Camera / MinimapMarker)
 * that need `api.config` at attach time. Those fields aren't safe in a
 * static scene record because they read from `api.config` which is the
 * merged baseline + pack overlay; capturing those at scene-author time
 * would freeze the pack-author's overrides into the JSON.
 *
 * Inventory + Weapon state are NOT seeded here — they live on dedicated
 * entities (id 2 = hotbar container, id 3 = backpack container, id 4 =
 * starter_rifle, id 5 = starter_rifle_ammo) declared in world.json with
 * `Inventory` / `Item` / `Stackable` / `Weapon` components. The player's
 * `Carrier` references the container entities; the carry-system pulls
 * the held item entity via `Carrier.hotbar → ActiveSlot.index → slots[]`.
 *
 * The player is persistent across scene swaps (engine marks every
 * world.json.entities[] entry persistent and the scene-unload despawn
 * pass skips them). `scripts/systems/scene-transition.js` subscribes to
 * `scene:loaded` and repositions the player by reading the active
 * scene-controller's `SpawnerList.points[0]`.
 *
 * Signature: `(entity, world, api) => void`.
 */
export default function playerInit(entity, world, api) {
  const C = api.components;
  const cfg = api.config;

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
