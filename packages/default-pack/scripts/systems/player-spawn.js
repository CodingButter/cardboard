/**
 * Default-pack player spawn — boot script.
 *
 * PE3 of `docs/plans/PREFABS_EDITOR_ONLY.md` (initial migration) +
 * WORLD_STATE.md §11.3 (controller-aware revision). The engine no
 * longer hosts a runtime prefab registry — every entity it ever sees
 * either ships in `scene.entities[]` (fully flattened) or gets spawned
 * by a regular pack script. The player entity reads `api.config` /
 * `api.pack.manifest` at spawn time so it can't live in a static
 * scene record; the boot-script path replaces the old
 * `api.spawnPrefab("player", ...)` call exactly.
 *
 * After WORLD_STATE: the spawn point is sourced from the scene
 * controller's `SpawnerList` component
 * (`api.scene.controller.components.SpawnerList.points[0]`) instead
 * of the legacy top-level `api.scene.spawn` field. Both fields
 * resolve to the same value today — `Scene.fromJSON` synthesises a
 * one-point SpawnerList from the legacy `spawn:` field when a
 * scene's controller doesn't declare one explicitly. New authoring
 * goes through the controller; this script reads it.
 *
 * Boot order:
 *
 *   runPackScripts() → world:ready → Game.spawnSceneController()
 *     → Game.spawnInitialEntities()
 *     → walk scene.entities[]
 *     → fire every queued api.onWorldReady callback (incl. this one)
 *     → emit scene:loaded / pack:loaded
 *
 * The `onWorldReady` callback runs once per `Game` lifetime; the
 * `scene:loaded` listener re-spawns the player every time the user
 * switches scenes. Scene swaps via `Game.loadScene` keep the
 * existing player entity (its `Position` is reset by Game's own
 * post-swap logic) — they do not re-run the boot-flow spawn here.
 */
export default (api) => {
  const spawnPlayer = () => {
    const world = api.world;
    const C = api.components;
    const cfg = api.config;
    const manifest = api.pack.manifest;

    // WORLD_STATE.md §11.3 — spawn point sourced from the scene
    // controller's SpawnerList. The engine synthesises a one-point
    // SpawnerList for legacy scenes that ship only `spawn:` at the
    // top level so this read is safe regardless of scene-author
    // vintage.
    const list = api.scene.controller?.components?.SpawnerList;
    const point = list?.points?.[0];
    if (!point) {
      console.warn(
        "[player-spawn] active scene has no SpawnerList on its controller " +
          "and no legacy `spawn:` field — falling back to (1.5, 1.5).",
      );
    }
    const x = point?.x ?? 1.5;
    const y = point?.y ?? 1.5;
    const facing = point?.facing ?? 0;

    // Don't double-spawn — the player survives scene swaps via the
    // engine's existing position-reset path. Boot-time run is the
    // only call site that creates the entity.
    if (world.first(C.PlayerInput) !== undefined) return;

    // Inventory — seeded from `manifest.defaultInventory`. Uses
    // `api.inventory.*` helpers that aren't available at scene-JSON
    // authoring time.
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

    const player = world.spawn();
    world
      .add(player, C.Position, new api.Vec2(x, y))
      .add(player, C.Facing, facing)
      .add(player, C.Aim, { screenY: 0 })
      .add(player, C.Movement, {
        speed: cfg.player.speed,
        rotationSpeed: cfg.player.rotationSpeed,
        runMultiplier: cfg.player.runMultiplier,
        isRunning: false,
        z: 0,
        vz: 0,
        crouching: false,
      })
      .add(player, C.PlayerInput, { bindings: cfg.bindings })
      .add(player, C.Weapon, {
        // `-Infinity` is the load-bearing "haven't reloaded yet"
        // sentinel; it would JSON.stringify to `null` in a static
        // scene record, so Weapon stays imperative.
        lastFireTime: -100,
        walkPhase: 0,
        wasFiring: false,
        reloadStart: -Infinity,
      })
      .add(player, C.Inventory, inventory)
      .add(player, C.Camera, {
        fov: (cfg.camera.fovDegrees * Math.PI) / 180,
        ceiling: cfg.camera.ceiling,
        floor: cfg.camera.floor,
        fogDistance: cfg.camera.fogDistance,
        maxRaySteps: cfg.camera.maxRaySteps,
        cameraZ: 0.5,
      })
      .add(player, C.MinimapMarker, {
        color: cfg.minimap.playerMarker.color,
        radius: cfg.minimap.playerMarker.radius,
        drawForwardRay: true,
      });

    // Mirror the canonical `entity:spawned` event the old
    // declarative-prefab path emitted. Subscribers identify the
    // player by the `name` field.
    api.events.emit("entity:spawned", { entity: player, name: "player" });
  };

  api.onWorldReady(spawnPlayer);
};
