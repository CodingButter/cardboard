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
