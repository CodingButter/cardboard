---
name: feedback-command-registry-required
description: Every new editor action or setting MUST register via registerCommand / registerSetting in apps/editor/src/state/useCommandStore.ts and useSettingsStore.ts. Agent briefs that introduce UI actions or settings must include the registration directive verbatim.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

The editor has a central command + settings registry (zustand stores: `useCommandStore`, `useSettingsStore` in `apps/editor/src/state/`). Every interactive action and every user-tunable preference flows through these so they become automatically searchable via the VSCode-style palette (Ctrl+P / Ctrl+Shift+P + the TopBar search input).

**Why:** Without this, half the editor's features hide behind menus the user can't find. The palette is only useful if EVERY action is registered — gaps make the surface untrustworthy.

**How to apply (every future agent brief that touches editor UI):**

Include this directive verbatim:

> Any new action (button click, menu item, keybinding, etc.) MUST be registered via `registerCommand({ id, title, category, keywords?, keybinding?, icon?, run })` from `apps/editor/src/state/useCommandStore.ts`. Components register from `useEffect(() => registerCommand({...}), [...])` and return the unregister.
>
> Any new user-tunable preference MUST be registered via `registerSetting({ id, title, category, type, default, scope?, ... })` from `apps/editor/src/state/useSettingsStore.ts`. Read/write through `useSettingsStore.getState().get(id)` / `.set(id, value)`. Settings reuse the existing source of truth (workspace store, project store, etc.) — the registry is the discovery layer, NOT a parallel storage system.
>
> Categories: 'File' / 'Edit' / 'View' / 'Workspace' / 'Navigation' / 'Help' (consistent for palette grouping).
>
> The button or menu handler that owns the action's existing UX MUST still work — `registerCommand`'s `run` just CALLS the same handler. Don't create parallel implementations.

**When the registry is the only acceptable surface:**
- Toolbar buttons
- Menu items
- Keyboard shortcuts (declared as `keybinding` on the command)
- Settings UI fields (auto-rendered from registry — coming in a follow-up)

**Exceptions:**
- Pure layout chrome (e.g. drag handles, splitters) — not "actions" in the discoverability sense.
- Engine-internal events (per-frame ticks, pack lifecycle) — not user-facing.

When in doubt, register it.
