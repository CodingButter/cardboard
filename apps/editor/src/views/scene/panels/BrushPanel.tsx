// Wave 3.4 — TSX → JSON migration.
//
// BrushPanel is now rendered from a JSON PanelSpec via
// `<PanelRenderer/>`. This file is the thin TSX host that:
//
//   1. Imports the JSON spec from `panel-renderer/specs/brush.json`.
//   2. Registers the static `scene.brush.sizeUp` / `sizeDown` commands
//      that the JSON spec's +/- buttons invoke by id.
//   3. Re-registers per-brush `scene.brush.set.<id>` commands on mount
//      so the tile-grid's `onClick` script refs resolve. Each command
//      sets `useBrushStore.kind` and is keyword-rich for the command
//      palette (matches the original TSX panel's contract).
//   4. Exports the same MANIFEST shape MapView consumes.
//
// Width-based tiny fallback ("Resize panel" message at panel width
// <120px) is NOT migrated — the JSON renderer has no panel-width
// reactive context yet. Flagged in the deliverable report; the spec
// just renders its content and lets Dockview clip when narrow.
//
// State source: Wave 3.3 — reads / writes via `useBrushStore`. The
// JSON spec binds directly to `store.brush.kind` (tile pressed state)
// and `store.brush.size` (slider + number input value).
import React from "react";
import { Brush } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { registerCommand } from "../../../state/useCommandStore";
import { useBrushStore } from "../../../state/useBrushStore";
import { PanelRenderer } from "../../../panel-renderer/PanelRenderer";
import type { PanelSpec } from "../../../panel-renderer/types";
import { MOCK_BRUSHES, type BrushRow } from "../scene-fixtures";
import brushSpecJson from "../../../panel-renderer/specs/brush.json";

const BRUSH_SPEC = brushSpecJson as PanelSpec;

/**
 * JSON-driven brush panel — TSX shell only owns command registration.
 * Everything visible lives in the imported JSON spec, rendered through
 * `<PanelRenderer/>`.
 */
export function BrushPanel(): React.JSX.Element {
  // Static size up/down commands. Registered once on mount. Command
  // bodies read live setters via `useBrushStore.getState()` so no
  // closure-ref dance is needed. The Plus/Minus icons live with the
  // command palette entry, not the panel button — palette consumers
  // (e.g. `MoreActions`) render them via `EditorCommand.icon`.
  React.useEffect(() => {
    const unregUp = registerCommand({
      id: "scene.brush.sizeUp",
      title: "Increase Brush Size",
      category: "Brush",
      keywords: ["brush", "size", "increase", "bigger", "grow"],
      run: () => useBrushStore.getState().sizeUp(),
    });
    const unregDown = registerCommand({
      id: "scene.brush.sizeDown",
      title: "Decrease Brush Size",
      category: "Brush",
      keywords: ["brush", "size", "decrease", "smaller", "shrink"],
      run: () => useBrushStore.getState().sizeDown(),
    });
    return () => {
      unregUp();
      unregDown();
    };
  }, []);

  // Dynamic per-brush commands. The JSON spec's tile buttons invoke
  // `scene.brush.set.<id>` — registering them here keeps the command
  // palette + global keybindings firing the same `setKind` setter.
  React.useEffect(() => {
    const unregs = (MOCK_BRUSHES as readonly BrushRow[]).map((b) =>
      registerCommand({
        id: `scene.brush.set.${b.id}`,
        title: `Set Brush: ${b.name}`,
        category: "Brush",
        keywords: ["brush", "set", b.name, b.kind],
        description: b.description,
        run: () => useBrushStore.getState().setKind(b.id),
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  return <PanelRenderer spec={BRUSH_SPEC} />;
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "brush",
  title: "Brush",
  category: "Tools",
  icon: <Brush size={12} />,
};

export default BrushPanel;
