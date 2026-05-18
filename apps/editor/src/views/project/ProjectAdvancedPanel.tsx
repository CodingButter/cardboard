import React from "react";
import { Card, CardContent, Button } from "../../components/ui";
import {
  PropertyRow,
  ToggleSwitch,
  Slider,
  CollapsibleSection,
  Badge,
  PanelHeader,
  StatusPill,
  EmptyState,
  KeyValueList,
} from "../../components/ui/index";
import { AlertCircle, AlertTriangle, Info, CheckCircle2, Clock } from "lucide-react";
import type {
  ValidationRun,
  ValidationIssue,
  ValidationSeverity,
} from "./ProjectValidationPanel";

/**
 * ProjectAdvancedPanel — R4f Project tab → Advanced sub-view.
 *
 * Project-scoped power-user toggles: feature flags, validation
 * thresholds, debug overrides. Editor-scoped preferences (theme,
 * keybindings) live in the cog-opened EditorSettingsModal per §12 Q2.
 *
 * WIRING: every flag here is staged into the local `AdvancedConfig`
 * draft and persisted via `onChange`. The actual engine code that
 * reads these values lands incrementally as features ship — for now
 * the flags round-trip through the manifest so packs that opt in
 * keep their settings.
 */

export interface AdvancedConfig {
  /** Strict validation — fail the build on any warning, not just error. */
  failOnWarning: boolean;
  /** Maximum scene size before the validator complains. */
  warnSceneSizeKb: number;
  /** Maximum manifest.requires[] depth before a chain is flagged. */
  warnChainDepth: number;
  /** Telemetry opt-in for engine error reporting (per-pack). */
  telemetry: boolean;
  /** Verbose engine logging at runtime (slow). */
  debugVerbose: boolean;
  /** Skip integrity checks on dependencies — DEV ONLY. */
  unsafeSkipIntegrity: boolean;
  /** Experimental: per-wall light samples (LIGHTING_OVERHAUL phase 3). */
  experimentalPerWallSamples: boolean;
}

export const DEFAULT_ADVANCED_CONFIG: AdvancedConfig = {
  failOnWarning: false,
  warnSceneSizeKb: 512,
  warnChainDepth: 6,
  telemetry: false,
  debugVerbose: false,
  unsafeSkipIntegrity: false,
  experimentalPerWallSamples: false,
};

const SEVERITY_ICON: Record<ValidationSeverity, React.ReactNode> = {
  error: <AlertCircle size={14} className="text-red-400" />,
  warning: <AlertTriangle size={14} className="text-amber-400" />,
  info: <Info size={14} className="text-sky-400" />,
};

export interface ProjectAdvancedPanelProps {
  config: AdvancedConfig;
  onChange: (next: AdvancedConfig) => void;
  /** Most recent validation pass (folded in from old Validation tab). */
  validationLatest?: ValidationRun | null;
  /** Older runs to display in the history list. */
  validationHistory?: ReadonlyArray<ValidationRun>;
  /** Trigger a validation pass. */
  onRunValidation?: () => void;
  /** True while validation is in flight. */
  validationRunning?: boolean;
  /** Click a single issue → navigate. */
  onSelectIssue?: (issue: ValidationIssue) => void;
}

