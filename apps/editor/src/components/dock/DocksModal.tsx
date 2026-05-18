import React from "react";
import type { DockviewApi } from "dockview";
import { GripVertical } from "lucide-react";
import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import type { DockPanelDef } from "./DockShell";

/**
 * DocksModal — the Workspace v1.5 panel-discovery surface.
 *
 * Replaces the rail's PanelPacker flyout. Lists every registered panel
 * for the active page as a card; cards for already-mounted panels are
 * muted with an "In layout" badge. Cards for closed panels are
 * draggable — they carry `dataTransfer["dockview/panel-id"]` so the
 * existing DockShell `onDidDrop` handler can mount them when dropped
 * onto the dockview area.
 *
 * Auto-close: when DockShell successfully mounts a panel via drop it
 * dispatches a `cardboard:panel-added` event on `window`. We listen
 * for it and close the modal so the user sees their new panel.
 */

interface DocksModalProps {
  open: boolean;
  onClose: () => void;
  registry: readonly DockPanelDef[];
  apiRef: React.MutableRefObject<DockviewApi | null>;
}

/**
 * Tick a counter on every layout change so the cards' "In layout"
 * state reflects live dockview state without us threading a prop
 * through.
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

export function DocksModal({
  open,
  onClose,
  registry,
  apiRef,
}: DocksModalProps): React.JSX.Element {
  const api = apiRef.current;
  useLayoutVersion(api);

  // Auto-close on successful drop.
  React.useEffect(() => {
    if (!open) return;
    const onAdded = () => onClose();
    window.addEventListener("cardboard:panel-added", onAdded);
    return () => window.removeEventListener("cardboard:panel-added", onAdded);
  }, [open, onClose]);

  // Filter out the workspace panel — it's the rail itself, not a
  // dockable panel to surface here.
  const cards = React.useMemo(
    () => registry.filter((def) => def.id !== "workspace"),
    [registry],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Docks"
      description="Drag a panel onto the layout to add it."
      width="3xl"
    >
      <div
        className={cn(
          "grid gap-3",
          "grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
        )}
      >
        {cards.map((def) => {
          const isMounted = !!api?.getPanel(def.id);
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
                // Some browsers require a text/plain payload for the
                // drop to fire reliably across windows.
                e.dataTransfer.setData("text/plain", def.id);
              }}
              className={cn(
                "relative flex flex-col items-center justify-center gap-2",
                "rounded-md border p-3 h-[140px]",
                "transition-colors",
                isMounted
                  ? "border-(--color-border) bg-(--color-bg-card) opacity-60 cursor-not-allowed"
                  : "border-(--color-border) bg-(--color-bg-card) hover:border-(--color-border-strong) cursor-grab active:cursor-grabbing",
              )}
              title={
                isMounted
                  ? `${def.title} is already in the layout`
                  : `Drag ${def.title} onto the layout to add it`
              }
            >
              {/* Large icon block */}
              <div
                className={cn(
                  "h-12 w-12 rounded flex items-center justify-center",
                  "bg-(--color-bg-app) border border-(--color-border)",
                  "text-(--color-fg-secondary)",
                )}
              >
                {def.icon ? (
                  <span className="[&_svg]:h-6 [&_svg]:w-6 flex items-center justify-center">
                    {def.icon}
                  </span>
                ) : (
                  <GripVertical size={18} />
                )}
              </div>
              <div className="text-[12px] text-(--color-fg-primary) text-center truncate w-full">
                {def.title}
              </div>
              {isMounted ? (
                <span className="text-[9px] uppercase tracking-wider text-(--color-fg-muted)">
                  In layout
                </span>
              ) : (
                <span className="text-[9px] uppercase tracking-wider text-(--color-fg-muted)">
                  Drag to add
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

export default DocksModal;
