# World-state — data-first engine overhaul

Plan document for the architectural shift that completes the
prefabs-editor-only journey (PE1–PE3): the engine stops assuming
anything about a "game" beyond ECS + scenes + scripts. Everything
game-specific — components, controllers, per-scene controllers,
systems, even "what makes a scene start" — is declared by the
active pack as data + script bodies. The engine just plumbs it.

This is sibling to the prefabs-editor-only plan (PE1+PE2+PE3
already shipped 2026-05-17; doc since deleted, see git log). PE
collapsed runtime prefab resolution into
flat `scene.entities[]` records. WORLD_STATE finishes the job by
collapsing the last hardcoded game-shaped surfaces (`scene.spawn`,
hardcoded engine systems, hidden "player must exist" assumptions)
into the same declarative-records-plus-scripts shape.

---

## 1. tl;dr

The engine = a generic ECS host. It provides primitives only:

  - a `World` with `spawn / despawn / query / each`,
  - a declarative component registry (`manifest.components[]`),
  - scene loading (geometry + flat entity records),
  - a synthetic **scene-controller entity** with the same component
    mechanism as any other entity,
  - a **world-singleton helper** for "one persistent entity per
    component name",
  - a **system scheduler** that registers `Systems`-component
    entries into named phases (`update`, `fixedUpdate`, `render`),
  - a **scripts-component handler** for setup/event-binding scripts
    that run at entity-attach time,
  - **serialize / deserialize** so script-side or net-side code
    can move entity state through JSON without engine help,
  - lifecycle events the engine fires in a defined order.

The pack ships everything else: which components exist, what shape
they have, which components live on the scene controller, which
systems run per phase, what "player" / "enemy" / "victory" mean.

Result: a chess pack, a roguelike pack, a Wolfenstein clone pack
all run on the same engine binary. The engine has zero opinion on
game type. PE removed runtime prefab resolution; WORLD_STATE
removes runtime game-type assumption.

---

## 2. Principles

1. **Declarative first.** Anything that can be declared in JSON
   should be declared in JSON. Scripts only carry behavior bodies
   (per-frame logic, event handlers, complex spawn logic). The
   engine looks at manifests + scenes + script bodies in a fixed,
   well-defined order and never invents its own meanings.
2. **Everything is a component.** Per-entity state, per-scene
   state (on the controller), per-world state (on a singleton) —
   all use the same component primitive. No bespoke "scene
   settings" or "world flags" surface alongside the ECS.
3. **Scripts carry behavior bodies, not control flow.** A script
   is a default-exported function the engine invokes at a
   well-known point (system tick, attach event, world ready). The
   engine schedules; the script just acts.
4. **Engine has no opinion about game type.** No hardcoded
   "player", no hardcoded "spawn at this location", no built-in
   AI. Engine knows: ECS, render, audio, raycast, input. Pack
   knows: what a Player is, what a SpawnerList is, what a
   Victory condition is.
5. **The same machinery handles all three state scopes** (entity,
   scene-controller, world-singleton). One mental model, three
   lifetimes.
6. **Lifecycle is fully observable.** Engine emits events at every
   well-known boundary (`world:ready`, `scene:willUnload`,
   `scene:loaded`, `entity:spawned`, `entity:despawned`). Pack
   scripts subscribe; engine never calls them directly.

---

## 3. Engine surface (final)

After this overhaul the public ModAPI shape stabilises around the
following:

```ts
interface ModAPI {
  // primitives
  readonly world: World;
  readonly scene: SceneAPI;
  readonly config: GameConfig;
  readonly pack: AssetPack;
  readonly components: Record<string, Component<unknown>>;
  readonly Vec2: typeof Vec2;
  readonly Component: typeof Component;

  // component registry
  defineComponent<T>(name: string): Component<T>;
  getComponent(name: string): Component<unknown> | undefined;

  // entity API (also exposed via world)
  singleton<T>(componentName: string): T;
  serialize(entityId: EntityId): SerializedEntity;
  deserialize(json: SerializedEntity, opts?: { targetId?: EntityId }): EntityId;

  // existing slices (events, input, audio, anim, modals, ui, …)
  readonly events: EventsAPI;
  readonly input: InputAPI;
  readonly audio: AudioAPI;
  readonly anim: AnimAPI;
  readonly modals: ModalsAPI;
  readonly ui: UIAPI;
  readonly settings: SettingsAPI;
  readonly bindings: BindingsAPI;
  readonly inventory: InventoryAPI;
  readonly raycast: RaycastAPI;
  readonly itemImages: ItemImagesAPI;
  readonly debug: DebugAPI;

  // legacy/back-compat (kept until removal in a later pass)
  registerSystem(fn: FrameFn): () => void;
  registerRendererSystem(fn: RendererSystemFn, phase: RenderPhase): () => void;
  onWorldReady(fn: (api: ModAPI) => void): void;
}

interface SceneAPI {
  readonly name: string;
  readonly size: Vec2;
  // pack-derived scene-controller entity. Always present (synthetic).
  readonly controller: {
    id: EntityId;
    components: Readonly<Record<string, unknown>>;
  };
  // existing helpers
  isWall(x: number, y: number): boolean;
  canPlayerPass(x: number, y: number, headZ: number): boolean;
  maxHeadroom(x: number, y: number): number;
  // ...
}

interface World {
  spawn(): EntityId;
  despawn(id: EntityId): void;
  add<T>(id: EntityId, c: Component<T>, v: T): this;
  remove<T>(id: EntityId, c: Component<T>): void;
  has(id: EntityId): boolean;
  first(...components: Component<unknown>[]): EntityId | undefined;
  each(...args): void;            // existing typed callback
  query(...names: string[]): Iterable<EntityId>;
  entityCount(): number;
  // NEW (2026-05-17, world.json full-scope) — name index for
  // persistent entities authored in `world.json.entities[]`.
  // The engine writes to this index on every spawn that carries a
  // `name` field; pack scripts read it to locate persistent entities
  // without having to query by component shape.
  setName(id: EntityId, name: string | undefined): void;
  findByName(name: string): EntityId | undefined;
  liveEntities(): EntityId[];
}
```

