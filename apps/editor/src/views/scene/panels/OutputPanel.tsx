import React from "react";
import {
  AlertTriangle,
  CircleAlert,
  Copy,
  Info,
  ListFilter,
  MoreVertical,
  Terminal,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { ScrollRow } from "../../../components/ui/ScrollRow";
import { registerCommand } from "../../../state/useCommandStore";
import {
  MOCK_LOG_LINES,
  type LogLineRow,
  type LogSeverity,
} from "../scene-fixtures";

/**
 * OutputPanel — log-stream surface for engine and build output.
 *
 * Visual target: the bottom-strip "Output" console from
 * `Editor Design/Map.png`. VSCode-style: monospace lines with a
 * severity dot, timestamp, message; a filter chip row + Clear/Copy
 * actions across the top. Wave 2 wires this to the editor's
 * diagnostic bus + engine console; for now it consumes the
 * `MOCK_LOG_LINES` fixture so the panel renders identically to its
 * eventual live shape.
 *
 * Registry note: this panel is registered with `surface: false` in
 * `MapView.tsx`, so DockShell does NOT wrap it in a `<PanelSurface/>`.
 * The body renders flush against the dock content area — we OWN our
 * own padding, and there is no card chrome/background.
 *
 * Persistence contract:
 *   - `cardboard.scene.output.filter` — `LogSeverity | "all"`, default `"all"`.
 *
 * Command registry contract — every action here registers a command
 * via `registerCommand` (see `state/README.md`):
 *   - `scene.output.clear`
 *   - `scene.output.filter.all|info|warn|error`
 *   - `scene.output.copyAll`
 */

// ---------------------------------------------------------------------------
// Persistence

const LS_FILTER = "cardboard.scene.output.filter";

type FilterValue = LogSeverity | "all";
const DEFAULT_FILTER: FilterValue = "all";

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

function isFilterValue(value: string | null): value is FilterValue {
  return value === "all" || value === "info" || value === "warn" || value === "error";
}

// ---------------------------------------------------------------------------
// Severity + filter metadata

interface SeverityMeta {
  /** Tailwind text colour for the timestamp + dot in the log row. */
  text: string;
  /** Tailwind bg colour for the dot. */
  dot: string;
  /** Inline icon for the row (small lucide glyph). */
  icon: LucideIcon;
  /** Short label used in tooltips and aria. */
  label: string;
}

const SEVERITY_META: Record<LogSeverity, SeverityMeta> = {
  info: {
    text: "text-(--color-fg-secondary)",
    dot: "bg-sky-400",
    icon: Info,
    label: "Info",
  },
  warn: {
    text: "text-amber-400",
    dot: "bg-amber-500",
    icon: AlertTriangle,
    label: "Warn",
  },
  error: {
    text: "text-red-400",
    dot: "bg-red-500",
    icon: CircleAlert,
    label: "Error",
  },
};

interface FilterMeta {
  id: FilterValue;
  name: string;
  description: string;
  /** Tailwind colour class for the chip's dot. `null` for "all". */
  dot: string | null;
}

const FILTER_META: readonly FilterMeta[] = [
  {
    id: "all",
    name: "All",
    description: "Show every log entry regardless of severity.",
    dot: null,
  },
  {
    id: "info",
    name: "Info",
    description: "Show only informational log entries (autosaves, paint actions, scene loads).",
    dot: "bg-sky-400",
  },
  {
    id: "warn",
    name: "Warn",
    description: "Show only warning log entries (deprecations, missing assignments).",
    dot: "bg-amber-500",
  },
  {
    id: "error",
    name: "Error",
    description: "Show only error log entries (missing assets, failed operations).",
    dot: "bg-red-500",
  },
] as const;

// ---------------------------------------------------------------------------
// Timestamp formatting

/** HH:MM:SS, padded. Locale-independent so the column width is stable. */
function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

// ---------------------------------------------------------------------------
// Responsive breakpoint — fold actions into a kebab below this width.

const NARROW_BREAKPOINT_PX = 320;

function useIsNarrow(
  ref: React.RefObject<HTMLElement | null>,
  threshold: number,
): boolean {
  const [narrow, setNarrow] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setNarrow(w > 0 && w < threshold);
      }
    });
    ro.observe(el);
    // Seed once synchronously so the first paint matches.
    setNarrow(el.clientWidth > 0 && el.clientWidth < threshold);
    return () => ro.disconnect();
  }, [ref, threshold]);
  return narrow;
}

