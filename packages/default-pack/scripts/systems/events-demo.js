/**
 * Default pack — events smoke-demo script (Ev1 of `docs/plans/EVENTS.md`).
 *
 * Gated behind the manifest's `eventsDemo` flag (false by default).
 * When enabled, this script subscribes to a handful of canonical engine
 * events + the default-pack's `pickup:collected` topic and console.logs
 * each fire. It's not gameplay — purely a "did the bus wire up?" proof,
 * which is why it lives behind a flag instead of shipping as a real
 * system.
 *
 * Flip `manifest.eventsDemo` to `true` in `packages/default-pack/manifest.json`
 * and re-run `bun run build-packs` to enable. With the flag off the
 * script is still bundled but its `default` export returns immediately
 * — no subscriptions register, no events log.
 */
export default (api) => {
  const flag = api.pack.manifest.eventsDemo === true;
  if (!flag) return;

  console.log("[events-demo] subscribing — Ev1 smoke test active");

  // Cross-system communication — pickup fires the topic, we listen.
  // Demonstrates the canonical-name handshake that lets pack B react
  // to pack A's pickup loop without sharing code.
  api.events.on("pickup:collected", ({ itemId, count }) => {
    console.log(`[events-demo] +${count} ${itemId}!`);
  });

  // Weapon-fired log. ammoLeft = -1 for unlimited-mag weapons.
  api.events.on("weapon:fired", ({ weaponId, ammoLeft }) => {
    const left = ammoLeft >= 0 ? `${ammoLeft} left` : "unlimited";
    console.log(`[events-demo] fired ${weaponId} (${left})`);
  });

  // Scene + pack lifecycle log — fires once at boot.
  api.events.on("scene:loaded", ({ name, size }) => {
    console.log(`[events-demo] scene:loaded ${name} ${size.x}x${size.y}`);
  });
  api.events.on("pack:loaded", ({ manifest }) => {
    console.log(`[events-demo] pack:loaded ${manifest.name}@${manifest.version}`);
  });

  // Modal edges — exercises the ModalsRegistry → events bridge.
  api.events.on("modal:opened", ({ name }) => {
    console.log(`[events-demo] modal:opened ${name}`);
  });
  api.events.on("modal:closed", ({ name }) => {
    console.log(`[events-demo] modal:closed ${name}`);
  });

  // One-shot — first player movement. Auto-unsubscribes after firing.
  api.events.once("player:moved", ({ cellX, cellY }) => {
    console.log(`[events-demo] player:moved first fire @ (${cellX},${cellY})`);
  });
};
