import React from "react";
import type { PackManifest } from "@two_5_d/engine";
import {
  Card,
  CardContent,
  Button,
  Input,
} from "../../components/ui";
import {
  PropertyRow,
  Select,
  SegmentedControl,
  ToggleSwitch,
  ProgressBar,
  Badge,
  PanelHeader,
  CollapsibleSection,
  LogPanel,
  EmptyState,
  type LogLine,
  type LogLineType,
} from "../../components/ui/index";
import { Package } from "lucide-react";

/**
 * ProjectExportPanel — R4f Project tab → Export sub-view.
 *
 * Surfaces the build-config that controls `.apg` export:
 *
 *   - Export mode (build-full vs extend) — #192.
 *   - Output directory + filename pattern.
 *   - Optimisation toggles (minify, source maps, compress lights).
 *   - Target engine version pin.
 *
 * The actual export pipeline (build-full + extend) is tracked separately
 * as #192 and is not yet implemented. This panel renders the
 * configuration UI so users can author + persist their preferences;
 * `ProjectTabView` calls `onExport` (registered with EditorActions)
 * when the user clicks "Export pack" in the TopBar.
 *
 * WIRING: the buttons here are stubs until #192 ships an `exportPack()`
 * helper in `apps/pack-builder`. The `onExport` prop receives the
 * currently-staged config so the future helper can read it directly.
 */

export type ExportMode = "build-full" | "extend";

export interface ExportConfig {
  mode: ExportMode;
  /** Output directory inside the project (relative to project root). */
  outputDir: string;
  /** Generated filename pattern. `{name}` / `{version}` substituted. */
  filenamePattern: string;
  minify: boolean;
  sourceMaps: boolean;
  compressLights: boolean;
  /** Aggressive lighting compression — lossy, smaller. */
  compressLightsAggressive: boolean;
  removeUnusedAssets: boolean;
  compressAudio: boolean;
  /** Engine version pin (defaults to manifest.engine). */
  enginePin: string;
  /** Target platform — browser / web / node. */
  target: "browser" | "web" | "node";
}

export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  mode: "build-full",
  outputDir: "dist",
  filenamePattern: "{name}-{version}.apg",
  minify: true,
  sourceMaps: false,
  compressLights: true,
  compressLightsAggressive: false,
  removeUnusedAssets: true,
  compressAudio: true,
  enginePin: "*",
  target: "browser",
};

export interface ExportLogEntry {
  id: string;
  type: LogLineType;
  time: string;
  message: React.ReactNode;
}

export interface ProjectExportPanelProps {
  manifest: PackManifest;
  config: ExportConfig;
  onChange: (next: ExportConfig) => void;
  /** Trigger an export run. Optional — when absent the panel renders
   *  a disabled button. ProjectTabView wires this to its EditorActions
   *  export handler. */
  onExport?: () => void;
  /** Reported by the export pipeline once it streams progress. WIRING:
   *  hooked up alongside #192. Until then the bar is hidden. */
  exportProgress?: { value: number; caption?: string } | null;
  /** Export run output. Empty array → EmptyState. */
  logEntries?: ReadonlyArray<ExportLogEntry>;
  /** Optional clear handler — surfaced as the LogPanel's clear button. */
  onClearLog?: () => void;
}

