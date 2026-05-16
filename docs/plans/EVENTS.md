# Pub/sub event bus — EVENTS plan

A namespaced, synchronous, fire-and-forget event bus exposed on the
ModAPI as `api.events`. Engine fires canonical lifecycle events at
well-known moments; pack scripts subscribe to react without ECS-
shaped contortions. Pack scripts also emit their own topics for
cross-system + cross-pack coordination.

Source-of-truth for implementation. Phases Ev1–Ev3 below. Cross-refs:
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) (the engine surface
this extends), [PACK_CHAIN.md](./PACK_CHAIN.md) (Ev2's cross-pack
events build on the chain loader), [EDITOR.md](./EDITOR.md) (Ev3
adds a real-time event log overlay), [MULTIPLAYER_PLAN.md]
(./MULTIPLAYER_PLAN.md) (future: selectively replicate topics).

Last revised: 2026-05-16.

---

## 1. Goals & non-goals

### Goals

- **First-class moments.** Engine emits canonical events at lifecycle
  points (scene load, entity spawn/despawn, modal open, player death,
  frame ticks). Pack scripts subscribe instead of polling.
- **Pack-to-pack coordination.** Pack A emits `weapon:fired`; pack B
  (a "weapon mods" overlay) subscribes and adds a screen-shake.
  Inter-pack glue without either pack importing the other. Enables
  the [PACK_CHAIN.md](./PACK_CHAIN.md) override-free extension
  pattern.
- **Cross-system glue inside one pack.** Pickup emits
  `pickup:collected`; the HUD subscribes and flashes a toast. Today
  this needs either a shared ECS component (awkward — moments aren't
  state) or a `globalThis` shim.
- **Auto-cleanup on pack reload / HMR.** A pack's old subscriptions
  drop automatically when the pack reloads. No teardown boilerplate.
- **Predictable order, predictable cost.** Synchronous dispatch,
  registration order. No microtask juggling, no async footguns.
- **Tiny ModAPI surface.** `on / once / off / emit`. Wildcards are a
  small extension. Nothing else.

### Non-goals

- **Request/response.** `emit` returns `void`. Modders wanting a
  reply use ECS components or roll a correlation-id pattern on top
  of two events. "Collect return values" invites race patterns.
- **Cross-frame queuing.** Events fire synchronously. Want
  "next frame"? Use `frame:after` or `api.registerSystem`.
- **Persistent/replayable log.** Ev3 records events for the editor
  overlay only; no on-disk replay format in the engine.
- **Topic ACL / permissions.** Any pack can emit any topic. Same
  trust model as today's shared `world`. Documented in §6.4.
- **Network replication.** The multiplayer pack subscribes locally +
  forwards selected topics over the wire. Bus itself stays process-
  local.
- **Wildcards across separators.** `player:*` matches one segment.
  No `**` deep wildcard, no regex, no glob.
- **Per-subscriber priority / interception.** Handlers can't cancel,
  can't reorder. Registration order = fire order. Period.

---

## 2. Status quo

There is no event API. Three workarounds, each awkward:

### 2.1 Shared ECS components for moments

A "player died" broadcast becomes a `PlayerDead { atFrame }`
component every interested system polls + frame-checks. ECS models
*state*; "player died" is a *moment*. Squeezing the moment into
state-shaped storage costs frame-tracking boilerplate in every
listener — and one missed frame misses the moment.

### 2.2 Direct cross-script imports

The pickup system's `collected()` hook lives on
`globalThis.__pickupHooks`; the HUD reads from there. Works inside
one pack, breaks across packs — scripts load alphabetically, can't
know which other packs loaded.

### 2.3 Polling engine state

`PlayerInputSystem` reads `api.modals.any()` every frame to gate
input. That's fine for per-frame queries, no good for "fire once
when the inventory opens." Three pack systems
(`pickup.js`, `player-input.js`, `gun-render.js`) each carry their
own `wasModalOpen` edge-detector — three implementations of one
idea.

