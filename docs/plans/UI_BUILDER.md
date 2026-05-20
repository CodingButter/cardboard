# UI Builder — visual pack-UI authoring

A plan for cardboard's **UI Builder**: a top-level editor tab that
lets pack authors compose game UI — HUDs, modals, notifications,
dialogue boxes — by visually arranging a hierarchy of components,
without writing TSX. The builder writes structured JSON UI trees
that the engine's runtime `api.ui.renderTree(json)` helper interprets
at load time and re-evaluates on every world-state tick the tree
references. Hot-reloadable, no compile step, accessible to non-
developers; the existing `api.ui.registerModal(name, Component)`
code escape hatch coexists so technical pack authors keep full
Preact-level control.

UI Builder is the third leg of the procedural-asset push (after
**Image Lab** and **Sound Lab**) — the principle is the same: lift
hand-rolled pack code into declarative JSON that the engine
interprets, with an editor tab that authors that JSON visually.
The headline win parallels the labs: smaller pack-ship size,
visual authoring for non-coders, deterministic output that the
engine can hot-reload without a TSX rebuild step, and a community
sharing surface (Store) that benefits from atomically-shareable
artefacts.

Source-of-truth for implementation. Phases UB1–UB6 below. Cross-refs:
[IDEAS.md](../IDEAS.md) (2026-05-16 "UI Builder tab" — origin entry),
[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) §6 (shell), §4 (R2
primitives — these power UI Builder's *own* editor chrome, separate
from the runtime UI primitives the tab outputs), §7 (per-view
migration plans — UB sits as R4i),
[IMAGE_LAB.md](./IMAGE_LAB.md) §7.1 (sibling lab's shared 4-column
shell pattern — UB cribs the column rhythm but swaps the node-graph
for a tree),
[SOUND_LAB.md](./SOUND_LAB.md) (sibling lab),
[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md) (engine-owns-runtime,
pack-owns-content boundary — `api.ui.renderTree` is engine; the
trees themselves live in packs),
[PACK_CHAIN.md](./PACK_CHAIN.md) (UI trees ship as pack assets,
last-pack-wins on id collision; sub-trees can be overridden via
the standard chain semantics),
[STORE.md](./STORE.md) (UB6 — community UI sharing + reverse-deps),
the materials plan (shipped — parallel pattern: declarative
hierarchy with a code escape hatch; see git log).

Last revised: 2026-05-17.

---

## 0. tl;dr

A `.ui.json` is a small tree (~200 B – 10 KB) of nodes — each node
has a `type` (`Stack`, `Text`, `Image`, `Button`, `Bar`, etc.),
optional `props`, and optional `children`. The engine compiles the
tree to a Preact VDOM at load, mounts it whenever the pack calls
`api.ui.show("hud:main")`, and re-renders the subtree any time a
referenced world-state binding changes. Data binding uses
`{{ path }}` interpolation against the world-state singleton bag
(player HP, ammo count, current room name) and against the standard
`api.singleton` namespace.

Events are similarly declarative: `onClick: "openInventory"` resolves
at runtime against a handler registry the pack populates via
`api.ui.registerAction(name, handler)`. The pack writes a few small
named handlers; the JSON tree references them by name. No event
handler ever has to live inline in the JSON — keeping the trees
clean, shareable, and free of arbitrary code.

The editor's **UI Builder** tab is the authoring surface: a 4-column
shell shaped like Image Lab / Sound Lab but with a **tree-of-
components** workspace instead of a node graph. Left rail: a
hierarchical tree view of the active UI tree + a component palette
of every available node type. Center: a 1:1 live preview canvas
that renders the tree against a mock world-state context, with
in-canvas selection + drag-to-reorder. Right rail: a props inspector
on the selected node + a theme tokens panel. Bottom strip: open UI
files, validation, export targets.

Determinism is the same contract as the other labs: the editor's
preview renderer is the **same `api.ui.renderTree` compiler** as the
engine's runtime. Given the same tree + same bound state, both
produce byte-identical DOM. A unit test snapshot-compares.

Why bother? A hand-rolled `InventoryScreen.tsx` is ~500 LOC of
Preact, with manually-managed slot click handlers, inline Tailwind,
and zero ability for a non-coder to tweak the layout. A `.ui.json`
equivalent is ~2 KB of declarative tree referring to a tiny set of
named handlers — a non-coder can rearrange slot grids, restyle the
hotbar, swap the equipment silhouette image, all from the editor
with live preview, without ever touching `.tsx`. The community
sharing payoff (Store) is the same as for image / audio recipes:
authors share their HUDs as atomic JSON, packs override sub-trees
of dependency-pack HUDs cleanly via the pack-chain.

---

## 1. Goals & non-goals

### Goals

- **Declarative pack UI.** A `.ui.json` describes a complete UI
  surface (HUD, modal, dialogue, toast) as a tree of typed nodes.
  No hand-rolled Preact required for the 90% case.
- **Visual authoring.** The UI Builder tab lets non-coders compose
  trees by dragging nodes from a palette, parenting them in a tree
  view, and editing props in an inspector. Live preview re-renders
  on every edit.
- **Data binding to world state.** Node props can interpolate values
  from `api.singleton`, ECS components, scene metadata, and pack-
  registered variables via a `{{ path }}` syntax (e.g.
  `value={{ player.hp }}`). Bindings re-evaluate on a registered
  tick (default 30 Hz for HUD, on-show for modals).
- **Named handler events.** Events (`onClick`, `onHover`, `onSubmit`)
  resolve to named handlers registered via
  `api.ui.registerAction(name, fn)`. JSON never embeds raw code.
- **Code escape hatch.** Pack authors who need full control still
  call `api.ui.registerModal(name, Component)` with a hand-written
  Preact component. UI Builder and code-written modals **coexist
  in the same registry**; the engine treats them as
  interchangeable.
- **Engine renders, packs ship trees.** `api.ui.renderTree(json)`
  is engine code. The trees themselves ship inside packs (`.apg`)
  alongside scripts, scenes, and recipes — they're pack content,
  consumed by engine machinery, per the engine/pack-split principle.
- **Hot reload.** Editing a `.ui.json` in the UI Builder tab
  re-broadcasts the new tree to the running iframe; the next render
  picks it up. No engine restart.
- **Themable.** A per-pack `theme.json` defines colour / font /
  spacing tokens. Nodes resolve `color: "$accent"` etc. against the
  theme. UI Builder ships a theme editor sub-pane.
- **Pack-chain composable.** Sub-trees can be overridden via the
  standard chain `last-pack-wins` rules (PACK_CHAIN.md). A child
  pack swaps the inventory grid's backplate without forking the
  entire InventoryScreen tree.
- **Asset visibility integration.** Image / icon props pick from
  the same asset library as Image Lab and the prefab Sprite picker;
  audio cues (`onClick.sound`) pick from Sound Lab recipes.

### Non-goals

- **Replacing all hand-written UI.** SettingsScreen, the in-engine
  dev console, complex modals with deep custom behaviour stay in
  code. UI Builder targets the 90% of UI that's static structure +
  binding + named actions.
- **Arbitrary code in JSON.** No `eval`, no inline JS strings, no
  template strings beyond `{{ path }}` interpolation. The trees
  are pure data; behaviour lives in registered handlers.
- **A general-purpose web layout engine.** UI Builder targets
  cardboard game HUDs: small, mostly static, occasionally
  animated. Flexbox-style layout primitives only. No CSS Grid
  beyond the `Grid` node's fixed-track schema. No CSS-in-JSON.
- **Two-way data binding.** Bindings are read-only by default. A
  `Slider` writing back to `{{ settings.volume }}` is supported
  *only* via a registered action handler — the JSON declares the
  intent (`onChange: "setVolume"`) and the handler does the write.
  No magic mutation.
- **Animation timelines.** Per-frame keyframe animation of UI is
  out of scope for UB1–UB5. UB6 may revisit ([§12](#12-open-
  questions)). Simple transitions (fade-in on mount, slide-in)
  ship as a `transition` prop with a small enum vocabulary in UB3.
- **Web Components / Shadow DOM / iframe-isolated UI.** The pack
  UI mounts into the engine's same Preact root as the existing
  modals.
- **Designing the editor's *own* chrome with UI Builder.** That's
  the EDITOR_REDESIGN R2 primitive set (`Slider`, `ToggleSwitch`,
  …). UB uses those for its inspector + tree-view + palette. The
  things UB outputs are **pack-runtime** components, a separate
  set.

---

## 2. Status quo — pack UI is hand-written Preact today

Today, every pack UI surface is a Preact component. The engine
exposes `api.ui.registerModal(name, Component, props?)`
([ModAPI/UIRegistry.ts](../../packages/engine/src/ModAPI/UIRegistry.ts)),
and the pack registers components by name. The engine renders the
registered component into a top-level mount when
`api.modals.isOpen(name)` is true. `props?: () => P` is invoked on
every render so components see fresh live state — a convenience to
spare packs from writing their own state-subscription loop.

### What's wired today

Looking at `packages/default-pack/scripts/ui/`:

| File | LOC | Role |
|---|---|---|
| `InventoryScreen.tsx` | 503 | Drag-drop inventory modal (bag + hotbar + equipment + cursor). |
| `SettingsScreen.tsx` | (variable) | Graphics + audio + control bindings, with `import { useSettingsState } from "@two_5_d/engine"`. |

