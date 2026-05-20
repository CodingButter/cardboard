# JSON Visual Builder — Phase 3 of the Editor Engine arc

> Drag-and-drop panel-builder UI that outputs JSON. Lives as an
> editor pack itself. → Non-coders can author panels. Authoring loop
> closes.
> &mdash; `docs/plans/EDITOR_ENGINE.md` §8 Phase 3

This doc is the implementation plan for **task #23** — the Visual
Builder for **editor panels** authored against the JSON renderer
shipped in Phase 0 (`apps/editor/src/panel-renderer/`). Phases 1
(panel migrations), 2 (libraries + extensions tab), 4 (core editor
pack extraction), and 5 (Performance Profiler proof) have already
landed. Phase 3 is the last remaining capability arc before the
platform is "feature complete" for the editor-engine vision: the
authoring loop closes when a non-coder can produce a `.json` panel
spec without touching a text editor.

This plan covers a **distinct surface** from
`docs/plans/UI_BUILDER.md`. UI Builder targets **game runtime UI**
(HUDs, modals, dialogue) authored against `api.ui.renderTree(...)`
inside the running game. JSON Visual Builder targets **editor
panels** authored against `PanelRenderer` + `resolveBinding` (the
Wave-3 store registry). The two builders share design DNA — a tree
of nodes, schema-driven inspector, drag-from-palette — and the
implementation should cross-pollinate UX choices where possible,
but they ship as separate packs against separate renderers.

---

## 1. Goal + scope

**Goal.** Make the editor's own JSON panel format reachable by users
who can't (or won't) hand-author JSON. Today the renderer surface is
proven (5 panels migrated; cf. `docs/plans/EDITOR_ENGINE.md` §8
Phase 1b status) and the Performance Profiler demonstrates that a
third party can ship a pack with its own panels (§9). The remaining
constraint on third-party authoring is that you have to **hand-write
the spec** — a discriminated union of ~15 node types, a store-path
mini-language, and a script-ref registry to look up. That's an
on-ramp problem, not a capability problem; the builder eliminates
the on-ramp.

**Scope.** The builder is itself an editor pack. It contributes:

- A new top-level tab "Panel Builder" registered via `ctx.registerTab`
  (cf. `apps/editor/src/state/useTabRegistryStore.ts:34`).
- A view shell with a three-pane layout (palette / canvas /
  inspector) registered via `ctx.registerView`
  (`apps/editor/src/packs/editorPackLoader.ts:216`).
- A dock panel "Panel Library" registered via `ctx.registerPanel`
  (loader:204), listing every panel draft persisted to IDB.
- A dynamic Zustand store for the panel-being-edited registered via
  `ctx.createStore` (loader:151); the builder's canvas binds against
  it the same way any other JSON panel binds against
  `$store.<name>.<field>` (cf. `resolveBinding.ts:194` —
  `DYNAMIC_STORES`).

**Out of scope** for VB1–VB6:

- Authoring `.apg` packs end-to-end. The builder exports a single
  `.json` panel spec; bundling that into a `.apg` is the
  pack-builder's job and out of scope here.
- Designing **new node types**. The builder operates against the
  existing `NodeSpec` union (`apps/editor/src/panel-renderer/types.ts:524`);
  it does not let authors invent new node kinds. Extending the union
  remains a TypeScript + renderer change.
- A live-debug panel that watches a running editor's store state
  while you author. Phase 4 nice-to-have, called out in §10.

---

## 2. Architecture

The builder is a **stock editor pack**. No shell changes are needed
for VB1–VB5; VB6 may require minor additions to the renderer's
selection-overlay surface (see §10, Risk: overlay-injection
mechanism). The pack ships:

```
packages/cardboard-visual-builder-pack/
├── manifest.json            # tab + view + panel + scripts + libraries
├── scripts/
│   ├── setup.ts             # registerTab + registerView + registerPanel
│   ├── store.ts             # createStore("panelBuilder", ...) — draft spec + undo/redo
│   └── canvas-overlay.ts    # optional VB6 script: live JSON-mode sync
├── panels/
│   ├── palette.json         # left pane — drag sources
│   ├── canvas.json          # center pane — PanelRenderer + overlay
│   ├── inspector.json       # right pane — schema-driven form
│   └── library.json         # the "Panel Library" dock panel (top-level)
├── views/
│   └── PanelBuilderView.tsx # 3-pane shell mounted by registerView
└── types/
    └── builderTypes.ts      # local discriminated-union of "in-flight" node ids
```

**Key architectural choice:** the builder reuses **every primitive
the core editor pack uses**. No bespoke renderer, no bespoke DnD, no
bespoke command dispatch. This is the dogfooding contract per
`.claude/memory/project_dogfooding_principle.md`: if the visual
builder needs a primitive the core pack doesn't already use, that's
a smell — the shell either grows the primitive (so every pack
benefits) or the builder rearranges to use what's already there.

### 2.1 Two-mode edit loop

The builder operates in a two-mode toggle on the canvas pane:

| Mode    | What you see                                                            | Editing surface                              |
|---------|-------------------------------------------------------------------------|----------------------------------------------|
| Visual  | The panel-being-edited rendered via `PanelRenderer spec={draft}`.       | Click → select; drag handles; Delete; DnD.   |
| JSON    | A syntax-highlighted text view of the same `draft` spec.                | Direct text edit; on-change parse + validate. |

