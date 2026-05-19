# Editor command + settings registries

The editor exposes two parallel registries, both implemented as zustand
stores in this directory:

| Registry | Store | Purpose |
|---|---|---|
| Commands | `useCommandStore` | Every interactive action — palette + global keybindings read from this single source. |
| Settings | `useSettingsStore` | Every user-tunable preference — `EditorSettingsModal` renders entirely from this registry. |

Both follow the same lifecycle as VSCode's `commands.registerCommand` /
`contributes.configuration`: components register their entries from a
`useEffect` on mount and the returned cleanup unregisters them on
unmount. Registries are **not persisted** — definitions are tied to live
React component lifetimes (a stale `run` closure outliving its component
would be a footgun). The settings store **does** persist value writes
behind `zustand/middleware`'s `persist`, but the metadata (titles,
defaults, type info) rebuilds on every mount.

---

## Canonical pattern — registering a command

Any component that owns a button, menu item, or keyboard-driven action
should register a corresponding command:

```tsx
import { registerCommand } from "../state/useCommandStore";

export function MyToolbar({ onSave }: { onSave: () => void }) {
  // Close over the latest handler via a ref so the registration effect
  // doesn't need to re-run on every prop change. This is the canonical
  // pattern across the codebase — copy it.
  const handlerRef = React.useRef(onSave);
  React.useEffect(() => {
    handlerRef.current = onSave;
  }, [onSave]);

  React.useEffect(() => {
    return registerCommand({
      id: "file.save",                // category.verb
      title: "Save Project",
      category: "File",               // grouping shown in the palette
      keywords: ["save", "persist"],  // synonyms for fuzzy search
      keybinding: "Ctrl+S",           // optional — auto-bound globally
      icon: <Save size={14} />,       // optional lucide glyph
      run: () => handlerRef.current(),
    });
  }, []);

  return <button onClick={onSave}>Save</button>;
}
```

Notes:

- `run` MUST delegate to the existing handler. Never duplicate logic.
  Clicking the button still calls the same function — the registry just
  adds a palette path to the same destination.
- The `keybinding` field is parsed by `lib/keybinding.ts` and matched
  against every keydown by the global handler in
  `shell/EditorShell.tsx`. Don't invent new shortcuts unless the action
  already has one.
- Stable ids in `category.verb` shape (`file.save`, `layouts.applyDefault`,
  `homescreen.openProject.<id>`). The palette uses these for the MRU
  ring and for keybinding lookup, so renaming an id is breaking.

### preMacro / postMacro — composing commands

Commands can declare two optional arrays of command ids that
`runById` will dispatch **around** the command's own `run()`:

```ts
registerCommand({
  id: "layouts.saveAsNew",
  title: "Save Current Layout as New",
  category: "Layouts",
  preMacro: ["workspace.openLayouts"], // ← runs first
  run: () => {
    /* save preset + flip editingPresetId */
  },
  // postMacro: ["analytics.notePresetCreated"], // ← would run after
});
```

Semantics:

- Both arrays default to empty — existing commands that don't set them
  behave exactly as before.
- `runById` is recursive through the macro arrays, so a pre-macro's
  own pre/post chain runs too. This is what lets the palette flow
  "Save Current as New" → open the modal (pre) → create the preset
  (run) → trigger any registered post-side effects without the
  command itself knowing about the modal at all.
- A per-invocation `visited: Set<string>` short-circuits cycles. If
  command `A` declares `preMacro: ["B"]` and `B` declares
  `preMacro: ["A"]`, the second occurrence is skipped with a
  `console.warn("[command-registry] cycle broken at \"A\"")`. The
  visited set is shared across the recursion, so a deep tree where two
  parents both reference the same pre-macro only runs that pre-macro
  once per top-level invocation.
- The visited set ALSO means MRU is recorded for the outermost command
  only — macros are an implementation detail and shouldn't pollute
  recents.

When to use macros vs. just calling the helper inline:

- **Use macros** when the surrounding step is itself a registered
  command that other paths might also want to compose with (modals,
  navigation, persistence flushes). The macro form is observable,
  introspectable from the palette, and unit-testable.
- **Inline** the call when the step is purely internal to this
  command's implementation and would clutter the command directory if
  registered.

### Dynamic registrations (variable lists)

When the command list is data-driven — user-saved layout presets, the
project list on Home, the panel registry per page — register from a
`useEffect` keyed on the underlying data. Each re-render produces a new
batch of registrations and the previous cleanup runs first:

