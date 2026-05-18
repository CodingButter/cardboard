/**
 * Default-pack inventory helpers (entity-ref model).
 *
 * Inventory is now a generic container component on a separate entity:
 *
 *   container { slots: (entityId|null)[], capacity: number }
 *
 * The carrier (player) references containers by id via the `Carrier`
 * component: `{ hotbar: <entityId>, backpack: <entityId> }`. Item
 * entities carry `Item` + `Stackable` (+ optional `Equippable` /
 * `Weapon`) components. Moving an item is just writing its entity id
 * into a slot.
 *
 * Why this lives pack-side: per `ENGINE_PACK_SPLIT` the engine doesn't
 * know what "inventory" or "carrier" mean — those are gameplay
 * concepts. Pack scripts `import { ... } from "../lib/inventory.js"`.
 */

/** Equipment slot names — drives Equippable validation in the modal. */
export const EQUIP_SLOTS = [
  "helmet",
  "chest",
  "gloves",
  "legs",
  "feet",
  "mainHand",
  "offHand",
  "ring1",
  "ring2",
  "amulet",
];

/**
 * Read the (entity-id) slot at `index` from a container entity.
 * Returns the slot value (entity id) or `null` if empty / OOB.
 */
export function getSlot(world, containerEntity, index, C) {
  const inv = C.Inventory.get(containerEntity);
  if (!inv) return null;
  const slot = inv.slots[index];
  return typeof slot === "number" ? slot : null;
}

/** Write `entityId` (or `null`) into slot `index` of the container. */
export function setSlot(world, containerEntity, index, entityId, C) {
  const inv = C.Inventory.get(containerEntity);
  if (!inv) return;
  // Defensive: extend slots[] if a pack mis-authored a too-short array
  // relative to capacity. Cheap; one-shot. Keeps writes safe.
  while (inv.slots.length < inv.capacity) inv.slots.push(null);
  if (index >= 0 && index < inv.slots.length) {
    inv.slots[index] = entityId;
  }
}

/**
 * Find the index of the first empty (`null`) slot in a container.
 * Returns `-1` when full.
 */
export function findEmptySlot(world, containerEntity, C) {
  const inv = C.Inventory.get(containerEntity);
  if (!inv) return -1;
  for (let i = 0; i < inv.capacity; i++) {
    if (inv.slots[i] == null) return i;
  }
  return -1;
}

/**
 * Try to add `itemEntity` to the container, stacking onto an existing
 * matching stackable entity (same `Item.itemId`) up to its `Stackable.max`
 * before falling back to an empty slot. Returns `true` if placed (in
 * any way), `false` if no room.
 *
 * If the item merged into an existing stack the source `itemEntity` is
 * despawned (its data was consumed by the stack); otherwise it's just
 * written into the new slot.
 */
export function addItemEntity(world, containerEntity, itemEntity, C) {
  const inv = C.Inventory.get(containerEntity);
  const srcItem = C.Item.get(itemEntity);
  const srcStack = C.Stackable.get(itemEntity);
  if (!inv || !srcItem) return false;

  // Try to merge onto an existing matching stack first (only when
  // both stacks are stackable and the source is not a weapon — weapons
  // carry per-instance Weapon state and never merge).
  const isWeapon = C.Weapon.has(itemEntity);
  if (srcStack && !isWeapon) {
    for (let i = 0; i < inv.capacity; i++) {
      const otherId = inv.slots[i];
      if (typeof otherId !== "number") continue;
      const otherItem = C.Item.get(otherId);
      const otherStack = C.Stackable.get(otherId);
      if (!otherItem || !otherStack) continue;
      if (otherItem.itemId !== srcItem.itemId) continue;
      if (C.Weapon.has(otherId)) continue;
      const room = otherStack.max - otherStack.count;
      if (room <= 0) continue;
      const take = Math.min(room, srcStack.count);
      otherStack.count += take;
      srcStack.count -= take;
      if (srcStack.count === 0) {
        world.despawn(itemEntity);
        return true;
      }
    }
  }

  // Fall through to drop into the first empty slot.
  const free = findEmptySlot(world, containerEntity, C);
  if (free === -1) return false;
  setSlot(world, containerEntity, free, itemEntity, C);
  return true;
}

/**
 * Sum the `Stackable.count` of every entity in `containerEntity` whose
 * `Item.itemId` matches `itemId`. Used by gun-render's ammo reserve
 * readout.
 */
