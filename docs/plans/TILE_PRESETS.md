# Tile presets — preset-driven tile authoring + tiny scene files

Plan for replacing inline per-cell tile data with a **preset library +
ID reference** model. Every tile in a scene is a preset — named ones
authored by modders in JSONC libraries, anonymous ones emitted by the
editor and collapsed by a build-time merge step. Scene grids carry
nothing but small ints that resolve to preset IDs via a per-scene
`idMap`.

The follow-on goal: scene files become **diff-friendly, human-
readable, and small** even as cells gain ever-richer structure
(variable wall heights, partial walls, top/bottom caps, emissives, AO
hints, collision flags …).

Cross-refs: [WALL_OVERHAUL.md](./WALL_OVERHAUL.md) for the per-cell
data shape this plan packages up. [PACK_CHAIN.md](./PACK_CHAIN.md) §§
2 + 7 for the manifest schema this plan extends and the override
semantics preset libraries inherit. [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md)
R3 for the pack-loading lifecycle the `PresetResolver` slots into.
[EDITOR.md § 6](./EDITOR.md) for the authoring UX that produces and
consumes presets; this doc covers the data model, EDITOR.md covers the
UI.

Date drafted: **2026-05-14**.

---

## 1. Goals & non-goals

### Goals

- **Single source of truth for "what a tile is."** A preset is the
  complete description of one tile kind (texture, height, caps,
  emissive, collision, AO). Scenes only ever reference presets by
  ID — never inline a tile's fields.
- **Hand-authorability.** Preset files MUST be editable in a plain
  text editor by a modder who has never opened the editor app.
  Format choices (JSONC, defaults-for-everything, self-documenting
  names) are subordinate to this constraint.
- **Tiny, diff-friendly scenes.** A wall grid is rows of small ints
  mapped through a per-scene table. A scene that's 5000 cells wide
  with 20 distinct tile kinds takes 20 lines of idMap + a compact
  grid — not 5000 inlined wall structs.
- **Modder-shareable libraries.** A pack can ship ONLY presets (no
  scenes, no entities), and other packs can declare it as a
  `requires[]` dep to reuse those presets. Tile presets become a
  first-class asset category in [PACK_CHAIN.md](./PACK_CHAIN.md).
- **Deterministic build-time collapse.** Two modders who happen to
  paint identical custom tiles converge on the same preset ID after
  build. Identical content always hashes identical.
- **Backwards compatible.** Existing `manifest.tileTextures` packs
  keep loading via a deprecation shim that auto-generates a built-in
  preset library at load time.

### Non-goals

- **Not a runtime entity system.** Spawners, NPCs, weapons, props
  remain entities (per [ENGINE_PACK_SPLIT.md R1](./ENGINE_PACK_SPLIT.md)).
  Presets describe cells, not actors.
- **Not a texture pipeline.** Presets reference image paths; image
  loading + atlasing is unchanged.
- **Not a behaviour system.** A preset's `collision: "trigger"` is a
  data hint the engine and gameplay scripts may interpret; the
  preset file does NOT carry JS code.
- **Not a replacement for `scene.entities[]`.** Scenes still hold
  entities for the actors / items / lights that don't snap to the
  grid. Only cell data is preset-driven.
- **Not a replacement for sprite or item definitions.** Those keep
  their existing manifest sections.

---

## 2. Status quo + the problem

### Today's data model

`manifest.json` holds a flat lookup table:

```jsonc
{
  "tileTextures": {
    "1": "images/tiles/wall.jpg",
    "2": "images/tiles/wood_floor.jpg",
    "3": "images/tiles/ceiling.jpg"
  }
}
```

Scene files (`packages/default-pack/scenes/scene1.json`, etc.) carry
parallel grids — `walls[y][x]`, `floors[y][x]`, `ceilings[y][x]` —
keyed by numeric tile id. The wall grid started as bare `number`,
and after [WALL_OVERHAUL.md Phase 1](./WALL_OVERHAUL.md) the parser
accepts either a number OR a structured object:

```jsonc
[1, 1, 1, { "tile": 1, "height": 0.35, "topTile": 4 }, 1, 1]
```

`scene_heights_demo.json` already shows where this is heading: every
custom wall is a JSON object with 4-7 fields. Today the demo has 5
inlined partial walls. A 64×64 production scene with custom-height
windows, hanging beams, knee walls, and emissive trim becomes
unreadable — and unrebaseable, because every cell mutation churns
the file.

### The actual problem

Per-cell richness is GROWING, not shrinking. The plans on the table:

- [WALL_OVERHAUL.md Phase 2](./WALL_OVERHAUL.md) adds per-cell floor
  and ceiling heights + implicit risers.
- [WALL_OVERHAUL.md Phase 3](./WALL_OVERHAUL.md) adds multiple
  partial-width walls per cell.
- [LIGHTING_OVERHAUL.md](./LIGHTING_OVERHAUL.md) lit up emissive
  surfaces on walls / floors / ceilings.
- AO hints, collision flags, and trigger volumes are queued behind
  those.

By the time Phase 3 lands, a single rich cell could be ~150 bytes of
JSON. Pasting that 4000 times across a scene is untenable. Every
shipped scene becomes diff-hostile, and modders never reuse cell
recipes because there's no place to **name** one.

The preset model fixes both: name the recipe once, reference it as a
small int wherever it appears.

---

## 3. Data format spec — preset files (`.jsonc`)

