/**
 * PanelBuilderView — JSON Visual Builder VB3 (selection + inspector).
 *
 * VB2 shipped palette + canvas + recursive `<PanelRenderer>`. VB3 adds:
 *
 *   • A `<NodeIdProvider>` wraps the canvas's `<PanelRenderer>`. Every
 *     rendered NodeSpec gets `data-cardboard-node-id` attached to its
 *     root DOM element (zero-cost when no provider is mounted — see
 *     the `NodeIdProvider` contract in `panel-renderer/PanelRenderer.tsx`).
 *   • A delegated click handler on the canvas wrapper resolves clicks
 *     to node ids by walking up the DOM from the event target to the
 *     nearest `[data-cardboard-node-id]`. The id is committed to the
 *     panel-builder store via `selectNode(id)`.
 *   • A CSS rule (injected via `<style>` keyed off the selected id)
 *     paints an amber outline ring around the selected node. The rule
 *     is regenerated on every selection change so it always targets
 *     the live id.
 *   • A `keydown` listener on the canvas wrapper handles Delete +
 *     Backspace, deleting the selected node. Focus inside an input
 *     short-circuits the handler so users can still backspace inside
 *     the inspector forms.
 *   • The Inspector pane (right side) renders `<NodeInspector>` when
 *     the selection resolves to a real node; otherwise an empty state.
 *
 * The view is a TSX panel (not JSON) because:
 *   • Selection + delete + inspector wiring is imperative — no
 *     equivalent in the JSON renderer surface yet.
 *   • The inspector forms are per-node-type bespoke React components.
 *
 * VB4 splits the inspector into a JSON-authored panel reading the
 * store + a small set of `Custom` node-type inspectors. Out of scope
 * here.
 */

import React from "react";
import {
  ArrowRightLeft,
  Boxes,
  Download,
  FilePlus,
  GitBranch,
  Hash,
  Heading1,
  LayoutDashboard,
  ListFilter,
  MessageSquare,
  MousePointerClick,
  Redo2,
  Save,
  SlidersHorizontal,
  Space,
  Square,
  Star,
  TextCursorInput,
  ToggleLeft,
  Type,
  Undo2,
} from "lucide-react";
import {
  PanelRenderer,
  NodeIdProvider,
  EmptyState,
} from "@cardboard/editor-shell";
import type {
  NodeSpec,
  PanelSpec,
} from "../../../apps/editor/src/panel-renderer/types";
import {
  encode,
  decode,
  MIME,
  type DndPayload,
} from "../../../apps/editor/src/state/dnd/payload";
import {
  PALETTE_CATALOG,
  type PaletteEntry,
} from "../components/paletteCatalog";
import {
  getPanelBuilderStore,
  walkSpecNodes,
  findNodeById,
  bumpDraftsRefresh,
  type PanelBuilderState,
  type PanelBuilderActions,
} from "../state/usePanelBuilderStore";
import {
  saveDraft as saveDraftToIdb,
  type PanelDraftRow,
} from "../state/draftsStore";
import { NodeInspector } from "../components/NodeInspector";

const CANVAS_HOST_SPEC: PanelSpec = {
  id: "panel-builder-canvas-host",
  title: "",
  category: "Custom",
  dockKind: "dockable-window",
  rootOptions: { padding: 0, bare: true },
  root: {
    type: "RenderSpec",
    from: "store.panelBuilder.root",
  },
};

const PALETTE_DRAG_ORIGIN = "cardboard-visual-builder.palette";

function buildPaletteDragPayload(
  entry: PaletteEntry,
): DndPayload<"panelBuilderNode"> {
  return {
    v: 1,
    kind: "panelBuilderNode",
    id: `palette/${entry.kind}`,
    label: entry.label,
    origin: PALETTE_DRAG_ORIGIN,
    meta: {
      source: "palette",
      nodeType: entry.kind,
      template: entry.template as unknown as Record<string, unknown>,
    },
  };
}

const PALETTE_ICONS: Record<
  string,
  React.ComponentType<{ size?: number }>
> = {
  ArrowRightLeft,
  Boxes,
  GitBranch,
  Hash,
  Heading1,
  LayoutDashboard,
  ListFilter,
  MessageSquare,
  MousePointerClick,
  SlidersHorizontal,
  Space,
  Square,
  Star,
  TextCursorInput,
  ToggleLeft,
  Type,
};

