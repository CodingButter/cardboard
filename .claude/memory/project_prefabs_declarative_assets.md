---
name: project-prefabs-declarative-assets
description: Prefabs are editor-only authoring assets. The engine has zero runtime prefab API — scenes ship pre-flattened in scene.entities[] and pack scripts spawn via the bare ECS (api.world.spawn() + api.world.add(...)).
metadata:
  type: project
---

Prefabs are an **editor-only** concept. The engine knows nothing
about them at runtime — scenes ship every entity pre-flattened in
`scene.entities[]`, and `Game.spawnSceneEntities` instantiates each
record via the bare ECS path (`world.spawn()` + `world.add(e, C,
value)` for each component on the record). The editor is the
canonical authoring surface; prefab definitions live in the pack
manifest and the editor's IDB-backed `EditorAssetPack` writes them
through the pack's asset pipeline.

**What's actually on the runtime ModAPI** (verified against
`packages/engine/src/ModAPI/types.ts` 2026-05-20):

- No `api.prefabs.{list, get, spawn}` — the field doesn't exist.
- No `api.registerPrefab(name, factory)` — removed.
- No `api.registerDeclarativePrefab(name, decl)` — removed.
- No `api.spawn(name, opts?)` — removed.

Pack scripts that need to spawn entities call the bare ECS:

```js
const e = api.world.spawn();
api.world.add(e, api.components.Position, new api.Vec2(x, y));
api.world.add(e, api.components.Sprite, { imageId: "imp" });
```

…wrapped in a pack-local helper if the call repeats. The
`scene.entities[]` array is the authoritative spawn list — the
editor's prefab browser flattens prefab references into entity
records at pack-export time so the runtime never sees a prefab id.

**Editor SDK is a different layer.** The editor app has its own
`prefabConverter.ts` for migrating legacy pack-script
`registerPrefab` calls into the editor-asset format. That tool is
editor-side TypeScript, not part of the runtime modAPI — pack
scripts at runtime have no way to call into it.

**Cross-references:**

- Runtime ModAPI: `packages/engine/src/ModAPI/types.ts`
- Auto-generated TypeDoc: `apps/docs/content/docs/api/interfaces/ModAPI.mdx`
- Prefabs-editor-only plan: see the prefabs-editor-only phases (PE1–PE3),
  shipped 2026-05-17 — referenced in `docs/PLAN.md` §7 phase table.
- Entity spawn example: `types.ts:36-56` (the `spawnImp` JSDoc example).

## Updated 2026-05-20 — original prediction was wrong; verified against types.ts.

The earlier version of this memory predicted a runtime `api.prefabs.{
list, get, spawn }` surface. That surface never landed. Engine has
zero runtime prefab API — verified by reading
`packages/engine/src/ModAPI/types.ts` end-to-end. The "prefab" word
in pack tooling means "editor authoring asset" exclusively.