### 3.1 File layout

Preset libraries live in the pack under `presets/`:

```
my-pack/
├── manifest.json
├── presets/
│   ├── walls.jsonc
│   ├── doors.jsonc
│   ├── floors.jsonc
│   ├── ceilings.jsonc
│   └── props.jsonc
└── ...
```

One file per category by convention. Categories are NOT enforced —
a single `tiles.jsonc` is legal, and the engine doesn't care which
file a preset lives in. Categories exist purely for human
organisation.

### 3.2 File shape

Each file is a JSONC object whose keys are preset IDs and whose
values are preset definitions:

```jsonc
// presets/walls.jsonc — modder-authored wall presets
{
  // Standard brick wall. Full cell, no caps.
  "brick.wall": {
    "texture": "images/tiles/brick.png"
  },

  // Knee-high parapet using the same brick.
  "brick.parapet": {
    "extends": "brick.wall",
    "wallHeight": 0.35,
    "topCap": "images/tiles/brick_cap.png"
  },

  /* Mossy variant of the brick wall. Identical otherwise. */
  "brick.wall.mossy": {
    "extends": "brick.wall",
    "texture": "images/tiles/brick_mossy.png"
  }
}
```

### 3.3 The full preset schema

```jsonc
{
  // ===== Identity =====
  "extends": "brick.wall",          // optional. Inherits all fields from another preset.

  // ===== Texturing =====
  "texture": "images/tiles/x.png",  // required (unless extends provides one)
  "topCap":    "images/tiles/x.png", // optional — horizontal surface at top of wall
  "bottomCap": "images/tiles/x.png", // optional — horizontal surface at bottom (hanger)
  "offsetX": 0,                     // texel offset along U. Default 0. Wraps.
  "offsetY": 0,                     // texel offset along V. Default 0. Wraps.

  // ===== Vertical geometry =====
  "wallHeight": 1.0,                // 0..1 world units. Default 1 (full cell).
  "wallStartZ": 0.0,                // 0 = floor-rooted. Default 0.

  // ===== Horizontal geometry (Phase 3 of wall overhaul) =====
  "partialWall": {                  // optional. Omit for "fills the cell".
    "face": "north",                // "north" | "south" | "east" | "west"
    "startU": 0.0,                  // 0..1 along that edge
    "widthU": 0.5                   // (0, 1]
  },

  // ===== Floor/ceiling fields (only meaningful for those preset categories) =====
  "floorHeight":   0.0,             // world z. Default 0.
  "ceilingHeight": 1.0,             // world z. Default 1.
  "reflectiveness": 0.0,            // 0..1. Mirror amount.
  "transition":     0.0,            // 0..1. Edge softness.
  "riserTexture":   "images/tiles/riser.png", // optional. Used at floor/ceiling step boundaries.

  // ===== Lighting =====
  "emissive": {                     // optional
    "color": [1.0, 0.9, 0.7],
    "intensity": 1.5,
    "areaLight": true               // default true. See LIGHTING_OVERHAUL.md
  },

  // ===== Gameplay =====
  "collision": "solid",             // "solid" | "passable" | "trigger" | "blockBullets". Default depends on category.
  "ambientOcclusion": true,         // Default true.

  // ===== Authoring metadata (ignored at runtime) =====
  "displayName": "Brick wall",      // human label for editor pickers
  "tags": ["brick", "stone", "ruined"], // for editor filtering / search
  "thumbnail": "images/thumbs/brick.png" // optional — editor uses this when set, else `texture`
}
```

Every field except `texture` (or `extends`) has a default. The
minimum valid preset is:

```jsonc
{ "brick.wall": { "texture": "images/tiles/brick.png" } }
```

### 3.4 Worked examples

**Minimal** — a full-cell wall, no caps, no emissive:

```jsonc
{
  "brick.wall": { "texture": "images/tiles/brick.png" }
}
```

**Typical** — a knee wall that extends the brick:

```jsonc
{
  "brick.parapet": {
    "extends": "brick.wall",
    "wallHeight": 0.35,
    "topCap": "images/tiles/brick_cap.png"
  }
}
```

**Kitchen sink** — a glowing partial-wall window frame:

```jsonc
{
  "neon.window.east": {
    "displayName": "Neon window frame (east face)",
    "tags": ["neon", "window", "emissive"],
    "texture": "images/tiles/neon_frame.png",
    "wallStartZ": 0.4,
    "wallHeight": 0.4,
    "partialWall": { "face": "east", "startU": 0.2, "widthU": 0.6 },
    "topCap":    "images/tiles/neon_frame_cap.png",
    "bottomCap": "images/tiles/neon_frame_cap.png",
    "offsetX": 0,
    "offsetY": 0,
    "emissive": { "color": [0.3, 0.9, 1.0], "intensity": 2.5, "areaLight": true },
    "collision": "solid",
    "ambientOcclusion": false
  }
}
```

### 3.5 Preset ID conventions

- **Named presets** use dotted lower-kebab: `brick.wall`,
  `brick.wall.mossy`, `door.heavy.metal`. Recommend `category.name`
  or `category.name.variant`. Engine treats IDs as opaque strings.
- **Anonymous presets** use a leading underscore + content hash:
  `_a8f3c2d1`. The leading underscore is a hard reserved character;
  named presets MUST NOT start with `_`. Build-time validator
  refuses any named preset matching `/^_/`.
- IDs are case-sensitive. Recommend lower-case.

