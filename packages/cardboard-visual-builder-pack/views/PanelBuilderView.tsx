/**
 * PanelBuilderView — JSON Visual Builder VB2 (palette + canvas).
 *
 * VB1 shipped a three-pane shell with `EmptyState` placeholders. VB2
 * wires:
 *
 *   • Left pane (palette) — a vertical list of every NodeSpec type
 *     the renderer accepts. Each entry is a `<button draggable>` that
 *     writes a `panelBuilderNode`-kind DnD payload on dragstart.
 *   • Center pane (canvas) — a drop target that calls the
 *     panel-builder store's `appendNode` when a palette payload lands.
 *     The canvas body renders the in-progress draft through the new
 *     `RenderSpec` node type, which means the canvas is itself
 *     `<PanelRenderer>` rendering ANOTHER `<PanelRenderer>` subtree
 *     (the recursive-renderer proof per the plan §10 risk).
 *   • Right pane (inspector) — stays an `EmptyState` for VB2. VB3
 *     wires selection + per-node property forms.
 *
 * Wire-protocol notes:
 *
 *   • The palette serialises the NodeSpec template into the DnD
 *     payload's `meta.template` field. The drop handler parses it +
 *     hands it to `store.appendNode(...)` — no asset-store round-trip.
 *   • The MIME used is `application/x-cardboard-panel-builder-node`
 *     (auto-derived from the new `panelBuilderNode` SemanticAssetKind
 *     in `apps/editor/src/state/dnd/payload.ts`).
 *   • Drag-source rendering uses the native browser ghost — the
 *     palette tile contains its label + icon so the ghost reads
 *     correctly. Custom drag previews can land in VB6 polish.
 */

import React from "react";
import {
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
} from "lucide-react";
import {
  PanelRenderer,
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
  type PanelBuilderState,
  type PanelBuilderActions,
} from "../state/usePanelBuilderStore";

/**
 * The canvas pane's host spec — a PanelSpec rendered via `PanelRenderer`
 * whose only content is a `RenderSpec` pointing at the panel-builder
 * store's `root` field. The renderer resolves the binding on every
 * store update and walks the draft tree recursively. This is the
 * proof-of-recursion the plan calls out as risk #1 in §10.
 *
 * Module-scope constant: building the spec inline on every render
 * would change object identity per-render. The renderer's binding
 * subscription doesn't care (it reads `value` via getState), but
 * defensive against future memo-based gating.
 */
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

/** Shell-side DnD origin tag — pack-side drags identify themselves so
 *  drops in other windows can tell them apart. Stable string is fine;
 *  no per-window correlation needed for VB2's same-window drags. */
const PALETTE_DRAG_ORIGIN = "cardboard-visual-builder.palette";

/** Build the DnD payload a palette tile writes on dragstart. The
 *  payload's `meta.template` carries the NodeSpec the canvas will
 *  append on drop. */
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

/** Local registry of lucide icons used by the palette. Limited to the
 *  exact icon set the catalog references so the pack bundle stays
 *  small (importing `* as LucideIcons` pulled in ~200KB of icon
 *  components). Adding a new palette entry → add its icon to this map
 *  + its import above. */
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
      // Per-kind MIME — DropZone targets filter on it via `accepts`.
      // Generic JSON fallback — debug tools / external observers.
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
// Canvas pane
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
  // Always call the hook — when the store isn't ready yet we return
  // null below. Conditional hook calls would violate rules-of-hooks.
  // The subscriptor delegates to `store?.subscribe` and getSnapshot
  // returns the live state (or null when the store doesn't exist yet).
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

function CanvasPane(): React.JSX.Element {
  const state = usePanelBuilderState();
  const [isOver, setIsOver] = React.useState(false);

  const onDragOver = React.useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Only react to our own MIME — other kinds blow past without
      // claiming the drop. The `types` list is the cheapest filter
      // available in `dragover`.
      if (e.dataTransfer.types.includes(MIME.panelBuilderNode)) {
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
      const raw = e.dataTransfer.getData(MIME.panelBuilderNode);
      if (!raw) return;
      const payload = decode(raw);
      if (!payload || payload.kind !== "panelBuilderNode") return;
      e.preventDefault();
      const template = payload.meta?.template as NodeSpec | undefined;
      if (!template) return;
      const store = getPanelBuilderStore();
      if (!store) return;
      const actions = store.getState() as PanelBuilderState &
        PanelBuilderActions;
      actions.appendNode(template);
    },
    [],
  );

  const childCount =
    state && state.root.type === "Layout" ? state.root.children.length : 0;
  const showEmptyState = childCount === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 pt-2 pb-1">
        Canvas
      </div>
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={[
          "flex-1 m-2 rounded border-2 border-dashed",
          "transition-colors overflow-auto",
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
          // The canvas-host spec mounts a nested `<PanelRenderer>` via
          // the new `RenderSpec` node type, which reads the binding
          // `store.panelBuilder.root` and renders it recursively. The
          // outer wrapper here is just for layout + scroll.
          <div className="h-full">
            <PanelRenderer spec={CANVAS_HOST_SPEC} />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inspector pane — VB3 placeholder
// ---------------------------------------------------------------------------

function InspectorPane(): React.JSX.Element {
  return (
    <div className="flex flex-col h-full">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 px-2 pt-2 pb-1">
        Inspector
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <EmptyState
          title="Inspector — VB3"
          description="Per-node property forms appear here when a canvas node is selected. VB3 wires selection + the inspector forms."
        />
      </div>
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
