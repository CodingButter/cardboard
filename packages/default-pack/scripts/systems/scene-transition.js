/**
 * Default-pack scene-transition system (world-scope script,
 * WORLD_STATE.md §6.2 + §11.3 + "world.json full-scope" 2026-05-17).
 *
 * Repositions the persistent `player` entity at the active scene's
 * `controller.components.SpawnerList.points[0]` whenever
 * `scene:loaded` fires. The player itself spawns ONCE at boot from
 * `world.json.entities[]` and survives every scene swap (the engine's
 * scene-unload pass skips persistent world entities); this script is
 * what bridges the swap by reading the new scene-controller's spawn
 * point and updating the player's Position + Facing.
 *
 * Subscribes during world-script boot (runs before the first
 * scene:loaded fires), so the very first scene-load also routes
 * through this handler — there's no separate boot-time spawn path.
 */
export default function setup(api) {
  api.events.on("scene:loaded", () => {
    const player = api.world.findByName("player");
    if (player === undefined) {
      console.warn(
        "[scene-transition] no entity named 'player' — scene swap left position untouched.",
      );
      return;
    }
    const point = api.scene.controller?.components?.SpawnerList?.points?.[0];
    if (!point) {
      console.warn(
        "[scene-transition] active scene has no controller.SpawnerList.points[0] — " +
          "player position untouched.",
      );
      return;
    }
    const C = api.components;
    api.world
      .add(player, C.Position, new api.Vec2(point.x, point.y))
      .add(player, C.Facing, point.facing ?? 0);
  });
}
