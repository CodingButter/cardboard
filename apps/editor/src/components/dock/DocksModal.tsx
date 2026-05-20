import React from "react";
import type { DockviewApi } from "dockview";
import { Box, Check } from "lucide-react";
import { cn } from "../../lib/cn";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Tooltip } from "../ui/Tooltip";
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
      title="Add panel"
      description="Click a panel to add it to the current layout."
      width="2xl"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
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
          const shortLabel = isMounted
            ? `${def.title} already in layout`
            : `Add ${def.title}`;
          const longLabel = isMounted
            ? `${def.title} is already mounted in the current page's dockview layout. Close it from its tab strip to be able to re-add it.`
            : `Adds the ${def.title} panel to the current page. It lands split right of the rightmost group; drag its tab to reposition.`;
          return (
            <Tooltip
              key={def.id}
              stages={[
                { delay: 1000, content: <span>{shortLabel}</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">{shortLabel}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                        {longLabel}
                      </div>
                    </div>
                  ),
                },
              ]}
            >
            <button
              type="button"
              onClick={onAdd}
              disabled={isMounted}
              className={cn(
                "group relative flex flex-col items-start justify-start gap-2",
                "rounded-md border p-3 h-[120px] w-full",
                "transition-colors hover:shadow-[var(--shadow-panel)]",
                "border-(--color-border) bg-(--color-bg-card)",
                isMounted
                  ? "cursor-not-allowed"
                  : "hover:border-(--color-border-strong) cursor-pointer",
              )}
            >
              {/* Mounted-state check glyph anchored top-right of the
                  card. Replaces the previous opacity-60 wash so the
                  card stays visually legible while still flagged. */}
              {isMounted ? (
                <Check
                  size={12}
                  aria-label="Already in layout"
                  className="absolute top-2 right-2 text-(--color-accent)"
                />
              ) : null}
              {/* Icon block (40px) */}
              <div
                className={cn(
                  "h-10 w-10 rounded flex items-center justify-center",
                  "bg-(--color-bg-app) border border-(--color-border)",
                  "text-(--color-fg-secondary)",
                )}
              >
                {def.icon ? (
                  <span className="[&_svg]:h-5 [&_svg]:w-5 flex items-center justify-center">
                    {def.icon}
                  </span>
                ) : (
                  <Box size={18} />
                )}
              </div>
              <div className="text-[13px] font-medium text-(--color-fg-primary) text-left truncate w-full">
                {def.title}
              </div>
              {isMounted ? (
                <Tooltip
                  stages={[
                    {
                      delay: 1000,
                      content: <span>Already in current layout</span>,
                    },
                    {
                      delay: 3000,
                      content: (
                        <div>
                          <div className="font-semibold">In layout</div>
                          <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                            {def.title} is already mounted in this page's
                            dockview layout. Close it from its tab strip to
                            be able to re-add it.
                          </div>
                        </div>
                      ),
                    },
                  ]}
                >
                  <span
                    className={cn(
                      "text-[10px] uppercase tracking-wider font-semibold",
                      "px-1.5 py-0.5 rounded",
                      "bg-(--color-bg-app) text-(--color-fg-muted)",
                      "border border-(--color-border)",
                    )}
                  >
                    In layout
                  </span>
                </Tooltip>
              ) : null}
            </button>
            </Tooltip>
          );
        })}
      </div>
    </Modal>
  );
}

export default DocksModal;
