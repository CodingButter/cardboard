import type {
  DefaultInventoryEntry,
  EquipSlot,
  ItemDef,
  ItemStack,
} from "AssetPack";
import { EQUIP_SLOTS } from "AssetPack";

/**
 * Item-definition lookup table. Keyed by item id, value is the full
 * `ItemDef`. The pack-side `scripts/setup/load-items.js` populates
 * `api.singleton("ItemRegistry").byId` with exactly this shape from
 * `data/items.json`; the helpers below accept it as a parameter so the
 * engine surface stays decoupled from "where the catalog lives".
 *
 * Pre-refactor this came from `manifest.items` — but per the
 * engine/pack split items are pack data, not manifest data.
 */
export type ItemRegistryById = Readonly<Record<string, ItemDef>>;

/**
 * Pure helpers for manipulating the player's `Inventory` component.
 * Kept out of the component file itself so the data shape stays small
 * and the logic is unit-test-friendly. Every function operates on a
 * shared `InventoryShape` interface so the helpers don't depend on the
 * ECS layer.
 *
 * Conventions:
 * - `bag` and `hotbar` are sparse: empty slots are `null`.
 * - `equipment` is dense: every slot exists in the map (null when empty).
 * - Item identity for stacking is `itemId` *plus* "this is a stackable
 *   type" — weapon instances never merge because their `mag` is
 *   per-instance state.
 */

/** Default backpack size, in slots. 3 rows of 9 (Minecraft). */
export const BAG_SIZE = 27;
/** Hotbar size — matches Digit1..Digit9 keys. */
export const HOTBAR_SIZE = 9;

export interface InventoryShape {
  bag: (ItemStack | null)[];
  hotbar: (ItemStack | null)[];
  equipment: Record<EquipSlot, ItemStack | null>;
  activeHotbarIndex: number;
}

/** Return the item currently in the active hotbar slot, or `null`. */
export function getActiveItem(inv: InventoryShape): ItemStack | null {
  return inv.hotbar[inv.activeHotbarIndex] ?? null;
}

/** Build the default-stack-max for an item def. */
export function defaultStackMax(def: ItemDef): number {
  if (def.stackMax !== undefined) return def.stackMax;
  switch (def.type) {
    case "weapon":
    case "armor":
      return 1;
    case "ammo":
    case "misc":
      return 64;
  }
}

// ─── DEBUG instrumentation ──────────────────────────────────────────
// Bug report under investigation: "ammo should be available for a
// weapon even if it's in your hotbar; right now it seems to only pull
// for items in the backpack." Static analysis suggests the helpers
// below are correct, so we log the live inventory state on every
// `countItem` and `removeItem` call. Open DevTools console, fire
// shots, press R to reload, then verify the printed inventory.
//
// REMOVE THESE LOGS once the bug is identified.
const INVENTORY_DEBUG = true;
function debugSummary(inv: InventoryShape, itemId: string): string {
  const sum = (list: ReadonlyArray<ItemStack | null>) =>
    list
      .map((s, i) => (s ? `[${i}]${s.itemId}×${s.count}${s.mag !== undefined ? `(mag${s.mag})` : ""}` : null))
      .filter((v) => v !== null)
      .join(" ");
  return `id="${itemId}" hotbar=${sum(inv.hotbar) || "(empty)"} bag=${sum(inv.bag) || "(empty)"}`;
}

/** Sum of `count` for every stack of `itemId` in bag + hotbar. */
export function countItem(inv: InventoryShape, itemId: string): number {
  let total = 0;
  for (const slot of inv.bag) if (slot?.itemId === itemId) total += slot.count;
  for (const slot of inv.hotbar) if (slot?.itemId === itemId) total += slot.count;
  if (INVENTORY_DEBUG && itemId === "rifle_ammo") {
    // Throttle: only log when total is "interesting" — first call per
    // animation frame would flood. Use a low-frequency stamp instead.
    if (Math.random() < 0.005) {
      console.log(`[inv.countItem] total=${total} ${debugSummary(inv, itemId)}`);
    }
  }
  return total;
}

