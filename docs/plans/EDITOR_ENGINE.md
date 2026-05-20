# Editor Engine — the unifying plan

This is the synthesis doc. Cardboard ships **two engines** and they
share one foundation: the pack-chain. The Game Engine + game packs
= games. The Editor Engine + editor packs = editors. Same SDK
underneath, same loader, same manifest shape.

Source memories + cross-doc references are linked inline; this doc
does not re-derive them. It exists to give a single read that ties
them together and a single ordered phasing.

---

## 1. Overview

Cardboard ships two engines on the same primitive:

| Engine | Consumes | Produces |
|---|---|---|
| **Game Engine** (`packages/engine/`) | game packs via pack-chain | a playable game |
| **Editor Engine** (`apps/editor/` → a thin shell + `@cardboard/editor-shell` SDK) | editor packs via pack-chain | a working editor |

The Editor Engine is **the same idea as the Game Engine, applied to
authoring tools**. Both load a manifest, walk `requires`, merge
contributions, last-write-wins per asset kind. Pack-chain is the
universal contribution mechanism for the whole ecosystem
([project-editor-package-injection][1]).

The endpoint: `apps/editor/` shrinks to the shell. Every panel
currently in `apps/editor/src/views/` and `panels/` moves into
`packages/core-editor-pack/`. Anyone with the shell can build their
own editor on it. We prove the shell works by dogfooding it
([project-dogfooding-principle][2]).

[1]: ../../.claude/memory/project_editor_package_injection.md
[2]: ../../.claude/memory/project_dogfooding_principle.md

---

## 2. The shell vs the pack

**Shell ships ONLY** (small, stable, well-documented surface):

- Primitives — `<Input>`, `<Button>`, `<Layout>`, `<Modal>`,
  `<Tooltip>`, `<DropZone>`, `<Surface>`, `<TabStrip>`,
  `<ScrollRow>`, the whole React design-system module.
- Design tokens + Tailwind defaults (`--color-bg-card`,
  `--color-accent`, …).
- Zustand sync layer — `createSyncedStore` + the eight Wave-3
  stores (tool / brush / tile-preset / layer / selection / scene /
  history / diagnostics). LS-backed for UI state, BroadcastChannel
  for ephemeral, transport-pluggable for future PeerJS
  ([feedback-popout-state-sync] + [project-remote-dock-via-qr][3]).
- IDB layer — `EditorProjectStore` (asset CRUD with bus
  invalidation) + `IdbAssetPack` ([project-idb-source-of-truth][4]).
- Command registry — `registerCommand`, `useCommandStore`. **Every
  interactive action goes through this**, no exceptions.
- Pack-chain loader — resolve, dedupe, conflict-report. The same
  one `apps/game` uses.
- Extension manager — install / enable / disable editor packs.
- Module resolver — bundled-library lookup with content-hash
  dedup.
- Dock-type catalog (§3).
- JSON-panel renderer (§4).

[3]: ../../.claude/memory/project_remote_dock_via_qr.md
[4]: ../../.claude/memory/project_idb_source_of_truth.md

**Core editor pack ships** (everything that's "the Cardboard editor"
specifically): page chrome (TopBar, WorkspaceRail), layer
taxonomies, tile-preset categories, all 14+ current panels, default
layouts, default keyboard shortcuts, fixtures.

**User-installable packs ship**: dev tools, custom inspectors,
genre-specific panels, theme packs, marketplace contributions.

Rules of thumb when classifying a new capability
([project-dogfooding-principle][2]):

1. Could a third party reasonably need this? → shell.
2. Are we using a different mechanism than a third party would? → smell.
3. Special editor-only hook? → wrong; refactor.
4. Embarrassing to ship to a community-pack author? → fix the API.

---

## 3. Dock-type catalog

Public catalog the shell exposes (packs pick from this list — they
do not invent dock kinds):

| Dock kind | Use |
|---|---|
| `dockable-window` | classic dockview panel (tab + split + popout) |
| `fullbleed-main` | the central canvas/viewport |
| `fixed-left-rail` | persistent left rail (icons + dock buttons) |
| `fixed-right-rail` | persistent right rail (inspector slot) |
| `top-bar` | persistent top bar |
| `bottom-bar` | persistent bottom bar |
| `floating-overlay` | non-dockable HUD layer (toast, breadcrumb) |
| `modal` | blocking modal |
| `container-dockview` | recursive — a dockview nested inside a panel |

`container-dockview` is what makes **nested rearrangeable layouts**
possible — a custom pack can ship a panel that itself hosts a
mini-dockview of sub-panels. Same primitive, recursively.

