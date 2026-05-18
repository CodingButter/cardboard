/**
 * Default pack — InventoryBarRenderSystem.
 *
 * Bottom-center HUD hotbar strip. Walks the player's hotbar container
 * (`Carrier.hotbar → Inventory.slots[]`), reads each slot's item-entity
 * id, fetches its `Item` + `Stackable` (+ optional `Weapon`) components
 * for icon + ammo readout, and draws.
 *
 * Active slot index lives on the hotbar container's `ActiveSlot.index`.
 */
import { countItemId } from "../lib/inventory.js";

export default (api) => {
  const C = api.components;

  api.registerRendererSystem((renderer, world) => {
    const player = world.first(C.PlayerInput, C.Carrier);
    if (player === undefined) return;
    const carrier = C.Carrier.get(player);
    if (!carrier || typeof carrier.hotbar !== "number") return;
    const hotbarInv = C.Inventory.get(carrier.hotbar);
    const activeSlot = C.ActiveSlot.get(carrier.hotbar);
    if (!hotbarInv || hotbarInv.capacity === 0) return;
    const activeIndex = activeSlot?.index ?? 0;

    const ctx = renderer.ctx;
    const H = ctx.canvas.height;
    const W = ctx.canvas.width;
    const uiScale = api.config.ui?.scale ?? 1;
    const slotSize = H * 0.075 * uiScale;
    const gap = H * 0.008 * uiScale;
    const padding = H * 0.02 * uiScale;
    const n = hotbarInv.capacity;

    const totalWidth = n * slotSize + (n - 1) * gap;
    const startX = (W - totalWidth) / 2;
    const baseY = H - padding - slotSize;

    const numberFont = `${Math.round(slotSize * 0.2)}px monospace`;
    const countFont = `${Math.round(slotSize * 0.2)}px monospace`;

    ctx.save();
    for (let i = 0; i < n; i++) {
      const slotId = hotbarInv.slots[i];
      const item = typeof slotId === "number" ? C.Item.get(slotId) : null;
      const stackable = typeof slotId === "number" ? C.Stackable.get(slotId) : null;
      const weapon = typeof slotId === "number" ? C.Weapon.get(slotId) : null;
      const x = startX + i * (slotSize + gap);
      const isActive = i === activeIndex;

      ctx.fillStyle = isActive ? "rgba(255, 200, 60, 0.18)" : "rgba(0, 0, 0, 0.55)";
      ctx.fillRect(x, baseY, slotSize, slotSize);

      ctx.strokeStyle = isActive ? "#ffcc40" : "rgba(180, 180, 180, 0.5)";
      ctx.lineWidth = isActive ? 2.5 : 1;
      ctx.strokeRect(
        x + ctx.lineWidth / 2,
        baseY + ctx.lineWidth / 2,
        slotSize - ctx.lineWidth,
        slotSize - ctx.lineWidth,
      );

      if (item) {
        const img = api.itemImages.get(item.itemId);
        if (img) {
          const iconPad = slotSize * 0.12;
          ctx.globalAlpha = isActive ? 1 : 0.75;
          ctx.drawImage(
            img,
            x + iconPad,
            baseY + iconPad,
            slotSize - 2 * iconPad,
            slotSize - 2 * iconPad,
          );
          ctx.globalAlpha = 1;
        } else {
          const p = slotSize * 0.2;
          ctx.fillStyle = isActive
            ? "rgba(255, 200, 60, 0.35)"
            : "rgba(180, 180, 180, 0.2)";
          ctx.fillRect(x + p, baseY + p, slotSize - 2 * p, slotSize - 2 * p);
        }
      }

      // Slot number (top-left).
      ctx.fillStyle = isActive ? "#fff" : "rgba(220, 220, 220, 0.75)";
      ctx.font = numberFont;
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(`${i + 1}`, x + slotSize * 0.08, baseY + slotSize * 0.06);

      // Count / ammo readout (bottom-right).
      if (item && stackable) {
        let label = null;
        let red = false;
        if (weapon && item.type === "weapon" && (weapon.magazineSize ?? 0) > 0) {
          const reserve = weapon.ammoItem
            ? countItemId(world, carrier.backpack, weapon.ammoItem, C) +
              countItemId(world, carrier.hotbar, weapon.ammoItem, C) -
              // Subtract our OWN mag/stack so we don't double-count
              // (the weapon's mag is held on its Weapon component, not
              // in any container slot — no subtraction needed).
              0
            : 0;
          const mag = weapon.mag ?? 0;
          label = `${mag}/${reserve}`;
          red = mag === 0;
        } else if (stackable.count > 1) {
          label = `${stackable.count}`;
        }
        if (label) {
          ctx.fillStyle = red
            ? "#ff6060"
            : isActive
            ? "#fff"
            : "rgba(220, 220, 220, 0.75)";
          ctx.font = countFont;
          ctx.textBaseline = "bottom";
          ctx.textAlign = "right";
          ctx.fillText(
            label,
            x + slotSize - slotSize * 0.08,
            baseY + slotSize - slotSize * 0.06,
          );
        }
      }

      // Reload progress bar for active weapon stack.
      if (
        isActive &&
        weapon &&
        item?.type === "weapon" &&
        (weapon.magazineSize ?? 0) > 0 &&
        Number.isFinite(weapon.reloadStart) &&
        weapon.reloadStart >= 0
      ) {
        const reloadTime = weapon.reloadTime ?? 1.5;
        const now = performance.now() / 1000;
        const t = Math.min(1, Math.max(0, (now - weapon.reloadStart) / reloadTime));
        const barH = Math.max(2, slotSize * 0.05);
        const barY = baseY + slotSize - barH;
        ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
        ctx.fillRect(x, barY, slotSize, barH);
        ctx.fillStyle = "#ffcc40";
        ctx.fillRect(x, barY, slotSize * t, barH);
      }
    }
    ctx.restore();
  }, "hud");
};
