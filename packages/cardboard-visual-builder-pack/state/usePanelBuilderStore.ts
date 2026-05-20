/**
 * usePanelBuilderStore — JSON Visual Builder draft state.
 *
 * Backed by `ctx.createStore("panelBuilder", ...)` (see
 * `apps/editor/src/packs/editorPackLoader.ts:151`) so the renderer can
 * bind `$store.panelBuilder.<field>` from inside JSON panels and the
 * pack's own TSX views can subscribe via the returned Zustand hook.
 *
 * The hook is created lazily — `initPanelBuilderStore` is called from
 * inside setup.tsx which has access to the `EditorPackContext`. The
 * View component imports `getPanelBuilderStore` and gets the hook
 * back. The lazy-init pattern keeps the store creation tied to
 * pack-lifetime (createStore registers + the disposer unregisters)
 * without leaking into other packs / the global registry.
 *
 * VB3 scope (this file):
 *   • `spec` — the current draft PanelSpec.
 *   • `root` — derived alias of `spec.root`.
 *   • `selectedNodeId` — the id of the currently selected node, or null.
 *     Node ids are spec-tree paths (e.g. `"root"`, `"root.children.0"`)
 *     re-derived on every render; the store only persists the selected
 *     id-string.
 *   • `appendNode(node)` — append to the root Layout's children.
 *   • `replaceRoot(root)` — bulk replace (VB6 JSON-mode sync / library load).
 *   • `selectNode(id | null)` — set selection.
 *   • `updateNode(id, patch)` — merge a partial NodeSpec into the
 *     node addressed by `id`. Patch is shallow-merged (Object.assign)
 *     onto a copy of the existing node; nested object fields are
 *     replaced wholesale.
 *   • `deleteNode(id)` — prune the node addressed by `id` from its
 *     parent's children array. Clears selection if the deleted node was
 *     selected.
 *   • `resetDraft()` — reset to a fresh empty draft.
 *
 * VB4 extends with undo/redo and named-draft save/load via a
 * sidecar IDB (`state/draftsStore.ts`). The history stack lives ON
 * the store: every mutation (appendNode/updateNode/deleteNode/
 * replaceRoot/resetDraft) pushes a snapshot of the PRE-mutation spec
 * onto `history.entries`, capped at 100 entries. `undo` walks the
 * cursor backwards, `redo` walks it forwards. A new mutation while
 * cursor < entries.length truncates the redo branch — standard
 * "new edit destroys redo" semantics.
 *
 * Note on capture-side: we record the PRE-state at the time of the
 * mutation so undo restores it; redo plays the POST-state which is
 * captured alongside as the next entry. This is the classic
 * "every entry is a full snapshot" approach the editor's own
 * useHistoryStore uses (cf. `apps/editor/src/state/useHistoryStore.ts`).
 * Snapshot serialisation is O(n) per mutation; typical drafts have
 * <50 nodes so the cost is negligible.
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
  /** Currently selected node id (spec-tree path) or null when nothing
   *  is selected. Used by the canvas selection overlay + inspector. */
  selectedNodeId: string | null;
  /** Undo/redo history. Each entry is a snapshot of the spec at a
   *  given point. `cursor` is the index of the CURRENT spec; `undo`
   *  decrements + reloads the previous entry, `redo` increments +
   *  reloads the next. Capacity-capped at 100 to bound memory. */
  history: PanelBuilderHistory;
  /** Name of the most-recently-saved draft this builder session
   *  represents — populated by Save and Load. Drives the toolbar
   *  title + the default name on subsequent Save clicks. */
  currentDraftName: string | null;
  /** Monotonic counter — bumped by `bumpDraftsRefresh()` whenever the
   *  drafts IDB is mutated (Save / Delete / Import). The Library
   *  panel subscribes to this tick to re-fetch its list. Living on
   *  the panelBuilder store means the tick crosses cross-window via
   *  the same persistence/broadcast layer all dynamic stores get. */
  draftsRefreshTick: number;
}

