/**
 * Default pack's example mod script.
 *
 * Runs once after the game is constructed. Demonstrates the API surface:
 * defining a component, registering a system that mutates it, and
 * registering a prefab other code (or scripts) can call. The behaviour
 * here is harmless — it just attaches a `LifeTimer` component to the
 * player that ticks up each frame and logs every 5 seconds.
 *
 * Edit this file, run `bun run build-packs`, reload the page.
 */
export default (api) => {
  console.log("[mod] hello — engine config fovDegrees =", api.config.camera.fovDegrees);

  // Custom component: one float, "seconds since the engine started".
  const LifeTimer = api.defineComponent("LifeTimer");

  // Attach it to the player on first tick. We don't have lifecycle
  // hooks yet, so the first registered system seeds it lazily.
  let seeded = false;
  api.registerSystem((world, dt) => {
    if (!seeded) {
      const player = world.first(api.components.PlayerInput);
      if (player !== undefined) {
        world.add(player, LifeTimer, { seconds: 0, lastLogged: 0 });
        seeded = true;
      }
      return;
    }

    world.each(api.components.PlayerInput, LifeTimer, (_e, _input, timer) => {
      timer.seconds += dt;
      if (timer.seconds - timer.lastLogged >= 5) {
        timer.lastLogged = timer.seconds;
        console.log(`[mod] player has been alive for ${timer.seconds.toFixed(1)}s`);
      }
    });
  });

  // Example prefab. Doesn't get called automatically — but other
  // scripts (or a later command-line hook) can `api.spawn("marker", x, y)`.
  api.registerPrefab("marker", (x, y) => {
    const e = api.world.spawn();
    api.world
      .add(e, api.components.Position, new api.Vec2(x, y))
      .add(e, api.components.MinimapMarker, {
        color: "#ffcc00",
        radius: 0.15,
        drawForwardRay: false,
      });
    return e;
  });

  // Scatter ammo packs across every open cell in the scene that's at
  // least a few tiles away from the spawn. Procedural placement means
  // this works regardless of map size or layout. Guarded by a
  // "world empty of sprites?" check so HMR reruns don't duplicate.
  const hasSprites = api.world.first(api.components.Sprite) !== undefined;
  if (!hasSprites) {
    const ammo = (x, y) => {
      const e = api.world.spawn();
      api.world
        .add(e, api.components.Position, new api.Vec2(x, y))
        .add(e, api.components.Sprite, {
          imageId: "ammo_pack",
          worldHeight: 0.4,
          yOffset: 0.3,
        })
        .add(e, api.components.Pickup, {
          itemId: "rifle_ammo",
          count: 30,
        })
        .add(e, api.components.MinimapMarker, {
          color: "#ffcc00",
          radius: 0.12,
          drawForwardRay: false,
        });
      return e;
    };

    const scene = api.scene;
    const player = api.world.first(api.components.PlayerInput, api.components.Position);
    const playerPos = player ? api.components.Position.getOrThrow(player) : null;
    // Crude seeded RNG so refreshes don't reshuffle pickups every time.
    let s = 0x12345 >>> 0;
    const rand = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // ~1 pack per 25 open cells, so density scales with map size.
    let count = 0;
    for (let y = 1; y < scene.size.y - 1; y++) {
      for (let x = 1; x < scene.size.x - 1; x++) {
        if (scene.isWall(x, y)) continue;
        // Keep a small clearance around spawn.
        if (playerPos) {
          const dx = x + 0.5 - playerPos.x;
          const dy = y + 0.5 - playerPos.y;
          if (dx * dx + dy * dy < 9) continue;
        }
        if (rand() < 1 / 25) {
          ammo(x + 0.5, y + 0.5);
          count++;
        }
      }
    }
    console.log(`[mod] scattered ${count} ammo packs`);
  }

  // ── Phase 5 dynamic-lights demo ────────────────────────────────────
  // Spawn two moving Light entities on the heights demo scene so the
  // user can visually confirm the runtime light pipeline. Gating by
  // the demo scene's exact 12×12 size keeps `scene1.json` (procedural,
  // big) and `scene2.json` from picking up the demo lights — neither
  // is 12×12. There's no structured "scene name" exposed to mods yet,
  // so the dimension check is the cleanest gate available.
  const isHeightsDemo = api.scene.size.x === 12 && api.scene.size.y === 12;
  const hasLights = api.world.first(api.components.Light) !== undefined;
  if (isHeightsDemo && !hasLights) {
    // Orbit centre + cyan pulse position. Numbers chosen so the lights
    // sit inside the open part of the demo scene and illuminate the
    // knee-wall row at y=5.
    // Each light gets a visible marker sprite (reuses `ammo_pack`,
    // already loaded in the atlas) so you can see WHERE the light is
    // moving. Without this it's impossible to tell whether the light
    // is intersecting wall geometry or behaving correctly.
    const orbit = api.world.spawn();
    api.world
      .add(orbit, api.components.Position, new api.Vec2(7, 6))
      .add(orbit, api.components.Light, {
        color: [1, 0.3, 1],
        intensity: 2.2,
        radius: 5,
        z: 0.5,
      })
      .add(orbit, api.components.Sprite, {
        imageId: "ammo_pack",
        worldHeight: 0.25,
        yOffset: 0,
      })
      .add(orbit, api.components.MinimapMarker, {
        color: "#ff66ff",
        radius: 0.18,
        drawForwardRay: false,
      });

    const pulse = api.world.spawn();
    api.world
      .add(pulse, api.components.Position, new api.Vec2(9, 9))
      .add(pulse, api.components.Light, {
        color: [0.3, 1, 1],
        intensity: 1.5,
        radius: 4,
        z: 0.5,
      })
      .add(pulse, api.components.Sprite, {
        imageId: "ammo_pack",
        worldHeight: 0.25,
        yOffset: 0,
      })
      .add(pulse, api.components.MinimapMarker, {
        color: "#66ffff",
        radius: 0.18,
        drawForwardRay: false,
      });

    // Closure-captured entity handles for the per-frame update.
    let phase = 0;
    api.registerSystem((_world, dt) => {
      phase += dt;
      // Orbit — circle of radius 1.5 around (7, 6) every 4 sec. Stays
      // in cells (5-8, 4-7) which are clear of pillars in the demo.
      const orbitAngle = (phase * 2 * Math.PI) / 4;
      api.world.add(
        orbit,
        api.components.Position,
        new api.Vec2(
          7 + Math.cos(orbitAngle) * 1.5,
          6 + Math.sin(orbitAngle) * 1.5,
        ),
      );
      // Pulse — fixed position, sinusoidal intensity 0.5..2.5,
      // period 1.5 sec. Position needs no update; mutate the Light
      // component's intensity in place (Light values are objects, so
      // a direct write is the cheapest path — no add() / re-component
      // churn each frame).
      const pulseLight = api.components.Light.getOrThrow(pulse);
      const pulsePhase = (phase * 2 * Math.PI) / 1.5;
      pulseLight.intensity = 1.5 + Math.sin(pulsePhase) * 1.0;
    });
    console.log("[mod] heights-demo: spawned 2 dynamic lights (orbit + pulse)");
  }
};
