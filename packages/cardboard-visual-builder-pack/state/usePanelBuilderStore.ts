/**
 * usePanelBuilderStore — JSON Visual Builder VB2 draft state.
 *
 * Backed by `ctx.createStore("panelBuilder", ...)` (see
 * `apps/editor/src/packs/editorPackLoader.ts:151`) so the renderer can
 * bind `$store.panelBuilder.<field>` from inside JSON panels and the
 * pack's own TSX views can subscribe via the returned Zustand hook.
 *
 * The hook is created lazily — `getStore()` is called from inside
 * setup.tsx which has access to the `EditorPackContext`. The View
 * component imports `usePanelBuilderStore` and gets the hook back. The
 * lazy-init pattern keeps the store creation tied to pack-lifetime
 * (createStore registers + the disposer unregisters) without leaking
 * into other packs / the global registry.
 *
 * VB2 scope:
 *   • `spec` — the current draft PanelSpec.
 *   • `root` — a derived alias of `spec.root` so JSON panels can
 *     bind `$store.panelBuilder.root` without traversing two
 *     levels. The renderer's `RenderSpec` node reads through this
 *     path on the builder's canvas pane.
 *   • `appendNode(node)` — append to the root Layout's children.
 *     The canvas drop handler calls this on every successful drop.
 *   • `replaceRoot(root)` — bulk replace for VB6 JSON-mode sync /
 *     library load. Exposed early so the surface stabilises.
 *
 * VB3+ extends this with selection, undo/redo, save/load. Out of scope
 * here.
 */

import type { NodeSpec, PanelSpec, LayoutNode } from "../../../apps/editor/src/panel-renderer/types";
import type { EditorPackContext } from "../../../apps/editor/src/packs/editorPackLoader";
import type { StoreApi, UseBoundStore } from "zustand";

/**
 * Default empty draft — a Layout-rooted, dockable-window-shaped
 * PanelSpec. The Layout root is what the canvas drop-target appends
 * children INTO; replacing it loses that contract.
 */
export function makeEmptyDraftSpec(): PanelSpec {
  return {
    id: "untitled",
    title: "Untitled",
    category: "Inspector",
    dockKind: "dockable-window",
    root: {
      type: "Layout",
      direction: "column",
      gap: 2,
      children: [],
    },
  };
}

/** State shape exposed via `$store.panelBuilder.<field>`. */
export interface PanelBuilderState {
  /** The current draft. Edited in place by the pack's own actions. */
  spec: PanelSpec;
  /** Alias of `spec.root` so the canvas pane's `RenderSpec` can bind
   *  to a one-segment path. Kept in sync by every mutation. */
  root: NodeSpec;
  /** Stable id for the draft session. */
  draftId: string;
}

/** Actions exposed on the same hook as the state. */
export interface PanelBuilderActions extends Record<string, unknown> {
  /** Append a node to the root Layout's children. No-op when the root
   *  isn't a Layout (defensive — `makeEmptyDraftSpec` always returns
   *  a Layout root, but `replaceRoot` could land a non-container). */
  appendNode: (node: NodeSpec) => void;
  /** Replace the root NodeSpec wholesale. Used by VB4 load + VB6
   *  JSON-mode sync. */
  replaceRoot: (root: NodeSpec) => void;
  /** Reset to a fresh empty draft (new draftId, empty Layout root). */
  resetDraft: () => void;
}

export type PanelBuilderStore = UseBoundStore<
  StoreApi<PanelBuilderState & PanelBuilderActions>
>;

// ---------------------------------------------------------------------------
// Lazy-init singleton
// ---------------------------------------------------------------------------

let storeSingleton: PanelBuilderStore | null = null;

/**
 * Build the store via `ctx.createStore`. Called once from setup.tsx
 * during pack init. Subsequent calls throw — re-initialising would
 * stomp the previous store + leak the dynamic-store registration.
 */
export function initPanelBuilderStore(
  ctx: EditorPackContext,
): PanelBuilderStore {
  if (storeSingleton) {
    throw new Error(
      "[cardboard-visual-builder] initPanelBuilderStore called twice — " +
        "the pack's setup.tsx should only init the store once per load.",
    );
  }
  const initialSpec = makeEmptyDraftSpec();
  const hook = ctx.createStore<PanelBuilderState, PanelBuilderActions>(
    "panelBuilder",
    {
      spec: initialSpec,
      root: initialSpec.root,
      draftId: makeDraftId(),
    },
    (set, get) => ({
      appendNode: (node: NodeSpec): void => {
        const current = get().spec;
        if (current.root.type !== "Layout") {
          // Defensive: VB2 only appends into a Layout. The empty
          // draft IS a Layout, and replaceRoot today drops nothing
          // non-Layout in. If a VB6 JSON edit lands a non-Layout
          // root, append becomes a no-op until the user wraps it.
          console.warn(
            "[cardboard-visual-builder] appendNode called on a non-Layout " +
              "root (type=" +
              current.root.type +
              "); ignoring. Wrap the root in a Layout first.",
          );
          return;
        }
        const rootLayout: LayoutNode = current.root;
        const nextRoot: LayoutNode = {
          ...rootLayout,
          children: [...rootLayout.children, node],
        };
        const nextSpec: PanelSpec = { ...current, root: nextRoot };
        set({ spec: nextSpec, root: nextRoot } as Partial<PanelBuilderState>);
      },
      replaceRoot: (root: NodeSpec): void => {
        const current = get().spec;
        const nextSpec: PanelSpec = { ...current, root };
        set({ spec: nextSpec, root } as Partial<PanelBuilderState>);
      },
      resetDraft: (): void => {
        const nextSpec = makeEmptyDraftSpec();
        set({
          spec: nextSpec,
          root: nextSpec.root,
          draftId: makeDraftId(),
        } as Partial<PanelBuilderState>);
      },
    }),
  );
  storeSingleton = hook;
  return hook;
}

/**
 * Get the panel-builder store hook. The pack's view component imports
 * this — every render reads the live hook (so HMR / dev re-mounts pick
 * up the post-init reference).
 *
 * Returns `null` when the store hasn't been initialised yet — the view
 * should render an empty / loading state in that case rather than
 * crashing. In practice setup.tsx runs before the view mounts (the
 * loader sequence) so the null branch only kicks in during the brief
 * pre-load window.
 */
export function getPanelBuilderStore(): PanelBuilderStore | null {
  return storeSingleton;
}

/**
 * Tear down the singleton — called from the setup-script disposer so
 * a future re-load gets a fresh slot. The dynamic-store unregister is
 * handled separately by the editor loader's `storeUnregistrars`.
 */
export function teardownPanelBuilderStore(): void {
  storeSingleton = null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cheap unique-ish id for a draft. Not cryptographic — just enough to
 * distinguish drafts within a session. Uses Math.random + a timestamp
 * so two drafts created in the same millisecond don't collide.
 */
function makeDraftId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}
