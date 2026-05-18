/**
 * Default pack — StatsRenderSystem.
 *
 * Toggleable performance + state overlay (Ctrl+`). Pinned top-right.
 *
 * Sampling happens in the renderer system instead of an update system
 * so the FPS history keeps ticking while a modal is open (engine gates
 * `runFrame` on `!modals.any()` but render systems always run). The
 * toggle is also polled here for the same reason.
 */
import { countItemId, getActiveItemEntity } from "../lib/inventory.js";

export default (api) => {
  const C = api.components;

  let visible = false;
  const dtHistory = new Float32Array(60);
  let dtIndex = 0;
  let dtCount = 0;
  let wasComboHeld = false;
  let lastNow = performance.now();

  const styleNow = () => {
    const s = api.config.stats;
    return {
      background: s.background,
      text: s.text,
      font: s.font,
      lineHeight: s.lineHeight,
      padding: s.padding,
      width: s.width,
    };
  };

  const getFps = () => {
    if (dtCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < dtCount; i++) sum += dtHistory[i];
    return sum > 0 ? dtCount / sum : 0;
  };

  const getFrameTimeMs = () => {
    if (dtCount === 0) return 0;
    let sum = 0;
    for (let i = 0; i < dtCount; i++) sum += dtHistory[i];
    return (sum / dtCount) * 1000;
  };

  api.registerRendererSystem((renderer, world) => {
    const now = performance.now();
    const dt = (now - lastNow) / 1000;
    lastNow = now;
    dtHistory[dtIndex] = dt;
    dtIndex = (dtIndex + 1) % dtHistory.length;
    if (dtCount < dtHistory.length) dtCount++;

    const kb = api.input.keyboard;
    const ctrl = kb.isAnyKeyPressed(["ControlLeft", "ControlRight"]);
    const tick = kb.isKeyPressed("Backquote");
    const comboHeld = ctrl && tick;
    if (comboHeld && !wasComboHeld) visible = !visible;
    wasComboHeld = comboHeld;

    if (!visible) return;

    const fps = getFps();
    const frameMs = getFrameTimeMs();

    let posStr = "—";
    let facingStr = "—";
    let weaponStr = "—";
    let ammoStr = "—";
    const player = world.first(C.PlayerInput, C.Position, C.Facing);
    if (player !== undefined) {
      const pos = C.Position.getOrThrow(player);
      const facing = C.Facing.getOrThrow(player);
      posStr = `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}`;
      facingStr = `${((facing * 180) / Math.PI).toFixed(0)}°`;

      const carrier = C.Carrier.get(player);
      const activeItem = getActiveItemEntity(world, player, C);
      if (carrier && activeItem !== null) {
        const item = C.Item.get(activeItem);
        const weapon = C.Weapon.get(activeItem);
        const activeSlot = typeof carrier.hotbar === "number"
          ? C.ActiveSlot.get(carrier.hotbar)
          : null;
        if (item) {
          weaponStr = `${item.displayName ?? item.itemId} (slot ${(activeSlot?.index ?? 0) + 1})`;
          if (weapon && item.type === "weapon" && (weapon.magazineSize ?? 0) > 0 && weapon.ammoItem) {
            const reserve =
              countItemId(world, carrier.backpack, weapon.ammoItem, C) +
              countItemId(world, carrier.hotbar, weapon.ammoItem, C);
            const reloading = Number.isFinite(weapon.reloadStart) && weapon.reloadStart >= 0;
            const mag = weapon.mag ?? 0;
            ammoStr = reloading ? `${mag} / ${reserve} (reloading…)` : `${mag} / ${reserve}`;
          } else if (weapon && item.type === "weapon") {
            ammoStr = "∞";
          }
        }
      }
    }

    const lines = [
      `FPS:      ${fps.toFixed(1)}`,
      `Frame:    ${frameMs.toFixed(2)} ms`,
      `Pos:      ${posStr}`,
      `Facing:   ${facingStr}`,
      `Weapon:   ${weaponStr}`,
      `Ammo:     ${ammoStr}`,
      `Entities: ${world.entityCount()}`,
    ];

    const style = styleNow();
    const ctx = renderer.ctx;
    const height = style.padding * 2 + style.lineHeight * lines.length;
    const x = ctx.canvas.width - style.width - style.padding;
    const y = style.padding;

    ctx.save();
    ctx.fillStyle = style.background;
    ctx.fillRect(x, y, style.width, height);
    ctx.fillStyle = style.text;
    ctx.font = style.font;
    ctx.textBaseline = "top";
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], x + style.padding, y + style.padding + i * style.lineHeight);
    }
    ctx.restore();
  }, "hud");
};