// ---------------------------------------------------------------------------
// Panel

export function OutputPanel(): React.JSX.Element {
  const [filter, setFilter] = React.useState<FilterValue>(() => {
    const stored = readLS(LS_FILTER);
    if (isFilterValue(stored)) return stored;
    return DEFAULT_FILTER;
  });

  // `lines` is the working in-memory view. Clear empties it; remount
  // re-seeds from the fixture. Wave 2 swaps the seed for a live
  // subscription to the diagnostic bus.
  const [lines, setLines] = React.useState<readonly LogLineRow[]>(
    () => MOCK_LOG_LINES as readonly LogLineRow[],
  );

  // Persist filter on change.
  React.useEffect(() => {
    writeLS(LS_FILTER, filter);
  }, [filter]);

  // Action handlers — wrapped in refs so the command-registration
  // effects don't need to depend on the latest closures.
  const handleFilterClick = React.useCallback((next: FilterValue) => {
    setFilter(next);
  }, []);

  const handleClear = React.useCallback(() => {
    setLines([]);
  }, []);

  const visibleLines = React.useMemo(() => {
    if (filter === "all") return lines;
    return lines.filter((l) => l.severity === filter);
  }, [lines, filter]);

  const handleCopyAll = React.useCallback(() => {
    const text = visibleLines
      .map((l) => `[${formatTimestamp(l.ts)}] ${l.severity.toUpperCase()} ${l.message}`)
      .join("\n");
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        void navigator.clipboard.writeText(text);
      }
    } catch {
      /* clipboard rejected (insecure context / permissions) — no-op */
    }
  }, [visibleLines]);

  const filterHandlerRef = React.useRef(handleFilterClick);
  const clearHandlerRef = React.useRef(handleClear);
  const copyHandlerRef = React.useRef(handleCopyAll);
  React.useEffect(() => {
    filterHandlerRef.current = handleFilterClick;
  }, [handleFilterClick]);
  React.useEffect(() => {
    clearHandlerRef.current = handleClear;
  }, [handleClear]);
  React.useEffect(() => {
    copyHandlerRef.current = handleCopyAll;
  }, [handleCopyAll]);

  // Register commands.
  React.useEffect(() => {
    const unregs = [
      registerCommand({
        id: "scene.output.clear",
        title: "Clear Output",
        category: "Output",
        keywords: ["output", "clear", "log", "console"],
        description: "Empty the Output console's displayed log list.",
        run: () => clearHandlerRef.current(),
      }),
      registerCommand({
        id: "scene.output.copyAll",
        title: "Copy Output to Clipboard",
        category: "Output",
        keywords: ["output", "copy", "clipboard", "log"],
        description: "Copy every currently-visible log line to the system clipboard.",
        run: () => copyHandlerRef.current(),
      }),
    ];
    return () => unregs.forEach((u) => u());
  }, []);

  React.useEffect(() => {
    const unregs = FILTER_META.map((f) =>
      registerCommand({
        id: `scene.output.filter.${f.id}`,
        title: `Filter Output: ${f.name}`,
        category: "Output",
        keywords: ["output", "filter", "log", f.id, f.name],
        description: f.description,
        run: () => filterHandlerRef.current(f.id),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  // Auto-scroll-to-bottom on new entries. Static fixture today, but
  // wire the ref + effect now so Wave 2's live stream is a no-op switch.
  const listRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [visibleLines]);

  // Narrow-mode detection — fold action buttons into a kebab when the
  // toolbar can't comfortably fit them.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const isNarrow = useIsNarrow(rootRef, NARROW_BREAKPOINT_PX);

  // `surface: false` → no PanelSurface wrapping. WE own padding and
  // the dark page bg shows through. Root is a vertical flex column:
  // toolbar (fixed height) + log list (flex-1, vertical scroll).
  return (
    <div
      ref={rootRef}
      data-panel="output"
      className="h-full w-full min-h-0 flex flex-col gap-1 px-2 pt-1.5 pb-1 text-(--color-fg-primary)"
    >
      <OutputToolbar
        filter={filter}
        onFilterClick={handleFilterClick}
        onClear={handleClear}
        onCopy={handleCopyAll}
        narrow={isNarrow}
      />
      <OutputList ref={listRef} lines={visibleLines} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar — filter chips + action buttons (or kebab when narrow)

interface OutputToolbarProps {
  filter: FilterValue;
  onFilterClick: (next: FilterValue) => void;
  onClear: () => void;
  onCopy: () => void;
  narrow: boolean;
}

function OutputToolbar({
  filter,
  onFilterClick,
  onClear,
  onCopy,
  narrow,
}: OutputToolbarProps): React.JSX.Element {
  return (
    <div className="shrink-0 h-7 flex items-center gap-1 min-w-0">
      <div className="flex-1 min-w-0">
        <FilterChipRow active={filter} onClick={onFilterClick} />
      </div>
      <div className="shrink-0 flex items-center gap-1 pl-1">
        {narrow ? (
          <OutputKebab onClear={onClear} onCopy={onCopy} />
        ) : (
          <>
            <ToolbarIconButton
              ariaLabel="Copy Output to Clipboard"
              tooltipLabel="Copy"
              tooltipDescription="Copy every currently-visible log line to the system clipboard."
              onClick={onCopy}
              icon={<Copy size={12} aria-hidden="true" />}
            />
            <ToolbarIconButton
              ariaLabel="Clear Output"
              tooltipLabel="Clear"
              tooltipDescription="Empty the Output console's displayed log list."
              onClick={onClear}
              icon={<Trash2 size={12} aria-hidden="true" />}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter chip row

interface FilterChipRowProps {
  active: FilterValue;
  onClick: (next: FilterValue) => void;
}

function FilterChipRow({ active, onClick }: FilterChipRowProps): React.JSX.Element {
  return (
    <div className="h-7">
      <ScrollRow contentClassName="flex items-center gap-1">
        {FILTER_META.map((f) => {
          const isActive = f.id === active;
          return (
            <Tooltip
              key={f.id}
              side="bottom"
              stages={[
                { delay: 1000, content: <span>{`Filter: ${f.name}`}</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">{`Filter: ${f.name}`}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                        {f.description}
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label={`Filter ${f.name}`}
                aria-pressed={isActive}
                onClick={() => onClick(f.id)}
                className={[
                  "shrink-0 inline-flex items-center gap-1",
                  "rounded-full px-2 py-0.5 text-[9px] uppercase tracking-wide",
                  "border transition-colors",
                  isActive
                    ? "bg-amber-500 border-amber-500 text-zinc-950"
                    : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                ].join(" ")}
              >
                {f.dot ? (
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-block w-1.5 h-1.5 rounded-full",
                      f.dot,
                    ].join(" ")}
                  />
                ) : (
                  <ListFilter size={10} aria-hidden="true" />
                )}
                <span>{f.name}</span>
              </button>
            </Tooltip>
          );
        })}
      </ScrollRow>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar icon button (Clear / Copy)

interface ToolbarIconButtonProps {
  ariaLabel: string;
  tooltipLabel: string;
  tooltipDescription: string;
  onClick: () => void;
  icon: React.ReactNode;
}

function ToolbarIconButton({
  ariaLabel,
  tooltipLabel,
  tooltipDescription,
  onClick,
  icon,
}: ToolbarIconButtonProps): React.JSX.Element {
  return (
    <Tooltip
      side="bottom"
      stages={[
        { delay: 1000, content: <span>{tooltipLabel}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{tooltipLabel}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {tooltipDescription}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={onClick}
        className={[
          "inline-flex items-center justify-center",
          "w-6 h-6 rounded",
          "border transition-colors",
          "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary)",
          "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {icon}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Kebab menu (narrow widths only)

interface OutputKebabProps {
  onClear: () => void;
  onCopy: () => void;
}

function OutputKebab({ onClear, onCopy }: OutputKebabProps): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (!wrapperRef.current?.contains(target)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapperRef} className="relative inline-flex">
      <Tooltip
        side="bottom"
        stages={[
          { delay: 1000, content: <span>More</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">More actions</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  Reveal Clear and Copy actions — folded behind a kebab at narrow panel widths.
                </div>
              </div>
            ),
          },
        ]}
      >
        <button
          type="button"
          aria-label="More output actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={[
            "inline-flex items-center justify-center",
            "w-6 h-6 rounded",
            "border transition-colors",
            "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary)",
            "hover:border-amber-500/60 hover:text-(--color-fg-primary)",
          ].join(" ")}
        >
          <MoreVertical size={12} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <div
          role="menu"
          className={[
            "absolute right-0 top-full mt-1 z-50",
            "min-w-[140px] py-1 rounded-md",
            "border border-(--color-border-strong) bg-zinc-900 shadow-lg",
          ].join(" ")}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onCopy();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Copy size={12} aria-hidden="true" />
            <span>Copy</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-(--color-fg-secondary) hover:bg-zinc-800 hover:text-(--color-fg-primary)"
          >
            <Trash2 size={12} aria-hidden="true" />
            <span>Clear</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log list

interface OutputListProps {
  lines: readonly LogLineRow[];
}

const OutputList = React.forwardRef<HTMLDivElement, OutputListProps>(
  function OutputList({ lines }, ref) {
    if (lines.length === 0) {
      return (
        <div
          ref={ref}
          className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] text-(--color-fg-muted) italic flex items-center justify-center py-4"
        >
          No log entries.
        </div>
      );
    }
    return (
      <div
        ref={ref}
        className="flex-1 min-h-0 overflow-y-auto font-mono text-[11px] leading-snug"
      >
        {lines.map((line, idx) => (
          <LogRow key={`${line.ts}-${idx}`} line={line} />
        ))}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Log row

interface LogRowProps {
  line: LogLineRow;
}

function LogRow({ line }: LogRowProps): React.JSX.Element {
  const meta = SEVERITY_META[line.severity];
  const Icon = meta.icon;
  return (
    <div
      className={[
        "flex items-start gap-2 px-1 py-[1px] rounded",
        "hover:bg-(--color-bg-hover)",
      ].join(" ")}
    >
      {/* Severity glyph + dot. Dot is the always-visible affordance;
          the inline icon is a tiny extra hint that survives at narrow
          widths where colour alone is fragile. */}
      <span
        className={["shrink-0 mt-0.5 inline-flex items-center gap-1", meta.text].join(" ")}
        aria-label={meta.label}
      >
        <span
          aria-hidden="true"
          className={["inline-block w-1.5 h-1.5 rounded-full", meta.dot].join(" ")}
        />
        <Icon size={10} aria-hidden="true" />
      </span>
      {/* Monospace timestamp — fixed-width so the message column lines
          up across rows. */}
      <span className="shrink-0 text-(--color-fg-muted) tabular-nums">
        {formatTimestamp(line.ts)}
      </span>
      {/* Message wraps to a second line when narrow rather than
          truncating — log content is the point of this panel. */}
      <span className="flex-1 min-w-0 text-(--color-fg-primary) break-words whitespace-pre-wrap">
        {line.message}
      </span>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "output",
  title: "Output",
  icon: <Terminal size={12} />,
};

export default OutputPanel;
