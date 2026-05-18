import React from "react";
import type { DockviewApi } from "dockview";
import { cn } from "../../lib/cn";
import type { DockPanelDef } from "./DockShell";

/**
 * PanelPacker — flyout listing every panel registered with the active
 * DockShell. Each panel renders as a chip the user can drag into the
 * dockview area to mount it; chips for panels already in the layout
 * are muted with an "In layout" label.
 *
 * Drag protocol:
 *   `event.dataTransfer.setData("dockview/panel-id", id)` carries the
 *   panel id across the drag. DockShell listens for the corresponding
 *   `drop` event (via dockview's `onDidDrop` event) and calls
 *   `api.addPanel({ id, component: id, title })` when the dataTransfer
 *   payload matches one of the registered panel ids. We use
 *   `onDidDrop` rather than `onWillDrop` because dockview only fires
 *   `onDidDrop` for drops it doesn't natively understand — which is
 *   exactly the external-drag case we own.
 *
 * Closing:
 *   - Outside-click via a `mousedown` listener that ignores clicks
 *     inside `[data-panel-packer]`.
 *   - Esc key.
 *
 * Positioning:
 *   Anchored to the workspace rail by absolute positioning relative
 *   to the rail container. The rail passes us the anchor coords
 *   (`anchorRect`) so we can place the flyout exactly beside the
 *   trigger button without obstructing the dock area below.
 */

export interface PanelPackerProps {
  registry: readonly DockPanelDef[];
  apiRef: React.MutableRefObject<DockviewApi | null>;
  onClose: () => void;
  /** Position the flyout next to this anchor element. */
  anchorRect: DOMRect | null;
  /** Rail orientation — landscape mode (workspace docked top/bottom)
   *  positions the flyout below the rail; portrait positions it to
   *  the right of the rail. */
  orientation: "portrait" | "landscape";
}

/**
 * Tick the snapshot every time the dockview layout changes so chips
 * that go from "active" to "closed" (or vice versa) refresh in the
 * flyout. We poll `api.getPanel(id)` on each render — cheap because
 * dockview keeps a panel map internally.
 */
function useLayoutVersion(api: DockviewApi | null): number {
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    if (!api) return;
    const sub = api.onDidLayoutChange(() => setVersion((v) => v + 1));
    return () => sub.dispose();
  }, [api]);
  return version;
}

export function PanelPacker({
  registry,
  apiRef,
  onClose,
  anchorRect,
  orientation,
}: PanelPackerProps): React.JSX.Element | null {
  const api = apiRef.current;
  useLayoutVersion(api);

  // Close on outside click + Esc.
  React.useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-panel-packer]")) return;
      if (t?.closest("[data-panel-packer-trigger]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!anchorRect) return null;

  // Position relative to the viewport. Portrait rail sits on the left
  // edge, so the flyout opens to its right; landscape rail sits at
  // the top, so the flyout opens below.
  const style: React.CSSProperties =
    orientation === "portrait"
      ? {
          position: "fixed",
          left: anchorRect.right + 8,
          top: anchorRect.top,
          zIndex: 1000,
        }
      : {
          position: "fixed",
          left: anchorRect.left,
          top: anchorRect.bottom + 8,
          zIndex: 1000,
        };

  return (
    <div
      data-panel-packer
      style={style}
      className={cn(
        "workspace-panel-packer-flyout",
        "card-surface-elev",
        "rounded border border-(--color-border-strong)",
        "bg-(--color-bg-card-elev) shadow-popover",
        "min-w-[200px] max-w-[260px] p-2 flex flex-col gap-1",
      )}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-(--color-fg-muted)">
        Panels
      </div>
      {registry.map((def) => {
        const isMounted = !!api?.getPanel(def.id);
        // Workspace itself is non-removable / non-addable from this
        // surface — surfacing it as a chip would just be noise.
        if (def.id === "workspace") return null;
        return (
          <div
            key={def.id}
            draggable={!isMounted}
            onDragStart={(e) => {
              if (isMounted) {
                e.preventDefault();
                return;
              }
              e.dataTransfer.effectAllowed = "copy";
              e.dataTransfer.setData("dockview/panel-id", def.id);
              // Some browsers require a text/plain payload to allow
              // the drop event to fire reliably.
              e.dataTransfer.setData("text/plain", def.id);
            }}
            className={cn(
              "flex items-center gap-2 px-2 py-1.5 rounded text-[12px]",
              isMounted
                ? "text-(--color-fg-muted) bg-transparent cursor-not-allowed"
                : "text-(--color-fg-primary) bg-(--color-bg-card) hover:bg-(--color-bg-hover) cursor-grab active:cursor-grabbing border border-(--color-border)",
            )}
            title={
              isMounted
                ? `${def.title} is already in the layout`
                : `Drag ${def.title} onto the dock to add it`
            }
          >
            {def.icon ? (
              <span className="flex h-4 w-4 items-center justify-center text-(--color-fg-muted)">
                {def.icon}
              </span>
            ) : null}
            <span className="flex-1 truncate">{def.title}</span>
            {isMounted ? (
              <span className="text-[9px] uppercase tracking-wider text-(--color-fg-muted)">
                In layout
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default PanelPacker;
