/**
 * Default pack — PickupSystem.
 *
 * Walk-to-collect: each frame, measure squared distance from every
 * player entity (Carrier + Position) to every `Position + Pickup`
 * entity and grant the item once they're within `PICKUP_RADIUS`.
 *
 * Grant semantics in the entity-ref inventory model:
 *   1. Look up the player's hotbar container via `Carrier.hotbar`.
 *   2. Spawn a fresh Item entity from the pickup's `itemId` via
 *      `spawnItemFromRegistry` (so it has Item + Stackable + optional
 *      Weapon components).
 *   3. Try to merge that entity into the hotbar; on overflow, try the
 *      backpack.
 *   4. If the item merged into an existing stack, `addItemEntity`
 *      despawns the freshly-spawned entity automatically (its data was
 *      consumed). Otherwise it lives on as the slot's content.
 *
 * Note we no longer remove the original `Pickup` entity's `Position` /
 * `Sprite` — the pickup entity is just a marker in the WORLD, and is
 * despawned when fully consumed (same UX as before, the item entity
 * spawned into the player's inventory is a SEPARATE entity).
 */
import {
  addItemEntity,
  spawnItemFromRegistry,
} from "../lib/inventory.js";

const PICKUP_RADIUS = 0.5;

export default (api) => {
  const C = api.components;

  api.registerSystem((world) => {
    const radiusSq = PICKUP_RADIUS * PICKUP_RADIUS;

    world.each(
      C.PlayerInput, C.Position, C.Carrier,
      (player, _input, playerPos, carrier) => {
        world.each(C.Position, C.Pickup, (entity, pos, pickup) => {
          const dx = pos.x - playerPos.x;
          const dy = pos.y - playerPos.y;
          if (dx * dx + dy * dy > radiusSq) return;

          // Spawn a fresh item entity for the count we're trying to
          // grant; addItemEntity merges into existing stacks first, so
          // this works the same for stackables and weapons.
          const newItem = spawnItemFromRegistry(api, pickup.itemId, pickup.count);
          if (newItem === undefined) return;

          let placed = false;
          if (typeof carrier.hotbar === "number") {
            placed = addItemEntity(world, carrier.hotbar, newItem, C);
          }
          if (!placed && typeof carrier.backpack === "number") {
            placed = addItemEntity(world, carrier.backpack, newItem, C);
          }
          if (!placed) {
            // Inventory full — tear down the candidate item so it
            // doesn't leak. The pickup stays in the world.
            world.despawn(newItem);
            return;
          }

          // Successful pickup. Decrement the world pile (despawn at 0).
          const taken = pickup.count;
          pickup.count = 0;
          api.audio.play("pickup");
          api.events.emit("pickup:collected", {
            player,
            itemId: pickup.itemId,
            count: taken,
          });
          world.despawn(entity);
        });
      },
    );
  });
};
