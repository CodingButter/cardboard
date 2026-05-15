/**
 * Default pack — PlayerInputSystem.
 *
 * Reads keyboard + mouse via the ModAPI's `input` surface and writes
 * to the player's `Position`, `Facing`, `Movement`, `Aim`, `Inventory`,
 * `Weapon`, and `Camera` components. R3 of the engine/pack split moved
 * this out of `packages/engine/src/Systems/PlayerInputSystem.ts`; the
 * pack-side version uses only ModAPI access (no engine imports).
 *
 * Movement is axis-separated against `api.scene` walls — x and y are
 * applied independently and each is accepted only if every corner of
 * the player's bounding square would stay out of a wall slab whose top
 * sits above the player's head. That yields the classic "slide along
 * walls when you walk into them at an angle" feel.
 *
 * Vertical (jump / crouch / gravity) lives here too. Crouch is held;
 * jump is edge-triggered; gravity always integrates when airborne.
 * Headroom is sampled at every corner so a player crouched under a
 * hanging header doesn't pop through when they release crouch.
 */
export default (api) => {
  const C = api.components;
  const Vec2 = api.Vec2;
  const inv = api.inventory;

  // Reference logical canvas height the aim system clamps against.
  // Hard-wired to the engine's `Config.CANVAS_SIZE.y` (720) so the
  // semantic matches what the engine has always used — the actual
  // rendered canvas may differ but this is the legacy reference.
  const REFERENCE_CANVAS_HALF_HEIGHT = 360;

  // Slot keys 1..9 — index = slot number.
  const SLOT_KEYS = [
    "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
    "Digit6", "Digit7", "Digit8", "Digit9",
  ];

  // Vertical kinematics — same constants the engine's TS version used.
  const GRAVITY = -28;
  const JUMP_VELOCITY = 4.5;
  const CROUCH_Z = -0.22;
  const CROUCH_LERP = 12;
  const CROUCH_SPEED_MULT = 0.5;
  const MIN_CAMERA_Z = 0.12;
  const MAX_CAMERA_Z = 0.88;

  // Edge-detector state (single-player game; one-shot bookkeeping is fine).
  const wasSlotKeyHeld = SLOT_KEYS.map(() => false);
  let wasReloadKeyHeld = false;
  let wasJumpHeld = false;

  const canStandAt = (x, y, radius, headZ) => {
    const s = api.scene;
    return (
      s.canPlayerPass(Math.floor(x - radius), Math.floor(y - radius), headZ) &&
      s.canPlayerPass(Math.floor(x + radius), Math.floor(y - radius), headZ) &&
      s.canPlayerPass(Math.floor(x - radius), Math.floor(y + radius), headZ) &&
      s.canPlayerPass(Math.floor(x + radius), Math.floor(y + radius), headZ)
    );
  };

  api.registerSystem((world, deltaTime) => {
    // Note: the engine's `Game.update` already gates mod-registered
    // systems behind "no modal open" via `if (!this.modals.any())
    // runFrame(...)`. No explicit guard needed here.
    const cfg = api.config;
    const keyboard = api.input.keyboard;

    // Edge-detect slot keys (released → held = switch).
    const slotPressed = [];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      const held = keyboard.isKeyPressed(SLOT_KEYS[i]);
      if (held && !wasSlotKeyHeld[i]) slotPressed.push(i);
      wasSlotKeyHeld[i] = held;
    }

    // R = reload.
    const reloadHeld = keyboard.isKeyPressed("KeyR");
    const reloadPressed = reloadHeld && !wasReloadKeyHeld;
    wasReloadKeyHeld = reloadHeld;

    // Jump edge — uses the first player's bindings.
    const firstPlayer = world.first(C.PlayerInput);
    const jumpBindings = firstPlayer
      ? C.PlayerInput.get(firstPlayer)?.bindings.jump ?? []
      : [];
    const jumpHeldNow = api.input.isBindingPressed(jumpBindings);
    const jumpPressed = jumpHeldNow && !wasJumpHeld;
    wasJumpHeld = jumpHeldNow;

    // Mouse delta is shared this frame; only apply when pointer-locked.
    const rawMouseDelta = api.input.mouse.consumeMovement();
    const pointerLocked = document.pointerLockElement !== null;
    const mouseDelta = pointerLocked ? rawMouseDelta : new Vec2(0, 0);
    const wheelNotches = api.input.mouse.consumeWheel();

    const aimMax = REFERENCE_CANVAS_HALF_HEIGHT * cfg.reticle.maxOffsetFraction;
    const aimSign = cfg.reticle.invertY ? -1 : 1;
    const aimSens = cfg.reticle.sensitivity * aimSign;
    const playerRadius = cfg.player.radius;

    world.each(
      C.PlayerInput, C.Position, C.Facing, C.Movement,
      (entity, input, position, facing, movement) => {
        // ---- Vertical: jump (edge) + crouch (held) + gravity ----
        movement.crouching = api.input.isBindingPressed(input.bindings.crouch);
        const onGround = movement.z <= 0 && movement.vz <= 0;

        const rad = playerRadius;
        const headroom = Math.min(
          api.scene.maxHeadroom(Math.floor(position.x - rad), Math.floor(position.y - rad)),
          api.scene.maxHeadroom(Math.floor(position.x + rad), Math.floor(position.y - rad)),
          api.scene.maxHeadroom(Math.floor(position.x - rad), Math.floor(position.y + rad)),
          api.scene.maxHeadroom(Math.floor(position.x + rad), Math.floor(position.y + rad)),
        );
        // Max movement.z headroom permits — see the TS version for the
        // derivation; short form: maxZ = headroom - 0.62.
        const maxZ = headroom - 0.62;
        const forcedCrouch = maxZ < 0;

        if (onGround) {
          const wantCrouch = movement.crouching || forcedCrouch;
          const target = wantCrouch ? CROUCH_Z : 0;
          const t = Math.min(1, CROUCH_LERP * deltaTime);
          movement.z += (target - movement.z) * t;
          if (movement.z > maxZ) movement.z = maxZ;
          movement.vz = 0;
          if (jumpPressed && !movement.crouching && !forcedCrouch) {
            movement.vz = JUMP_VELOCITY;
          }
        } else {
          movement.vz += GRAVITY * deltaTime;
          movement.z += movement.vz * deltaTime;
          if (movement.z > maxZ) {
            movement.z = maxZ;
            if (movement.vz > 0) movement.vz = 0;
          }
          if (movement.z <= 0 && movement.vz <= 0) {
            movement.z = 0;
            movement.vz = 0;
          }
        }

        // Push eye height through to Camera so renderers see it.
        const cam = C.Camera.get(entity);
        if (cam) {
          const z = 0.5 + movement.z;
          cam.cameraZ = Math.min(MAX_CAMERA_Z, Math.max(MIN_CAMERA_Z, z));
        }

        // Hotbar switching — direct slot keys win over wheel cycling.
        const inventory = C.Inventory.get(entity);
        if (inventory) {
          let nextIndex = inventory.activeHotbarIndex;
          if (slotPressed.length > 0) {
            for (const slot of slotPressed) {
              if (slot < inventory.hotbar.length) {
                nextIndex = slot;
                break;
              }
            }
          } else if (wheelNotches !== 0) {
            const n = inventory.hotbar.length;
            nextIndex = ((inventory.activeHotbarIndex + wheelNotches) % n + n) % n;
          }
          if (nextIndex !== inventory.activeHotbarIndex) {
            inventory.activeHotbarIndex = nextIndex;
            const weapon = C.Weapon.get(entity);
            if (weapon) {
              weapon.lastFireTime = -100;
              weapon.wasFiring = false;
              weapon.reloadStart = -Infinity;
            }
          }
        }

        // Reload (R) start — completion lives in gun-render.
        if (reloadPressed && inventory) {
          const active = inv.getActiveItem(inventory);
          const def = active ? api.pack.manifest.items?.[active.itemId] : null;
          const weapon = C.Weapon.get(entity);
          const stats = def?.weapon;
          const magSize = stats?.magazineSize ?? 0;
          const ammoItem = stats?.ammoItem;
          if (
            active &&
            weapon &&
            def?.type === "weapon" &&
            magSize > 0 &&
            ammoItem &&
            (active.mag ?? 0) < magSize &&
            inv.countItem(inventory, ammoItem) > 0 &&
            !Number.isFinite(weapon.reloadStart)
          ) {
            weapon.reloadStart = performance.now() / 1000;
          }
        }

        // Mouse-look: x rotation × sensitivity dial (normalised to 30).
        const sensFactor = (cfg.reticle.sensitivity || 30) / 30;
        const newFacing =
          facing + mouseDelta.x * movement.rotationSpeed * sensFactor * deltaTime;

        movement.isRunning = api.input.isBindingPressed(input.bindings.run);

        const forward = Vec2.fromAngle(newFacing);
        const right = Vec2.fromAngle(newFacing + Math.PI / 2);
        let speed = movement.isRunning
          ? movement.speed * movement.runMultiplier
          : movement.speed;
        if (movement.crouching) speed *= CROUCH_SPEED_MULT;
        const step = speed * deltaTime;

        // Normalise the direction so diagonal travel isn't √2 faster.
        let dirX = 0;
        let dirY = 0;
        if (api.input.isBindingPressed(input.bindings.forward)) {
          dirX += forward.x; dirY += forward.y;
        }
        if (api.input.isBindingPressed(input.bindings.backward)) {
          dirX -= forward.x; dirY -= forward.y;
        }
        if (api.input.isBindingPressed(input.bindings.strafeLeft)) {
          dirX -= right.x; dirY -= right.y;
        }
        if (api.input.isBindingPressed(input.bindings.strafeRight)) {
          dirX += right.x; dirY += right.y;
        }
        const dirMag = Math.hypot(dirX, dirY);
        let dx = 0;
        let dy = 0;
        if (dirMag > 0) {
          const scale = step / dirMag;
          dx = dirX * scale;
          dy = dirY * scale;
        }

        // Axis-separated collision; hanging headers above headZ pass.
        const camZNow = cam?.cameraZ ?? 0.5;
        const headZ = camZNow + 0.12;
        let newX = position.x;
        let newY = position.y;
        if (dx !== 0 && canStandAt(position.x + dx, newY, playerRadius, headZ)) {
          newX = position.x + dx;
        }
        if (dy !== 0 && canStandAt(newX, position.y + dy, playerRadius, headZ)) {
          newY = position.y + dy;
        }
        const newPosition =
          newX === position.x && newY === position.y
            ? position
            : new Vec2(newX, newY);

        world.add(entity, C.Position, newPosition);
        world.add(entity, C.Facing, newFacing);
        // `movement` was mutated in place; no re-add needed.

        // Vertical aim — independent of body facing.
        const aim = C.Aim.get(entity);
        if (aim) {
          let y = aim.screenY + mouseDelta.y * aimSens * deltaTime;
          if (y < -aimMax) y = -aimMax;
          else if (y > aimMax) y = aimMax;
          aim.screenY = y;
        }
      },
    );
  });
};