### 3.6 JSONC parsing

Bun's built-in `JSON.parse` does NOT accept comments — verified
against the engine's existing usage at
`packages/engine/src/AssetPack/AssetPack.ts:25,47` and
`packages/engine/src/AssetPack/ZipAssetPack.ts:44`. The
`PresetResolver` strips comments before parsing.

Implementation: a tiny inlined `stripJsonComments(text)` helper that
walks the string character-by-character, dropping `//`-to-EOL and
`/* */` runs while preserving strings (including escapes). NO npm
dep — keep the engine surface clean. Trailing commas are also
permitted by the stripper (a follow-on lexer pass) since the
modder-friendliness intent extends to "forgot the comma after the
last entry." About 60 LOC.

---

## 4. Data format spec — scene files

### 4.1 Compact ID map (Tiled `firstgid` pattern)

A scene declares an `idMap` once at the top, then every grid cell is
a small int that resolves through it:

```jsonc
{
  "spawn": { "x": 32.5, "y": 58.0, "facing": 0 },

  "idMap": {
    "0": null,            // 0 always means "no tile / open / use layer default"
    "1": "brick.wall",
    "2": "brick.parapet",
    "3": "_a8f3c2d1",     // anonymous — generated by the editor + collapsed by build
    "4": "wood.floor",
    "5": "stone.ceiling",
    "6": "door.heavy"
  },

  "walls": [
    [1, 1, 1, 1, 1, 1, 1, 1],
    [1, 0, 0, 0, 2, 0, 0, 1],
    [1, 0, 6, 0, 0, 0, 3, 1],
    [1, 1, 1, 1, 1, 1, 1, 1]
  ],

  "floors": [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 4, 4, 4, 4, 4, 4, 0],
    [0, 4, 4, 4, 4, 4, 4, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],

  "ceilings": [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 5, 5, 5, 5, 5, 5, 0],
    [0, 5, 5, 5, 5, 5, 5, 0],
    [0, 0, 0, 0, 0, 0, 0, 0]
  ],

  "entities": [ ... ],
  "lightmap": { ... }
}
```

### 4.2 idMap semantics

- **Index `0` is reserved** for "no tile / use layer default."
  Maps to `null` always — the build refuses to emit any other
  binding for `0`.
- **Indices are scene-local.** Two scenes can use index `5` for
  different presets. Engine resolves each scene's grid through
  THAT scene's idMap.
- **Indices are dense + small.** The build-merge step (§ 8)
  packs them into the minimum width needed. Up to 255 unique
  presets per scene fits in a `Uint8Array`; up to 65535 fits in
  `Uint16Array`. Render-time arrays stay typed-array-backed.
- **One idMap, all layers.** `walls`, `floors`, `ceilings` (and
  future layers) share the same map. A given preset can sensibly
  appear in only one layer (e.g. a `floorHeight` field is only
  read when the preset is used in the `floors` layer), but the
  engine doesn't enforce category-per-layer — presets are typed
  by use, not declaration. This keeps the model simple.

### 4.3 Layer default presets

A scene may declare layer defaults the build uses to populate `0`
cells in `floors` / `ceilings` arrays, so a level designer doesn't
have to fill in 4000 identical floor tiles:

```jsonc
{
  "layerDefaults": {
    "floor":   "wood.floor",
    "ceiling": "stone.ceiling"
  },
  // ... idMap, walls, floors, ceilings ...
}
```

A `0` in the floors grid then resolves to `wood.floor`, not "no
tile." This lets scene files keep their floors grid mostly-zero
even when the level has uniform flooring. `walls` has no layer
default — `0` always means open cell.

### 4.4 Field deprecations

After migration:

- `walls`, `floors`, `ceilings` always carry small-int grids. No
  more inlined `{ tile: 1, ... }` objects in scene files.
- `spawn`, `entities`, `lightmap`, optional `lights` keep their
  existing shapes — unchanged.
- The legacy `tileTextures` + plain-int wall ids still parse via
  the compatibility shim in § 5.3.

---

## 5. Data format spec — manifest changes

### 5.1 New field

`manifest.json` gains an optional `tilePresets` array:

```jsonc
{
  "id": "default",
  "version": "1.0.0",
  "engine": "two_5_d@0.1",
  "tilePresets": [
    "presets/walls.jsonc",
    "presets/doors.jsonc",
    "presets/floors.jsonc",
    "presets/ceilings.jsonc"
  ],
  // ... existing fields ...
}
```

Order matters only for **conflict resolution within one pack**: if
two files declare the same preset ID, the later file in
`tilePresets[]` wins (with a warning). Cross-pack overrides follow
[PACK_CHAIN.md § 7](./PACK_CHAIN.md) — last-pack-in-chain wins per
preset ID.

### 5.2 First-class pack-chain asset

[PACK_CHAIN.md § 7](./PACK_CHAIN.md)'s override-rules table gains a
new row, replacing the existing `tileTextures[id]` entry:

| Asset type | Identity key | Merge / override |
|---|---|---|
| `tilePresets` (resolved entries) | preset ID string | replace (whole preset) |

A pack can therefore declare:

```jsonc
{
  "id": "my-mod",
  "version": "0.1.0",
  "requires": [{ "id": "default-tiles", "version": "^1.0.0" }],
  "tilePresets": ["presets/walls.jsonc"]
}
```

… and override only the few `brick.*` presets it wants to change,
inheriting the rest of `default-tiles`' library.

