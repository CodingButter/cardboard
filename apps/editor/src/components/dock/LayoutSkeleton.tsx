import React from "react";
import type { SerializedDockview } from "dockview";

/**
 * LayoutSkeleton — render a dockview layout JSON as a tiny
 * proportional schematic. Used by the preset hover preview overlay.
 *
 * dockview's `SerializedDockview.grid.root` is a tree of:
 *   - branches: `{ type: "branch", data: GridNode[], size: number }`
 *   - leaves:   `{ type: "leaf",   data: GroupPanelViewState, size: number }`
 * with the parent `grid.orientation` (HORIZONTAL/VERTICAL) telling us
 * how the root's direct children stack — children of a branch flip
 * the axis (a horizontal branch contains vertical children and vice
 * versa). We mirror that here.
 *
 * Floating + popout groups are skipped from the skeleton; they exist
 * outside the grid and don't have grid coordinates to honour. A
 * future revision could render them as a small detached chip in the
 * corner; for now they're omitted to keep the preview readable.
 */

type GridNode = {
  type: "branch" | "leaf";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
  // recursive grid node shape is intentionally permissive; we only
  // touch a small known subset of fields below.
  data: any;
  size?: number;
};

interface LayoutSkeletonProps {
  layout: SerializedDockview;
  className?: string;
}

/**
 * Compute child flex weights normalised to sum=1. A child without a
 * `size` falls back to 1 so equal-sized siblings render evenly even
 * when dockview's snapshot is missing the field.
 */
function normalizeWeights(children: GridNode[]): number[] {
  const sizes = children.map((c) =>
    typeof c.size === "number" && c.size > 0 ? c.size : 1,
  );
  const total = sizes.reduce((a, b) => a + b, 0) || 1;
  return sizes.map((s) => s / total);
}

function SkeletonNode({
  node,
  axis,
}: {
  node: GridNode;
  axis: "row" | "column";
}): React.JSX.Element {
  if (node.type === "leaf") {
    // Leaves render as filled rectangles. The flex weight is applied
    // by the parent's wrapper element.
    return (
      <div
        className="workspace-preset-thumb__leaf"
        style={{
          background: "var(--color-bg-card-elev)",
          border: "1px solid var(--color-border)",
          borderRadius: 2,
          width: "100%",
          height: "100%",
        }}
      />
    );
  }

  // Branch — direct children flip the parent's axis.
  const children: GridNode[] = Array.isArray(node.data) ? node.data : [];
  const weights = normalizeWeights(children);
  const childAxis: "row" | "column" = axis === "row" ? "column" : "row";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: axis,
        gap: 2,
        width: "100%",
        height: "100%",
      }}
    >
      {children.map((child, i) => (
        <div
          key={i}
          style={{
            flex: `${weights[i]} 1 0`,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <SkeletonNode node={child} axis={childAxis} />
        </div>
      ))}
    </div>
  );
}

export function LayoutSkeleton({
  layout,
  className,
}: LayoutSkeletonProps): React.JSX.Element {
  const grid = layout.grid as
    | {
        root?: GridNode;
        orientation?: "HORIZONTAL" | "VERTICAL";
      }
    | undefined;
  const root: GridNode | undefined = grid?.root;
  // The grid `orientation` field tells us how the root branch's
  // children stack: HORIZONTAL = side-by-side row, VERTICAL = stacked
  // column. Children of the root branch use this axis; their
  // children flip.
  const rootAxis: "row" | "column" =
    grid?.orientation === "VERTICAL" ? "column" : "row";

  if (!root) {
    return (
      <div
        className={className}
        style={{
          width: "100%",
          height: "100%",
          background: "var(--color-bg-card)",
          border: "1px dashed var(--color-border)",
          borderRadius: 2,
        }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height: "100%",
      }}
    >
      <SkeletonNode node={root} axis={rootAxis} />
    </div>
  );
}

export default LayoutSkeleton;
