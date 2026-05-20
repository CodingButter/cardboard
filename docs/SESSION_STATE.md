# Session State — 2026-05-19 handoff

A handoff snapshot for the next Claude instance picking up this work.
**Read this file, then `MEMORY.md` (in your auto-memory), then
`docs/plans/SCENE_WAVE_3_WIRING.md` — that's the full context.**

## Where main is right now

Branch `main` at commit **`7ede196`** — pushed to origin, tree clean.
The last 5 commits in chronological order:

```
7ede196  editor: state — define wave-3 cross-panel stores (8 stores on sync utility)
8e748a0  ci: retire deploy-editor.yml; docs.yml is the sole Pages deploy
f542803  editor: state/sync — cross-window sync utility
e357f72  docs: SCENE_WAVE_3_WIRING — plan doc for cross-panel data wiring
9c818b9  editor: MapCanvasPanel — align grid lattice with cell boundaries (v1 — needs follow-up)
```

## What just landed

**Phase 3.2 of Scene Wave 3 — eight cross-panel stores** built on top of
the cross-window sync utility from `apps/editor/src/state/sync.ts`:

- `useToolStore` (LS) — activeTool, activeSubTool, activeMode
- `useBrushStore` (LS) — kind, size, sizeUp/sizeDown
- `useTilePresetStore` (LS) — activeId, activeCategory
- `useLayerStore` (LS) — activeId, visibility, order, customLayers
- `useSelectionStore` (LS + broadcast) — selected (persist) + hover/cursor (throttled ephemeral)
- `useSceneStore` (LS partialize) — dims, cells (sparse map), settings
- `useHistoryStore` (LS partialize, cap 100) — entries, cursor
- `useDiagnosticsStore` (in-memory + broadcast) — log lines cap 500

Stores are exposed under `window.__cardboard.stores.*` in dev for
Playwright cross-tab verification (see `apps/editor/index.tsx`).

## Where Wave 3 is in the plan

Phases per `docs/plans/SCENE_WAVE_3_WIRING.md`:

- ✅ **3.1** — sync utility foundation (`f542803`)
- ✅ **3.2** — define 8 stores (`7ede196`)
- ⏳ **3.3** — migrate panels off MOCK_ fixtures (NEXT)
- ⏳ **3.4** — wire MapCanvas painting + undo/redo
- ⏳ **3.5** — popout validation

## Immediate next steps

### 1. Re-dispatch the MapCanvas grid v2 fix (P0 user-facing bug)

User reported AFTER `9c818b9` landed that the visual grid lines appear
to cut through the **center** of cells instead of sitting on the
**boundaries** between them. A v2 fix agent was dispatched but killed
by a Docker/VSCode crash before any code changes saved.

Likely root cause to investigate:
- Loop bounds off-by-one (drawing N lines instead of N+1 boundaries).
- Index math using `colEdges[c]` for line position when it should
  iterate `0..=dims.w` (inclusive).
- DPR scaling drift between cell paint math and stroke math.

### 2. Wave 3.3 — migrate panels off MOCK_ fixtures

14 panels to migrate, one commit per panel for surgical reverts. Order
per the plan doc:

1. ToolPalette → `useToolStore`
2. Brush → `useBrushStore`
3. TilePresets → `useTilePresetStore`
4. Layers → `useLayerStore`
5. SceneSettings → `useSceneStore.settings`
6. CellInspector → `useSelectionStore` + `useSceneStore.cells`
7. SelectionInfo → `useSelectionStore` (read-only)
8. QuickTools → `useSelectionStore.tags` (applied to current selection)
9. Output / Problems → `useDiagnosticsStore`
10. History → `useHistoryStore`
11. Notes — unaffected (self-contained)
12. Minimap → `useLayerStore.visibility` + `useSceneStore.cells`
13. Preview → `useSceneStore` (renders scene)
14. MapCanvas → all of the above (paints into `useSceneStore`)

The `scene-fixtures.ts` file stays in place during this phase — stores
seed from it on first run, and panel code stops importing it directly.

### 3. Wave 3.4 — wire MapCanvas painting

After all panels migrated, wire the canvas-side paint loop:
- Mouse down with `tool === "paint"` + active tile preset → write to
  `useSceneStore.cells` on active layer.
- Drag continues painting (rate-limit by cell-grid crossings).
- Eraser / dropper / fill tools.
- Each op pushes onto `useHistoryStore`.
- Ctrl+Z / Ctrl+Shift+Z walk cursor and replay inverse mutations.

### 4. Wave 3.5 — popout validation

For each migrated panel: pop out, verify state syncs both directions,
verify reload persistence. Capture pain points back into
`docs/process/PAGE_BUILD_PROCESS.md`.

## Pending tasks queue (post Wave 3)