export interface PanelBuilderHistory {
  /** Snapshots of `spec` ordered oldest → newest. `entries[cursor]` is
   *  the live spec at any point in time. */
  entries: PanelSpec[];
  /** Position of the live spec within `entries`. */
  cursor: number;
  /** Maximum stack depth. New pushes past this drop the oldest entry. */
  capacity: number;
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
  /** Replace the ENTIRE PanelSpec wholesale — title, id, dockKind,
   *  root, the lot. Used by VB6 JSON-mode sync where the user is
   *  editing the full spec as text. History snapshot is recorded
   *  same as any other mutation; selection is cleared because old
   *  node ids may no longer resolve. */
  replaceSpec: (spec: PanelSpec) => void;
  /** Reset to a fresh empty draft (new draftId, empty Layout root,
   *  cleared selection). */
  resetDraft: () => void;
  /** Set the selected node id (pass `null` to clear). */
  selectNode: (id: string | null) => void;
  /** Patch the node addressed by `id`. Shallow-merges the patch onto a
   *  copy of the node; the discriminant `type` is preserved (the patch
   *  must not change a node's discriminant — that's a delete + insert
   *  in the existing surface). */
  updateNode: (id: string, patch: Partial<NodeSpec>) => void;
  /** Remove the node addressed by `id` from its parent. Clears
   *  selection if the removed node was selected. No-op when `id` is
   *  `"root"` (the root is not deletable — pack delete instead). */
  deleteNode: (id: string) => void;
  /** Walk the history cursor backwards, restoring the previous
   *  snapshot. No-op when there's nothing to undo. */
  undo: () => void;
  /** Walk the history cursor forwards, restoring the next snapshot.
   *  No-op when there's nothing to redo. */
  redo: () => void;
  /** Load a full PanelSpec into the builder (used by Library load +
   *  Import). Resets history with the loaded spec as the new
   *  baseline. The optional `draftName` populates `currentDraftName`
   *  so subsequent Saves overwrite by default. */
  loadSpec: (spec: PanelSpec, draftName?: string | null) => void;
  /** Set the current draft name (used after Save names a draft). */
  setCurrentDraftName: (name: string | null) => void;
  /** Increment `draftsRefreshTick` — call after writing/deleting in
   *  the drafts IDB so the Library panel re-fetches. */
  bumpDraftsRefresh: () => void;
}

export type PanelBuilderStore = UseBoundStore<
  StoreApi<PanelBuilderState & PanelBuilderActions>
>;

// ---------------------------------------------------------------------------
// Spec-tree path helpers
// ---------------------------------------------------------------------------

/**
 * Node-id strategy: spec-tree path strings like
 *   "root"
 *   "root.children.0"
 *   "root.children.0.children.2"
 *   "root.child"            (Tooltip's single-child slot)
 *   "root.stages.0.content" (Tooltip stage content)
 *
 * Ids are stable across re-renders as long as the spec tree structure
 * is unchanged. Reordering siblings DOES change ids (a node at
 * `children.1` becomes `children.0` etc.) — that's an acceptable trade
 * for VB3 because reorder is a VB4+ feature and the inspector
 * rebinds via `selectedNodeId` on every interaction.
 *
 * Walking the spec tree is cheap (linear in node count, typical drafts
 * have < 50 nodes). Rebuilding on every render is correct + simple;
 * a memoised WeakMap would be premature optimisation here.
 */

/** Walk the spec tree, yielding `[id, node]` for every node. */
export function walkSpecNodes(
  root: NodeSpec,
): Array<{ id: string; node: NodeSpec }> {
  const out: Array<{ id: string; node: NodeSpec }> = [];
  walk(root, "root", out);
  return out;
}

function walk(
  node: NodeSpec,
  path: string,
  out: Array<{ id: string; node: NodeSpec }>,
): void {
  out.push({ id: path, node });
  // Node types with `children: NodeSpec[]` — Layout, Conditional, ScrollRow.
  if (
    node.type === "Layout" ||
    node.type === "Conditional" ||
    node.type === "ScrollRow"
  ) {
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i]!, `${path}.children.${i}`, out);
    }
  }
  // Tooltip has a single-child `child` slot + per-stage `content`.
  if (node.type === "Tooltip") {
    walk(node.child, `${path}.child`, out);
    for (let i = 0; i < node.stages.length; i++) {
      walk(node.stages[i]!.content, `${path}.stages.${i}.content`, out);
    }
  }
}

/** Find a node by id. Returns null when the id doesn't resolve. */
export function findNodeById(root: NodeSpec, id: string): NodeSpec | null {
  for (const entry of walkSpecNodes(root)) {
    if (entry.id === id) return entry.node;
  }
  return null;
}

/**
 * Apply a function to the node at `id`, returning a new root with the
 * replaced node. `fn` receives the existing node and returns either:
 *   • a replacement NodeSpec (which slots in at the same position), or
 *   • `null` to delete the node from its parent's children array.
 *
 * Returns the original root unchanged when `id` doesn't resolve.
 * Returns `null` if `id === "root"` and `fn` returns null (the root
 * isn't a parent's child — caller decides what to do).
 */
function transformAt(
  root: NodeSpec,
  id: string,
  fn: (node: NodeSpec) => NodeSpec | null,
): NodeSpec | null {
  if (id === "root") {
    return fn(root);
  }
  // Walk + rebuild on the way back up. id segments after "root." are
  // alternating field-names + indices.
  const segs = id.split(".").slice(1); // drop the leading "root"
  return rebuild(root, segs, fn);
}

