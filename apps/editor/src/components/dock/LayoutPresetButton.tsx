import React from "react";
import { createPortal } from "react-dom";
import { Layout as LayoutIcon } from "lucide-react";
import { cn } from "../../lib/cn";
import type { WorkspacePreset } from "../../state/useWorkspaceStore";
import { LayoutSkeleton } from "./LayoutSkeleton";

/**
 * LayoutPresetButton — a single workspace-rail icon button representing
 * a saved layout preset.
 *
 * Interactions:
 *   - Click   → apply this preset (caller's `onApply`).
 *   - Right-click → context menu with Rename / Delete inline actions.
 *   - Hover  → cursor-following preview overlay (portal'd to <body>)
 *              showing the preset name + a skeleton schematic of the
 *              dockview layout grid.
 *
 * No external popover library — the context menu is a small positioned
 * div with a click-outside listener; the hover preview is a portal +
 * pointermove tracker. Keeps the surface area of dependencies minimal
 * (we already pulled in zustand for state, that's enough new weight).
 */

interface LayoutPresetButtonProps {
  preset: WorkspacePreset;
  onApply: (preset: WorkspacePreset) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

type MenuState =
  | { kind: "closed" }
  | { kind: "open"; x: number; y: number }
  | { kind: "rename" }
  | { kind: "confirm-delete" };

const PREVIEW_W = 240;
const PREVIEW_H = 160;
const PREVIEW_OFFSET = 16;

export function LayoutPresetButton({
  preset,
  onApply,
  onRename,
  onDelete,
}: LayoutPresetButtonProps): React.JSX.Element {
  const [menu, setMenu] = React.useState<MenuState>({ kind: "closed" });
  const [hover, setHover] = React.useState<{ x: number; y: number } | null>(
    null,
  );
  const [renameValue, setRenameValue] = React.useState(preset.name);

  // Sync the rename input when the preset name updates externally
  // (e.g. another tab edits it via store rehydration).
  React.useEffect(() => {
    setRenameValue(preset.name);
  }, [preset.name]);

  // Cancel hover preview when the context menu opens — having the
  // preview hovering over the menu would be visual noise.
  const menuOpen = menu.kind !== "closed";
  React.useEffect(() => {
    if (menuOpen) setHover(null);
  }, [menuOpen]);

  // Click-outside listener that closes the context menu. Mounts on
  // mousedown so it fires before any click handler the user might be
  // about to trigger inside the menu.
  React.useEffect(() => {
    if (menu.kind === "closed") return;
    const onDocDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-preset-menu]")) return;
      setMenu({ kind: "closed" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu({ kind: "closed" });
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Pointer-following preview. We only listen while hover is active
  // to keep idle cost at zero.
  const onPointerEnter = (e: React.PointerEvent) => {
    if (menuOpen) return;
    setHover({ x: e.clientX, y: e.clientY });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!hover) return;
    setHover({ x: e.clientX, y: e.clientY });
  };
  const onPointerLeave = () => setHover(null);

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setHover(null);
    setMenu({ kind: "open", x: e.clientX, y: e.clientY });
  };

  const commitRename = () => {
    onRename(preset.id, renameValue);
    setMenu({ kind: "closed" });
  };

  return (
    <>
      {menu.kind === "rename" ? (
        <input
          type="text"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setRenameValue(preset.name);
              setMenu({ kind: "closed" });
            }
          }}
          autoFocus
          className={cn(
            "workspace-preset-button",
            "h-10 w-10 rounded text-[10px] text-(--color-fg-primary)",
            "bg-(--color-bg-card-elev) border border-(--color-accent)",
            "px-1 text-center outline-none",
          )}
          aria-label={`Rename preset ${preset.name}`}
        />
      ) : menu.kind === "confirm-delete" ? (
        <div
          className={cn(
            "workspace-preset-button",
            "h-10 w-10 rounded flex flex-col items-center justify-center",
            "bg-(--color-bg-card-elev) border border-red-500/50",
            "text-[8px] gap-0.5",
          )}
        >
          <button
            type="button"
            onClick={() => {
              onDelete(preset.id);
              setMenu({ kind: "closed" });
            }}
            className="text-red-300 hover:text-red-200 font-semibold"
            title="Confirm delete"
          >
            DEL
          </button>
          <button
            type="button"
            onClick={() => setMenu({ kind: "closed" })}
            className="text-(--color-fg-muted) hover:text-zinc-300"
            title="Cancel"
          >
            ×
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => onApply(preset)}
          onContextMenu={onContextMenu}
          onPointerEnter={onPointerEnter}
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          title={`Apply layout: ${preset.name}`}
          aria-label={`Apply layout: ${preset.name}`}
          className={cn(
            "workspace-preset-button",
            "h-10 w-10 rounded flex items-center justify-center",
            "bg-(--color-bg-card) hover:bg-(--color-bg-card-elev)",
            "border border-(--color-border) hover:border-(--color-accent)",
            "text-(--color-fg-secondary) hover:text-(--color-fg-primary)",
            "transition-colors",
          )}
        >
          <LayoutIcon size={16} />
        </button>
      )}

      {/* Cursor-following preview portal. */}
      {hover && !menuOpen
        ? createPortal(
            <div
              className="workspace-preset-preview"
              style={{
                position: "fixed",
                left: hover.x + PREVIEW_OFFSET,
                top: hover.y + PREVIEW_OFFSET,
                width: PREVIEW_W,
                pointerEvents: "none",
                zIndex: 9999,
              }}
            >
              <div
                className="card-surface-elev"
                style={{
                  padding: 8,
                  borderRadius: 6,
                  border: "1px solid var(--color-border-strong)",
                  background: "var(--color-bg-card-elev)",
                  boxShadow: "var(--shadow-popover)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--color-fg-primary)",
                    fontWeight: 500,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {preset.name}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: PREVIEW_H,
                    background: "var(--color-bg-app)",
                    borderRadius: 4,
                    padding: 4,
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <LayoutSkeleton layout={preset.layout} />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Context menu portal. */}
      {menu.kind === "open"
        ? createPortal(
            <div
              data-preset-menu
              style={{
                position: "fixed",
                left: menu.x,
                top: menu.y,
                zIndex: 10000,
              }}
              className={cn(
                "card-surface-elev",
                "rounded border border-(--color-border-strong)",
                "bg-(--color-bg-card-elev) py-1 min-w-[120px]",
              )}
            >
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[12px] text-(--color-fg-primary) hover:bg-(--color-bg-hover)"
                onClick={() => {
                  setRenameValue(preset.name);
                  setMenu({ kind: "rename" });
                }}
              >
                Rename
              </button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 text-[12px] text-red-300 hover:bg-red-500/10"
                onClick={() => setMenu({ kind: "confirm-delete" })}
              >
                Delete
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

export default LayoutPresetButton;
