---
name: project-dogfooding-principle
description: Cardboard ships a minimal shell (primitives, Tailwind defaults, Zustand communication layer, pack-chain loader). EVERYTHING ELSE is a pack — including the editor we use ourselves. Same primitives, same APIs. Dogfooding is the only way to prove the system works.
metadata:
  type: project
---

**Operating principle (Jamie, 2026-05-19):** Cardboard ships ONLY the
shell. Everything else — including our own editor — is a pack on top
of that shell.

## What the shell ships

The shell is the union of:

- **Primitives** — `<DropZone>`, `<Tooltip>`, `<Modal>`, `<TabStrip>`,
  whatever the design system contains. Reusable React components.
- **Default styles** — Tailwind config + design tokens
  (`--color-bg-card`, `--color-accent`, etc.).
- **Communication layer** — `createSyncedStore` from `sync.ts`, the
  eight Wave-3 stores (`useToolStore`, `useSelectionStore`, etc.),
  the `applyRemote` / origin-tag echo discipline.
- **IDB layer** — `EditorProjectStore` (asset CRUD with bus
  invalidation).
- **Command registry** — `registerCommand`, `useCommandStore`.
- **Pack-chain loader** — load packs, merge manifests, resolve
  contributions, dedupe libraries by content hash.
- **Extension manager** — Editor Settings → Extensions for installing
  / enabling / disabling editor packs.

That's it. The shell is small, well-documented, stable.

## What the shell does NOT ship

- Toolbars, layouts, the home screen, the project picker, the
  scene tabs — **core editor pack**.
- Every dock panel — ToolPalette, Brush, TilePresets, Layers,
  SceneSettings, CellInspector, SelectionInfo, QuickTools, Output,
  Problems, History, Notes, Minimap, Preview, MapCanvas,
  EntityInspector, all of them — **core editor pack**.
- Custom inspectors, command-palette entries beyond shell-level
  commands, drag handlers — **core editor pack**.
- Anything game-domain-specific — fixtures, hardcoded layer
  taxonomies, hardcoded tile preset categories — **core editor
  pack** (or game-domain pack chained after it).

## Why this is non-negotiable

**Proof by construction.** If we can build the entire editor on top
of the shell's API surface, anyone else can build something on top of
it too. Anything we use that a third party CAN'T use is a leak in the
abstraction.

**Gap detection.** Every time we hit a need that the shell doesn't
expose, we extend the shell — and EVERYONE benefits, including future
us. If we instead added a private hook, the next person to want the
same thing has to reinvent it or fork the editor.

**No "special editor APIs."** No hidden surfaces. Same docs, same
examples, same imports. The Cheat Code Manager extension's author and
the Cardboard team's MapCanvas author use the exact same
`useDragStore` import statement.

**Forced API design discipline.** Knowing third parties will see and
use every primitive forces us to design them carefully — clear names,
small surfaces, no leaked implementation details.

## How to apply (every decision)

When introducing a new capability, ask:

1. **Could a third-party reasonably need this?** If yes — it belongs
   in the shell or as a published primitive. If no — it goes in the
   core editor pack.

2. **Are we using a different mechanism than a third party would?** If
   yes — that's a smell. The shell should expose what we use.

3. **Does this need a special hook only the editor has access to?** If
   yes — that's wrong. Find a way to make it a normal primitive.

4. **Would shipping this to a community-pack author embarrass us?** If
   yes — fix the API before shipping it.

## The endpoint

- `apps/editor/` shrinks to the shell.
- `packages/core-editor-pack/` (new workspace) holds everything
  currently in `apps/editor/src/views/` + `panels/` + page chrome.
- Game-domain helpers split further into a `packages/cardboard-game-extras-pack/`
  or just live in the same core pack initially.
- Third-party extension packs ride alongside the core pack in the
  same chain.

Related plans + memories:
- [[project-editor-package-injection]] — the marketplace fallout.
- [[feedback-popout-state-sync]] — the cross-window sync primitive
  the shell exposes.
- `docs/plans/PACK_CHAIN.md` — the loader the shell uses.
- Task #19 (core editor pack), Task #20 (library bundling).