The engine ships its own UI surface (HUD overlays, settings entry,
toast notifications) in `packages/engine/src/UI/` (per the
2026-05-16 "engine vs pack UI boundary" IDEAS entry — settings
modal migrates *back* into the engine in R4 of EDITOR_REDESIGN).

### What this status quo costs

- **Non-coders can't author.** Rearranging the slot grid means
  editing TSX. The mockup viewer (`SettingsScreen.tsx`) has nine
  property rows, each manually built — a designer cannot move
  "FOV" above "Walk Speed" without editing JSX.
- **No hot reload.** Pack TSX edits trigger
  `bun run build-packs`, then engine reload. The Image Lab / Sound
  Lab labs prove this is solvable for procedural content; pack UI
  has the same shape.
- **Hard to share.** A pack author's beautiful HUD lives inside
  `scripts/ui/HUD.tsx` — not an atomic shareable artefact. The
  Store can't list "HUDs"; it lists "packs that happen to contain
  a HUD."
- **Pack-chain override is coarse.** To swap a tile in the
  inventory backdrop, a child pack today must shadow the entire
  `InventoryScreen.tsx`. A declarative tree's `id`-addressable
  nodes invite finer overrides ([§9.3](#93-pack-chain-overrides)).
- **Editor preview is an iframe round-trip.** A code change ships
  through the pack-builder + reload; the editor can't preview the
  new layout inline. UI Builder gets a same-process preview
  renderer.

### Why this is solvable now

Three things changed in late 2026-04 / early 2026-05 that unblock
UI Builder:

1. **Engine/pack split clarity** (ENGINE_PACK_SPLIT.md) — `api.ui`
   is engine surface; the trees live in packs. The boundary was
   muddy six months ago.
2. **Image Lab + Sound Lab shipped the shell.** The same 4-column
   editor layout the labs use carries over with minimal change.
3. **`api.ui.registerModal`'s `props?` callback** already
   establishes the "engine re-invokes on every render" pattern —
   bindings just generalise that.

---

## 3. JSON UI tree schema

A `.ui.json` is one tree. The tree's root is a single node; the
root usually wraps the whole surface (a `Modal` for inventory,
a `Stack` for a HUD, etc.).

### 3.1 Node shape

Every node has the same three-field shape:

```json
{
  "type": "Stack",
  "props": { "direction": "row", "gap": 8 },
  "children": [
    { "type": "Text", "props": { "value": "HP" } },
    { "type": "Bar",  "props": { "value": "{{ player.hp }}", "max": 100 } }
  ]
}
```

Field semantics:

- **`type`** — one of the built-in node types (§3.2) or a pack-
  registered custom component type (§8). String, required.
- **`props`** — an object map of prop name → value. Values can be
  primitives (`string`, `number`, `boolean`), bindings
  (`"{{ path }}"`, §3.3), theme tokens (`"$accent"`, §9.1),
  asset references (`"@assets/hud-bg.png"`), or named handlers
  (`onClick: "openInventory"`, §3.4). Optional.
- **`children`** — an array of child nodes. Optional. A node type
  with no children semantics (e.g. `Text`) ignores `children`.

Additional optional top-level fields per node:

- **`id`** — a stable identifier used by pack-chain overrides
  (§9.3) and by event handlers needing to address a specific node
  (`api.ui.scrollTo("inventory.grid")`). String, optional but
  encouraged for any node a sibling/parent pack might want to
  override.
- **`if`** — a binding that gates rendering. `"if": "{{ player.alive }}"`
  hides the node when the binding evaluates falsy. Falsy children
  are not in the DOM at all.
- **`for`** — for repeated structures (inventory slots, dialogue
  choices): `"for": "{{ inventory.bag as slot }}"` repeats the
  child subtree for each item in the bound array. Inside the
  subtree, `{{ slot.itemId }}` resolves to the loop variable.
- **`class`** — opt-in raw className string for power users. Avoid
  in shareable trees; theme tokens + node-type styling cover 95%
  of cases. Documented as the "escape hatch within the escape
  hatch."

A file is one top-level JSON object containing one root node, plus
optional file-level metadata:

```json
{
  "$schema": "ui-tree/1",
  "id": "hud:main",
  "kind": "hud",
  "theme": "@theme",
  "root": { "type": "Stack", "props": { ... }, "children": [ ... ] }
}
```

- **`$schema`** — version tag, drives migrations (§3.5).
- **`id`** — registry id; the pack invokes the tree via
  `api.ui.show("hud:main")`.
- **`kind`** — one of `"hud" | "modal" | "toast" | "dialogue"`.
  Drives default mount behaviour (HUDs are always-on while the
  scene runs; modals open and close; toasts auto-dismiss; dialogue
  bound to a conversation system if the pack has one).
- **`theme`** — reference to a theme file (§9). `"@theme"` resolves
  to the active pack's theme. Omit for the default theme.
- **`root`** — the single root node.

### 3.2 Built-in node types

The built-in vocabulary is small but covers the 90% case. UB2
ships these; UB5 lets packs register custom types (§8).

Layout containers:

- **`Stack`** — vertical (default) or horizontal flex container.
  Props: `direction: "row" | "column"`, `gap`, `align: "start" |
  "center" | "end" | "stretch"`, `justify: "start" | "center" |
  "end" | "between" | "around"`, `padding`, `wrap: boolean`.
- **`Grid`** — fixed-track grid. Props: `columns` (number or
  array of track sizes), `rows` (number or array), `gap`,
  `padding`. Children flow row-major.
- **`Box`** — generic styled box. Props: `padding`, `margin`,
  `width`, `height`, `bg` (colour / token / asset), `radius`,
  `border` (`{ width, color }`), `shadow: "sm" | "md" | "lg"`.
- **`Spacer`** — flex spacer. Props: `size: number | "fill"`.
- **`Modal`** — backdrop + centered card. Props: `backdrop: boolean`,
  `closeOnBackdropClick: boolean`, `closeOnEscape: boolean`,
  `width`, `maxHeight`.

Content nodes:

- **`Text`** — styled text. Props: `value: string` (binding-aware),
  `size: "xs" | "sm" | "md" | "lg" | "xl"`, `weight: "normal" |
  "bold"`, `color`, `align: "left" | "center" | "right"`,
  `truncate: boolean`. Supports `{{ path }}` inside `value`.
- **`Image`** — `<img>` wrapper. Props: `src` (asset reference,
  binding, or URL), `alt`, `fit: "contain" | "cover" | "fill"`,
  `width`, `height`, `radius`.
- **`Icon`** — Lucide icon name. Props: `name: string` (e.g.
  `"Heart"`, `"Sword"`), `size`, `color`.
- **`Sprite`** — pack-sprite-aware image. Reads the sprite atlas
  bound to the pack's animation system; useful for animated HUD
  decorations (e.g. an animated portrait). Props: `sprite: string`
  (sprite id), `animation: string` (optional clip name), `scale`.

Interactive nodes:

- **`Button`** — clickable. Props: `label: string`, `icon: string`
  (optional), `variant: "primary" | "secondary" | "ghost" | "danger"`,
  `size: "sm" | "md" | "lg"`, `disabled: boolean`,
  `onClick: string` (handler id).
- **`Toggle`** — checkbox / switch. Props: `value: bound boolean`,
  `onChange: string`, `label: string`.
- **`Slider`** — range. Props: `value: bound number`, `min`, `max`,
  `step`, `onChange: string`, `valueLabel: string`.
- **`Input`** — text input. Props: `value: bound string`,
  `placeholder`, `onChange: string`, `onSubmit: string`.
- **`Select`** — dropdown. Props: `value: bound string`,
  `options: Array<{ value, label }>`, `onChange: string`.

Game-UI specialised nodes:

- **`Bar`** — progress / HP bar. Props: `value: bound number`,
  `max: number`, `color`, `bgColor`, `radius`, `showLabel: boolean`,
  `labelFormat: string`. Renders a filled fraction with optional
  text overlay.
- **`Crosshair`** — reticle. Props: `style: "dot" | "cross" |
  "circle" | "custom"`, `size`, `color`, `spread: bound number`
  (binds to weapon accuracy). Pack-runtime built-in because every
  shooter needs one.
- **`SlotGrid`** — inventory-style slot grid. Props: `slots: bound
  Array<ItemStack | null>`, `columns`, `slotSize`, `slotTemplate:
  string` (id of a sub-tree to render per slot — points to a
  reusable `.ui.json` fragment), `onSlotClick: string`,
  `onSlotDrag: string`. The slot template receives `{{ slot.item }}`,
  `{{ slot.index }}`, `{{ slot.selected }}` as loop-scope bindings.
- **`HotbarStrip`** — horizontal slot row with active-slot
  highlight. Variant of `SlotGrid`, optimised for the common case.
- **`Minimap`** — top-down scene minimap. Props: `radius`,
  `scale`, `showEntities: boolean`, `centerOn: "player" |
  "selection"`. Renders against the active scene's grid + entity
  positions. (Pulled from the existing default-pack minimap system
  in R4 of EDITOR_REDESIGN — it's a *game-side* concept, not engine
  — so it ships as a `SlotGrid`-class built-in *only because* the
  builder needs it as a first-class node; packs that don't want it
  ignore it.)
- **`Toast`** — notification card. Props: `message: bound string`,
  `severity: "info" | "warn" | "error" | "success"`,
  `duration: number` (ms; 0 = sticky). Toasts mount via
  `api.ui.toast(payload)` rather than via a tree the author places
  by hand — but the JSON `Toast` node *defines the visual style*
  of toasts for the pack. There's exactly one `Toast` node per
  pack, in `toast.ui.json`.
- **`DialogueLine`** — bound to the pack's conversation system if
  one exists. Props: `speaker: bound string`, `text: bound string`,
  `choices: bound Array<{ id, label }>`, `onChoose: string`.

Composition:

- **`Slot`** — a placeholder hole that a parent or chained pack can
  override. Props: `name: string`. Used to design "extension
  points" — a base pack's HUD declares `<Slot name="topRight" />`,
  and a child pack supplies content for that slot via the standard
  chain override (§9.3).
- **`Fragment`** — purely a transparent grouping wrapper. Props:
  none beyond `if`/`for`. Equivalent to React's `<>…</>`. Useful
  to wrap a `for`-repeated subtree that has multiple top-level
  children.

The built-in vocabulary is intentionally **small + composable**.
A pack that needs a "BossHealthBar" composes one from `Box` +
`Text` + `Bar`. If it composes the same shape three times, the
pack registers a custom type (§8).

### 3.3 Data binding — interpolation from world state

Binding syntax is `{{ path }}`. A string prop containing
`{{ … }}` becomes a bound prop:

- **Pure binding** — `value: "{{ player.hp }}"` resolves to the
  number at `world.singleton.player.hp`. The string-vs-number
  inference is by prop type: `Bar.value` is typed `number | string-
  binding`, so the binding resolves to a number.
- **Interpolated string** — `text: "HP: {{ player.hp }} / 100"`
  resolves the binding and stitches it into the surrounding text.
  Any number of `{{ … }}` slots per string.
- **Boolean** — `disabled: "{{ player.deadOrFrozen }}"`. The
  binding result coerces with JavaScript truthiness; explicit
  comparison goes through a helper (§3.3.2).

Binding paths resolve against a small set of root namespaces:

| Root | Resolves to |
|---|---|
| `player.*` | The active player's singleton state — HP, ammo, inventory pointer, position. Engine surfaces this through `api.singleton.player.*`. |
| `world.*` | Scene metadata — current scene id, time-of-day, ambient light, fog density. Surfaced via `api.world.singleton.*`. |
| `scene.*` | Per-scene volatile (entity counts, active room). |
| `pack.*` | Pack-defined variables registered via `api.ui.bindVar(name, getter)`. Authors expose custom state here without inventing new namespaces. |
| `theme.*` | Active theme tokens (resolves to `$tokenName`'s value; mostly used internally). |
| `loop.*` | Loop-scope vars inside `for` (slot.*, choice.*, etc.). |
| `event.*` | Event-scope vars inside handler-bound props (rare; mostly for advanced templates). |

A binding evaluator visits the tree on every UI tick (default
30 Hz for HUDs, configurable per tree via `root.props.tickHz`).
Bindings that haven't changed since the last tick don't trigger a
re-render of their subtree — the evaluator memoises by stringified
last-seen value per node.

#### 3.3.1 Format helpers

Some bindings need formatting. Inline pipe syntax:

- `{{ player.hp | int }}` — truncate to integer.
- `{{ player.hp | percent }}` — `0.6` → `"60%"`.
- `{{ scene.timeMs | duration }}` — ms → `"1:23"`.
- `{{ player.ammo | pad:3 }}` — `"007"`.
- `{{ player.weaponName | uppercase }}` — uppercase the string.

The pipe vocabulary is small and closed; packs cannot register
custom pipes (that would invite arbitrary-code creep). Custom
formatting goes through a pack-registered binding via
`api.ui.bindVar` returning the already-formatted string.

#### 3.3.2 Comparison helpers

A handful of comparison helpers for the `if`-prop case:

- `{{ player.hp < 25 }}` — boolean comparison.
- `{{ player.weapon === "shotgun" }}` — equality.
- `{{ inventory.bag.length > 0 }}` — array length.

Full expression syntax is intentionally avoided; the grammar is
"path, optional pipe, optional simple comparison." If a pack needs
a complex condition, it exposes a pre-computed boolean via
`api.ui.bindVar("player.shouldShowReloadPrompt", () => ...)`.

#### 3.3.3 Binding diagnostics

The editor surfaces unresolved bindings (`{{ player.fizzbuzz }}`
when no such path exists) as **soft errors** in the validation
panel — the runtime renders an empty string and logs a warning,
the editor draws a yellow squiggle under the offending prop in the
inspector. Hard error only if the binding type is fundamentally
incompatible (a `Bar.value` binding to a string, etc.).

### 3.4 Events — bound to script handlers

Every interactive prop (`onClick`, `onChange`, `onSubmit`,
`onHover`, `onFocus`, `onSlotClick`) is a **string** in JSON — the
name of a handler registered via `api.ui.registerAction(name, fn)`.
The engine looks up the handler at event time and invokes it with
a context object:

```js
api.ui.registerAction("openInventory", (ctx) => {
  api.ui.show("inventory:main");
});

api.ui.registerAction("buyItem", (ctx) => {
  const itemId = ctx.props.itemId;       // from the bound node's props
  const slot   = ctx.loop?.slot?.index;  // from loop scope
  api.shop.buy(itemId, slot);
});
```

The `ctx` shape:

- **`ctx.event`** — the native DOM event (with type info per
  event kind: `MouseEvent` for click, `InputEvent` for change).
- **`ctx.props`** — the node's resolved props (after binding
  evaluation). Useful when the same handler serves multiple
  buttons with different `itemId` props.
- **`ctx.loop`** — loop-scope variables when the event fires
  inside a `for`-repeated subtree (`{ slot, choice, etc.}`).
- **`ctx.tree`** — the active tree id (`"hud:main"`), for handlers
  shared across trees.
- **`ctx.api`** — the full ModAPI passthrough, so handlers don't
  need to capture it via closure.

Handlers are pack-scoped — a handler registered by pack A is not
visible to pack B's trees. Cross-pack action invocation goes
through the engine event bus (`api.events.emit`).

#### 3.4.1 Built-in actions

A small set of handler ids ship with the engine for the universal
cases — packs don't have to register these:

| Action | Effect |
|---|---|
| `ui:close` | Close the modal that contains the triggering node. |
| `ui:show:<id>` | `api.ui.show(<id>)`. |
| `ui:hide:<id>` | `api.ui.hide(<id>)`. |
| `ui:toggle:<id>` | If shown, hide; else show. |
| `ui:noop` | Explicitly do nothing — useful for accessibility focus targets. |

So a "Close" button on a modal needs no pack-side handler:
`{ "type": "Button", "props": { "label": "Close", "onClick": "ui:close" } }`.

#### 3.4.2 Sound-on-event

Every event prop pairs with an optional `*Sound` sibling:

```json
{ "type": "Button", "props": {
  "label": "Buy",
  "onClick": "buyItem",
  "onClickSound": "@sound/ui-confirm"
}}
```

The `@sound/...` reference resolves to a Sound Lab recipe or a
pack-shipped `.wav`. The engine plays the sound *before* invoking
the handler. Defaults can be set globally per-tree via
`root.props.defaultButtonSound`.

### 3.5 Versioning + migration

`$schema: "ui-tree/1"` is UB2's shape. The compiler tolerates
forward-compat additions (unknown node types log a warning and
render empty) and applies backward migrations on load via a
registered migration table:

- `1 → 2` migrations live next to the compiler. The engine runs
  them lazily; the editor offers a "Migrate" button on save.
- The schema version is **per file**, not per pack, so a pack mid-
  migration can ship some trees at v1 and others at v2.
- Migration tests pixel-snapshot the rendered DOM pre/post-migrate
  for every fixture tree in `packages/engine/src/UI/__fixtures__/`.

---

## 4. Runtime — `api.ui.renderTree(json)`

The engine half. The editor and the runtime share this compiler;
that's the determinism contract.

### 4.1 Engine renders JSON tree to DOM (Preact under the hood)

`packages/engine/src/UI/TreeRenderer.tsx` exposes:

```ts
interface UIAPI {
  // existing
  registerModal<P>(name: string, c: ComponentType<P>, props?: () => P): void;
  unregisterModal(name: string): void;

  // NEW (UB2)
  /** Register a UI tree by id, from JSON. */
  registerTree(id: string, tree: UITreeFile): void;
  /** Show a registered tree. Mounts a Preact subtree at the engine's UI root. */
  show(id: string): void;
  hide(id: string): void;
  toggle(id: string): void;
  /** Re-broadcast for hot-reload — replaces the registered tree in place. */
  reloadTree(id: string, tree: UITreeFile): void;

  /** Register a named handler. Handlers receive `ctx` (§3.4). */
  registerAction(name: string, fn: (ctx: UIActionContext) => void): void;
  unregisterAction(name: string): void;

  /** Register a custom node type (UB5, §8). */
  registerComponentType<P>(
    name: string,
    schema: ComponentTypeSchema<P>,
    renderer: ComponentType<P>,
  ): void;

  /** Expose a binding var to the tree's `pack.*` namespace. */
  bindVar(name: string, getter: () => unknown): void;

  /** Pure-function entry point — given a tree JSON, returns the rendered VDOM.
   *  Used by the editor's inline preview as well as by `show()` internally.
   *  Deterministic given identical input bindings. */
  renderTree(json: UITreeFile, ctx: RenderContext): VNode;

  /** Trigger a toast — `Toast`-styled (§3.2). */
  toast(payload: { message: string; severity?: ToastSeverity; duration?: number }): void;
}
```

`renderTree` is the **named function the lab cross-refs cite**.
It's pure: same JSON + same `ctx.bindings` snapshot → same VNode.
That's what makes the editor's preview match the runtime
byte-for-byte.

### 4.2 Layout primitives

The renderer walks the tree once per render. Each node type maps
to a Preact component in `packages/engine/src/UI/TreeNodes/*.tsx`:

- `Stack.tsx`, `Grid.tsx`, `Box.tsx`, `Spacer.tsx`, `Modal.tsx`,
  `Text.tsx`, `Image.tsx`, `Icon.tsx`, `Sprite.tsx`, `Button.tsx`,
  `Toggle.tsx`, `Slider.tsx`, `Input.tsx`, `Select.tsx`, `Bar.tsx`,
  `Crosshair.tsx`, `SlotGrid.tsx`, `HotbarStrip.tsx`, `Minimap.tsx`,
  `Toast.tsx`, `DialogueLine.tsx`, `Slot.tsx`, `Fragment.tsx`.

Layout is Tailwind classes under the hood — the same utility-first
class soup the rest of the engine UI uses. A `Stack` with
`direction: "row" gap: 8` renders `<div class="flex flex-row
gap-2">…</div>`. The mapping table is in
`packages/engine/src/UI/TreeNodes/styleMap.ts`.

Each node component:

1. Takes its `props` (already binding-resolved by the parent walker).
2. Renders the DOM shape.
3. Recursively renders `children` (the parent walker passes them
   pre-walked).

The walker is responsible for binding evaluation, `if` gating,
`for` expansion, and event handler resolution; the leaf components
are pure presentational.

### 4.3 Theme tokens — per-pack styling

A theme is a JSON file at `theme.json` in the pack root (or
`themes/<id>.json` for multi-theme packs):

```json
{
  "$schema": "ui-theme/1",
  "id": "default",
  "tokens": {
    "color.bg":      "#0c0a09",
    "color.surface": "#18181b",
    "color.accent":  "#f59e0b",
    "color.text":    "#fafafa",
    "color.text.muted": "#a1a1aa",
    "color.danger":  "#dc2626",
    "color.success": "#16a34a",
    "font.body":     "system-ui, sans-serif",
    "font.mono":     "ui-monospace, monospace",
    "size.xs":       "0.75rem",
    "size.sm":       "0.875rem",
    "size.md":       "1rem",
    "radius.sm":     "0.25rem",
    "radius.md":     "0.5rem",
    "shadow.md":     "0 4px 8px rgba(0,0,0,0.25)"
  }
}
```

A tree prop like `color: "$color.accent"` resolves at render time
to `#f59e0b`. The resolver supports the same `{{ path }}` syntax
for *dynamic* themes (rare — used for day/night colour shifts
bound to `world.timeOfDay`).

Theme cascade follows the pack chain: child pack's `theme.json`
overrides parent's tokens entry-by-entry. A child pack that only
defines `color.accent` inherits every other token from its parent.

### 4.4 Hot reload — re-renders without restart

The editor's UI Builder tab broadcasts a `reload-tree`
postMessage to the running iframe whenever the user saves
(`Cmd+S`) or auto-save triggers ([§5.3](#53-canvas-center-live-
preview-of-the-ui-tree)):

```ts
// editor side
iframe.contentWindow.postMessage({
  type: "reload-tree",
  treeId: "hud:main",
  tree: <new JSON>,
}, "*");

// engine side
window.addEventListener("message", (e) => {
  if (e.data.type !== "reload-tree") return;
  api.ui.reloadTree(e.data.treeId, e.data.tree);
});
```

`api.ui.reloadTree(id, tree)` replaces the registered tree and
forces a re-render of any currently-shown instance. Pack-registered
handlers + bindings are unaffected — only the tree shape changes.

Theme reload follows the same pattern with a `reload-theme`
message. Custom component types (§8) reload via `reload-component-
type` if the schema changed; the renderer falls through.

This piggybacks on the existing `EDITOR_IFRAME` postMessage
protocol — no new transport. The `EDITOR_IFRAME.md §6` message
table grows by three entries; that doc gets a cross-ref pointer
to this section.

---

## 5. Editor UI Builder tab

The visual authoring surface. Lives at PrimaryTab slot 9
(`UI Builder`, `LayoutTemplate` icon — per
[EDITOR_REDESIGN.md §6.3](./EDITOR_REDESIGN.md)).

### 5.1 Shared shell

The shell layout is the **same 4-column rhythm as Image Lab and
Sound Lab** (canonical in [IMAGE_LAB.md §7.1](./IMAGE_LAB.md#
71-shared-shell-architecture-image-lab--sound-lab--canonical)),
with two structural swaps:

- **Center workspace** is a **live preview canvas**, not a node
  graph. Trees are *hierarchies*, not networks — the appropriate
  metaphor is a tree-view + WYSIWYG canvas, not a node graph.
- **Left rail top** is a **tree view** (the file's component
  hierarchy), not a "Layers" flat list. Tree view + palette.

Column widths echo the labs: left rail 260 px, right rail 340 px,
bottom strip 260 / fluid / 320. The center is fluid. Responsive
collapse rules carry over (the lab > 1366 px is first-class, < 1180
collapses palette into a tab, < 1024 falls back to single-column).

The layout grammar:

```
+-- TopBar (shared editor chrome) -----------------------------+
+-- PrimaryTabs (Home / Map / ... / UI Builder / ...)         -+
+--------------------------------------------------------------+
|                                                              |
|   Left rail    |   Center (canvas)  |   Right rail (split)   |
|   (260 px)     |   (fluid)          |   (340 px)             |
|                |                    |                        |
|   Tree view    |   Live preview     |   Props inspector      |
|   ──────       |   (selected node   |   ─────────────        |
|   Component    |   highlighted +    |   Theme tokens         |
|   palette      |   drag-handles)    |   panel (collapsible)  |
|                |                    |                        |
+--------------------------------------------------------------+
|  Bottom strip:                                              |
|   Open files   |  Validation         |  Export targets     |
|   (260 px)     |  (fluid)            |  (320 px)           |
+--------------------------------------------------------------+
| StatusBar                                                   |
+--------------------------------------------------------------+
```

The headline difference from Image Lab: the canvas isn't a
*workspace* the user pans around — it's a real-pixel preview at
the surface's target dimensions, with on-canvas selection.

### 5.2 Tree view — left rail top

A vertical indented tree of every node in the active file. Each
row shows: indent guides, expand/collapse chevron (for nodes with
children), node icon (matches the node type — `Stack` → `Layers`,
`Text` → `Type`, `Image` → `Image`, `Button` → `MousePointer2`),
node id (or `[unnamed]`), node type as a small badge.

Interactions:

- **Click** — selects the node. Selection highlights in the canvas
  + the inspector switches to that node's props.
- **Drag** — reparents. Drop on a node → become its last child.
  Drop *between* two nodes → become a sibling at that position.
  Drop on a leaf node (`Text`) → rejected (leaves don't accept
  children).
- **Right-click** — context menu: Rename id, Duplicate, Delete,
  Wrap in… (Stack / Box / Modal / Fragment), Convert to custom
  component type (§8), Copy / Paste, Set as root.
- **Drag from palette** (§5.5) → drop onto tree → inserts new
  node at drop point.
- **Search** — search Input at the top filters the tree to nodes
  whose id, type, or text content matches. Useful in a 200-node
  inventory tree.

Multi-select: shift-click to add to selection. Multi-selected
nodes can be wrapped together (`Wrap in Stack`), duplicated, or
deleted en masse. The inspector then shows shared props (the
same multi-select inspector pattern Image Lab uses).

PanelHeader: "TREE" + a count Badge (`"23 nodes"`) + a Search
IconButton.

### 5.3 Canvas — center

The live preview pane. Renders the active tree via
`api.ui.renderTree(json)` (the *same compiler the engine uses*),
backed by a mock world-state bag the editor maintains. Updates on
every keystroke in the inspector (debounced ~50 ms).

Modes:

- **Mock mode** (default) — the canvas renders against the
  editor's mock bindings (§5.3.1). Useful for designing.
- **Live mode** — the canvas mirrors the running iframe's bindings
  via the same `EDITOR_IFRAME` telemetry stream that powers
  Playtest (EDITOR_IFRAME.md I2). Useful for previewing how the
  HUD looks *with the player's actual current ammo at 7*.
- **Cycle mode** — for trees with `for`-loops or conditional
  branches, a "cycle" button steps through edge cases (empty
  inventory, full inventory, low HP, full HP) by mutating the
  mock bindings on a timer. Useful for screenshots.

The canvas top toolbar:

- Mode SegmentedControl (Mock / Live / Cycle).
- Surface size Select — `Auto (fit canvas)`, `1920×1080`,
  `1366×768`, `1280×720`, `Mobile portrait 360×800`. Drives the
  iframe-style preview frame.
- Background SegmentedControl — `Scene`, `Checker`, `Black`,
  `Photo`. "Scene" embeds a screenshot of the current scene so
  the user previews HUD-over-gameplay. The other three are
  classic design-tool backdrops.
- Zoom IconButton (1× / 2× / 4×).

The canvas main body:

- A frame at the chosen surface size, centred.
- The rendered tree fills the frame.
- **Selection overlay**: the selected node draws an amber dashed
  outline. Sibling nodes draw a faint zinc outline on hover.
- **Drag handles**: the selected node has a 4-corner resize
  handle on resizable props (`Box.width`, `Box.height`) and a
  position handle if its parent is a `Stack` (drag to reorder
  among siblings — same effect as tree-view drag).
- **Add-here affordance**: hovering between two `Stack` children
  shows an amber `+` button — click to open the palette filtered
  by valid sibling types.

The canvas isn't a free-form workspace — it doesn't pan or scroll
beyond fit-to-window. Trees larger than the canvas are
designed-at-real-size; the surface-size dropdown controls the
viewport.

#### 5.3.1 Mock bindings

The editor maintains a mock-bindings JSON file per project at
`.editor/ui-mock.json`. UI Builder's right-rail bottom-panel
(collapsible) has a "Mock bindings" tab where the user edits the
mock object directly — `player.hp = 67`, `inventory.bag =
[{itemId: "shotgun", count: 1}, ...]`. The mock file is per-
project, not per-tree, so the user designs HUDs and modals
against a consistent imaginary world.

A default mock comes from `packages/editor/src/UI/defaultMock.json`
— a plausible mid-game player state with a partial inventory.

### 5.4 Props inspector — right rail top

The selected node's props. Schema-driven: each node type declares
a `propsSchema` (type, default, allowed values, binding-eligible)
and the inspector renders a `PropertyRow` per entry.

PanelHeader: "PROPS" + the node's type as a Badge + (if `id` set)
the id in muted text.

Body — a vertical stack of `PropertyRow`s, one per prop, with
appropriate primitives:

- Number → `Slider` or numeric `Input` (depending on prop schema's
  `range` hint).
- Boolean → `ToggleSwitch`.
- Enum → `Select` or `SegmentedControl` (≤4 options).
- Color → `ColorChip`.
- Asset (`Image.src`, `*Sound`) → asset picker — opens a side
  panel listing pack assets (same Assets-tab integration the
  prefab Sprite picker uses today, §10).
- String / text → `Input` (single-line) or `Textarea` (multiline
  per schema hint).
- Handler (`onClick`, `onChange`) → handler picker — a `Select`
  populated with the pack's registered actions plus the built-in
  `ui:*` actions (§3.4.1).
- Binding-eligible props show a small amber `{{ }}` toggle on the
  right that converts the value to a binding path picker
  (autocomplete on `player.* | world.* | pack.* | …`).

Each row's `hint` slot surfaces the prop's docstring from the
schema.

At the bottom of the inspector: an **Advanced** `CollapsibleSection`
for rarely-used props (`tickHz`, `class` escape hatch).

Below the per-prop rows: a footer with **Node Metadata** —
`id` Input, `if` binding Input, `for` binding Input, `Disabled`
ToggleSwitch (hides the node without removing it from the tree —
useful for A/B during authoring).

#### 5.4.1 Multi-select inspector

When 2+ nodes are selected, the inspector shows only **shared**
props (props on every selected node, with a compatible type). The
header reads "PROPS — 3 nodes". Edits apply to all selected nodes.

This is the same pattern as the labs (IMAGE_LAB §7.1.3).

### 5.5 Component palette — left rail bottom

The "draggable parts bin." A categorised, searchable palette of
every available node type — built-ins (§3.2) plus pack-registered
custom types (§8).

PanelHeader: "PALETTE" + a search IconButton.

Categories as `CollapsibleSection`s:

- **Layout** — Stack, Grid, Box, Spacer, Modal, Fragment, Slot.
- **Content** — Text, Image, Icon, Sprite.
- **Interactive** — Button, Toggle, Slider, Input, Select.
- **Game** — Bar, Crosshair, SlotGrid, HotbarStrip, Minimap,
  Toast, DialogueLine.
- **Custom** — any pack-registered types (§8). Empty until the
  pack registers some.

Each tile: icon + name + 1-line hover description. Tile is
draggable into the tree view (insert as child of drop target) or
into the canvas (insert at drop point in the visual hierarchy).
Double-click inserts as last child of the currently selected tree
node.

The palette doubles as a discovery surface: hovering a tile
opens a small floating "what does this do" tooltip with example
JSON.

### 5.6 Theme editor — right rail bottom (collapsible)

Below the props inspector, a `CollapsibleSection` titled "THEME"
that shows the active theme's tokens. Each token is a
`PropertyRow`: token name + value + `ColorChip` (for colours) /
`Input` (for sizes / fonts / shadows).

Edits write to `theme.json`. A "Reload Pack" button broadcasts
`reload-theme` to the iframe.

Token override semantics: tokens are inherited from parent packs
(§4.3). The theme editor shows inherited tokens in muted text;
clicking one promotes it to "overridden by this pack" status and
opens it for editing. Resetting an override reverts to inheritance.

A second tab in the section: "Mock bindings" (§5.3.1) — for
editing the per-project mock state directly.

### 5.7 Bottom strip

Three panels, echoing the labs' bottom strip:

- **Open files** (left, 260 px) — every `.ui.json` in the pack.
  Each row: file id, kind badge (HUD / Modal / Toast / Dialogue),
  node count. Selected row loads into the canvas. Right-click:
  Rename, Duplicate, Delete (with reference-checking — refuses
  to delete a tree still referenced by an `api.ui.show("…")`
  call statically traceable in the pack scripts).
- **Validation** (centre, fluid) — a `LogPanel` showing schema
  errors, unresolved bindings, missing assets, unregistered
  handlers, orphan nodes. Each row clickable → selects the
  offending node in the tree view.
- **Export targets** (right, 320 px) — pack export status (the
  same surface as the labs): "Saved to pack" / "Unsaved changes"
  / "Validation errors: 2 (blocking export)". Buttons: Export
  HTML preview (renders the tree to a self-contained HTML file —
  useful for screenshotting), Copy tree JSON, Share to Community
  (UB6, §13 cross-ref).

### 5.8 Header toolbar

Above the columns:

- Active-file DropdownMenu (every `.ui.json` in the project, plus
  a "+ New UI" entry).
- Inline file rename.
- Kind SegmentedControl (HUD / Modal / Toast / Dialogue) — drives
  the canvas frame default size + default props on the root node.
- Save Button (Cmd+S) — disabled when nothing changed.
- Re-render Button (force a refresh against the latest mock state).
- Kebab IconButton — Delete file, Duplicate file, Export PNG of
  canvas, Import tree (paste JSON).

### 5.9 Keyboard shortcuts

Mirrors the labs' convention (IMAGE_LAB §7.1.8) with UI-Builder-
specific keys:

| Key | Action |
|---|---|
| `Cmd/Ctrl+S` | Save file. |
| `Cmd/Ctrl+N` | New UI file. |
| `Cmd/Ctrl+D` | Duplicate selected node(s). |
| `Cmd/Ctrl+G` | Wrap selected node(s) in a `Stack` (group). |
| `Cmd/Ctrl+Shift+G` | Wrap in a `Box` (variant — `Cmd+Alt+G` opens a wrap-in chooser). |
| `Del` / `Backspace` | Delete selected node(s). |
| `Cmd/Ctrl+C` / `V` | Copy / paste (across files too). |
| `Cmd/Ctrl+Z` / `Shift+Cmd/Ctrl+Z` | Undo / redo. |
| `Tab` | Focus search (palette or tree, whichever is hovered). |
| `Cmd/Ctrl+P` | Toggle Mock / Live mode. |
| `Cmd/Ctrl+1..4` | Switch canvas kind (HUD / Modal / Toast / Dialogue). |
| `Cmd/Ctrl+/` | Toggle the selected node's `Disabled` flag. |
| `Arrow Up/Down` | Move selection in the tree view. |
| `Cmd/Ctrl+Arrow Up/Down` | Reorder selected node among siblings. |
| `Cmd/Ctrl+Arrow Left/Right` | Re-indent (outdent / indent under prev sibling). |

### 5.10 Drag-drop semantics

- **Drag palette tile → tree view** = insert as child of drop
  target.
- **Drag palette tile → canvas** = insert at the visual drop
  point (the parent is inferred from the deepest `Stack` / `Box`
  / `Grid` at the cursor).
- **Drag palette tile → existing wire-less node in tree** =
  reject (UI is hierarchical, not graph; nothing to "splice into"
  beyond reparenting).
- **Drag tree node → tree node** = reparent (drop on = last
  child; drop between = sibling).
- **Drag tree node → canvas** = reparent visually (same effect,
  inferred from cursor).
- **Drag file from "Open files" → canvas** = open that file in
  the canvas.
- **Drag asset from Assets tab → image-prop node** (`Image`,
  `Sprite`, `Box.bg`) = set that prop. (Cross-tab DnD —
  UB5 polish.)

---

## 6. Code escape hatch

Pack authors who need code-level control — complex modals with
custom Preact hooks, weird drag-drop physics, third-party
integration (charting library, etc.) — keep using
`api.ui.registerModal(name, Component)`. Nothing about UI Builder
removes or deprecates that API.

The runtime treats `registerModal` and `registerTree` as **siblings
in one registry**:

- `api.ui.show("inventory:main")` looks up `"inventory:main"` in
  the merged registry. If a tree is registered under that id, the
  engine renders it via `renderTree`. If a component is registered,
  the engine renders the component directly. If both are
  registered (a misconfigured pack), the *tree wins* and a warning
  logs.
- `api.ui.hide` / `toggle` work uniformly.
- `api.ui.unregisterModal` and a new `api.ui.unregisterTree` do
  the obvious thing.

Tree authors and code authors can interop too:

- A tree's `Slot` node (§3.2) can be filled by a hand-written
  Preact component — the pack calls
  `api.ui.fillSlot("hud:main.topRight", <Component>)`. The
  renderer mounts the component at the slot position.
- Conversely, a hand-written Preact component can mount a
  registered tree by calling `api.ui.renderTree(tree)` directly
  and embedding the result in its own JSX.

The two surfaces compose. A pack might author a complex SettingsScreen
in code but use UI Builder for the inventory + hotbar + minimap, or
vice versa. The choice is per-surface, not per-pack.

### 6.1 When to choose which

Guidance shipped in the docs:

| Surface | Recommended path |
|---|---|
| HUD overlays (HP bar, ammo counter, minimap) | UI Builder (cheap structural changes are valuable). |
| Inventory / equipment / shop modals | UI Builder + `SlotGrid` + custom `slotTemplate`. |
| Settings / control bindings | Engine-shipped (R4 of EDITOR_REDESIGN). |
| Conversation / dialogue trees | UI Builder + `DialogueLine` (pack supplies the conversation data; the tree renders it). |
| Toasts / notifications | UI Builder — one `Toast` definition per pack defines the style; `api.ui.toast(msg)` mounts instances. |
| In-engine dev console | Engine-shipped (CONSOLE.md). |
| Mini-games, complex interactive widgets, third-party-lib UI | `registerModal` with hand-written Preact. |

---

## 7. Built-in component library

The §3.2 vocabulary expanded with the **shape contracts** UB2 ships.
Each entry: prop schema, defaults, allowed bindings, behaviour
notes. (The detailed per-prop tables are at the end of this
section; the high-level summary first.)

The library is split into three logical buckets:

1. **Structural** — Stack, Grid, Box, Spacer, Modal, Fragment,
   Slot. These compose layouts; they don't render content of
   their own beyond backgrounds + borders.
2. **Content** — Text, Image, Icon, Sprite. Inputs to the visual
   layer.
3. **Interactive** — Button, Toggle, Slider, Input, Select, Bar,
   Crosshair, SlotGrid, HotbarStrip, Minimap, Toast, DialogueLine.
   Have event-bound props or read live data.

Each component has:

- A **schema** — typed prop table with `binding: boolean` per
  prop, `range`, `default`, `enum`.
- A **renderer** — the leaf Preact component in
  `packages/engine/src/UI/TreeNodes/<Name>.tsx`.
- An **inspector** — the UI Builder right-rail surface schema-
  drives this; no per-node custom code needed for the common case.

Schemas are exported from `packages/engine/src/UI/schemas.ts` so
the editor can introspect them. New schemas are additive; the
schema version is part of `$schema`.

The complete list of 24 built-ins ships in UB2. UB5 expands the
library only if a clear pattern emerges across packs that's worth
canonising; the bias is toward "compose from existing" not "add
another built-in."

---

## 8. Custom components — pack-registered node types

Sometimes a pack repeats the same compound subtree (a styled
"HUDPanel" with a title + content area; a "QuestRow" with icon +
name + progress + reward). Rather than copy-paste the same 30
lines of JSON across files, the pack registers a custom node type.

```ts
api.ui.registerComponentType("HUDPanel", {
  schema: {
    title: { type: "string", binding: true },
    children: { type: "children" },
  },
  // The renderer is a small Preact component that consumes the
  // resolved props + children. It can use other built-in nodes
  // by returning JSX, OR delegate to api.ui.renderTree on a
  // sub-template.
  renderer: (props) => (
    <Box bg="$color.surface" radius="md" padding={3}>
      <Text size="sm" weight="bold">{props.title}</Text>
      <Box padding={2}>{props.children}</Box>
    </Box>
  ),
});
```

Now tree JSON can use `{ "type": "HUDPanel", "props": { "title":
"Quests" }, "children": [...] }` exactly like a built-in.

The schema feeds the UI Builder palette + inspector — the new node
appears under the **Custom** category, with its declared props
exposed in the inspector with the right primitives.

### 8.1 Renderer-as-tree

If the renderer is itself just a sub-tree (most are), the pack can
register a "template" form — no Preact required:

```ts
api.ui.registerTemplate("HUDPanel", {
  schema: { title: { type: "string", binding: true } },
  template: {
    type: "Box",
    props: { bg: "$color.surface", radius: "md", padding: 3 },
    children: [
      { type: "Text", props: { value: "{{ props.title }}", size: "sm", weight: "bold" } },
      { type: "Box",  props: { padding: 2 }, children: [{ type: "Slot", props: { name: "children" } }] }
    ]
  }
});
```

Templates can be authored in UI Builder itself — a `.ui.json` with
`kind: "template"` and a `$schema: "ui-template/1"` flag. The
template editor exposes a "Props" panel where the author defines
the template's parameters; the canvas previews against sample
prop values.

Template trees + Preact renderers are interchangeable from the
runtime's POV — `api.ui.renderTree` knows which kind it has and
dispatches accordingly.

### 8.2 Lifecycle + reload

Custom types can be reloaded via `api.ui.registerComponentType(name,
schema, renderer)` (idempotent — re-registering replaces). Schema
changes trigger an editor-side prompt to migrate existing usages
("`title` removed; remove from 4 callsites?").

Custom-type names are pack-scoped to avoid collision; the editor
prefixes them in the palette with the pack id (`mod-pack:HUDPanel`)
when the active project depends on more than one pack that
registers a same-named type.

---

## 9. Theming

Per-pack theme tokens (§4.3). UB ships:

- The **token vocabulary** (colour roles, size scale, font roles,
  radius, shadow, spacing) — small but covers what every game UI
  needs.
- The **resolver** (`$token.name` in any string prop).
- The **inheritance** (child pack overrides parent token-by-token).
- The **editor surface** (§5.6).

### 9.1 Token vocabulary

Closed vocabulary in UB2 — a small fixed set, sortable into roles:

| Role | Tokens |
|---|---|
| Colour (background) | `color.bg`, `color.surface`, `color.surface.alt`, `color.backdrop` |
| Colour (foreground) | `color.text`, `color.text.muted`, `color.text.inverse` |
| Colour (accent) | `color.accent`, `color.accent.subtle`, `color.accent.contrast` |
| Colour (semantic) | `color.danger`, `color.warning`, `color.success`, `color.info` |
| Typography | `font.body`, `font.heading`, `font.mono`, `size.xs..size.xxl`, `weight.normal`, `weight.bold` |
| Layout | `radius.sm`, `radius.md`, `radius.lg`, `radius.full`, `space.0..space.6` |
| Effects | `shadow.sm`, `shadow.md`, `shadow.lg`, `blur.sm`, `blur.md` |

A pack can extend with custom tokens (`color.pack.bloodred`) but
the built-ins know nothing about those. Packs that override
built-in tokens get the cascade for free.

### 9.2 Themed preview

The canvas (§5.3) always renders against the **active theme**. A
small theme picker in the canvas top-bar lets the author switch
between defined themes (a pack can ship multiple themes — `light`,
`dark`, `colourblind` — and the player selects at runtime via
settings).

### 9.3 Pack-chain overrides

Themes cascade per the standard `last-pack-wins` PACK_CHAIN rules.
A child pack's `theme.json` merges into its parent's: tokens the
child defines win; tokens the child omits inherit.

UI tree overrides also use the chain. A child pack can ship a
`.ui.json` with the **same id** as a parent's tree (`hud:main`) to
fully replace it; or use a `*-override.ui.json` patch file with a
small subtree replacement keyed by node `id`:

```json
{
  "$schema": "ui-tree-patch/1",
  "id": "hud:main",
  "patches": [
    { "target": "topRightHUD",    "op": "replace", "node": { ... } },
    { "target": "ammoCounter",    "op": "remove" },
    { "target": "bottomBar",      "op": "appendChild", "node": { ... } }
  ]
}
```

`target` references node `id`s. `op` is one of `replace`,
`remove`, `appendChild`, `prependChild`, `insertBefore`,
`insertAfter`, `setProps`. The patch applies at pack-load after
the parent tree is registered; the merged result lives in the
registry.

Patches are visualised in UI Builder under the patch's source
pack — the editor shows the parent tree with a "patched by …"
overlay on every patched node.

---

## 10. Asset visibility

Image / icon / sprite / sound props pick from the editor's pack
asset library — the same surface the prefab Sprite picker and the
tile-preset texture picker use today. UI Builder is **another
consumer** of that library; it doesn't ship its own.

Inspector behaviour for asset props (§5.4):

- Clicking the prop's row opens a side panel (overlay-style) with
  the asset library filtered to compatible kinds. `Image.src` →
  filter to images; `Sprite.sprite` → filter to sprites;
  `*.bg` → images. Author picks → prop fills with
  `@assets/<path>`.
- The selected asset shows a thumbnail in the prop row, the same
  shape as the prefab Sprite picker's current display.
- Image Lab–baked recipes show with the `IL` badge (per
  [IMAGE_LAB.md §8.5](./IMAGE_LAB.md#85-il-badge--right-click-edit-
  recipe-anywhere)); right-click → "Edit recipe…" jumps to the
  Image Lab tab on that recipe. Same for `SL` on sounds
  ([SOUND_LAB.md §8.4](./SOUND_LAB.md)).
- Asset deletion (Assets tab) cascades: any prop in any tree
  referencing the deleted asset flags as a soft validation error
  in the Validation panel (§5.7). The tree still renders (with a
  broken-image fallback); the error surfaces in editor only.

---

## 11. Phased rollout

UB1–UB6, in order.

### UB1 — this plan doc

What you're reading. Shipped as `docs/plans/UI_BUILDER.md`. No
code changes. Updates `IDEAS.md` 2026-05-16 entry to "Planning"
and adds a link to this doc. No editor scaffolding yet — UB2
covers that.

Acceptance: this doc exists, cross-refs land in the docs listed
in §13, the editor-redesign R4i slot in `EDITOR_REDESIGN.md` §7
gains a backref.

### UB2 — runtime: `api.ui.renderTree` + built-in components

Engine-side work. No editor tab yet.

1. Schemas for the 24 built-in node types
   (`packages/engine/src/UI/schemas.ts`).
2. Renderer + walker
   (`packages/engine/src/UI/TreeRenderer.tsx`).
3. Per-node renderers (`packages/engine/src/UI/TreeNodes/*.tsx`).
4. Binding evaluator (`packages/engine/src/UI/bindings.ts`) —
   path resolution, pipe helpers, comparison helpers.
5. Action registry (`packages/engine/src/UI/actions.ts`) — the
   built-in `ui:*` ids, the registration API.
6. ModAPI surface in `packages/engine/src/ModAPI/types.ts` +
   `ModAPI/UIRegistry.ts` — `registerTree`, `reloadTree`,
   `registerAction`, `registerComponentType`, `bindVar`,
   `renderTree`, `toast`.
7. Theme loader (`packages/engine/src/UI/theme.ts`) — token table,
   resolver, cascade.
8. A single "kitchen-sink" tree fixture under
   `packages/engine/src/UI/__fixtures__/kitchen-sink.ui.json` that
   exercises every node type with every prop kind. Unit-test
   pixel-snapshots its render.
9. Default-pack porting: at least one existing pack UI surface
   (the simplest — likely `Toast`/notifications) ported from TSX
   to a `.ui.json`. Proof of concept that the contract holds; the
   author experience comes in UB3+.
10. `EDITOR_IFRAME.md §6` postMessage table grows by
    `reload-tree`, `reload-theme`, `reload-component-type`.

Acceptance: a tree authored in JSON renders identically to its
hand-written TSX equivalent; binding ticks update on a 30 Hz
schedule; events fire through the action registry; the kitchen-
sink snapshot is byte-stable across two consecutive runs.

### UB3 — editor tab MVP

The UI Builder PrimaryTab lands. Read-mostly + basic editing.

1. `apps/editor/src/views/UIBuilderView.tsx` shell — the 4-column
   layout per §5.1.
2. Tree view (§5.2) with click-to-select + basic drag-to-reparent.
3. Canvas (§5.3) Mock mode only. Surface size dropdown,
   background dropdown, zoom. Selection overlay.
4. Props inspector (§5.4) — schema-driven, with the standard
   primitive set (Input, Slider, ToggleSwitch, Select, ColorChip,
   asset picker reuse).
5. Component palette (§5.5) with the built-in categories.
6. Open-files bottom panel (§5.7 left). Validation panel (§5.7
   centre) wired to the schema validator from UB2.
7. Save / hot-reload — Cmd+S writes the JSON, postMessages the
   running iframe.
8. No theme editor, no custom types, no Live mode, no patches.

Acceptance: an author opens UI Builder, drags a `Stack` + `Text` +
`Bar` into a HUD tree, binds `Bar.value` to `{{ player.hp }}`,
saves, sees the change in the iframe — without editing any TSX.

### UB4 — theming + theme editor

1. Theme tokens table + cascade (UB2 partially shipped; UB4
   finishes the editor surface).
2. Theme editor right-rail panel (§5.6).
3. Theme picker on the canvas toolbar (§9.2).
4. Mock bindings tab (§5.3.1).
5. Hot reload for themes via `reload-theme`.
6. Default theme shipped in `packages/engine/src/UI/themes/default.json`.

Acceptance: an author changes `color.accent` from amber to teal in
the theme editor; every `Button.variant="primary"` across every
HUD recolours live; saving writes `theme.json` to the pack and
the chain cascade applies on pack-load.

### UB5 — custom components + advanced features

1. `api.ui.registerComponentType` + the Preact-renderer path.
2. `api.ui.registerTemplate` + the template-tree path.
3. The template editor (a `.ui.json` with `kind: "template"`).
4. Patch-file system (§9.3) — `*-override.ui.json`, the patch
   schema + applier in the engine, the editor's "patched by …"
   overlay.
5. Live mode (§5.3) — canvas reads bindings from the iframe
   telemetry stream.
6. Cycle mode (§5.3) — surface-size / mock-binding rotation.
7. Multi-select + bulk wrap / replace / delete.
8. Cross-tab drag-drop (drag asset from Assets tab onto a prop
   row).
9. `for`-loop authoring — the inspector exposes `for` as a first-
   class binding with autocomplete; loop-scope autocomplete in
   child node bindings (`{{ slot.itemId }}`).
10. Full default-pack port: every default-pack UI surface that
    can be a tree, *is* a tree. Surfaces that resist (SettingsScreen
    once it's engine-side, complex modals) stay as `registerModal`.

Acceptance: a child pack overrides one node of its parent's HUD
via a patch file; a custom `HUDPanel` template registered by a
parent pack is composable in child packs without re-registration;
Live mode mirrors the iframe's actual ammo count.

### UB6 — community-pack UI sharing (Store integration)

1. `Share to Community` button on the Export Targets panel
   (§5.7). Uploads the `.ui.json` (or template, or theme) to the
   Store as a stand-alone artefact alongside packs.
2. Store filter: "UI templates", "Themes", "HUDs" as discoverable
   categories.
3. "Use in this project" install flow — drops the artefact into
   the pack's `ui/` or `themes/` folder.
4. Reverse-deps: a HUD template's Store page shows "used by N
   packs" (per the STORE 2026-05-16 reverse-deps idea).
5. Theme + tree integrity: SHA-256 hash, same chain as pack
   integrity-hash (PACK_CHAIN.md).

Acceptance: an author shares a "Cyberpunk HUD" template; another
project installs it via the Store; the install flow drops the
JSON into the project; the editor's palette / Open files
immediately shows it.

---

## 12. Open questions

Captured as **resolved-required-before-UB2** vs **deferrable**.

### Q1 — Binding evaluation: per-tick re-walk vs subscription?

The simple model is "walk the tree at 30 Hz, evaluate every
binding, diff against last frame, re-render changed subtrees."
This is `O(nodes × bindings)` per tick — fine for HUDs (~20 nodes)
but pessimistic for a 200-node inventory.

The subscription model is "each binding registers a listener on
its world-state path; only mutations trigger re-walks of the
relevant subtree." Faster, but the world-state setters need to
broadcast on every write — invasive.

**Provisional resolution**: ship UB2 with the simple model + a
`tickHz` per-tree opt-out for trees that are mostly static (drop
to 1 Hz or `0` for on-demand). Revisit subscriptions if
profiling shows the walk costs > 0.5 ms/tick at 30 Hz on a
medium-size HUD.

Status: **deferrable** (perf, can iterate).

### Q2 — `for`-loop semantics: by-index vs by-key?

When `for: "{{ inventory.bag as slot }}"` re-iterates because the
bag array changed, the engine needs to decide whether to keep
node identity by *array index* (slot 0 is always slot 0) or by
some **stable key** (slot for "shotgun" is always the same DOM
node even if it moves index).

By-index is simpler. By-key is necessary for animation continuity
("the gold pile that just appeared, fade in"; "the sword I just
moved, slide animation").

**Provisional resolution**: default by-index. Optional
`forKey: "{{ slot.itemId }}"` to opt into by-key. UB5 ships the
opt-in.

Status: **resolved** (default chosen).

### Q3 — Modal stacking + focus management?

Multiple modals can be open at once (`Inventory` + `Settings` if
the player opens settings from inside inventory). The engine needs
to z-stack them and focus-trap appropriately.

**Provisional resolution**: each tree with `kind: "modal"` mounts
at a numeric `zIndex` starting at 100, incrementing in registration
order. The focus trap is per the most-recent-shown modal. Hide
restores focus to the previously-focused element. `Modal.props`
gets an `alwaysOnTop: boolean` for the rare case (e.g. confirm-
quit over everything).

Status: **resolved**.

### Q4 — How do trees coexist with the existing modals registry?

Today, `api.modals.isOpen(name)` tracks open modals. UB merges
trees + components in one registry (§6). Need to make sure
`isOpen` still works for tree-mounted modals + the existing API
doesn't break.

**Provisional resolution**: `registerTree(id, …)` registers the id
in the same modal registry. `api.modals.isOpen("inventory:main")`
returns true whether the implementation is a tree or a component.
The legacy API is preserved exactly. The new `api.ui.show/hide/
toggle` are thin wrappers over `api.modals.*`.

Status: **resolved** (additive only).

### Q5 — Schema-driven prop UI vs hand-rolled per-type?

The plan assumes a generic schema-driven inspector renders every
prop. Some props need bespoke UI (e.g. the `Slider.range` prop is
a `[min, max]` pair that wants a paired slider; `SlotGrid.slotTemplate`
wants a sub-tree picker, not a generic Select).

**Provisional resolution**: schema-driven by default. The schema
declares `editorWidget?: "rangeSlider" | "subtreePicker" | …` for
the bespoke cases. UB3 ships the generic + a handful of
`editorWidget` overrides. UB5 expands as needed.

Status: **deferrable** (schema is open-extension).

### Q6 — Pack-scoped vs global asset references in props?

A `.ui.json` in pack `mod-A` references `@assets/hud-bg.png` —
does that resolve to `mod-A`'s asset, or the active project's
asset, or a global registry?

**Provisional resolution**: lexically scoped to the file's
declaring pack. `@assets/hud-bg.png` in `mod-A/ui/hud.ui.json`
resolves to `mod-A`'s asset, even when `mod-A` is a dependency of
the active project. Cross-pack reference uses an explicit prefix:
`@pack:mod-A/assets/hud-bg.png`. Matches the pack-chain's mental
model.

Status: **resolved** (mirrors recipe semantics).

### Q7 — `if`/`for`-gated subtrees: garbage-collect on hide?

A `Box` with `if: "{{ menu.open }}"` is in the JSON tree
permanently but in the DOM only when the binding is truthy. Does
the renderer destroy + recreate the subtree on every toggle, or
keep it mounted and just `display:none`?

**Provisional resolution**: destroy + recreate by default — keeps
listeners + timers from leaking. A node prop `keepAlive: boolean`
opts into display:none semantics for performance-critical cases
(e.g. an inventory modal the player opens 30× per minute).

Status: **deferrable** (perf, can iterate).

### Q8 — Animation / transition vocabulary?

Per §1, full keyframe animation is out of scope. But "fade in on
mount" and "slide-in from right" are *common* in game HUDs.

**Provisional resolution**: ship a `transition` prop on every
node in UB3 with a small enum: `"fadeIn"`, `"slideInLeft"`,
`"slideInRight"`, `"slideInUp"`, `"slideInDown"`, `"scaleIn"`,
`"none"`. Durations are themed (`theme.duration.short`,
`theme.duration.normal`). UB6 may explore full keyframe authoring
using the Animation tab's keyframe editor (which already exists,
ANIMATION_EDITOR.md).

Status: **resolved** (small enum) + **deferrable** (keyframes).

### Q9 — Editor's mock bindings vs real type info?

The mock bindings file is freeform JSON. The bindings type-check
in `renderTree` are duck-typed. The editor cannot, without help,
know that `Bar.value` *should* be a number and surface the right
mock for it.

**Provisional resolution**: the engine ships a `world-state schema`
(generated from the pack's component declarations + `bindVar`
registrations + the engine's universal `player.*` shape). The
editor reads this schema to: validate bindings, autocomplete
binding paths, generate sensible defaults for the mock file when
the user adds a new node. UB4 ships the autocomplete; UB5 ships
the validate-on-save.

Status: **resolved** (schema-driven) + **deferrable** (impl).

### Q10 — How do trees consume responsive layout?

Game HUDs need to scale across 1080p / 1440p / 4K / mobile. The
existing engine has a [RESPONSIVE_DESIGN.md](./RESPONSIVE_DESIGN.md)
plan; UI Builder should hook into the same primitives.

**Provisional resolution**: trees inherit the engine's existing
responsive scale. A `responsive` prop per node (`responsive: {
"<1024": { fontSize: "sm" }, ">=1024": { fontSize: "md" } }`) is
**deferred** — UB2 ships single-layout, the responsive system
piggy-backs on RESPONSIVE_DESIGN's primitive. Revisit when that
plan ships.

Status: **deferrable**.

### Q11 — Editor: tree as JSON-edit fallback?

Some authors prefer JSON. Should UI Builder ship a JSON edit
mode (split-pane with the tree view + a Monaco editor on the
JSON)?

**Provisional resolution**: yes, but as **UB5 polish**. The
JSON-side edits round-trip through the schema validator; the
canvas updates as the user types. Inspired by Substance Designer's
"text mode."

Status: **deferrable**.

### Q12 — Toast surface — singleton tree per pack?

The Toast node defines style; toast *instances* mount imperatively
via `api.ui.toast(payload)`. The plan says "exactly one Toast
node per pack." But what if a pack wants different styles for
"error toast" vs "achievement toast"?

**Provisional resolution**: ship one Toast node per *severity* —
the pack's Toast file is a `Stack` of `Toast` nodes, each with a
distinct `severity` prop matching the severities the engine
emits. The engine looks up the matching severity at toast-mount
time. UB2 supports the single-Toast case; UB5 expands.

Status: **deferrable**.

### Q13 — Versioning: tree author vs runtime engine mismatch?

A pack ships a `.ui.json` at `$schema: "ui-tree/3"`. The engine is
at `ui-tree/2`. What happens?

**Provisional resolution**: the engine refuses to load the tree
+ logs a clear error pointing at the engine version. The editor
shows the same error in the validation panel. Migrations only run
backward (`v3 → v2` is impossible without losing data; `v1 → v2`
is what migrations are for).

Status: **resolved**.

### Q14 — Action handlers: synchronous vs async?

Some actions are async (`api.shop.buy` resolves on transaction
confirm). The plan says `(ctx) => void`. Does the engine await
async returns?

**Provisional resolution**: handlers may return a `Promise`; the
engine awaits before re-enabling the triggering button (UI prop
`disableDuringHandler: boolean`, default true on `Button.onClick`).
Errors thrown / rejected toast with severity `"error"` automatically
unless the handler explicitly catches.

Status: **resolved**.

### Q15 — Default-pack migration order?

UB5 says "every default-pack UI surface that *can* be a tree, *is*
a tree." Which ones go first? Order matters for risk management.

**Provisional resolution**: simplest first — Toast, HotbarStrip,
Minimap, Crosshair, ammo HUD, then InventoryScreen. Settings
stays code (it's moving back to engine-side anyway per EDITOR_
REDESIGN R4). MainMenu may stay code if its bespoke needs (cloud
saves, server browser) push past the declarative model.

Status: **resolved**.

---

## 13. Cross-references

- **[IDEAS.md](../IDEAS.md)** — origin entry: 2026-05-16 "UI
  Builder tab (visual pack-UI authoring)". This doc's UB1 closes
  the entry's "Planning" status (transitions from Captured →
  Planning when this doc lands).

- **[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md)** —
  - §6 (shell), §4 (R2 primitives — the inspector / palette /
    tree view use Slider / ToggleSwitch / ColorChip / etc.; UB
    primitives are **separate**: they're the things UB *outputs*,
    not the editor's own chrome).
  - §6.3 (PrimaryTabs) — UI Builder is slot 9, `LayoutTemplate`
    icon. Already listed.
  - §7 (R4i slot for UI Builder) — this doc fills in what R4i
    means. R4i now refers to UB3 (editor tab MVP); UB2 (runtime)
    is sibling-prerequisite work in the engine.

- **[IMAGE_LAB.md](./IMAGE_LAB.md)** —
  - §7.1 (canonical shared shell) — UB cribs the column rhythm
    and the keyboard / drag-drop conventions. The center column
    diverges (canvas, not graph workspace); everything around it
    matches.
  - §8 (asset visibility) — UB consumes the same asset library
    and the same "IL"/"SL" badge convention for recipe-backed
    assets.

- **[SOUND_LAB.md](./SOUND_LAB.md)** —
  - §7.1 (cross-references IMAGE_LAB §7.1). UB is the **third**
    such lab; the shell is now canonised across three sibling
    tabs.
  - §8.4 (`SL` badge) — UB's audio prop pickers honour the badge
    + right-click-to-edit convention.

- **[ENGINE_PACK_SPLIT.md](./ENGINE_PACK_SPLIT.md)** — `api.ui` is
  engine surface; the trees live in packs. UB2's ModAPI additions
  fit cleanly within the existing boundary.

- **[PACK_CHAIN.md](./PACK_CHAIN.md)** — UI trees + themes ship as
  pack assets, last-pack-wins on id collision, with patch-file
  support for sub-tree overrides (§9.3). The patch system is the
  most chain-coupled UB feature; UB5 lands it.

- **[STORE.md](./STORE.md)** — UB6 integrates with the Store.
  Trees, templates, and themes as shareable artefacts. Reverse-
  deps (per the 2026-05-16 STORE expansion IDEAS entry) apply —
  a popular HUD template's page shows the packs that use it.

- **[EDITOR_IFRAME.md](./EDITOR_IFRAME.md)** — UB2 adds three
  postMessages: `reload-tree`, `reload-theme`,
  `reload-component-type`. EDITOR_IFRAME §6 table grows by three
  rows. Live mode (UB5) also reads from the existing telemetry
  channel; no new transport.

- **The materials plan (shipped; see git log)** — parallel
  architectural pattern: declarative hierarchy (Shader cascade) +
  code escape hatch (a Preact component for UB / a raw hook file
  for materials). The UI-Builder docs cite materials as the
  precedent for "declarative-first with a code fallback" in
  engine surfaces.

- **[CONSOLE.md](./plans/CONSOLE.md)** *(when it lands)* — the
  dev console is a code-only surface; it does *not* go through
  UI Builder. The console reads `api.debug.stats()` the same way
  the Playtest panel does. Reference for "UB explicitly excludes
  the dev console" guidance (§6.1 table).

- **[AUDIO.md](./AUDIO.md)** — UB consumes `@sound/...` references
  the same way the rest of the editor does. Audio cue picking
  inside Button.onClickSound = the same picker as the prefab
  Audio component picker.

- **[ANIMATIONS.md](./ANIMATIONS.md)** / **[ANIMATION_EDITOR.md](./
  ANIMATION_EDITOR.md)** — the `Sprite` node binds animation clips
  the same way prefab sprite components do. UI Builder doesn't
  duplicate animation authoring; it consumes Animation tab output.

- **[RESPONSIVE_DESIGN.md](./RESPONSIVE_DESIGN.md)** — Q10
  (responsive trees) defers to that plan's primitive set.

This plan is the source-of-truth for UI Builder. Future direction
changes update this doc + add a back-reference entry to
[IDEAS.md](../IDEAS.md).