---

## 4. Declarative panel composition (JSON)

A panel can be authored as a **JSON tree** instead of TSX. The tree
references the same React primitives the shell exposes, plus
**string-path bindings** into Zustand stores for two-way data flow,
plus an optional script-ref escape hatch.

```jsonc
{
  "id": "selection-info",
  "title": "Selection",
  "dockKind": "dockable-window",
  "state": {
    "expanded": { "default": true }
  },
  "root": {
    "type": "Layout",
    "direction": "column",
    "children": [
      { "type": "Heading", "text": "$store.selection.label" },
      { "type": "Input",
        "label": "Name",
        "bind": "store.scene.cells[selected].name" },
      { "type": "Button",
        "text": "Clear",
        "onClick": { "script": "selection.clear" } }
    ]
  }
}
```

- `bind: "store.scene.cells[selected].name"` — string-path resolver
  reads the value AND writes back on input change. Two-way binding.
- `state: { … }` — local-state slice for things that don't need to
  live in a global store.
- `{ script: "selection.clear" }` — script-ref escape hatch.
  Resolved against the pack's contributed scripts (or shell
  built-ins). Args supported: `{ script: "x", args: ["$value", 42] }`.
- Container components (`Layout`, `TabStrip`, `Modal`,
  `container-dockview`) compose recursively. Same React primitives
  whether hand-written TSX or JSON-declared.

This is the same idea as [project-prefabs-declarative-assets][5]:
declarative content is mod-friendly, editor-authorable, hot-
reloadable, and trivially exportable.

[5]: ../../.claude/memory/project_prefabs_declarative_assets.md

---

## 5. Pack-bundled libraries (offline-first)

Editor packs bundle their npm deps at **development time** via the
pack-builder's local toolchain. Pack ships self-contained — no
runtime npm fetch, no esbuild-wasm in the browser, no network
required at load. Offline-first; works on a plane.

```jsonc
// manifest.json (editor pack)
{
  "id": "demo-performance-profiler",
  "version": "0.1.0",
  "scope": ["editor"],
  "dependencies": [                  // PACK-CHAIN deps (other packs)
    { "id": "core-editor-pack", "version": "^1.0.0" }
  ],
  "libraries": [                     // NPM libraries bundled in
    { "name": "chart.js",  "version": "4.4.0",
      "path": "libraries/chart-js-4.4.0.js",
      "hash": "sha256-abc123…" },
    { "name": "date-fns",  "version": "3.0.0",
      "path": "libraries/date-fns-3.0.0.js",
      "hash": "sha256-def456…" }
  ],
  "panels": ["panels/profiler.json"]
}
```

At load time the shell hashes every `libraries[].path` blob and
**dedups by content hash** — two packs that both ship the same
chart.js bytes get one resolved module shared between them. Editor
Settings → Libraries surfaces the loaded set and which packs
consume each one.

This is distinct from `dependencies:` (pack-chain) which references
**other packs**. Libraries are npm modules; dependencies are packs.

---

## 6. Editor package injection + marketplace

Dev-mode-only injection per [project-editor-package-injection][1]:
the editor injects an editor-bridge pack into the user's pack chain
at dev-time so hot-reload, remote-dock, and live-on-device testing
"just work" without per-game boilerplate. Production builds strip
the editor-scope contributions automatically.

The community store gets **three categories on the same shelf**:

| Category | What it does | When it loads |
|---|---|---|
| **Game packs** | Standalone playable games. | Always. |
| **Mod packs** | Extend a base game pack. | Always. |
| **Editor packs** | Extend the editor itself. May also include runtime contributions per dual-scope. | Dev-mode only. Tree-shaken from production exports. |

Same install flow, same manifest format, just a **tag on the
listing**. See PACK_CHAIN.md §10 for the store API.

---

## 7. Editor Settings → Extensions tab

A new tab in the Editor Settings modal:

- List installed editor packs. Per-pack enable/disable.
- Install from file (drop .apg) / URL / store.
- Uninstall.
- Pack identity — name + color + icon — reuses the sidecar
  device-identity model from REMOTE_DOCK_QR.md so packs are
  recognizable at a glance.
- Libraries sub-tab shows bundled libs + their consumers (§5).

---

## 8. Phased migration plan

The order matters. Each phase has a clear "what unblocks after this."