- **#26 (re-opened in spirit)** — MapCanvas grid v2 fix.
- **#28** — Chip strip narrow-width dominance affects both TilePreset
  and EntityList panels. At very narrow widths the chip strip eats
  vertical space and hides the list below. Defer until after Wave 3.
- **Prefabs page polish** — paused for Wave 3 pivot. Resume after Wave 3
  lands.
- **Other pages** — Components / Assets / Scripts / Animation / Image
  Lab / Sound Lab / UI Builder / Project. Apply the playbook
  (`docs/process/PAGE_BUILD_PROCESS.md`).

## Architectural context the next agent must know

### The cross-window sync constraint (Wave 3 foundation)

dockview supports popping panels into their own browser windows. That
means a popped-out panel runs in a SEPARATE JS context — vanilla
Zustand stores diverge across windows. Wave 3 was designed from day
one to handle this:

- `createSyncedStore` from `apps/editor/src/state/sync.ts` wraps every
  store with `persist` (localStorage) + a `storage` event listener
  that re-hydrates from other windows' writes.
- For ephemeral state (cursor coords, hover highlights), the sync
  utility exposes a `BroadcastChannel` per store. Use `throttle()`
  from sync.ts for hot paths.

Read `feedback_popout_state_sync.md` in MEMORY before doing any Wave 3
work. The wiring layer MUST work when panels are popped out.

### Shared panels across all pages

Every page should register the canonical shared panels (Output,
Problems, Notes, History, AssetReferences) so they're available via
the Docks modal on any page. Phase 3b of the page-build playbook
covers this. Scene already has them all; future pages need this baked
in.

### Engine + pack context

Cardboard is a **Wolfenstein-style raycaster** (see
`packages/engine/`). Prefabs are billboard sprites, NOT 3D meshes.
EntityPreviewPanel currently renders cubes which is wrong but
explicitly deferred to Wave 3 — the placeholder will get torn out when
real sprite assets land.

## How to verify state on pickup

```bash
# 1. Pull
git pull origin main

# 2. Verify HEAD
git log --oneline -3
# expected: 7ede196 ... wave-3 cross-panel stores

# 3. Verify clean
git status
# expected: nothing to commit, working tree clean

# 4. Verify typecheck
cd apps/editor && bun run typecheck
# expected: $ tsc --noEmit  (no errors)

# 5. Start dev server (if not running)
cd /home/codingbutter/development/cardboard/apps/editor
nohup bun dev > /tmp/cardboard-dev.log 2>&1 &

# 6. Verify stores in the running editor (browser DevTools console)
# > window.__cardboard.stores.tool.getState()
# Should print the tool store state with activeTool, activeSubTool, activeMode.
```

## Memory rules to read first

These rules in `~/.claude/projects/-home-codingbutter-development-cardboard/memory/`:

- `feedback_popout_state_sync.md` — Wave 3 must work in popped-out windows
- `feedback_voice_first_response.md` — every response opens with TTS
- `feedback_voice_carries_content.md` — voice carries substance
- `feedback_text_for_remote_sessions.md` — text always accompanies voice
- `feedback_tts_questions.md` — AskUserQuestion paired with TTS
- `feedback_wave_merge_gate.md` — never dispatch new wave until previous merged
- `feedback_no_worktrees.md` — main checkout only (VHDX corruption risk)
- `feedback_audit_then_fix_loop.md` — per-panel polish goes through 2-agent loop
- `feedback_page_layouts_and_shared_docks.md` — every page needs predefined layouts + shared panels
- `feedback_command_registry_required.md` — every action registers via registerCommand
- `feedback_progressive_tooltips.md` — 1s short label, 3s long description
- `feedback_no_horizontal_scroll_for_categories.md` — category strips wrap, never scroll
- `project_raycaster_billboard_prefabs.md` — engine context

If the memory files aren't present on this machine, check
`.claude/memory/` in the repo root — there's a portable mirror
committed to the repo (selective gitignore allows it).

## What NOT to do

- Don't use `isolation: "worktree"` on Agent dispatches. VHDX corrupts.
- Don't put native `title=` attributes — use the `Tooltip` primitive.
  It has portal rendering, stage delays, and a `wrapperClassName`
  prop for flex-fill cases.
- Don't bypass `registerCommand` for new actions.
- Don't write to MOCK_ fixtures from Wave 3 panels — use the store
  hooks instead.

## The dev server

Should be running on port 3001. If it's down, restart with:

```bash
cd /home/codingbutter/development/cardboard/apps/editor
nohup bun dev > /tmp/cardboard-dev.log 2>&1 &
```

## The deploy

GH Pages now deploys ONLY via `.github/workflows/docs.yml`. The
`deploy-editor.yml` workflow was retired (`8e748a0`). Path filters
trigger on `docs/`, `apps/docs/`, `apps/editor/`, `apps/game/`,
`packages/`, and the staging scripts.
