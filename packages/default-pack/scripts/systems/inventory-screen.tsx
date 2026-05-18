/* @jsxImportSource preact */
import type { ModAPI } from "@two_5_d/engine";
import { InventoryScreen } from "../ui/InventoryScreen";

/**
 * Default pack — InventoryScreenSystem.
 *
 * Reads the player's carrier + container entities and hands the modal
 * a flat view: hotbar + backpack as `(item entity id | null)[]`, plus
 * the world ref so the modal can reach component data per slot.
 *
 * Toggle = KeyE (default). Held-state suppression mirrors the pre-R4
 * engine system: while another modal is open we don't react.
 */
export default (api: ModAPI) => {
  const liveProps = () => {
    const C = api.components;
    const player = api.world.first(C.PlayerInput, C.Carrier);
    const carrier = player !== undefined ? C.Carrier.get(player) : undefined;
    const hotbarId = carrier?.hotbar;
    const backpackId = carrier?.backpack;
    const hotbarInv = typeof hotbarId === "number" ? C.Inventory.get(hotbarId) : undefined;
    const backpackInv = typeof backpackId === "number" ? C.Inventory.get(backpackId) : undefined;
    const activeSlot = typeof hotbarId === "number" ? C.ActiveSlot.get(hotbarId) : undefined;
    return {
      world: api.world,
      C,
      icons: api.itemImages,
      hotbarSlots: hotbarInv?.slots ?? [],
      hotbarCapacity: hotbarInv?.capacity ?? 0,
      backpackSlots: backpackInv?.slots ?? [],
      backpackCapacity: backpackInv?.capacity ?? 0,
      activeIndex: activeSlot?.index ?? 0,
      onClose: () => {
        api.modals.setOpen("inventory", false);
      },
    };
  };

  api.ui.registerModal("inventory", InventoryScreen, liveProps);

  let wasToggleHeld = false;

  api.registerSystem((world) => {
    const blocked = api.modals.anyOther("inventory");
    const toggleHeld = api.input.keyboard.isKeyPressed("KeyE") && !blocked;
    if (toggleHeld && !wasToggleHeld) {
      const isOpen = api.modals.isOpen("inventory");
      if (isOpen) {
        api.modals.setOpen("inventory", false);
      } else {
        const player = world.first(api.components.PlayerInput, api.components.Carrier);
        if (player !== undefined) {
          api.modals.setOpen("inventory", true);
          document.exitPointerLock();
        }
      }
    }
    wasToggleHeld = toggleHeld;
  });
};
