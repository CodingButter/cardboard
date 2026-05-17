import React from "react";
import { createPortal } from "react-dom";
import { Pencil, Copy, Hash, Info, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";

/**
 * PresetContextMenu — right-click context menu for the GridEditor's
 * left-aside tile-preset palette (#284).
 *
 * Visual + behaviour mirror `MapContextMenu.tsx`:
 *  - createPortal to document.body so we escape parent stacking
 *    contexts (the palette aside has its own scroll/overflow);
 *  - `position: fixed` + viewport-edge clamp;
 *  - synchronous mousedown / contextmenu / Escape listeners guarded by
 *    a `performance.now()` timestamp (ignore outside-clicks within
 *    150ms of open — same opener-event leak fix MapContextMenu uses).
 *
 * Actions:
 *   1. Edit preset (same as double-click → PresetEditView).
 *   2. Duplicate preset (JSONC patch — clone the source entry under an
 *      auto-named id via `autoNamePreset`).
 *   3. Show usage (disabled row: "Used by N cells").
 *   4. Show pack chain attribution (stub).
 *   5. Delete preset (disabled when usage > 0; window.confirm gate
 *      when enabled).
 *
 * Action dispatch is owned by the parent (MapView); this component
 * only renders the menu + emits onSelect callbacks.
 */

export interface PresetContextMenuProps {
  open: boolean;
  presetId: string | null;
  screenX: number;
  screenY: number;
  /** Current-scene usage count for this preset id. When > 0 the
   *  Delete row is disabled with a tooltip; the Usage row always
   *  shows the count. */
  usageCount: number;
  onClose: () => void;
  onEditPreset?: (presetId: string) => void;
  onDuplicatePreset?: (presetId: string) => void;
  onShowPackChainAttribution?: (presetId: string) => void;
  onDeletePreset?: (presetId: string) => void;
}

interface MenuRow {
  id: string;
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  disabledHint?: string;
  /** Red destructive styling (Delete). */
  destructive?: boolean;
  onSelect: () => void;
}

export function PresetContextMenu({
  open,
  presetId,
  screenX,
  screenY,
  usageCount,
  onClose,
  onEditPreset,
  onDuplicatePreset,
  onShowPackChainAttribution,
  onDeletePreset,
}: PresetContextMenuProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Timestamp guard against the right-click event sequence
  // (`mousedown` → `mouseup` → `contextmenu`) closing the menu the
  // instant it opens. Mirrors the inline fix on MapContextMenu — synchronous
  // event listener registration is fine as long as we ignore outside
  // events within 150ms of `open === true`.
  const openedAtRef = React.useRef(0);
  React.useEffect(() => {
    if (open) openedAtRef.current = performance.now();
  }, [open]);
  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (performance.now() - openedAtRef.current < 150) return;
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        onClose();
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("contextmenu", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("contextmenu", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || presetId === null) return null;
  if (typeof document === "undefined") return null;

  const close = () => onClose();
  const usedBy = `Used by ${usageCount} cell${usageCount === 1 ? "" : "s"}`;

  const rows: ReadonlyArray<MenuRow | "divider"> = [
    {
      id: "edit",
      label: "Edit preset",
      icon: <Pencil size={14} />,
      disabled: false,
      onSelect: () => {
        onEditPreset?.(presetId);
        close();
      },
    },
    {
      id: "duplicate",
      label: "Duplicate preset",
      icon: <Copy size={14} />,
      disabled: false,
      onSelect: () => {
        onDuplicatePreset?.(presetId);
        close();
      },
    },
    "divider",
    {
      id: "usage",
      label: usedBy,
      icon: <Hash size={14} />,
      // Read-only informational row — always disabled, no onSelect.
      disabled: true,
      onSelect: () => {},
    },
    {
      id: "attribution",
      label: "Show pack chain attribution",
      icon: <Info size={14} />,
      disabled: false,
      onSelect: () => {
        onShowPackChainAttribution?.(presetId);
        close();
      },
    },
    "divider",
    {
      id: "delete",
      label: "Delete preset",
      icon: <Trash2 size={14} />,
      destructive: true,
      disabled: usageCount > 0,
      disabledHint:
        usageCount > 0 ? `Can't delete — used by ${usageCount} cells.` : undefined,
      onSelect: () => {
        if (usageCount > 0) return;
        onDeletePreset?.(presetId);
        close();
      },
    },
  ];

  // Viewport-edge clamp — same constants as MapContextMenu's clamp,
  // sized for a 6-row menu + dividers.
  const PANEL_W = 256; // w-64
  const PANEL_H_EST = 260; // 5 rows + 2 dividers + padding
  const winW =
    typeof window !== "undefined" ? window.innerWidth : screenX + PANEL_W;
  const winH =
    typeof window !== "undefined" ? window.innerHeight : screenY + PANEL_H_EST;
  const CURSOR_OFFSET = 6;
  const left = Math.min(screenX + CURSOR_OFFSET, winW - PANEL_W - 8);
  const top = Math.min(screenY + CURSOR_OFFSET, winH - PANEL_H_EST - 8);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      style={{ position: "fixed", left, top }}
      // Suppress the OS context menu on our own panel — right-clicking
      // through it shouldn't open "Inspect" and close the menu.
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "z-[1000] w-64 rounded-lg border border-zinc-800",
        "bg-zinc-900 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)]",
        "py-1",
      )}
    >
      {rows.map((row, i) => {
        if (row === "divider") {
          return (
            <div
              key={`divider-${i}`}
              className="my-1 h-px bg-zinc-800"
              aria-hidden
            />
          );
        }
        return (
          <button
            key={row.id}
            type="button"
            role="menuitem"
            disabled={row.disabled}
            title={row.disabled ? row.disabledHint : undefined}
            onClick={(e) => {
              e.stopPropagation();
              if (row.disabled) return;
              row.onSelect();
            }}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left",
              "transition-colors duration-100",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              row.destructive && !row.disabled
                ? "text-red-300 hover:bg-red-500/10 hover:text-red-200"
                : row.disabled
                  ? "text-zinc-400"
                  : "text-zinc-200 hover:bg-amber-500/10 hover:text-amber-200",
            )}
          >
            <span
              className={cn(
                "inline-flex items-center w-4 h-4",
                row.destructive && !row.disabled
                  ? "text-red-300"
                  : "text-zinc-400",
              )}
            >
              {row.icon}
            </span>
            <span className="truncate flex-1">{row.label}</span>
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