/**
 * Remove up to `count` of `itemId` from bag + hotbar (bag first).
 * Returns the number actually removed. Items in equipment slots are
 * NOT touched — they're considered "in use" and reload-pulls etc.
 * shouldn't dismantle the player's gear.
 */
export function removeItem(inv: InventoryShape, itemId: string, count: number): number {
  if (INVENTORY_DEBUG) {
    console.log(`[inv.removeItem] BEFORE want=${count} ${debugSummary(inv, itemId)}`);
  }
  let remaining = count;
  for (const list of [inv.bag, inv.hotbar]) {
    for (let i = 0; i < list.length; i++) {
      if (remaining <= 0) {
        if (INVENTORY_DEBUG) {
          console.log(`[inv.removeItem] AFTER  got=${count} ${debugSummary(inv, itemId)}`);
        }
        return count;
      }
      const slot = list[i];
      if (slot?.itemId === itemId) {
        const take = Math.min(slot.count, remaining);
        slot.count -= take;
        remaining -= take;
        if (slot.count === 0) list[i] = null;
      }
    }
  }
  if (INVENTORY_DEBUG) {
    console.log(`[inv.removeItem] AFTER  got=${count - remaining} ${debugSummary(inv, itemId)}`);
  }
  return count - remaining;
}

/**
 * Try to insert `count` of `itemId` into the inventory. Stacks onto
 * existing matching stacks first (when stackable), then drops into
 * empty hotbar slots, then empty bag slots. Returns the leftover —
 * how many couldn't fit. Callers can drop those back onto the floor.
 *
 * The optional `mag` argument is only meaningful for weapon items —
 * it sets the loaded-round count of the new weapon instance. Weapon
 * stacks are never merged (each has independent mag state).
 */
export function addItem(
  inv: InventoryShape,
  items: ItemRegistryById,
  itemId: string,
  count: number,
  mag?: number,
): number {
  const def = items[itemId];
  if (!def) {
    console.warn(`addItem: unknown item "${itemId}"`);
    return count;
  }
  const stackMax = defaultStackMax(def);
  let remaining = count;

  const canMerge = def.type !== "weapon" && mag === undefined;
  if (canMerge) {
    for (const list of [inv.hotbar, inv.bag]) {
      for (const slot of list) {
        if (remaining <= 0) break;
        if (slot && slot.itemId === itemId && slot.count < stackMax) {
          const room = stackMax - slot.count;
          const take = Math.min(room, remaining);
          slot.count += take;
          remaining -= take;
        }
      }
    }
  }

  for (const list of [inv.hotbar, inv.bag]) {
    for (let i = 0; i < list.length; i++) {
      if (remaining <= 0) break;
      if (list[i] === null) {
        const take = canMerge ? Math.min(stackMax, remaining) : 1;
        const stack: ItemStack = { itemId, count: take };
        if (mag !== undefined) stack.mag = mag;
        list[i] = stack;
        remaining -= take;
      }
    }
  }

  return remaining;
}

/** Build the empty equipment map (every slot present, every slot null). */
export function emptyEquipment(): Record<EquipSlot, ItemStack | null> {
  const out = {} as Record<EquipSlot, ItemStack | null>;
  for (const slot of EQUIP_SLOTS) out[slot] = null;
  return out;
}

/**
 * Apply a pack's default-inventory recipe to a fresh inventory. Handles
 * both the bare-id shorthand and the structured-entry form; entries
 * with an explicit `slot` honor placement, otherwise items go through
 * `addItem` for stacking + auto-fill.
 *
 * `items` is the `ItemRegistry.byId` map populated by the pack-side
 * `scripts/setup/load-items.js` from `data/items.json`. The recipe
 * itself comes from `data/default-inventory.json` (also loaded by that
 * setup script and exposed via `api.singleton("DefaultInventoryRecipe").entries`).
 */