| Phase | Task | Deliverable | Unblocks |
|---|---|---|---|
| **0 — Wiring** | #21 | JSON schema + renderer + store-path resolver + script-ref invoker + ONE test panel. **No migration of existing panels.** | Validates the renderer end-to-end before touching prod panels. |
| **1 — Migrate existing** | #22 | TSX → JSON one panel at a time, simplest first: SelectionInfo → Tooltip → QuickTools → … → MapCanvas. | Proves the JSON renderer covers real-world panel surface. Backfills missing primitives. |
| **2 — Libs + extensions** | #20 + #18 | Pack-bundled libraries with content-hash dedup; Extensions tab UI; install/enable/disable flow. | Third parties can ship packs that depend on npm modules. |
| **3 — Visual builder** | #23 | Drag-and-drop panel-builder UI that outputs JSON. Lives as an editor pack itself. | Non-coders can author panels. Authoring loop closes. |
| **4 — Core pack extraction** | #19 | Move current `apps/editor/src/views/` + `panels/` into `packages/core-editor-pack/`. `apps/editor/` shrinks to shell. | Shell is provably reusable — the Cardboard editor is now one of its consumers. |
| **5 — Performance Profiler demo pack** | #24 | `packages/demo-performance-profiler/` installs via Extensions, contributes a panel via the dock-add modal, renders a live chart. | The proof point. See §9. |

Phase 5 is the milestone. Until then this is internal refactor;
after it, **the platform exists**.

---

## 9. The proof point

Task #24, in detail: `packages/demo-performance-profiler/` is the
canary editor pack.

- Bundles `chart.js` via `libraries:` (§5).
- Contributes one JSON-authored panel (§4) — live FPS / draw-call /
  memory chart.
- Subscribes to the diagnostics Wave-3 store via the shell's
  `useDiagnosticsStore` import (same import a core panel uses —
  no special hook).
- Installs through Editor Settings → Extensions.
- Shows up in the dock-add modal next to core panels.
- Survives popout into a separate window (uses the same sync
  layer).

**When this works on Pages and you can hand the URL to a friend,
the platform is real.** Not before.

---

## 10. Risks + open questions

| Risk | Mitigation / decision needed |
|---|---|
| **React component hot-load from blob ESM** — packs ship JS that needs to mount into a running React tree. | Spike in Phase 0. Likely `import()` from a `URL.createObjectURL(blob)` + a sandboxed module-context. Worst case: limit pack-authored components to JSON-declared subtrees of shell primitives (no arbitrary TSX). |
| **Tailwind scoping inside pack-rendered components** | Pack-rendered subtrees must use shell utility classes only. Pack-provided custom CSS is opt-in and scope-prefixed by pack id. |
| **Cross-pack store ownership** — who owns the layer taxonomy? | Shell owns the Wave-3 stores. Core editor pack contributes default content (layer kinds, tile-preset categories). Third-party packs read + extend but do not redefine schema. Schema lives in the shell. |
| **Sandbox / security** — what can a malicious editor pack do? | Same trust posture as PACK_CHAIN.md §8: untrusted-source warning + SRI hash on install. Editor packs run with full DOM access; this is by design (it's a VS Code-class extension model, not a browser-sandbox model). |
| **Performance** — pack-load time, bundle sizes | Content-hash library dedup (§5); lazy-load panels on first mount; budget the core editor pack at ≤500 KB compressed. |
| **Migration cost from existing TSX panels** | Phase 1 does them one at a time; the JSON renderer gets extended as panels expose gaps. Each panel migration is independently shippable. |

---

## 11. Cross-references

Plan docs:

- [PACK_CHAIN.md](./PACK_CHAIN.md) — the loader the shell uses.
- [REMOTE_DOCK_QR.md](./REMOTE_DOCK_QR.md) — sidecar PWA + PeerJS
  transport; the shell's sync layer plugs the WebRTC transport in.
- [CROSS_WINDOW_DND.md](./CROSS_WINDOW_DND.md) — the DnD
  subsystem; `<DropZone>` + `useDragStore` are shell primitives.
- [EDITOR.md](./EDITOR.md) — the current concrete editor; this doc
  is its successor architecture.
- [ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) — the parallel
  story on the game side.

Memories (operating principles + conversation captures):

- [project-dogfooding-principle][2]
- [project-editor-package-injection][1]
- [project-idb-source-of-truth][4]
- [project-prefabs-declarative-assets][5]
- [project-dnd-day-one](../../.claude/memory/project_dnd_day_one.md)
- [project-remote-dock-via-qr][3]
- [feedback-popout-state-sync](../../.claude/memory/feedback_popout_state_sync.md)
- [feedback-command-registry-required](../../.claude/memory/feedback_command_registry_required.md)
