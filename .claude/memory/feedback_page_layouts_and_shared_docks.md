---
name: feedback-page-layouts-and-shared-docks
description: "Every page build must include (a) predefined layouts the user can switch to, (b) page-specific opt-in dock panels available via the Docks modal even when not in default layout, and (c) shared dock panels (Output, Problems, Notes, History, Assets) registered across all pages."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "make sure that each page has available layouts too. not just the scene page, also make sure to work on any docks that make sense for the page but just may not be visible in our default layouts that should be a step during every page. also make sure any shared dock panels exist in the panel modal."

**Three additions to the page-build playbook (Phase 3b):**

## 1. Predefined layouts per page

Every page must register 3-5 predefined layouts in `apps/editor/src/state/predefinedLayouts.ts` keyed by page id. Each layout has an id, a human label, a `SerializedDockview` JSON snapshot, and an optional description. The Workspace rail's "Layouts" modal reads these and lets the user one-click apply.

## 2. Page-specific opt-in dock panels

Beyond the default-visible panels, every page should expose additional opt-in panels via the Docks modal. These are panels that make sense for the page but aren't worth using default real estate for.

For Scene: Minimap / History / PrefabBrowser / Lighting / Notes / AssetReferences — already done.
For Prefabs: ComponentLibrary / TagManager / AnimationTimeline / TestPlayfield.

Pick 2-4 sensible ones and build stubs in Phase 1; bodies in a later wave.

## 3. Shared dock panels across pages

| Panel | Scope |
|---|---|
| Output | project-global (one log stream) |
| Problems | project-global (one diagnostic list) |
| Notes | page-scoped (per page) |
| History | page-scoped (per page) |
| AssetReferences | project-global (project's asset graph) |

These panels must be registered in EVERY page's PANELS array. Factor a `SHARED_PANELS` constant in `apps/editor/src/views/sharedPanels.ts` that each page imports and spreads into its own PANELS array.

Persistence keys for page-scoped panels use the page id prefix (`cardboard.<page>.notes.text`).