export function seedInventory(
  inv: InventoryShape,
  items: ItemRegistryById,
  entries: ReadonlyArray<string | DefaultInventoryEntry>,
): void {
  for (const raw of entries) {
    const entry: DefaultInventoryEntry =
      typeof raw === "string" ? { itemId: raw, count: 1 } : raw;
    const def = items[entry.itemId];
    if (!def) {
      console.warn(`seedInventory: unknown item "${entry.itemId}" — skipping`);
      continue;
    }
    const count = entry.count ?? 1;
    const mag = def.type === "weapon"
      ? def.weapon?.startingMag ?? def.weapon?.magazineSize ?? 0
      : undefined;
    if (entry.slot) {
      placeAtSlot(inv, entry.slot, { itemId: entry.itemId, count, ...(mag !== undefined ? { mag } : {}) });
    } else {
      addItem(inv, items, entry.itemId, count, mag);
    }
  }
}

/**
 * Move a stack from one "side" of the inventory to the other in one
 * shot. Bag ↔ hotbar; equipment slots route to the bag. Stacks merge
 * onto matching partial stacks on the destination first, then fall
 * into empty slots. Leftover stays at the source.
 *
 * This is the shift-click handler — pure data mutation, the UI just
 * triggers it and re-renders.
 */
export function quickTransfer(
  inv: InventoryShape,
  items: ItemRegistryById,
  from: "bag" | "hotbar" | "equipment",
  fromIndex: number | EquipSlot,
): void {
  let source: ItemStack | null;
  let clearSource: () => void;
  if (from === "bag") {
    const i = fromIndex as number;
    source = inv.bag[i] ?? null;
    clearSource = () => (inv.bag[i] = null);
  } else if (from === "hotbar") {
    const i = fromIndex as number;
    source = inv.hotbar[i] ?? null;
    clearSource = () => (inv.hotbar[i] = null);
  } else {
    const s = fromIndex as EquipSlot;
    source = inv.equipment[s];
    clearSource = () => (inv.equipment[s] = null);
  }
  if (!source) return;
  const def = items[source.itemId];
  if (!def) return;

  // Default destination — opposite side for bag/hotbar; equipment
  // unequips into the bag.
  const target =
    from === "bag" ? inv.hotbar : from === "hotbar" ? inv.bag : inv.bag;
  const stackMax = defaultStackMax(def);
  const canMerge = def.type !== "weapon" && source.mag === undefined;
  let remaining = source.count;

  if (canMerge) {
    for (const slot of target) {
      if (remaining <= 0) break;
      if (slot && slot.itemId === source.itemId && slot.count < stackMax) {
        const room = stackMax - slot.count;
        const take = Math.min(room, remaining);
        slot.count += take;
        remaining -= take;
      }
    }
  }

  for (let i = 0; i < target.length; i++) {
    if (remaining <= 0) break;
    if (target[i] === null) {
      const take = canMerge ? Math.min(stackMax, remaining) : remaining;
      const stack: ItemStack = { itemId: source.itemId, count: take };
      if (source.mag !== undefined) stack.mag = source.mag;
      target[i] = stack;
      remaining -= take;
      if (!canMerge) break; // weapons take only their single instance
    }
  }

  if (remaining === 0) clearSource();
  else source.count = remaining;
}

/** Place a stack at a specific slot reference. Overwrites any prior contents. */
function placeAtSlot(inv: InventoryShape, slot: string, stack: ItemStack): void {
  const [kind, key] = slot.split(":");
  if (kind === "hotbar") {
    const i = Number(key);
    if (i >= 0 && i < inv.hotbar.length) inv.hotbar[i] = stack;
  } else if (kind === "bag") {
    const i = Number(key);
    if (i >= 0 && i < inv.bag.length) inv.bag[i] = stack;
  } else if (kind === "equip" && key && (EQUIP_SLOTS as readonly string[]).includes(key)) {
    inv.equipment[key as EquipSlot] = stack;
  } else {
    console.warn(`defaultInventory: bad slot "${slot}"`);
  }
}
