/* @jsxImportSource preact */
import type { ModAPI } from "@two_5_d/engine";
import { InventoryScreen } from "../ui/InventoryScreen";

/**
 * Default pack — InventoryScreenSystem.
 *
 * Pack-side after R4. The component lives in `scripts/ui/InventoryScreen.tsx`
 * and is mounted by the engine via `api.ui.registerModal("inventory", ...)`.
 * This script owns only the toggle-key polling + the live-props
 * resolver that hands the current player's inventory to the modal.
 *
 * Toggle = KeyE (default). Held-state suppression mirrors the pre-R4
 * engine system: while another modal is open we don't react.
 *
 * Close path: the `InventoryScreen` component itself listens for Esc/E
 * on `window` (capture phase) and calls its `onClose` prop, which
 * flips the modal closed via `api.modals.setOpen`. We don't need to
 * poll for the close here.
 */
export default (api: ModAPI) => {
  // Live-props resolver: invoked by the UI registry on every reconcile
  // so the modal always sees the current player's inventory component
  // (which is mutated in place — same object identity across frames).
  const liveProps = () => {
    const player = api.world.first(api.components.PlayerInput, api.components.Inventory);
    // If somehow there's no player yet, fall back to a stub. The
    // toggle-key path won't open the modal without a player either,
    // so this branch is defensive only.
    const inventory = player !== undefined
      ? api.components.Inventory.getOrThrow(player)
      : { bag: [], hotbar: [], equipment: {}, activeHotbarIndex: 0 };
    return {
      inventory,
      manifest: api.pack.manifest,
      icons: api.itemImages,
      inv: api.inventory,
      onClose: () => {
        api.modals.setOpen("inventory", false);
      },
    };
  };

  api.ui.registerModal("inventory", InventoryScreen, liveProps);

  // Edge-detector state. Single-player game, one-shot bookkeeping is fine.
  let wasToggleHeld = false;

  api.registerSystem((world, _dt) => {
    // Suppress while another modal owns the screen so KeyE doesn't
    // pop the inventory open behind it.
    const blocked = api.modals.anyOther("inventory");
    const toggleHeld = api.input.keyboard.isKeyPressed("KeyE") && !blocked;
    if (toggleHeld && !wasToggleHeld) {
      const isOpen = api.modals.isOpen("inventory");
      if (isOpen) {
        api.modals.setOpen("inventory", false);
      } else {
        // Only open when a player exists — the modal would render
        // empty otherwise and the user couldn't recover (the close
        // listener inside the component runs once mounted).
        const player = world.first(api.components.PlayerInput, api.components.Inventory);
        if (player !== undefined) {
          api.modals.setOpen("inventory", true);
          document.exitPointerLock();
        }
      }
    }
    wasToggleHeld = toggleHeld;
  });
};
