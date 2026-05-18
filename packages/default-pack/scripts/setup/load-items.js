/**
 * Default-pack item + default-inventory loader.
 *
 * Runs FIRST in `world.json.scripts[]` so the singletons it populates
 * (`ItemRegistry`, `DefaultInventoryRecipe`) are available to every
 * subsequent world-script and to every entity-attach handler (e.g.
 * `scripts/setup/player-init.js`).
 *
 * Why this script exists: the manifest used to ship a top-level
 * `items` map and a `defaultInventory` array. Per the engine/pack
 * split those are GAME CONCEPTS, not engine concepts — the manifest
 * is for project identity + asset/type registries (sprites, audio,
 * shaders, tilesheets, prefab pointers). Game-side catalogs like
 * "items" and "what the player starts holding" belong to pack data
 * loaded by pack scripts.
 *
 * Data files:
 *   - `data/items.json`              — `{ <itemId>: ItemDef, ... }`
 *   - `data/default-inventory.json`  — `Array<string | DefaultInventoryEntry>`
 *
 * Exposed singletons (declared in `manifest.components[]`):
 *   - `ItemRegistry.byId`            — `Record<string, ItemDef>`
 *   - `DefaultInventoryRecipe.entries` — seed list for player-init.js
 *
 * Pack scripts read these via `api.singleton("ItemRegistry").byId` /
 * `api.singleton("DefaultInventoryRecipe").entries`. Mutation is
 * persisted on the live component reference.
 *
 * Engine integration: the engine's `ItemImages` cache used to scan
 * `manifest.items` in its constructor (before scripts run). After this
 * refactor it exposes `api.itemImages.loadFromRegistry(items)` which
 * we call here so the per-item icon/held/world variant discovery hits
 * the same disk loop without the manifest indirection.
 */
export default async (api) => {
  // ── Items ─────────────────────────────────────────────────────────
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

  // ── Default inventory ─────────────────────────────────────────────
  let entries = [];
  try {
    const text = await api.pack.textBody("data/default-inventory.json");
    entries = JSON.parse(text);
    if (!Array.isArray(entries)) entries = [];
  } catch (err) {
    console.warn("[load-items] data/default-inventory.json missing or invalid:", err);
  }
  const recipe = api.singleton("DefaultInventoryRecipe");
  recipe.entries = entries;
};