**Removed in the "world.json full-scope" pass (2026-05-17):**

  - `api.scene.spawn` / `Scene.spawn` / `SceneSpawn` / `DEFAULT_SPAWN`
    / `synthesiseControllerFromSpawn` / `SceneJSON.spawn`. The spawn
    point now lives ONLY at
    `api.scene.controller.components.SpawnerList.points[0]`. Pack
    scripts that need to locate a persistent player call
    `api.world.findByName("player")` and read its `Position` /
    `Facing` components.
  - `manifest.scripts[]` / `pack.scripts()`. Script entry points now
    live in `world.json.scripts[]` (and `Scripts.refs[]` on world
    entities / scene-controller components / scene entities). The
    pack-builder walks every source surface to find paths to compile.

**Removed in this overhaul:**

  - hardcoded engine "system" classes that operate on game-shaped
    components — moved to pack-side script bodies registered via
    a `Systems` component (see §7 + §11).
  - Scene's top-level `spawn: { x, y, facing }` as a SOURCE OF
    TRUTH — replaced by `controller.components.SpawnerList`. The
    field is kept as a back-compat read for one release; the
    scene-controller derives it.
  - any engine code path that reads `Camera`, `Movement`,
    `PlayerInput` directly to enforce gameplay (the engine still
    *renders* against `Camera` because rendering is engine-side,
    but it no longer asserts that one exists).

---

## 4. Component model

Components are now declared **declaratively** in the pack manifest:

```jsonc
// manifest.json
{
  "components": [
    { "name": "Position",     "tags": ["entity"]            },
    { "name": "Health",       "tags": ["entity"],
      "schema": { "type": "object",
        "properties": {
          "hp":    { "type": "number" },
          "maxHp": { "type": "number" } } } },
    { "name": "SpawnerList",  "tags": ["scene", "spawning"] },
    { "name": "Music",        "tags": ["scene", "audio"]    },
    { "name": "Victory",      "tags": ["scene", "rules"]    },
    { "name": "SaveSlot",     "tags": ["world", "persist"]  },
    { "name": "Systems"                                     },
    { "name": "Scripts"                                     }
  ]
}
```

Each entry:

```ts
interface ComponentDef {
  /** Unique name. Used by scenes / scripts / serialize round-trips. */
  name: string;
  /** Optional JSON-Schema for validation. Engine validates at attach. */
  schema?: object;
  /**
   * Editor-only hints. Engine ignores. Common values:
   *  - "entity"       — typical per-entity component
   *  - "scene"        — meaningful on the scene controller
   *  - "world"        — meaningful on a world singleton
   *  - "audio"        — categorisation for editor pickers
   *  - "rules"        — gameplay-rule categorisation
   *  - "spawning"     — for SpawnerList et al
   *  - "persist"      — survives scene swaps
   *  - "ai"           — AI-related component
   *  - "ui"           — HUD/UI-related
   *  - "render"       — render-only data (Sprite, Light, Shader)
   *  - "input"        — input-handling
   *  - "physics"      — collision/physics
   * Tags are free-form strings; the editor presents components
   * filtered by tag context (only "scene"-tagged in the
   * controller-components picker, "world"-tagged in a singleton
   * picker, etc.). Untagged components are PERMISSIVELY shown in
   * every picker — useful for "applies anywhere" components.
   */
  tags?: string[];
}
```

**Boot-time registration:**

  1. Engine reads `manifest.components[]` on pack chain load
     (deps-first, root-last — last write wins on name conflicts,
     with a console warning).
  2. For each entry: registers the name with the `ComponentRegistry`
     as a fresh `Component<unknown>` (or skips if a prior pack
     registered it).
  3. If `schema` is present and `CONFIG.dev.strictComponentSchemas`
     is true: validates the data on every `add(entity, component,
     data)` call. Production builds default to lenient (skip
     validation).
  4. Engine's built-in components (Position, Facing, Sprite, etc.)
     continue to register *automatically* as today — they're
     engine-render-relevant and exist no matter what the pack
     declares. The pack-declared `components[]` list is purely
     additive over them.

**Manifest-declared vs script-declared:** pack scripts can still
call `api.defineComponent("CustomThing")` for components that
emerge from script logic. Manifest declarations are the
preferred surface because they:

  - get picked up by the editor's component picker,
  - validate at attach time (strict mode),
  - round-trip through `serialize` with their schema preserved,
  - flag schema-conflict warnings when two packs in the chain
    declare the same name with incompatible shapes.

---

## 5. Three state scopes (same component mechanism)

The same component mechanism backs all three scopes; only the
host entity's lifetime differs.

### 5.1 Entity components (per-entity)

Standard ECS path. Spawn an entity, attach components. The
entity dies when its scene unloads (unless tagged persistent —
see §6.3).

Examples: `Position`, `Health`, `Inventory`, `Sprite`, `Movement`.

### 5.2 Scene controller components (per-scene)

Every scene has exactly one synthetic **scene-controller entity**,
spawned by the engine at scene-load from `scene.controller.components`
(see §6). It dies on scene unload.