function lucideIcon(
  name: string,
): React.ComponentType<{ size?: number }> | null {
  return PALETTE_ICONS[name] ?? null;
}

// ---------------------------------------------------------------------------
// Palette pane
// ---------------------------------------------------------------------------

interface PaletteTileProps {
  entry: PaletteEntry;
}

function PaletteTile({ entry }: PaletteTileProps): React.JSX.Element {
  const Icon = React.useMemo(() => lucideIcon(entry.iconName), [entry.iconName]);
  const onDragStart = React.useCallback(
    (e: React.DragEvent<HTMLButtonElement>) => {
      const payload = buildPaletteDragPayload(entry);
      const body = encode(payload);
      e.dataTransfer.setData(MIME.panelBuilderNode, body);
      e.dataTransfer.setData("application/json", body);
      e.dataTransfer.effectAllowed = "copy";
    },
    [entry],
  );
  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      title={entry.description}
      className={[
        "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left",
        "border border-zinc-800 bg-zinc-900",
        "hover:border-amber-500/60 hover:bg-zinc-800/60",
        "transition-colors cursor-grab active:cursor-grabbing",
      ].join(" ")}
      data-palette-kind={entry.kind}
      aria-label={`${entry.label} — drag onto the canvas`}
    >
      <span
        className="inline-flex items-center justify-center w-5 h-5 shrink-0 text-zinc-400"
        aria-hidden="true"
      >
        {Icon ? <Icon size={14} /> : null}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-xs text-zinc-100 font-medium leading-tight truncate">
          {entry.label}
        </span>
        <span className="text-[10px] text-zinc-500 leading-tight truncate">
          {entry.description}
        </span>
      </span>
    </button>
  );
}

