# Editor — in-browser level + pack authoring tool

A plan for `apps/editor`, the React 19 + Tailwind v4 + shadcn app
that authors `.apg` packs entirely in the browser. The editor runs
the **real** engine on the project being edited (no separate preview
renderer), backs all project data with IndexedDB via an
`EditorAssetPack` adapter, and emits a standard `.apg` zip on export.

Cross-refs: [PACK_CHAIN.md](./PACK_CHAIN.md) for the manifest fields
the editor must surface, [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md)
for the `AssetPack` interface contract the editor implements,
[MONOREPO_PLAN.md](./MONOREPO_PLAN.md) for the workspace slot the
editor lives in, [WALL_OVERHAUL.md](./WALL_OVERHAUL.md) and
[LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md) for the authoring
primitives the editor has to expose.

---

## 1. Goals & non-goals

### Goals

- **Level + scene authoring for two_5_d packs.** Tile painting,
  partial-wall placement, prefab placement, light placement, scene
  metadata, manifest editing, multi-scene packs.
- **Live mode is the only mode.** The engine runs continuously on
  the project being edited. There is no "preview" button — edits
  apply to the running scene and you walk through them immediately.
- **Round-trip with existing packs.** Import an existing `.apg` →
  edit → export `.apg` that loads in `apps/game` unchanged. Bytes
  out of the export pipeline are indistinguishable from
  `bun run build-packs`.
- **Local-first.** Everything (projects, blobs, bake caches) lives
  in IndexedDB. No server account required for authoring. Optional
  publish-to-community-store step is separate and follows
  [PACK_CHAIN.md § 10](./PACK_CHAIN.md).
- **Multi-project.** The editor's home screen is a list of
  projects. Each project is its own isolated authoring workspace.

### Non-goals

- **Not a graphics editor.** No texture painting, no sprite editor,
  no image filters. Users author textures in their own tools and
  drop them in. The editor accepts PNG / JPG and indexes them.
- **Not a full IDE.** Pack scripts (`scripts/*.js`) get a Monaco
  editor with TS IntelliSense against a generated ModAPI `.d.ts`
  bundle, but there's no full LSP / no project-wide refactor tooling
  beyond what Monaco's worker-based TS service ships with.
- **Not a bake renderer.** The lightmap bake reuses the engine's
  existing `bakeScene` (already shipped with `apps/pack-builder`)
  ported to run in a Web Worker. Same output bytes.
- **Not a multi-user collaborative editor.** Single-user, single-
  tab. Cross-tab editing of the same project shows a warning and
  goes read-only in the second tab.

---

## 2. Architecture overview

```
+-----------------------------------------------------+
|  editor shell  (React 19 + Tailwind v4 + shadcn)    |
|                                                     |
|  +----------+ +--------------------+ +-----------+  |
|  | Assets   | |  Viewport / Scene  | | Inspector |  |
|  | sidebar  | |  (live engine OR   | | (selected |  |
|  |          | |   grid editor)     | |  thing)   |  |
|  +----------+ +--------------------+ +-----------+  |
|         |              |                  |        |
|         v              v                  v        |
|  +-----------------------------------------------+ |
|  |  EditorContext (React) — project id, dirty,  | |
|  |  selection, mode toggle, undo stack, etc.    | |
|  +-----------------------------------------------+ |
|         |              |                  |        |
|         v              v                  v        |
|  +-----------------------------------------------+ |
|  |  EditorProjectStore — IndexedDB-backed CRUD   | |
|  +-----------------------------------------------+ |
|         |                                           |
|         v                                           |
|  +-----------------------------------------------+ |
|  |  EditorAssetPack  (implements `AssetPack`)    | |
|  +-----------------------------------------------+ |
|         |                                           |
|         v                                           |
|  +-----------------------------------------------+ |
|  |  @two_5_d/engine — Engine + Game.run(...)     | |
|  |  rendered into the viewport's <canvas>         | |
|  +-----------------------------------------------+ |
+-----------------------------------------------------+
```

**Engine embed: in-process, not iframe.** Recommend running the
engine in the same React app, not inside an iframe.

- Rationale: edits propagate through ordinary function calls. The
  editor calls `engine.swapScene(newSceneJSON)` directly; no
  `postMessage` shim, no serialization boundary.
- The engine already exposes a `Game` class that accepts a canvas;
  we mount it into a `<canvas>` ref inside the viewport pane.
- Service-worker scope and CSS don't conflict because both use
  Tailwind v4 with the same class strategy.

Iframe-isolated alternative: deferred. Revisit only if pack scripts
prove too destabilizing to the editor shell when they crash.

