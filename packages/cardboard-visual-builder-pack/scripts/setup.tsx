/**
 * cardboard-visual-builder-pack — VB2 setup script.
 *
 * docs/plans/JSON_VISUAL_BUILDER.md §10 VB2.
 *
 * VB1 shipped the workspace skeleton — a primary tab + placeholder
 * view. VB2 adds:
 *
 *   • A dynamic Zustand store ("panelBuilder") via `ctx.createStore`.
 *     The store carries the in-progress draft `spec` + a derived `root`
 *     alias the canvas pane binds to via the new `RenderSpec` node.
 *   • A `panel-builder.add-node` command — the canvas drop handler
 *     calls the store directly today, but the command also exists so
 *     scripted tests / keyboard shortcuts can drive insertion the
 *     same way every other interactive editor action does (per the
 *     `feedback-command-registry-required` memory).
 *
 * Cleanup: the returned teardown unregisters the tab + view + command,
 * and tears down the module-level store singleton. The dynamic-store
 * unregister is handled by the editor loader's `storeUnregistrars`
 * ring.
 */

import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";
import type { NodeSpec } from "../../../apps/editor/src/panel-renderer/types";
import React from "react";
import { LayoutPanelTop } from "lucide-react";
import { PanelBuilderView } from "../views/PanelBuilderView";
import {
  initPanelBuilderStore,
  teardownPanelBuilderStore,
} from "../state/usePanelBuilderStore";

export default function setup(ctx: EditorPackContext): () => void {
  // ── Create the pack's Zustand store ──────────────────────────────
  // `ctx.createStore` registers the hook against the renderer's
  // `DYNAMIC_STORES` map (see `resolveBinding.ts:194`) under the name
  // "panelBuilder" so JSON authored against the builder can bind
  // `$store.panelBuilder.root` / `$store.panelBuilder.spec.title`.
  // The hook is also reachable from the pack's TSX view via the
  // module-level singleton in `usePanelBuilderStore`.
  const store = initPanelBuilderStore(ctx);

  // ── Commands ─────────────────────────────────────────────────────
  // The canvas drop handler calls the store directly for VB2, but the
  // command is registered so future palette-keyboard activation /
  // scripted insertion / VB4 redo replay can land through the
  // canonical dispatch path. The placeholder command accepts no args
  // — it appends a sentinel Heading. VB3 wires a real `(template)`
  // signature.
  const unregAddPlaceholder = ctx.registerCommand({
    id: "panel-builder.add-placeholder-node",
    title: "Panel Builder: Add placeholder node",
    category: "Panel Builder",
    run: () => {
      const node: NodeSpec = {
        type: "Heading",
        text: "Placeholder",
        level: 3,
      };
      store.getState().appendNode(node);
    },
  });
  const unregReset = ctx.registerCommand({
    id: "panel-builder.reset-draft",
    title: "Panel Builder: Reset draft",
    category: "Panel Builder",
    run: () => {
      store.getState().resetDraft();
    },
  });

  // ── Tab + view ──────────────────────────────────────────────────
  const disposers: Array<() => void> = [
    ctx.registerView("panel-builder", PanelBuilderView),
    ctx.registerTab({
      id: "panel-builder",
      label: "Panel Builder",
      icon: <LayoutPanelTop size={16} />,
      requiresProject: false,
      description:
        "JSON Visual Builder — drag-and-drop authoring for editor-panel JSON specs.",
    }),
    unregAddPlaceholder,
    unregReset,
  ];

  return () => {
    for (const dispose of disposers) dispose();
    teardownPanelBuilderStore();
  };
}
