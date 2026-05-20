# Session State — 2026-05-20 handoff

A handoff snapshot for the next Claude instance picking up this work.
**Read this file, then `.claude/memory/MEMORY.md`, then
`docs/plans/EDITOR_ENGINE.md` — that's the architectural north star.**

## Where main is right now

Branch `main` at commit **`2558489`** — pushed to origin, tree clean.
The last 10 commits in chronological order:

```
2558489  editor: wave 3.4 — MapCanvas painting + undo/redo replay
72e6e1c  editor+sidecar: peerjs proper ESM import (fixes Pages production bundle)
3648dce  chore: rebuild Cardboard.apg pack
e318474  editor+sidecar: D10b desktop pairing modal + sidecar Pages build
dff2245  editor: tile-texture rendering on Map/Mini/Preview (real sprites)
f87f5ca  docs+memory: EDITOR_ENGINE plan doc + dogfooding principle
8c94e13  editor: render cells by tile-preset color (replaces flat layer fill)
8326b24  docs+chore: delete 6 stale docs + clean every soft-ref to point at git log
56ddd03  editor: hydrate Zustand stores from IDB on project-load (P0 regression fix)
ad12c70  docs: reorg content updates + LIGHTING merge + new 2026-05-19 audit
```

## What just landed (since the 2026-05-19 snapshot)

### Scene Wave 3 is functionally complete

- **3.3** — all 14 scene panels migrated off `MOCK_` fixtures onto the
  eight Zustand stores. Audit-then-fix loop pattern (per
  `feedback_audit_then_fix_loop.md`).
- **Hydration fix** — `apps/editor/src/state/hydration.ts` bridges IDB
  → Zustand on project-load. Reads scene manifest + `scene1.json`,
  walks walls/floors/ceilings grids, populates
  `useSceneStore.cells/dims/settings` + `useLayerStore` +
  `useTilePresetRegistryStore`. Uses scene-level `idMap` for
  int→preset-id resolution. **This was the root cause of the
  "empty map after Wave 3.3" P0 regression** — loading a pack only
  wrote to IDB, never refreshed Zustand.
- **Tile-preset color rendering** — `useTilePresetRegistryStore`
  separates the read-only preset registry from the UI-selection
  store. MapCanvas + Minimap + Preview render cells by
  preset color/texture, not flat layer fill.
- **Tile texture rendering** — `tileTextureCache.ts` (async loader
  + sync getter + de-dup). Cache map values: `ImageBitmap | null`
  (null = known-failed → no retry storm). `texturesEpoch` on the
  registry triggers reactivity when bitmaps finish loading.