Pack-defined examples: `SpawnerList`, `Music`, `Victory`, `EnemyBudget`,
`AmbientLighting`, `SceneTimer`. Whatever the pack needs as
"per-scene singleton state".

Scripts access it via `api.scene.controller`:

```js
const sp = api.world.getComponent(
  api.scene.controller.id,
  "SpawnerList",
);
```

### 5.3 World singleton (persistent global)

`api.singleton<T>(componentName)` — get-or-create. The engine looks
up the world-singleton entity (one per name, stable id across
scene swaps), spawns it on first access, and attaches the named
component if absent. Returns the component data.

```js
const save = api.singleton("SaveSlot"); // { autosaveAt: 0, …}
save.autosaveAt = performance.now();
```

The singleton entity survives every scene swap. Used for: save
data, score, persistent inventory in some packs, telemetry, network
session state, achievement progress.

---

## 6. Scene lifecycle

### 6.1 Boot

  1. Pack chain resolved.
  2. `manifest.components[]` from every pack registered (in chain
     order, conflicts logged).
  3. Pack scripts run (`runPackScripts()`). Each `setup(api)`
     subscribes to events, registers script-level systems,
     potentially mutates world singletons.
  4. **`world:ready` fires** — once per Game lifetime. Pack
     scripts use this for "post-script-load, pre-scene-load"
     work (read manifest, build caches, etc.).
  5. First scene load fires (see §6.2 below).

### 6.2 Scene load

  1. **`scene:willUnload(prevId)` fires** — if a previous scene
     was active. Pack scripts can save controller state, snapshot
     entities for a transition, etc.
  2. **Destroy controller + scene-specific entities.** The engine
     walks the world and despawns every entity EXCEPT:
       - the world-singleton entity (persistent),
       - entities tagged `_persistent: true` on their record (PE-style
         editor metadata; the engine reads this one).
     For each despawn: `entity:despawned` fires.
  3. **Parse new scene** — `scene.fromJSON(...)`. Geometry built;
     `entities[]` not yet spawned.
  4. **Spawn new controller** from `scene.controller.components`
     (synthetic entity, every entry attached). The synthetic
     entity is reachable via `api.scene.controller.id`.
  5. **Spawn new entities** from `scene.entities[]` (the same loop
     PE1 introduced). Each `entity:spawned` fires.
  6. **Register Systems** found on the freshly-spawned controller
     + entities — engine walks the world for any entity carrying
     a `Systems` component and registers its list with the
     scheduler. Same for `Scripts` (see §8).
  7. **`scene:loaded(newId)` fires.** Pack scripts that subscribed
     to `scene:loaded` see a fully-spawned scene.
  8. `pack:loaded` fires once at the very first scene load (as
     today).

### 6.3 Persistent entities across scene swaps

Two ways an entity survives scene unload:

  1. **It's the world-singleton entity** (created via
     `api.singleton(name)`). The engine tracks its id and
     skips despawn.
  2. **Its scene record carried `_persistent: true`** — an editor-
     style metadata flag that, unlike most `_*` fields, the
     engine reads. The entity stays alive across scene swap and
     its components keep their state. Used for "the player follows
     me into the next scene" patterns.

Default behaviour: entities live for one scene. The pack-author
opts into persistence explicitly.

---

## 7. Systems component pattern

Per-frame logic ships as **components**, not as runtime API calls.

### 7.1 Shape

```jsonc
// In a scene controller or any entity record
{
  "Systems": {
    "list": [
      { "script": "scripts/systems/player-move.js",
        "phase":  "update" },
      { "script": "scripts/systems/physics-step.js",
        "phase":  "fixedUpdate",
        "dependencies": ["player-move"] },
      { "script": "scripts/systems/render-hud.js",
        "phase":  "render",
        "enabled": true }
    ]
  }
}
```

  - `script` — pack-relative path. The pack-builder validates
    these exist at build time.
  - `phase` — one of `update | fixedUpdate | render` (MVP).
    Future-extensible via additive enum.
  - `dependencies` — optional list of script names that must run
    before this one in the same phase. MVP supports the field but
    only honours registration order (see §11.D).
  - `enabled` — defaults to true. False = engine skips registration
    (useful for editor-toggled systems).

### 7.2 Engine handling

On entity attach with a `Systems` component:

  1. For each `entry` in `list`:
     a. Resolve the script via the same loader used for
        `manifest.scripts[]` (Blob URL → dynamic import → default
        export).
     b. Default export must be `(world, dt, api) => void`.
     c. Register that function with the system scheduler under
        `entry.phase`, indexed by `(entityId, entryIndex)`.
  2. On entity detach (or despawn): unregister every entry.

### 7.3 System script body shape

```js
// scripts/systems/player-move.js
export default function (world, dt, api) {
  world.each(api.components.PlayerInput, api.components.Position,
    (e, input, pos) => {
      // ... per-frame movement logic
    });
}
```

The function is called once per frame at its scheduled phase. Bare
`(world, dt, api)` signature — no setup-time closures, no class
instances. State that needs to persist between ticks lives on
components in the world.

Setup work (event subscriptions, prefab definitions, one-time
caches) goes in a `Scripts`-component entry (see §8), not in a
system body.

---

## 8. Scripts component pattern