### 5.3 Backwards compat — `tileTextures` deprecation

Packs predating this plan still ship `tileTextures: { "1": "...",
... }`. The `PresetResolver` synthesises an in-memory preset library
at load time:

```js
// pseudo
for (const [idStr, path] of Object.entries(manifest.tileTextures ?? {})) {
  registerPreset(`__legacy.${idStr}`, { texture: path });
}
```

The legacy compatibility shim in `Scene.fromJSON` then maps bare
int `5` in a wall grid to preset ID `__legacy.5`. Scenes with both
shapes (mixed `idMap` cells AND legacy numeric refs in some grids)
work — `idMap` lookups take precedence, falling back to
`__legacy.${n}` when no `idMap` entry exists.

**Deprecation path**:

- **T1 → T3**: `tileTextures` still works alongside `tilePresets`.
  A console warning fires at pack load: `pack "X" uses legacy
  manifest.tileTextures; migrate to manifest.tilePresets. See
  TILE_PRESETS.md § 11.`
- **T3 onward**: build emits a hard error for any pack that ships
  scenes WITH inlined objects (e.g. `{ "tile": 1, "height": 0.35
  }`) — the editor and the migration script (§ 11) refuse to
  produce them.
- **Post-T5**: `tileTextures` removed entirely. The migration
  script is the contract for backfilling old packs.

### 5.4 Engine version gate

Packs targeting tile presets bump their engine constraint:

```jsonc
"engine": "two_5_d@0.2"   // 0.2 = tile-preset era
```

Older engines that load a `tilePresets`-bearing pack hard-fail
with "engine ^0.2 required" rather than silently mis-rendering.

---

## 6. `PresetResolver` engine design

### 6.1 Module placement

A new module `packages/engine/src/AssetPack/PresetResolver.ts`,
exported from `packages/engine/src/AssetPack/index.ts`. Files
affected at implementation time:

- `packages/engine/src/AssetPack/PresetResolver.ts` — new.
- `packages/engine/src/AssetPack/types.ts` — adds `Preset` +
  `ResolvedPreset` + manifest field.
- `packages/engine/src/AssetPack/AssetPack.ts` — gains `presets():
  Promise<PresetResolver>` alongside `scene()` / `config()`.
- `packages/engine/src/Scene.ts` — `fromJSON` accepts an
  `idMap` + grid arrays and resolves through the
  PresetResolver.
- `packages/engine/src/Game.ts` — builds the resolver once at
  pack load, passes it to scene loading.

### 6.2 API surface

```ts
export interface Preset {
  /** ID this preset was registered under. */
  id: string;
  /** Raw fields as authored, post-`extends` resolution, post-defaults. */
  data: ResolvedPresetData;
  /** Pack id that contributed this preset (for conflict reports). */
  sourcePackId: string;
  /** Source file path inside the pack, for diagnostics. */
  sourcePath: string;
}

export interface ResolvedPresetData {
  texture: string;
  topCap?: string;
  bottomCap?: string;
  offsetX: number;
  offsetY: number;
  wallHeight: number;
  wallStartZ: number;
  partialWall?: { face: "north" | "south" | "east" | "west"; startU: number; widthU: number };
  floorHeight: number;
  ceilingHeight: number;
  reflectiveness: number;
  transition: number;
  riserTexture?: string;
  emissive?: { color: [number, number, number]; intensity: number; areaLight: boolean };
  collision: "solid" | "passable" | "trigger" | "blockBullets";
  ambientOcclusion: boolean;
  displayName?: string;
  tags?: ReadonlyArray<string>;
  thumbnail?: string;
}

export class PresetResolver {
  /** All presets by id. Read-only after `build()`. */
  readonly presets: ReadonlyMap<string, Preset>;
  /** Convenience lookup — undefined if unknown. */
  get(id: string): Preset | undefined;
  /** Resolves an idMap-mapped cell to a flat record. */
  resolveCell(presetId: string | null): ResolvedPresetData | null;
  /** Iterate every preset (editor + tooling). */
  [Symbol.iterator](): IterableIterator<Preset>;
}
```

### 6.3 Lifecycle

```
PackChain load
  │
  ▼
For each pack in chain order:
  parse manifest
  for each path in manifest.tilePresets:
    read text → stripJsonComments → JSON.parse
    for each entry:
      register(id, rawData, sourcePackId, sourcePath)
      LATER-PACK-WINS on collision; emit conflict
  │
  ▼
build():
  for each registered preset:
    resolveExtends(preset)             // § 7
    applyDefaults(preset)
    validate(preset)                    // typo detection; § 10
  freeze map
  │
  ▼
expose as engine.presets and as scene.fromJSON(json, presetResolver)
```

The resolver builds ONCE per pack-chain load. Scene loading is then
a pure id-lookup. The renderer pulls `ResolvedPresetData` records
flat — IDENTICAL shape to what it sees today after the wall-overhaul
in-memory normalisation step. No renderer change.

### 6.4 Engine-side build error reporting

The resolver collects errors into a structured report rather than
throwing on the first failure. `game/main.ts` displays the full
list to the user. The shape:

```ts
interface PresetError {
  packId: string;
  file: string;             // "presets/walls.jsonc"
  presetId?: string;        // when known
  message: string;          // human-readable
  hint?: string;            // typo suggestion, etc.
}
```

Hard errors (cycles, missing required field) abort the pack-chain
load. Soft errors (unknown field with no spelling suggestion, etc.)
log + skip the field.

