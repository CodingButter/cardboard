# Prefabs become editor-only

Plan document for **PE1–PE5** — the architectural shift that removes
all prefab-runtime machinery from the engine and recasts prefabs as
editor-only authoring templates. Engine becomes a pure ECS-data
consumer: scenes ship flattened entity records, the engine spawns
them as-is, and prefabs only exist inside the editor's
project-storage namespace as reusable component bundles.

---

## 1. tl;dr

The engine currently hosts a small prefab runtime — a
`PrefabRegistry`, the declarative-prefab loader
(`registerDeclarativePrefabs` + the hybrid `initScript` flow from
#196), and a manifest field (`prefabs?: Record<string,
DeclarativePrefab>`) that the engine reads to register factories on
boot. Pack scripts and the engine itself call `api.spawnPrefab(name,
opts)` to instantiate "player", "marker", etc. That whole layer is
duplicated work — the editor already needs a richer model of prefabs
(versioned templates, linked-instance metadata, dependency graphs,
diff-view, "detach" semantics), and shipping a parallel runtime path
inside the engine means every editor change has to keep the runtime
in sync. **PE1 collapses the two layers into one: prefabs live only
in the editor; every entity the engine ever sees comes pre-flattened
in scene JSON; the engine drops `PrefabRegistry`,
`registerDeclarativePrefabs`, `initScript`, and the
`manifest.prefabs` read.** The editor preserves `pack/prefabs/*.json`
templates and stamps a `_prefabSource` breadcrumb onto each flattened
instance so future editor features ("edit linked prefab", "re-sync
from template", "detach") have the metadata they need.

---

## 2. Goals & non-goals

### Goals

1. **Engine is a pure ECS-data consumer.** Scene JSON describes
   every entity that exists at scene-load time, fully flattened.
   No registry lookups, no name resolution, no factory invocation.
2. **Prefabs become an editor-only concept.** They are
   authoring-time templates: the editor stores them, lets the user
   re-use them, and stamps the resulting flattened entity records
   onto scene JSON at save time. The engine never reads them.
3. **Editor keeps full fidelity.** Existing editor features
   (Prefabs tab, prefab list, "convert JS prefab to declarative")
   continue to work, but only inside the editor's project storage.
   Save-to-scene operations flatten the prefab into entity records;
   load-from-scene operations honour `_prefabSource` to reconstruct
   "this instance came from prefab X" UX state.
4. **Pack chain semantics stay clean.** When pack B overrides pack
   A's scene, B's scene file is loaded as-is and B can edit any
   entity record it wants. Pack B cannot retroactively rewrite the
   prefab from pack A — see §6.
5. **Migration is mechanical.** Default-pack `manifest.prefabs` +
   `scripts/prefabs/player-init.js` migrate to a single boot script
   that spawns the player at scene load. Anyone else's pack scripts
   that called `registerPrefab`/`spawnPrefab` migrate the same way.

### Non-goals

- A general-purpose prefab-runtime SDK for pack authors. Pack
  authors who need procedural instantiation use a regular pack
  script that does `world.spawn() + world.add(...)` in a loop.
- Live editor → engine "edit linked prefab and watch the world
  update" — that's a future editor-side feature (PE-future) built
  on `_prefabSource` metadata; the engine never participates.
- Backwards compat for old pack zips that still declare
  `manifest.prefabs` + `initScript`. The default pack is the only
  pack we ship; third-party packs (none today) get a migration
  note.

---

## 3. Status quo (as of 2026-05-17)

The runtime prefab machinery lives across four files:

### 3.1 `packages/engine/src/AssetPack/registerDeclarativePrefabs.ts`

Exports `registerDeclarativePrefabs`,
`registerDeclarativePrefabsAsync`, `_resetInitScriptCache`, and the
`PrefabInitScript` type. Walks `manifest.prefabs[]`, registers a
factory per entry against the `ModAPI`. Each factory spawns a
fresh entity, walks `prefab.components` to attach each declared
component, merges spawn-time `opts` over the authored data
(`Position.x` / `Position.y` shortcuts, etc.), then runs the
optional `initScript` for hybrid prefabs after static attachment.
Async variant pre-warms the `initScript` modules so the first
spawn doesn't pay a cold-start blob-URL import.

### 3.2 `packages/engine/src/ModAPI/PrefabRegistry.ts`

The `Map<string, PrefabFn>` that backs `api.registerPrefab(name,
factory)` + `api.spawn(name, opts)`. Both
`registerDeclarativePrefabs` and pack scripts feed it.
`PrefabRegistry.spawn` is wrapped by `ModAPIImpl.spawnPrefab` /
`ModAPIImpl.spawn`, which adds the canonical `entity:spawned`
event emit.

### 3.3 `packages/engine/src/Game.ts`

`Game.registerDeclarativePrefabsFromManifest{,Async}` — the boot
hook that runs after `runPackScripts()` and before
`spawnInitialEntities()`. `Game.spawnInitialEntities()` calls
`api.spawnPrefab("player", { x, y, facing })` using the scene's
`spawn` point. The player is hardcoded to the prefab name
`"player"`; if the active pack doesn't register one, the engine
throws.

### 3.4 `packages/default-pack/manifest.json` + `scripts/prefabs/player-init.js`

The default pack declares the canonical hybrid prefab:

```json
"prefabs": {
  "player": {
    "name": "player",
    "components": {
      "Position": { "x": 0, "y": 0 },
      "Facing": 0,
      "Aim": { "screenY": 0 }
    },
    "initScript": "scripts/prefabs/player-init.js"
  }
}
```

The `initScript` attaches `Movement`, `PlayerInput`, `Weapon`,
`Inventory`, `Camera`, and `MinimapMarker` — every component
whose authored shape reads `api.config`, `api.pack.manifest`, or
the spawn-time `opts` outside the engine's `applyOpts` shortcut.

`packages/default-pack/scripts/hello.js` also calls
`api.registerPrefab("marker", ...)` to demonstrate the registry
surface for mod authors; nothing in the engine or in the rest of
the default pack invokes the "marker" prefab.

### 3.5 Scene files (`packages/default-pack/scenes/*.json`)

Today's scenes carry **no** `entities[]` array. They are pure tile
grids (walls/floors/ceilings) plus `spawn`, `lights`, `lightmap`,
`idMap`, and `shaders` fields. The player entity is materialised
at scene-load time by `Game.spawnInitialEntities()` calling the
pack's "player" prefab — it never lives in scene JSON.

### 3.6 Pack-builder (`apps/pack-builder/src/build-packs.ts`)

Discovers `prefabs[].initScript` paths during the
script-compilation pass, runs them through `buildPackScript`
(same pipeline as `manifest.scripts[]`), and rewrites the manifest
to point at the compiled `.js` path before zipping.

---

## 4. Target architecture

### 4.1 Scene JSON shape (post-PE1)

```jsonc
{
  "spawn": { "x": 1.5, "y": 5.0, "facing": 0 },
  "idMap": { /* unchanged */ },
  "walls":  [/* unchanged */],
  "floors": [/* unchanged */],
  "ceiling":[/* unchanged */],
  "lights": [/* unchanged */],
  "lightmap": { /* unchanged */ },
  "entities": [
    {
      "name": "guard-east-hall",
      "components": {
        "Position": { "x": 12.5, "y": 8.5 },
        "Facing":   3.14159,
        "Sprite":   { "imageId": "guard", "worldHeight": 0.9, "yOffset": 0 },
        "Health":   { "hp": 100, "maxHp": 100 },
        "AI":       { "kind": "patrol", "waypoints": [[12, 8], [16, 8]] }
      },
      "_prefabSource": "guard.patrolling",
      "_prefabSourceHash": "sha256-bf7e…"
    }
  ]
}
```

Key rules:

- Every entity record has a `components: Record<string, unknown>`
  field. The engine walks each entry, looks up the component
  class via `api.getComponent(name)`, and adds it to the freshly-
  spawned entity. Unknown components log a warning + skip.
- `name?: string` is optional; the engine doesn't read it today
  but may surface it in dev-console enumeration later. The editor
  uses it for the Scene Hierarchy view (#288).
- Any field whose key **starts with `_`** is editor-only metadata.
  The engine ignores it entirely. This is the namespace for
  `_prefabSource`, `_prefabSourceHash`, future
  `_editorSelectionExpanded`, etc.
- The `prefab?` field (no underscore) is **explicitly
  unsupported** at runtime. If a scene record has it (legacy or
  hand-edited), the engine logs a warning and ignores the field;
  the scene's component set is treated as the source of truth.
  See §9.O1 — open question on whether to upgrade this to an
  error.

### 4.2 Engine load path

`Game` (or whichever class owns scene-load) does, in order, after
pack scripts have run:

1. For each `entity` in `scene.entities ?? []`:
   1. `const e = world.spawn();`
   2. For each `(compName, data)` in `entity.components`:
      - `const C = api.getComponent(compName); if (!C) warn + continue;`
      - `world.add(e, C, materialise(compName, data));`
   3. Skip every key starting with `_` (and any unknown
      top-level key, for forward-compat).
2. Emit `entity:spawned` once per scene-entity with
   `{ entity, name?: string }`.

The `materialise` step is the **same** call the existing
`registerDeclarativePrefabs.materialize()` makes today (e.g.
`Position` → `Vec2(x, y)` instance). That helper moves out of
`registerDeclarativePrefabs.ts` into a shared scene-loader file
(call it `Scene/spawnEntities.ts` or fold it into `Game`).

The `applyOpts` shortcut (`opts.x`/`opts.y`/`opts.facing` → roll
into `Position`/`Facing`) is **no longer needed** — the editor
flattens the prefab + override pair into a single `components`
record at save time, so there are no spawn-time opts to merge.

### 4.3 ModAPI surface changes

The following surface is **removed**:

- `api.registerPrefab(name, factory)`
- `api.spawn(name, ...args)`
- `api.spawnPrefab(name, ...args)` (engine-internal)
- The `PrefabRegistry` class
- The `PrefabFn` exported type

Pack-author migration: code that did

```js
api.registerPrefab("orc", (x, y) => {
  const e = api.world.spawn();
  api.world.add(e, api.components.Position, new api.Vec2(x, y));
  // …
  return e;
});
// elsewhere:
const orc = api.spawn("orc", 3, 5);
```

becomes

```js
function spawnOrc(api, x, y) {
  const e = api.world.spawn();
  api.world.add(e, api.components.Position, new api.Vec2(x, y));
  // …
  return e;
}
// elsewhere:
const orc = spawnOrc(api, 3, 5);
```

Pack scripts are JS — function values live in pack-script scope
and don't need a runtime registry. Cross-script sharing happens
via the regular ES-module surface (a future PE follow-up may
expose `api.exports` for cross-script imports inside a pack; not
needed for the default pack).

### 4.4 Manifest surface changes

`PackManifest.prefabs` stays on the type but is documented as
**editor-only metadata**. The engine doesn't read it. The pack-
builder doesn't bundle prefabs into the runtime path. Pack zips
still ship the JSONC/JSON template files for editor consumers
under `prefabs/<name>.json` (see §7); the manifest entries are
optional pointers / display metadata.

`DeclarativePrefab.initScript` is removed from the manifest type
(or kept with a deprecation comment — see §9.O2). The pack-builder
no longer compiles `initScript` paths. Scripts that used to be
init-scripts move into regular `manifest.scripts[]` entries, with
their setup happening via `api.onWorldReady` instead.

---

## 5. Editor-side metadata semantics

Two `_`-prefixed fields define the editor's "this instance came
from a prefab" breadcrumb:

### 5.1 `_prefabSource: string`

The prefab id (matching a key in the editor's project-storage
prefab namespace, or a `pack/prefabs/<id>.json` template path —
see §7) that this entity was stamped from. Stable across edits to
the entity's component data; only changes if the user explicitly
re-roots ("change source prefab") or detaches ("convert to
unique").

The editor uses this to:

- Render the "linked to prefab X" badge in the Scene Hierarchy /
  inspector.
- Enable the "edit prefab" action — opens the prefab template
  in a side-by-side view.
- Enable "detach" — drops `_prefabSource` + `_prefabSourceHash`,
  leaves components unchanged.
- Enable "re-sync from prefab" (PE-future) — diffs the entity's
  `components` against the prefab's current shape and either
  applies the prefab's changes (overwriting local diffs) or
  surfaces a 3-way merge UI.

### 5.2 `_prefabSourceHash?: string`

Optional content hash of the prefab template at the moment this
instance was stamped. `sha256-…` (or any deterministic content
hash; the editor picks the algorithm). The hash is **not** about
trust — it's a "did the source change since I stamped from it"
signal so the editor can surface "this prefab is out of date"
badges without re-comparing every component shape.

Workflow:

- Stamp time: editor reads the prefab template, flattens it onto
  the entity record, captures the hash of the template body.
- Edit time: editor periodically re-hashes the source template
  (or watches it). Mismatch → "source changed; re-sync?" badge.
- The engine never reads either field. Both can be missing
  entirely (e.g. for entities authored from scratch in the
  Scene Hierarchy without a source prefab).

### 5.3 Other `_`-prefixed fields (forward-compat)

The editor reserves the `_*` keyspace on entity records for any
metadata that should round-trip through scene JSON but be ignored
by the engine. Examples we may add later: `_editorComment`,
`_collapsedGroups`, `_lastEditedBy`. Pack-author tooling that
modifies scene JSON should preserve unknown `_`-prefixed fields.

---

## 6. Pack chain implications

The `PACK_CHAIN.md` override semantics already make scenes a
"replace whole file" asset (§7 of that doc). With PE1's
flattening, that becomes a hard guarantee for prefab semantics:

- **Pack B can override pack A's scene.** B ships its own
  `scenes/scene1.json` with whatever entities it wants. Last pack
  in chain wins on the path-key match. Standard PACK_CHAIN.md
  behaviour.
- **Pack B cannot retroactively edit pack A's prefab template
  and have pack A's scenes re-flatten.** Pack A's scenes were
  flattened at pack A's authoring time. The hash check in §5.2
  is editor-local — it doesn't traverse pack chains.
- **Pack B can edit pack A's flattened entities by editing pack
  A's scene file (override-as-replace).** This is the standard
  workflow; B drops its own `scenes/scene1.json` with edits.
- **Cross-pack prefab re-use is editor-only.** The editor may
  let a user "import prefab X from pack A into pack B"; the
  result is that pack B's scene flattens onto pack B's own scene
  records. The engine never sees the cross-pack reference.

This is a deliberate simplification: pack chains express asset
overrides, not template inheritance. Pack-author tooling that
wants cross-pack templating builds it on top of the editor
(generate-time), not the engine (load-time).

---

## 7. Pack file-layout for prefab templates

Even though the engine ignores them, prefab JSON files stay
in-tree under `pack/prefabs/*.json` for editor use. Layout:

```
default-pack/
  prefabs/
    player.json          # editor-shared template
    guard.json
    npc-vendor.json
  manifest.json          # may carry pointer/display metadata under "prefabs"
  scenes/...
  scripts/...
```

The template files are the editor's canonical store. The editor
reads them at project-open time, populates the Entities-tab list,
and uses them as the source of `_prefabSource` references in
scene records.

`manifest.prefabs` may still list the templates as a convenience
(name → path → display metadata) but the engine doesn't read it.
The editor may eventually replace this with directory-scan
discovery (`pack/prefabs/*.json`) and drop the manifest entry
entirely.

---

## 8. Migration approach (PE1–PE3)

### Phase PE1 — plan doc (this file)

Write the design; cross-reference IDEAS.md (deprecate "Hybrid
prefabs" entry), PACK_CHAIN.md (no semantic change, but document
the prefab-chain non-coupling explicitly), EDITOR_REDESIGN.md
(the existing EntitiesEditor stays — it just operates on the
editor-only template store).

### Phase PE2 — engine surgery

1. Delete `packages/engine/src/AssetPack/registerDeclarativePrefabs.ts`.
2. Drop the export lines from
   `packages/engine/src/AssetPack/index.ts` and
   `packages/engine/src/index.ts`:
   - `registerDeclarativePrefabs`
   - `registerDeclarativePrefabsAsync`
   - `_resetInitScriptCache`
   - `PrefabInitScript`
3. Delete `packages/engine/src/ModAPI/PrefabRegistry.ts`.
4. Remove `PrefabRegistry` from
   `packages/engine/src/ModAPI/index.ts` and `ModAPIImpl.ts`.
   Drop the `prefabRegistry` field, `spawnPrefab`,
   `runPrefabAndEmit`, `registerPrefab`, and `spawn` methods.
5. Drop `PrefabFn` from `ModAPI/types.ts` and the public
   `ModAPI` interface (`registerPrefab` + `spawn` slots).
6. Remove the `entity:spawned`-from-prefab emit site (or repoint
   it to the new scene-entity spawn loop — see step 7).
7. In `Game.ts`, replace `registerDeclarativePrefabsFromManifest`
   / `registerDeclarativePrefabsFromManifestAsync` with a no-op
   (delete the methods + import lines). Replace
   `spawnInitialEntities` with a scene-entities loop that walks
   `scene.entities ?? []` per §4.2, looking the player up by
   name when the scene needs to reset its position on swap.
8. Drop `DeclarativePrefab.initScript` from
   `AssetPack/types.ts` (or keep with `@deprecated` if we want
   one release of pre-warning; see §9.O2). Drop the field's
   call sites in `build-packs.ts` (the `Phase #196 prefab.initScript
   discovery` block + the manifest-rewrite branch).
9. `bun run typecheck` clean across all packages. Chase every
   error.

### Phase PE3 — default-pack migration

1. **Scene files** — current `scenes/*.json` carry **no** entity
   records. Add an `entities: []` field where useful, but the
   default pack doesn't need any (player spawn is still
   handled per `scene.spawn` — see step 3). No flattening is
   required for the default pack today.

   If/when the default pack adds NPCs / pickups via prefabs
   (post-PE3, editor-driven), the editor stamps the flattened
   records into the scene file directly.

2. **`manifest.json`** — remove the `prefabs.player` entry's
   `initScript` field (and the prefab itself if we go all-in on
   "editor-only"). The default-pack manifest moves to:

   ```json
   "prefabs": {
     "player": {
       "name": "player",
       "description": "First-person controllable player.",
       "components": {
         "Position": { "x": 0, "y": 0 },
         "Facing": 0,
         "Aim": { "screenY": 0 }
       }
     }
   }
   ```

   The template stays for editor consumption. The engine
   ignores it.

3. **`scripts/prefabs/player-init.js`** → **`scripts/systems/player-spawn.js`**.
   Becomes a regular pack script (added to `manifest.scripts[]`)
   that does its work via `api.onWorldReady`:

   ```js
   export default (api) => {
     api.onWorldReady(() => {
       const { x, y, facing } = api.scene.spawn;
       const C = api.components;
       const world = api.world;
       const cfg = api.config;
       const manifest = api.pack.manifest;
       const e = world.spawn();
       world
         .add(e, C.Position, new api.Vec2(x, y))
         .add(e, C.Facing, facing)
         .add(e, C.Aim, { screenY: 0 })
         .add(e, C.Movement, { /* …same shape as player-init.js… */ })
         .add(e, C.PlayerInput, { bindings: cfg.bindings })
         .add(e, C.Weapon, { /* … */ })
         .add(e, C.Inventory, /* …seedInventory call… */)
         .add(e, C.Camera, { /* … */ })
         .add(e, C.MinimapMarker, { /* … */ });
       // Optional canonical event mirroring the previous
       // prefab spawn:
       api.events.emit("entity:spawned", { entity: e, name: "player" });
     });
   };
   ```

   The behaviour is byte-equivalent to today's hybrid
   declarative prefab: spawn the player at `scene.spawn`,
   attach the same six components. The difference is purely
   plumbing — no registry, no factory, no `api.spawnPrefab`.

4. **`scripts/hello.js`** — drop the `api.registerPrefab("marker",
   …)` block. The "marker" prefab is unused by the rest of the
   default pack and existed only to demonstrate the registry
   surface. If we want to keep a "spawn marker on demand" hook
   for examples, expose it as a plain function on the script's
   module exports (or via an `api.events` listener).

5. **Pack-builder** — drop the `prefab.initScript` discovery
   block + the manifest-rewrite branch from `build-packs.ts`.
   Pack-builder no longer special-cases prefabs.

6. **Validation** — `bun run build-packs` must succeed. The
   lightmap bake (`bake-lights`) reads `scene.lights[]` and the
   tile grids; entity changes don't affect the bake unless lights
   come from prefabs (they don't, in the default pack today —
   light entities are spawned at runtime via `hello.js` and
   never participated in the bake anyway).

### Phase PE4 — editor changes (held — DO NOT do in this dispatch)

EntitiesEditor reads/writes `pack/prefabs/*.json` directly (or
keeps using the existing manifest.prefabs surface as a transitional
backwards-compat read). Scene Hierarchy (#288) becomes the canonical
"stamp prefab into scene" surface. Prefab-promote (#289) becomes a
scene-record → `pack/prefabs/<id>.json` write.

### Phase PE5 — pack-builder preset-generation removed

**Status: done (2026-05-17).** Pack-builder no longer generates,
hashes, collapses, or renumbers presets. The T2 "build-merge" pass
(anonymous-duplicate detection by content hash, named-wins
collapse, idMap canonical-sort rewrite) is deleted from
`apps/pack-builder/src/build-packs.ts`. The functions
`hashHex16`, `canonicalStringify`, `normaliseResolvedForHash`,
and `buildMergeScenes` are gone along with their call site and
the `ResolvedPresetData` import that fed them.

The build script is now a pure bundler. Per-pack it:

1. Reads `manifest.json`.
2. Builds a `PresetResolver` for two read-only purposes — the T3
   preset-validation gate (schema typos / cycles / missing
   textures) and the bake-time idMap → structured-shape expansion.
3. Compiles `.ts` / `.tsx` pack scripts via `buildPackScript`.
4. Validates GLSL shaders (M5 gate).
5. Bakes per-scene lightmaps.
6. Zips assets byte-for-byte, with the bake-emitted `lightmap`
   re-attached onto the on-disk scene shape.

Preset CRUD — clone, divergence detection, auto-name, save — is
owned entirely by the editor (`apps/editor/src/lib/presetCrud.ts`,
introduced in #262). Whatever the editor writes to
`packages/<pack>/presets/*.jsonc` is exactly what ships in the
`.apg`. The `pack/prefabs/*.json` templates also pass through
byte-for-byte for editor consumption; the engine ignores them per
PE2.

Future work that still belongs in PE5-followups: a
"lint scenes for unknown components" pass for editor authors
(open question O6) and an opt-in strict flag to fail builds on
legacy `prefab:` fields in entity records (O1).

---

## 9. Open questions

### O1 — Engine handling of unknown `prefab` field on entity records

When a scene entity record carries a `prefab: "<name>"` field at
runtime (a hand-edited or legacy scene), what should the engine
do?

- **Warn + ignore** (proposed default). Logs once per record;
  treats `components` as the source of truth. Forgiving.
- **Hard error.** Refuses to load the scene. Forces migration
  by failing loud.

Recommend warn-for-now, with an opt-in strict flag for
`bun run build-packs` to fail builds with stale `prefab` fields.

### O2 — Type-level handling of `DeclarativePrefab.initScript`

When we drop the engine read, the field becomes editor-only.
Options:

- **Delete the field outright.** Cleanest. Old packs fail to
  parse if they carry it.
- **Keep with `@deprecated`** for one release. Engine ignores
  it; type emits warnings on use. Lets us run a soft-deprecation
  cycle.

Recommend delete — we have one pack to migrate (default-pack),
and editor-only tooling that wants per-prefab attached scripts
can use the regular `manifest.scripts[]` flow without a special
field.

### O3 — Should `_prefabSource` carry the source file path too?

Two shapes for `_prefabSource`:

- `string` — just the prefab id (matches an editor-namespace
  key). Cross-pack lookups require knowing the active project's
  prefab store.
- `{ id: string, path?: string }` — id + optional source path
  (`pack/prefabs/player.json` or `chain://other-pack/prefabs/foo.json`).

Recommend `string` for PE1 (simpler), upgrade to the struct
shape when cross-pack prefab import lands (PE4 follow-up).

### O4 — Bake-awareness of prefab-spawned lights

`scene.lights[]` are bake inputs; runtime light entities (e.g.
`hello.js`'s orbiting demo lights) are runtime-only and don't
participate. Prefab-spawned lights are **definitionally**
runtime-only in the post-PE1 world — they live in `entities[]`,
not `lights[]`, and the bake never sees them.

If a pack author wants a baked light from a prefab template, the
editor's prefab-promote action should write a `lights[]` entry
**and** an `entities[]` Light marker entity. That keeps the bake
input clean and lets the editor surface the light in the
Scene Hierarchy. PE4-future work.

### O5 — Scene-record `name` uniqueness

Today the engine has no enforcement of unique entity names. The
editor (Scene Hierarchy) may want unique names for stable
references ("find the entity named 'guard-1'"). Should we add
build-time / load-time uniqueness checks?

Recommend: editor enforces at save time; engine ignores. Names
are a hint, not a key.

### O6 — Pack-builder lint pass

Should `bun run build-packs` validate that every component name
referenced in `scene.entities[].components` exists in the
engine's built-in registry + the pack's `defineComponent` calls?

Recommend yes (PE5). Static lint > "warn at runtime" for content
errors. Defer to PE5.

### O7 — Migration tooling for third-party packs

When third-party packs eventually exist, we need a one-shot
"upgrade my pack from runtime-prefabs to editor-only" script.

Defer until we have third-party packs. Default pack migration is
hand-done in PE3.

---

## 10. Cross-references

- **`docs/IDEAS.md`** — the "Hybrid prefabs: declarative +
  initScript" entry (2026-05-16) is **deprecated by this plan**.
  PE1 supersedes #196. Add a status update pointing at this doc.
- **`docs/plans/PACK_CHAIN.md`** §7 (override rules per asset
  type) — no change to the table, but the row "Prefab
  registrations (runtime)" + the conflict-report row "Same prefab
  name registered via script" become **moot** post-PE2. Update
  with a footnote saying prefab registration is editor-only,
  conflict surfaces in the editor's project view rather than the
  runtime conflict report.
- **`docs/plans/EDITOR_REDESIGN.md`** §13 (EntitiesEditor) — no
  contract change; the editor's prefab list keeps working,
  scaffolding remains, but the underlying store transitions from
  manifest.prefabs → `pack/prefabs/*.json` template files in
  PE4. Add a forward-pointer.
- **Editor docs (post-PE4)** — TBD; the live editor doc(s) need
  to know that "edit prefab" operates on the editor-only store
  and that scene records are stamped, not linked-by-reference at
  runtime.
- **Sibling tasks**:
  - **#287 — Renames.** Independent. Lands after PE2 settles
    the engine surface.
  - **#288 — Scene Hierarchy.** Depends on PE2 (needs
    `scene.entities[]` as canonical data). PE4 lights up the
    "stamp prefab into scene" action.
  - **#289 — Prefab promote.** Depends on PE2 (needs the
    flattened-entity-record shape) and PE4 (needs the
    editor-only prefab store).
  - **#290 — Pack-builder lint** (PE5 territory).

---

## 11. Phase status

| Phase | Description | Status |
|---|---|---|
| PE1 | Plan doc + design (this file) | done (2026-05-17) |
| PE2 | Engine deletes `registerDeclarativePrefabs.ts`, `PrefabRegistry`, `api.registerPrefab/spawn/spawnPrefab`, `initScript`, `Game.spawnInitialEntities` prefab path; scene-entity load loop replaces them | done (2026-05-17) |
| PE3 | Default-pack `player-init.js` → `scripts/systems/player-spawn.js` (boot script via `onWorldReady`); `hello.js` drops `registerPrefab("marker", …)`; manifest cleaned | done (2026-05-17) |
| PE4 | Editor changes (EntitiesEditor reads `pack/prefabs/*.json`, Scene Hierarchy stamps prefabs into `entities[]`, "edit linked prefab" / "detach" / "re-sync" UX) | held |
| PE5 | Pack-builder preset-generation removed: T2 build-merge (hash / collapse / renumber) deleted; build script is a pure bundler. Editor (`presetCrud.ts`, #262) owns preset CRUD. Scene-entities lint + legacy `prefab:` strict gate remain follow-ups. | done (2026-05-17) |

---

## 12. Rollback plan

The whole PE2 deletion is self-contained: `registerDeclarative
Prefabs.ts`, `PrefabRegistry.ts`, and the relevant `Game.ts` /
`ModAPIImpl.ts` / `index.ts` lines are removed in one commit.
Rolling back is a single `git revert`. Default-pack changes
(PE3) are similarly reversible — `scripts/systems/player-spawn.js`
goes back to `scripts/prefabs/player-init.js` and the manifest
re-adds the `initScript` line.

The migration changes the **engine API surface**: pack authors
who call `api.registerPrefab` / `api.spawn` see typecheck
errors. There are no such authors today (the default pack is
the only one we ship, and `hello.js` is the only consumer of
`registerPrefab`). Third-party authors get a migration note.

---

## 13. Acceptance criteria (PE2+PE3 — this dispatch)

1. `bun run typecheck` clean across all engine + pack-builder +
   game targets.
2. `bun run build-packs` succeeds.
3. `bun run build` (apps/game) succeeds.
4. `packages/engine/src/AssetPack/registerDeclarativePrefabs.ts`
   does not exist.
5. `packages/engine/src/ModAPI/PrefabRegistry.ts` does not exist.
6. `api.registerPrefab`, `api.spawn`, `api.spawnPrefab` are gone
   from `ModAPI`, `ModAPIImpl`, and every export site.
7. `manifest.prefabs.player.initScript` is gone from the default
   pack manifest.
8. `packages/default-pack/scripts/prefabs/player-init.js` is
   replaced by `packages/default-pack/scripts/systems/player-spawn.js`,
   wired through `manifest.scripts[]` + `api.onWorldReady`.
9. `packages/default-pack/scripts/hello.js` no longer calls
   `api.registerPrefab`.
10. The game still boots, the player still spawns at `scene.spawn`,
    and every scene loads (manually verified by reading the
    default-pack scenes + build success — no in-browser smoke test
    in this dispatch per constraints).

---

## 17. Re-implementation note (2026-05-17)

PE2 + PE3 were originally landed on 2026-05-17 and recorded as
shipped in §11. The sandbox-reset incident the same day (see
`docs/SESSION_STATE.md` §2 / `docs/PLAN.md` row "Recovery
2026-05-17") wiped the in-engine code while leaving this plan doc's
phase-status table intact. A follow-up dispatch the same day
re-executed PE2 + PE3 cleanly and extended scope so the engine is
maximally unopinionated:

- **Engine built-ins slimmed** to the render / lifecycle set the
  engine code itself reads: `Position`, `Facing`, `Aim`, `Camera`,
  `Sprite`, `Animation`, `Light`, `Shader`. Game-specific
  components (`PlayerInput`, `Movement`, `Weapon`, `Inventory`,
  `MinimapMarker`, `Pickup`) are deleted from `packages/engine/src/
  Components/` and instantiated as opaque `Component<unknown>`
  instances from `manifest.components[]` at boot.
- **`api.components` is now a Proxy** that resolves every registered
  name through `ComponentRegistry.getComponent(name)` — pack code
  that reads `api.components.PlayerInput` still works because the
  proxy walks the full registry (built-ins + manifest entries +
  `defineComponent` calls).
- **Scene-entity load loop** (`PREFABS_EDITOR_ONLY.md §4.2`)
  implemented in `Game.spawnSceneEntities()`. `SceneJSON.entities[]`
  + `SceneEntityJSON` types added; `_*` editor metadata stripped;
  `Position` materialised to `Vec2`.
- **`player:moved` emission** moved pack-side. The engine's
  `Game.emitPlayerMoved` / `fireMoved` / `playerMoveTrack` are
  gone; `packages/default-pack/scripts/systems/player-input.js`
  owns the throttled emit with the same `PLAYER_MOVED_FRAME_THROTTLE
  = 10` cadence.
- **`KeyBindings`** relocated to `packages/engine/src/Controllers/
  Bindings.ts` so the engine's universal Settings UI can type
  bindings without depending on a `PlayerInput` component class.
- **`DefaultSettingsSystem`** no longer iterates `PlayerInput`
  entities to propagate binding changes — that propagation lives
  in the pack's `settings-screen.tsx` (which already had a parallel
  copy). Engine persists the overlay + re-applies to CONFIG;
  per-player propagation is a pack concern.
- **Pack-builder** drops the `prefab.initScript` discovery branch
  (the field is gone from `DeclarativePrefab`).
- **Default-pack** manifest drops `prefabs.player` entirely;
  `scripts/prefabs/player-init.js` deleted (empty dir removed);
  `scripts/systems/player-spawn.js` added to `manifest.scripts[]`
  as the first entry; `scripts/hello.js` no longer calls
  `api.registerPrefab("marker", …)`.

Verification: `bun run typecheck` clean across engine + game +
pack-builder + editor (one pre-existing `sharp` missing-dep error
in pack-builder is unrelated). `bun run build-packs` produces
`apps/game/public/packs/default.apg` (46 files, 27.3 MB). `bun
run build` (apps/game) bundles 197 modules clean.

---
