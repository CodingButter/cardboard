# Session State — 2026-05-20 (late) handoff

A handoff snapshot for the next Claude instance picking up this work.
**Read this file, then `.claude/memory/MEMORY.md`, then
`docs/plans/EDITOR_ENGINE.md` (architectural north star), then
`docs/plans/PERFORMANCE_PROFILER.md` (current build target).**

## Where main is right now

Branch `main` at commit **`39a210c`** — pushed to origin, tree
clean. Today's session shipped 26+ commits (see "What just landed"
below). The Performance Profiler build agent is currently in
flight; when it lands the count will jump again.

## What just landed today (2026-05-20)

### Bug fixes (early session)

- `861bf42` — modals — z-index bumped above dockview's `z-index:
  999` sash/drop overlays (user reported drag-handles activating
  through modal backdrop).
- `7db84d0` — required `category` on every `DockPanelDef` +
  `PanelSpec`; DocksModal renders grouped cards under Tools /
  Viewport / Scene / Inspector / Browse / Diagnostics headers.
  24 panel MANIFESTs updated.
- `ee165aa` — Wave 3.5 audit fixes: destructive-hydration guard
  (`lastHydratedProjectId` in `hydration.ts`), tile-preset id
  mismatch wired to real registry, Ctrl+Z keybinding moved off
  the opt-in HistoryPanel onto MapCanvasPanel.
- `31828b1` — **Tailwind `@source` directive added for
  `./src/**/*.{ts,tsx}`** in `apps/editor/index.css`. ROOT CAUSE
  of the user's repeated "no styling" reports — dev CSS came
  back at 148KB without editor utilities; now 270KB with them.
  Production was always fine, dev wasn't.

### Memory rules captured

- `feedback_verify_before_asserting.md` — pre-send self-audit
  rule: scan every drafted response for factual claims, verify
  cheap ones, hedge expensive ones. Voice especially.
- `feedback_audits_parallel.md` — audits are read-only by
  nature; never sit idle waiting. Dispatch in parallel with
  other work.

### Editor-engine architectural pivot (mid-late session)

- `aa8013b` — Phase 0 wiring: JSON panel renderer + store-path
  resolver + script-ref invoker + demo route at `?renderer-demo`.
- `a18174c` — wire JSON demo as a real `DockPanelDef`; user
  flagged that the previous wiring was a standalone route, not
  a dockable panel. Renamed `JSON: Selection Info`.
- `6d65b44` — **first editor pack + dynamic loader** (dogfooding
  proof point). `packages/cardboard-editor-pack-demo/` workspace
  shipping `manifest.json` + `panels/selection-info.json`.
  Editor-side `editorPackLoader.ts` walks the manifest, fetches
  panel JSONs from a static route, registers DockPanelDefs at
  startup. Hardcoded `JsonDemoPanel` deleted from MapView.tsx.
- `cc90d80` — load editor pack as a real `.apg` via JSZip. Pack
  shipped as actual zip at
  `apps/editor/public/packs/cardboard-editor-pack-demo.apg`; loader
  uses `ZipAssetPack.loadFromBytes` (same code path as game
  packs); one network fetch instead of N JSON requests.
- `9cac87f` — Editor Settings → Extensions tab. Per-pack
  enable/disable toggle with "Reload to apply" banner. LS-persisted
  store at `cardboard.sync.editor-packs`.
- `39a210c` — **pack-bundled scripts** (THE dogfooding closure).
  Packs ship JS that registers commands at load time via
  `EditorPackContext`. `manifest.scripts[]` schema added.
  Pack-builder bundles `.ts → .js` via Bun.Transpiler.
  Loader dynamic-imports each script via Blob URL + invokes
  default export with the context. **DELETED**
  `demo.selection.clear` registration from MapView.tsx — the
  command now exists in the running editor ONLY because the
  pack script registered it. A third-party pack author has the
  same surface.

### Phase 1b panel migrations (mid session, then user halted)

Five panels migrated to JSON specs before the user correctly
called out that further migrations were practice problems:

- `7682a3d` — SelectionInfo (388 → 171 lines TSX, 251-line JSON
  spec). Renderer gained Tooltip + Icon + Text variant/format
  + Layout extensions + `layer` store in resolver.
- `cfa404b` — ToolPalette (283 → 109). ToggleButton + ScrollRow
  + Layout grid mode + Conditional `equals`.
- `c02f2b5` — Brush (459 → 85). NumberInput + Slider + Button
  `shape:"icon"` + `disabledWhen`. First writable bindings
  (brush.size, brush.kind).
- `c56a6c1` — QuickTools (322 → 105). Zero new node types.
  `ToggleButton.activeWhenContains`, `Conditional.notEmpty`,
  `Text.format:"applyCount"`.
- `7a44fac` — CellInspector (hybrid — 4 rows JSON, 3 rows
  inline TSX pending Repeat/ForEach + dynamic-indexer-depth +
  panel-local-state primitives). Added `Select` node + first
  dynamic-indexer writer (`scene.cells[selected].height`).
  Shell Slider primitive swap (renderer had been emitting raw
  `<input type="range">`).

### Doc cleanup (mid session)

- `4775fcf` — modAPI audit Stream A: PLAN.md §4 rewritten
  (removed registerPrefab/spawn/registerDeclarativePrefab/
  api.inventory dead surfaces, corrected api.anim signature,
  moved api.console out of "Pending", added 9 missing surfaces).
  Per-plan-doc rot cleaned in ENGINE_PACK_SPLIT / ANIMATIONS /
  MULTIPLAYER_PLAN / EVENTS / CONSOLE.
- `698c8ab` — modAPI audit Stream B: concepts.mdx +
  writing-your-first-pack.mdx + modapi-cookbook.mdx rewritten
  off removed surfaces.
- `cb443ab` — engine source comment rot: PackManifest.prefabs
  JSDoc no longer references the removed `api.spawn`.
- `363c822` — manifest-shape MDX audit: tutorial guides taught
  retired `manifest.items[]` + `manifest.defaultInventory`;
  rewritten to current PackManifest shape.

### Planning (this session)

- `ae5f296` — `docs/plans/PERFORMANCE_PROFILER.md` (975 lines).
  Complete implementation blueprint for the proof-by-construction
  milestone. 6 phases (P1 skeleton → P6 acceptance). Key
  decisions locked: separate workspace, Canvas + imperative-
  script split, dynamic stores via `ctx.createStore`, no
  declarative Chart node. Risks verified against actual code.

### Currently in flight

- **Performance Profiler build agent** (started after `39a210c`).
  Building against `docs/plans/PERFORMANCE_PROFILER.md`. Expected
  outcome: green (all 6 phases) OR partial at the P3/P4
  boundary. When it lands, the platform proof-by-construction is
  complete — a third-party pack bundling chart.js, shipping
  scripts that register commands + drive a live FPS chart,
  installs via the Extensions tab.

## Architectural state

### What's actually dogfooded now

- Editor packs ship as real `.apg` zips at
  `apps/editor/public/packs/`.
- Pack manifest schema: `scope`, `editorPanels[]`, `scripts[]`
  fields all extending the game-pack `PackManifest`.
- Pack scripts run at load time with full `EditorPackContext`
  access — same `registerCommand` API the shell uses.
- The first-party editor TSX no longer registers any
  pack-specific commands. **The dogfooding loop is honest.**
- Extensions tab toggles enabled set; reload applies.

### What's NOT yet built (Performance Profiler dependencies)

If the Profiler agent reports PARTIAL, these are the gaps to
chase next:

- `manifest.libraries[]` schema + pack-builder library bundling
  + loader `ctx.importLibrary(name)` (task #20). Plan §4 + §5.
- `Canvas` node in the renderer (refName + heightPx).
- Dynamic-store registration: `ctx.createStore(name, initial,
  actions)` + DYNAMIC_STORES map in resolveBinding.ts.
- `ctx.getCanvasRef(refName)`, `ctx.onPanelMount(panelId, cb)`,
  `ctx.share/consume`.

### Deferred (post-Profiler)

- Pack chain integration (`requires[]` resolution between
  editor packs, like game packs already do).
- Live unregister-without-reload on Extensions toggle (today a
  toggle requires reload; `disposeEditorPackScripts` is exported
  but unwired).
- Sandbox tightening (SRI hash, untrusted-source warning, CSP).
- The 3 remaining inline-TSX rows in CellInspector (Type / Tags
  / Properties) — need Repeat/ForEach + dynamic-indexer-depth-2
  + panel-local-state primitives.
- Pack-author icon refs (today every loaded panel gets FileJson).

## How to verify state on pickup

```bash
git pull origin main
git log --oneline -5
# expected: 39a210c (or higher if Profiler landed) at HEAD

