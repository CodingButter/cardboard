import { Component } from "ECS";
import type { InventoryShape } from "Libs/Inventory";

/**
 * What the player is carrying. Generic item-based model: every weapon,
 * piece of ammo, armor, or consumable is an `ItemStack` referencing an
 * entry in the active pack's `manifest.items`.
 *
 *   - `bag` is the backpack grid (27 slots, 3×9). Sparse — empty
 *     slots are `null`.
 *   - `hotbar` is the quick-access bar (9 slots, Digit1..Digit9).
 *     Sparse. `hotbar[activeHotbarIndex]` is the wielded item — the
 *     `GunRenderSystem` reads it to decide which viewmodel to draw.
 *   - `equipment` is the worn gear (10 named slots — see `EQUIP_SLOTS`).
 *     Dense — every key is present, value is `null` when empty. Items
 *     here apply passive effects (armor reduces damage, etc.) once
 *     those mechanics ship.
 *
 * `WeaponData` (below) stays — it's the animation state of whichever
 * weapon is currently active. Per-weapon ammo state (`mag`) lives on
 * the `ItemStack` itself.
 */
export interface InventoryData extends InventoryShape {}
export const Inventory = new Component<InventoryData>("Inventory");