### 2.4 What we want

```js
api.events.on("scene:loaded", ({ name }) => spawnWave(1));
api.events.on("modal:opened", ({ name }) => audio.play("rustle"));
api.events.on("player:died", () => api.spawn("gravestone"));
```

Three lines, three behaviours that today need bespoke edge-
detection or component plumbing.

---

## 3. ModAPI surface

### 3.1 Types

```ts
// packages/engine/src/ModAPI/types.ts (additions)

/**
 * Handle returned by `on()` / `once()`. Idempotent `.off()` — calling
 * twice is a no-op. Most pack scripts won't stash the handle; auto-
 * cleanup on pack reload (§6) covers the common case.
 */
export interface EventSubscription {
  readonly name: string;
  off(): void;
}

/**
 * Pub/sub event bus. Synchronous dispatch — `emit` runs every
 * matching handler in registration order before returning. Handlers
 * that throw are logged + skipped; later handlers still run.
 *
 * Topics use `:` as a namespace separator (`scene:loaded`,
 * `inventory:added`). Wildcards (§3.3) match one trailing segment.
 *
 * Subscriptions registered inside a pack script auto-cleanup when
 * that pack reloads or unloads — see §6.
 */
export interface EventsAPI {
  on<T = unknown>(name: string, handler: (payload: T) => void): EventSubscription;
  once<T = unknown>(name: string, handler: (payload: T) => void): EventSubscription;
  off(name: string, handler: (payload: unknown) => void): void;
  off(subscription: EventSubscription): void;
  emit<T = unknown>(name: string, payload?: T): void;
}
```

Surface placement: `api.events: EventsAPI`. One field on `ModAPI`.
Implementation lives in `packages/engine/src/ModAPI/EventRegistry.ts`,
peer of `ModalsRegistry` + `UIRegistry`.

### 3.2 Off variants

`off(subscription)` is the recommended path — `O(1)`, unambiguous.
`off(name, handler)` exists for ergonomic parity with DOM
`removeEventListener`. It's `O(handlers on topic)` and requires the
exact same function reference (no curried wrappers — those are
different objects).

### 3.3 Wildcard rules

`*` matches one segment only:

| Pattern | Matches | Doesn't match |
|---|---|---|
| `player:*` | `player:died`, `player:moved` | `player:weapon:fired`, `enemy:died` |
| `scene:*` | `scene:loaded`, `scene:beforeUnload` | `scene:enemy:spawned` |
| `*` | every event with zero `:` | every namespaced event |
| `player:weapon:*` | `player:weapon:fired`, `player:weapon:reloaded` | `player:weapon`, `player:weapon:slot:1` |

Rule: split topic on `:`; pattern segments equal-match except `*`
which matches any one segment. No `**`, no globbing, no regex. The
split is the spec.

Wildcards live in a separate small array (§7.1) so common-case
`emit` cost is `O(exact handlers on topic)`, not `O(all handlers)`.

---

## 4. Canonical engine events

Engine fires these at well-known moments. Payload shapes are stable;
the canonical list grows additively (no renames once a name ships).

### 4.1 Scene lifecycle

| Topic | When | Payload |
|---|---|---|
| `scene:beforeLoad` | Before scene swap begins. New scene parsed; no entities spawned for it yet. | `{ from?: string; to: string }` |
| `scene:loaded` | After `spawnInitialEntities()` + every `onWorldReady` callback. Safe to query entities. | `{ name: string; size: { x: number; y: number } }` |
| `scene:beforeUnload` | Before the active scene's world is torn down. Last chance to read entity state. | `{ name: string }` |

### 4.2 Entity lifecycle

| Topic | When | Payload |
|---|---|---|
| `entity:spawned` | Fired from `ModAPIImpl.spawnPrefab` after the factory returns. Ev1: prefab spawns only — raw `world.spawn()` doesn't fire. | `{ entity: Entity; prefabName?: string }` |
| `entity:despawned` | `world.despawn(e)` — SYNCHRONOUSLY before removal so handlers can read components one last time. | `{ entity: Entity }` |