function rebuild(
  node: NodeSpec,
  segs: string[],
  fn: (node: NodeSpec) => NodeSpec | null,
): NodeSpec | null {
  if (segs.length === 0) {
    return fn(node);
  }
  const [head, ...rest] = segs;
  // Layout / Conditional / ScrollRow → "children" + index
  if (
    (node.type === "Layout" ||
      node.type === "Conditional" ||
      node.type === "ScrollRow") &&
    head === "children"
  ) {
    const idxStr = rest[0];
    if (idxStr === undefined) return node;
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= node.children.length) {
      return node;
    }
    const childRest = rest.slice(1);
    const newChild = rebuild(node.children[idx]!, childRest, fn);
    const newChildren = [...node.children];
    if (newChild === null) {
      // Only "delete the addressed node itself" lands here when
      // childRest is empty. Splice the entry out.
      if (childRest.length === 0) {
        newChildren.splice(idx, 1);
      } else {
        // Deeper delete returned null — propagate by setting the slot.
        // This shouldn't happen with the public API (delete addresses
        // a specific id at any depth), but guard defensively.
        newChildren.splice(idx, 1);
      }
    } else {
      newChildren[idx] = newChild;
    }
    return { ...node, children: newChildren };
  }
  // Tooltip → "child" (single) or "stages.<i>.content"
  if (node.type === "Tooltip" && head === "child") {
    const newChild = rebuild(node.child, rest, fn);
    if (newChild === null) {
      // Deleting Tooltip.child is conceptually deleting the trigger —
      // the Tooltip becomes invalid. We keep the original to avoid
      // producing an unrenderable spec; users should delete the
      // tooltip itself instead.
      // eslint-disable-next-line no-console
      console.warn(
        "[panelBuilder] refusing to delete Tooltip.child — delete the Tooltip itself",
      );
      return node;
    }
    return { ...node, child: newChild };
  }
  if (node.type === "Tooltip" && head === "stages") {
    const idxStr = rest[0];
    const field = rest[1];
    if (idxStr === undefined || field !== "content") return node;
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= node.stages.length) {
      return node;
    }
    const contentRest = rest.slice(2);
    const stage = node.stages[idx]!;
    const newContent = rebuild(stage.content, contentRest, fn);
    if (newContent === null) {
      // Deleting a stage content — same defensive choice as Tooltip.child.
      // eslint-disable-next-line no-console
      console.warn(
        "[panelBuilder] refusing to delete Tooltip stage content — delete the Tooltip itself",
      );
      return node;
    }
    const newStages = [...node.stages];
    newStages[idx] = { ...stage, content: newContent };
    return { ...node, stages: newStages };
  }
  // Unknown path segment — return the node unchanged.
  return node;
}

// ---------------------------------------------------------------------------
// History helpers
// ---------------------------------------------------------------------------

/**
 * Maximum entries in the history stack. New pushes past this cap drop
 * the oldest entry; the cursor is rebased so the live snapshot stays
 * addressable. Mirrors `apps/editor/src/state/useHistoryStore.ts:91`.
 */
export const HISTORY_CAPACITY = 100;

/**
 * Push a new snapshot onto the history stack with "new edit destroys
 * redo" semantics: any redo-branch entries past the cursor are
 * discarded. Returns the next history shape; caller folds it into the
 * surrounding `set(...)`.
 */
