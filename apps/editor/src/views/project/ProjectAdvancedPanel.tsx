import React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "../../components/ui";
import {
  PropertyRow,
  ToggleSwitch,
  Slider,
  CollapsibleSection,
  Badge,
} from "../../components/ui/index";

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

export interface ProjectAdvancedPanelProps {
  config: AdvancedConfig;
  onChange: (next: AdvancedConfig) => void;
}

export function ProjectAdvancedPanel({
  config,
  onChange,
}: ProjectAdvancedPanelProps) {
  const update = <K extends keyof AdvancedConfig>(key: K, value: AdvancedConfig[K]) =>
    onChange({ ...config, [key]: value });

  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Validation</CardTitle>
          <CardDescription>
            Tunes the project validator's strictness + warning thresholds.
            Severity counts surface in the Validation sub-tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 divide-y divide-zinc-800/60">
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
        <CardHeader>
          <CardTitle>Debug</CardTitle>
          <CardDescription>
            Runtime debug toggles. These ship with the exported pack —
            users running your game will see verbose logs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 divide-y divide-zinc-800/60">
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
