import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "../../components/ui";
import {
  LogPanel,
  type LogLine,
  type LogLineType,
  SegmentedControl,
} from "../../components/ui/index";

/**
 * ProjectLogPanel — R4f Project tab → Log sub-view.
 *
 * Aggregates build / export / validation log entries into a single
 * scrollable stream. Source filter chips let the user narrow to one
 * subsystem at a time.
 *
 * WIRING: the editor doesn't currently expose a global build-log
 * subscriber (`EditorBuildLog.subscribe(...)` referenced in §7.7 is
 * not yet shipped). Until that lands the panel renders whatever lines
 * the parent passes — `ProjectTabView` aggregates per-session entries
 * from the validation + export flows into local state.
 */

export type LogSource = "build" | "export" | "validation" | "system";

export interface ProjectLogEntry {
  id: string;
  source: LogSource;
  type: LogLineType;
  time: string;
  message: React.ReactNode;
}

export interface ProjectLogPanelProps {
  lines: ReadonlyArray<ProjectLogEntry>;
  onClear?: () => void;
}

const SOURCE_OPTIONS = [
  { id: "all" as const, label: "All" },
  { id: "build" as const, label: "Build" },
  { id: "export" as const, label: "Export" },
  { id: "validation" as const, label: "Validation" },
  { id: "system" as const, label: "System" },
];

type SourceFilter = (typeof SOURCE_OPTIONS)[number]["id"];

export function ProjectLogPanel({ lines, onClear }: ProjectLogPanelProps) {
  const [source, setSource] = React.useState<SourceFilter>("all");
  const [typeFilter, setTypeFilter] = React.useState<ReadonlyArray<LogLineType>>([
    "info",
    "warn",
    "error",
    "success",
    "debug",
  ]);

  const visibleLines: LogLine[] = React.useMemo(() => {
    const filtered =
      source === "all" ? lines : lines.filter((l) => l.source === source);
    return filtered.map((entry) => ({
      id: entry.id,
      type: entry.type,
      time: entry.time,
      message: (
        <span>
          <span className="text-zinc-500 mr-1.5 uppercase text-[10px] tracking-wider">
            [{entry.source}]
          </span>
          {entry.message}
        </span>
      ),
    }));
  }, [lines, source]);

  return (
    <div className="space-y-3 max-w-5xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Log</CardTitle>
              <CardDescription>
                Combined output from build / export / validation pipelines.
                Persists in-memory for this session only.
              </CardDescription>
            </div>
            <SegmentedControl
              size="sm"
              options={SOURCE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
              value={source}
              onChange={(v) => v && setSource(v as SourceFilter)}
              aria-label="Filter log source"
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[420px]">
            <LogPanel
              lines={visibleLines}
              filter={typeFilter}
              onFilterChange={setTypeFilter}
              onClear={onClear}
              className="h-full"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