---

## 3. EditorAssetPack — IndexedDB adapter

The engine reads packs through the abstract `AssetPack` class in
`packages/engine/src/AssetPack/AssetPack.ts`. The editor implements
a concrete subclass backed by IDB.

### 3.1 Required surface

`AssetPack` is small. The editor must implement:

```ts
class EditorAssetPack extends AssetPack {
  readonly manifest: PackManifest;
  async textureBlob(path: string): Promise<Blob>;
  async textBody(path: string): Promise<string>;
  has(path: string): boolean;
}
```

`AssetPack.scene(path)`, `.startScene()`, `.config()`, `.scripts()`
are concrete on the base class and call into the abstract three.
They work for free.

### 3.2 Asset surfacing

- **Textures.** `textureBlob` returns the IDB-stored Blob directly.
  The engine already wraps `Blob` in `URL.createObjectURL` at point
  of use; the blob URL stays valid for the lifetime of the engine
  instance. No data-URL fallback needed — blob URLs are GA in every
  browser the engine targets.
- **Text bodies.** `textBody` decodes the IDB-stored `Uint8Array`
  or `string` to `string`. Scenes (JSON), scripts (JS source),
  configs (JSON) all go through this path.
- **`has(path)`.** Backed by an in-memory `Set<string>` of paths
  hydrated when the project loads. Mutated synchronously when the
  user adds/removes/renames an asset.

### 3.3 Engine integration

The editor's `Game` bootstrap looks like:

```ts
const pack = await EditorAssetPack.fromProject(projectId);
applyConfigOverride(await pack.config() ?? {});
const scene = await pack.startScene();
const game = new Game({ canvas, pack, scene });
game.start();
```

Identical to the game app's bootstrap — only the concrete `AssetPack`
differs. No engine code change required to consume `EditorAssetPack`.

---

## 4. Project model

### 4.1 IDB layout — one DB, multiple stores

**Recommendation: one shared IDB database named `two_5_d_editor`,
with object stores keyed by `(projectId, path)`.**

Tradeoffs considered:

| Strategy | Pros | Cons |
|---|---|---|
| One DB per project | Trivial delete (drop DB). Hard isolation. | `indexedDB.databases()` is non-standard in Safari < 17; project enumeration becomes brittle. Concurrent DB opens have rough quota interaction in Firefox. |
| One DB, stores per project | Simple enumeration via project-list store. | Delete = walk every store. |
| **One DB, single store with composite key (chosen)** | Enumeration trivial. Delete is one `IDBKeyRange.bound(projectId+":", projectId+";")`. Atomic transactions span project + asset writes. | None significant at this scale. |

### 4.2 Object stores

```ts
// Inside DB "two_5_d_editor":
projects:        keyPath "id"
  { id, name, createdAt, updatedAt, manifestId }
manifests:       keyPath "id"
  { id, projectId, json: PackManifest }
assets:          keyPath ["projectId", "path"]
  { projectId, path, kind: "text" | "blob", body: string | Blob,
    updatedAt, sizeBytes }
bakeCache:       keyPath ["projectId", "scenePath"]
  { projectId, scenePath, lightmap: Lightmap, bakedAt,
    sceneHash, manifestHash }
```

- `assets.path` mirrors the in-pack path (`scenes/scene1.json`,
  `images/wall.jpg`, `scripts/boot.js`). The export pipeline
  iterates the `projectId` range and writes each entry into the
  zip at `path` verbatim.
- `manifests` is split from `assets` because it's mutated more
  frequently than asset blobs (every tile-paint stroke can update
  manifest tile counts) and we want it small enough to read
  synchronously.
- `bakeCache.sceneHash` + `manifestHash` invalidate the cache when
  inputs change. The bake button refuses to no-op only if both
  hashes match.

### 4.3 Project lifecycle

```
Home screen → New / Open / Import → EditorContext mounts
   → load manifest + scene list from IDB
   → spin up engine with EditorAssetPack
   → render UI
```

`updatedAt` is bumped on every IDB write to drive sort order on
the home screen ("Recent" tab).

---

## 5. UI shell

The editor's UI is **mode-driven**: the user is always in one of
four **workflow modes** that determines what the Inspector shows
and what tools the viewport offers. An orthogonal Play ⇄ Edit
toggle decides whether the viewport runs the live engine or shows
the mode's editing surface.

### 5.1 Workflow modes

