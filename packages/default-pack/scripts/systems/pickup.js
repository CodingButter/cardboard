/**
 * Default pack — PickupSystem.
 *
 * Walk-to-collect: each frame, measure squared distance from every
 * player entity to every `Position + Pickup` entity and grant the item
 * once they're within `PICKUP_RADIUS`. The grant routes through
 * `api.inventory.addItem`, which respects stack limits + the bag/hotbar
 * layout — leftover (e.g. "you tried to pick up 30 rounds but only had
 * room for 12") stays on the pickup entity, so partial grabs leave a
 * smaller pile behind to come back to.
 */
const PICKUP_RADIUS = 0.5;

export default (api) => {
  const C = api.components;
  const inv = api.inventory;

  api.registerSystem((world) => {
    const radiusSq = PICKUP_RADIUS * PICKUP_RADIUS;

    world.each(
      C.PlayerInput, C.Position, C.Inventory,
      (_player, _input, playerPos, inventory) => {
        world.each(C.Position, C.Pickup, (entity, pos, pickup) => {
          const dx = pos.x - playerPos.x;
          const dy = pos.y - playerPos.y;
          if (dx * dx + dy * dy > radiusSq) return;

          const leftover = inv.addItem(
            inventory,
            api.pack.manifest,
            pickup.itemId,
            pickup.count,
          );
          const taken = pickup.count - leftover;
          if (taken === 0) return; // full inventory — leave the pile

          pickup.count = leftover;
          // Au1 of AUDIO.md — chime on successful pickup. Plays for
          // every partial-stack grab too; mass-collect of a pile fires
          // once per frame the inventory accepts items.
          api.audio.play("pickup");
          // Ev1 of EVENTS.md §4.8 — fire `pickup:collected` only when
          // the pile fully drains, matching the spec's "partial
          // pickups don't fire" rule. Other packs subscribe by the
          // canonical name to react (e.g. notification overlay, score
          // tracker).
          if (pickup.count === 0) {
            api.events.emit("pickup:collected", {
              player: _player,
              itemId: pickup.itemId,
              count: taken,
            });
            world.despawn(entity);
          }
        });
      },
    );
  });
};
