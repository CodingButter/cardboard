import React from "react";
import {
  Brush,
  Edit3,
  Eraser,
  History,
  MousePointer2,
  PlusSquare,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_HISTORY,
  type HistoryEntryRow,
  type HistoryEntryType,
} from "../scene-fixtures";

/**
 * HistoryPanel — undo/redo stack visualization.
 *
 * Visual target: a reverse-chronological list of historical actions
 * with a horizontal cursor line marking the current position. Entries
 * "above" the cursor (in stack order — i.e. after it in time) are
 * shown dimmed because they've been undone; entries below remain
 * applied. Clicking any entry jumps the cursor to a position just
 * after that entry — a stub for the real EditorProjectStore undo
 * history that will replace MOCK_HISTORY in a later wave.
 *
 * Opt-in panel — not part of the default Scene/Map.png layout — but a
 * real panel with command-registry, persistence, and a responsive
 * narrow-width mode that hides timestamps.
 *
 * Persistence contract (page-scope localStorage):
 *   - `cardboard.scene.history.cursorPos`  number, default
 *     MOCK_HISTORY.length (i.e. all-applied / cursor at end).
 *
 * Command-registry contract: undo/redo/clear AND a dynamic per-entry
 * `scene.history.jump.<entryId>` command for every history row. The
 * jump-command titles include the row label so the palette presents
 * "Jump to: Paint Brick (14 cells)".
 */

// ---------------------------------------------------------------------------
// Type → icon map. New `HistoryEntryType` literals added in fixtures
// should add an entry here; unknown types fall back to a generic dot.

const TYPE_ICON: Record<HistoryEntryType, LucideIcon> = {
  paint: Brush,
  erase: Eraser,
  place: PlusSquare,
  delete: Trash2,
  edit: Edit3,
  select: MousePointer2,
};

// ---------------------------------------------------------------------------
// localStorage helpers — mirror the LayersPanel / ToolPalettePanel
// shape so the next wave can swap a single readLS/writeLS pair out for
// the real store without a deeper refactor.

const LS_CURSOR_POS = "cardboard.scene.history.cursorPos";

