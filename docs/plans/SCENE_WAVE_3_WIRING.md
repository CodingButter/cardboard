# Scene Wave 3 — Data Wiring Plan

The Scene page is visually complete (17 panels through audit-fix). Each
panel currently reads from `scene-fixtures.ts`'s `MOCK_*` arrays and
keeps its own local state. Panels don't communicate — clicking a tool
in ToolPalette doesn't affect what MapCanvas paints, the selected cell
in MapCanvas doesn't surface in CellInspector, etc.

Wave 3 replaces the static mocks with **reactive stores** so the page
actually drives the engine.

The same wiring layer will be applied to every future page, so getting
the architecture right here is critical.

## Constraints

1. **Popout windows must work.** dockview supports popping a panel into
   its own window — separate React tree, separate JS context, separate
   Zustand instance. Cross-panel state must sync across windows.
   See [[feedback-popout-state-sync]].
2. **Persistence per concern.** Some state survives reloads (active
   tool, painted cells, layer visibility), some is ephemeral (cursor
   hover coords, drag previews). Each store picks its own persistence
   model.
3. **Engine integration deferred.** The engine package
   (`packages/engine/`) isn't wired yet. Wave 3 stops at "panels drive
   the editor's own in-memory state"; Wave 4 (or later) feeds that
   state to the engine for rendering.

## Phases

### Phase 3.1 — Cross-window sync utility (foundation)

Build `apps/editor/src/state/sync.ts` exporting:

- `createSyncedStore<T>(name, initial, opts)` — wraps zustand with:
  - `persist` middleware writing to localStorage under `cardboard.sync.<name>`.
  - A `storage` event listener that re-hydrates the store when another
    window writes the same key.
  - A `BroadcastChannel(`cardboard:${name}`)` for ephemeral updates the
    store wants to push but not persist (e.g. hover coords).
- `useEphemeralSync<T>(channel, listener)` — subscribe to ephemeral
  broadcasts without writing to localStorage.
- A typed write-throttling helper for hot paths (cursor tracking).

Validate by retrofitting `useCommandStore` to use it — the registry
should be visible from every popout.

**Commit:** `editor: state/sync — cross-window sync utility (persist + BroadcastChannel + storage events)`.

### Phase 3.2 — Define stores by concern

Six new stores, one per cross-panel domain:

| Store | Persistence | Scope | Owns |
|---|---|---|---|
| `useToolStore` | localStorage | per-project | activeTool, activeSubTool, activeMode |
| `useBrushStore` | localStorage | per-project | kind, size |
| `useTilePresetStore` | localStorage | per-project | activeId, activeCategory |
| `useLayerStore` | localStorage | per-project | activeId, visibilityMap, order |
| `useSelectionStore` | localStorage (selected cell) + ephemeral (hover) | per-project | selectedCell, hoverCell, position readout |
| `useSceneStore` | localStorage | per-project | cells (sparse map), dims, settings (fog/ambient) |
| `useHistoryStore` | localStorage | per-project | entries, cursor; with apply/undo/redo |
| `useDiagnosticsStore` | ephemeral (live), capped | project-global | log lines, problems |

All stores are scoped by current project id. Loading a different
project swaps the keys.

**Commit:** `editor: state — define wave-3 cross-panel stores (tool, brush, tile-preset, layer, selection, scene, history, diagnostics)`.

### Phase 3.3 — Migrate panels from MOCK to stores

Per panel, swap:
- LS read/write helpers → store hook calls.
- Local `useState` initialized from MOCK → store selectors.
- Command `run` handlers — point at store setters via refs.

Order (by dependency):
1. ToolPalette → `useToolStore`.
2. Brush → `useBrushStore`.
3. TilePresets → `useTilePresetStore`.
4. Layers → `useLayerStore`.
5. SceneSettings → `useSceneStore.settings`.
6. CellInspector → `useSelectionStore` + `useSceneStore.cells`.
7. SelectionInfo → `useSelectionStore` (read-only).
8. QuickTools → `useSelectionStore.tags` (applied to current selection).
9. Output / Problems → `useDiagnosticsStore`.
10. History → `useHistoryStore`.
11. Notes → unaffected (already self-contained).
12. Minimap → `useLayerStore.visibility` + `useSceneStore.cells`.
13. Preview → `useSceneStore` (renders the scene).
14. MapCanvas → all of the above (paints into `useSceneStore`).

Each migration is a separate commit so reverts are surgical.

### Phase 3.4 — Wire MapCanvas painting

The canvas-side of the loop:
1. Mouse down on a cell with `tool === "paint"` and an active tile
   preset → write that cell to `useSceneStore.cells` on the active
   layer.
2. Drag continues painting (rate-limit to cell-grid crossings).
3. Eraser tool → clear cells.
4. Dropper → read the cell's preset and set as active.
5. Fill → flood-fill from the clicked cell.
6. Each paint operation pushes an entry onto `useHistoryStore`.
7. Undo/Redo (Ctrl+Z / Ctrl+Shift+Z) → walks `useHistoryStore.cursor`
   and replays cell mutations.

**Commit:** `editor: MapCanvas — wire painting + erasing + dropper + fill + history`.

### Phase 3.5 — Popout validation

After every migration commit, run the popout test:
1. Pop out each migrated panel.
2. Verify state changes in the popout propagate to the orchestrator.
3. Verify state changes in the orchestrator propagate to the popout.
4. Reload the popout — verify state persists.
5. Close + reopen the popout — verify state is restored.

Captured findings get folded back into the playbook so future pages
inherit the right patterns.

## Pain points to capture (for the playbook)

As Wave 3 progresses, document anything that's harder than expected:
- Did the MOCK fixture shape match the eventual store selectors?
  (If not, future pages should design fixtures with the store API in
  mind from day one.)
- Did any panel need refactoring beyond the LS→store swap? (Indicates
  the panel was over-coupled to the fixture.)
- Did popout sync introduce surprising latency? (Inform the
  ephemeral-vs-persistent decisions.)
- Were any command runs racing with state updates? (Suggests we need
  a command-queue or transactional dispatch.)

Update `docs/process/PAGE_BUILD_PROCESS.md` with any process improvements.

## Out of scope for Wave 3

- Engine integration (Wave 4).
- Real prefab definitions wired to the engine (Wave 4).
- Multiplayer sync (separate plan, `docs/plans/MULTIPLAYER_PLAN.md`).
- Pack chain loading (separate plan, `docs/plans/PACK_CHAIN.md`).