| Mode | What it authors | Primary inspector | Edit-mode viewport |
|---|---|---|---|
| **🗺️ Map** | Tile grids (walls / floors / ceiling), partial walls, tile-preset library | Selected-cell properties + preset library | 2D grid editor with layer toggle |
| **🎯 Entities** | Entity placement, components, spawners | Prefab picker + selected-entity components | 2D map overlay with entity glyphs |
| **📜 Scripts** | Pack scripts (`.js`) and their attachments | Monaco editor + script's attached entities | Hidden (mode is text-focused) |
| **🎨 Assets** | Textures, sprites, sounds, manifest config | Asset detail + manifest form | Thumbnail grid / detail preview |

Switching modes is a top-bar tab click (keyboard: `1` / `2` / `3` / `4`).
Switching does NOT change project state — only the UI surface.
The active scene and selection persist across modes where
meaningful: a cell selection from Map mode is still a cell
selection in Entities mode (the inspector just shows the entities
*in* that cell instead of the cell's tile data).

What each mode swaps:
- **Inspector form** in the right column.
- **Tool palette + cursor behavior** in the viewport.
- **Sidebar grouping order** (Map mode promotes the tile-preset
  library to the top; Scripts mode promotes the scripts tree;
  etc.).

The viewport canvas, status strip, and asset sidebar persist
across all modes. The Play ⇄ Edit toggle (§5.3) is global and
orthogonal — in Play mode every workflow mode shows the running
engine; in Edit mode each workflow mode renders its own editing
surface.

### 5.2 Layout

Three-column layout, matching the current scaffold in
`apps/editor/src/App.tsx` but built out:

```
+-- [ 🗺️ Map ] [ 🎯 Entities ] [ 📜 Scripts ] [ 🎨 Assets ] -----------+
|                                                                       |
| Assets sidebar |   Viewport                  | Inspector              |
| (mode-ordered) |                             | (mode-specific)        |
|                | +------------------------+  |                        |
| Tile presets ▾ | |                        |  | Selected: wall(3,5)    |
|  brick.wall    | |  <canvas> live engine  |  |                        |
|  door.heavy    | |  (Play mode)           |  | preset: [brick.wall ▾] |
|                | |                        |  | linked ● ─ break ✂     |
| Scenes ▾       | |  2D grid editor in     |  |                        |
|  scene1.json   | |  Edit mode             |  | partialWall:           |
|                | +------------------------+  |   face: north          |
| Scripts        | [▶ Play] [✎ Edit] [⚡ Bake] |   widthU: 0.5          |
| Manifest       | [💾 Save] [📦 Export]       |                        |
+--------------- + ----------------------------+------------------------+
| Status: dirty • last bake: 2m ago • FPS: 60                           |
+-----------------------------------------------------------------------+
```

The `linked ●` indicator next to the preset picker shows whether
the cell is still tracking its preset (live updates flow in) or
has been broken loose into an anonymous preset (`✂` breaks the
link; ●/○ toggles its state). See §6.1 for the tile-preset model.

### 5.3 Play ⇄ Edit

- **Play mode** — viewport hosts the live engine. WASD + mouse
  capture (Pointer Lock) work exactly as in the game. Edits made
  in Edit mode are visible immediately when switching back.
- **Edit mode** — viewport switches to a workflow-mode-specific
  editing surface (engine paused). Map mode shows the 2D grid;
  Entities mode shows the same grid with entity overlays;
  Scripts mode hides the viewport entirely; Assets mode shows a
  thumbnail browser.
- Toggle binding: `Tab` swaps Play ⇄ Edit. Spacebar in Edit mode
  centers the grid on the player's last position so users can
  edit "where they were."

### 5.4 Selection model

A single `selection` slot in `EditorContext`. It can hold:

```ts
type Selection =
  | { kind: "cell"; scenePath: string; x: number; y: number }
  | { kind: "wallSegment"; scenePath: string; x: number; y: number; index: number }
  | { kind: "entity"; scenePath: string; entityName: string }
  | { kind: "asset"; path: string }
  | { kind: "manifest" }
  | null;
```

The Inspector panel switches form based on `selection.kind`. Asset
selections in the sidebar drive a thumbnail preview + rename / delete.

### 5.5 Status strip

Footer shows: dirty marker, last bake age per scene, current
project name, engine FPS while in Play mode.

---

## 6. Editing primitives

The editor must let users author every scene-data shape the engine
accepts. The current scene format is documented in
[WALL_OVERHAUL.md § 2](./WALL_OVERHAUL.md) and
[LIGHTING_OVERHAUL.md § 3](./LIGHTING_OVERHAUL.md).

### 6.1 Tile presets — drag, drop, break-link

The unit of tile authoring is a **preset**, not a raw tile id.
See [TILE_PRESETS.md](./TILE_PRESETS.md) for the format spec, the
named-vs-anonymous tier model, the per-scene `idMap`, and the
build-merge step. This section covers only the editor UX layered
on top.

**The preset library.** Map mode's sidebar promotes "Tile presets"
to the top panel. It lists every named preset from
`manifest.tilePresets[]` — both the active project's libraries
and presets inherited from `requires[]` packs. Grouped by source
file (`walls.jsonc`, `doors.jsonc`, …) so a modder can scan their
vocabulary at a glance.

**Painting an instance.**
- Drag a preset from the library onto a cell → the cell becomes
  an instance linked to that preset. Click-drag paints a region.
- Right-click erases.
- `Shift`+click on an existing cell bucket-fills the connected
  region sharing the same preset id.
- Layer toggle (`W` / `F` / `C` keys) switches the active layer
  among walls, floors, ceiling. Presets declare `appliesTo:
  ["walls", "floors"]` in their JSONC — the library greys out
  presets that don't apply to the active layer.

**Linked vs broken.** Per the preset model, a cell is in one of
two states:
- **Linked ●** — references a named preset by id. Edits to the
  preset (via the preset editor) propagate to every linked
  instance next frame; no engine restart.
- **Broken ○** — references an anonymous preset (content-hash id)
  unique to this cell (or this cluster of identical broken cells).
  Per-cell edits no longer touch other instances.

The cell Inspector shows the preset picker plus `linked ●` /
`broken ○` indicator. A `✂` button breaks the link (forks the
named preset into an anonymous one for this cell, then opens its
field form). A `🔗` button shows up on broken cells and offers
either "Pick a named preset" (drops local edits) or "Promote to
named preset" (see below).

**Editing a preset propagates.** With a linked cell selected, an
"Edit preset" button in the Inspector opens the preset's source
JSONC inline in a form (not raw text). Edits saved here update
the preset file in IDB and rebroadcast through the engine's
`PresetResolver` so all linked instances re-render with the new
values immediately.

**Promote anonymous to named.** On a broken cell, `🔗 Promote to
named preset` prompts for a name + target file (`walls.jsonc` etc.)
and moves the anonymous preset into that file with the chosen id.
The cell re-links. Sibling cells whose anonymous content matches
also re-link to the new named preset (the live equivalent of
build-merge dedupe). The author's "vocabulary" grows naturally
out of authoring without ever requiring them to think about
presets up-front.

**Grid render.** The 2D grid editor draws each cell as the
preset's primary texture (sampled at the center). A small badge
in the cell's corner shows the preset name on hover. Broken cells
get a subtle dashed outline so the user can spot un-named
divergence at a glance.

### 6.2 Partial walls (knee walls, hangers)

Partial-wall shape lives **inside the preset**, not on the cell.
A "knee wall" is a preset with `partialWall: { startZ: 0,
height: 0.35, topTile: "brick.cap" }` declared in its JSONC; the
modder places knee walls by drag-drop of that preset, same as any
other tile.

The preset editor (opened via "Edit preset" on a linked cell, or
by double-clicking a preset in the library) renders a form for
every field documented in [TILE_PRESETS.md](./TILE_PRESETS.md)'s
schema — partial-wall fields among them. The cell Inspector
itself never shows partial-wall fields; that prevents the data
model from drifting back into a per-cell-struct shape.

Authoring a one-off partial wall (without naming it) is still
supported: drag a base preset onto the cell, then `✂ Break link`
on the cell to fork it into an anonymous preset, then edit its
partial-wall fields inline. The build-merge step still dedupes
identical anonymous breaks across the map.

### 6.3 Prefab placement (entities)

Once [ENGINE_PACK_SPLIT R1](./ENGINE_PACK_SPLIT.md) lands, scenes
hold an `entities[]` array. The editor:

- Lists every registered prefab name (read from the active pack's
  manifest + scripts at load time).
- "Place entity" tool: click on a cell → opens a popover with the
  prefab picker → entity inserted at the clicked world coords →
  added to `scene.entities[]`.
- Selected entities show their components in the Inspector. Each
  component is a sub-form generated from the component's schema
  (when present) or a generic JSON editor as fallback.

### 6.4 Light placement

Lights are entities with the `Light` component (per the
`LIGHTING_ENTITIES_REFACTOR` plan) once that's merged; until then
they are also-accepted as `scene.lights[]`.

- "Place light" tool drops a Light entity at clicked coords.
- Inspector exposes: color (RGB swatch), intensity, radius, z,
  and `baked: bool`. Dynamic lights (`baked:false`) get a small
  ⚡ glyph in the grid view; baked lights get a ☀ glyph.
- Emissive surfaces (`WallSegment.emissive`, `FloorSpec.emissive`)
  are authored as a sub-form on the parent surface — the editor
  doesn't create a separate light entity for them.

### 6.5 Manifest editing

A dedicated form for the active project's `manifest.json`. Fields:
`name`, `version`, `engine`, `startScene` (dropdown of project's
scenes), `tilePresets` (table of preset library files; see
[TILE_PRESETS.md](./TILE_PRESETS.md) — individual preset editing
happens in Map mode, not here), `items`, `sprites`, `lighting`
bake tuning, [PACK_CHAIN.md § 2](./PACK_CHAIN.md) `id`,
`description`, `author`, `homepage`, `requires`.

The `requires[]` editor surfaces the trust modal flow — adding a
URL-pinned dep prompts for the integrity hash (with a "compute from
URL" button that fetches and hashes the bytes).

### 6.6 Entity spawners (pack content)

Spawners are **not** an engine concept. They ship as pack content:
a `Spawner` component plus a `SpawnerSystem` registered via the
ModAPI. The default pack ships a basic flavor covering point-spawn,
area-spawn, and timed-respawn — enough for the bundled scenes.

Placement in the editor reuses §6.3's prefab UI verbatim — a
spawner entity is dropped in the same way as any other prefab.
What's special is the Inspector: when the selected entity has a
`Spawner` component, the inspector renders a **Targets** sub-form
that lets the author pick which prefab(s) the spawner emits, plus
parameters (rate, jitter, count cap, area bounds, respawn cooldown).
The form is fully schema-driven — `Spawner`'s component schema, as
registered through the ModAPI, dictates the fields. There is no
spawner-specific code in the editor.

Custom packs can ship their own spawner flavors (conditional,
event-driven, wave-based, scripted-trigger) without any engine or
editor changes. They register their new component(s) + system(s)
through the ModAPI; the editor's generic schema-driven inspector
picks the shape up automatically and renders the right form.

---

## 7. Bake workflow

Per-cell lightmap baking is slow — a 32×32 scene at K=4 N=4 takes
multiple seconds. The editor MUST NOT bake on every edit.

### 7.1 The Bake button

The `⚡ Bake` toolbar button operates on the **active scene only**.
A dropdown next to it offers "Bake all scenes." Both actions:

1. Mark the engine as paused, swap viewport to a progress sheet.
2. Spawn a Web Worker (`packages/engine/dist/bake-worker.js`) and
   `postMessage` the scene JSON + manifest lighting block.
3. Worker imports `bakeScene` from `@two_5_d/engine` (or a thin
   shared package — see § 11.4) and runs it.
4. Worker streams `{ progress: 0..1 }` messages. Sheet shows a bar.
5. On completion, worker posts the `Lightmap` back. Editor:
   - Writes the lightmap into the scene JSON (`scene.lightmap`).
   - Persists the updated scene asset to IDB.
   - Writes a `bakeCache` row keyed by scene path.
   - Recomputes scene + manifest hashes for cache validity.
6. Engine restarts on the now-baked scene; dynamic lights resume.

Dynamic lights (`baked:false`) require no rebake — they're picked
up on the next engine frame. The "Bake" button is disabled (with
tooltip "no baked lights to update") if a scene contains zero
baked lights and zero emissive surfaces.

### 7.2 Bake staleness

A scene is "bake-stale" if `scene.lightmap` is absent OR
`bakeCache.sceneHash !== sha256(scene without lightmap)`. The
sidebar surfaces stale scenes with an amber dot. The bake button
in the toolbar shows the staleness state for the active scene.

The hash specifically excludes `scene.lightmap` itself so that
re-baking doesn't churn the hash.

---

## 8. Export pipeline

Exporting reproduces what `apps/pack-builder/src/build-packs.ts`
does today, but inside the browser.

### 8.1 Steps

```
Export .apg button clicked:
  1. Validate manifest    (required fields, version semver, engine range)
  2. Validate scenes       (start scene exists; every preset id
                            referenced in walls/floors/ceilings
                            resolves through the project's tilePresets
                            libraries or an inherited requires[] pack)
  3. Optional pre-bake     (prompt: "3 scenes are stale — bake first?")
  4. Build the zip:
     - manifest.json
     - config.json (if present)
     - scenes/*.json
     - images/* (Blob entries — JSZip accepts Blob bodies)
     - scripts/*.js
     - sounds/*  (when sound support lands)
  5. Generate `.apg` blob via JSZip
  6. Compute SHA-256 of the bytes (for PACK_CHAIN integrity field)
  7. Trigger browser download via <a download>
  8. Show modal: filename + SHA-256 + "Copy integrity line"
     (Copy button outputs: `"integrity": "sha256-..."`)
```

JSZip is already a dependency (used by `ZipAssetPack` and by the
CLI build-packs). The editor reuses it directly.

### 8.2 Why not just serve the editor pack to apps/game?

A future enhancement: the editor exposes a local URL
(`http://localhost:3001/api/editor-pack/<projectId>.apg`) that
serves the live in-IDB project as a `.apg` on demand. Then
`apps/game` can load `?pack=http://localhost:3001/...` and play it
without an export step. Out of scope for E1–E3; planned for E5.

### 8.3 SRI / integrity

[PACK_CHAIN.md § 8](./PACK_CHAIN.md) calls for SHA-256 integrity
hashes on URL-pinned dependencies. The export modal surfaces the
exported pack's hash so the modder can paste it into a dependent
pack's manifest. The same hashing function is exposed via
`packages/engine/src/AssetPack/integrity.ts` (created during
PACK_CHAIN P3).

---

## 9. Import pipeline

Two entry points, one shared write path. Both ways a user starts a
project from existing pack content.

### 9.1 Local file import

Drop a `.apg` onto the home screen → new project.

```
Import .apg:
  1. User drops file (or picks via <input type=file>)
  2. JSZip.loadAsync(file)
  3. Read manifest.json → validate
  4. Generate new projectId (UUID)
  5. Create projects + manifests rows
  6. For every file in the zip:
       kind = isText(path) ? "text" : "blob"
       body = isText ? decode(bytes) : new Blob([bytes])
       write assets row { projectId, path, kind, body, sizeBytes }
  7. Open the new project
```

`isText(path)` is a tiny lookup table: `.json` / `.js` / `.txt` /
`.glsl` / `.frag` / `.vert` → text, everything else → blob.

Importing a pack that already has a baked `scene.lightmap` keeps
the bake — no rebake required until the user edits lights.

### 9.2 Open from community store

The editor's home screen also exposes the community store browser
(reuses the Settings → Packs UI designed in
[PACK_CHAIN.md](./PACK_CHAIN.md) §5). User browses, picks a pack,
clicks **"Open in editor"** → the editor fetches the pack as a
`.apg`, then runs the **exact same write path as §9.1**. End state:
a fresh IDB project that's a detached clone of that pack, ready to
edit.

```
Open from store:
  1. User selects pack from store browser (id + version)
  2. GET <store>/packs/:id/:version/file → .apg bytes
  3. Verify SHA-256 against store-reported integrity hash
  4. Hand bytes to §9.1 step 2 (JSZip.loadAsync)
  5. … rest identical to §9.1 …
  6. Before opening, stamp the manifest with `forkedFrom`:
       { id, version, hash, openedAt }
```

The `forkedFrom` field records **provenance** — the source pack's
id + version + integrity hash, plus the timestamp. It is purely
informational; the new project is fully detached and has its own
manifest, assets, scenes. The field's purpose is twofold:

1. **Attribution.** If the source pack has a license that requires
   credit, the export pipeline can surface this so the user
   doesn't ship an unattributed fork by accident. The Export
   dialog reads `manifest.forkedFrom` and renders a
   "This project is forked from `<id>@<version>`" line with a
   "Copy attribution to README" action.
2. **Pull updates from upstream.** Future capability: if the
   source pack publishes a new version, the editor can offer a
   3-way merge ("upstream `default-pack@1.4` has 3 new prefabs you
   don't have — pull them?"). Out of scope for E1–E5; the field
   future-proofs that flow.

Note: `forkedFrom` is NOT the same as `requires[]` from
[PACK_CHAIN.md](./PACK_CHAIN.md). `requires[]` declares a runtime
dependency — the engine loads the parent pack at play time and
overlays your changes. `forkedFrom` declares an authorship
ancestor — at play time your pack stands alone with no parent
load. Both can coexist on the same manifest (rare but valid: you
forked a pack, kept extending it, then later imported a new
shared library as a runtime dep).

### 9.3 Open as dependency, not as fork

A third workflow worth supporting once
[PACK_CHAIN.md](./PACK_CHAIN.md) lands: instead of cloning the
source pack into your project, declare it as a `requires[]`
dependency and only author the delta. The home screen offers a
choice when the user picks a store pack:

```
You picked default-pack@1.4. How do you want to use it?

  ◯ Fork it      — clone the entire pack into a new project.
                   You can rewrite anything. Big project, full control.

  ◉ Extend it    — your project declares default-pack@1.4 as a
                   requires[] dep. You only author your delta
                   (new scenes, new prefabs, asset overrides).
                   Small project, parent updates flow in.
```

"Extend it" creates a near-empty IDB project: just a manifest with
`requires: [{ id: "default-pack", version: "1.4" }]` and nothing
else. Live mode loads the dep through the engine's pack-chain
resolver. Adding assets in the editor overrides the parent's; the
inspector shows which assets are inherited vs locally authored.

### 9.4 Open from URL (untrusted)

Mirrors [PACK_CHAIN.md](./PACK_CHAIN.md)'s "URLs aren't
second-class" principle: a modder can open *any* pack hosted
anywhere — not just packs published to the community store — and
fork or extend it the same way. The home screen has an **"Open
URL…"** action that takes a `.apg` URL and optionally an integrity
hash:

```
Open pack from URL

  URL:        [ https://example.com/cool-pack.apg            ]
  SHA-256:    [ (optional, paste to pin integrity)            ]
  Then:       ◉ Fork it    ◯ Extend it (declare as requires[])
                                       [Cancel]   [Open]
```

The fetch + write path is identical to §9.2 with one exception:
the source is an arbitrary URL, not a store id. Provenance is
recorded as:

```json
"forkedFrom": {
  "url": "https://example.com/cool-pack.apg",
  "hash": "sha256-…",
  "openedAt": "2026-05-14T18:42:00Z"
}
```

No `id` / `version` fields — those are store-issued and arbitrary
URLs don't have them. The pack's own `manifest.id` and
`manifest.version` are preserved inside the cloned project, but
they live in the project's manifest, not in `forkedFrom`.

#### Trust model

Untrusted URL imports get the same treatment as untrusted URL
packs in PACK_CHAIN.md:

1. **Confirmation dialog** before fetch: "This pack is from a
   source we can't verify (`https://example.com/…`). It will run
   inside your browser with full access to the editor's local
   state. Continue?"
2. **SRI pinning is encouraged.** If the user provides a SHA-256,
   the editor verifies it post-fetch and aborts on mismatch. The
   hash is stored in `forkedFrom.hash` and can be re-checked on
   any future re-fetch (e.g. "pull updates from upstream").
3. **CORS reality.** The fetch is a plain `fetch(url)`. If the
   host doesn't send CORS headers the browser will block the
   request — the editor surfaces a CORS-specific error and
   suggests either (a) downloading manually and using §9.1
   local-file import, or (b) hosting the pack somewhere with
   CORS enabled.
4. **No execution before write.** The pack's scripts don't
   execute during import — import is a pure data-copy step. The
   first time scripts run is when the user opens the project and
   live mode boots the engine. By then the pack is local and the
   user can inspect it.

#### Why this matters

Without §9.4 the editor implicitly endorses the community store
as the only legitimate distribution path. That contradicts the
project's stated goal that **packs are content the user owns and
distributes however they want**. The store is a convenience layer
on top of the URL substrate, not a wall around it.

---

## 10. Phases

Each phase ships independently with a runnable result.

### E1 — Project shell + home screen
- Home: list / create / rename / delete projects (IDB-backed).
- Empty project → manifest editor + scene list (no engine yet).
- IDB schema + `EditorProjectStore`.
- "Import .apg" works (unzips into a new project).
- Acceptance: import default-pack `.apg`, open, see manifest + scene list.

### E2 — EditorAssetPack + live engine in viewport
- `EditorAssetPack` extends `AssetPack`, backed by IDB reads.
- Viewport pane mounts the engine via `Game` against the active
  scene + EditorAssetPack.
- Play mode works (WASD, mouse capture). Edit mode toggle exists
  but Edit mode still shows live engine (no edit overlay yet).
- Acceptance: open an imported default-pack project and walk
  around scene1 inside the editor.

### E3 — Edit mode + tile painting + manifest CRUD
- Edit mode renders the 2D grid. Tile painting works on `walls`.
  Floor + ceiling layers selectable.
- Inspector for cell selection: tile id, partial-wall struct.
- Texture sidebar: import PNG/JPG, assign to tile id.
- Save persists to IDB. Switching to Play mode restarts the
  engine on the edited scene.
- Acceptance: paint a new room, switch to Play, walk into it.

### E4 — Entities, lights, bake button
- Entity placement (prefab picker, position cell-snap).
- Light placement (baked + dynamic, color / intensity / radius).
- Inspector forms for components on selected entities.
- `⚡ Bake` button spawns Web Worker, writes baked lightmap to IDB.
- Acceptance: place a baked light, bake, see it illuminate
  surfaces in Play mode. Place a dynamic light, see it move /
  pulse without rebake.

### E5 — Export + local-serve + script editor
- `📦 Export .apg` button assembles zip, downloads, surfaces SHA-256.
- Local HTTP route at `/api/editor-pack/:projectId.apg` serves
  the live project as a pack (so `apps/game` can `?pack=...` it).
- Scripts sidebar: Monaco editor for `scripts/*.js` with TS
  IntelliSense fed by a generated ModAPI `.d.ts` bundle. Changes
  hot-reload by restarting the engine in the viewport.
- Acceptance: export a pack, run `apps/game` with that pack as
  `?pack=...`, see the same content.

E6+ (deferred):
- §9.2 Open from store + §9.3 Open as dependency + publishing flow
  — gated on [PACK_CHAIN.md](./PACK_CHAIN.md)'s store backend landing.
- **§9.4 Open from URL — landable earlier** (no backend needed,
  just a fetch + JSZip + the §9.1 write path + the trust-confirm
  dialog). Reasonable to fold into **E1** alongside local-file
  import, since they share most of the implementation.
- Collaborative editing.
- Sprite-atlas creator.
- Partial-wall (face/widthU) authoring once
  [WALL_OVERHAUL.md Phase 3](./WALL_OVERHAUL.md) lands.

---

## 11. Open questions

1. **Engine embed boundary.** In-process (recommended) vs iframe.
   In-process keeps edits cheap but a crashing pack script could
   take down the editor shell. Mitigation: wrap pack-script
   execution in a try/catch barrier and surface errors in a UI
   strip. Confirm acceptable.
2. **Web Worker for bake — module strategy.** The bake function
   currently lives in `apps/pack-builder`, not `packages/engine`.
   Two options:
   - (a) Move `bakeScene` into `packages/engine` so the worker
     and the CLI both import it.
   - (b) Publish `apps/pack-builder/src/bake-lights.ts` as a
     subpath export `@two_5_d/pack-builder/bake`.
   Recommend (a) — bake is engine logic, not a build tool. Touches
   the engine API surface; confirm direction before E4.
3. **Project storage size + quota UX.** A pack with 50 textures
   at 1MB each is a 50MB IDB entry. Browser quotas are generous
   (~60% of free disk on Chrome) but not infinite. Surface a
   per-project size readout + warn at 80% of `navigator.storage.estimate()`.
4. **Undo stack scope.** Per-asset (textures, scenes, manifest each
   have their own stack) or global? Global is simpler; per-asset
   matches the "edits are isolated" mental model better. Recommend
   global with a depth cap of 100 ops.
5. **Live mode + manifest edits.** Some manifest changes (preset
   field tweaks, sprite swaps) can hot-apply; others (config
   baseline changes for renderer backend) require an engine reload.
   Define which manifest fields are "hot" vs "cold." Default:
   anything outside `tilePresets` / `sprites` / `items` is cold
   and triggers an engine restart prompt.
6. **Pack-chain deps in the editor.** Should the editor resolve a
   project's declared `requires[]` and load those packs alongside
   the project when running the engine? Recommend yes from E2 —
   otherwise scripts that depend on prefabs from a parent pack
   break in the editor.
7. **Scripts editor — DECIDED: Monaco.** TS IntelliSense against
   the ModAPI surface is the single biggest authoring win on the
   table — script authors writing against a typed `mod.registerSystem`
   / `mod.registerComponent` API get inline parameter help, jump-to-def,
   and red squiggles on mis-typed component fields. That's worth the
   ~2 MB bundle hit for an authoring tool (the game ships without
   Monaco). CodeMirror 6 would only have made sense if the editor
   needed to embed inside the live game runtime; it doesn't.
   Implementation note: Monaco's worker-based TS service needs a
   `.d.ts` bundle describing the ModAPI surface to drive
   IntelliSense. Generating that bundle (probably via `tsc --declaration`
   over the engine's public ModAPI module) is a small deferred work
   item folded into **E5** alongside the editor itself.
8. **Save semantics.** Auto-save on every edit, or explicit
   `💾 Save`? Auto-save matches modern editor UX; explicit save
   makes "discard changes" trivially well-defined. Recommend
   auto-save with a per-asset history (undo) — explicit save
   becomes "snapshot project."

These can be deferred until the corresponding phase. None block E1.