git status
# expected: clean

cd apps/editor && bunx tsc --noEmit --skipLibCheck
# expected: exit 0

bun test src/panel-renderer/ src/state/ src/packs/
# expected: 106 pass / 0 fail (or higher)

# Verify dogfooding closure:
grep -r "demo.selection.clear" apps/editor/src/views/
# expected: NO HITS (the command exists only via pack script now)

# Verify .apg is real:
unzip -l apps/editor/public/packs/cardboard-editor-pack-demo.apg
# expected: 10 entries including scripts/setup.js
```

## Dev server

`bun --hot apps/editor/server.ts` from `apps/editor/`. Listens on
port **3001** (NOT 3010 like the previous session — docs server
no longer occupies 3001 since it was killed during the
no-styling investigation today).

The CLAUDE.md note about not starting dev servers from the agent
shell still applies. User starts it; agents read state only.

## Memory rules to read first

`.claude/memory/MEMORY.md` is the index. Today's session
specifically activated these rules:

- `feedback_verify_before_asserting.md` — pre-send self-audit
  IS the operative discipline. The user caught me hallucinating
  twice today; this rule was written in response.
- `feedback_audits_parallel.md` — audits run in parallel with
  every other work stream. Never idle-wait.
- `project_dogfooding_principle.md` — non-negotiable. The user
  enforced it sharply today when I shipped TSX-wrapper cheating.
- `project_editor_package_injection.md` — the bridge model that
  pack-bundled scripts now implements.

## What NOT to do

- Don't grind through more TSX → JSON panel migrations as
  Phase 1b "practice" — the user explicitly halted that. The
  next migrations come after the Profiler proves the full
  third-party pack model end-to-end.
- Don't add TSX wrappers that secretly register commands on
  behalf of packs. That's the dogfooding violation we just
  closed.
- Don't use `isolation: "worktree"` on Agent dispatches —
  VHDX corruption risk.
- Don't quote facts about project state without grepping first.
  See `feedback_verify_before_asserting`.

## The deploy

GH Pages deploys via `.github/workflows/docs.yml` only. Editor
+ docs + game all stage into `apps/docs/public/` via build
scripts. `bun run build-packs` produces both
`apps/game/public/packs/Cardboard.apg` AND
`apps/editor/public/packs/cardboard-editor-pack-demo.apg`.

Pages CSS verified healthy (210KB Tailwind v4.3.0). If user
reports "no styling" again it's almost certainly browser/SW
cache; hard-refresh → unregister SW → clear site data.
