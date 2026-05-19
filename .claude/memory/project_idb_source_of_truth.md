---
name: project-idb-source-of-truth
description: IndexedDB is the source of truth for project data. Projects extract into IDB on load; pack export and playtesting both read from IDB. Asset/scene/script stores must be reactive views over IDB, not LS-persisted Zustand.
metadata:
  type: project
---

The cardboard editor uses **IndexedDB (IDB)** as the canonical store for project data — not localStorage and not in-memory state.

Key facts (told to me 2026-05-19):

- Projects get **extracted into IDB** on load (from a pack/zip/source format).
- IDB is the live source of truth — when the user paints, edits scripts, or tweaks an entity, those writes must land in IDB.
- **Pack export** reads from IDB to produce the shipped artifact.
- **Playtest** reads from IDB to load the runtime scene.

**Why this matters for state design:**
- LocalStorage has a 5–10 MB limit per origin — inadequate for project assets (scripts, sprites, audio, baked lightmaps, FBX, etc.). LS-backed Zustand stores can hold UI state (active tool, brush size) but NOT asset content.
- The current 8 Wave-3 stores ([[feedback-popout-state-sync]]) are correctly LS-backed because they hold UI state and scene cell *deltas*, not asset bytes. Don't confuse "synced Zustand store" with "asset storage" — they're different layers.
- Any planned **`useAssetStore`** (e.g., for the DnD subsystem at [[project-dnd-day-one]]) must be a **reactive view over IDB**, NOT a `createSyncedStore`. The IDB layer fans out change notifications via BroadcastChannel (or storage-event analog) so popped-out windows refetch.

**Existing IDB layer in the repo (verified 2026-05-19):**
- `apps/editor/src/lib/EditorProjectStore.ts` — main editor-side IDB API (likely the integration point).
- `packages/engine/src/AssetPack/IdbAssetPack.ts` — engine-level asset pack contract; runtime reads from this.
- `packages/engine/src/Procedural/IDBCache.ts` + `packages/engine/src/ProceduralAudio/IdbCache.ts` — caches for generated content.
- `apps/editor/src/state/useFileIndex.ts` — UI state reading from IDB (example of existing reactive pattern).
- `apps/editor/src/lib/importPack.ts` — extraction path (project → IDB).

**How to apply:**
- When designing a new asset/script/scene-content store, default to "IDB-backed with BroadcastChannel for cross-window invalidation," not "LS-backed Zustand."
- When wiring DnD payloads, the payload references an IDB record by id/path; the drop handler reads from IDB to resolve.
- When migrating a Wave-3.3 panel that touches content (Assets, Prefabs, ScriptEditor, SceneTree), check whether its data lives in IDB and route reads/writes through `EditorProjectStore` — not through a new LS store.
- Engine-side reads (playtest, export) MUST work without the editor running — so the IDB contract is owned by the engine package, and the editor's view layer adapts to it.