Both modes are bound to the **same draft store**
(`$store.panelBuilder.draft`) so edits in either mode propagate
synchronously to the other. The mode toggle is a single command
(`visual-builder.toggle-mode`) registered via the standard
`ctx.registerCommand` path — no bespoke event channel.

Visual mode wraps `<PanelRenderer spec={draft}>` in a selection
overlay (a positioned absolute layer that paints handles + the
hover ring on top of the rendered tree). The overlay reads the
DOM nodes the renderer produced and matches them back to spec-tree
node ids; see §5 for the "node-id matching" mechanism and the
risk callout in §10.

### 2.2 Why a pack and not a shell feature

The platform is real only when a third party can build a panel
builder of their own. The builder pack is the first
non-core-editor pack to:

- Register a **top-level tab** (cf. `core-editor-pack/scripts/setup.tsx:337`
  for the core pack's seven `ctx.registerTab` calls).
- Register a **dynamic Zustand store** the same way the Performance
  Profiler does (`packages/demo-performance-profiler/scripts/setup.ts`
  uses `ctx.createStore("profiler", ...)`).
- Render `<PanelRenderer>` against a draft spec **inside another
  `PanelRenderer`-rendered panel** (the canvas pane is itself
  rendered from JSON; the canvas pane's body contains another
  `PanelRenderer` instance bound to the draft).

That last point is the recursive-renderer proof. If it works for the
visual builder, container-dockview-style nested authoring works for
anything.

---

## 3. Panel-being-edited state

### 3.1 Store shape

The draft lives in a pack-contributed Zustand store registered via
`ctx.createStore("panelBuilder", initial, actions)`
(`editorPackLoader.ts:151`). The store is added to `DYNAMIC_STORES`
(`resolveBinding.ts:194`) so JSON panels in the builder pack itself
can bind `$store.panelBuilder.draft.title`, `$store.panelBuilder.selectedNodeId`,
etc. — the inspector pane is a JSON panel reading the very store it
edits.

```ts
// scripts/store.ts (sketch)
ctx.createStore<PanelBuilderState, PanelBuilderActions>(
  "panelBuilder",
  {
    draft: { id: "untitled", title: "Untitled", category: "Uncategorized",
             dockKind: "dockable-window", root: { type: "Layout", direction: "column", children: [] } },
    selectedNodeId: null,        // string id assigned by the builder per node
    history: { past: [], future: [] },  // VB4
    mode: "visual",              // "visual" | "json"
    library: [],                 // loaded from IDB on mount
    libraryActiveId: null,
  },
  (set, get) => ({
    insertNode: (parentId, index, node) => { /* immer-like push, snapshot to past */ },
    updateNode: (id, patch) => { /* find by id, merge patch */ },
    deleteNode: (id) => { /* prune subtree */ },
    moveNode: (id, newParentId, newIndex) => { /* reorder */ },
    selectNode: (id) => set({ selectedNodeId: id }),
    undo: () => { /* pop past, push current to future */ },
    redo: () => { /* mirror of undo */ },
    setMode: (mode) => set({ mode }),
    saveDraft: async (name) => { /* IDB write */ },
    loadDraft: async (id) => { /* IDB read */ },
    deleteDraft: async (id) => { /* IDB delete */ },
  }),
);
```

### 3.2 The "every node gets an id" question

The renderer's `NodeSpec` union does **not** carry a stable id per
node — it's a content-addressable tree (`apps/editor/src/panel-renderer/types.ts:524`).
The visual builder needs node ids for selection + DnD + inspector
binding. Decision: **the builder maintains a parallel id map** keyed
by tree-path, and exports the spec **without ids** when the user
hits Save. The id map is rebuilt on Load.

The alternative (extending `NodeSpec` to carry an optional `id?:
string`) was rejected because:

- It pollutes the spec for non-builder consumers (every hand-written
  JSON panel in the core pack would silently carry id slots).
- The renderer would have to either ignore them (waste) or expose
  them (security surface — pack scripts could target specific
  rendered nodes by id, which is not a contract we want to ship).

The parallel-id approach is internal to the builder pack and never
leaks into the canonical spec format.

### 3.3 Persistence

**IDB collection name:** `editor_panel_drafts`. Per §10, this is a
new store within the existing `two_5_d_editor` DB (the same DB
`EditorProjectStore` opens — `apps/editor/src/lib/EditorProjectStore.ts:24`).
This requires a DB version bump from 1 → 2 plus an `onUpgradeNeeded`
that creates the new object store. Schema:

```ts
interface PanelDraftRow {
  id: string;          // uuid
  name: string;        // user-supplied label
  spec: PanelSpec;     // the canonical export shape (no internal ids)
  createdAt: number;
  modifiedAt: number;
}
```

**Risk callout** (also in §10): bumping the editor DB version
ripples through the engine's `IdbAssetPack.fromProject` open, which
currently pins `DEFAULT_EDITOR_DB_VERSION = 1`
(`EditorProjectStore.ts:36`). The same coordination problem AE1
hit. Decision: either (a) coordinate the engine bump to v2 in the
same commit, or (b) use a sidecar DB the way AE1 did
(`two_5_d_editor_visual_builder` — `EditorProjectStore.ts:43`).
The sidecar pattern is the lower-risk choice and is the default
plan unless we find a reason to need cross-DB transactions.

Export: a Save-As-File command writes the `spec` to a Blob and
triggers a download. Import: a drop-zone on the library panel
accepts `application/json` and parses + validates the dropped file
through the same `validatePanelSpec` helper Phase 0 ships (cf.
`apps/editor/src/panel-renderer/PanelRenderer.test.ts` for the
validation contract).

---

## 4. Component palette (left pane)

The palette is a JSON-authored panel showing every `NodeSpec` type
the renderer accepts (currently 15 — `types.ts:524`). Each entry
is a tile with:

- icon (lucide name from `ICON_REGISTRY` —
  `PanelRenderer.tsx:99`),
- label ("Layout", "Heading", "Text", …),
- a one-line description (stage-2 `<Tooltip>` body).

The tile is the **drag source**. It uses the existing native
HTML5 DnD path from `cross-window-dnd`
(`apps/editor/src/state/useDragStore.ts:36` + `dnd/payload.ts`),
but the payload `kind` extends `SemanticAssetKind`. **Decision:** we
add a new semantic kind `"panelBuilderNode"` to the taxonomy
(`apps/editor/src/state/dnd/payload.ts:33`). The shell ships this
kind; only the visual builder pack speaks it; everyone else ignores
it (DropZone filtering is opt-in per `accepts: readonly K[]`).

Payload shape:

```ts
type PanelBuilderNodeDragPayload = DndPayload<"panelBuilderNode"> & {
  meta: {
    nodeType: NodeSpec["type"];           // "Layout" | "Heading" | ...
    template: Partial<NodeSpec>;          // default values for the new node
  };
};
```

The template lets the palette ship sensible defaults (e.g. a
`Heading` tile drags a `{ type: "Heading", text: "Heading", level: 2 }`,
not a bare `{ type: "Heading" }` that the renderer rejects on the
required `text` field).

**Why a new semantic kind, not "script"-shaped reuse:** the existing
kinds are about asset references stored in IDB (`script`, `texture`,
`prefab`, …). A palette node is an **inline template**, not an asset
reference. Squeezing it into `"script"` would mean asset-store
lookups for things that aren't assets. Cleaner to add the kind.

---

## 5. Canvas + selection (center pane)

The canvas pane is a JSON-authored panel whose root is:

```jsonc
{
  "type": "Layout", "direction": "column",
  "children": [
    {
      "type": "Layout", "direction": "row",     // toolbar
      "children": [
        { "type": "Heading", "text": "$store.panelBuilder.draft.title", "level": 4 },
        { "type": "Spacer", "size": 4 },
        { "type": "Button", "text": "Visual", "onClick": { "script": "visual-builder.set-mode", "args": ["visual"] } },
        { "type": "Button", "text": "JSON",   "onClick": { "script": "visual-builder.set-mode", "args": ["json"] } }
      ]
    },
    { "type": "Conditional", "when": "$store.panelBuilder.mode", "equals": "visual",
      "children": [ /* canvas-visual subtree */ ] },
    { "type": "Conditional", "when": "$store.panelBuilder.mode", "equals": "json",
      "children": [ /* canvas-json subtree */ ] }
  ]
}
```

The "canvas-visual subtree" needs to render `<PanelRenderer spec=...>`
with the draft. **This is a primitive the renderer does NOT
currently expose to JSON authors** — there's no `RenderSpec` node
type that takes a spec from a binding and recursively renders it.

**Decision:** add a new node type `RenderSpec` to the union. It's
narrow (one prop — `from: StorePath` — that resolves to a
`PanelSpec`), it's useful beyond the visual builder (any pack that
wants to render a user-loaded spec hits this need), and the
implementation is one switch case in the renderer that delegates
back to `<PanelRenderer>` recursively. This is the **one
renderer-surface change** Phase 3 introduces. See §10 risk.