export function ProjectExportPanel({
  manifest,
  config,
  onChange,
  onExport,
  exportProgress,
  logEntries = [],
  onClearLog,
}: ProjectExportPanelProps) {
  const update = <K extends keyof ExportConfig>(key: K, value: ExportConfig[K]) =>
    onChange({ ...config, [key]: value });

  // Resolve filename preview so authors can see what the export will be
  // named without running it.
  const filenamePreview = config.filenamePattern
    .replace("{name}", manifest.name || "pack")
    .replace("{version}", manifest.version || "0.0.0");

  const logLines: LogLine[] = React.useMemo(
    () =>
      logEntries.map((entry) => ({
        id: entry.id,
        type: entry.type,
        time: entry.time,
        message: entry.message,
      })),
    [logEntries],
  );

  return (
    <div className="space-y-4 max-w-4xl">
      <Card>
        <PanelHeader
          title="Export mode"
          action={
            <Badge variant="amber" outlined>
              {config.mode === "build-full" ? "FULL" : "EXTEND"}
            </Badge>
          }
        />
        <CardContent className="space-y-3 pt-3">
          <PropertyRow label="Mode" hint="Build full is the safe default.">
            <SegmentedControl<ExportMode>
              options={[
                { id: "build-full", label: "Build full" },
                { id: "extend", label: "Extend (delta)" },
              ]}
              value={config.mode}
              onChange={(v) => v && update("mode", v)}
              aria-label="Export mode"
            />
          </PropertyRow>
          <PropertyRow label="Target" hint="Where the pack runs.">
            <SegmentedControl<ExportConfig["target"]>
              options={[
                { id: "browser", label: "Browser" },
                { id: "web", label: "Web (PWA)" },
                { id: "node", label: "Node" },
              ]}
              value={config.target}
              onChange={(v) => v && update("target", v)}
              aria-label="Target platform"
            />
          </PropertyRow>
        </CardContent>
      </Card>

      <Card>
        <PanelHeader title="Output" />
        <CardContent className="space-y-3 pt-3">
          <PropertyRow label="Output directory" hint="Relative to project root.">
            <Input
              value={config.outputDir}
              onChange={(e) => update("outputDir", e.target.value)}
              placeholder="dist"
            />
          </PropertyRow>
          <PropertyRow
            label="Filename pattern"
            hint="Use {name} and {version} as substitution tokens."
          >
            <Input
              value={config.filenamePattern}
              onChange={(e) => update("filenamePattern", e.target.value)}
              placeholder="{name}-{version}.apg"
            />
          </PropertyRow>
          <div className="rounded border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs font-mono text-zinc-400">
            Preview:{" "}
            <span className="text-amber-300">
              {config.outputDir}/{filenamePreview}
            </span>
          </div>
        </CardContent>
      </Card>

      <CollapsibleSection title="Optimisation" defaultOpen={true}>
        <div className="space-y-2 divide-y divide-zinc-800/60">
          <PropertyRow label="Minify assets" hint="Strip whitespace + comments from JSON.">
            <ToggleSwitch
              checked={config.minify}
              onChange={(v) => update("minify", v)}
              aria-label="Minify assets"
            />
          </PropertyRow>
          <PropertyRow label="Source maps" hint="Adds `.map` files for debugging.">
            <ToggleSwitch
              checked={config.sourceMaps}
              onChange={(v) => update("sourceMaps", v)}
              aria-label="Source maps"
            />
          </PropertyRow>
          <PropertyRow
            label="Compress lights"
            hint="Quantise baked lightmap floats to 8-bit."
          >
            <ToggleSwitch
              checked={config.compressLights}
              onChange={(v) => update("compressLights", v)}
              aria-label="Compress lights"
            />
          </PropertyRow>
          {config.compressLights ? (
            <PropertyRow
              label="↳ Aggressive"
              hint="Lossier compression — smaller output, visible banding."
            >
              <ToggleSwitch
                checked={config.compressLightsAggressive}
                onChange={(v) => update("compressLightsAggressive", v)}
                aria-label="Aggressive light compression"
              />
            </PropertyRow>
          ) : null}
          <PropertyRow
            label="Remove unused assets"
            hint="Tree-shake assets unreferenced by any scene or script."
          >
            <ToggleSwitch
              checked={config.removeUnusedAssets}
              onChange={(v) => update("removeUnusedAssets", v)}
              aria-label="Remove unused assets"
            />
          </PropertyRow>
          <PropertyRow label="Compress audio" hint="Re-encode to OGG Vorbis at q=4.">
            <ToggleSwitch
              checked={config.compressAudio}
              onChange={(v) => update("compressAudio", v)}
              aria-label="Compress audio"
            />
          </PropertyRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Engine pin" defaultOpen={false}>
        <PropertyRow label="Engine version" hint="Semver range — '*' means any.">
          <Select
            value={config.enginePin}
            onChange={(e) => update("enginePin", e.target.value)}
            options={[
              { value: "*", label: "* (any)" },
              { value: "^0.1.0", label: "^0.1.0 (compatible 0.1.x)" },
              { value: "~0.1.0", label: "~0.1.0 (patch-only 0.1.0)" },
              { value: "0.1.0", label: "0.1.0 (exact)" },
            ]}
          />
        </PropertyRow>
      </CollapsibleSection>

      {exportProgress ? (
        <Card>
          <CardContent className="pt-4">
            <ProgressBar
              value={exportProgress.value}
              label="Exporting"
              caption={exportProgress.caption}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <PanelHeader
          title="Build output"
          action={
            logEntries.length > 0 ? (
              <Badge variant="zinc">{logEntries.length}</Badge>
            ) : null
          }
        />
        <CardContent className="pt-3">
          {logEntries.length === 0 ? (
            <EmptyState
              icon={<Package size={26} />}
              title="No exports yet"
              description="Run an export to see build output here. Lines from the pipeline stream in as the build runs."
              tutorial="project-export"
            />
          ) : (
            <div className="h-[280px]">
              <LogPanel
                lines={logLines}
                onClear={onClearLog}
                className="h-full"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sticky footer-style action row matches ProjectManagement.png's
       *  EXPORT PACKAGE + Build Web Version row at the bottom. */}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800 mt-2">
        <Button
          variant="primary"
          size="md"
          onClick={onExport}
          disabled={!onExport}
          title={
            onExport
              ? "Run the export pipeline with the current configuration"
              : "Export handler not registered yet"
          }
        >
          <Package size={14} className="mr-1.5" />
          Export pack
        </Button>
      </div>
    </div>
  );
}
