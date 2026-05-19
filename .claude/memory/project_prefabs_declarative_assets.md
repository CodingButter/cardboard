---
name: project-prefabs-declarative-assets
description: Prefabs are declarative JSON assets, not editor-only and not code-registered. Each prefab is its own JSON file, declared in the pack manifest like any other asset. The modAPI exposes READ + spawn operations, not registration.
metadata:
  type: project
---

Prefabs are a **runtime concept**, not an editor-only one. They exist
to support gameplay primitives like entity spawners, projectile
factories, loot tables — any "instantiate one of these" pattern.

**Shape:** each prefab is a self-contained JSON object in its own file
(e.g. `prefabs/goblin.json`), with the prefab's components, default
field values, sprites, scripts attached, etc. The pack manifest lists
prefab assets alongside textures, sounds, scripts, etc.

**Why declarative, not code-registered:**

- **Mod-friendly.** Authors can ship a prefab by dropping in a JSON;
  no script required.
- **Editor-authorable.** The editor's prefab browser writes/edits these
  JSONs through `EditorProjectStore` → IDB. See
  [[project-idb-source-of-truth]].
- **Pack export gets them for free.** A prefab is an asset; the existing
  pack export pipeline bundles it.
- **Hot-reload during play.** Change JSON → IDB write → runtime
  invalidation → live update.
- **One mental model.** Scripts, textures, sounds, prefabs all flow
  through the same asset surface (manifest entry → IDB row →
  `IdbAssetPack` read).

**modAPI surface (what's correct):**

- `api.prefabs.list(): PrefabRef[]`
- `api.prefabs.get(id): PrefabDef | null`
- `api.prefabs.spawn(id, position, overrides?): EntityId`

**What's NOT correct:** a runtime `registerPrefab(def)` function. If
that appears in the modAPI (e.g. surfaced by `gen:api` from `packages/
engine/src/ModAPI/`), it's either:

1. **Vestigial** — left over from a script-first design. Should be
   removed.
2. **A dynamic-prefab escape hatch** — runtime-only prefabs minted from
   script code, never persisted. Has a real use case (procedural
   content) but blurs the declarative line. Default position: don't
   ship it unless a concrete script use case demands it; if it stays,
   rename to something like `api.entities.createTemplate()` so the
   "prefab = declarative asset" naming convention is preserved.

**Wave-3 DnD plan alignment:**

The cross-window DnD plan at `docs/plans/CROSS_WINDOW_DND.md` already
treats `prefab` as a `SemanticAssetKind`. The integration matrix has
the prefab browser as a drag source and the scene tree as a drop
target (drop → instantiate). The `useAssetStore` resolves prefab refs
from IDB on drop. So this design is fully consistent with what just got
architected — no rework needed on the DnD side.

**Doc audit task ([[#8]]) is the next checkpoint:** confirm what
`registerPrefab` actually does in the current modAPI source, decide
remove vs rename, and clean the docs.
