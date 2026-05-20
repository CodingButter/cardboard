import React from "react";
import {
  Brush,
  CheckCheck,
  Edit3,
  Eraser,
  History,
  MousePointer2,
  PlusSquare,
  Redo2,
  Settings,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import {
  useHistoryStore,
  type HistoryEntry,
  type HistoryEntryType,
} from "../../../state/useHistoryStore";

/**
 * HistoryPanel — undo/redo stack visualization.
 *
 * Visual target: a reverse-chronological list of historical actions
 * with a horizontal cursor line marking the current position. Entries
 * "above" the cursor (in stack order — i.e. after it in time) are
 * shown dimmed because they've been undone; entries below remain
 * applied. Clicking any entry jumps the cursor to a position just
 * after that entry.
 *
 * Backed by `useHistoryStore` — entries + cursor are the source of
 * truth. The store's `partialize` handles persistence (capped at the
 * last MAX_ENTRIES) so the panel no longer touches localStorage.
 *
 * Opt-in panel — not part of the default Scene/Map.png layout — but a
 * real panel with command-registry and a responsive narrow-width
 * mode that hides timestamps.
 *
 * Command-registry contract: undo / redo / markAllApplied / clear
 * AND a dynamic per-entry `scene.history.jump.<entryId>` command for
 * every history row. The jump-command titles include the row label
 * so the palette presents "Jump to: Paint Brick (14 cells)".
 *
 *   - `scene.history.markAllApplied` — moves the cursor to entries.length
 *     so every entry reads as applied. Confirms before running.
 *   - `scene.history.clear` — drops every entry from the log.
 *     Destructive; confirms before running.
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
  settings: Settings,
};

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
  //
  // Two separate subscriptions — cursor changes (undo / redo / jump)
  // commonly happen without an `entries` identity change, so splitting
  // the selectors keeps re-renders minimal.

  const entries = useHistoryStore((s) => s.entries);
  const cursor = useHistoryStore((s) => s.cursor);
  const maxCursor = entries.length;

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

  // ---- Handlers ---------------------------------------------------------
  //
  // The store's undo / redo move the cursor AND return the entry that
  // should be applied. The panel only manages the visualisation, so we
  // discard the return value here — the dispatcher layer (or eventual
  // historyDispatcher per the store's docstring) is responsible for
  // replaying the inverse / forward payloads.

  const handleUndo = React.useCallback(() => {
    useHistoryStore.getState().undo();
  }, []);

  const handleRedo = React.useCallback(() => {
    useHistoryStore.getState().redo();
  }, []);

  const handleMarkAllApplied = React.useCallback(() => {
    if (typeof window === "undefined") {
      useHistoryStore.getState().markAllApplied();
      return;
    }
    const ok = window.confirm(
      "Mark every history entry as applied? The cursor will move to the end of history.",
    );
    if (!ok) return;
    useHistoryStore.getState().markAllApplied();
  }, []);

  const handleClear = React.useCallback(() => {
    if (typeof window === "undefined") {
      useHistoryStore.getState().clear();
      return;
    }
    const ok = window.confirm(
      "Clear all history? This drops every entry from the log and cannot be undone.",
    );
    if (!ok) return;
    useHistoryStore.getState().clear();
  }, []);

  // Jump sets the cursor to the position just AFTER the entry at
  // `idx` — i.e. that entry is the most recent applied one. This
  // matches the typical timeline UX where clicking an entry "rolls"
  // the project to that state.
  const handleJump = React.useCallback((idx: number) => {
    useHistoryStore.getState().jumpTo(idx + 1);
  }, []);

  // ---- Command-registry refs --------------------------------------------
  // Canonical handler-ref pattern from `state/README.md` — keeps the
  // dynamic per-entry effect from needing handler identities in deps.

  const undoRef = React.useRef(handleUndo);
  const redoRef = React.useRef(handleRedo);
  const markAllAppliedRef = React.useRef(handleMarkAllApplied);
  const clearRef = React.useRef(handleClear);
  const jumpRef = React.useRef(handleJump);

  React.useEffect(() => {
    undoRef.current = handleUndo;
    redoRef.current = handleRedo;
    markAllAppliedRef.current = handleMarkAllApplied;
    clearRef.current = handleClear;
    jumpRef.current = handleJump;
  }, [handleUndo, handleRedo, handleMarkAllApplied, handleClear, handleJump]);

  // Static commands: undo / redo / markAllApplied / clear. Empty-deps
  // register-once.
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
        id: "scene.history.markAllApplied",
        title: "Mark All Applied",
        category: "History",
        keywords: ["mark", "applied", "all", "history", "cursor", "end"],
        description:
          "Move the cursor to the end of history — every entry will read as applied. Confirms before running.",
        icon: <CheckCheck size={14} />,
        run: () => markAllAppliedRef.current(),
      }),
      registerCommand({
        id: "scene.history.clear",
        title: "Clear History",
        category: "History",
        keywords: ["clear", "delete", "history", "reset", "purge"],
        description:
          "Drop every history entry. Destructive and irreversible — confirms before running.",
        icon: <X size={14} />,
        run: () => clearRef.current(),
      }),
    ];
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // Dynamic per-entry jump commands. Re-register when `entries`
  // identity changes — push / clear / jumpTo (the latter doesn't
  // change the entries array but its identity stays stable). Mirrors
  // LayersPanel's dynamic-command pattern.
  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    entries.forEach((entry, idx) => {
      unregs.push(
        registerCommand({
          id: `scene.history.jump.${entry.id}`,
          title: `Jump to: ${entry.label}`,
          category: "History",
          keywords: ["history", "jump", "goto", entry.type, entry.label],
          run: () => jumpRef.current(idx),
        }),
      );
    });
    return () => {
      for (const u of unregs) u();
    };
  }, [entries]);

  // ---- Render -----------------------------------------------------------
  //
  // The list renders most-recent at the TOP, so we iterate the entries
  // in reverse. The horizontal cursor line is inserted as its own row
  // at the position dictated by `cursor` — when `cursor === maxCursor`,
  // the line is at the very bottom (everything applied); when
  // `cursor === 0` the line is at the very top (everything undone).
  //
  // Entries whose original index >= cursor are "undone" (above the
  // line in time) and get reduced opacity.

  const reversed = React.useMemo(() => {
    const out: Array<{ entry: HistoryEntry; originalIdx: number }> = [];
    entries.forEach((entry, idx) => {
      out.unshift({ entry, originalIdx: idx });
    });
    return out;
  }, [entries]);

  // Edge case: when there are zero entries, cursor === maxCursor === 0
  // and BOTH the "above-everything" and "below-everything" cursor
  // lines would render — collapse to a single line.
  const showTopLine = cursor >= maxCursor;
  const showBottomLine = cursor === 0 && maxCursor > 0;

  return (
    <div
      ref={rootRef}
      data-panel="history"
      className="h-full w-full flex flex-col gap-1.5 min-w-0"
    >
      {/* Toolbar — Undo / Redo / cursor pip / Mark All Applied. The
          cursor pip fills the otherwise-empty middle space with a
          tabular position readout. */}
      <div className="flex items-center gap-1 shrink-0">
        <ToolbarButton
          label="Undo"
          description="Step cursor back one entry."
          disabled={cursor <= 0}
          onClick={handleUndo}
          icon={Undo2}
        />
        <ToolbarButton
          label="Redo"
          description="Step cursor forward one entry."
          disabled={cursor >= maxCursor}
          onClick={handleRedo}
          icon={Redo2}
        />
        <div className="flex-1" />
        <Tooltip
          side="bottom"
          stages={[
            { delay: 1000, content: <span>Cursor position</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">Cursor position</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[240px] whitespace-normal">
                    Applied entries / total entries.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <span
            className="text-[10px] tabular-nums text-(--color-fg-muted) px-1 select-none"
            aria-label={`Cursor at ${cursor} of ${maxCursor}`}
          >
            {cursor} / {maxCursor}
          </span>
        </Tooltip>
        <ToolbarButton
          label="Mark All Applied"
          description="Move cursor to the end — every entry reads as applied."
          onClick={handleMarkAllApplied}
          icon={CheckCheck}
        />
      </div>

      {/* History list — reverse-chronological, vertical scroll only.
          The cursor indicator is rendered between rows. Themed
          scrollbars are inherited from the panel surface. */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
        {/* If cursor is at MAX, every entry is applied; the cursor
            line sits ABOVE the first reversed row (which is the most
            recent applied action). */}
        {showTopLine ? <CursorLine /> : null}

        {reversed.map(({ entry, originalIdx }) => {
          const isApplied = originalIdx < cursor;
          // The most-recently-applied entry — the cursor's anchor —
          // gets an active indicator (amber accent + font weight bump).
          const isActive = originalIdx === cursor - 1;
          // The cursor line goes immediately AFTER a reversed entry
          // when that entry is the last APPLIED one — i.e. when
          // originalIdx === cursor - 1.
          const lineAfterThis = isActive;
          return (
            <React.Fragment key={entry.id}>
              <HistoryEntryView
                entry={entry}
                isApplied={isApplied}
                isActive={isActive}
                compact={compact}
                onJump={() => handleJump(originalIdx)}
              />
              {lineAfterThis ? <CursorLine /> : null}
            </React.Fragment>
          );
        })}

        {showBottomLine ? <CursorLine /> : null}
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
}

function ToolbarButton({
  label,
  description,
  icon: Icon,
  onClick,
  disabled = false,
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
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[240px] whitespace-normal">
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
  // Indent the leading dot so it aligns with the row icons' centers.
  // Row layout: button `px-1.5` (6px) + icon container `w-4` (16px) →
  // icon center sits at 6 + 8 = 14px. Dot is `w-1.5` (6px), so its
  // left edge should be at 14 - 3 = 11px → `pl-[11px]`.
  return (
    <div
      role="separator"
      aria-label="History cursor"
      className="flex items-center gap-1.5 py-0.5 pl-[11px] shrink-0"
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
  entry: HistoryEntry;
  isApplied: boolean;
  isActive: boolean;
  compact: boolean;
  onJump: () => void;
}

function HistoryEntryView({
  entry,
  isApplied,
  isActive,
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
        aria-current={isActive ? "true" : undefined}
        className={[
          "flex items-center gap-1.5 min-h-[24px] px-1.5 rounded",
          "border border-transparent text-left w-full min-w-0",
          "transition-colors",
          "hover:border-amber-500/40 hover:bg-amber-500/5",
          isApplied ? "" : "opacity-50",
          // Active-entry indicator: left border accent + slight bg
          // tint + font weight bump on the label below. Only the most
          // recently APPLIED entry gets this treatment.
          isActive ? "border-l-2 border-l-amber-500 bg-amber-500/[0.04]" : "",
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
            isActive
              ? "font-medium text-(--color-fg-primary)"
              : isApplied
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