export function countItemId(world, containerEntity, itemId, C) {
  if (typeof containerEntity !== "number") return 0;
  const inv = C.Inventory.get(containerEntity);
  if (!inv) return 0;
  let total = 0;
  for (let i = 0; i < inv.capacity; i++) {
    const id = inv.slots[i];
    if (typeof id !== "number") continue;
    const item = C.Item.get(id);
    const stack = C.Stackable.get(id);
    if (!item || !stack) continue;
    if (item.itemId === itemId) total += stack.count;
  }
  return total;
}

/**
 * Remove up to `count` of `itemId` across the carrier's containers
 * (hotbar + backpack). Returns the number actually removed. Entities
 * whose `Stackable.count` drops to 0 are despawned + their slot
 * cleared. Used by gun-render to pull rifle_ammo on reload.
 */
export function removeItemId(world, carrierEntity, itemId, count, C) {
  const carrier = C.Carrier.get(carrierEntity);
  if (!carrier) return 0;
  let remaining = count;
  const containers = [carrier.backpack, carrier.hotbar].filter(
    (id) => typeof id === "number",
  );
  for (const containerId of containers) {
    if (remaining <= 0) break;
    const inv = C.Inventory.get(containerId);
    if (!inv) continue;
    for (let i = 0; i < inv.capacity; i++) {
      if (remaining <= 0) break;
      const itemEntity = inv.slots[i];
      if (typeof itemEntity !== "number") continue;
      const item = C.Item.get(itemEntity);
      const stack = C.Stackable.get(itemEntity);
      if (!item || !stack) continue;
      if (item.itemId !== itemId) continue;
      const take = Math.min(stack.count, remaining);
      stack.count -= take;
      remaining -= take;
      if (stack.count === 0) {
        inv.slots[i] = null;
        world.despawn(itemEntity);
      }
    }
  }
  return count - remaining;
}

/**
 * Read the currently-active item entity from a carrier: looks up its
 * hotbar container, reads `ActiveSlot.index`, returns `slots[index]`.
 * `null` when the slot is empty or any component is missing.
 */
export function getActiveItemEntity(world, carrierEntity, C) {
  const carrier = C.Carrier.get(carrierEntity);
  if (!carrier || typeof carrier.hotbar !== "number") return null;
  const inv = C.Inventory.get(carrier.hotbar);
  const active = C.ActiveSlot.get(carrier.hotbar);
  if (!inv || !active) return null;
  const slot = inv.slots[active.index];
  return typeof slot === "number" ? slot : null;
}

/**
 * Spawn a fresh item entity from the registry. Reads the ItemDef
 * (`api.singleton("ItemRegistry").byId`) and attaches `Item`,
 * `Stackable`, optional `Equippable`, optional `Weapon`. Returns the
 * new entity id, or `undefined` if the id is unknown.
 *
 * Used at pickup time (pickup.js spawns a new item entity from the
 * world-pickup record's `itemId`).
 */
export function spawnItemFromRegistry(api, itemId, count = 1) {
  const C = api.components;
  const registry = api.singleton("ItemRegistry");
  const def = registry?.byId?.[itemId];
  if (!def) {
    console.warn(`spawnItemFromRegistry: unknown itemId "${itemId}"`);
    return undefined;
  }
  const entity = api.world.spawn();
  api.world.add(entity, C.Item, {
    itemId,
    displayName: def.name,
    image: def.image,
    type: def.type,
    equipSlot: def.equipSlot,
    worldSpriteId: def.worldSpriteId,
  });
  const stackMax =
    def.stackMax !== undefined
      ? def.stackMax
      : def.type === "weapon" || def.type === "armor"
        ? 1
        : 64;
  api.world.add(entity, C.Stackable, { count, max: stackMax });
  if (def.equipSlot) {
    api.world.add(entity, C.Equippable, { slot: def.equipSlot });
  }
  if (def.type === "weapon" && def.weapon) {
    const w = def.weapon;
    const magSize = w.magazineSize ?? 0;
    const startingMag = w.startingMag ?? magSize;
    api.world.add(entity, C.Weapon, {
      fireRate: w.fireRate ?? 0,
      magazineSize: magSize,
      reloadTime: w.reloadTime ?? 1.5,
      ammoItem: w.ammoItem ?? "",
      mag: startingMag,
      lastFireTime: -100,
      walkPhase: 0,
      wasFiring: false,
      reloadStart: -1,
    });
  }
  return entity;
}
