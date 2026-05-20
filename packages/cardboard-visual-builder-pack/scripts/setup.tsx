/**
 * cardboard-visual-builder-pack — VB1 setup script.
 *
 * docs/plans/JSON_VISUAL_BUILDER.md §10 VB1.
 *
 * Workspace skeleton only: register a primary tab ("Panel Builder")
 * + a placeholder view (`PanelBuilderView`) that paints three empty
 * panes (palette / canvas / inspector). No drag-and-drop, no store,
 * no inspector logic — those land in VB2+.
 *
 * The id `panel-builder` is intentionally un-prefixed for VB1 per
 * the §10 "Open question: where do tab + view ids live?" decision.
 * If a future pack proposes the same id we'll revisit (last-write-
 * wins today).
 */

import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";
import React from "react";
import { LayoutPanelTop } from "lucide-react";
import { PanelBuilderView } from "../views/PanelBuilderView";

export default function setup(ctx: EditorPackContext): () => void {
  const disposers: Array<() => void> = [
    ctx.registerView("panel-builder", PanelBuilderView),
    ctx.registerTab({
      id: "panel-builder",
      label: "Panel Builder",
      icon: <LayoutPanelTop size={16} />,
      // VB1: the builder doesn't need an open project — a draft panel
      // is authored against the live shell registries (commands /
      // stores) regardless of which project (if any) is open. VB4 may
      // tighten this when the IDB sidecar lands.
      requiresProject: false,
      description:
        "JSON Visual Builder — drag-and-drop authoring for editor-panel JSON specs.",
    }),
  ];

  return () => {
    for (const dispose of disposers) dispose();
  };
}