- **3.4** — MapCanvas painting + undo/redo replay (`2558489`):
  - `useSceneStore.paintCells/eraseCells` bulk actions — single
    `set` callback folding N writes into one cells-record
    replacement. **One stroke = one storage event regardless of
    stroke length.** Critical for popout sync.
  - `historyDispatcher.ts` — `applyEntryUndo/Redo` + `undoOnce/
    redoOnce`. Batches reverse-dispatch into one paintCells +
    one eraseCells call.
  - `MapCanvasPanel.tsx` paint state machine: `paintDragRef`
    locks `layerId` + `presetId` at mousedown (layer changes
    mid-drag don't split stroke). `stampBrush` uses
    `footprintCells` (point / square / circle / line / rect).
    BFS 4-connected flood-fill. Dropper reads topmost layer
    preset. Undo/redo wired through dispatcher.
  - 9 passing unit tests in `historyDispatcher.test.ts`.

### Sidecar PWA + D10/D10b pairing

- `apps/editor/sidecar/` — cold-launch QR scanner + identity wizard +
  service worker + Tailwind. Routes from `/sidecar/?desktop=<peerId>`.
- `desktopPairingSingleton.ts` — non-serializable Peer +
  DataConnection live outside Zustand (can't go in `createSyncedStore`).
- `PairDeviceModal.tsx` — qrcode lib + copy-URL fallback +
  connected-state body showing sidecar identity.
- `scripts/build-sidecar-for-docs.ts` — 5-step pipeline (bun build +
  Tailwind CLI + sw.ts transpile + manifest copy + stage to
  `apps/docs/public/sidecar/`).
- **PeerJS tree-shake bug fix** — switched from side-effect
  `import "peerjs/dist/peerjs.min.js"` to proper
  `import { Peer } from "peerjs"`. Required installing peer deps:
  `peerjs-js-binarypack`, `webrtc-adapter`, `@msgpack/msgpack@^2.8.0`
  (pinned 2.x because peerjs wants 2.x). Verified 175 peerjs symbols
  in production bundle.

### Architectural decisions (large)

A long architecture conversation produced multiple project memories
and one plan doc:

- `docs/plans/EDITOR_ENGINE.md` — synthesis. Two engines (Game +
  Editor) on one pack-chain. Shell vs pack scoping rules. Dock-type
  catalog. JSON composition. Pack-bundled libraries. Phased
  migration plan ending in Performance Profiler demo pack milestone.
- `docs/plans/REMOTE_DOCK_QR.md` — heavy iteration. Sidecar PWA +
  PeerJS architecture. Three pairing paths. Device identity
  (name+color+icon). Drag-to-device-icon UX. Game-as-dock.
  `container-dockview`. Sketchfab-style overlay.

New project memories (in `.claude/memory/`):

- `project_dogfooding_principle.md` — shell ships ONLY primitives +
  Tailwind defaults + Zustand sync + IDB + pack-chain loader +
  extension manager. Everything else is a pack, including the
  editor.
- `project_editor_package_injection.md` — bridge pack the editor
  injects into the user's chain at dev-time. Hot-reload +
  remote-dock + live-on-device testing. Tree-shaken out of prod
  builds.
- `project_idb_source_of_truth.md` — IDB holds project data; asset/
  content stores are reactive views over `EditorProjectStore` +
  `IdbAssetPack`, NOT LS-persisted Zustand.
- `project_prefabs_declarative_assets.md` — prefabs are JSON files
  declared in the pack manifest. Runtime modAPI is read + spawn
  only; no `registerPrefab` in modAPI.
- `project_remote_dock_via_qr.md` — phones/tablets are companion
  surfaces hosting touch-friendly variants of mountable panels.
- `project_dnd_day_one.md` — cross-window drag-and-drop is
  foundational; scaffold BEFORE Wave 3.3 panel migrations so panels
  are DnD-aware from the start. Plan at
  `docs/plans/CROSS_WINDOW_DND.md`.

### Doc audit (2026-05-19)

`8326b24` deleted 6 stale docs (MATERIALS, MONOREPO_PLAN,
PREFABS_EDITOR_ONLY, AUDIT_2026-05-16, EDITOR_DOCK_EVALUATION,
EDITOR_UI_AUDIT). 51 files cleaned of soft-refs to point at git log.
Operating principle: "more recent docs trump older ones with
conflicting information."

## Where Wave 3 is in the plan

Phases per `docs/plans/SCENE_WAVE_3_WIRING.md`:

- ✅ **3.1** — sync utility foundation
- ✅ **3.2** — define 8 stores
- ✅ **3.3** — migrate all 14 panels off MOCK_ fixtures
- ✅ **3.4** — MapCanvas painting + undo/redo replay
- ⏳ **3.5** — popout validation **(AUDIT in flight as of this snapshot)**

The Wave 3.5 audit agent is running a Playwright sweep checking:
- Storage event count per stroke (must be exactly 1)
- Cross-window paint sync
- Tool/selection/layer/tile-preset sync
- History replay across windows
- Hydration consistency

Outcome dictates whether a 3.5 FIX agent dispatches next, or 3.5
closes green.

## Architectural pivot ahead

Once Wave 3.5 lands, the "make sure things actually work" runway is
complete and the architectural pivot starts. Per
`docs/plans/EDITOR_ENGINE.md`, the rough sequence is:

1. **Pack-bundled libraries with hash dedup** — pack manifest
   declares npm deps; pack-builder bundles them at dev-time;
   pack-chain loader dedupes by content hash. Offline-first; no
   in-browser bundling.
2. **Core Editor Pack extraction** — move `apps/editor/src/views/`
   + `panels/` + page chrome to `packages/core-editor-pack/`.
   `apps/editor/` shrinks to the shell.
3. **JSON panel composition Phase 1** — wire the JSON spec format
   (store-path bindings like `"store.scene.cells[selected].name"`).
4. **JSON panel composition Phase 2** — migrate panels from `.tsx`
   to JSON manifests.
5. **JSON panel composition Phase 3** — visual builder for panels.
6. **Editor Settings → Extensions tab** — install / enable /
   disable editor packs.
7. **Milestone** — Performance Profiler demo pack: a third-party
   pack that ships a panel, contributes commands, registers a
   diagnostics source, and works in popouts. Proof by
   construction.

Task IDs #19 (core editor pack), #20 (library bundling), #21–#23
(JSON composition phases), #24 (Performance Profiler milestone)
track these.

## Other open tasks (post Wave 3.5)

- **#8** — Doc audit for modAPI vs editor-only concepts.
- **#9** — Cross-window command dispatch.
- **#16** — Sidecar QR drag target + Pair new device modal polish.
- **#17** — Preview engine-rendered toggle + fly/god controls
  (preview is currently a flat canvas render — long-term it should
  be an iframe to the game app with editor-only pack loaded, per
  the user's "it just ends up being its a iframe" framing).
- **#18** — Editor Settings → Extensions tab.
- **#25** — Investigate dockview/ResizeObserver feedback loop
  (panel grows unbounded; non-blocking ergonomic bug; predates
  Wave 3.4).

## What NOT to do

- Don't use `isolation: "worktree"` on Agent dispatches.
  WSL VHDX corrupts.
- Don't put native `title=` attributes — use the `Tooltip`
  primitive. Progressive stages (2s short label, 5s full
  description), portal rendering, `wrapperClassName` for flex-fill.
- Don't bypass `registerCommand` for new actions or `registerSetting`
  for new settings.
- Don't write to `MOCK_` fixtures — they're retired. Use store
  hooks.
- Don't add per-cell paint loops back — bulk actions are required
  for popout sync to scale.
- Don't import `peerjs/dist/peerjs.min.js` as a side-effect import.
  Tree-shakes in production. Use `import { Peer } from "peerjs"`.
- Don't push to main without committing through the harness with a
  Co-Authored-By trailer.

## The dev server

Default port 3001. Restart if needed:

```bash
cd apps/editor
nohup bun dev > /tmp/cardboard-dev.log 2>&1 &
```

If 3001 is busy use 3010-3099 range per
`feedback_agent_dev_server_ports.md`.

## The deploy

GH Pages deploys via `.github/workflows/docs.yml` only.
`build-sidecar-for-docs.ts` stages the sidecar PWA into
`apps/docs/public/sidecar/`. Pages CSS verified healthy (210KB
Tailwind v4.3.0, 200 OK) — if the user reports "no styling" again
it's almost certainly browser/SW cache; hard-refresh → unregister
SW → clear site data.

## Memory rules to read first

`.claude/memory/MEMORY.md` is the canonical index. The Wave 3
pickup priorities are:

- `feedback_popout_state_sync.md`
- `feedback_voice_carries_content.md`
- `feedback_text_for_remote_sessions.md`
- `feedback_audit_then_fix_loop.md`
- `feedback_command_registry_required.md`
- `feedback_no_worktrees.md`
- `feedback_wave_merge_gate.md`
- `project_dogfooding_principle.md`
- `project_idb_source_of_truth.md`
- `project_editor_package_injection.md`
- `project_remote_dock_via_qr.md`

## How to verify state on pickup

```bash
git pull origin main
git log --oneline -3
# expected: 2558489 ... wave 3.4 — MapCanvas painting + undo/redo replay

git status
# expected: clean tree (modulo .envrc + this file if mid-edit)

cd apps/editor && bun run typecheck
# expected: tsc --noEmit clean

bun test src/state/historyDispatcher.test.ts
# expected: 9 pass, 0 fail
```
