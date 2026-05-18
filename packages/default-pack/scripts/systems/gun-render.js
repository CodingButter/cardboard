/**
 * Default pack — GunRenderSystem.
 *
 * Update phase: drives the weapon state machine — walk-cycle phase,
 * semi-auto/full-auto firing (gated by `1/fireRate`), and reload
 * completion (pulls from the matching `ammoItem` once `reloadTime`
 * has elapsed). Reload START lives in `player-input.js` — once it's
 * begun, this system commits it.
 *
 * The "active weapon" is now an entity reference: read
 * `Carrier.hotbar → ActiveSlot.index → Inventory.slots[idx]`. That
 * entity carries the `Weapon` component with all fire-rate + reload
 * + mag state. The Player itself no longer carries `Weapon`.
 *
 * Render phase: composites the held viewmodel PNG over the world.
 * Registered on the `after-world` render phase so the gun sits over
 * the world pass but under the HUD overlays.
 */
import {
  getActiveItemEntity,
  countItemId,
  removeItemId,
} from "../lib/inventory.js";

export default (api) => {
  const C = api.components;

  const isMoving = (input) =>
    api.input.isBindingPressed(input.bindings.forward) ||
    api.input.isBindingPressed(input.bindings.backward) ||
    api.input.isBindingPressed(input.bindings.strafeLeft) ||
    api.input.isBindingPressed(input.bindings.strafeRight);

  // ─── Update — fire/reload state machine ─────────────────────────────
  api.registerSystem((world, deltaTime) => {
    const now = performance.now() / 1000;
    const firingNow = api.input.mouse.isButtonPressed(0);
    const cfg = api.config;

    world.each(
      C.PlayerInput, C.Carrier,
      (entity, input, _carrier) => {
        const activeEntity = getActiveItemEntity(world, entity, C);
        const weapon = activeEntity !== null ? C.Weapon.get(activeEntity) : null;
        const item = activeEntity !== null ? C.Item.get(activeEntity) : null;
        const isWeapon = !!weapon && item?.type === "weapon";
        const swayFreq = cfg.gun.swayFrequency;

        if (weapon) {
          if (isMoving(input)) {
            weapon.walkPhase += deltaTime * swayFreq;
            if (weapon.walkPhase > Math.PI * 2) weapon.walkPhase -= Math.PI * 2;
          }
        }

        // Reload completion.
        if (isWeapon && Number.isFinite(weapon.reloadStart) && weapon.reloadStart >= 0) {
          const reloadTime = weapon.reloadTime ?? 1.5;
          if (now - weapon.reloadStart >= reloadTime) {
            const magSize = weapon.magazineSize ?? 0;
            const ammoItem = weapon.ammoItem;
            if (magSize > 0 && ammoItem) {
              const needed = magSize - (weapon.mag ?? 0);
              const taken = removeItemId(world, entity, ammoItem, needed, C);
              weapon.mag = (weapon.mag ?? 0) + taken;
            }
            weapon.reloadStart = -1;
          }
        }

        // Fire — semi-auto if fireRate==0 (edge-triggered),
        // full-auto otherwise (rate-limited).
        if (
          isWeapon &&
          firingNow &&
          (!Number.isFinite(weapon.reloadStart) || weapon.reloadStart < 0)
        ) {
          const fireRate = weapon.fireRate ?? 0;
          const magSize = weapon.magazineSize ?? 0;
          const hasMag = magSize === 0 || (weapon.mag ?? 0) > 0;
          let shouldFire = false;
          if (fireRate > 0) {
            shouldFire = hasMag && now - weapon.lastFireTime >= 1 / fireRate;
          } else {
            shouldFire = hasMag && !weapon.wasFiring;
          }
          if (shouldFire) {
            weapon.lastFireTime = now;
            if (magSize > 0) weapon.mag = (weapon.mag ?? 1) - 1;
            api.audio.play("gunshot");
            api.events.emit("weapon:fired", {
              player: entity,
              weaponId: item?.itemId,
              ammoLeft: magSize > 0 ? (weapon.mag ?? 0) : -1,
            });
          }
        }
        if (weapon) weapon.wasFiring = firingNow;
      },
    );
  });

  // ─── Render — composite the viewmodel over the world ────────────────
  api.registerRendererSystem((renderer, world) => {
    const entity = world.first(C.PlayerInput, C.Carrier);
    if (entity === undefined) return;
    const activeEntity = getActiveItemEntity(world, entity, C);
    if (activeEntity === null) return;
    const item = C.Item.get(activeEntity);
    const weapon = C.Weapon.get(activeEntity);
    if (!item || !weapon || item.type !== "weapon") return;
    const image = api.itemImages.get(item.itemId, "held");
    if (!image) return;

    const aim = C.Aim.get(entity);
    const aimY = aim?.screenY ?? 0;

    const fallback = api.config.gun;
    const heightFraction = fallback.heightFraction;
    const reticleGapFraction = fallback.reticleGapFraction;
    const swayAmpFraction = fallback.swayAmplitudeFraction;
    const recoilDuration = fallback.recoilDuration;
    const recoilHeightFraction = fallback.recoilHeightFraction;
    const recoilScale = fallback.recoilScale;
    const recoilSkew = fallback.recoilSkew;

    const ctx = renderer.ctx;
    const now = performance.now() / 1000;
    const H = ctx.canvas.height;
    const size = heightFraction * H;
    const gap = reticleGapFraction * H;
    const swayAmp = swayAmpFraction * H;
    const recoilLiftMax = recoilHeightFraction * H;

    const swayX = Math.sin(weapon.walkPhase) * swayAmp;
    const swayY = Math.abs(Math.sin(weapon.walkPhase * 2)) * (swayAmp * 0.5);

    const dt = now - weapon.lastFireTime;
    const recoil =
      dt >= 0 && dt < recoilDuration
        ? Math.sin((dt / recoilDuration) * Math.PI)
        : 0;
    const recoilLift = -recoil * recoilLiftMax;
    const scale = 1 + recoil * recoilScale;
    const skewX = recoil * recoilSkew;

    const cx = ctx.canvas.width / 2 + swayX;
    const reticleY = H / 2 + aimY;
    const gunTopY = reticleY + gap;
    const baseY = gunTopY + size + swayY + recoilLift;

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(scale, scale);
    if (skewX !== 0) ctx.transform(1, 0, skewX, 1, 0, 0);
    ctx.drawImage(image, -size / 2, -size, size, size);
    ctx.restore();
  }, "after-world");

  // Mark countItemId as referenced — used by the carry-system in
  // future expansions (and prevents tree-shaking dead-imports).
  void countItemId;
};
