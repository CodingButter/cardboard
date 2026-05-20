import React from "react";
import { Boxes, LayoutDashboard, SlidersHorizontal } from "lucide-react";
import { EmptyState } from "@cardboard/editor-shell";

/**
 * PanelBuilderView — JSON Visual Builder VB1 (workspace skeleton).
 *
 * VB1 doc-only intent (docs/plans/JSON_VISUAL_BUILDER.md §10): get the
 * pack to load, register a Panel Builder tab, render an empty 3-pane
 * view. The actual palette / canvas / inspector wiring lands in VB2+.
 *
 * Layout: a simple flex row with three equal-weight columns. VB1 doesn't
 * register a DockShell layout — the placeholder panes are rendered
 * inline so the tab "lights up" with a recognisable three-region shape
 * the moment the pack loads. VB2 will swap this for a DockShell-driven
 * layout with `ctx.registerLayout("panel-builder", ...)` once the real
 * palette / canvas / inspector panels exist.
 *
 * Props are widened to the shell-side `ViewComponent` signature — the
 * editor shell mounts pack-contributed views without supplying any
 * props.
 */
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
      {/* ─────────── Palette (left) ─────────── */}
      <aside
        className="flex-1 min-w-0 border-r border-zinc-800 flex items-center justify-center"
        aria-label="Palette"
      >
        <EmptyState
          icon={<Boxes size={28} />}
          title="Palette — coming soon"
          description="Drag tiles for the 15 RenderSpec node types will appear here. VB2 wires the drag source."
        />
      </aside>

      {/* ─────────── Canvas (center) ─────────── */}
      <main
        className="flex-1 min-w-0 border-r border-zinc-800 flex items-center justify-center"
        aria-label="Canvas"
      >
        <EmptyState
          icon={<LayoutDashboard size={28} />}
          title="Canvas — coming soon"
          description="The live <RenderSpec> preview of the panel draft will render here. VB2 wires the drop target + store."
        />
      </main>

      {/* ─────────── Inspector (right) ─────────── */}
      <aside
        className="flex-1 min-w-0 flex items-center justify-center"
        aria-label="Inspector"
      >
        <EmptyState
          icon={<SlidersHorizontal size={28} />}
          title="Inspector — coming soon"
          description="Per-node property forms will appear here when a canvas node is selected. VB3 wires selection + the inspector forms."
        />
      </aside>
    </div>
  );
}

export default PanelBuilderView;
