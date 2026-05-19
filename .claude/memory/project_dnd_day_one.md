---
name: project-dnd-day-one
description: Cross-window drag-and-drop is day-one foundational infrastructure. Must be designed and partially wired before Wave 3.3 panel migrations so panels are written DnD-aware from the start.
metadata:
  type: project
---

The cross-window drag-and-drop subsystem is a first-class, frequently-used part of the editor — not a bolt-on. Use cases include:

- Drag a script from Assets into the Script Component slot in EntityInspector (across popped windows).
- Drag a tile preset from TilePresets onto a cell in MapCanvas.
- Drag a prefab into the scene tree.
- Drag audio assets into sound triggers.

**Why:** The user explicitly flagged on 2026-05-19 that DnD "needs to be wired in day one as it will be used often." If migrations land first without DnD-aware design, every panel gets touched twice — once for the store migration in Wave 3.3, again later for DnD integration. That doubles the churn and risks scope creep on each panel.

**How to apply:**
- Wave 3.3 panel migrations are BLOCKED on the DnD design landing. Don't dispatch 3.3 work until the DnD plan doc + payload contract + DropZone primitive + useAssetStore + useDragStore are at least specified, ideally also scaffolded.
- The DnD subsystem must work across popped-out windows. Native HTML5 DnD payloads cross same-origin window boundaries via `dataTransfer.setData(MIME, JSON)` — the [[feedback-popout-state-sync]] foundation is necessary but not sufficient. We also need a broadcast-backed `useDragStore` so drop zones in OTHER windows can light up while a drag is in progress.
- Plan doc lives at `docs/plans/CROSS_WINDOW_DND.md`.
- When migrating a panel in Wave 3.3, write it as a drag source AND/OR drop target depending on its role — see the integration matrix in the plan doc.
- Each draggable kind gets its own MIME type prefix (`application/x-cardboard-*`) so drop zones can filter by `accepts`.
