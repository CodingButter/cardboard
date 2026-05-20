# Session State — 2026-05-20 (post-Tutorials + Sidecar M2) handoff

A handoff snapshot for the next Claude instance picking up this work.
**Read this file, then `.claude/memory/MEMORY.md`, then
`docs/plans/TUTORIALS.md`, `docs/plans/REMOTE_DOCK_QR.md`,
`docs/plans/CORE_EDITOR_PACK.md`, and
`docs/plans/JSON_VISUAL_BUILDER.md` in that order.**

The previous SESSION_STATE was written at commit `1b7aa3e` immediately
after the Visual Builder VB6 endpoint. Since then a third large arc
landed: the **Tutorial + Sidecar arc** — Tutorial system T1, T2, and
Sidecar M2 (three commits, three sub-milestones). This rewrite
reflects all of that.

## 1. Where main is right now

Branch `main` at commit **`9517565`** — Sidecar M2 (sidecar consumes
mountPanel + 3 touch-friendly panels). Tree is dirty (in-progress
`.apg` rebuilds, `shellSdkRuntime.ts`, `editor-bridge.ts`,
`build-pack-script.ts`, `PreviewPanel.tsx`, `player-input.js` —
holdovers from prior arcs that haven't been committed); no force-push
has happened.

Most recent commits relevant to today's three new arcs (chronological,
oldest first):

```
683259a  editor+packs: Visual Builder VB6 — JSON mode + error boundary + polish (VB COMPLETE)
1b7aa3e  docs: SESSION_STATE — post-Visual-Builder snapshot (prior refresh)
59344e6  editor+packs: Tutorial system T1 — JSON tutorial format + SVG spotlight overlay + EmptyState launcher (task #37)
91df815  editor+packs: Tutorial system T2 — pack-shipped tutorials via pack-chain (task #38)
40af88d  editor+sidecar: device-chip drag target + Pair modal polish (already in prior snapshot, sets up M2)
9517565  editor+sidecar: M2 — sidecar consumes mountPanel + ships 3 touch-friendly panels (task #39)
```

## 2. What just landed today (post-VB6)

A single coherent arc — **Tutorial + Sidecar** — three commits, three
sub-milestones. T1 + T2 close the tutorial-system runtime + the
pack-chain integration; M2 closes the sidecar `mountPanel` round-trip
that was open at the end of the VB6 snapshot.

### Arc — Tutorial + Sidecar (T1, T2, M2)

