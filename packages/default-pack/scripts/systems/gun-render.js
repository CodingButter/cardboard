/**
 * Default pack — GunRenderSystem.
 *
 * Update phase: drives the weapon state machine — walk-cycle phase,
 * semi-auto/full-auto firing (gated by `1/fireRate`), and reload
 * completion (pulls from the matching `ammoItem` once `reloadTime`
 * has elapsed). Reload START lives in `player-input.js` — once it's
 * begun, this system commits it.
 *
 * Render phase: looks up the active hotbar item, fetches the held
 * variant from the shared `api.itemImages` cache, and composites the
 * viewmodel PNG over the world. Bob + recoil are derived from the
 * weapon's stats with fallbacks to `api.config.gun.*`.
 *
 * Registered on the `after-world` render phase so the gun sits over
 * the world pass but under the HUD overlays — same layering as the
 * engine's pre-R3 version.
 */
export default (api) => {
  const C = api.components;
  const inv = api.inventory;
  const itemRegistry = api.singleton("ItemRegistry");

  const itemDef = (id) => itemRegistry.byId?.[id] ?? null;

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
      C.PlayerInput, C.Weapon, C.Inventory,
      (entity, input, weapon, inventory) => {
        const active = inv.getActiveItem(inventory);
        const def = active ? itemDef(active.itemId) : null;
        const isWeapon = def?.type === "weapon";
        const stats = isWeapon ? def.weapon : undefined;
        const swayFreq = stats?.swayFrequency ?? cfg.gun.swayFrequency;

        if (isMoving(input)) {
          weapon.walkPhase += deltaTime * swayFreq;
          if (weapon.walkPhase > Math.PI * 2) weapon.walkPhase -= Math.PI * 2;
        }

        // Reload completion.
        if (active && isWeapon && Number.isFinite(weapon.reloadStart)) {
          const reloadTime = stats?.reloadTime ?? 1.5;
          if (now - weapon.reloadStart >= reloadTime) {
            const magSize = stats?.magazineSize ?? 0;
            const ammoItem = stats?.ammoItem;
            if (magSize > 0 && ammoItem) {
              const needed = magSize - (active.mag ?? 0);
              const taken = inv.removeItem(inventory, ammoItem, needed);
              active.mag = (active.mag ?? 0) + taken;
            }
            weapon.reloadStart = -Infinity;
          }
        }

        // Fire — semi-auto if fireRate==0 (edge-triggered),
        // full-auto otherwise (rate-limited).
        if (active && isWeapon && firingNow && !Number.isFinite(weapon.reloadStart)) {
          const fireRate = stats?.fireRate ?? 0;
          const magSize = stats?.magazineSize ?? 0;
          const hasMag = magSize === 0 || (active.mag ?? 0) > 0;
          let shouldFire = false;
          if (fireRate > 0) {
            shouldFire = hasMag && now - weapon.lastFireTime >= 1 / fireRate;
          } else {
            shouldFire = hasMag && !weapon.wasFiring;
          }
          if (shouldFire) {
            weapon.lastFireTime = now;
            if (magSize > 0) active.mag = (active.mag ?? 1) - 1;
            // Au1 of AUDIO.md — placeholder gunshot. The default pack
            // ships a synthesized stub; modders replace with real OGG.
            api.audio.play("gunshot");
            // Ev1 of EVENTS.md §4.8 — fire-edge moment. Chain packs
            // (camera-shake mods, recoil overlays, screen-flash
            // effects) subscribe to react without monkey-patching the
            // viewmodel pipeline. ammoLeft reflects the post-decrement
            // value so subscribers see "how many remain" semantics.
            api.events.emit("weapon:fired", {
              player: entity,
              weaponId: active.itemId,
              ammoLeft: magSize > 0 ? (active.mag ?? 0) : -1,
            });
          }
        }
        weapon.wasFiring = firingNow;
      },
    );
  });

  // ─── Render — composite the viewmodel over the world ────────────────
  // `after-world` runs after `drawWorld` and before sprites in
  // `Game.render`. That's the slot the engine's pre-R3 gun was drawn at.
  api.registerRendererSystem((renderer, world) => {
    const entity = world.first(C.PlayerInput, C.Weapon, C.Inventory);
    if (entity === undefined) return;
    const inventory = C.Inventory.getOrThrow(entity);
    const active = inv.getActiveItem(inventory);
    if (!active) return;
    const def = itemDef(active.itemId);
    if (def?.type !== "weapon") return;
    const image = api.itemImages.get(active.itemId, "held");
    if (!image) return;

    const weapon = C.Weapon.getOrThrow(entity);
    const aim = C.Aim.get(entity);
    const aimY = aim?.screenY ?? 0;

    const stats = def.weapon ?? {};
    const fallback = api.config.gun;
    const heightFraction = stats.heightFraction ?? fallback.heightFraction;
    const reticleGapFraction = stats.reticleGapFraction ?? fallback.reticleGapFraction;
    const swayAmpFraction = stats.swayAmplitudeFraction ?? fallback.swayAmplitudeFraction;
    const recoilDuration = stats.recoilDuration ?? fallback.recoilDuration;
    const recoilHeightFraction = stats.recoilHeightFraction ?? fallback.recoilHeightFraction;
    const recoilScale = stats.recoilScale ?? fallback.recoilScale;
    const recoilSkew = stats.recoilSkew ?? fallback.recoilSkew;

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
};