function PalettePane(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto h-full">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-1 pb-1">
        Palette
      </div>
      {PALETTE_CATALOG.map((entry) => (
        <PaletteTile key={entry.kind} entry={entry} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live state subscription
// ---------------------------------------------------------------------------

/**
 * Subscribe to the panel-builder store and re-render on every change so
 * the empty-state UI flips when the user drops the first node. Returns
 * the live state slice the canvas needs.
 *
 * The store hook is null briefly before `setup.tsx` runs — render an
 * inert "initialising" branch in that case rather than throwing.
 */
function usePanelBuilderState(): PanelBuilderState | null {
  const store = getPanelBuilderStore();
  const subscribe = React.useMemo(
    () =>
      (cb: () => void): (() => void) => {
        if (!store) return () => {};
        return store.subscribe(cb);
      },
    [store],
  );
  const getSnapshot = React.useMemo(
    () =>
      (): PanelBuilderState | null => {
        return store ? (store.getState() as PanelBuilderState) : null;
      },
    [store],
  );
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function getActions(): (PanelBuilderState & PanelBuilderActions) | null {
  const store = getPanelBuilderStore();
  if (!store) return null;
  return store.getState() as PanelBuilderState & PanelBuilderActions;
}

// ---------------------------------------------------------------------------
// Canvas pane
// ---------------------------------------------------------------------------

/**
 * `getId` factory: build a reference-identity map of NodeSpec → id from
 * the current root, then close over it for the `<NodeIdProvider>`.
 *
 * Rebuilt on every render of the canvas because spec mutations create
 * fresh NodeSpec objects (the store's `appendNode` / `updateNode` /
 * `deleteNode` return new tree slices) — the old map's keys would be
 * stale references. The walk is O(n) where n is the spec node count,
 * typical drafts have <50 nodes so the cost is negligible. Memoised on
 * `root` reference so re-renders that don't change the tree don't
 * rebuild.
 */
function useNodeIdMap(root: NodeSpec): (node: NodeSpec) => string | undefined {
  const map = React.useMemo(() => {
    const m = new WeakMap<NodeSpec, string>();
    for (const { id, node } of walkSpecNodes(root)) {
      m.set(node as NodeSpec, id);
    }
    return m;
  }, [root]);
  return React.useCallback(
    (node: NodeSpec) => map.get(node),
    [map],
  );
}

/** Walk the DOM from a target up to the nearest ancestor that carries a
 *  `data-cardboard-node-id` attribute. Returns the id (or null when no
 *  such ancestor exists). `boundary` is the canvas's outer element —
 *  the walk stops there to avoid escaping into unrelated DOM. */
function findNodeIdFromTarget(
  target: EventTarget | null,
  boundary: HTMLElement | null,
): string | null {
  if (!(target instanceof HTMLElement)) return null;
  let el: HTMLElement | null = target;
  while (el && el !== boundary) {
    const id = el.getAttribute("data-cardboard-node-id");
    if (id) return id;
    el = el.parentElement;
  }
  return null;
}

/**
 * Validate an unknown value as a `PanelSpec`. The check is structural —
 * the renderer's `PanelRenderer` is itself defensive about bad nodes, so
 * we only gate the obviously-broken cases (missing top-level fields).
 */
function isPanelSpec(value: unknown): value is PanelSpec {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.category === "string" &&
    typeof v.dockKind === "string" &&
    !!v.root &&
    typeof v.root === "object"
  );
}

/** Export the current spec as `<name>.json` via a Blob download. */
function downloadSpecAsJson(spec: PanelSpec, baseName: string): void {
  const safeName = baseName.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/-+/g, "-");
  const fileName = `${safeName || "panel"}.json`;
  const blob = new Blob([JSON.stringify(spec, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Canvas toolbar — Save / Export / Import / Undo / Redo. Lives above
 * the canvas drop-target so the actions stay in reach while authoring.
 */
function CanvasToolbar(): React.JSX.Element {
  const state = usePanelBuilderState();
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const canUndo = state ? state.history.cursor > 0 : false;
  const canRedo = state
    ? state.history.cursor < state.history.entries.length - 1
    : false;
  const currentName = state?.currentDraftName ?? null;

  const onSave = React.useCallback(async () => {
    const actions = getActions();
    if (!actions) return;
    const defaultName = currentName || actions.spec.title || "Untitled";
    const name = window.prompt("Save draft as:", defaultName);
    if (!name) return;
    try {
      await saveDraftToIdb(name.trim(), actions.spec);
      actions.setCurrentDraftName(name.trim());
      bumpDraftsRefresh();
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Failed to save draft");
    }
  }, [currentName]);

  const onExport = React.useCallback(() => {
    const actions = getActions();
    if (!actions) return;
    const baseName = currentName || actions.spec.title || actions.spec.id || "panel";
    downloadSpecAsJson(actions.spec, baseName);
  }, [currentName]);

  const onImport = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text) as unknown;
        if (!isPanelSpec(parsed)) {
          setError(
            `"${file.name}" doesn't look like a PanelSpec — missing id/title/category/dockKind/root.`,
          );
          return;
        }
        const name = file.name.replace(/\.json$/i, "");
        try {
          await saveDraftToIdb(name, parsed);
          bumpDraftsRefresh();
        } catch {
          // Save fail is non-fatal — still load the spec in-memory.
        }
        const actions = getActions();
        if (actions) actions.loadSpec(parsed, name);
        setError(null);
      } catch (err) {
        setError((err as Error).message || "Failed to import file");
      }
    },
    [],
  );

  const onUndo = React.useCallback(() => {
    getActions()?.undo();
  }, []);
  const onRedo = React.useCallback(() => {
    getActions()?.redo();
  }, []);

  return (
    <div
      className="flex items-center gap-1 px-2 py-1 border-b border-zinc-800 bg-zinc-950"
      data-testid="panel-builder-toolbar"
    >
      <span
        className="text-[11px] text-zinc-300 truncate max-w-[14rem]"
        title={currentName ?? "Unsaved draft"}
      >
        {currentName ?? <em className="text-zinc-500">Unsaved draft</em>}
      </span>
      <span className="flex-1" />
      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className="inline-flex items-center gap-1 text-[11px] text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="panel-builder-undo"
      >
        <Undo2 size={12} />
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z)"
        className="inline-flex items-center gap-1 text-[11px] text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
        data-testid="panel-builder-redo"
      >
        <Redo2 size={12} />
      </button>
      <span className="w-px h-4 bg-zinc-800 mx-1" />
      <button
        type="button"
        onClick={() => void onSave()}
        title="Save draft to library"
        className="inline-flex items-center gap-1 text-[11px] text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
        data-testid="panel-builder-save"
      >
        <Save size={12} /> Save
      </button>
      <button
        type="button"
        onClick={onExport}
        title="Download current draft as .json"
        className="inline-flex items-center gap-1 text-[11px] text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
        data-testid="panel-builder-export"
      >
        <Download size={12} /> Export
      </button>
      <button
        type="button"
        onClick={onImport}
        title="Import a .json panel spec"
        className="inline-flex items-center gap-1 text-[11px] text-zinc-300 px-1.5 py-0.5 rounded hover:bg-zinc-800"
        data-testid="panel-builder-import"
      >
        <FilePlus size={12} /> Import
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={(e) => void onFileChange(e)}
        className="hidden"
        data-testid="panel-builder-file-input"
      />
      {error && (
        <span
          className="text-[10px] text-rose-300 ml-2 max-w-[18rem] truncate"
          title={error}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function CanvasPane(): React.JSX.Element {
  const state = usePanelBuilderState();
  const [isOver, setIsOver] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  const root = state?.root ?? null;
  const selectedId = state?.selectedNodeId ?? null;

  // Memo'd getId — only rebuilds when the spec tree's root reference
  // changes (every mutation through the store).
  const getId = useNodeIdMap(root ?? makeFallbackRoot());

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Accept BOTH palette-tile drags AND `.json` file drops. The
      // first lands a template node via the panel-builder store; the
      // second loads a complete spec (used as the file-drop import
      // surface — see VB4 §10).
      if (
        e.dataTransfer.types.includes(MIME.panelBuilderNode) ||
        e.dataTransfer.types.includes("Files")
      ) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setIsOver(true);
      }
    },
    [],
  );
  const onDragLeave = React.useCallback(() => {
    setIsOver(false);
  }, []);
  const onDrop = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setIsOver(false);
      // Palette-tile drop (template insert) ----------------------------
      const raw = e.dataTransfer.getData(MIME.panelBuilderNode);
      if (raw) {
        const payload = decode(raw);
        if (!payload || payload.kind !== "panelBuilderNode") return;
        e.preventDefault();
        const template = payload.meta?.template as NodeSpec | undefined;
        if (!template) return;
        const actions = getActions();
        if (!actions) return;
        actions.appendNode(template);
        return;
      }
      // `.json` file drop (import) ------------------------------------
      const files = Array.from(e.dataTransfer.files);
      const jsonFile = files.find(
        (f) =>
          f.type === "application/json" ||
          f.name.toLowerCase().endsWith(".json"),
      );
      if (!jsonFile) return;
      e.preventDefault();
      void (async () => {
        try {
          const text = await jsonFile.text();
          const parsed = JSON.parse(text) as unknown;
          if (!isPanelSpec(parsed)) {
            console.warn(
              `[panelBuilder] dropped "${jsonFile.name}" doesn't look like a PanelSpec`,
            );
            return;
          }
          const name = jsonFile.name.replace(/\.json$/i, "");
          try {
            await saveDraftToIdb(name, parsed);
            bumpDraftsRefresh();
          } catch {
            // Save fail is non-fatal — still load the spec in-memory.
          }
          const actions = getActions();
          if (actions) actions.loadSpec(parsed, name);
        } catch (err) {
          console.warn("[panelBuilder] file import failed:", err);
        }
      })();
    },
    [],
  );

  // Click → resolve nearest ancestor with `data-cardboard-node-id` →
  // selectNode(id). Click on empty area (no id ancestor) clears
  // selection. The handler runs in capture phase so it wins over any
  // bubbling click handlers inside the rendered tree (e.g. Button's
  // onClick — but we DO want clicks to select the button, so we DON'T
  // preventDefault here).
  const onClick = React.useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const id = findNodeIdFromTarget(e.target, wrapperRef.current);
    const actions = getActions();
    if (!actions) return;
    actions.selectNode(id);
  }, []);

  // Delete / Backspace → delete selected node. Skip when focus is
  // inside an input/textarea/contenteditable so the inspector forms
  // and any future inline-edit affordances can still use the keys.
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const active = document.activeElement;
      if (active instanceof HTMLElement) {
        const tag = active.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          active.isContentEditable
        ) {
          return;
        }
      }
      const actions = getActions();
      if (!actions) return;
      const id = actions.selectedNodeId;
      if (!id || id === "root") return;
      e.preventDefault();
      actions.deleteNode(id);
    };
    // Listen on the document so the canvas doesn't need focus — the
    // user just clicks a node and presses Delete.
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const childCount =
    state && state.root.type === "Layout" ? state.root.children.length : 0;
  const showEmptyState = childCount === 0;

  // Selection ring — a CSS rule keyed off the live selected id. The
  // rule targets `data-cardboard-node-id="<id>"` so we don't have to
  // mutate the rendered tree to apply styling. `outline` is used
  // instead of `border` so it doesn't shift layout.
  const ringCss = selectedId
    ? `[data-cardboard-node-id="${cssAttrEscape(selectedId)}"] {
        outline: 2px solid rgb(245 158 11 / 0.9);
        outline-offset: 1px;
        border-radius: 2px;
      }`
    : "";

  return (
    <div className="flex flex-col h-full">
      <CanvasToolbar />
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 pt-2 pb-1">
        Canvas
      </div>
      {ringCss && <style>{ringCss}</style>}
      <div
        ref={wrapperRef}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={onClick}
        tabIndex={0}
        className={[
          "flex-1 m-2 rounded border-2 border-dashed",
          "transition-colors overflow-auto",
          "focus:outline-none",
          isOver
            ? "border-amber-500/80 bg-amber-500/5"
            : "border-zinc-800 bg-zinc-950",
        ].join(" ")}
        data-testid="panel-builder-canvas"
        aria-label="Panel Builder canvas drop target"
      >
        {showEmptyState ? (
          <div className="h-full flex items-center justify-center p-4 pointer-events-none">
            <EmptyState
              title="Drag a node from the palette"
              description="Drop tiles here. The canvas previews your draft live."
            />
          </div>
        ) : (
          <div className="h-full">
            <NodeIdProvider getId={getId}>
              <PanelRenderer spec={CANVAS_HOST_SPEC} />
            </NodeIdProvider>
          </div>
        )}
      </div>
    </div>
  );
}

