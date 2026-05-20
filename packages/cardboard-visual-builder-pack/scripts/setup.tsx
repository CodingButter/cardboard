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
import { LayoutPanelTop, Library } from "lucide-react";
import { PanelBuilderView } from "../views/PanelBuilderView";
import { PanelLibraryPanel } from "../components/PanelLibraryPanel";
import { StorePathPicker } from "../components/StorePathPicker";
import { ScriptRefPicker } from "../components/ScriptRefPicker";
import {
  bumpDraftsRefresh,
  initPanelBuilderStore,
  teardownPanelBuilderStore,
} from "../state/usePanelBuilderStore";
import { saveDraft as saveDraftToIdb } from "../state/draftsStore";

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

  // VB4 — Undo / Redo / Save commands. Each registers a keybinding so
  // the host's shell keydown handler dispatches them globally without
  // the canvas needing focus. Commands live-unregister cleanly when
  // the pack is disabled (see Extensions tab); the returned
  // unregistrars are collected into `disposers` below.
  const unregUndo = ctx.registerCommand({
    id: "panelBuilder.undo",
    title: "Panel Builder: Undo",
    category: "Panel Builder",
    keybinding: "Ctrl+Z",
    // origin-only: the history stack lives on each window's local
    // store, and undo is a per-window concept. Broadcasting would
    // double-undo in popped-out builder windows.
    scope: "origin-only",
    run: () => {
      // Only act when the Panel Builder tab is the active surface —
      // a global Ctrl+Z must not stomp other tabs' undo paths. The
      // shell's keybinding dispatcher already runs commands ONLY
      // when their keybinding matches, and `panelBuilder.undo` only
      // exists while this pack is loaded, but we still guard against
      // overlapping bindings with a focus check inside text inputs.
      if (isFocusInsideEditableField()) return;
      store.getState().undo();
    },
  });
  const unregRedo = ctx.registerCommand({
    id: "panelBuilder.redo",
    title: "Panel Builder: Redo",
    category: "Panel Builder",
    keybinding: "Ctrl+Shift+Z",
    scope: "origin-only",
    run: () => {
      if (isFocusInsideEditableField()) return;
      store.getState().redo();
    },
  });
  const unregSave = ctx.registerCommand({
    id: "panelBuilder.save-draft",
    title: "Panel Builder: Save draft",
    category: "Panel Builder",
    scope: "origin-only",
    run: async () => {
      const state = store.getState();
      const defaultName = state.currentDraftName || state.spec.title || "Untitled";
      const name = window.prompt("Save draft as:", defaultName);
      if (!name) return;
      try {
        await saveDraftToIdb(name.trim(), state.spec);
        state.setCurrentDraftName(name.trim());
        bumpDraftsRefresh();
      } catch (e) {
        console.warn("[panel-builder.save-draft] failed:", e);
      }
    },
  });

  // ── VB5 — register Custom-node components ───────────────────────
  // The inspector's bind / when / onClick fields look these up by id
  // via `{ type: "Custom", component: "panel-builder.store-path-picker" }`.
  // Any pack-side inspector can reach the same pickers by referencing
  // the same ids — the registry is module-level on the renderer side
  // so cross-pack reuse comes free (per the dogfooding contract in
  // `docs/plans/JSON_VISUAL_BUILDER.md` §6.x).
  const unregStorePathPicker = ctx.registerCustomComponent(
    "panel-builder.store-path-picker",
    StorePathPicker as React.ComponentType<Record<string, unknown>>,
  );
  const unregScriptRefPicker = ctx.registerCustomComponent(
    "panel-builder.script-ref-picker",
    ScriptRefPicker as React.ComponentType<Record<string, unknown>>,
  );

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
    // VB4 — Panel Library dock panel. Registered as a regular
    // DockPanelDef so the user can add it to any view's layout
    // through the DocksModal. The Library re-fetches its IDB list
    // whenever `draftsRefreshTick` increments.
    //
    // The Library component takes no IDockviewPanelProps — same
    // shape as e.g. NotesPanel in the core editor pack. The cast
    // matches that pattern.
    ctx.registerPanel({
      id: "panel-builder-library",
      title: "Panel Library",
      category: "Panel Builder",
      component: PanelLibraryPanel as React.FunctionComponent,
      icon: <Library size={14} />,
      description:
        "Saved JSON Visual Builder drafts. Click a row to load. Drop a .json file to import.",
    }),
    unregAddPlaceholder,
    unregReset,
    unregUndo,
    unregRedo,
    unregSave,
    unregStorePathPicker,
    unregScriptRefPicker,
  ];

  return () => {
    for (const dispose of disposers) dispose();
    teardownPanelBuilderStore();
  };
}

/**
 * True when keyboard focus is inside an input / textarea / select /
 * contenteditable — used to gate the global undo/redo keybindings so a
 * user typing in an inspector field doesn't trigger an undo on every
 * Ctrl+Z press. The keybinding dispatcher runs `run()` regardless of
 * focus; the guard inside `run` is the cheapest place to keep that
 * behaviour scoped.
 */
function isFocusInsideEditableField(): boolean {
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (!(active instanceof HTMLElement)) return false;
  const tag = active.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    active.isContentEditable
  );
}
