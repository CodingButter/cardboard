import React from "react";
import { createPortal } from "react-dom";
import {
  Pencil,
  Highlighter,
  Copy,
  ClipboardPaste,
  Eraser,
  Play,
  Info,
} from "lucide-react";
import { cn } from "../lib/cn";

/**
 * MapContextMenu — anchored right-click menu for the Map / GridEditor
 * Select tool (#254).
 *
 * Visual language mirrors the R2 `DropdownMenu` primitive (zinc-900
 * panel, amber hover accents, lucide icons + label rows). Uses
 * `createPortal` to `document.body` so the floating panel escapes any
 * parent stacking context — same fix the DropdownMenu's z-index port
 * applies (parents with `position: relative` / `transform` / `filter`
 * would otherwise trap a `z-50` panel beneath sibling layers like the
 * GridEditor canvas).
 *
 * Closes on outside-click, Escape, or after firing any action.
 *
 * WIRING: opened from `MapView.tsx` when `GridEditor` emits
 * `onCellContextMenu(payload)` (Select-tool right-click). Action
 * callbacks are owned by MapView; only Copy / Paste / Clear are wired
 * end-to-end in this dispatch — the rest are intentional stubs flagged
 * with WIRING comments at the call-site.
 */

/** Layer the right-clicked cell is currently on. Mirrors the
 *  paint-grid + lighting / entities subset GridEditor surfaces (#246). */
export type CellContextMenuLayer =
  | "walls"
  | "floors"
  | "ceiling"
  | "lighting"
  | "entities";

/** Payload that GridEditor emits when the user right-clicks while the
 *  Select tool is active. The shape is intentionally flat so callers
 *  can stash it in `useState` without ref juggling. */
export interface CellContextMenuPayload {
  x: number;
  y: number;
  layer: CellContextMenuLayer;
  /** Preset id at this cell on the active layer, or null if empty /
   *  no preset palette on the layer (lighting / entities). */
  presetId: string | null;
  /** True when the walls layer has a wall preset at this cell —
   *  gates "Jump to playtest here" since the player can't spawn
   *  inside a solid. */
  isSolidWall: boolean;
  /** Mouse client X for anchoring the floating panel. */
  screenX: number;
  /** Mouse client Y. */
  screenY: number;
}

/** Clipboard entry shape — used by MapView's copy / paste flow. Kept
 *  alongside the menu so both producer (Copy action) and consumer
 *  (Paste action) share the same record shape. */
export interface CellClipboardEntry {
  layer: CellContextMenuLayer;
  presetId: string | null;
}

export interface MapContextMenuProps {
  open: boolean;
  payload: CellContextMenuPayload | null;
  onClose: () => void;
  /** "Edit parent preset" — disabled when payload.presetId is null. */
  onEditParentPreset?: (presetId: string) => void;
  /** "Copy cell" — always enabled. */
  onCopyCell?: (x: number, y: number, layer: CellContextMenuLayer) => void;
  /** "Paste cell" — disabled when `!hasClipboard`. */
  onPasteCell?: (x: number, y: number, layer: CellContextMenuLayer) => void;
  /** "Clear cell" — disabled when payload.presetId is null. */
  onClearCell?: (x: number, y: number, layer: CellContextMenuLayer) => void;
  /** "Select all with this preset" — disabled when no preset. */
  onSelectAllWithPreset?: (presetId: string) => void;
  /** "Jump to playtest here" — disabled when payload.isSolidWall. */
  onJumpToPlaytestHere?: (x: number, y: number) => void;
  /** "Show pack chain attribution" — disabled when no preset. */
  onShowPackChainAttribution?: (presetId: string) => void;
  /** Gates the Paste row's enabled state. */
  hasClipboard: boolean;
}

/** One semantic row in the menu. We build a row spec array so the
 *  divider logic + disabled / tooltip rendering stays declarative. */
interface MenuRow {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  disabled: boolean;
  /** Optional hint shown via `title` attribute when the row is
   *  disabled (R5 may swap to the Tooltip primitive, but `title` is
   *  enough for the "Can't spawn inside a wall" disabled state). */
  disabledHint?: string;
  onSelect: () => void;
}

