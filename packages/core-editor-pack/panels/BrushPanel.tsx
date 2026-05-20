// Phase-1b JSON-driven panel — TSX shell registers commands; the
// visible body is rendered by the host's `<PanelRenderer/>` against
// the bundled JSON spec.
//
// P3 batch D migration. Moved from
// `apps/editor/src/views/scene/panels/BrushPanel.tsx` into the
// core-editor-pack with no behavioural changes. The JSON spec moves
// alongside the TSX file — `brush.json` now lives in this directory
// rather than `apps/editor/src/panel-renderer/specs/`. The shell-side
// copy stays until P4 retires it (PanelRenderer.test.ts still
// references it).
//
// Width-based tiny fallback ("Resize panel" message at panel width
// <120px) is NOT migrated — the JSON renderer has no panel-width
// reactive context yet.
//
// State source: Wave 3.3 — reads / writes via `useBrushStore`
// (externalised through `@cardboard/editor-shell`). The JSON spec
// binds directly to `store.brush.kind` (tile pressed state) and
// `store.brush.size` (slider + number input value).
import React from "react";
import { Brush } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
import type { PanelSpec } from "../../../apps/editor/src/panel-renderer/types";
// Externalised — `useBrushStore` is a Wave-3 synced store with a
// per-key BroadcastChannel; the pack MUST read/write through the host
// singleton or it gets an isolated copy with no cross-window sync.
// `PanelRenderer` subscribes to host-side stores via the binding
// resolver so it MUST run with host React + host stores too.
import {
  PanelRenderer,
  registerCommand,
  useBrushStore,
} from "@cardboard/editor-shell";
import { MOCK_BRUSHES, type BrushRow } from "./scene-fixtures";
// Bun bundles JSON imports inline — the spec ships as a literal in
// the compiled pack-script bundle.
import brushSpecJson from "./brush.json";

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

  // `data-tutorial-id="brush-panel"` anchors the built-in `intro-scene`
  // tutorial (TUTORIALS.md T1 — §5.3).
  return (
    <div
      data-tutorial-id="brush-panel"
      className="h-full w-full min-h-0"
    >
      <PanelRenderer spec={BRUSH_SPEC} />
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "brush",
  title: "Brush",
  category: "Tools",
  icon: <Brush size={12} />,
};

export default BrushPanel;