---

## 7. `extends:` resolution + defaults

### 7.1 Algorithm

```pseudo
resolveExtends(preset, chain = []):
  if preset.id in chain: hard error "preset cycle: a → b → c → a"
  if not preset.data.extends: return preset.data
  parent = registry.get(preset.data.extends)
  if not parent: hard error "preset 'x' extends unknown 'y'"
  parentResolved = resolveExtends(parent, [...chain, preset.id])
  // shallow merge — child fields win field-by-field.
  // partialWall and emissive are merged as opaque sub-objects (child's
  // entire sub-object replaces parent's; no field-level merge inside).
  return { ...parentResolved, ...preset.data, extends: undefined }
```

### 7.2 Chain depth limit

Recommend a **hard limit of 8 levels deep**. Anything beyond
that is almost certainly a misunderstanding (or a cycle the
visit-set didn't catch). In practice modders use one or two levels
(`brick.wall` → `brick.parapet`); 8 is generous insurance.

### 7.3 Defaults table

After `extends` resolution, the resolver fills missing fields:

| Field | Default |
|---|---|
| `offsetX` / `offsetY` | `0` |
| `wallHeight` | `1` |
| `wallStartZ` | `0` |
| `partialWall` | `undefined` (= fills the cell) |
| `floorHeight` | `0` |
| `ceilingHeight` | `1` |
| `reflectiveness` / `transition` | `0` |
| `collision` | `"solid"` for wall presets; `"passable"` for floor/ceiling. Detected by presence of `floorHeight` vs `wallHeight` deviation, OR explicit `category` field if added later. Default `"solid"` is the safest. |
| `ambientOcclusion` | `true` |
| `topCap` / `bottomCap` / `riserTexture` / `emissive` / `displayName` / `tags` / `thumbnail` | `undefined` |

### 7.4 Cycle detection

The recursion-stack `chain` set in § 7.1 handles A→B→A directly.
Equivalent to the pack-chain cycle detection in
[PACK_CHAIN.md § 4](./PACK_CHAIN.md). Tests must cover:
self-extension, two-cycle, three-cycle, extends-missing-target.

---

## 8. Build-merge step

The build-merge collapses anonymous duplicates and rewrites every
scene's idMap to be compact + deterministic. Lives in
`apps/pack-builder/src/build-presets.ts` and runs as part of
`bun run build-packs`.

### 8.1 Pseudocode

```pseudo
buildPack(pack):
  presets = loadAllPresetFiles(pack)        // named + any anonymous already in files

  for each sceneFile in pack/scenes:
    scene = parse(sceneFile)
    // Collect every preset reference in every layer.
    seenIds = new Set()
    for layer in [walls, floors, ceilings]:
      for cell in layer:
        if cell is 0 or null: continue
        if cell is a number: id = scene.idMap[cell]
        else if cell is inline object: id = hashToAnonymous(normalize(cell))
        seenIds.add(id)

    // Anonymous collapse: cells with identical normalized JSON share an id.
    // hashToAnonymous() = "_" + truncate(sha256(JSON.stringify(normalize(obj))), 16chars).
    // Registers the preset into the pack-local anonymous bucket if not present.

    // Rebuild idMap deterministically:
    // 1. Sort seenIds: named first (alphabetical), then anonymous (alphabetical).
    // 2. Assign indices 1..N. (0 stays reserved.)
    // 3. Rewrite each grid to the new indices.
    scene.idMap = { "0": null, ...sortedAssign(seenIds) }
    rewriteGrids(scene, oldIdMap, scene.idMap)

  // Emit a single anonymous-bucket file capturing every collapsed preset.
  write(pack/presets/_anonymous.jsonc, anonymousBucket)
  if "presets/_anonymous.jsonc" not in manifest.tilePresets:
    manifest.tilePresets.append("presets/_anonymous.jsonc")
```

### 8.2 Normalize() — the canonical form

Before hashing, the build serialises a preset's authored JSON into a
canonical string:

1. Resolve `extends` fully (so two anonymous presets that visually
   differ only in their `extends` target still hash the same iff
   their *resolved* content is the same).
2. Drop authoring-metadata fields (`displayName`, `tags`,
   `thumbnail`) — they don't affect rendering, and two cells
   that render identically should collapse even if one has a
   tag set.
3. Apply defaults (so `{texture:"x.png"}` and `{texture:"x.png",
   offsetX:0}` hash identical).
4. Sort object keys lexicographically; recurse for sub-objects.
5. Serialise with no whitespace.

### 8.3 Hash strategy

**SHA-256 truncated to 16 hex chars** (64 bits of entropy).

Justification:

- Birthday-collision probability with 16 hex chars (= 64 bits): a
  pack would need ~4 billion distinct anonymous presets before
  expected collision. Reality: a huge pack might have ~10,000.
  Margin is enormous.
- 16 chars keeps anonymous IDs short enough to skim in an idMap
  (`_a8f3c2d149b07e21`).
- SHA-256 is in Bun's standard `crypto` module — no dep cost.
- Truncation order is least-to-most-significant nibbles — i.e.
  take the first 16 hex chars of the hex digest. Deterministic and
  obvious to re-implement.

Collision behaviour: if the build detects two different normalized
JSONs hashing to the same truncated hash (vanishingly unlikely), it
hard-errors with both source locations. Authors regenerate.

### 8.4 Edge cases

- **Empty preset** (`{}`) — no `texture`, no `extends`. Build error:
  `preset "X": requires "texture" or "extends".`
- **Extends-only preset** (`{ extends: "brick.wall" }`) — legal.
  Resolves identically to its parent; useful for aliasing. The
  anonymous collapse will fold it into the parent's hash if the
  parent has no overrides.
- **Self-extending preset** (`{ extends: "self" }`) — caught by §
  7.4 cycle detection.
- **Preset referenced by no scene** — kept (modders sometimes
  intend a library; deletion would be hostile). Build emits a
  `presets/walls.jsonc: preset "X" defined but unused in any scene
  in this pack` warning.
- **Scene grid index referencing an unmapped id** — `scene.idMap`
  has `"3": "brick.wall"` but no preset "brick.wall" exists. Hard
  error with file + key path.
- **Anonymous preset in a `presets/*.jsonc` file with a leading-
  underscore ID** — legal but discouraged for hand-edited files.
  The build leaves it alone (it's already in canonical form).

### 8.5 Determinism

Same source pack must produce byte-identical `_anonymous.jsonc` and
identical scene `idMap` ordering across runs. Tests cover:

- Run build twice on the same input — outputs match.
- Reorder cells in source scene — anonymous IDs unchanged, idMap
  ordering unchanged (since it's sorted, not insertion-ordered).

---

## 9. Two-tier design — named vs anonymous

| Tier | Author | Lives in | ID form | When created |
|---|---|---|---|---|
| Named | Modder (hand-edited JSONC, OR editor's "promote to named") | Modder-managed `presets/*.jsonc` files | dotted lower-kebab (e.g. `brick.wall`) | At authoring time |
| Anonymous | Editor break-link, OR migration script | Build-emitted `presets/_anonymous.jsonc` | `_{hash16}` | At edit time (transient) → at build time (collapsed) |

The two tiers are **identical to the engine.** `PresetResolver`
sees them as map entries; their tier only affects authoring
ergonomics (where they live on disk + whether a human reads the
ID).

**Lifecycle of an anonymous preset:**

1. User in the editor selects a cell whose preset is `brick.wall`,
   clicks "Break link," nudges `wallHeight` to 0.35. The editor
   creates a new anonymous entry in the in-memory anonymous-bucket
   with a fresh hash-derived ID.
2. The cell's grid value now points to that anonymous ID.
3. The user saves the project. Editor writes the scene out (with
   inline JSON in the cell IF using "live mode" output; OR with the
   anonymous-bucket file IF using "exported" output).
4. `bun run build-packs` runs the merge step (§ 8). Every cell
   with the same normalised JSON merges to one anonymous preset.
   The exported `.apg` ships a `presets/_anonymous.jsonc` file
   alongside the named libraries.

A modder who wants to elevate `_a8f3c2d1` to `dim.brick`: see
"Promote anonymous to named" in [EDITOR.md § 6](./EDITOR.md) — the
editor opens the bucket file, removes the entry, adds it to a named
file under the new ID, and rewrites references.

---

## 10. Hand-authorability checklist

Every constraint below traces back to "a modder must be able to
hand-edit these files in vim or VS Code":

- **JSONC, not JSON.** Comments + trailing commas. § 3.6.
- **`extends:` keyword.** Inheritance lets a modder override one
  field of an existing preset without re-typing everything. § 3.3.
- **Defaults for everything.** Minimum-viable preset is `{
  "texture": "..." }`. § 7.3.
- **Self-documenting field names.** `wallHeight`, `partialWall.face:
  "north"`, `collision: "solid"`. No abbreviations.
- **One file per category convention.** `walls.jsonc`,
  `doors.jsonc`, `floors.jsonc`. Engine doesn't enforce, but the
  default-pack migration (§ 11) lays them out this way as a
  template.
- **Editor-mediated when desired, but never required.** A modder
  can ship a pack with only hand-edited preset files and never run
  the editor. The editor produces the same JSON a human would.
- **Build-time typo detection.** Unknown field names AND unknown
  values for enum fields surface clear errors:

  ```
  presets/walls.jsonc:14: preset "brick.wall": unknown field "textur"
    Did you mean "texture"?

  presets/walls.jsonc:31: preset "brick.parapet": invalid value for
    "collision" — "slid". Allowed: "solid", "passable", "trigger",
    "blockBullets".
  ```

  Implementation: a fixed allowed-keys set + Levenshtein distance
  for suggestions. Distance ≤ 2 = "did you mean," distance > 2 = no
  suggestion. Same for enum value validation.

- **Build refuses to ship a broken preset.** Hard errors abort
  `bun run build-packs` with a non-zero exit; CI catches a broken
  preset pack before publish.
- **Anonymous-bucket file is build-emitted.** Hand-editors NEVER
  touch `presets/_anonymous.jsonc`. The file has a one-line top
  comment: `// AUTO-GENERATED by build-merge. Edits will be
  overwritten. Promote entries via the editor or move them into a
  named file.`

---

## 11. Migration plan

### 11.1 What migrates

The default pack today:

- `packages/default-pack/manifest.json:18-23` — `tileTextures` (4
  entries).
- `packages/default-pack/manifest.json:24-35` — `tileSheets` (one
  entry expanding to 36 tiles, ids 10-45).
- `packages/default-pack/scenes/scene1.json` — 12685 lines, all
  bare-int wall grids.
- `packages/default-pack/scenes/scene2.json` — 36 lines, bare-int.
- `packages/default-pack/scenes/scene_heights_demo.json` — 50
  lines, 5 inlined `WallSegment` cells (lines 12-18) using
  `height`, `topTile`, `bottomTile`, `startZ`, `emissive`.

### 11.2 Mechanical migration script

A one-shot script: `bun run apps/pack-builder/src/migrate-to-
presets.ts <pack-dir>`. Steps:

1. **Generate named presets from `tileTextures`.**

   ```jsonc
   // presets/_legacy_tiles.jsonc (auto-generated; consider renaming after import)
   {
     "tile.1": { "texture": "images/tiles/wall.jpg" },
     "tile.2": { "texture": "images/tiles/wood_floor.jpg" },
     "tile.3": { "texture": "images/tiles/ceiling.jpg" },
     "tile.4": { "texture": "images/tiles/tile_floor.jpg" }
   }
   ```

2. **Generate presets from `tileSheets`.** Expand each sheet entry
   into N presets — preset ID `sheet.{startTileId+i}` per cell,
   with a `texture` referencing the sheet path and a new
   `sheetCrop: { col, row }` field on the preset (added to schema
   in this phase). Or simpler: pre-crop sheets at build into
   individual textures and emit one preset per resulting tile.
   Recommend pre-crop — keeps `Preset.texture` a single path.

3. **For every scene file:**
   - Walk every cell. Collect distinct values.
   - Bare ints → `tile.{n}` (or `sheet.{n}`) preset IDs.
   - Inline structured objects (`scene_heights_demo`'s
     `{ tile: 1, height: 0.35, topTile: 4 }`) → anonymous
     presets via § 8.3 hashing, OR (if it's a one-off the script
     can name) prompt the operator interactively. Recommend
     default to anonymous; operator can rename later.
   - Emit fresh `idMap` + grid arrays per § 4.

4. **Rewrite `manifest.json`:**
   - Remove `tileTextures`.
   - Remove `tileSheets` (replaced by pre-cropped textures).
   - Add `tilePresets: ["presets/_legacy_tiles.jsonc", "presets/
     _legacy_sheet.jsonc"]`.
   - Bump `engine` constraint to `two_5_d@0.2`.

5. **Git diff for review.** Migration is mechanical; the produced
   diff should typecheck and render byte-identical to pre-
   migration. The bake output is a regression test: hash the
   post-migration lightmap against pre-migration. Identical bytes
   = success.

### 11.3 Cutover order

1. Land T1 (data format + resolver). Default pack still uses
   `tileTextures`, loaded via the compat shim. Engine consumers
   read `ResolvedPresetData` either way.
2. Run migration script on default pack. Verify visual + lightmap
   parity. Commit.
3. Land T2 (build-merge step) + tighten the cutover.

### 11.4 Names for the legacy presets

After the script runs, default-pack ships:

```
packages/default-pack/presets/
├── walls.jsonc          ← was tile.1 (brick.wall — single entry)
├── floors.jsonc         ← was tile.2 + tile.4 (wood.floor, tile.floor)
├── ceilings.jsonc       ← was tile.3 (stone.ceiling)
└── sheet_props.jsonc    ← was the 36 sheet tiles, mass-renamed
```

The migration script does the obvious naming (`tile.1` → script
prompts for a friendly name when run with `--interactive`, default
fallback `legacy.tile.N`). A follow-on hand-pass renames + cleans.

---

## 12. Editor authoring UX

Detailed UX lives in [EDITOR.md § 6](./EDITOR.md). This section is
the data-model contract the editor honours, NOT the UX itself.

The editor must:

1. **Read presets at project open.** Load every file in
   `manifest.tilePresets[]`, expose them in the texture / preset
   sidebar.
2. **Paint by preset ID.** Active brush = a preset. Painting writes
   the preset's idMap slot (or creates one).
3. **Inspector reflects preset.** When a cell is selected, the
   inspector shows the resolved preset fields. Toggling
   "Break link from preset" forks the cell into a new anonymous
   preset (a private copy the user can edit).
4. **Drag-drop a preset onto a cell** replaces that cell's preset
   reference.
5. **Promote anonymous to named.** Double-click an anonymous entry
   in the preset list → prompt for a name + target file → editor
   moves the entry, updates references.
6. **"Save preset as…"** on an inline-edited cell creates a named
   preset from the cell's current resolved data + adds it to a
   target `presets/*.jsonc` file.

Editor output on save: scene files with `idMap` + grid arrays
(never inlined cell structs), plus a per-project `presets/
_anonymous.jsonc` for the unmerged anonymous bucket. The build-
merge step (§ 8) consolidates anonymous entries on export.

---

## 13. Phases

### T1 — Data format + resolver + default-pack migration (≈1-2 sessions) — ✅ Shipped (commit `e786c3d`)

- Define `Preset` / `ResolvedPresetData` types in
  `packages/engine/src/AssetPack/types.ts`.
- Implement `PresetResolver` (§ 6) including `extends:` resolution
  (§ 7) + JSONC stripper (§ 3.6).
- Add `manifest.tilePresets[]` to schema; keep `tileTextures` as
  a compat shim (§ 5.3).
- Add `Scene.fromJSON` support for `idMap` + small-int grids
  alongside the existing parsing.
- Ship `apps/pack-builder/src/migrate-to-presets.ts` (§ 11).
- Run migration on default-pack. Lightmap bytes unchanged.

**Done when**: default pack uses `tilePresets` exclusively, scenes
have `idMap`, and `bun run build-packs && bun --cwd apps/game build`
ships a visually-identical game.

### T2 — Build-merge step (≈1 session) — ✅ Shipped (commit `e786c3d`)

- Implement `apps/pack-builder/src/build-presets.ts` (§ 8).
- Wire into `apps/pack-builder/src/build-packs.ts` after manifest
  validation, before zip emit.
- Tests: determinism, collision handling, anonymous collapse,
  unused-preset warning.

**Done when**: a scene that references 50 identical inline cells
collapses to one anonymous preset across two consecutive builds
with byte-stable output.

### T3 — Manifest validation + error messages (≈½-1 session) — ⏳ Pending

- Allowed-keys set + Levenshtein typo detection (§ 10).
- Hard-error on inline cell objects in scenes (the deprecation
  cutover from § 5.3).
- `PresetError` collection + console rendering.
- Update build script exit codes for CI.

**Done when**: a manifest with `textur` (typo) fails build with a
"did you mean texture?" message and a non-zero exit.

### T4 — Editor authoring UX (≈2-3 sessions; cross-references EDITOR.md) — ⏳ Pending (cell-inspector preset workflow queued, agent #198 territory)

- Land the EDITOR.md § 6 surface that produces preset IDs in scene
  grids.
- Implement break-link, drag-drop, promote-to-named, and "save
  preset as…" flows against the data model in this doc.

**Done when**: round-trip — open a `.apg` in the editor, paint /
break-link / promote / save / export — produces an `.apg` byte-
identical to the input modulo the cells the user changed.

### T5 — Preset-library packs (≈1 session) — ⏳ Pending

- A pack that ships ONLY `manifest.tilePresets[]` + the JSONC
  files (no scenes, no scripts, no entities) loads as a valid
  pack-chain entry per [PACK_CHAIN.md](./PACK_CHAIN.md).
- Tests: a downstream pack `requires` a preset-only pack and
  overrides one of its presets. Resolver picks the override.
- Optionally: a `community:` URL pulls a preset-library pack the
  same way it would any other pack.

**Done when**: a third-party `gothic-tiles` pack can be published
to the community store and consumed by a level-pack via
`requires`, with the engine rendering the result correctly.

---

## 14. Open questions

1. **Category vs free-form.** Should `Preset` carry an explicit
   `category: "wall" | "floor" | "ceiling" | "door" | "prop"`
   field? Pro: cleaner default-collision selection, editor pickers
   stratify cleanly. Con: closes the door on cross-category
   reuse (a `decor.glow.strip` preset that's usable as either a
   wall trim or a ceiling trim). Recommend NO — keep presets
   typed by USE, not declaration. Re-evaluate after T4 if the
   editor sidebar gets unwieldy.

2. **`tileSheets` migration.** § 11.2 step 2 recommends pre-
   cropping sheets into individual textures during migration.
   Alternative: keep `tileSheets` as a manifest field and let
   presets reference into them via `sheetTile: { sheet: "props",
   col: 3, row: 2 }`. Pro of pre-crop: simpler preset schema, one
   path per preset. Con: more files in the pack (36 PNGs vs 1
   sheet). Recommend pre-crop for v1 — Bun zip handles many files
   fine. Re-evaluate if pack sizes inflate.

3. **Editor "live JSONC" output.** Does the editor write JSONC
   files with the user's comments preserved across edits, or does
   it overwrite preset files on save (losing comments)? Recommend
   round-trip preservation via a JSONC-aware writer (parse,
   mutate, re-emit while keeping the original AST including
   comments). Implementation is non-trivial; punt to T4 detail
   work.

4. **Cross-scene preset sharing.** Two scenes in the same pack
   reference the same preset. Today they each carry it in their
   own `idMap`. Should the build hoist commonly-shared presets to
   a pack-wide "default idMap" + per-scene "additions only"?
   Probably over-engineering — the per-scene model keeps a scene
   file self-contained, which is the bigger win.

5. **Preset-namespace conflicts across packs.** Pack `A` defines
   `brick.wall`; pack `B` (`requires: A`) overrides `brick.wall`
   intentionally. The override is the win condition. But pack
   `C` (no relation to A or B) also defines `brick.wall` and gets
   loaded after A. Is that a conflict (different intent) or an
   override (same intent)? Recommend: emit a SOFT conflict per
   [PACK_CHAIN.md § 6](./PACK_CHAIN.md) — let the user see the
   override in the Packs panel and disable C if unwanted.
   Authoring norm: prefix preset IDs with the pack ID for
   uniqueness (`my-mod.brick.wall`) when reuse is not intended.

6. **Versioning preset libraries.** Preset library packs are
   regular packs and use semver via the manifest. A breaking
   change to a preset schema field (rename, removal) should bump
   the major. The engine's `tilePresets` schema version is gated
   by `manifest.engine` (§ 5.4). Open question: do we want
   per-preset-file schema versions independent of the pack
   version? Recommend NO — pack semver is sufficient.

7. **Hot reload.** If a modder edits a `presets/*.jsonc` file
   under dev-server HMR, can the engine swap the resolved
   presets at runtime and re-render? Probably yes, via the same
   pack-reload hot path used by scene file edits. Worth a
   follow-on plan note once T1-T3 land.

Decisions deferable to implementation time. Flag any pre-T1
blockers to the user.
