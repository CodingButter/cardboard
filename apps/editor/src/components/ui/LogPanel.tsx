import React from "react";
import { cn } from "../../lib/cn";

/**
 * LogPanel — §4.14.
 *
 * Scrollable log output: each line is `[timestamp] type message`. Used
 * by StatusConsole, ProjectView main log, Playtest footer console.
 *
 * Filtering is controlled — the parent owns the `filter` set; the
 * panel renders filter chips above the log and emits
 * `onFilterChange`. If no `onFilterChange` is provided, the filter
 * chips are display-only.
 */

export type LogLineType = "info" | "warn" | "error" | "success" | "debug";

export interface LogLine {
  id: string;
  type: LogLineType;
  time?: string;
  message: React.ReactNode;
}

export interface LogPanelProps {
  lines: ReadonlyArray<LogLine>;
  /** Auto-scroll the log to the bottom on new lines. */
  follow?: boolean;
  /** Types currently visible. Pass `undefined` to render all types
   *  without filter chips. */
  filter?: ReadonlyArray<LogLineType>;
  onFilterChange?: (next: ReadonlyArray<LogLineType>) => void;
  onClear?: () => void;
  className?: string;
}

const TYPE_META: Record<LogLineType, { dot: string; text: string; label: string }> = {
  info: { dot: "bg-sky-400", text: "text-sky-300", label: "INFO" },
  warn: { dot: "bg-yellow-400", text: "text-yellow-200", label: "WARN" },
  error: { dot: "bg-red-500", text: "text-red-300", label: "ERROR" },
  success: { dot: "bg-emerald-500", text: "text-emerald-300", label: "OK" },
  debug: { dot: "bg-zinc-500", text: "text-zinc-400", label: "DEBUG" },
};

const ALL_TYPES: ReadonlyArray<LogLineType> = [
  "info",
  "warn",
  "error",
  "success",
  "debug",
];

export function LogPanel({
  lines,
  follow = true,
  filter,
  onFilterChange,
  onClear,
  className,
}: LogPanelProps) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!follow || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, follow]);

  const activeFilter = filter ?? ALL_TYPES;
  const visibleLines = filter
    ? lines.filter((l) => activeFilter.includes(l.type))
    : lines;

  const toggle = (t: LogLineType) => {
    if (!onFilterChange || !filter) return;
    onFilterChange(
      filter.includes(t) ? filter.filter((x) => x !== t) : [...filter, t],
    );
  };

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-zinc-800 bg-zinc-950/60 overflow-hidden",
        className,
      )}
    >
      {(filter || onClear) && (
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 h-9">
          <div className="flex items-center gap-1">
            {filter &&
              ALL_TYPES.map((t) => {
                const on = activeFilter.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggle(t)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-2 h-6 rounded-full text-[11px] font-medium",
                      "transition-colors",
                      on
                        ? "bg-zinc-800 text-zinc-100"
                        : "bg-transparent text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block w-1.5 h-1.5 rounded-full",
                        TYPE_META[t].dot,
                      )}
                    />
                    {TYPE_META[t].label}
                  </button>
                );
              })}
          </div>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed"
      >
        {visibleLines.length === 0 ? (
          <div className="text-zinc-600 italic py-6 text-center">
            No log entries
          </div>
        ) : (
          visibleLines.map((line) => (
            <div key={line.id} className="flex items-start gap-2 py-0.5">
              {line.time && (
                <span className="shrink-0 text-zinc-600">[{line.time}]</span>
              )}
              <span
                className={cn(
                  "shrink-0 inline-flex items-center gap-1",
                  TYPE_META[line.type].text,
                )}
              >
                <span
                  className={cn(
                    "inline-block w-1.5 h-1.5 rounded-full",
                    TYPE_META[line.type].dot,
                  )}
                />
              </span>
              <span className="text-zinc-200 break-words">{line.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