The selection overlay is a TSX component the builder pack ships as
a `registerPanel` contribution. It mounts as a sibling of the
`<PanelRenderer>` inside the canvas-visual subtree, reads the
draft + selectedNodeId from the store, and walks the DOM (via
React refs threaded through the renderer's wrappers) to position
overlays. **There is currently no shell API to map a rendered DOM
node back to a NodeSpec id.** Options:

- (a) Have the renderer emit `data-node-id` attributes when a global
  flag is set. Tiny shell change.
- (b) Re-implement the spec-walk in the overlay using DOM order +
  index assumptions. Brittle.
- (c) Add an opt-in render prop to `<PanelRenderer>` that takes a
  per-node wrapper. Cleanest but larger surface.

**Decision:** (a). A `data-cardboard-node-id` attribute, emitted only
when the renderer is mounted inside a `<NodeIdProvider>` context
the builder pack establishes. Other consumers see no change. This
is a **second renderer-surface change** Phase 3 introduces. Small,
testable, and the dogfooding-correct shape — any third party that
wants to build an alternative builder hits the same need.

**Drop semantics on the canvas:**

- Drop on empty area → insert at root.children end.
- Drop on a container node (Layout, ScrollRow, Tooltip, Conditional)
  → insert as the last child of that container.
- Drop **between** two siblings → insert at that index. The overlay
  paints insertion-line affordances using the existing DropZone
  state (`isOver`, render-prop variant — `DropZone.tsx:23`).

Reorder uses the same DnD mechanism but with a `panelBuilderNode`
payload whose `id` is the existing node's builder-id rather than a
template marker. The drag-source distinguishes "from palette" vs
"reorder" via the `meta.source` field.

---

## 6. Property inspector (right pane)

The inspector is a JSON-authored panel that switches on the
selected node's type via nested `Conditional` blocks. For each node
type the inspector renders a hand-rolled form mapping the node's
properties to the appropriate input control:

| Node          | Inspector fields                                                                                                  |
|---------------|-------------------------------------------------------------------------------------------------------------------|
| Layout        | direction, gap, padding/paddingX/paddingY, align, justify, childFlex, textAlign                                   |
| Heading       | text (static-or-binding picker), level                                                                            |
| Text          | text (static-or-binding picker), variant, format, truncate                                                        |
| Input         | bind (store-path picker), label, placeholder                                                                      |
| NumberInput   | bind, min, max, step, precision, label, widthPx, showSteppers, unit                                               |
| Slider        | bind, min, max, step                                                                                              |
| Button        | text, onClick (script-ref picker), variant, icon, shape, disabledWhen                                             |
| ToggleButton  | bind, activeValue/activeWhenContains, text, icon, onClick, shape, disabledWhen                                    |
| Conditional   | when (store-path picker), equals, notEmpty                                                                        |
| Select        | bind, options (static list editor) or optionsFrom (enum picker — `"layers"`), label, size                         |
| Canvas        | refName, heightPx, className                                                                                      |
| Icon          | name (icon picker), size                                                                                          |
| Tooltip       | side, stages (a sub-array editor)                                                                                 |
| ScrollRow     | contentClassName, className                                                                                       |
| Spacer        | size                                                                                                              |
| RenderSpec    | from (store-path picker)                                                                                          |

Each form is a `Conditional`-gated subtree inside `inspector.json`
binding the form controls to **paths into the draft spec** via the
panelBuilder store's `updateNode` action exposed as a command. The
form fields write through `{ script: "visual-builder.update-prop",
args: [<propName>, { $value: true }] }` — the
`{ $value: true }` placeholder is the renderer's existing arg
mechanism (`apps/editor/src/panel-renderer/invokeScript.ts:62`).

### 6.1 Store-path picker

The `bind` field on Input / NumberInput / Slider / ToggleButton /
Conditional / Select / RenderSpec is a **store-path picker** —
a custom inspector control that autocompletes from:

- `Object.keys(STORE_REGISTRY)` — the five built-in stores
  (`resolveBinding.ts:152`).
- The `DYNAMIC_STORES` map's keys (`resolveBinding.ts:194`) — pack
  stores currently registered.

The picker walks one level at a time: pick `scene` →
`scene.settings` shows nested keys via TypeScript reflection. **But
we don't have runtime reflection** — Zustand stores expose
`getState()` which returns a plain object whose keys we CAN
enumerate at runtime. The picker uses `getState()` to enumerate
fields at each level. For arrays / dynamic indexers, it offers
the known `[selected]` literal (the only dynamic indexer Phase 0
supports — `resolveBinding.ts:126`) plus a "raw" text-input
fallback.

Implementation: a small TSX component shipped by the builder pack
via `ctx.registerPanel` (not a JSON-authored control — this needs
imperative behaviour the renderer doesn't currently expose).
Registered as `panelBuilder.storePathPicker` and referenced from
inspector.json via a `Custom` node type — **and this is a third
renderer-surface change**: a `Custom { component: "<id>" }` node
that looks up a registered ID and renders the component. Without it,
the inspector pane can't render bespoke controls.

**Decision summary on renderer-surface changes for Phase 3:**

| Change                                              | Why it's needed                                          | Size      |
|-----------------------------------------------------|----------------------------------------------------------|-----------|
| New `RenderSpec` node type                          | Builder canvas renders the draft spec recursively.       | 1 case    |
| `data-cardboard-node-id` opt-in attribute emission   | Selection overlay maps DOM back to spec ids.             | ~10 lines |
| New `Custom { component: "<id>" }` node type        | Inspector renders the bespoke store-path / script picker controls. | 1 case + registry helper |

Each is justified by **at least one third-party use case beyond the
visual builder**, per the dogfooding rubric:

- `RenderSpec` — any pack that loads + renders a user-provided
  spec (live preview tools, A/B comparison panels).
- `data-cardboard-node-id` — any pack that builds an inspector,
  debugger, or design tool over an existing rendered subtree.
- `Custom` — any pack that needs a controlled component the
  renderer doesn't ship (color pickers, image croppers, code
  editors).

### 6.2 Script-ref picker

The `onClick` field on Button / ToggleButton is a **script-ref
picker** — autocompletes from
`Object.keys(useCommandStore.getState().commands)` (cf.
`apps/editor/src/state/useCommandStore.ts:110`). Same `Custom`
component mechanism as the store-path picker.

Args sub-editor: a small array editor that lets the user add
string / number / boolean literals or the `{ $value: true }`
placeholder (`apps/editor/src/panel-renderer/types.ts:51`).

---

## 7. Save / export / import

**Save (named draft):** writes the current spec to the IDB collection
`editor_panel_drafts` (§3.3). Command:
`visual-builder.save-draft` (args: `[<name>]`).

**Export (file):** opens a file-download with the canonical spec
JSON. The exported shape is a `PanelSpec` (`types.ts:586`) — no
builder-internal fields, no parallel id map, no draft metadata.
Drop the exported file into any editor pack's `editorPanels[]`
array (`manifest.json`) and it ships as a real panel.

**Import (file):** drag a `.json` onto the **Panel Library** dock
panel (a `DropZone` that accepts `application/json`). The dropped
file is parsed + validated; on success it lands as a new draft in
the library.

**Library panel:** the fourth pack-contributed panel (cf. §2). It
lists every row in the IDB collection with rename / duplicate /
delete actions, and a "Load into Builder" action that pulls the
spec into the draft store. This is the **dock-panel** the
pack registers (not a tab pane) — it's available regardless of
which top-level tab is active, so authors can keep their library
visible while doing other editor work.

---

## 8. Living as a pack

The visual builder ships as `packages/cardboard-visual-builder-pack/`
(workspace name pending). Its manifest mirrors the Performance
Profiler's shape (`packages/demo-performance-profiler/manifest.json`):

```jsonc
{
  "id": "cardboard-visual-builder",
  "name": "Cardboard Visual Builder",
  "version": "0.1.0",
  "engine": "two_5_d@0.1",
  "scope": ["editor"],
  "scripts": [
    "scripts/setup.ts",
    "scripts/store.ts",
    "scripts/canvas-overlay.ts"
  ],
  "editorPanels": [
    "panels/library.json"
  ]
}
```

Setup script registers a tab, a view, four panels (palette, canvas,
inspector, library), one dynamic store, and the per-feature
commands (insert-node, update-prop, save-draft, set-mode, undo,
redo, etc.). Each registration's unregister fn is collected into
the cleanup return so disabling the pack rips every contribution
out — the same contract every other pack honours
(`editorPackLoader.ts:329`).

**Dogfooding evidence the builder pack provides:**

1. A non-core pack registers a top-level tab (only the core pack
   does this today, in `core-editor-pack/scripts/setup.tsx:337`).
2. A non-core pack contributes a dynamic store and binds its own
   panels against it (the Profiler does this already; the builder
   exercises it with `selectedNodeId`, `mode`, `library` — three
   distinct field shapes).
3. A pack ships **TSX-backed panels and JSON-backed panels in the
   same manifest** — the inspector / canvas / library JSON panels
   coexist with the store-path picker / overlay TSX panels. The
   `editorPackLoader` already supports both
   (`editorPackLoader.ts:204` and the JSON-spec walk at :360).
4. A pack **renders `<PanelRenderer>` recursively** — proves the
   renderer is reentrant.

If a third party can ship "Visual Builder for Cardboard, Premium
Edition" with their own UI on the same SDK, the platform is real.

---

## 9. Phases

Each phase ships independently. Acceptance criteria per phase let
us bail or pause without orphaning code; the Phase 1b halt at 5
panels is the operating precedent
(`docs/plans/EDITOR_ENGINE.md` §8 Phase 1b status).

### VB1 — Workspace skeleton

- New workspace `packages/cardboard-visual-builder-pack/` with
  manifest, `package.json`, `scripts/setup.ts`.
- `setup.ts` calls `ctx.registerTab({ id: "panel-builder", ... })`
  and `ctx.registerView("panel-builder", <PanelBuilderView/>)`.
- `<PanelBuilderView>` is a static three-pane shell with three
  placeholder dock-panels (palette / canvas / inspector) using
  `DockShell` (`apps/editor/src/components/dock/DockShell.tsx`).
- The default layout for the view is registered via
  `ctx.registerLayout("panel-builder", layout)`
  (`editorPackLoader.ts:223`).
- Pack installs through Extensions tab + tab appears in the strip;
  clicking it shows the empty three-pane shell. **Done.**

**Acceptance:** install + click the new tab, see three empty
panels.

### VB2 — Palette + canvas (drag a node, see it render)

- Add the `"panelBuilderNode"` semantic kind to
  `apps/editor/src/state/dnd/payload.ts:33` + `MIME` (this is a
  shell change — fold into the same commit as the pack).
- Add the `RenderSpec` node type to the renderer (`types.ts` +
  `PanelRenderer.tsx` switch case + test).
- Build `palette.json` listing the 15 node types as drag tiles.
- Build the panelBuilder store via `ctx.createStore` with a basic
  insert action.
- Build `canvas.json` whose subtree is `<RenderSpec
  from="$store.panelBuilder.draft" />`.
- Drag a Heading from palette → canvas → see the Heading appear.

**Acceptance:** drag 5 different node types onto an empty canvas
in order; the rendered output matches the draft spec.

### VB3 — Selection + inspector

- Add the `data-cardboard-node-id` attribute mechanism to the
  renderer (under a `<NodeIdProvider>` context the builder pack
  installs around its canvas-render subtree only).
- Add the `Custom { component: "<id>" }` node type to the renderer.
- Ship the selection overlay TSX panel.
- Ship the inspector JSON panel with `Conditional` branches per
  node type, hand-rolled forms.
- Ship the store-path picker + script-ref picker as `Custom`
  components.
- Hook updateNode / deleteNode actions.

**Acceptance:** click a Heading → inspector shows its text + level
fields → edit text → canvas updates live.

### VB4 — Undo/redo + save/export/import

- Extend the panelBuilder store with `past` / `future` stacks +
  `undo` / `redo` actions.
- Wire `Cmd+Z` / `Cmd+Shift+Z` via `ctx.registerCommand` with
  shortcut metadata (cf. core pack's keyboard registrations).
- Implement IDB sidecar DB `two_5_d_editor_visual_builder` (§3.3).
- Implement save-draft / load-draft / delete-draft commands.
- Ship the Panel Library dock panel.
- Implement file export (download) + file import (drop onto
  library).

**Acceptance:** author 3 panels, save each, reload the editor,
load each back, verify byte-identical export round-trip.

### VB5 — Picker autocomplete from live registries

- Store-path picker walks `STORE_REGISTRY` keys
  (`resolveBinding.ts:152`) and `DYNAMIC_STORES` keys (:194).
- For each picked store, walks `getState()` to enumerate the next
  level of fields.
- Script-ref picker autocompletes from
  `useCommandStore.getState().commands`.
- Args sub-editor supports static literals + `{ $value: true }`
  placeholder.

**Acceptance:** drag an Input → in inspector type "sc" in the
bind field → see `scene` highlighted → pick → see `cells`, `settings`,
etc. → pick `settings` → pick `name` → resulting bind path is
`scene.settings.name`.

### VB6 — Polish + JSON-mode side panel

- Mode toggle between Visual and JSON in the canvas pane.
- JSON mode renders a syntax-highlighted text view of the same
  draft, parses on change, surfaces validation errors.
- Live two-way sync (both modes bound to the same store).
- Optional: a "preview store" with fixture data for bindings the
  host doesn't currently have (§10).
- Polish: keyboard shortcuts (Delete, arrow-key reorder), drag
  affordances, empty-state messaging.

**Acceptance:** the §12 "VB6 green" criteria.

---

## 10. Risks + open questions

### Risk: recursive `PanelRenderer` — perf + reentrancy

`<PanelRenderer>` was not written with a "render this spec from a
binding" use case in mind; every existing call mounts it once at
the top of a panel and the spec is a prop. The `RenderSpec` node
type pushes spec into a `<PanelRenderer>` from inside another
`<PanelRenderer>`. Verification:

- `apps/editor/src/panel-renderer/PanelRenderer.tsx:1075-1100` — the
  outer wrapper reads `React.useContext(PackContext)`. Nested
  instances will read the **same** context (the builder pack's
  context), which is correct — pack-bundled scripts the inner
  panel references resolve through the same pack. **Inferred** —
  the test fixture set in `panel-renderer/test-fixtures/` doesn't
  exercise recursive mounts; VB2 should ship a unit test covering
  the recursion path.
- Re-render storm: a single key in `$store.panelBuilder.draft`
  triggers a top-down re-render of the entire `<RenderSpec>`
  subtree. Acceptable for VB2; VB6 should evaluate
  `React.memo`-style gating on the inner `<RenderSpec>` if the
  draft tree exceeds ~50 nodes.

### Risk: DOM-to-spec mapping fragility

The `data-cardboard-node-id` mechanism (§5) is opt-in but assumes
the renderer emits exactly one DOM root per `NodeSpec`. Most node
types do (Layout → `<div>`, Heading → `<h*>`, etc.), but `Tooltip`
wraps its child via `<Tooltip stages={...}>` (`types.ts:329`) — the
shell Tooltip primitive renders an extra portal layer for the
hover content. The id attribute needs to land on the **trigger
wrapper**, not the portal. Verification:
`packages/core-editor-pack/panels/SelectionInfoPanel.tsx` uses
this pattern; the trigger wrapper is the right anchor. VB3 ships a
test covering Tooltip-wrapped node selection.

### Risk: DnD between palette + canvas

The cross-window-dnd subsystem
(`apps/editor/src/components/dnd/DropZone.tsx`) accepts a
fixed set of `SemanticAssetKind` values (`payload.ts:33`). Adding
`"panelBuilderNode"` is a one-line change but:

- it widens the union for every existing DropZone (no behavioural
  change — they explicitly filter via `accepts: readonly K[]`),
- the new payloads ride the same `useDragStore` channel and will
  appear in cross-window state if a popout is open. **Decision:**
  fine; popped-out builder windows would naturally want to receive
  these. If a non-builder window receives a `panelBuilderNode`
  payload it never matches a DropZone's `accepts` list, so the
  cursor stays in "no drop" state.

### Risk: IDB version bump

§3.3 already lays out the decision: **sidecar DB**
`two_5_d_editor_visual_builder` to avoid clashing with the engine's
v1 open. Verified at `EditorProjectStore.ts:36` (the
`DEFAULT_EDITOR_DB_VERSION = 1` engine pin) and `:43` (the AE1
sidecar precedent).

### Risk: property inspector schema — hand-rolled vs derived

Hand-rolling 15 inspector forms is mechanical but bulky (~400
lines of inspector.json). A TypeScript-driven derivation would
be smaller and stay in sync with the union shape. But:

- TypeScript types are erased at runtime. A compile-time codegen
  step adds tooling complexity to the pack-builder.
- The renderer's `NodeSpec` interfaces use unions / optionals /
  enums that don't trivially translate to a single form-control
  schema.

**Decision:** hand-rolled for VB1–VB5. Codegen is a follow-on
ergonomics improvement, not a Phase 3 capability gap.

### Risk: live binding previews with no fixture data

Draft panels often bind to `$store.scene.cells[selected].height` —
a path that only resolves when a scene is loaded and a cell is
selected. The builder canvas needs to render **something** in
those slots while authoring, even without scene context.

**Decision (VB6):** ship a "preview store" mode — a small set of
fixture stores the builder swaps in when "Preview Mode" is
toggled. The fixture stores satisfy the same hook signature as the
real stores so `<PanelRenderer>` subscribes seamlessly. This is a
nontrivial mechanism — it's deferred to VB6 so VB1–VB5 can ship
with bindings either resolving against live host state OR
displaying a debug `—` placeholder. Same approach a designer would
use in Figma: stub data first, real data later.

### Risk: the builder's "save" only writes a draft, not a pack

The export step produces a `.json` panel spec that has to be
**manually** placed into a pack's `editorPanels[]` array. We are
NOT in scope here to build a full pack-authoring UI. A follow-on
phase ("VB7 — pack-builder integration") could:

- Let the user "Add to Pack" → choose a pack from a list of
  loaded packs → write the spec into that pack's manifest +
  panels directory via a new shell API.
- Or: a "Create New Pack" wizard that scaffolds a manifest +
  panel directory.

Both belong in a separate plan once Phase 3 is settled.

### Open question: where do tab + view ids live?

`ctx.registerTab({ id: "panel-builder", ... })` and
`ctx.registerView("panel-builder", ...)` register strings. If
another pack uses the same id, last-write-wins
(`useTabRegistryStore.ts:73` — `set((s) => ({ tabs: { ...s.tabs,
[tab.id]: { ...tab, order: s.nextOrder } } }))`). Convention is
that pack-contributed ids carry the pack's id prefix, e.g.
`cardboard-visual-builder.panel-builder`. The core pack doesn't
follow this convention (it uses `home`, `scene`, etc. directly
— `core-editor-pack/scripts/setup.tsx:337`). **Decision:** the
visual-builder pack uses `panel-builder` un-prefixed for VB1;
revisit if a future pack proposes the same id.

### Open question: progressive disclosure of node types

15 node types in the palette is a lot for a non-coder. Many are
low-frequency (Spacer, ScrollRow, ConditionalNode equals branches).
**Decision:** a flat list for VB2; add a "Basic / Advanced" toggle
in the palette in VB6 if user feedback warrants it.

---

## 11. Cross-references

Plans (concept + adjacent surface):

- [EDITOR_ENGINE.md](./EDITOR_ENGINE.md) §3 (dock-type catalog),
  §4 (JSON spec format), §8 (phased plan), §9 (Performance
  Profiler proof point).
- [UI_BUILDER.md](./UI_BUILDER.md) — sibling visual builder for
  **runtime game UI**. Same DnD-tree-of-nodes shape; different
  renderer + storage target. UI Builder writes JSON consumed by
  `api.ui.renderTree(...)` inside a running game; this plan
  writes JSON consumed by `PanelRenderer` inside the editor.
  Cross-pollinate UX patterns; do not share runtime code.
- [CORE_EDITOR_PACK.md](./CORE_EDITOR_PACK.md) §9.1 + §10 P2 —
  panel-def registry + `ctx.registerPanel`.
- [CORE_EDITOR_PACK.md](./CORE_EDITOR_PACK.md) §10 P4 — view +
  tab + layout registration surface.
- [PERFORMANCE_PROFILER.md](./PERFORMANCE_PROFILER.md) §3.2 —
  `ctx.createStore` semantics + read-only dynamic-store
  contract.
- [CROSS_WINDOW_DND.md](./CROSS_WINDOW_DND.md) §3.1–§3.3 — DnD
  payload contract + DropZone primitive.
- [PACK_CHAIN.md](./PACK_CHAIN.md) — the pack loader the editor
  uses to walk this pack's manifest.

Source code anchors (for the implementing agent):

| Topic                            | File                                                                                  |
|----------------------------------|---------------------------------------------------------------------------------------|
| `NodeSpec` union                 | `apps/editor/src/panel-renderer/types.ts:524`                                         |
| `PanelSpec`                      | `apps/editor/src/panel-renderer/types.ts:586`                                         |
| Renderer entry                   | `apps/editor/src/panel-renderer/PanelRenderer.tsx`                                    |
| Icon registry                    | `apps/editor/src/panel-renderer/PanelRenderer.tsx:99`                                 |
| Pack context provider            | `apps/editor/src/panel-renderer/PanelRenderer.tsx:89` (`PackContext` import)          |
| Store resolver                   | `apps/editor/src/panel-renderer/resolveBinding.ts`                                    |
| Built-in store registry          | `apps/editor/src/panel-renderer/resolveBinding.ts:152` (`STORE_REGISTRY`)             |
| Dynamic store registry           | `apps/editor/src/panel-renderer/resolveBinding.ts:194` (`DYNAMIC_STORES`)             |
| Dynamic store registration       | `apps/editor/src/panel-renderer/resolveBinding.ts:209` (`registerDynamicStore`)       |
| Script invoker                   | `apps/editor/src/panel-renderer/invokeScript.ts`                                      |
| `{ $value: true }` placeholder   | `apps/editor/src/panel-renderer/invokeScript.ts:62`                                   |
| Command registry                 | `apps/editor/src/state/useCommandStore.ts:110`                                        |
| `registerCommand`                | `apps/editor/src/state/useCommandStore.ts:356`                                        |
| Pack loader entry                | `apps/editor/src/packs/editorPackLoader.ts`                                           |
| `EditorPackContext` shape        | `apps/editor/src/packs/editorPackLoader.ts:110`                                       |
| `ctx.createStore`                | `apps/editor/src/packs/editorPackLoader.ts:151`                                       |
| `ctx.registerPanel`              | `apps/editor/src/packs/editorPackLoader.ts:204`                                       |
| `ctx.registerView`               | `apps/editor/src/packs/editorPackLoader.ts:216`                                       |
| `ctx.registerLayout`             | `apps/editor/src/packs/editorPackLoader.ts:223`                                       |
| `ctx.registerTab`                | `apps/editor/src/packs/editorPackLoader.ts:243`                                       |
| Tab registry                     | `apps/editor/src/state/useTabRegistryStore.ts:34` (`RegisteredTab`)                   |
| Primary tabs strip               | `apps/editor/src/shell/PrimaryTabs.tsx`                                               |
| Shell SDK surface                | `apps/editor/src/packs/shellSdkRuntime.ts:166` (`shellSdk` object)                    |
| DnD payload taxonomy             | `apps/editor/src/state/dnd/payload.ts:33` (`SemanticAssetKind`)                       |
| DropZone primitive               | `apps/editor/src/components/dnd/DropZone.tsx:49` (`DropZoneProps`)                    |
| Drag store                       | `apps/editor/src/state/useDragStore.ts:36`                                            |
| IDB project store                | `apps/editor/src/lib/EditorProjectStore.ts:24` (`DB_NAME`)                            |
| Sidecar DB precedent             | `apps/editor/src/lib/EditorProjectStore.ts:43` (`ANIM_DB_NAME`)                       |
| Engine v1 pin                    | `apps/editor/src/lib/EditorProjectStore.ts:36` (the AE1 rationale comment)            |
| DocksModal category order        | `apps/editor/src/components/dock/DocksModal.tsx:42`                                   |
| Core pack tab registrations      | `packages/core-editor-pack/scripts/setup.tsx:337`                                     |
| Profiler dynamic-store example   | `packages/demo-performance-profiler/scripts/setup.ts`                                 |
| Profiler manifest example        | `packages/demo-performance-profiler/manifest.json`                                    |

Memories:

- [project-dogfooding-principle](../../.claude/memory/project_dogfooding_principle.md)
  — the visual builder MUST live as an editor pack.
- [project-prefabs-declarative-assets](../../.claude/memory/project_prefabs_declarative_assets.md)
  — declarative-JSON authoring loop precedent.
- [project-dnd-day-one](../../.claude/memory/project_dnd_day_one.md)
  — DnD payload contract conventions.
- [feedback-command-registry-required](../../.claude/memory/feedback_command_registry_required.md)
  — every interactive action goes through `registerCommand`,
  including everything the builder dispatches.

---

## 12. Acceptance criteria — "VB6 green"

The visual builder is considered shipped when, **as a fresh user
with no prior editor knowledge**, you can:

1. Open the editor → install `cardboard-visual-builder.apg` via
   Extensions tab → see a new "Panel Builder" tab appear in the
   top strip.

2. Click the tab → see three panes (palette / canvas / inspector)
   + a Panel Library dock panel.

3. From the palette, drag onto the empty canvas in order:

   - a `Layout` (direction: row),
   - a `Heading` (text: "Selected cell"),
   - an `Input` (label: "Name", bind: `scene.settings.name`),
   - a `Slider` (bind: `brush.size`, min: 1, max: 20),
   - a `Button` (text: "Clear", onClick:
     `selection.clear`).

   See each node appear in the canvas as it is dropped. Click each
   node → see the inspector populate with the right fields.

4. Use the store-path picker to author the `Input` binding: type
   "sc" → pick `scene` → pick `settings` → pick `name`. Verify the
   binding works — type a new value in the Input and observe the
   scene name change in the editor's StatusBar (or wherever the
   scene name surfaces).

5. Save the draft as "MyFirstPanel" → reload the editor →
   load the draft → verify the canvas restores the same five
   nodes in the same order with the same props.

6. Export the draft as `my-first-panel.json` → drop it into
   `packages/demo-scene-stats/panels/` and add `"panels/my-first-panel.json"`
   to that pack's manifest → rebuild the pack via the pack-builder
   → install it through Extensions → open the DocksModal → see
   "MyFirstPanel" listed → add it to a dock → verify it renders
   identically to the builder's canvas preview.

7. Undo / redo the last three actions and verify state walks
   correctly.

8. Toggle to JSON mode → edit the heading text directly in the
   JSON view → toggle back to Visual mode → verify the canvas
   reflects the JSON edit.

When all eight steps work end-to-end, Phase 3 is done. The
**authoring loop closes** — a user has gone from blank canvas to
a `.json` panel spec shipping in a real editor pack without
writing a single line of JSON by hand.

The architectural endpoint — "Cardboard is the shell, the editor
is a pack, the visual builder is a pack, anyone with the shell can
build any of the above" — is reached.
