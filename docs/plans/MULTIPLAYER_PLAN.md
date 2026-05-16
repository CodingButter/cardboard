# Multiplayer plan — drop-in net-sync via the ECS

A future-facing plan for adding networked multiplayer as a **pack-shipped
system** rather than an engine concern. Goal: someone installs a
"multiplayer" pack on top of the default pack, connects to a peer, and
plays. No engine forks.

This is **not** scoped for the current cycle. Park here so the thinking
doesn't evaporate, and so design decisions in the engine/pack split
(`ENGINE_PACK_SPLIT.md`) account for the multiplayer surface.

---

## Goal & scope

- **Browser-only**: WebRTC datachannels for P2P; WebSocket fallback for
  host-authoritative server mode.
- **Host-authoritative first** — one peer is the host, others are
  clients. Simplest authority model, fewest edge cases.
- **Tight player counts**: 2–8 peers. Not designed for MMOs.
- **Latency-tolerant gameplay** — basic interpolation + dead-reckoning.
  Lag compensation / rollback is a stretch goal, not phase 1.
- **No matchmaking server required** — connection is by manual signaling
  (paste an offer/answer SDP through any side channel). A signaling
  server is optional, deferred to a later phase.

Out of scope:
- Anti-cheat (host-auth alone is the baseline; nothing more).
- Voice chat.
- Persistent rooms / lobbies.
- More than ~8 simultaneous clients.

---

## Why the ECS is the right substrate

Naughty Dog, Bevy, Unity DOTS — many engines use ECS partly *because*
networked state is easy to sync component-by-component:

- **Entities are identified by id**. Map local ids to network ids and
  every replicated thing has a stable handle across peers.
- **Components are plain data**. Serializable to CBOR / JSON / binary
  with no graph traversal.
- **Systems are pluggable**. The net layer is just another system
  (`NetSyncSystem`) running each frame, publishing dirty components
  and applying remote ones.
- **The renderer doesn't care**. It draws what's in the world — a
  remote-controlled entity with Position + Sprite renders identically
  to a local one.

This puts most of the work in protocol design and component-data
serialization, not engine architecture.

---

## What's missing today

The engine needs three modest additions before a multiplayer pack
can hook in:

1. **A "dirty" mechanism on the ECS.** Today the world tracks
   add/remove but not per-frame component MUTATIONS. The net system
   needs to know which components changed. Two options:
   - **Dirty flags** — `world.touch(entity, Component)` after a write;
     net system queries `world.dirty()` each frame.
   - **Snapshot + diff** — every frame, snapshot a registered set of
     components, diff against last frame, broadcast deltas. Simpler
     to implement, heavier per-frame.
   Start with snapshot+diff. Migrate to dirty flags if perf hurts.

2. **A `NetworkId` core component**. Replicated entities carry one.
   Maps a local entity id to a stable network id assigned by the host.
   Mod-spawned entities get one when the host says so.

3. **A `Replicate` marker component**. Lists which components on this
   entity should be replicated (`["Position", "Facing", "Movement"]`).
   Other components stay local — important for inventory / settings
   that shouldn't sync. Field also encodes update rate per component
   (Position 60Hz, Inventory only on change).

These are engine-side because they're cross-cutting infrastructure.
Everything else is content / pack work.

---

## The drop-in shape

A multiplayer pack lands as one boot script that registers:

```ts
// packages/multiplayer-pack/scripts/boot.js
export default (api) => {
  api.defineComponent("NetworkOwner", {});   // who controls this entity
  api.registerPrefab("remote_player", remotePlayerFactory);

  // The net layer is just a system.
  api.registerSystem(netSyncSystem);
  api.registerSystem(remoteInputSystem);    // applies remote inputs

  api.onWorldReady(async () => {
    const transport = await api.network.connect({
      role: queryStr.role,            // "host" | "client"
      offer: queryStr.offer,          // SDP from signaling
    });
    // host: assign network ids, accept clients, broadcast world state
    // client: listen, instantiate remote entities from snapshots
  });
};
```