```tsx
React.useEffect(() => {
  const unregs = projects.map((p) =>
    registerCommand({
      id: `homescreen.openProject.${p.id}`,
      title: `Open Project: ${p.name}`,
      category: "File",
      keywords: ["open", "project", p.name],
      run: () => onOpenProjectRef.current(p.id),
    }),
  );
  return () => unregs.forEach((u) => u());
}, [projects]);
```

This pattern works for layouts (re-registers when user presets change),
docks (re-registers when the page's panel registry changes), and the
home-screen project list (re-registers when projects are added/removed).

---

## Canonical pattern — registering a setting

Each existing setting becomes a `registerSetting` call colocated with
the component that owns it. Pick a `type` (`boolean` / `string` /
`number` / `select`) and a `scope`:

| Scope | Persistence | When to use |
|---|---|---|
| `global` (default) | `useSettingsStore`'s `persist` middleware | Editor-wide prefs (theme, font size). |
| `project` | `useWorkspaceStore` / `useProjectStore` (existing) | Per-project (workflow mode, manifest defaults). |
| `page` | Page-local store / localStorage | Per-page (Scene grid snap). |

For non-global scope the registry is just the discovery surface — the
actual value still lives in its existing store. The registered
`default` is the fallback shown in the modal until the real store
plugs in a value.

```tsx
import { registerSetting } from "../state/useSettingsStore";

React.useEffect(
  () =>
    registerSetting<boolean>({
      id: "editor.reduceMotion",
      title: "Reduce motion",
      category: "Appearance",
      description: "Disable non-essential animations.",
      type: "boolean",
      default: false,
      scope: "global",
    }),
  [],
);
```

The `EditorSettingsModal` (and future `ProjectSettingsModal` /
`PageSettingsModal`) iterates `useSettingsList(scope)` and renders a
control per `type` — booleans get a `ToggleSwitch`, numbers get a
`Slider` or `NumberInput`, selects get a `Select`, strings get a
`TextInput`. Once a setting is registered with a recognised type, it
shows up in the modal with NO additional code changes.

Reads + writes flow through `useSettingsStore.getState().get(id)` and
`.set(id, value)`. Reactive components should use the `useSettingValue`
hook for snapshot reads.

---

## Where registrations live today

- `shell/TopBar.tsx` — `file.save`, `file.export`, `editor.openSettings`,
  `playtest.toggle`.
- `shell/EditorShell.tsx` — `navigation.open*` (one per primary tab),
  bootstraps `editor.userInitials` (demo setting).
- `views/HomeScreen.tsx` — `homescreen.newProject`,
  `homescreen.openUrlPack`, `homescreen.openProject.<id>` (dynamic per
  project).
- `components/dock/WorkspacePanel.tsx` — `workspace.resetLayout`,
  `workspace.openLayouts`, `workspace.openDocks`,
  `workspace.openPageSettings`, `workspace.openPageHelp`,
  `layouts.saveAsNew`, `layouts.resave`, `layouts.apply.<id>` (dynamic
  per layout), `docks.add.<panelId>` (dynamic per panel).
- `views/EditorSettingsModal.tsx` — bootstraps `editor.theme`,
  `editor.accent`, `editor.keybindings`, `editor.autoSaveSec`,
  `editor.recentCap`, `editor.reduceMotion`. Renders all global-scope
  settings from the registry.

Adding a new command or setting only requires the registration call at
the owning component — the palette and settings modal pick them up
automatically.

---

## Cross-window DnD verification

The cross-window drag-and-drop subsystem (`docs/plans/CROSS_WINDOW_DND.md`)
rests on a platform assumption — that native HTML5 `dataTransfer.setData`
/ `getData` round-trips losslessly across dockview popouts. Phase D2
verified this empirically on Chromium 130 (Playwright bundle) with
dockview 6.3.0: a `DragEvent` dispatched on a drag source in the
orchestrator populated `dataTransfer` under both the per-kind MIME
(`application/x-cardboard-script`) and the JSON fallback; the same
DataTransfer reference re-read in the popped-out target via
`readDataTransfer` returned the structurally-identical payload, and
`useDragStore.currentDrag` propagated null → payload → null across
both windows via the LocalStorage storage-event spine in
`createSyncedStore`. The smoke harness lived at
`src/components/dnd/__d2_smoke__.tsx` and was torn down after the test.
Firefox is per §7.1 of the plan less consistent here; re-verify before
shipping a Firefox build.