export function MapContextMenu({
  open,
  payload,
  onClose,
  onEditParentPreset,
  onCopyCell,
  onPasteCell,
  onClearCell,
  onSelectAllWithPreset,
  onJumpToPlaytestHere,
  onShowPackChainAttribution,
  hasClipboard,
}: MapContextMenuProps) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  // Close on outside click + Escape.
  //
  // **Timestamp guard** — the right-click that opens the menu emits a
  // sequence of events (`mousedown` → `mouseup` → `contextmenu`, order
  // varies by platform). Some of these fire AFTER our useEffect runs
  // — including after a deferred `setTimeout(0)` — so synchronous OR
  // next-tick listener registration both leak through and close the
  // menu instantly. The robust fix: record an "opened at" timestamp
  // and ignore any outside event within ~150ms of opening.
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

  if (!open || !payload) return null;
  if (typeof document === "undefined") return null;

  // Build the menu row spec. The order matches the brief:
  // 1 Edit parent preset
  // 2 Select all with this preset
  // ───
  // 3 Copy cell
  // 4 Paste cell
  // 5 Clear cell
  // ───
  // 6 Jump to playtest here
  // 7 Show pack chain attribution
  const presetId = payload.presetId;
  const noPreset = presetId === null;
  const close = () => onClose();
  const rows: ReadonlyArray<MenuRow | "divider"> = [
    {
      id: "edit-preset",
      label: "Edit parent preset",
      icon: <Pencil size={14} />,
      disabled: noPreset,
      onSelect: () => {
        if (presetId) onEditParentPreset?.(presetId);
        close();
      },
    },
    {
      id: "select-all",
      label: "Select all with this preset",
      icon: <Highlighter size={14} />,
      disabled: noPreset,
      onSelect: () => {
        if (presetId) onSelectAllWithPreset?.(presetId);
        close();
      },
    },
    "divider",
    {
      id: "copy",
      label: "Copy cell",
      icon: <Copy size={14} />,
      shortcut: "⌘C",
      disabled: false,
      onSelect: () => {
        onCopyCell?.(payload.x, payload.y, payload.layer);
        close();
      },
    },
    {
      id: "paste",
      label: "Paste cell",
      icon: <ClipboardPaste size={14} />,
      shortcut: "⌘V",
      disabled: !hasClipboard,
      onSelect: () => {
        if (!hasClipboard) return;
        onPasteCell?.(payload.x, payload.y, payload.layer);
        close();
      },
    },
    {
      id: "clear",
      label: "Clear cell",
      icon: <Eraser size={14} />,
      disabled: noPreset,
      onSelect: () => {
        onClearCell?.(payload.x, payload.y, payload.layer);
        close();
      },
    },
    "divider",
    {
      id: "jump-to-playtest",
      label: "Jump to playtest here",
      icon: <Play size={14} />,
      disabled: payload.isSolidWall,
      disabledHint: payload.isSolidWall
        ? "Can't spawn inside a wall."
        : undefined,
      onSelect: () => {
        if (payload.isSolidWall) return;
        onJumpToPlaytestHere?.(payload.x, payload.y);
        close();
      },
    },
    {
      id: "attribution",
      label: "Show pack chain attribution",
      icon: <Info size={14} />,
      disabled: noPreset,
      onSelect: () => {
        if (presetId) onShowPackChainAttribution?.(presetId);
        close();
      },
    },
  ];

  // Naive viewport-collision clamp — keeps the menu inside the window
  // even when right-clicking near the right / bottom edge. The panel's
  // intrinsic width is fixed (`w-64`), so we use a constant estimate
  // before mount and trust the browser to clip the last few pixels if
  // our estimate is off.
  const PANEL_W = 256; // matches `w-64`
  const PANEL_H_EST = 320; // 7 rows + 2 dividers + padding ≈ this much
  const winW =
    typeof window !== "undefined" ? window.innerWidth : payload.screenX + PANEL_W;
  const winH =
    typeof window !== "undefined" ? window.innerHeight : payload.screenY + PANEL_H_EST;
  // Offset the menu slightly down-and-right from the cursor so the
  // first menu item isn't directly under the pointer. Two reasons:
  //   1. Matches the standard Windows / macOS context-menu convention
  //      (menu sits below + right of the cursor, not on top of it).
  //   2. Prevents an accidental hover-highlight on the first item the
  //      instant the menu opens — if the cursor lands right on an
  //      item, even a small involuntary mouse twitch on right-button
  //      release reads as "clicked the first item."
  const CURSOR_OFFSET = 6;
  const left = Math.min(payload.screenX + CURSOR_OFFSET, winW - PANEL_W - 8);
  const top = Math.min(payload.screenY + CURSOR_OFFSET, winH - PANEL_H_EST - 8);

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      // High z-index + position:fixed to escape any parent stacking
      // context (the GridEditor canvas wrapper uses
      // `position: relative` + `overflow: hidden`, which would
      // otherwise clip a non-portaled menu).
      style={{ position: "fixed", left, top }}
      // Suppress the OS context menu when the user right-clicks the
      // popup itself (clicking through to "Inspect" would close the
      // menu and confuse).
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
              row.disabled
                ? "text-zinc-400"
                : "text-zinc-200 hover:bg-amber-500/10 hover:text-amber-200",
            )}
          >
            <span className="inline-flex items-center w-4 h-4 text-zinc-400">
              {row.icon}
            </span>
            <span className="truncate flex-1">{row.label}</span>
            {row.shortcut ? (
              <span
                className={cn(
                  "ml-2 text-[10px] font-mono uppercase tracking-wide",
                  row.disabled ? "text-zinc-600" : "text-zinc-500",
                )}
              >
                {row.shortcut}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