The engine grows `api.network` exposing WebRTC datachannel and
WebSocket primitives — same justification as `api.input` (raw browser
APIs that mods can't ship themselves).

**Per-frame flow** in the net system:
1. Host: query `Replicate + NetworkId` entities, snapshot replicated
   components, broadcast deltas to each client.
2. Client: receive delta packet, apply component values to the
   matching `NetworkId` entity (spawning via prefab if it's new).
3. Client: send local-player input state (movement bindings held, mouse
   deltas) to host. Host re-runs input system for each client's
   player entity.

---

## Authority model

**Host-authoritative** for phase 1:
- One peer is "host". They run the full simulation.
- Clients send input → host. Host runs game logic → broadcasts state.
- Clients render the broadcast state, optionally with client-side
  prediction for the local player.

**Why host-auth first:**
- Simplest. One source of truth.
- No conflict resolution needed.
- Works fine for trusted-peer scenarios (friends playing together).

**P2P-shared-state** (later phase):
- All peers run the simulation. Conflicts resolved via CRDTs or
  lockstep rollback.
- Better latency feel but vastly more complex.
- Defer until host-auth is solid.

**Lag compensation** (stretch):
- Client-side prediction: client runs movement locally, host
  reconciles via a snapshot-history rewind.
- Standard FPS pattern. Adds bookkeeping but no architectural changes.

---

## Components / API surface

| Concern | Lives | Notes |
|---|---|---|
| `NetworkId` component | engine | Stable id across peers. Assigned by host. |
| `Replicate` component | engine | List of synced components + rates. |
| `NetworkOwner` component | mod pack | Which peer's input controls this entity. |
| `NetSyncSystem` | mod pack | Per-frame snapshot + diff + send/recv. |
| `RemoteInputSystem` | mod pack | Applies received input deltas to host-side player entities. |
| `api.network` | engine | `connect(opts)`, `send(channel, data)`, `onMessage(channel, fn)`. WebRTC + WebSocket transports. |
| `api.events` | engine | Pub/sub for "remote entity spawned" / "remote entity destroyed". Useful generally; multiplayer is one consumer. |

---

## Existing assumptions to fix

Today the codebase assumes single-player in a few places:

- **`PlayerInputSystem`** queries `world.first(PlayerInput, ...)`.
  Comment already notes "coop refactor would track per-player." Easy
  to make per-entity-with-PlayerInput.
- **`Game.render`** queries `world.first(Camera, Position, Facing)`
  for the local viewpoint. Already correct — there's only ONE local
  camera even in multiplayer (your local view).
- **Pack-script lifecycle** — `Game.runPackScripts` is sync today.
  Multiplayer needs `onWorldReady` to fire AFTER scene entities spawn
  AND before the net handshake. Already in the `ENGINE_PACK_SPLIT.md`
  R3 plan.

None of these are deep — small refactors when the time comes.

---

## Phased rollout

### M1 — Engine primitives
- Add `NetworkId` + `Replicate` components in `packages/engine/src/Components/`.
- Add `api.network` ModAPI surface (WebRTC + WebSocket).
- Add `api.events` pub/sub.
- Add a snapshot helper: `world.snapshotReplicated()` returns a flat
  array of `{ netId, component, data }` for diffing.

### M2 — Host-authoritative skeleton
- Multiplayer pack with `NetSyncSystem` (snapshot + diff every 50ms).
- Manual SDP signaling (paste offers via URL or textarea).
- Two players in the same demo scene, both running around, Position
  syncing.

### M3 — Remote input
- Clients send held-keys + mouse-deltas to host.
- Host runs PlayerInputSystem per remote client's player entity.
- Lag feels rubbery on the client (~50ms round trip on LAN).

### M4 — Client-side prediction for local player
- Client locally simulates its own player input immediately.
- Host snapshot reconciles when it arrives; rollback + replay any
  predictions newer than the snapshot tick.
- Movement now feels snappy on the client.

### M5 — Stretch goals (each independent)
- WebSocket transport for true server-auth deployments.
- Signaling server (simple Bun service for SDP exchange).
- Voice chat via WebRTC audio tracks.
- Persistent rooms / lobbies.

### M6 — Polish
- Anti-cheat: host validates client inputs against physics (no
  teleporting, no fire-rate exploits).
- Disconnect / reconnect handling.
- Spectator mode.

---

## Risks

- **Determinism**: with host-auth, only the host needs to be
  deterministic — clients render snapshots. Easy.
- **JS object identity vs network sync**: `Vec2` is immutable so
  Position can be straightforward; but Arrays / Maps in components
  (e.g. `Inventory.bag: ItemStack[]`) need careful per-frame
  diffing. Snapshot-and-diff makes this easier than dirty flags.
- **Pack-script lifecycle**: net system needs to register BEFORE
  scene-load (so prefabs exist when remote entities spawn) but
  CONNECT after scene-load (so the world is ready). The R3 lifecycle
  with `register-phase` + `onWorldReady-phase` handles this cleanly.
- **The bake doesn't apply to multiplayer.** Baked lighting is a
  build-time output of static scene entities. Dynamic mod-spawned
  remote players never participate in the bake — same contract as
  the static-vs-dynamic light split. No new architecture needed.

---

## Hard dependency on engine/pack split — ✅ Satisfied (2026-05-16)

**ENGINE_PACK_SPLIT R3 + Ev1 (api.events) + Au1 (api.audio) +
A1 (api.anim) all landed. M1 is ready to start.**

Multiplayer benefits enormously from
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) being at least
through R3 (game-specific systems migrated to packs) for two
reasons:

1. **Net system as a pack** — if all systems are still hardcoded
   in `packages/engine/src/`, the multiplayer pack can't actually
   live as a pack. R3 shipped.
2. **ModAPI maturity** — `api.network` (pending here in M1),
   `api.events` (shipped Ev1), `api.input` (shipped R3),
   `api.onWorldReady` (shipped R1) are the engine surfaces that
   R3's ModAPI redesign specs. The remaining gap is `api.network`,
   which M1 adds.

Doing multiplayer BEFORE the engine/pack split would force ad-hoc
engine modifications. Doing it AFTER fits naturally into the
architecture.

**Order**: ENGINE_PACK_SPLIT R1–R3 ✅ → MULTIPLAYER M1–M3 (now
unblocked).

---

## Bootstrap commands for the fresh session

```sh
cat PLAN.md
cat ENGINE_PACK_SPLIT.md
cat LIGHTING_ENTITIES_REFACTOR.md
cat MULTIPLAYER_PLAN.md          # this file
```

Then start at M1 — engine primitives (NetworkId, Replicate, api.network).
Three components / one ModAPI surface; one session of work, smoke-tested
against the existing single-player demo to confirm no regression.
