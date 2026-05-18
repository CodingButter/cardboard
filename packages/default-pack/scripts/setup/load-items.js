/**
 * Default-pack item registry loader.
 *
 * Runs FIRST in `world.json.scripts[]` so the singleton it populates
 * (`ItemRegistry`) is available to every subsequent world-script and
 * to every entity-attach handler.
 *
 * The registry is the TEMPLATE source — at runtime, pickup.js + any
 * other code that needs to spawn a fresh item entity calls
 * `spawnItemFromRegistry(api, "rifle")` (see `scripts/lib/inventory.js`)
 * which reads from `ItemRegistry.byId` and creates an entity with the
 * standard components (`Item` + `Stackable` + optional `Equippable` +
 * optional `Weapon`).
 *
 * The starting inventory used to seed via a `default-inventory.json`
 * recipe; that's now declarative in `world.json` (the player carries a
 * hotbar + backpack entity, the hotbar starts with `starter_rifle` (id
 * 4), the backpack starts with `starter_rifle_ammo` (id 5)).
 *
 * Data file:
 *   - `data/items.json`              — `{ <itemId>: ItemDef, ... }`
 *
 * Exposed singleton:
 *   - `ItemRegistry.byId`            — `Record<string, ItemDef>`
 *
 * Engine integration: the engine's `ItemImages` cache exposes
 * `api.itemImages.loadFromRegistry(items)` which we call here so the
 * per-item icon/held/world variant discovery hits disk once.
 */
export default async (api) => {
  let items = {};
  try {
    const text = await api.pack.textBody("data/items.json");
    items = JSON.parse(text);
  } catch (err) {
    console.warn("[load-items] data/items.json missing or invalid:", err);
  }

  // Expose via singleton — other scripts read api.singleton("ItemRegistry").byId.
  const registry = api.singleton("ItemRegistry");
  registry.byId = items;

  // Trigger engine-side per-item image discovery now that the catalog
  // is known. The engine's ItemImages cache no longer auto-scans the
  // manifest at construction time — this hook lets the pack drive it.
  if (api.itemImages?.loadFromRegistry) {
    api.itemImages.loadFromRegistry(items);
  }
};
