import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Trash2,
  ArrowRightCircle,
} from "lucide-react";
// Type-only — see note in OutputPanel.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
import { Tooltip } from "../../../apps/editor/src/components/ui/Tooltip";
import type {
  DiagnosticLine,
  DiagnosticSeverity,
} from "../../../apps/editor/src/state/useDiagnosticsStore";
// Externalised via the pack-builder's shell-externals plugin — see
// OutputPanel for the rationale. Diagnostics is a singleton-backed
// store; routing through the host's instance is the only way the
// panel's `clear()` call propagates to OutputPanel + popout windows.
import {
  EmptyState,
  registerCommand,
  useDiagnosticsStore,
} from "@cardboard/editor-shell";

/**
 * ProblemsPanel — diagnostics surface for the active scene.
 *
 * Visual target: the bottom-strip Problems tab from `Editor Design/Map.png`.
 * Lists current scene warnings and errors (a subset of the Output log)
 * with a severity icon, the message, and — when the diagnostic carries
 * a cell ref — a "Go to cell" affordance that calls a stub jump helper.
 *
 * Wave 3.3 data wiring: reads the live `lines` slice from
 * `useDiagnosticsStore` and filters to severity >= warn. Clear hits
 * `useDiagnosticsStore.clear()` so the Output panel + popout windows
 * observe the same empty buffer. Cell coords come from the structured
 * `DiagnosticLine.cell` field when present, with a `(x, y)` regex
 * fallback for older messages that embedded the coord in plain text.
 *
 * Surface contract:
 *   This panel is registered with `surface: false` by the core-editor
 *   pack, so DockShell does NOT wrap it in a PanelSurface card. We
 *   render flush against the dock background and own our own padding.
 *
 * Persistence:
 *   - `cardboard.scene.problems.filter` — "all" | "warn" | "error"
 *
 * Command registry contract — every interactive control here ALSO
 * registers a command via `registerCommand`. Dynamic per-row jump
 * commands live in an effect keyed on the resolved problem list.
 */

// ---------------------------------------------------------------------------
// Persistence

const LS_FILTER = "cardboard.scene.problems.filter";
type ProblemFilter = "all" | "warn" | "error";
const DEFAULT_FILTER: ProblemFilter = "all";

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

function isProblemFilter(value: string | null): value is ProblemFilter {
  return value === "all" || value === "warn" || value === "error";
}

// ---------------------------------------------------------------------------
// Cell-coordinate extraction
//
// Many problem messages reference a cell using `(x, y)` syntax — e.g.
// "Cell (12,7) has no ceiling assigned". We pull the first such pair out
// so we can render a jump affordance on rows that mention coordinates.

interface ParsedProblem {
  /** Stable id for this row — propagated from the diagnostic line. */
  id: string;
  severity: Exclude<DiagnosticSeverity, "info">;
  message: string;
  /** Structured cell ref from the diagnostic, or a parsed `(x, y)` fallback. */
  cell: { x: number; y: number } | null;
}

const CELL_REGEX = /\((\d+),\s*(\d+)\)/;