For attach-time setup (event binding, asset prewarm, side-effects
that don't need to repeat per frame):

```jsonc
{
  "Scripts": {
    "refs": [
      "scripts/setup/bind-pickup-events.js",
      "scripts/setup/audio-prewarm.js"
    ]
  }
}
```

Each `refs[]` entry resolves the same way as a Systems script.
The default export runs once at entity-attach time with:

```js
export default function (entity, world, api) {
  api.events.on("pickup:collected", (p) => {
    // ...
  });
  return () => {
    // optional cleanup — called on entity detach.
  };
}
```

  - Engine calls the default export with `(entityId, world, api)`.
  - If it returns a function, the engine calls that on entity
    detach (controller dies on scene unload → cleanup fires).
  - Otherwise detach is a no-op.

Use cases:

  - One-shot event subscriptions tied to scene lifetime.
  - Asset prewarming on scene controller (preload audio, prebake
    LUTs, etc.).
  - "Spawn N enemies at scene start" — a setup script reading
    `SpawnerList.points[]` and calling `world.spawn() + add(…)`.
    (The PE3 player-spawn becomes this in §11.)

---

## 9. Generic entity API for scripts

```ts
// World additions
interface World {
  query(...componentNames: string[]): Iterable<EntityId>;
  // existing: spawn / despawn / add / remove / has / first / each / entityCount
  getComponent(id: EntityId, name: string): unknown | undefined;
  // existing internals stay; nothing reshuffled.
}

// ModAPI additions
interface ModAPI {
  singleton<T>(componentName: string): T;
  serialize(entityId: EntityId): SerializedEntity;
  deserialize(json: SerializedEntity, opts?: { targetId?: EntityId }): EntityId;
}

interface SerializedEntity {
  /** Optional name — round-trips with the entity. */
  name?: string;
  /** componentName → componentData (JSON-serialisable). */
  components: Record<string, unknown>;
  /** Editor-only metadata (_prefabSource, etc.). Round-trips opaquely. */
  [editorOnly: `_${string}`]: unknown;
}
```

  - `world.query("Position", "Health")` — generator yielding
    every entity carrying all named components. Works with both
    built-in and pack-declared names. Internally walks the
    rarest-component's entity list, filters by the rest.
  - `world.getComponent(id, name)` — by-name lookup; useful for
    serialise / debug / generic introspection.
  - `api.singleton<T>(name)` — see §5.3.
  - `api.serialize(id)` — produces a `SerializedEntity` whose
    component map matches the input format of `scene.entities[]`.
    Used by save/load, multiplayer replication, undo systems.
  - `api.deserialize(json, opts?)` — opposite. By default spawns
    a fresh entity; with `opts.targetId` writes onto an existing
    entity (used for "apply server delta to client").

Serialisation strategy:

  - Walks every registered component and asks "does this entity
    have you?".
  - For each component present: takes the raw value, JSON-stringifies
    it (with a `Vec2` → `{x, y, z?}` reviver), stores under the
    component name.
  - `_*` keys round-trip opaquely (PE editor-metadata pattern).
  - Function-valued / non-serialisable components — engine warns
    once per component name; data omitted. (E.g. `PlayerInput`
    carries a bindings object that's all JSON-clean today; pack
    authors keeping non-clean data on a component get a warning
    they can act on.)

---

## 10. Pack chain implications

Builds on PACK_CHAIN.md (override-as-replace semantics for
scenes / files; deps-first chain order).

### 10.1 Scenes

Unchanged — last pack in chain wins on path-key match (e.g.
`scenes/level-1.json`). The new `scene.controller` block is
just a field inside the same JSON file; whichever pack ships
the scene file owns the controller for that scene.

### 10.2 world.json (optional, NEW)

A pack MAY ship a `world.json` at the pack root. As of the
"world.json full-scope" pass (2026-05-17) it carries four scopes:

```jsonc
{
  // §10.2 ORIGINAL — per-name persistent component holders.
  "singletons": {
    "SaveSlot": { "autosaveAt": 0, "slot": 0 },
    "Score":    { "points": 0 }
  },
  // NEW — persistent world-scope entities (named, full component
  // sets). Spawned ONCE at boot. Survive every scene swap (the
  // `Game.loadScene` despawn pass skips ids tracked in the engine's
  // `persistentEntities` set). Engine emits `entity:spawned` for each
  // one BEFORE `world:ready` fires.
  "entities": [
    {
      "name": "player",
      "components": {
        "Position": { "x": 0, "y": 0 },
        "Facing":   0,
        "Aim":      { "screenY": 0 },
        // Per-entity Scripts component (§8 signature) — engine
        // resolves refs[] via the pack script loader, calls each
        // default export with (entityId, world, api) at
        // entity-attach time, AFTER all sibling components attach.
        "Scripts":  { "refs": ["scripts/setup/player-init.js"] }
      }
    }
  ],
  // NEW — world-scope scripts. Default export `(api) => …`. Same
  // signature as the deprecated `manifest.scripts[]` entry-points.
  // Run once at boot, AFTER world entities spawn and BEFORE the
  // first scene loads. Used for: event subscriptions
  // (`scene:loaded` handlers, etc.), `api.registerSystem`,
  // `api.registerRendererSystem`, `api.ui.registerModal`.
  "scripts": [
    "scripts/systems/scene-transition.js",
    "scripts/systems/player-input.js"
  ],
  // RESERVED — world-scope declarative per-frame systems with
  // explicit phase. Engine reads + warns on unknown entries; full
  // handling lands in a follow-up dispatch. Pack authors needing a
  // declarative scheduler today should use a `Systems` component on
  // the scene controller or a world entity (§7).
  "systems": []
}
```

At boot, the engine walks every pack in chain order and spawns
the singleton entities with the listed components attached (the
later pack's value wins on conflict; merge is per-component, not
per-field). Singletons missing from `world.json` are still
get-or-created lazily by `api.singleton(name)` calls.

**World entities boot order:**

  1. `runPackScripts()` registers `manifest.components[]`.
  2. Reads `world.json` (cached on `Game`).
  3. Spawns every `world.json.entities[]` record as a persistent
     entity. Each record's components attach in declaration order;
     the engine flags every spawned id with the `_worldPersistent`
     marker (engine-internal `Set<Entity>`). Records carrying a
     `Scripts` component fire their default exports with
     `(entityId, world, api)` AFTER all siblings have attached
     (entity-attach handler — §8 + §11.5.3).
  4. Runs `world.json.scripts[]` via the same Blob URL + dynamic
     import pipeline the deprecated `manifest.scripts[]` used.
  5. `spawnInitialEntities()` seeds singletons, fires `world:ready`,
     spawns the scene controller + scene entities, runs queued
     `onWorldReady` callbacks, then emits `scene:loaded` + `pack:loaded`.

**Pack-chain merging of `world.json.entities[]`:** the engine
walks each pack's `entities[]` in chain order, spawning every
record. Two packs declaring an entity with the same `name` results
in two separate entities (last-writer-wins on the name index — the
later pack's entity becomes the one `findByName(name)` returns).
This is a deliberate keep-it-simple choice; "merge entities by name"
is a follow-up if a chained pack ever needs it.

### 10.3 Component declarations

Two packs declaring the same component name:

  - **Compatible schemas** (one undefined, both undefined, or
    same structural shape): silent merge, last-wins on tags.
  - **Incompatible schemas** (different `properties`, different
    `required`): console warning; later pack's schema wins.
    Strict-mode build-step lint can promote to an error.

### 10.4 Systems / Scripts component values

Treated as data inside the carrying entity record. Override
follows the scene-record override path: whichever pack ships the
scene file (override-as-replace) ships the controller's `Systems`
component verbatim.

Override-by-component (a downstream pack adding a system to an
upstream pack's controller) is **explicitly not supported in this
overhaul** — it requires per-component cascading inside a scene
record, which is more machinery than the migration needs. Editor
tooling can offer "import this scene + add my system" as a
generate-time helper.

---

## 11. Migration approach for default-pack

### 11.1 Components declared in `manifest.components[]`

Add the following entries (all the per-entity, per-scene, per-
world component names the pack uses):

```jsonc
"components": [
  // per-entity (existing built-ins — engine auto-registers; these
  // entries exist so the editor's component picker can list them
  // and so future versions can drop the built-in fast path).
  { "name": "Position",        "tags": ["entity"] },
  { "name": "Facing",          "tags": ["entity"] },
  { "name": "Movement",        "tags": ["entity"] },
  { "name": "PlayerInput",     "tags": ["entity", "input"] },
  { "name": "Aim",             "tags": ["entity", "input"] },
  { "name": "Camera",          "tags": ["entity", "render"] },
  { "name": "MinimapMarker",   "tags": ["entity", "ui"] },
  { "name": "Weapon",          "tags": ["entity"] },
  { "name": "Inventory",       "tags": ["entity"] },
  { "name": "Sprite",          "tags": ["entity", "render"] },
  { "name": "Animation",       "tags": ["entity", "render"] },
  { "name": "Pickup",          "tags": ["entity"] },
  { "name": "Light",           "tags": ["entity", "render"] },
  { "name": "Shader",          "tags": ["entity", "render"] },

  // scene-level (NEW)
  { "name": "SpawnerList",     "tags": ["scene", "spawning"] },

  // universal (NEW)
  { "name": "Systems" },
  { "name": "Scripts" }
]
```

### 11.2 Migrate scenes

Each `scenes/scene*.json` gains a `controller` block carrying a
`SpawnerList` with one spawn point synthesised from the old top-
level `spawn` field:

```jsonc
{
  "controller": {
    "components": {
      "SpawnerList": {
        "points": [
          { "id":     "main",
            "x":      32.5,
            "y":      58.0,
            "facing": 0.0 }
        ]
      }
    }
  },
  // ... existing walls/floors/ceilings/lights/lightmap/idMap
  "entities": []  // unchanged — empty in default-pack
}
```

The legacy top-level `spawn` field is **dropped from the file**.
A scene-loader back-compat path keeps reading the old field for
one release: if a scene file ships `spawn` but no
`controller.components.SpawnerList`, the engine synthesises a
`SpawnerList` with one `"main"` point at scene-parse time. New
authoring goes through `controller.components` only.

### 11.3 Migrate `player-spawn.js`

Becomes a **system body** registered via a `Systems` entry on the
scene controller (one per scene), OR a script-component entry on
the world singleton (one shared boot point for any scene).

We use the second pattern: register `player-spawn` as a Scripts
entry on the world singleton. It runs once at world-ready, reads
the active scene's controller's SpawnerList:

```js
// scripts/systems/player-spawn.js (post-WORLD_STATE)
export default function (entity, world, api) {
  const setup = () => {
    const list = api.scene.controller.components.SpawnerList;
    const point = list?.points?.[0];
    if (!point) {
      console.warn("[player-spawn] no SpawnerList on scene controller");
      return;
    }
    spawnPlayer(api, point);
  };

  // Run once for the current scene
  setup();
  // Re-run on every scene swap
  api.events.on("scene:loaded", () => setup());

  return () => {/* no per-detach cleanup needed */};
}

function spawnPlayer(api, point) {
  const { x, y, facing } = point;
  const world = api.world;
  const C = api.components;
  const cfg = api.config;
  const manifest = api.pack.manifest;

  const inventory = { /* … existing seeding logic … */ };

  const player = world.spawn();
  world
    .add(player, C.Position, new api.Vec2(x, y))
    .add(player, C.Facing, facing)
    .add(player, C.Aim, { screenY: 0 })
    .add(player, C.Movement, { /* … */ })
    .add(player, C.PlayerInput, { bindings: cfg.bindings })
    .add(player, C.Weapon, { /* … */ })
    .add(player, C.Inventory, inventory)
    .add(player, C.Camera, { /* … */ })
    .add(player, C.MinimapMarker, { /* … */ });
  api.events.emit("entity:spawned", { entity: player, name: "player" });
}
```

In default-pack we ship the simpler equivalent: keep the existing
`scripts/systems/player-spawn.js` boot script that uses
`api.onWorldReady` + an `api.events.on("scene:loaded", …)` for
re-spawn on scene swap. The Systems / Scripts component pattern is
fully exercised by the engine even though the default-pack doesn't
use it for player-spawn — the scene controller still spawns,
SpawnerList still attaches, `api.scene.controller.components.SpawnerList`
still reads.

This deliberate split lets the engine's Systems / Scripts component
machinery exist + work in tests + be usable by mod authors, while
the default-pack's player-spawn keeps its existing
boot-script-via-`onWorldReady` shape (which is simpler for one
script and avoids back-compat thrash with PE3).

### 11.4 Convert engine-internal systems to script bodies

**Identification.** The engine currently hosts:

  - `AnimationSystem` — per-frame Sprite + Animation tick.
  - `LightCollectionSystem` — per-frame Light → renderer upload.
  - `SpriteRenderSystem` — per-frame sprite render.

Of these:

  - `AnimationSystem` operates on game-typed components (`Sprite`,
    `Animation`). Candidate to move to default-pack.
  - `LightCollectionSystem` + `SpriteRenderSystem` are **renderer
    bridges** — they touch the SceneRenderer directly to upload
    GPU state. These stay engine-internal (per the spec's
    "physics, raycasting, rendering, audio mixing, asset loading
    stay engine-internal" exception).

**Outcome for this dispatch:** because the default-pack's player
spawn + animation hookup are tightly coupled and would require
a significant editor-pack-API churn to extract, **AnimationSystem
is NOT moved to a pack-script body in this dispatch.** It's listed
in §11.5 as a known limitation / follow-up. The engine's Systems
/ Scripts component machinery is fully built and tested via the
SpawnerList controller path; mod authors immediately get a clean
"declare a system on a scene controller" surface even though the
default-pack ships its existing systems via `manifest.scripts[]`.

### 11.5 Known limitations / follow-up

  1. **AnimationSystem stays engine-side.** It operates on game-
     typed components but is fully owned by the engine for now.
     A follow-up dispatch moves the per-frame tick loop into a
     `scripts/systems/animation-tick.js` registered via the scene
     controller's Systems entry.
  2. **No `fixedUpdate` scheduling.** Phase enum supports the
     value but the engine ticks every registered system at update
     frequency. A fixed-step accumulator (with interpolation
     hooks) is follow-up work.
  3. **Scripts component runs at entity-attach, not entity-spawn.**
     If a scene entity ships Scripts + other components in the
     same record, the engine attaches components in declaration
     order — Scripts last. Authors who want "run setup before any
     other component value is read" can rely on the engine's
     fixed attach order (Scripts component handlers run AFTER all
     siblings attach).
  4. **No dependency-aware system ordering.** Entries with a
     `dependencies` field are accepted but the scheduler runs
     systems in registration order within a phase. Topological
     sort is follow-up.
  5. **`world.json` not yet honored in default-pack.** The engine
     understands the file shape; the default-pack ships none.
     Mod authors can opt-in.

### 11.6a `world.json` full-scope (2026-05-17 second pass)

After the initial migration in §11.1-§11.5, a second pass made
`world.json` the authoritative world-scope authoring surface and
ripped every `Scene.spawn` back-compat surface:

  - `manifest.scripts[]` is gone. Pack script entry points live in
    `world.json.scripts[]` (default export `(api) => void`) and any
    `Scripts.refs[]` declared on world entities or scene controllers
    (default export `(entityId, world, api) => void`).
  - The default-pack player is a persistent world entity declared in
    `world.json.entities[]`. The engine spawns it ONCE at boot, flags
    it `_worldPersistent`, and skips it in every subsequent
    scene-unload despawn pass.
  - `scripts/setup/player-init.js` (entity-attach script declared in
    the player's `Scripts` component) attaches the runtime-dependent
    components — `Movement` / `PlayerInput` / `Weapon` / `Camera` /
    `MinimapMarker` / `Inventory` — that need `api.config` /
    `api.pack.manifest` at attach time.
  - `scripts/systems/scene-transition.js` (world-scope script)
    subscribes to `scene:loaded` and repositions the player at the
    new scene's `controller.components.SpawnerList.points[0]`.
  - `Scene.spawn`, `SceneSpawn`, `DEFAULT_SPAWN`,
    `synthesiseControllerFromSpawn`, `api.scene.spawn`, and the
    legacy top-level `spawn` field in `SceneJSON` were deleted. No
    back-compat — the repo is mid-development, no consumers needed
    the bridge.
  - `World` gained `setName(id, name)` / `findByName(name)` /
    `liveEntities()`. The engine writes to the name index on every
    spawn that carries a `name` field (world entities + scene
    entities), so `api.world.findByName("player")` is the canonical
    way to locate the persistent player from a pack script.
  - Pack-builder now walks `world.json.scripts[]` + `Scripts.refs[]`
    from world entities + scene controllers to discover compilable
    script paths. Manifests stripped of any stale `scripts` field
    on emit.

The 4 default-pack scenes were stripped of their top-level `spawn`
fields. Each retains its `controller.components.SpawnerList` block
which is the only source of truth for the spawn point.

### 11.6 Engine is now maximally unopinionated (2026-05-17)

Following the PE2/PE3 re-implementation (prefabs-editor-only plan
§17, shipped 2026-05-17; doc since deleted, see git log), the
engine's built-in component set
is the slim render/lifecycle infrastructure only: `Position`,
`Facing`, `Aim`, `Camera`, `Sprite`, `Animation`, `Light`,
`Shader`. These are the components engine code reads directly
(camera math, sprite billboards, light upload, shader-hook
attachment, animation advance).

Every other component the default-pack player uses —
`PlayerInput`, `Movement`, `Weapon`, `Inventory`, `MinimapMarker`,
`Pickup` — is now declared in `manifest.components[]` and
instantiated as `Component<unknown>` at boot. Pack code accesses
them through the `api.components` proxy under their string name
(`api.components.PlayerInput`) which resolves through the full
`ComponentRegistry` (built-ins + manifest entries +
`defineComponent` calls).

This is the practical realisation of §2 principle 4 ("Engine
provides primitives, packs ship gameplay"): the engine no longer
ships any *gameplay* components, only the rendering/lifecycle
infrastructure components that engine code itself must touch.
The `Systems`-component scheduler stays engine-side (§7) along
with `AnimationSystem` (§11.4) for now; both are pack-facing
surfaces the engine drives, not gameplay logic the engine owns.

---

## 12. Open questions

### O1 — Tag namespacing (free vs prefixed)

Question: should tags be free-form strings or namespace-prefixed
(`engine:render`, `editor:hidden`, `pack:my-pack:loot`)?

**Recommend: free-form for MVP.** Tags are editor-only hints; the
engine never reads them. The editor's component picker filters
by tag-string match. Pack-chain conflicts on tag meaning are
unlikely (and harmless when they happen).

If a tag taxonomy emerges and packs start clashing on meaning,
prefix-namespacing is an additive migration: editor reserves
`engine:*`, packs use their pack-id as prefix.

### O2 — Phase enum extensibility

Question: should the phase enum be:

  - hard-coded (`update | fixedUpdate | render`) — current MVP.
  - hard-coded with versioned additions (`update | fixedUpdate |
    render | init | unload | preRender`).
  - **freely extensible** — any string is a valid phase; engine
    treats unknown phases as "registered but never ticked
    unless something fires the phase manually".

**Recommend: hard-coded with additive growth.** MVP ships
`update / fixedUpdate / render`. Add `init / unload` once a
concrete pack need arises. Don't open it to arbitrary strings —
the engine needs to know which phases to drive per frame, and
"register but never tick" is a recipe for silent bugs.

### O3 — World-snapshot serialize granularity

Question: should `api.serialize` walk JUST the named entity, or
the **transitive closure** (entity + every entity referenced via
"NestedEntity" / "Owner" / "Parent" components)?

**Recommend: just the named entity for MVP.** Closure walking
implies a "what is a reference" introspection that the engine
can't infer without per-component metadata. Pack authors who
need transitive serialise can walk references themselves and
call serialize once per touched entity.

`api.serializeWorld(): SerializedWorld` (every entity + every
singleton) is a separate API — useful for save/load — deferred to
follow-up.

### O4 — Multi-instance components on same entity (Scripts list vs N Script components)

Question: should `Scripts: { refs: [...] }` be:

  - **one component with N refs** (current proposal),
  - **N components named `Script` attached separately** (which
    isn't possible today — components are singletons per entity),
  - **a special-cased component the engine multiplexes**.

**Recommend: one component with N refs.** The engine's component
storage is "one value per entity per component name". Multiple
instances on the same entity would require a different storage
model. The `refs[]`-shaped value is a clean fit for "I want N
scripts on this entity" without changing the ECS primitive. Same
for `Systems.list[]`.

If a pack author needs to merge two sources of script attachments
on the same entity, the editor stamps the union into the single
component at save time.

### O5 — Component-data validation strictness

Question: when should manifest-declared schemas be validated?

**Recommend:**

  - In dev (CONFIG.dev.strictComponentSchemas = true) — validate
    on every `world.add(e, C, v)`. Errors thrown.
  - In prod — validate ONLY at scene-load (per-record) and at
    boot (controller + singletons), then trust. Per-frame
    `world.add` calls in systems skip validation for perf.

The flag flips on/off via the existing CONFIG mechanism. Default
prod build = lenient.

### O6 — Built-in components in `manifest.components[]`

Question: should the engine's built-in components (Position,
Facing, Sprite, …) be listed in `manifest.components[]`?

**Recommend: optional but encouraged.** Engine auto-registers them
on its own; manifest entries are informational (for the editor's
component picker). When a pack manifest entry conflicts with a
built-in (e.g. someone redefines `Position` with a different
schema), engine warns and keeps the built-in.

Long-term: a follow-up pass moves engine built-ins INTO
`manifest.components[]` (the engine ships a baseline manifest
prepended to every pack chain) so there's literally one source
of truth.

### O7 — Scene controller serialisation

Question: should the synthetic controller entity be
`api.serialize`-able? Its components live in scene JSON;
serialising the in-world controller is a useful diff tool ("did
a script mutate controller state?").

**Recommend: yes.** The controller is just an entity. Serialise
works on it without special-casing. The result matches
`scene.controller.components` byte-for-byte when nothing has
mutated it.

### O8 — Persistent entities crossing scenes

Question: how do we mark "this entity follows me into the next
scene"?

**Recommend:** PE-style `_persistent: true` metadata on the
entity record. Engine reads this one `_*` field (unlike all
other `_*` fields). Entities authored without it die on scene
swap. World singletons survive automatically (different code
path entirely).

---

## 13. Acceptance criteria (this dispatch)

1. `bun run typecheck` clean across all packages.
2. `bun run build-packs` produces a working `default.apg`.
3. `bun run build` (apps/game) succeeds.
4. Default-pack runnable: scenes load, controller spawns,
   SpawnerList drives spawn point selection, player is
   controllable.
5. Engine surface additions land per §3:
   - `manifest.components[]` declarative registry,
   - synthetic `api.scene.controller` entity,
   - `api.singleton<T>(name)`,
   - `api.serialize` / `api.deserialize`,
   - `world.query(...names)`,
   - `Systems` + `Scripts` component handling (incl. scheduler),
   - lifecycle events `world:ready`, `scene:willUnload`,
     `scene:loaded` (existing + reordered as needed),
     `entity:spawned`, `entity:despawned` (existing).
6. Default-pack `manifest.components[]` populated per §11.1.
7. Scene files migrated per §11.2 — `controller` block with
   SpawnerList; legacy `spawn` field dropped from new authoring
   (back-compat read kept for one release).
8. `player-spawn.js` reads from `api.scene.controller.components.SpawnerList`
   instead of `api.scene.spawn`.
9. **Editor view files (`apps/editor/src/views/**`) are NOT
   touched** in this dispatch — editor work is held.
10. No dev server / no commits in this dispatch.

---

## 14. Rollback plan

Each substantive change is self-contained:

  - `manifest.components[]` reader is additive — without it the
    engine continues to auto-register built-ins as today.
  - Scene controller spawn is additive — a scene without a
    `controller` block gets an empty synthetic entity with no
    components, byte-equivalent to having no controller at all.
  - `api.singleton` / `api.serialize` / `world.query` are pure
    additions — removing them only breaks scripts that reach
    for them.
  - `Systems` / `Scripts` component handling is additive — without
    the components in any entity, the engine code paths never
    fire.

Rollback is `git revert` for the engine + the scene migration.
Default-pack scene JSON revert restores `spawn:` top-level
fields; `player-spawn.js` revert restores `api.scene.spawn` read.

---

## 15. Phase status

| Phase | Description | Status |
|---|---|---|
| W1 | Plan doc (this file) | done (2026-05-17) |
| W2 | Engine — component manifest registry + Systems/Scripts components + singleton + serialize + world.query + lifecycle events + scene controller entity | done (2026-05-17) |
| W3 | Default-pack — manifest.components[] populated, scenes migrated to `controller.components.SpawnerList`, player-spawn.js reads controller | done (2026-05-17) |
| W3b | `world.json` full-scope — entities + scripts + scene.spawn rip + persistent player entity + scene-transition.js + pack-builder script discovery from world.json | done (2026-05-17) |
| W4 | AnimationSystem move to pack scripts/systems/animation-tick.js via Systems component | held (follow-up) |
| W5 | Editor surface changes (component picker honours `tags`, controller-components editor panel, world.json editor) | held (per dispatch constraint) |
| W6 | `world.json` honored — singletons + entities + scripts auto-spawned at boot from per-pack files | ✅ Done as part of W3b (2026-05-17). Default-pack ships `world.json` with the player entity + every former `manifest.scripts[]` entry. |
| W7 | Strict mode schema validation tied to `CONFIG.dev.strictComponentSchemas` | held |

---

## 16. Cross-references

  - **Prefabs-editor-only plan (shipped 2026-05-17; doc since
    deleted, see git log)** — PE1+PE2+PE3 are the foundation.
    WORLD_STATE is the second half of the same shift: PE removed
    prefab runtime resolution; WORLD_STATE removes runtime
    game-type assumption.
  - **`docs/plans/PACK_CHAIN.md`** — override semantics are
    unchanged. Component-name conflicts get the same
    "later-pack-wins-with-warning" treatment as other manifest
    conflicts.
  - **`docs/plans/EVENTS.md`** — canonical events. WORLD_STATE
    adds `world:ready` and renames the lifecycle to
    `scene:willUnload` (today: `scene:beforeUnload`). The old
    name stays alive as a back-compat alias for one release.
  - **`docs/plans/EDITOR_REDESIGN.md`** — component picker and
    Prefabs tab need to learn the `tags` field (W5 follow-up).
  - **`docs/plans/MULTIPLAYER_PLAN.md` (M1)** — `api.serialize` /
    `api.deserialize` are the building blocks for entity
    replication. M1 builds on this surface.

---

## 17. Decisions log

Decisions made authoring this doc (recommend defaults from §12):

  - **O1 — Tags free-form, not namespaced.**
  - **O2 — Phase enum hard-coded, additive growth.** MVP ships
    `update / fixedUpdate / render`.
  - **O3 — `api.serialize` is single-entity. `api.serializeWorld`
    deferred.**
  - **O4 — One component per entity; `Systems.list[]` for N
    entries.**
  - **O5 — Strict in dev, lenient in prod. Flag flips it.**
  - **O6 — Built-ins auto-registered; manifest entries optional
    + informational.**
  - **O7 — Scene controller is serialisable like any entity.**
  - **O8 — `_persistent: true` is the cross-scene survival marker.**
