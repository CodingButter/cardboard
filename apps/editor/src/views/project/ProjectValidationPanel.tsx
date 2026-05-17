import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
} from "../../components/ui";
import {
  Badge,
  StatusPill,
  KeyValueList,
  PanelHeader,
  EmptyState,
} from "../../components/ui/index";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, Clock } from "lucide-react";

/**
 * ProjectValidationPanel — R4f Project tab → Validation sub-view.
 *
 * Runs the project validator + shows recent validation passes. The
 * actual validator pipeline (counts of errors / warnings / info, per-
 * issue file pointer) lives in `apps/pack-builder`'s validator and is
 * re-imported into the editor.
 *
 * WIRING: this panel renders the UI but the validator integration is
 * **stubbed** until the validatePack() helper is exposed to the editor.
 * The `runs` prop receives whatever runs are already in memory; the
 * Run-now button is wired to `onRun` which is a no-op until the
 * pipeline lands.
 */

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  id: string;
  severity: ValidationSeverity;
  message: string;
  /** Optional file/asset path the issue refers to. */
  path?: string;
}

export interface ValidationRun {
  id: string;
  /** Unix ms when the run started. */
  startedAt: number;
  /** Duration ms or null if still running. */
  durationMs: number | null;
  /** Per-severity counts. */
  counts: { error: number; warning: number; info: number };
  issues: ReadonlyArray<ValidationIssue>;
}

export interface ProjectValidationPanelProps {
  /** Most recent run (top of history). Optional. */
  latest?: ValidationRun | null;
  /** Older runs to display in the history table. */
  history?: ReadonlyArray<ValidationRun>;
  /** Trigger a fresh validation pass. WIRING: no-op until pipeline lands. */
  onRun?: () => void;
  /** True while a validation pass is in flight. */
  running?: boolean;
  /** Click an issue to navigate to its source. WIRING: no-op stub. */
  onSelectIssue?: (issue: ValidationIssue) => void;
}

const SEVERITY_ICON: Record<ValidationSeverity, React.ReactNode> = {
  error: <AlertCircle size={14} className="text-red-400" />,
  warning: <AlertTriangle size={14} className="text-amber-400" />,
  info: <Info size={14} className="text-sky-400" />,
};

export function ProjectValidationPanel({
  latest,
  history = [],
  onRun,
  running = false,
  onSelectIssue,
}: ProjectValidationPanelProps) {
  const totals = latest?.counts ?? { error: 0, warning: 0, info: 0 };
  const pillVariant: "ok" | "warn" | "error" =
    totals.error > 0 ? "error" : totals.warning > 0 ? "warn" : "ok";
  const pillLabel =
    totals.error > 0
      ? `${totals.error} error${totals.error === 1 ? "" : "s"}`
      : totals.warning > 0
        ? `${totals.warning} warning${totals.warning === 1 ? "" : "s"}`
        : "All checks passed";

  return (
    <div className="space-y-4 max-w-5xl">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Validation</CardTitle>
              <CardDescription>
                Re-run the validator after any structural change (added
                deps, renamed assets, schema bumps). Errors block export;
                warnings only block when "Fail on warning" is enabled in
                Advanced.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill variant={pillVariant}>{pillLabel}</StatusPill>
              <Button
                variant="primary"
                size="sm"
                onClick={onRun}
                disabled={running || !onRun}
                title={
                  onRun
                    ? "Run the validator over manifest + assets + chain"
                    : "Validator pipeline not wired yet"
                }
              >
                {running ? "Running…" : "Run validation"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            <CountTile
              label="Total"
              value={totals.error + totals.warning + totals.info}
              variant="zinc"
            />
            <CountTile label="Errors" value={totals.error} variant="red" />
            <CountTile label="Warnings" value={totals.warning} variant="amber" />
            <CountTile label="Info" value={totals.info} variant="sky" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <PanelHeader
          title="Issues"
          action={
            latest?.issues && latest.issues.length > 0 ? (
              <Badge variant="zinc">
                {latest.issues.length} issue{latest.issues.length === 1 ? "" : "s"}
              </Badge>
            ) : null
          }
        />
        <CardContent>
          {!latest ? (
            <EmptyState
              icon={<CheckCircle2 size={28} />}
              title="No validation runs yet"
              description="Click Run validation above to scan the project. Results appear here."
              tutorial="project-validation"
            />
          ) : latest.issues.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={28} />}
              title="All checks passed"
              description={`Validated in ${(latest.durationMs ?? 0).toFixed(0)}ms — no issues found.`}
              tutorial="project-validation"
            />
          ) : (
            <ul className="divide-y divide-zinc-800 -mx-1">
              {latest.issues.map((issue) => (
                <li
                  key={issue.id}
                  className="flex items-start gap-3 px-3 py-2 hover:bg-zinc-800/30 cursor-pointer transition-colors"
                  onClick={() => onSelectIssue?.(issue)}
                  title={issue.path ? `Open ${issue.path}` : undefined}
                >
                  <span className="mt-0.5">{SEVERITY_ICON[issue.severity]}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-zinc-100">{issue.message}</div>
                    {issue.path ? (
                      <div className="text-[11px] font-mono text-zinc-500 truncate">
                        {issue.path}
                      </div>
                    ) : null}
                  </div>
                  <Badge
                    variant={
                      issue.severity === "error"
                        ? "red"
                        : issue.severity === "warning"
                          ? "amber"
                          : "sky"
                    }
                    outlined
                  >
                    {issue.severity}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <PanelHeader title="Recent runs" />
        <CardContent>
          {history.length === 0 ? (
            <div className="text-xs text-zinc-500 italic py-2">
              History is empty.
            </div>
          ) : (
            <KeyValueList
              rows={history.slice(0, 10).map((run) => ({
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Clock size={11} className="text-zinc-500" />
                    {new Date(run.startedAt).toLocaleTimeString()}
                  </span>
                ),
                value: (
                  <span className="inline-flex items-center gap-2 justify-end">
                    <Badge variant="red">{run.counts.error}</Badge>
                    <Badge variant="amber">{run.counts.warning}</Badge>
                    <Badge variant="sky">{run.counts.info}</Badge>
                    <span className="text-[11px] text-zinc-500">
                      {run.durationMs !== null
                        ? `${run.durationMs.toFixed(0)}ms`
                        : "—"}
                    </span>
                  </span>
                ),
              }))}
              density="dense"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CountTile({
  label,
  value,
  variant,
}: {
  label: string;
  value: number;
  variant: "zinc" | "red" | "amber" | "sky";
}) {
  const colorClass =
    variant === "red"
      ? "text-red-300"
      : variant === "amber"
        ? "text-amber-300"
        : variant === "sky"
          ? "text-sky-300"
          : "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <div className={`text-2xl font-mono tabular-nums mt-1 ${colorClass}`}>
        {value}
      </div>
    </div>
  );
}
