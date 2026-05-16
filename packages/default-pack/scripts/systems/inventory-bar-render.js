/**
 * Default pack — InventoryBarRenderSystem.
 *
 * Bottom-center HUD hotbar strip. Each tile shows the item's icon
 * (from `api.itemImages`), its slot number, and — for weapons — the
 * current magazine count over the total reserve ammo in bag+hotbar.
 * Active slot gets a brighter background + thicker border. A thin
 * progress bar sweeps along the bottom of the active slot while that
 * weapon is reloading.
 */
export default (api) => {
  const C = api.components;
  const inv = api.inventory;

  api.registerRendererSystem((renderer, world) => {
    const entity = world.first(C.PlayerInput, C.Inventory);
    if (entity === undefined) return;
    const inventory = C.Inventory.getOrThrow(entity);
    if (inventory.hotbar.length === 0) return;
    const weapon = C.Weapon.get(entity);

    const ctx = renderer.ctx;
    const H = ctx.canvas.height;
    const W = ctx.canvas.width;
    // CONFIG.ui.scale is the single UI-scaling source of truth — see
    // GameConfig.ts. All canvas2d HUD systems multiply their base
    // sizes by it; modal Tailwind classes scale via <html>.fontSize.
    const uiScale = api.config.ui?.scale ?? 1;
    const slotSize = H * 0.075 * uiScale;
    const gap = H * 0.008 * uiScale;
    const padding = H * 0.02 * uiScale;
    const n = inventory.hotbar.length;

    const totalWidth = n * slotSize + (n - 1) * gap;
    const startX = (W - totalWidth) / 2;
    const baseY = H - padding - slotSize;

    const numberFont = `${Math.round(slotSize * 0.2)}px monospace`;
    const countFont = `${Math.round(slotSize * 0.2)}px monospace`;

    ctx.save();
    for (let i = 0; i < n; i++) {
      const stack = inventory.hotbar[i];
      const def = stack ? api.pack.manifest.items?.[stack.itemId] : null;
      const x = startX + i * (slotSize + gap);
      const isActive = i === inventory.activeHotbarIndex;

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

      if (stack) {
        const img = api.itemImages.get(stack.itemId);
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
      if (stack && def) {
        let label = null;
        let red = false;
        if (def.type === "weapon" && def.weapon?.magazineSize) {
          const reserve = def.weapon.ammoItem
            ? inv.countItem(inventory, def.weapon.ammoItem)
            : 0;
          const mag = stack.mag ?? 0;
          label = `${mag}/${reserve}`;
          red = mag === 0;
        } else if (stack.count > 1) {
          label = `${stack.count}`;
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
        stack &&
        def?.type === "weapon" &&
        def.weapon?.magazineSize &&
        Number.isFinite(weapon.reloadStart)
      ) {
        const reloadTime = def.weapon.reloadTime ?? 1.5;
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