| Sub-milestone | Commit | What it proved / wired |
|---|---|---|
| **Tutorial system T1 — JSON format + spotlight overlay + EmptyState launcher** (task #37) | `59344e6` | New runtime under `apps/editor/src/tutorials/`: `types.ts` (`Tutorial`/`Step` schema, `$schema: "tutorial/1"`), `runtime.ts` (registry + completion LS map at `cardboard.tutorials.completed`), `TutorialOverlay.tsx` (full-viewport SVG dim layer with mask cutout + auto-placed speech bubble + MutationObserver re-anchoring). Advance kinds: `click | key | event | timer | next`. Esc skips, Enter advances `next` steps. EmptyState gained `tutorial?: string` prop rendering "▶ Start tutorial" only when registered + not completed. Deep link `?tutorial=<slug>` handled in `index.tsx` (rAF + 500ms settle, strips param via `history.replaceState`). Built-in tutorial: `apps/editor/src/tutorials/intro-scene.tutorial.json` (3 steps: tools-palette / brush / map-canvas, with new `data-tutorial-id` attrs on the wrapper divs). 14/14 in `runtime.test.ts`; 188/188 workspace-wide. |
| **Tutorial system T2 — pack-shipped tutorials via pack-chain** (task #38) | `91df815` | `PackManifest.tutorials?: ReadonlyArray<string>` at `packages/engine/src/AssetPack/types.ts:494` mirrors `editorPanels[]`. Pack-builder generic walk already picks up `.tutorial.json`; only the manifest spread in `build-packs.ts:1168` was needed. `apps/editor/dev/dev-pack-server.ts:215` got a mirror copy for tutorials so HMR'd in-memory packs include them. Editor pack-loader at `editorPackLoader.ts:566-617` walks `manifest.tutorials[]`, reads via `pack.textBody`, validates, calls `api.tutorials._register(def)`, pushes unregister fns into `packScriptCleanups[packId]` (independent of script ring). Runtime gained `unregisterTutorial(id)` + `tutorialsApi._unregister` (`runtime.ts:117-135, 459`). Pack-shipped sample: `packages/cardboard-editor-pack-demo/tutorials/selection-info-intro.tutorial.json` — 3-step intro to the demo's JSON SelectionInfo panel, slug `editor-pack-demo.selection-info-intro`, all centered to be robust to pack-disabled adjacent state. Toggle pack off → tutorial unregistered (list 2→1); re-enable → registered again (1→2). |
| **Sidecar M2 — sidecar consumes mountPanel + 3 touch-friendly panels** (task #39) | `9517565` | Closes the round-trip opened by `40af88d`'s device-chip drop. New WireMessage: `unmountPanel` at `pairingTypes.ts:73` + sidecar mirror in `peerTransport.ts:118` (sent by sidecar back button + editor pack-disable / device-disconnect paths). Sidecar panel registry at `apps/editor/sidecar/lib/panelRegistry.tsx` — 3 distinct touch-friendly components aliased under multiple dock-id keys: tools picker (tools/toolPicker/brush), color picker (tilePresets/colorPicker/palette), notes textarea (notes/scratchpad). Unknown kinds → `UnsupportedPanel` fallback. Dispatch wiring: `ConnectingScreen.tsx:135` swaps to `<MountedPanelScreen>` on inbound `mountPanel`; `MountedPanelScreen.tsx` back button emits `{ kind: "unmountPanel", panelKind, reason: "user" }`; desktop-side `desktopPairingSingleton.ts:243` calls `clearPairedPeerMount(peerId)` on inbound `unmountPanel`, clearing the device-chip mounted-state indicator. Optimistic `setPairedPeerMount` added in `sendMountPanel` + `data-mounted="true"` attribute on DeviceChip for the accent stripe. `window.__sidecarDebug` test-only shim exposes `dispatchInbound` + `forceConnected` for Playwright smoke without a live PeerJS handshake. 196/196 tests pass (was 188; +8 across `panelRegistry.test.ts` + `useDesktopPairingStore.test.ts`). |

The arc closes the **foundational layers** of two long-running plan
docs (`TUTORIALS.md` Phases T1–T2 of T1–T5;
`REMOTE_DOCK_QR.md` Phase D11 sidecar-side `mountPanel` receiver) and
proves the dogfooding contract for tutorials end-to-end: a
third-party pack ships its own onboarding via the same pack-chain
that already ships panels + scripts + libraries.

## 3. Architectural state — fully complete for the editor-engine pivot

The editor is a shell + a chain of packs. The shell `apps/editor/`
contains primitives, sync, loader, the recovery surface, and the
tutorial + sidecar runtimes. All content ships in packs registered
through the public SDK at load time.

- **`apps/editor/`** — the shell. Contains:
  - UI primitives (`components/ui/`, `components/dock/`).
  - Wave-3 stores (`src/state/`) — scene, brush, tool, layer,
    history, selection, diagnostics, tile-preset, command (with
    cross-window broadcast), editor-packs, layout-registry,
    view-registry, etc.
  - Cross-window sync (BroadcastChannel-backed synced-store
    factory).
  - IDB-backed project persistence (`src/idb/`,
    `src/lib/EditorProjectStore.ts`).
  - The pack loader (`src/packs/editorPackLoader.ts`) — now also
    handles `manifest.tutorials[]` registration + cleanup.
  - The Extensions tab + EditorSettingsModal (recovery surface,
    intentionally stays shell-side per CORE_EDITOR_PACK.md §3.3).
  - The JSON renderer (`src/panel-renderer/`).
  - The shell SDK runtime (`src/packs/shellSdkRuntime.ts`) +
    `src/packs/shellEvents.ts` (cross-pack event names + types).
  - **NEW: the tutorial runtime (`src/tutorials/`)** — `types.ts`,
    `runtime.ts`, `TutorialOverlay.tsx`, `intro-scene.tutorial.json`,
    `index.ts`. Exposed via `shellSdk.tutorials` (full
    `TutorialsApi` surface).
  - Dev-only pack HMR: `dev/dev-pack-server.ts` (now mirrors
    tutorials too) + `src/packs/devHmrClient.ts`.
  - **NEW: sidecar panel registry** at `apps/editor/sidecar/lib/
    panelRegistry.tsx` + `MountedPanelScreen.tsx` close the
    `mountPanel`/`unmountPanel` round-trip.
- **`packages/core-editor-pack/`** ships the editor's content:
  - **25 panels** (`panels/*.tsx` + `panels/prefabs/*.tsx` + JSON
    specs rendered via PanelRenderer).
  - **9 view shells** registered via `ctx.registerView(...)`
    (scene/prefabs/home/assets/project/scripts/components/animation).
  - **11 primary tabs** registered via `ctx.registerTab(...)`.
  - **2 default layouts** + **2 predefined layouts** plus the Scene
    presets registered from `layouts/predefined.ts`.
- **`packages/cardboard-visual-builder-pack/`** — the Visual Builder
  pack (entire JSON_VISUAL_BUILDER plan, VB1–VB6). Default-enabled.
- **3 demo packs** prove the model from the OUTSIDE:
  - `cardboard-editor-pack-demo` — original Phase-0 spike, **now
    also ships `tutorials/selection-info-intro.tutorial.json`**
    (proof-by-construction for T2).
  - `demo-performance-profiler` — chart.js + Canvas node + dynamic
    store + live FPS chart.
  - `demo-scene-stats` — second chart.js consumer, dedup proof.
- **Default-enabled set** at
  `apps/editor/src/state/useEditorPacksStore.ts` includes
  `cardboard-core-editor`, `cardboard-visual-builder-pack`, and
  the three demo packs.

## 4. What's still in the shell

`apps/editor/src/views/` unchanged from prior snapshot:

| File | Lines | Why still shell-side |
|---|---:|---|
| `EditorSettingsModal.tsx` | 473 | **By design — recovery surface per §3.3** |
| `settings/ExtensionsTab.tsx` | 332 | **By design — recovery surface per §3.3** |

EditorSettingsModal + ExtensionsTab stay shell-side permanently —
recovery UI a user reaches for when a misbehaving pack needs
disabling. Putting them in a pack would create a chicken-and-egg
deadlock per CORE_EDITOR_PACK.md §3.3.

The newly-added shell-side surfaces are **runtime** code, not view
code: `src/tutorials/` (registry + overlay are dock-modal-level
infrastructure, similar to Modal; cannot be a pack because the SDK
exports them) and `apps/editor/sidecar/lib/panelRegistry.tsx`
(separate PWA app — lives in its own bundle, not the editor's
`/views/`).

## 5. Shell SDK surface (current)

The contract third-party packs consume, exposed at
`globalThis.__cardboard_editor_shell` and populated by
`apps/editor/src/packs/shellSdkRuntime.ts`. The pack-builder rewrites
`import ... from "@cardboard/editor-shell"` into a virtual module
reading from this slot.

Current exports (verbatim — verified against
`shellSdkRuntime.ts` HEAD):

**Command + UI**
- `registerCommand`, `useCommandStore` (with cross-window
  broadcast — task #9)
- `EmptyState` (now carries `tutorial?: string` prop — task #37)
- `Modal`, `Button`, `Tooltip`

**Active scene context**
- `useActiveScene`

**Wave-3 stores** (all singleton-bound, BroadcastChannel-synced)
- `useDiagnosticsStore`, `useHistoryStore`, `useLayerStore`
- `useTilePresetStore`, `useTilePresetRegistryStore`
- `useSceneStore`, `useSelectionStore`
- `useBrushStore`, `useToolStore`

**Scene helpers**
- `cellKey`, `undoOnce`, `redoOnce`

**Tile texture cache**
- `loadTileTexture`, `getTileTextureSync`

**P4 view-shell primitives**
- `DockShell`, `WorkspaceRail`
- `useTabContextSlot`, `useTabContextSlotValue`
- `useRoute`, `buildHash`
- `useEditorPackPanels`, `useEditorPacksLoaded`

**P5b view-migration surface**
- `SET_TAB_EVENT` constant + `SetTabEventDetail`, `WorkflowMode` types
- `EditorProjectStore` singleton + `ProjectMeta`, `AssetMeta` types
- `importPackFromBlob`, `importPackFromUrl`
- `assetUrl`, `useStatusBar`, `StatusBarSection` type

**Task #17 — engine renderer**
- `GAME_RUNNER_URL`

**Visual Builder additions (VB2 + VB3 + VB5)**
- `PanelRenderer`, `NodeIdProvider`
- `STORE_REGISTRY`, `listDynamicStores`

**Tutorial system (NEW — task #37 / T1)**
- `tutorials: tutorialsApi` — the frozen `TutorialsApi` surface
  (`has`, `get`, `list`, `start`, `stop`, `skip`, `completed`,
  `markCompleted`, `reset`, `emit`, `advance`, `subscribe`,
  `getState`, `_register`, `_unregister`, `_resolveSelector`,
  `_completionKey`).

Companion: `globalThis.__cardboard_editor_react` (from
`apps/editor/src/packs/reactRuntime.ts`) — shared React instance.

The `EditorPackContext` (the runtime object the pack's setup
function receives) carries the registration APIs on top of the SDK:
`registerPanel`, `registerView`, `registerLayout`,
`registerPredefinedLayout`, `registerTab`, plus `createStore`,
`importLibrary`, `getCanvasRef`, `onPanelMount`, `share`, `consume`.
Pack-shipped tutorials are registered automatically by the loader
walking `manifest.tutorials[]` — packs do NOT call `_register`
directly from their setup script.

## 6. Dev workflow

Same as prior snapshot:

- `bun --hot apps/editor/server.ts` (port **3001**).
- Editor-scope pack source under `packages/core-editor-pack/`,
  `packages/cardboard-editor-pack-demo/`, etc. is watched + rebuilt
  + pushed to the editor via SSE on `/__dev/pack-hmr`. The client
  re-imports the setup script in-process:
  `disposeEditorPackScripts(packId)` + re-run setup.
- **New in T2**: `dev-pack-server.ts` now mirrors `tutorials[]` into
  its in-memory `.apg` builds, so pack-shipped tutorials hot-reload
  alongside panels + scripts.
- Game packs still build via the usual `bun run build-packs`.

## 7. What's next

Priority queue for the next session (refreshed):

1. **Tutorial system T3** — authoring view inside the editor.
   Likely leans on the Visual Builder (already a third-party pack).
   `docs/plans/TUTORIALS.md` §3 T3.
2. **Tutorial system T4** — telemetry / analytics. Step-completion
   events, slug + step coverage stats. Pipes into the Console event
   bus.
3. **Tutorial system T5** — more built-in tutorials covering
   Prefabs, Extensions, and the other top-level views currently
   without onboarding. Today only `intro-scene` (built-in) +
   `editor-pack-demo.selection-info-intro` (pack-shipped) exist.
4. **Sidecar D11+ — cross-window store sync broker.** Sidecar M2
   handles `mountPanel`/`unmountPanel` but the mounted touch panel
   on the phone reads from its OWN in-memory state; it does not yet
   sync against the desktop's scene / selection / brush stores over
   WebRTC. The broker that bridges BroadcastChannel ↔ WireMessage
   is the next sidecar milestone. `docs/plans/REMOTE_DOCK_QR.md`
   §D11+.
5. **More touch-friendly panels.** M2 shipped 3 (tools / tilePresets
   / notes). Long-tail polish per panel; mobile-tier-aware variants
   (`SidecarPanelProps.tier` is already plumbed but every paired
   device gets the same registry today).
6. **Remote dock + Supabase Realtime alternative transport.** Plan
   exists at `docs/plans/REMOTE_DOCK_QR.md` §6.5. Transport-
   interface lift (`D10c`) is the concrete next step.
7. **Pack-chain integration.** `requires[]` for editor packs,
   mirroring the game-pack chain. Visual Builder + the tutorial
   pack-chain integration give the chain model two non-toy
   customers now. `docs/plans/PACK_CHAIN.md`.
8. **Sandbox tightening on pack load.** SRI hash, untrusted-source
   warning, CSP. Today any `.apg` is trusted on import.

Lower priority:
- Pack-author icon refs (today every pack-loaded JSON panel gets
  `FileJson`; TSX panels supply their own icons).
- TopBar Help submenu launcher for tutorials (deferred from T1).
- Composite `any`/`all` advance conditions for tutorials.
- focus-trap + aria-describedby + prefers-reduced-motion polish
  on the tutorial overlay.
- Game-side cross-window dispatch (task #9 wired the editor's
  `useCommandStore`; the game runtime's command bus is separate).
- ANIMATIONS A2/A3/A4, UI_BUILDER full implementation, other
  plan docs untouched.

## 8. How to verify state on pickup

```bash
git pull origin main
git log --oneline -5
# expected: 9517565 at HEAD (or higher)

git status
# expected: clean (or known WIP files — apg rebuilds + a small
# handful of holdover modifications carried across snapshots)

cd apps/editor && bunx tsc --noEmit --skipLibCheck
# expected: exit 0

bun test
# expected: 196 pass / 0 fail (was 188 before M2 added 8)

# Verify the FIVE .apg files exist:
ls apps/editor/public/packs/
# expected:
#   cardboard-core-editor.apg
#   cardboard-editor-pack-demo.apg
#   cardboard-visual-builder-pack.apg
#   demo-performance-profiler.apg
#   demo-scene-stats.apg

# Verify shell views are down to the recovery surface:
ls apps/editor/src/views/
# expected:
#   EditorSettingsModal.tsx
#   settings/  (contains only ExtensionsTab.tsx)

# Verify the tutorial runtime landed:
ls apps/editor/src/tutorials/
# expected:
#   TutorialOverlay.tsx
#   index.ts
#   intro-scene.tutorial.json
#   runtime.test.ts
#   runtime.ts
#   types.ts

# Verify the pack-shipped tutorial sample:
ls packages/cardboard-editor-pack-demo/tutorials/
# expected:
#   selection-info-intro.tutorial.json

# Verify the sidecar panel registry + mounted-panel screen landed:
ls apps/editor/sidecar/lib/panelRegistry.tsx \
   apps/editor/sidecar/components/MountedPanelScreen.tsx
# both should exist

# Verify all 25 panels + 9 view registrations:
grep -c "ctx.registerPanel" packages/core-editor-pack/scripts/setup.tsx
# expected: 25
grep -c "ctx.registerView"  packages/core-editor-pack/scripts/setup.tsx
# expected: 9

# Verify the tutorials API on the shell SDK:
grep -n "tutorials: tutorialsApi" apps/editor/src/packs/shellSdkRuntime.ts
# expected: line ~347

# Smoke-test tutorial round-trip in the browser (with dev server up):
# 1. Open the editor.
# 2. In devtools: globalThis.__cardboard_editor_shell.tutorials.start("intro-scene")
# 3. Expected: overlay mounts, spotlight cuts out the tools palette,
#    Next advances through brush + map-canvas, completion is logged
#    to cardboard.tutorials.completed in localStorage.
# 4. Toggle cardboard-editor-pack-demo off in Extensions; list 2→1.
# 5. Re-enable; list 1→2.

# Smoke-test sidecar mountPanel (with dev server up):
# 1. Open editor + sidecar PWA in two contexts; pair them.
# 2. Drag a panel header onto the device chip in the left rail.
# 3. Expected: phone screen swaps to <MountedPanelScreen> with the
#    matching touch-friendly component (tools / tilePresets / notes).
# 4. Tap the back button — sidecar sends unmountPanel; desktop
#    DeviceChip drops the `data-mounted="true"` accent stripe.
```

## 9. Dev server

`bun --hot apps/editor/server.ts` from `apps/editor/`. Listens on
port **3001**.

Exposes:
- `/__dev/pack-hmr` (SSE) — pack-source watch + rebuild push
  pipeline (now also mirrors `tutorials[]` into in-memory `.apg`s).

The CLAUDE.md rule about not starting dev servers from the agent
shell still applies. User starts it; agents read state only.

## 10. Memory rules currently active

`.claude/memory/MEMORY.md` is the index. Unchanged from the prior
snapshot — highest-priority rules this session was governed by:

- `feedback_verify_before_asserting.md` — verify cheap claims by
  grep / read before asserting; hedge expensive ones.
- `feedback_audits_parallel.md` — audits are read-only; dispatch
  in parallel with implementation streams.
- `feedback_never_idle_protocol.md` — CRITICAL operational rule.
- `feedback_voice_carries_content.md` — voice + text both carry
  content.
- `project_dogfooding_principle.md` — non-negotiable. The
  tutorial system shipped its T2 pack-chain integration the same
  day as T1 specifically to keep this contract honest.
- `project_editor_package_injection.md` — the bridge model
  pack-bundled scripts implement.

## 11. What NOT to do

- Don't move EditorSettingsModal or ExtensionsTab into a pack.
  Recovery surface — CORE_EDITOR_PACK.md §3.3.
- Don't move the tutorial runtime / `TutorialOverlay` into a pack.
  The overlay is dock-modal-level infrastructure; the SDK exports
  `tutorials: tutorialsApi` to packs but the registry + the SVG
  spotlight live host-side by necessity (same z-index reasoning
  as `Modal`).
- Don't call `api.tutorials._register` from a pack's setup script.
  Packs ship tutorials via `manifest.tutorials[]`; the loader
  registers them with cleanup wired into `packScriptCleanups`.
- Don't bypass the dev HMR for editor-scope packs by manually
  running `bun run build-packs` during development — the SSE
  pipeline now also handles `tutorials[]` and will fight a manual
  build.
- Don't broadcast every command — some are inherently
  origin-local. Use `scope: "origin-only"` on `registerCommand`.
- Don't reintroduce `window.__sidecarDebug` paths into production.
  Tagged test-only in M2; trivially gateable via
  `import.meta.env` if production exposure becomes a concern.
- Don't quote facts about project state without grepping. Panel
  count, view count, tab count, registered tutorials — all are
  concrete and verifiable.
- Don't `git push --force` to main. Don't skip pre-commit hooks.
- Don't use `isolation: "worktree"` on Agent dispatches — VHDX
  corruption risk per `.claude/memory/MEMORY.md`.

## 12. The deploy

Unchanged. GH Pages deploys via `.github/workflows/docs.yml` only.
The editor + docs + game all stage into `apps/docs/public/` via
build scripts. `bun run build-packs` produces every `.apg`,
including all 5 editor packs into `apps/editor/public/packs/`. The
demo pack's `.apg` now carries 7 entries (manifest + panels/ +
scripts/ + tutorials/ + the three content files); size 2,346 bytes.

The PreviewPanel engine-render branch (task #17) points its iframe
at `<GAME_RUNNER_URL>?source=editor&projectId=…`. In dev that's
`/play/`; under GitHub Pages it's `/cardboard/play/`.
`GAME_RUNNER_URL` resolution lives in
`apps/editor/src/lib/gameRunnerUrl.ts` and is exposed via the
shell SDK.

CSS verified healthy on Pages (Tailwind v4.3.0).

---

## Errata vs the previous SESSION_STATE snapshot

Fixed during this rewrite:

1. The prior snapshot's "What's next" priority queue listed
   "Sidecar `mountPanel` consumer" as #2 — that is now SHIPPED
   (`9517565`). Replaced with the D11+ cross-window store-sync
   broker as the next sidecar milestone.
2. The prior snapshot did NOT mention the tutorial system at all
   (T1 + T2 hadn't landed yet). Added the entire Tutorial section,
   the `src/tutorials/` shell-side directory listing, the
   `tutorials: tutorialsApi` shell-SDK export, the manifest
   `tutorials?: ReadonlyArray<string>` field, and the verification
   steps for the tutorial round-trip.
3. The prior verification block referenced `bun test` returning
   "green (or known-failing pre-existing tests only)". Sharpened
   to the concrete number — 196 pass / 0 fail post-M2 (was 188
   pre-M2).
4. The prior snapshot's plan-doc reading order omitted
   `TUTORIALS.md` and `REMOTE_DOCK_QR.md`; both are now in the
   pickup-reading list at the top of this file.