function parseCellFromMessage(
  message: string,
): { x: number; y: number } | null {
  const m = CELL_REGEX.exec(message);
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function buildProblemList(lines: readonly DiagnosticLine[]): ParsedProblem[] {
  const out: ParsedProblem[] = [];
  for (const line of lines) {
    if (line.severity === "info") continue;
    out.push({
      id: line.id,
      severity: line.severity,
      message: line.message,
      // Prefer the structured field; fall back to message-text parsing
      // for legacy log lines that pre-date `DiagnosticLine.cell`.
      cell: line.cell ?? parseCellFromMessage(line.message),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Filter metadata

interface FilterMeta {
  id: ProblemFilter;
  name: string;
  description: string;
  /** Tailwind colour class for the chip's leading severity dot. */
  dot: string;
}

const FILTER_META: readonly FilterMeta[] = [
  {
    id: "all",
    name: "All",
    description: "Show every warning and error in the active scene.",
    dot: "bg-zinc-500",
  },
  {
    id: "warn",
    name: "Warnings",
    description: "Show only warning-level diagnostics.",
    dot: "bg-amber-500",
  },
  {
    id: "error",
    name: "Errors",
    description: "Show only error-level diagnostics.",
    dot: "bg-red-500",
  },
] as const;

/**
 * Active-state background + border + text per filter id. Each active
 * style matches the severity hue so the WARN-active and ERROR-active
 * chips can't be confused at a glance. ALL stays on the panel's
 * neutral amber accent.
 */
function activeChipClassesFor(id: ProblemFilter): string {
  switch (id) {
    case "warn":
      return "bg-amber-500 border-amber-500 text-zinc-950";
    case "error":
      return "bg-red-500 border-red-500 text-zinc-950";
    case "all":
    default:
      return "bg-amber-500 border-amber-500 text-zinc-950";
  }
}

// Width below which we collapse the trailing cell-link button into the
// row's tooltip — the row still shows the message, the jump affordance
// moves into the (always-mounted) tooltip body. Picked empirically: at
// ~150px the cell button starts pushing the truncated message into a
// useless few-character stub.
const NARROW_WIDTH_PX = 180;

// ---------------------------------------------------------------------------
// Jump stub
//
// Real wire-up lands when the selection store gains a `selectCell({x,y})`
// action. For now we just console.log the jump so the command palette
// path is observable.
function jumpToCell(cell: { x: number; y: number }): void {
  // eslint-disable-next-line no-console
  console.log(
    `[ProblemsPanel] jumpToCell(${cell.x}, ${cell.y}) — stub`,
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}

// ---------------------------------------------------------------------------
// Panel

export function ProblemsPanel(): React.JSX.Element {
  // Live diagnostics subscription — capped + broadcast across popout
  // windows by the store. We materialise the warn/error subset locally
  // (the store doesn't expose a pre-filtered slice) so the panel
  // re-renders only when the underlying `lines` ref changes.
  const lines = useDiagnosticsStore((s) => s.lines);

  const [filter, setFilter] = React.useState<ProblemFilter>(() => {
    const stored = readLS(LS_FILTER);
    if (isProblemFilter(stored)) return stored;
    return DEFAULT_FILTER;
  });

  React.useEffect(() => {
    writeLS(LS_FILTER, filter);
  }, [filter]);

  const allProblems = React.useMemo<ParsedProblem[]>(
    () => buildProblemList(lines),
    [lines],
  );

  const visibleProblems = React.useMemo<ParsedProblem[]>(() => {
    if (filter === "all") return allProblems;
    return allProblems.filter((p) => p.severity === filter);
  }, [allProblems, filter]);

  // Container width tracking for the responsive narrow-mode threshold.
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number>(NARROW_WIDTH_PX + 1);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < NARROW_WIDTH_PX;

  // Click handlers behind refs so the command-registration effects
  // don't need to re-run on every state change.
  const handleFilterClick = React.useCallback((next: ProblemFilter) => {
    setFilter(next);
  }, []);
  const filterHandlerRef = React.useRef(handleFilterClick);
  React.useEffect(() => {
    filterHandlerRef.current = handleFilterClick;
  }, [handleFilterClick]);

  // Clear routes through the store so Output + popout windows observe
  // the same empty buffer. Going via `getState()` keeps the callback
  // stable across renders — no selector subscription needed for a
  // fire-and-forget mutation.
  const handleClear = React.useCallback(() => {
    useDiagnosticsStore.getState().clear();
  }, []);
  const clearHandlerRef = React.useRef(handleClear);
  React.useEffect(() => {
    clearHandlerRef.current = handleClear;
  }, [handleClear]);

  // Jump-to-first uses the latest visible list — needs a snapshot ref.
  const visibleProblemsRef = React.useRef(visibleProblems);
  React.useEffect(() => {
    visibleProblemsRef.current = visibleProblems;
  }, [visibleProblems]);

  const handleJumpToFirst = React.useCallback(() => {
    const list = visibleProblemsRef.current;
    const firstWithCell = list.find((p) => p.cell !== null);
    if (firstWithCell?.cell) {
      jumpToCell(firstWithCell.cell);
    } else {
      // eslint-disable-next-line no-console
      console.log(
        "[ProblemsPanel] jumpToFirst — no problems with cell coordinates",
      );
    }
  }, []);
  const jumpFirstHandlerRef = React.useRef(handleJumpToFirst);
  React.useEffect(() => {
    jumpFirstHandlerRef.current = handleJumpToFirst;
  }, [handleJumpToFirst]);

  // -------------------------------------------------------------------------
  // Static command registrations: filters + clear + jumpToFirst.

  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const f of FILTER_META) {
      unregs.push(
        registerCommand({
          id: `scene.problems.filter.${f.id}`,
          title: `Filter Problems: ${f.name}`,
          category: "Problems",
          keywords: ["problems", "filter", f.id, f.name.toLowerCase()],
          description: f.description,
          run: () => filterHandlerRef.current(f.id),
        }),
      );
    }
    unregs.push(
      registerCommand({
        id: "scene.problems.clear",
        title: "Clear Problems",
        category: "Problems",
        keywords: ["problems", "clear", "reset", "empty"],
        description: "Empty the current in-memory problem list.",
        run: () => clearHandlerRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "scene.problems.jumpToFirst",
        title: "Jump to First Problem",
        category: "Problems",
        keywords: ["problems", "jump", "first", "next"],
        description:
          "Focus the canvas on the first problem that references a cell.",
        run: () => jumpFirstHandlerRef.current(),
      }),
    );
    return () => unregs.forEach((u) => u());
  }, []);

  // -------------------------------------------------------------------------
  // Dynamic per-row jump commands — one per problem row that parsed a
  // cell out of its message. Re-registers whenever the resolved list
  // changes (which it will when the real diagnostic store lands).

  // A stable signature so the effect only re-runs when the *set* of
  // jumpable problems actually changes.
  const jumpableSig = allProblems
    .map((p) => (p.cell ? `${p.id}:${p.cell.x},${p.cell.y}` : ""))
    .filter(Boolean)
    .join("|");

  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    allProblems.forEach((problem, idx) => {
      if (!problem.cell) return;
      const cell = problem.cell;
      unregs.push(
        registerCommand({
          id: `scene.problems.jump.${idx}`,
          title: `Jump to Problem: ${truncate(problem.message, 48)}`,
          category: "Problems",
          keywords: [
            "problems",
            "jump",
            problem.severity,
            `${cell.x},${cell.y}`,
          ],
          description: problem.message,
          run: () => jumpToCell(cell),
        }),
      );
    });
    return () => unregs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpableSig]);

  // -------------------------------------------------------------------------
  // Render

  // Jump-to-first is enabled only when the *currently visible* filtered
  // list actually has a jumpable row — otherwise the button would
  // appear interactive but no-op (e.g. ERRORS filter on with only warn
  // rows containing coordinates).
  const canJumpFirst = visibleProblems.some((p) => p.cell !== null);
  const canClear = allProblems.length > 0;

  return (
    <div
      ref={rootRef}
      data-panel="problems"
      className="h-full w-full flex flex-col gap-1.5 px-2 py-1.5 min-h-0 text-(--color-fg-primary)"
    >
      <FilterChipRow
        activeFilter={filter}
        onFilterClick={handleFilterClick}
        onClear={handleClear}
        onJumpToFirst={handleJumpToFirst}
        counts={countBySeverity(allProblems)}
        canClear={canClear}
        canJumpFirst={canJumpFirst}
      />

      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        {visibleProblems.length === 0 ? (
          <ProblemsEmptyState filter={filter} />
        ) : (
          <ul className="flex flex-col">
            {visibleProblems.map((problem, idx) => (
              <ProblemRow
                key={problem.id}
                problem={problem}
                index={idx}
                narrow={narrow}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function countBySeverity(problems: readonly ParsedProblem[]): {
  warn: number;
  error: number;
} {
  let warn = 0;
  let error = 0;
  for (const p of problems) {
    if (p.severity === "warn") warn += 1;
    else if (p.severity === "error") error += 1;
  }
  return { warn, error };
}

// ---------------------------------------------------------------------------
// Filter chip row (+ action buttons)

interface FilterChipRowProps {
  activeFilter: ProblemFilter;
  onFilterClick: (f: ProblemFilter) => void;
  onClear: () => void;
  onJumpToFirst: () => void;
  counts: { warn: number; error: number };
  canClear: boolean;
  canJumpFirst: boolean;
}

function FilterChipRow({
  activeFilter,
  onFilterClick,
  onClear,
  onJumpToFirst,
  counts,
  canClear,
  canJumpFirst,
}: FilterChipRowProps): React.JSX.Element {
  return (
    <div className="shrink-0 flex items-start gap-1 min-w-0">
      <div className="flex-1 min-w-0">
        {/* Chips wrap to a second row at narrow widths — no horizontal
            scroll, matching the OutputPanel toolbar pattern. */}
        <div className="flex flex-wrap items-center gap-1">
          {FILTER_META.map((f) => {
            const active = f.id === activeFilter;
            const count =
              f.id === "all"
                ? counts.warn + counts.error
                : f.id === "warn"
                  ? counts.warn
                  : counts.error;
            return (
              <Tooltip
                key={f.id}
                side="bottom"
                stages={[
                  { delay: 1000, content: <span>{f.name}</span> },
                  {
                    delay: 3000,
                    content: (
                      <div>
                        <div className="font-semibold">{f.name}</div>
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
                  aria-label={`Filter problems: ${f.name}`}
                  aria-pressed={active}
                  onClick={() => onFilterClick(f.id)}
                  className={[
                    "shrink-0 inline-flex items-center gap-1",
                    "rounded-full px-2 py-1 text-[10px] uppercase tracking-wide",
                    "border transition-colors",
                    active
                      ? activeChipClassesFor(f.id)
                      : "bg-transparent border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
                  ].join(" ")}
                >
                  <span
                    aria-hidden="true"
                    className={[
                      "inline-block w-1.5 h-1.5 rounded-full",
                      f.dot,
                    ].join(" ")}
                  />
                  <span>{f.name}</span>
                  <span
                    className={[
                      "ml-0.5 inline-flex items-center justify-center",
                      "min-w-[14px] h-[14px] px-1 rounded-full",
                      "text-[9px] tabular-nums leading-none",
                      active
                        ? "bg-zinc-950/20 text-zinc-950"
                        : "bg-(--color-bg-card) text-(--color-fg-muted)",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      {/* Trailing action buttons — jump-to-first + clear. Both are
          disabled when there's nothing to act on, but remain mounted so
          the command-palette path still works (its handler no-ops). */}
      <div className="shrink-0 flex items-center gap-1 pl-1">
        <Tooltip
          side="bottom"
          stages={[
            { delay: 1000, content: <span>Jump to first problem</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Jump to first problem</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Focus the canvas on the first problem that references a
                    cell. Skips rows without coordinates.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label="Jump to first problem"
            onClick={onJumpToFirst}
            disabled={!canJumpFirst}
            className={[
              "shrink-0 inline-flex items-center justify-center",
              "w-6 h-6 rounded border",
              "border-(--color-border-strong) bg-transparent",
              canJumpFirst
                ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary) hover:border-amber-500/60"
                : "text-(--color-fg-muted) opacity-50 cursor-not-allowed",
              "transition-colors",
            ].join(" ")}
          >
            <ArrowRightCircle size={12} aria-hidden="true" />
          </button>
        </Tooltip>

        <Tooltip
          side="bottom"
          stages={[
            { delay: 1000, content: <span>Clear problems</span> },
            {
              delay: 3000,
              content: (
                <div className="max-w-[400px]">
                  <div className="font-semibold">Clear problems</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1">
                    Empty the in-memory problem list. New diagnostics from
                    the engine will still appear as they arrive.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label="Clear problems"
            onClick={onClear}
            disabled={!canClear}
            className={[
              "shrink-0 inline-flex items-center justify-center",
              "w-6 h-6 rounded border",
              "border-(--color-border-strong) bg-transparent",
              canClear
                ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary) hover:border-amber-500/60"
                : "text-(--color-fg-muted) opacity-50 cursor-not-allowed",
              "transition-colors",
            ].join(" ")}
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — uses the shared EmptyState primitive for parity with
// OutputPanel's "No log entries" empty surface.

function ProblemsEmptyState({
  filter,
}: {
  filter: ProblemFilter;
}): React.JSX.Element {
  if (filter === "warn") {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<CheckCircle2 size={28} />}
          title="No warnings"
          description="Switch the filter to ALL or ERRORS to see other diagnostic levels."
        />
      </div>
    );
  }
  if (filter === "error") {
    return (
      <div className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<CheckCircle2 size={28} />}
          title="No errors"
          description="Switch the filter to ALL or WARNINGS to see other diagnostic levels."
        />
      </div>
    );
  }
  return (
    <div className="h-full w-full flex items-center justify-center">
      <EmptyState
        icon={<CheckCircle2 size={28} />}
        title="All clear"
        description="No warnings or errors detected in the scene."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Problem row

interface ProblemRowProps {
  problem: ParsedProblem;
  index: number;
  narrow: boolean;
}

function ProblemRow({
  problem,
  index,
  narrow,
}: ProblemRowProps): React.JSX.Element {
  const SeverityIcon =
    problem.severity === "error" ? XCircle : AlertTriangle;
  const severityColor =
    problem.severity === "error"
      ? "text-rose-400"
      : "text-amber-400";
  const severityLabel =
    problem.severity === "error" ? "Error" : "Warning";

  const cell = problem.cell;
  const cellLabel = cell ? `(${cell.x}, ${cell.y})` : null;

  // Wrap each row in a tooltip carrying the full message + cell ref.
  // Narrow mode also surfaces the jump affordance here since the
  // inline button is hidden.
  //
  // The Tooltip primitive wraps its child in a `relative inline-flex`
  // span — by default that span only grows to its content width, which
  // would let the cell-link button float mid-row. We use a Tailwind
  // arbitrary-child selector to force the tooltip wrapper to `flex` +
  // `w-full` so the row stretches to the list width.
  return (
    <li className="block [&>span]:flex [&>span]:w-full">
      <Tooltip
        side="top"
        stages={[
          {
            delay: 1000,
            content: (
              <span>
                {severityLabel}
                {cellLabel ? ` — ${cellLabel}` : ""}
              </span>
            ),
          },
          {
            delay: 3000,
            content: (
              <div className="max-w-[280px]">
                <div className="font-semibold">
                  {severityLabel}
                  {cellLabel ? ` — ${cellLabel}` : ""}
                </div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 whitespace-normal break-words">
                  {problem.message}
                </div>
                {cell && narrow ? (
                  <div className="text-[10px] mt-1 text-amber-400/80">
                    Click row to jump to cell.
                  </div>
                ) : null}
              </div>
            ),
          },
        ]}
      >
        <div
          role={cell ? "button" : undefined}
          tabIndex={cell ? 0 : undefined}
          onClick={cell ? () => jumpToCell(cell) : undefined}
          onKeyDown={
            cell
              ? (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    jumpToCell(cell);
                  }
                }
              : undefined
          }
          aria-label={
            cell
              ? `Jump to problem at cell ${cell.x}, ${cell.y}: ${problem.message}`
              : `${severityLabel}: ${problem.message}`
          }
          className={[
            "w-full flex items-center gap-1.5 min-w-0",
            "px-1 py-0.5 rounded-sm",
            "border border-transparent",
            cell
              ? "cursor-pointer hover:bg-(--color-bg-card) hover:border-(--color-border-strong) focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400"
              : "",
            // Subtle zebra strip from row index — keeps long lists readable.
            index % 2 === 1 ? "bg-zinc-50/[0.015]" : "",
          ].join(" ")}
        >
          <SeverityIcon
            size={11}
            aria-hidden="true"
            className={["shrink-0", severityColor].join(" ")}
          />
          <span className="flex-1 min-w-0 text-[11px] leading-tight truncate">
            {problem.message}
          </span>
          {cell && !narrow ? (
            <Tooltip
              side="left"
              stages={[
                {
                  delay: 1000,
                  content: <span>{`Go to ${cellLabel}`}</span>,
                },
                {
                  delay: 3000,
                  content: (
                    <div className="max-w-[400px]">
                      <div className="font-semibold">{`Go to ${cellLabel}`}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Focus the canvas on this cell.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label={`Go to cell ${cell.x}, ${cell.y}`}
                onClick={(e) => {
                  // Don't double-fire the row click handler.
                  e.stopPropagation();
                  jumpToCell(cell);
                }}
                className={[
                  // ml-auto pins the cell-link button to the row's
                  // right edge regardless of message length.
                  "ml-auto shrink-0 inline-flex items-center gap-0.5",
                  "px-1 py-px rounded border",
                  "text-[9px] font-mono tabular-nums leading-none",
                  "border-(--color-border-strong) bg-transparent",
                  "text-(--color-fg-secondary)",
                  "hover:text-(--color-fg-primary) hover:border-amber-500/60",
                  "transition-colors",
                ].join(" ")}
              >
                <ArrowRightCircle size={9} aria-hidden="true" />
                <span>{cellLabel}</span>
              </button>
            </Tooltip>
          ) : null}
        </div>
      </Tooltip>
    </li>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "problems",
  title: "Problems",
  category: "Diagnostics",
  icon: <AlertCircle size={12} />,
};

export default ProblemsPanel;