export function ProjectAdvancedPanel({
  config,
  onChange,
  validationLatest,
  validationHistory = [],
  onRunValidation,
  validationRunning = false,
  onSelectIssue,
}: ProjectAdvancedPanelProps) {
  const update = <K extends keyof AdvancedConfig>(key: K, value: AdvancedConfig[K]) =>
    onChange({ ...config, [key]: value });

  const totals = validationLatest?.counts ?? { error: 0, warning: 0, info: 0 };
  const validationPill: { variant: "ok" | "warn" | "error" | "neutral"; label: string } =
    !validationLatest
      ? { variant: "neutral", label: "Not run" }
      : totals.error > 0
        ? { variant: "error", label: `${totals.error} error${totals.error === 1 ? "" : "s"}` }
        : totals.warning > 0
          ? { variant: "warn", label: `${totals.warning} warning${totals.warning === 1 ? "" : "s"}` }
          : { variant: "ok", label: "All checks passed" };

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <PanelHeader title="Validation thresholds" />
        <CardContent className="space-y-2 divide-y divide-zinc-800/60 pt-3">
          <PropertyRow label="Fail on warning" hint="Treat any warning as a build-blocking error.">
            <ToggleSwitch
              checked={config.failOnWarning}
              onChange={(v) => update("failOnWarning", v)}
              aria-label="Fail on warning"
            />
          </PropertyRow>
          <PropertyRow
            label="Warn scene size"
            hint="Single scene larger than this triggers a warning."
            unit="KB"
          >
            <Slider
              value={config.warnSceneSizeKb}
              min={64}
              max={4096}
              step={32}
              onChange={(v) => update("warnSceneSizeKb", Math.round(v))}
              valueLabel={`${config.warnSceneSizeKb}`}
            />
          </PropertyRow>
          <PropertyRow
            label="Warn chain depth"
            hint="Dependency chain deeper than this triggers a warning."
          >
            <Slider
              value={config.warnChainDepth}
              min={1}
              max={20}
              step={1}
              onChange={(v) => update("warnChainDepth", Math.round(v))}
              valueLabel={`${config.warnChainDepth}`}
            />
          </PropertyRow>
        </CardContent>
      </Card>

      <Card>
        <PanelHeader
          title="Validation run"
          action={
            <>
              <StatusPill variant={validationPill.variant}>
                {validationPill.label}
              </StatusPill>
              <Button
                variant="primary"
                size="sm"
                onClick={onRunValidation}
                disabled={validationRunning || !onRunValidation}
                title={
                  onRunValidation
                    ? "Run the validator over manifest + assets + chain"
                    : "Validator pipeline not wired yet"
                }
              >
                {validationRunning ? "Running…" : "Run validation"}
              </Button>
            </>
          }
        />
        <CardContent className="space-y-3 pt-3">
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

          {!validationLatest ? (
            <EmptyState
              icon={<CheckCircle2 size={26} />}
              title="No validation runs yet"
              description="Click Run validation above to scan the project. Results appear here."
              tutorial="project-validation"
            />
          ) : validationLatest.issues.length === 0 ? (
            <EmptyState
              icon={<CheckCircle2 size={26} />}
              title="All checks passed"
              description={`Validated in ${(validationLatest.durationMs ?? 0).toFixed(0)}ms — no issues found.`}
              tutorial="project-validation"
            />
          ) : (
            <ul className="rounded border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
              {validationLatest.issues.map((issue) => (
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

      {validationHistory.length > 0 ? (
        <CollapsibleSection title="Recent validation runs" defaultOpen={false}>
          <KeyValueList
            rows={validationHistory.slice(0, 10).map((run) => ({
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
        </CollapsibleSection>
      ) : null}

      <Card>
        <PanelHeader title="Debug" />
        <CardContent className="space-y-2 divide-y divide-zinc-800/60 pt-3">
          <PropertyRow
            label="Verbose engine logs"
            hint="Spammy. Useful when chasing weird bugs."
          >
            <ToggleSwitch
              checked={config.debugVerbose}
              onChange={(v) => update("debugVerbose", v)}
              aria-label="Verbose engine logs"
            />
          </PropertyRow>
          <PropertyRow
            label="Telemetry opt-in"
            hint="Sends anonymised engine errors to https://crash.cardboard.dev."
          >
            <ToggleSwitch
              checked={config.telemetry}
              onChange={(v) => update("telemetry", v)}
              aria-label="Telemetry opt-in"
            />
          </PropertyRow>
        </CardContent>
      </Card>

      <CollapsibleSection
        title={
          <span className="inline-flex items-center gap-2">
            Danger zone
            <Badge variant="red" outlined>
              UNSAFE
            </Badge>
          </span>
        }
      >
        <div className="space-y-2 divide-y divide-zinc-800/60">
          <PropertyRow
            label="Skip integrity checks"
            hint="Bypasses SHA-256 verification on dependencies. Dev only."
          >
            <ToggleSwitch
              checked={config.unsafeSkipIntegrity}
              onChange={(v) => update("unsafeSkipIntegrity", v)}
              aria-label="Skip integrity checks"
            />
          </PropertyRow>
          <PropertyRow
            label="Per-wall light samples"
            hint="Experimental. LIGHTING_OVERHAUL phase 3 (not yet shipped)."
          >
            <ToggleSwitch
              checked={config.experimentalPerWallSamples}
              onChange={(v) => update("experimentalPerWallSamples", v)}
              aria-label="Per-wall light samples"
            />
          </PropertyRow>
        </div>
      </CollapsibleSection>
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