export function pushHistory(
  history: PanelBuilderHistory,
  nextSpec: PanelSpec,
): PanelBuilderHistory {
  // Truncate to the cursor inclusive (entries up to and including the
  // current one), then append the new snapshot.
  const trimmed = history.entries.slice(0, history.cursor + 1);
  const appended = [...trimmed, nextSpec];
  if (appended.length > history.capacity) {
    const overflow = appended.length - history.capacity;
    return {
      ...history,
      entries: appended.slice(overflow),
      cursor: appended.length - overflow - 1,
    };
  }
  return {
    ...history,
    entries: appended,
    cursor: appended.length - 1,
  };
}

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
      selectedNodeId: null,
      history: {
        entries: [initialSpec],
        cursor: 0,
        capacity: HISTORY_CAPACITY,
      },
      currentDraftName: null,
      draftsRefreshTick: 0,
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
        set({
          spec: nextSpec,
          root: nextRoot,
          history: pushHistory(get().history, nextSpec),
        } as Partial<PanelBuilderState>);
      },
      replaceRoot: (root: NodeSpec): void => {
        const current = get().spec;
        const nextSpec: PanelSpec = { ...current, root };
        set({
          spec: nextSpec,
          root,
          // A replaceRoot may invalidate the current selection — drop it.
          selectedNodeId: null,
          history: pushHistory(get().history, nextSpec),
        } as Partial<PanelBuilderState>);
      },
      replaceSpec: (spec: PanelSpec): void => {
        set({
          spec,
          root: spec.root,
          // Old ids may not resolve in the new tree — drop selection.
          selectedNodeId: null,
          history: pushHistory(get().history, spec),
        } as Partial<PanelBuilderState>);
      },
      resetDraft: (): void => {
        const nextSpec = makeEmptyDraftSpec();
        set({
          spec: nextSpec,
          root: nextSpec.root,
          draftId: makeDraftId(),
          selectedNodeId: null,
          history: {
            entries: [nextSpec],
            cursor: 0,
            capacity: HISTORY_CAPACITY,
          },
          currentDraftName: null,
        } as Partial<PanelBuilderState>);
      },
      selectNode: (id: string | null): void => {
        set({ selectedNodeId: id } as Partial<PanelBuilderState>);
      },
      updateNode: (id: string, patch: Partial<NodeSpec>): void => {
        const current = get().spec;
        const newRoot = transformAt(current.root, id, (existing) => {
          // Shallow merge — copy the existing node + overlay the patch.
          // The patch's `type` is ignored (preserve the discriminant).
          // Cast to a record to merge safely without TS choking on the
          // discriminated-union shape.
          const merged = {
            ...(existing as Record<string, unknown>),
            ...(patch as Record<string, unknown>),
            type: existing.type,
          } as unknown as NodeSpec;
          return merged;
        });
        if (newRoot == null) return;
        const nextSpec: PanelSpec = { ...current, root: newRoot };
        set({
          spec: nextSpec,
          root: newRoot,
          history: pushHistory(get().history, nextSpec),
        } as Partial<PanelBuilderState>);
      },
      deleteNode: (id: string): void => {
        if (id === "root") return; // refuse — see semantics in interface.
        const current = get().spec;
        const newRoot = transformAt(current.root, id, () => null);
        if (newRoot == null) return;
        const nextSpec: PanelSpec = { ...current, root: newRoot };
        const wasSelected = get().selectedNodeId === id;
        // Also clear selection if the selected node is a DESCENDANT of
        // the deleted one (its id no longer exists in the new tree).
        const stillExists =
          get().selectedNodeId != null
            ? findNodeById(newRoot, get().selectedNodeId!) !== null
            : false;
        const nextSelectedId =
          wasSelected || !stillExists ? null : get().selectedNodeId;
        set({
          spec: nextSpec,
          root: newRoot,
          selectedNodeId: nextSelectedId,
          history: pushHistory(get().history, nextSpec),
        } as Partial<PanelBuilderState>);
      },
      undo: (): void => {
        const { history } = get();
        if (history.cursor <= 0) return;
        const nextCursor = history.cursor - 1;
        const snapshot = history.entries[nextCursor]!;
        set({
          spec: snapshot,
          root: snapshot.root,
          // Clear selection — undo could have removed the selected node.
          selectedNodeId: null,
          history: { ...history, cursor: nextCursor },
        } as Partial<PanelBuilderState>);
      },
      redo: (): void => {
        const { history } = get();
        if (history.cursor >= history.entries.length - 1) return;
        const nextCursor = history.cursor + 1;
        const snapshot = history.entries[nextCursor]!;
        set({
          spec: snapshot,
          root: snapshot.root,
          selectedNodeId: null,
          history: { ...history, cursor: nextCursor },
        } as Partial<PanelBuilderState>);
      },
      loadSpec: (spec: PanelSpec, draftName: string | null = null): void => {
        set({
          spec,
          root: spec.root,
          draftId: makeDraftId(),
          selectedNodeId: null,
          history: {
            entries: [spec],
            cursor: 0,
            capacity: HISTORY_CAPACITY,
          },
          currentDraftName: draftName,
        } as Partial<PanelBuilderState>);
      },
      setCurrentDraftName: (name: string | null): void => {
        set({ currentDraftName: name } as Partial<PanelBuilderState>);
      },
      bumpDraftsRefresh: (): void => {
        set({
          draftsRefreshTick: get().draftsRefreshTick + 1,
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

/**
 * Imperative helper: bump the drafts-refresh counter on the store.
 * Use after a save / delete / import to trigger Library panel
 * re-fetches. Cheaper than threading the action through every call
 * site that touches the drafts IDB.
 */
export function bumpDraftsRefresh(): void {
  const store = getPanelBuilderStore();
  if (!store) return;
  (store.getState() as PanelBuilderState & PanelBuilderActions).bumpDraftsRefresh();
}

/**
 * NOTE: the React `useDraftsRefreshTick` hook lives in
 * `state/usePanelBuilderHooks.ts` to keep this file React-free — the
 * pack's test file (run via `bun test` from the repo root) imports
 * pure helpers from here and the pack's package.json doesn't declare
 * `react` as a dep. View / panel components import the hook directly
 * from `./usePanelBuilderHooks`.
 */

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