### 4.3 Player state

| Topic | When | Payload |
|---|---|---|
| `player:moved` | Throttled: every Nth frame OR every cell-boundary cross (whichever first). Default N=10 (~6 Hz). | `{ position: Vec2; velocity: Vec2; cellX: number; cellY: number }` |
| `player:died` | `Health` component drops ≤ 0. Reserved until Health lands. | `{ entity: Entity; killer?: Entity }` |
| `player:teleported` | `Position` set non-incrementally (scene transitions, debug warps). | `{ from: Vec2; to: Vec2 }` |

### 4.4 Modal lifecycle

| Topic | When | Payload |
|---|---|---|
| `modal:opened` | `ModalRegistry.setOpen(name, true)` transitions OFF→ON. | `{ name: string }` |
| `modal:closed` | `ModalRegistry.setOpen(name, false)` transitions ON→OFF. | `{ name: string }` |

Registry already debounces — calling `setOpen(name, true)` when
already open is a no-op, so events only fire on actual edges.

### 4.5 Input

| Topic | When | Payload |
|---|---|---|
| `input:keyDown` | Native `keydown` reached `KeyboardController`. | `{ key: KeyCode; modifiers }` |
| `input:keyUp` | Native `keyup`. | `{ key: KeyCode; modifiers }` |
| `input:mouseDown` | Native `mousedown` on canvas. | `{ button: number; modifiers; position: Vec2 }` |
| `input:mouseUp` | Native `mouseup`. | `{ button: number; modifiers; position: Vec2 }` |
| `input:wheel` | Native `wheel`. | `{ deltaY: number; modifiers }` |

`modifiers` is `{ shift, ctrl, alt, meta }`. Input events fire
BEFORE the engine's per-frame controller-state read, so a handler
querying `api.input.keyboard.isKeyPressed` sees the new state.

### 4.6 Pack lifecycle

| Topic | When | Payload |
|---|---|---|
| `pack:loaded` | Once at boot, after every pack script default-export resolves + every `onWorldReady` callback fires. | `{ manifest: PackManifest }` |
| `pack:reloaded` | After an HMR pack reload. World already has entities; sibling packs may need to re-hydrate references. | `{ manifest: PackManifest; reason: "hmr" \| "manual" }` |

### 4.7 Frame ticks (sparingly)

| Topic | When | Payload |
|---|---|---|
| `frame:before` | Top of `Game.update`, before any system runs. | `{ deltaTime: number; frameIndex: number }` |
| `frame:after` | Bottom of `Game.update`, after every system + UI flush. | `{ deltaTime: number; frameIndex: number }` |

Documented but discouraged for hot work — see §8.2. Engine emits
unconditionally; if no handlers are subscribed, per-frame cost is a
single `Map.get` returning `undefined`.

### 4.8 Inventory + pickup (default-pack-emitted, canonical names)

These live in default-pack scripts but their topic names are
canonical so chain packs can subscribe by well-known name:

| Topic | When | Payload |
|---|---|---|
| `inventory:added` | After `addItem` adds ≥ 1 unit. | `{ entity; itemId; count; slot }` |
| `inventory:removed` | After `removeItem` removes ≥ 1 unit. | `{ entity; itemId; count }` |
| `inventory:activeChanged` | Hotbar active slot changes. | `{ entity; from: number; to: number }` |
| `pickup:collected` | `pickup.js` fully drains a pile (partial pickups don't fire). | `{ player; itemId; count }` |
| `weapon:fired` | `gun-render.js` fire input edge-triggered. | `{ player; weaponId; ammoLeft }` |

### 4.9 Full canonical list (count: 25)

scene:beforeLoad, scene:loaded, scene:beforeUnload,
entity:spawned, entity:despawned,
player:moved, player:died, player:teleported,
modal:opened, modal:closed,
input:keyDown, input:keyUp, input:mouseDown, input:mouseUp, input:wheel,
pack:loaded, pack:reloaded,
frame:before, frame:after,
inventory:added, inventory:removed, inventory:activeChanged,
pickup:collected, weapon:fired.

(25 today. Grows additively; no renames once a topic ships.)

---

## 5. Pack-emitted custom events

Modders define their own. No registration, no schema declaration —
just `api.events.emit("my_pack:wave_started", { n: 3 })`.

### 5.1 Naming convention

Pack custom topics SHOULD be prefixed with the pack id
(lower-snake, matching `manifest.json`'s pack id):

```
acme_rpg:level_up
acme_weather:rain_started
acme_weather:lightning_struck
```

Two reasons to prefix:

1. **Conflict avoidance.** Two packs both emitting bare `level_up`
   step on each other.
2. **Wildcard cleanliness.** `events.on("acme_rpg:*", logger)` only
   logs RPG events.

Convention, not enforced. Engine canonical topics (§4) are the only
un-prefixed names; pack authors leave the bare namespaces (`scene`,
`entity`, `player`, `modal`, `input`, `pack`, `frame`, `inventory`,
`pickup`, `weapon`) alone.

### 5.2 Payload schema

Free-form objects. No engine-enforced schema; modder owns the
contract. When the pack store ([STORE.md](./STORE.md)) lands, pack
manifests can OPTIONALLY declare event shapes in `manifest.events`;
the store surfaces them as pack docs. Documenting is encouraged;
not declaring is fine.

---

## 6. Cleanup semantics

Auto-cleanup is the most important ergonomic property: a pack that
loads, subscribes, then reloads must NOT leak old subscriptions.

### 6.1 Pack-tagged subscriptions

Every subscription is tagged with the pack id of the script that
registered it. `runPackScripts` knows which pack is running because
it dispatches scripts serially:

```ts
class EventRegistry {
  private currentPackId: string | null = null;
  private byTopic = new Map<string, Set<TaggedHandler>>();
  private byPack = new Map<string, Set<TaggedHandler>>();

  setActivePack(packId: string | null) { this.currentPackId = packId; }

  on(name: string, handler: Function): EventSubscription {
    const tagged = { name, handler, packId: this.currentPackId };
    addTo(this.byTopic, name, tagged);
    if (tagged.packId) addTo(this.byPack, tagged.packId, tagged);
    return { name, off: () => this.remove(tagged) };
  }

  /** Drops every subscription a pack registered. */
  unloadPack(packId: string) {
    const owned = this.byPack.get(packId);
    if (!owned) return;
    for (const t of owned) this.remove(t);
    this.byPack.delete(packId);
  }
}
```

`Game.runPackScripts` wraps each script execution:

```ts
for (const { path, source, packId } of scripts) {
  this.api.events.setActivePack(packId);
  try { await loadAndRun(source); }
  finally { this.api.events.setActivePack(null); }
}
```

Subscriptions registered OUTSIDE pack scripts (engine internals)
get `packId = null` and are not auto-cleaned.

### 6.2 HMR reload

When the user edits a pack file:

1. `bun run build-packs` repacks the `.apg`.
2. Browser reloads (pack swaps are coarse-grained today —
   PLAN.md §6).
3. New `Game` instance creates a new `EventRegistry`.
4. Old subscriptions die with the old registry (GC'd; no leaks).

Finer-grained pack-script HMR (future): call `unloadPack(packId)`,
re-run the pack's scripts, emit `pack:reloaded` so sibling packs
can re-attach if they cached entity references.

### 6.3 Manual unsubscribe

Most pack scripts don't call `off`. The two cases that do:

1. **Conditional listeners.** "Subscribe to `enemy:spotted` only
   while the radar's on." Stash the handle on radar-open; `.off()`
   on radar-close.
2. **One-shot via `once`.** Auto-removes after first fire — modder
   doesn't manage it.

### 6.4 Trust model

A malicious or buggy pack can emit confusing topics — e.g. firing
fake `player:died` to trigger another pack's death-screen logic.
Documented in [STORE.md](./STORE.md)'s trust model. Packs ARE NOT
sandboxed; the bus is no different. A hardened mode could namespace
visibility per pack, but cost (losing cross-pack coordination) is
too high for v1. Mods that want isolation can use a private symbol-
keyed bus inside their pack.

---

## 7. Synchronous dispatch

### 7.1 Storage

```ts
// Topic → ordered Set<handler> (ES2015 Set preserves insertion order).
private exact: Map<string, Set<TaggedHandler>>;
// Wildcard patterns ("player:*", "*"). Scanned per emit; kept
// in a separate small array.
private wildcards: Array<{ pattern: string[]; handler: TaggedHandler }>;
```

`Set<TaggedHandler>` preserves insertion order — registration-order
property comes free.

### 7.2 Dispatch snapshot

`emit(name, payload)`:

1. Snapshot exact set + wildcards array (`[...exact.get(name)]`).
   Snapshotting lets handlers add/remove subscriptions mid-dispatch
   without breaking iteration.
2. For each entry, call `handler(payload)` in a try/catch. If it
   throws: `console.error("[two_5_d] events: handler for", name,
   "threw:", err)` and continue.
3. After exact handlers, iterate wildcards; per entry split the
   topic + match against the cached pattern segments. On match,
   call same way.

Snapshot copy is cheap — exact sets typically <10 entries, wildcards
typically <5. Revisit if a pack registers thousands.

### 7.3 Why synchronous

1. **Predictable ordering.** Async dispatch (microtasks) lets `B`'s
   handlers start before `A`'s finish; sync keeps emit order =
   handler order.
2. **No microtask interleaving.** Per-frame work stays in one
   frame. ECS mutations inside a handler are visible to the next
   system that reads them.
3. **Easier to reason about.** Modders see "fire-and-forget" and
   read it as fire-and-forget.

Cost: long-running handlers stall the emitter. Mitigation: §8.2
docs + `api.registerSystem` as the per-frame escape hatch.

### 7.4 Re-entrancy

A handler MAY emit a new event; it fires synchronously inside the
original `emit`'s call frame. Stack depth bounded by modder logic
— infinite recursion is a modder bug, not a bus bug.

`once` removes its subscription BEFORE invoking the handler, so a
handler that re-emits the same topic doesn't re-fire itself.

---

## 8. Performance characteristics

### 8.1 Emit cost

| Scenario | Cost |
|---|---|
| 0 handlers, 0 wildcards on the topic | 1 `Map.get` returning `undefined`. ~5 ns. |
| N exact handlers, 0 wildcards | `Map.get` + N-entry array copy + N handler calls. |
| N exact + W wildcards (TOTAL across registry, not per topic) | + W split-and-match comparisons per emit. |

The wildcard scan is linear in TOTAL `W` across the registry.
Realistic packs have <5 wildcards. 100 wildcards = 100 string-array
comparisons every emit.

### 8.2 What NOT to subscribe to

`frame:before` / `frame:after` fire 60×/sec. Handlers allocating
closures or building strings per invocation show up on profiles.
Use them only for:

- Throttled state (UI updater that internally rate-limits to 4 Hz).
- Debug overlays in dev mode.

For per-frame world logic, prefer `api.registerSystem` — one less
abstraction layer. `player:moved` is throttled by default for the
same reason.

### 8.3 Memory

Each subscription: ~80 bytes (TaggedHandler + Set entry overhead).
Pack-by-pack index doubles to ~160. 1000 subscriptions across a
session ≈ 160 KB — negligible.

Pack-reload GC: `O(handlers in pack)` traversal + `Map.delete`. <1
ms for any realistic pack.

### 8.4 Tooling caveat

Ev3's editor overlay records events while open. Each `emit` pays
an extra log-buffer push (~50 ns). Off by default.

---

## 9. Worked examples

### 9.1 Cross-system communication

Pickup emits on drain; HUD subscribes to flash a toast.

```js
// pickup.js — emit at drain moment
api.events.emit("pickup:collected", { player, itemId, count });

// hud-toast.js — subscribe
api.events.on("pickup:collected", ({ itemId, count }) => {
  showToast(`picked up ${count} × ${itemId}`, 1.5);
});
```

Today this needs a shared ECS component or `globalThis` shim.

### 9.2 Lifecycle hook — spawn wave 1 on scene load

```js
api.events.on("scene:loaded", ({ name }) => {
  if (name !== "level1.json") return;
  for (let i = 0; i < 5; i++) api.spawn("imp", 3 + i, 7);
});
```

Today `onWorldReady` fires once per scene-load for the active
scene only. The bus version naturally handles "every time this
scene loads" (e.g. respawn-on-death scenarios).

### 9.3 One-shot — detect first player movement

```js
api.events.once("player:moved", () => {
  console.log("tutorial step 1 complete");
  api.modals.setOpen("tutorial_step_2", true);
});
```

`once` auto-unsubscribes after first fire. Modder doesn't manage
the handle.

### 9.4 Modal coordination — suppress fire while inventory is open

```js
// In gun-render.js — today polls api.modals.any() every frame.
let canFire = true;
api.events.on("modal:opened", ({ name }) => {
  if (name === "inventory" || name === "settings") canFire = false;
});
api.events.on("modal:closed", () => {
  if (!api.modals.any()) canFire = true;
});
```

The gun's state is event-driven, not poll-driven.

### 9.5 Pack interop — community weapon-mods pack

```js
// weapon-mods-pack — subscribes to base-game weapon:fired
api.events.on("weapon:fired", ({ weaponId }) => {
  if (weaponId === "shotgun") shakeCameraFor(0.2, 4);
});
```

No shared symbol, no override hook, no monkey patch. When
[PACK_CHAIN.md](./PACK_CHAIN.md) lands, this is the canonical
pattern for extending base-game behaviour.

### 9.6 Debug — log every event in a namespace

```js
api.events.on("inventory:*", (payload) => console.log("[inv]", payload));
```

Wildcards make ad-hoc debugging cheap. Cost is bounded by total
wildcard count (§8.1).

### 9.7 Wave chain — state machine via events

```js
let currentWave = 0;
function startWave(n) {
  currentWave = n;
  api.events.emit("wave:started", { waveNumber: n });
  spawnWaveEnemies(n);
}
api.events.on("entity:despawned", ({ entity }) => {
  if (!entity.has(api.components.WaveTag)) return;
  if (countLiveEnemies() === 0) {
    api.events.emit("wave:cleared", { waveNumber: currentWave });
    setTimeout(() => startWave(currentWave + 1), 3000);
  }
});
api.events.on("wave:started", ({ waveNumber }) => showBanner(`Wave ${waveNumber}`));
```

State machine reads as the moments it fires on.

---

## 10. Editor UX (brief)

[EDITOR.md](./EDITOR.md) gains an Ev3 dev-mode overlay that:

- Subscribes via per-namespace catch-alls (`scene:*`, `player:*`, …)
  + `*` for un-namespaced events.
- Logs each event with timestamp, topic, payload (JSON-stringified
  with depth cap), source pack (read from `currentPackId` at
  emit-time — thread it through the snapshot).
- Filters by namespace, severity (info / warn / error for handler-
  throw events), text search.
- Optional record-and-replay: stash a session's events to JSON,
  re-emit them against a fresh world for repro.

Editor-only. Production builds don't include the overlay.

---

## 11. Phases

| Phase | Scope | State |
|---|---|---|
| **Ev1** | Core `EventsAPI` (on / once / off / emit, no wildcards). Canonical engine events (§4.1–4.7). Auto-cleanup on pack reload via `currentPackId` tagging. Default-pack systems (pickup, gun-render) start emitting their topics (§4.8). Tests cover registration + dispatch + cleanup. | ✅ Shipped (commit `52d8e27`). Registry lives at `packages/engine/src/ModAPI/EventsRegistry.ts`; canonical topics in `packages/engine/src/ModAPI/canonical-events.ts`. |
| **Ev2** | Wildcards (`name:*`, `*`). Pack-id propagated through snapshots so subscribers can introspect emitter pack. Documented ordering + re-entrancy. Optional manifest declaration `events: { emits, subscribes }` for store-side docs; pack-builder regex-validates declared emits actually appear in scripts. | Designed. Not started. |
| **Ev3** | Editor real-time event log overlay (filter / search / record / replay). Per-handler timing badges in the overlay. Replay JSON format. | Designed. Awaits EDITOR scaffold. |

### 11.1 Ev1 file map (as shipped)

- `packages/engine/src/ModAPI/EventsRegistry.ts` — class + dispatch.
- `packages/engine/src/ModAPI/canonical-events.ts` — canonical topic names + payload types.
- `packages/engine/src/ModAPI/types.ts` — `EventsAPI` + `EventSubscription`; `ModAPI.events`.
- `packages/engine/src/Game.ts` — emit `pack:loaded`, `scene:loaded`, `frame:before/after`, `entity:spawned` / `entity:despawned`.
- Modal lifecycle emits `modal:opened/closed` on `setOpen` edges.
- Controllers forward DOM events for `input:*` topics.
- `packages/default-pack/scripts/systems/pickup.js` — emits `pickup:collected`.
- `packages/default-pack/scripts/systems/gun-render.js` — emits `weapon:fired`.

---

## 12. Open questions

1. **Namespaces vs flat names.** Engine uses `:` namespaces. ✅
   Accepted — better organization, wildcards work cleanly. Not
   enforced for pack-defined topics; convention only.

2. **Emit return value.** ✅ `void`. Modders wanting request-
   response use ECS components or a correlation-id pattern on top
   of two events. Returning a count invites `if (emit(...) > 0)`
   logic that breaks when subscribers come and go.

3. **Cross-pack event visibility.** ✅ YES — it's the point of
   inter-pack coordination. Trust implication (§6.4) is the same
   as today's shared `world`. Optional isolation mode could ship
   later if the community wants it.

4. **HMR-survival of single-script subscriptions.** ✅ NO — clean-
   slate. Fire `pack:reloaded` so scripts re-hydrate. Survival
   would leak stale handlers; modder would dedupe manually.

5. **Deep wildcard `**`?** Recommendation: NO for now. `*` matches
   one segment. Debuggers wanting "every event" use per-namespace
   catch-alls. Revisit post-Ev2 only if a real use-case appears.

6. **`frame:*` payload deltaTime — raw vs clamped?** Recommendation:
   CLAMPED (matches what systems see — `Engine.ts` already clamps
   the per-frame dt). Confirm during Ev1 implementation.

7. **Editor recording format (Ev3).** Recommendation: JSON for v1
   with a `Vec2 → {x,y}` replacer. Entity ids are already small
   ints. Structured "snapshot ref" form deferred.

8. **`entity:spawned` for raw `world.spawn()`?** Recommendation:
   NO — only prefab-routed spawns (engine has no `prefabName` to
   attach for raw spawns). Modders can emit manually:
   `api.events.emit("entity:spawned", { entity })`. Revisit if it
   becomes a real problem.

9. **Multiplayer replication.** [MULTIPLAYER_PLAN.md]
   (./MULTIPLAYER_PLAN.md) might want certain topics auto-
   replicated. The multiplayer pack can subscribe locally + forward
   selectively; no engine-side opt-in needed for v1. ✅ Deferred.