/** Escape an arbitrary string for safe use inside a CSS attribute-value
 *  selector. Spec-tree paths only contain `[a-zA-Z0-9.]` so the worst
 *  case is a dot — `[data-...="root.children.0"]` is already valid CSS
 *  because the value is quoted. We still defensively escape `"` and
 *  `\` since a future id strategy could introduce them. */
function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Fallback root used while the store is initialising — keeps the
 *  `useNodeIdMap` hook call unconditional. */
function makeFallbackRoot(): NodeSpec {
  return { type: "Layout", direction: "column", children: [] };
}

// ---------------------------------------------------------------------------
// Inspector pane
// ---------------------------------------------------------------------------

function InspectorPane(): React.JSX.Element {
  const state = usePanelBuilderState();
  const selectedId = state?.selectedNodeId ?? null;
  const selectedNode =
    state && selectedId ? findNodeById(state.root, selectedId) : null;

  const onUpdate = React.useCallback(
    (nodeId: string, patch: Partial<NodeSpec>) => {
      const actions = getActions();
      if (!actions) return;
      actions.updateNode(nodeId, patch);
    },
    [],
  );
  const onDelete = React.useCallback((nodeId: string) => {
    const actions = getActions();
    if (!actions) return;
    actions.deleteNode(nodeId);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 pt-2 pb-1">
        Inspector
      </div>
      {selectedNode && selectedId ? (
        <NodeInspector
          node={selectedNode}
          nodeId={selectedId}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-4">
          <EmptyState
            title="No selection"
            description="Click a node on the canvas to inspect + edit its properties."
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level layout
// ---------------------------------------------------------------------------

export interface PanelBuilderViewProps {
  [key: string]: unknown;
}

export function PanelBuilderView(
  _props: PanelBuilderViewProps = {},
): React.JSX.Element {
  return (
    <div
      className="flex w-full h-full bg-zinc-950 text-zinc-100 overflow-hidden"
      data-testid="panel-builder-view"
    >
      <aside
        className="w-56 shrink-0 border-r border-zinc-800 overflow-hidden"
        aria-label="Palette"
      >
        <PalettePane />
      </aside>
      <main
        className="flex-1 min-w-0 border-r border-zinc-800 overflow-hidden"
        aria-label="Canvas"
      >
        <CanvasPane />
      </main>
      <aside
        className="w-72 shrink-0 overflow-hidden"
        aria-label="Inspector"
      >
        <InspectorPane />
      </aside>
    </div>
  );
}

export default PanelBuilderView;
