import React from "react";
import type { DockviewApi } from "dockview";
import { GripVertical } from "lucide-react";
import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import type { DockPanelDef } from "./DockShell";

/**
 * DocksModal — the panel-discovery surface.
 *
 * Lists every registered panel for the active page as a card; cards
 * for already-mounted panels are muted with an "In layout" badge.
 *
 * Click-to-add: the previous drag-from-card flow was technically
 * fragile — dockview's drop zones don't highlight for external HTML5
 * drags, so the user just dropped "somewhere" with no visual feedback
 * about where the panel would land. Click-to-add is deterministic:
 * the panel materialises in the layout (split right of the existing
 * groups) and the user can drag its tab to reposition.
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
          // Add the panel to the live dockview layout. Default
          // placement: split right of the rightmost existing group
          // (the agreed UX is "click to add, then drag the panel's
          // tab anywhere"). dockview shows drop zones for tab drags,
          // not external HTML5 drags, so trying to drag-from-card
          // gives the user no visual feedback about where the panel
          // will land. Click-to-add is deterministic; the
          // re-position-by-tab afterwards is robust.
          const onAdd = () => {
            if (isMounted) return;
            if (!api) return;
            try {
              api.addPanel({
                id: def.id,
                component: def.id,
                title: def.title,
                position: { direction: "right" },
              });
            } catch {
              // ignore — dockview rejected the addPanel call
            }
            onClose();
          };
          return (
            <button
              key={def.id}
              type="button"
              onClick={onAdd}
              disabled={isMounted}
              className={cn(
                "relative flex flex-col items-center justify-center gap-2",
                "rounded-md border p-3 h-[140px]",
                "transition-colors",
                isMounted
                  ? "border-(--color-border) bg-(--color-bg-card) opacity-60 cursor-not-allowed"
                  : "border-(--color-border) bg-(--color-bg-card) hover:border-(--color-border-strong) cursor-pointer",
              )}
              title={
                isMounted
                  ? `${def.title} is already in the layout`
                  : `Add ${def.title} to the layout`
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
                  Click to add
                </span>
              )}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}

export default DocksModal;