function readLS(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

// ---------------------------------------------------------------------------
// Cursor utilities. `cursorPos` is the count of applied entries — 0
// means everything undone, MOCK_HISTORY.length means everything
// applied. Entries with index < cursorPos are "applied" (rendered at
// full opacity); index >= cursorPos are "undone" (dimmed).

const MAX_CURSOR = MOCK_HISTORY.length;

function clampCursor(n: number): number {
  if (!Number.isFinite(n)) return MAX_CURSOR;
  return Math.max(0, Math.min(MAX_CURSOR, Math.round(n)));
}

function readInitialCursor(): number {
  const raw = readLS(LS_CURSOR_POS);
  if (raw === null) return MAX_CURSOR;
  const parsed = Number.parseInt(raw, 10);
  return clampCursor(parsed);
}

function formatTimestamp(ts: number): string {
  try {
    const d = new Date(ts);
    // Compact HH:MM:SS for in-panel timestamps — entries are minutes
    // apart in the fixture so a full date is overkill.
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Responsive breakpoint. Below ~140px we drop the timestamp column to
// give the label as much room as possible. Container queries aren't
// wired in this codebase yet, so we use a ResizeObserver per
// LayersPanel's precedent.

const COMPACT_WIDTH_PX = 140;

export function HistoryPanel(): React.JSX.Element {
  // ---- State -------------------------------------------------------------

  const [cursor, setCursor] = React.useState<number>(readInitialCursor);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [compact, setCompact] = React.useState(false);

  React.useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w > 0 && w < COMPACT_WIDTH_PX);
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // ---- Persistence ------------------------------------------------------

  React.useEffect(() => {
    writeLS(LS_CURSOR_POS, String(cursor));
  }, [cursor]);

  // ---- Handlers ---------------------------------------------------------

  const handleUndo = React.useCallback(() => {
    setCursor((prev) => clampCursor(prev - 1));
  }, []);

  const handleRedo = React.useCallback(() => {
    setCursor((prev) => clampCursor(prev + 1));
  }, []);

  const handleClear = React.useCallback(() => {
    if (typeof window === "undefined") {
      setCursor(MAX_CURSOR);
      return;
    }
    const ok = window.confirm(
      "Clear scene history? Undo/redo state will be reset.",
    );
    if (!ok) return;
    setCursor(MAX_CURSOR);
  }, []);

  // Jump sets the cursor to the position just AFTER the entry at
  // `idx` — i.e. that entry is the most recent applied one. This
  // matches the typical timeline UX where clicking an entry "rolls"
  // the project to that state.
  const handleJump = React.useCallback((idx: number) => {
    setCursor(clampCursor(idx + 1));
  }, []);

  // ---- Command-registry refs --------------------------------------------
  // Canonical handler-ref pattern from `state/README.md` — keeps the
  // dynamic per-entry effect from needing handler identities in deps.

  const undoRef = React.useRef(handleUndo);
  const redoRef = React.useRef(handleRedo);
  const clearRef = React.useRef(handleClear);
  const jumpRef = React.useRef(handleJump);

  React.useEffect(() => {
    undoRef.current = handleUndo;
    redoRef.current = handleRedo;
    clearRef.current = handleClear;
    jumpRef.current = handleJump;
  }, [handleUndo, handleRedo, handleClear, handleJump]);

  // Static commands: undo / redo / clear. Empty-deps register-once.
  React.useEffect(() => {
    const unregs: Array<() => void> = [
      registerCommand({
        id: "scene.history.undo",
        title: "Undo",
        category: "History",
        keywords: ["undo", "history", "back"],
        keybinding: "Ctrl+Z",
        icon: <Undo2 size={14} />,
        run: () => undoRef.current(),
      }),
      registerCommand({
        id: "scene.history.redo",
        title: "Redo",
        category: "History",
        keywords: ["redo", "history", "forward"],
        keybinding: "Ctrl+Shift+Z",
        icon: <Redo2 size={14} />,
        run: () => redoRef.current(),
      }),
      registerCommand({
        id: "scene.history.clear",
        title: "Clear History",
        category: "History",
        keywords: ["clear", "reset", "history"],
        icon: <X size={14} />,
        run: () => clearRef.current(),
      }),
    ];
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // Dynamic per-entry jump commands. MOCK_HISTORY is a module-level
  // constant today so empty deps mirror BrushPanel's MOCK_BRUSHES
  // treatment — identity is stable per module load.
  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    (MOCK_HISTORY as readonly HistoryEntryRow[]).forEach((entry, idx) => {
      unregs.push(
        registerCommand({
          id: `scene.history.jump.${entry.id}`,
          title: `Jump to: ${entry.label}`,
          category: "History",
          keywords: ["history", "jump", "goto", entry.type, entry.label],
          description: entry.description,
          run: () => jumpRef.current(idx),
        }),
      );
    });
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // ---- Render -----------------------------------------------------------
  //
  // The list renders most-recent at the TOP, so we iterate the fixture
  // in reverse. The horizontal cursor line is inserted as its own row
  // at the position dictated by `cursor` — when `cursor === MAX`, the
  // line is at the very bottom (everything applied); when `cursor === 0`
  // the line is at the very top (everything undone).
  //
  // Entries whose original index >= cursor are "undone" (above the
  // line in time) and get reduced opacity.

  const reversed = React.useMemo(() => {
    const out: Array<{ entry: HistoryEntryRow; originalIdx: number }> = [];
    (MOCK_HISTORY as readonly HistoryEntryRow[]).forEach((entry, idx) => {
      out.unshift({ entry, originalIdx: idx });
    });
    return out;
  }, []);

  return (
    <div
      ref={rootRef}
      data-panel="history"
      className="h-full w-full flex flex-col gap-1.5 min-w-0"
    >
      {/* Toolbar — Undo / Redo / Clear. Three buttons fit inline even
          at the narrowest sensible width, so no wrap logic needed. */}
      <div className="flex items-center gap-1 shrink-0">
        <ToolbarButton
          label="Undo"
          description="Step the cursor one entry backward — undoes the most recently applied action."
          disabled={cursor <= 0}
          onClick={handleUndo}
          icon={Undo2}
        />
        <ToolbarButton
          label="Redo"
          description="Step the cursor one entry forward — reapplies the next undone action."
          disabled={cursor >= MAX_CURSOR}
          onClick={handleRedo}
          icon={Redo2}
        />
        <div className="flex-1" />
        <ToolbarButton
          label="Clear"
          description="Reset the history cursor. Confirms before running."
          onClick={handleClear}
          icon={X}
          variant="danger"
        />
      </div>

      {/* History list — reverse-chronological, vertical scroll only.
          The cursor indicator is rendered between rows. Themed
          scrollbars are inherited from the panel surface. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        {/* If cursor is at MAX, every entry is applied; the cursor
            line sits ABOVE the first reversed row (which is the most
            recent applied action). */}
        {cursor >= MAX_CURSOR ? <CursorLine /> : null}

        {reversed.map(({ entry, originalIdx }, _reversedIdx) => {
          const isApplied = originalIdx < cursor;
          // The cursor line goes immediately AFTER a reversed entry
          // when that entry is the last APPLIED one — i.e. when
          // originalIdx === cursor - 1.
          const lineAfterThis = originalIdx === cursor - 1;
          // Special case: cursor === 0 — line above EVERYTHING.
          // Handled below the map.
          return (
            <React.Fragment key={entry.id}>
              <HistoryEntryView
                entry={entry}
                isApplied={isApplied}
                compact={compact}
                onJump={() => handleJump(originalIdx)}
              />
              {lineAfterThis ? <CursorLine /> : null}
            </React.Fragment>
          );
        })}

        {cursor === 0 ? <CursorLine /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar button — small icon button with progressive tooltip and a
// disabled-state visual treatment. Mirrors LayersPanel reorder
// buttons but as standalone toolbar chips.

interface ToolbarButtonProps {
  label: string;
  description: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "danger";
}

function ToolbarButton({
  label,
  description,
  icon: Icon,
  onClick,
  disabled = false,
  variant = "default",
}: ToolbarButtonProps): React.JSX.Element {
  return (
    <Tooltip
      side="bottom"
      stages={[
        { delay: 1000, content: <span>{label}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{label}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {description}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className={[
          "flex items-center justify-center w-6 h-6 rounded",
          "border transition-colors",
          disabled
            ? "text-(--color-fg-muted) opacity-40 cursor-not-allowed border-(--color-border-strong)"
            : variant === "danger"
              ? "text-(--color-fg-secondary) border-(--color-border-strong) hover:text-red-400 hover:border-red-500/60"
              : "text-(--color-fg-secondary) border-(--color-border-strong) hover:text-(--color-fg-primary) hover:border-amber-500/60",
        ].join(" ")}
      >
        <Icon size={12} aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Cursor line — thin horizontal accent rule separating applied from
// undone entries. Wraps an accent dot for visual anchor.

function CursorLine(): React.JSX.Element {
  return (
    <div
      role="separator"
      aria-label="History cursor"
      className="flex items-center gap-1.5 py-0.5 shrink-0"
    >
      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
      <div className="flex-1 h-px bg-amber-500/70" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// History entry row — `[icon] [label] [timestamp]`. The whole row is
// a button so clicking anywhere on it jumps the cursor to that point.
// Long labels truncate with ellipsis; the full label + description is
// in the progressive tooltip stage 2 body.

interface HistoryEntryViewProps {
  entry: HistoryEntryRow;
  isApplied: boolean;
  compact: boolean;
  onJump: () => void;
}

function HistoryEntryView({
  entry,
  isApplied,
  compact,
  onJump,
}: HistoryEntryViewProps): React.JSX.Element {
  const Icon = TYPE_ICON[entry.type];
  const ts = formatTimestamp(entry.ts);

  return (
    <Tooltip
      side="right"
      stages={[
        { delay: 1000, content: <span>{entry.label}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{entry.label}</div>
              {entry.description ? (
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {entry.description}
                </div>
              ) : null}
              <div className="text-[10px] text-(--color-fg-muted) mt-1">
                {entry.type} · {ts}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        onClick={onJump}
        aria-label={`Jump to: ${entry.label}`}
        className={[
          "flex items-center gap-1.5 min-h-[24px] px-1.5 rounded",
          "border border-transparent text-left w-full min-w-0",
          "transition-colors",
          "hover:border-amber-500/40 hover:bg-amber-500/5",
          isApplied ? "" : "opacity-50",
        ].join(" ")}
      >
        {/* Type icon — small leading glyph; aria-hidden because the
            label carries the type implicitly via the tooltip body. */}
        <span
          className={[
            "flex items-center justify-center w-4 h-4 shrink-0",
            isApplied
              ? "text-(--color-fg-secondary)"
              : "text-(--color-fg-muted)",
          ].join(" ")}
        >
          {Icon ? <Icon size={12} aria-hidden="true" /> : null}
        </span>

        {/* Label — flex-1 + min-w-0 + truncate is the canonical
            ellipsis recipe in this codebase. */}
        <span
          className={[
            "flex-1 min-w-0 truncate text-[11px]",
            isApplied
              ? "text-(--color-fg-primary)"
              : "text-(--color-fg-secondary)",
          ].join(" ")}
        >
          {entry.label}
        </span>

        {/* Timestamp — hidden in compact mode to free up label room.
            Full info is still in the tooltip's stage-2 body. */}
        {!compact && ts ? (
          <span
            className="shrink-0 text-[10px] tabular-nums text-(--color-fg-muted)"
            aria-hidden="true"
          >
            {ts}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "history",
  title: "History",
  icon: <History size={12} />,
};

export default HistoryPanel;
