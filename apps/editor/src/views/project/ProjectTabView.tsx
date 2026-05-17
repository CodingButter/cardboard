import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { PackManifest } from "@two_5_d/engine";
import {
  EditorProjectStore,
  type AssetMeta,
} from "../../lib/EditorProjectStore";
import { TabStrip, type TabDescriptor } from "../../components/ui/TabStrip";
import { ScrollArea } from "../../components/ui/ScrollArea";
import { useStatusBar } from "../../shell/StatusBarContext";
import { useEditorActions } from "../../shell/EditorActionsContext";
import { listRequires } from "../../lib/dependencyManager";
import { ProjectManifestForm } from "./ProjectManifestForm";
import { ProjectDependenciesPanel } from "./ProjectDependenciesPanel";
import {
  ProjectExportPanel,
  DEFAULT_EXPORT_CONFIG,
  type ExportConfig,
} from "./ProjectExportPanel";
import {
  ProjectAdvancedPanel,
  DEFAULT_ADVANCED_CONFIG,
  type AdvancedConfig,
} from "./ProjectAdvancedPanel";
import {
  ProjectValidationPanel,
  type ValidationRun,
  type ValidationIssue,
} from "./ProjectValidationPanel";
import { ProjectLogPanel, type ProjectLogEntry } from "./ProjectLogPanel";
import {
  FileText,
  Link as LinkIcon,
  Package,
  Sliders,
  ShieldCheck,
  Terminal,
} from "lucide-react";

/**
 * ProjectTabView — R4f.
 *
 * Top-level surface for the Project primary tab. Absorbs the old
 * ProjectSettingsModal into a paginated view with six sub-tabs:
 *
 *   1. Manifest     — pack metadata.
 *   2. Dependencies — chain + URL-import + integrity (#194, #195).
 *   3. Export       — build / export config (#192).
 *   4. Advanced     — feature flags, validation thresholds, debug.
 *   5. Validation   — run-now + recent-pass log.
 *   6. Log          — combined build / export / validation stream.
 *
 * Per §12 Q2 this is the canonical project-config surface; the cog
 * icon opens EditorSettingsModal for editor-scoped prefs only.
 *
 * EditorActions: registers `save` (persist manifest + config) and
 * `export` (run the export pipeline — stubbed pending #192).
 *
 * StatusBar: pushes three sections — project-name / dep-count /
 * validation status.
 */

type SubTab =
  | "manifest"
  | "dependencies"
  | "export"
  | "advanced"
  | "validation"
  | "log";

const SUB_TABS: ReadonlyArray<TabDescriptor<SubTab>> = [
  { id: "manifest", label: "Manifest", icon: <FileText size={14} /> },
  { id: "dependencies", label: "Dependencies", icon: <LinkIcon size={14} /> },
  { id: "export", label: "Export", icon: <Package size={14} /> },
  { id: "advanced", label: "Advanced", icon: <Sliders size={14} /> },
  { id: "validation", label: "Validation", icon: <ShieldCheck size={14} /> },
  { id: "log", label: "Log", icon: <Terminal size={14} /> },
];

// WIRING: localStorage keys persist sub-tab + draft configs across
// editor sessions. Once the manifest schema accepts these fields
// natively (export config + advanced flags), the persistence moves
// into the manifest itself.
const subTabKey = (projectId: string) =>
  `cardboard_editor_project_subtab_${projectId}`;
const exportCfgKey = (projectId: string) =>
  `cardboard_editor_project_export_cfg_${projectId}`;
const advancedCfgKey = (projectId: string) =>
  `cardboard_editor_project_advanced_cfg_${projectId}`;

function loadSubTab(projectId: string): SubTab {
  try {
    const v = localStorage.getItem(subTabKey(projectId));
    if (
      v === "manifest" ||
      v === "dependencies" ||
      v === "export" ||
      v === "advanced" ||
      v === "validation" ||
      v === "log"
    ) {
      return v;
    }
  } catch {
    // sandboxed contexts — ignore
  }
  return "manifest";
}

function loadExportCfg(projectId: string): ExportConfig {
  try {
    const raw = localStorage.getItem(exportCfgKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ExportConfig>;
      return { ...DEFAULT_EXPORT_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_EXPORT_CONFIG };
}

function loadAdvancedCfg(projectId: string): AdvancedConfig {
  try {
    const raw = localStorage.getItem(advancedCfgKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AdvancedConfig>;
      return { ...DEFAULT_ADVANCED_CONFIG, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_ADVANCED_CONFIG };
}

export interface ProjectTabViewProps {
  projectId: string;
  /** Parent's hook so other views refresh when manifest changes. */
  onManifestChanged?: () => void;
}

export function ProjectTabView({
  projectId,
  onManifestChanged,
}: ProjectTabViewProps) {
  const [subTab, setSubTab] = useState<SubTab>(() => loadSubTab(projectId));
  const [manifest, setManifest] = useState<PackManifest | null>(null);
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportCfg, setExportCfg] = useState<ExportConfig>(() =>
    loadExportCfg(projectId),
  );
  const [advancedCfg, setAdvancedCfg] = useState<AdvancedConfig>(() =>
    loadAdvancedCfg(projectId),
  );
  const [latestRun, setLatestRun] = useState<ValidationRun | null>(null);
  const [runHistory, setRunHistory] = useState<ValidationRun[]>([]);
  const [running, setRunning] = useState(false);
  const [logEntries, setLogEntries] = useState<ProjectLogEntry[]>([]);

  // Persist sub-tab + draft configs.
  useEffect(() => {
    try {
      localStorage.setItem(subTabKey(projectId), subTab);
    } catch {
      // ignore
    }
  }, [projectId, subTab]);
  useEffect(() => {
    try {
      localStorage.setItem(exportCfgKey(projectId), JSON.stringify(exportCfg));
    } catch {
      // ignore
    }
  }, [projectId, exportCfg]);
  useEffect(() => {
    try {
      localStorage.setItem(
        advancedCfgKey(projectId),
        JSON.stringify(advancedCfg),
      );
    } catch {
      // ignore
    }
  }, [projectId, advancedCfg]);

  const refresh = useCallback(async () => {
    try {
      const [mf, as] = await Promise.all([
        EditorProjectStore.loadManifest(projectId),
        EditorProjectStore.listAssets(projectId),
      ]);
      setManifest(mf);
      setAssets(as);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleManifestSaved = useCallback(
    async (next: PackManifest) => {
      await EditorProjectStore.saveManifest(projectId, next);
      setManifest(next);
      onManifestChanged?.();
    },
    [projectId, onManifestChanged],
  );

  const pushLog = useCallback((entry: Omit<ProjectLogEntry, "id" | "time">) => {
    const e: ProjectLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toLocaleTimeString(),
      ...entry,
    };
    setLogEntries((prev) => [...prev.slice(-499), e]);
  }, []);

  // ── Validation handler ──
  //
  // WIRING: the real validator lives in `apps/pack-builder` and isn't
  // re-imported into the editor yet. This stub runs a single
  // synthetic check (start scene exists) to prove the wiring works
  // end-to-end. Replaced wholesale when the real validator is wired.
  const handleRunValidation = useCallback(async () => {
    if (!manifest) return;
    setRunning(true);
    pushLog({
      source: "validation",
      type: "info",
      message: "Validation pass started",
    });
    const started = Date.now();
    try {
      await new Promise((r) => setTimeout(r, 200));
      const issues: ValidationIssue[] = [];
      if (manifest.startScene) {
        const exists = assets.some((a) => a.path === manifest.startScene);
        if (!exists) {
          issues.push({
            id: "missing-start-scene",
            severity: "error",
            message: `startScene '${manifest.startScene}' is not present in the pack.`,
            path: manifest.startScene,
          });
        }
      } else {
        issues.push({
          id: "no-start-scene",
          severity: "warning",
          message: "No startScene declared in manifest.",
        });
      }
      const counts = {
        error: issues.filter((i) => i.severity === "error").length,
        warning: issues.filter((i) => i.severity === "warning").length,
        info: issues.filter((i) => i.severity === "info").length,
      };
      const run: ValidationRun = {
        id: `${started}`,
        startedAt: started,
        durationMs: Date.now() - started,
        counts,
        issues,
      };
      setLatestRun(run);
      setRunHistory((prev) => [run, ...prev].slice(0, 20));
      pushLog({
        source: "validation",
        type: counts.error > 0 ? "error" : counts.warning > 0 ? "warn" : "success",
        message:
          counts.error + counts.warning + counts.info === 0
            ? "Validation passed — no issues."
            : `Validation finished: ${counts.error} error / ${counts.warning} warning / ${counts.info} info.`,
      });
    } catch (err) {
      pushLog({
        source: "validation",
        type: "error",
        message: `Validation failed: ${(err as Error).message}`,
      });
    } finally {
      setRunning(false);
    }
  }, [manifest, assets, pushLog]);

  // ── Save handler — persist manifest + draft configs ──
  const handleSave = useCallback(async () => {
    if (!manifest) return;
    try {
      await EditorProjectStore.saveManifest(projectId, manifest);
      try {
        localStorage.setItem(exportCfgKey(projectId), JSON.stringify(exportCfg));
        localStorage.setItem(
          advancedCfgKey(projectId),
          JSON.stringify(advancedCfg),
        );
      } catch {
        // ignore — best-effort persistence
      }
      pushLog({
        source: "system",
        type: "success",
        message: "Project saved.",
      });
      onManifestChanged?.();
    } catch (err) {
      pushLog({
        source: "system",
        type: "error",
        message: `Save failed: ${(err as Error).message}`,
      });
    }
  }, [manifest, projectId, exportCfg, advancedCfg, pushLog, onManifestChanged]);

  // ── Export handler — stubbed until #192 lands ──
  //
  // WIRING: the actual export pipeline lives in `apps/pack-builder`.
  // We log the staged config to the build log so users get feedback,
  // then resolve. Once the helper is exposed to the editor, replace
  // the body with the real call + progress events.
  const handleExport = useCallback(async () => {
    if (!manifest) return;
    pushLog({
      source: "export",
      type: "info",
      message: `Export requested — mode=${exportCfg.mode}, target=${exportCfg.target}.`,
    });
    pushLog({
      source: "export",
      type: "warn",
      message:
        "Export pipeline (#192) not yet wired into the editor. Configuration was logged for review.",
    });
  }, [manifest, exportCfg, pushLog]);

  // ── EditorActions registration ──
  const { register } = useEditorActions();
  useEffect(() => {
    return register({
      save: handleSave,
      export: handleExport,
    });
  }, [register, handleSave, handleExport]);

  // ── StatusBar registration ──
  const { setSections } = useStatusBar();
  const depCount = useMemo(
    () => (manifest ? listRequires(manifest).length : 0),
    [manifest],
  );
  useEffect(() => {
    const sections = [
      {
        id: "project-name",
        label: "Project",
        value: manifest?.name ?? "—",
      },
      {
        id: "dep-count",
        label: "Deps",
        value: `${depCount}`,
      },
      {
        id: "validation",
        label: "Validation",
        value: latestRun
          ? latestRun.counts.error > 0
            ? `${latestRun.counts.error} error${latestRun.counts.error === 1 ? "" : "s"}`
            : latestRun.counts.warning > 0
              ? `${latestRun.counts.warning} warning${latestRun.counts.warning === 1 ? "" : "s"}`
              : "OK"
          : "Not run",
        align: "right" as const,
      },
    ];
    setSections(sections);
    return () => setSections([]);
  }, [manifest, depCount, latestRun, setSections]);

  if (!manifest) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-zinc-500">
        {error ? `Failed to load manifest: ${error}` : "Loading project…"}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950 text-zinc-100">
      {/* Sub-tab strip */}
      <TabStrip
        variant="secondary"
        tabs={SUB_TABS}
        value={subTab}
        onChange={setSubTab}
        aria-label="Project sub-tabs"
        className="px-6"
      />

      {error ? (
        <div className="mx-6 mt-4 rounded-md border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-200">
          <div className="font-medium">Something went wrong</div>
          <div className="mt-1 text-red-300/90">{error}</div>
          <button
            className="mt-2 text-xs text-red-200 hover:text-white underline underline-offset-2"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <ScrollArea className="flex-1 min-h-0">
        <div className="px-6 py-6">
          {subTab === "manifest" ? (
            <ProjectManifestForm
              manifest={manifest}
              assets={assets}
              onSave={handleManifestSaved}
            />
          ) : subTab === "dependencies" ? (
            <ProjectDependenciesPanel
              manifest={manifest}
              onSave={handleManifestSaved}
              onError={setError}
            />
          ) : subTab === "export" ? (
            <ProjectExportPanel
              manifest={manifest}
              config={exportCfg}
              onChange={setExportCfg}
              onExport={handleExport}
            />
          ) : subTab === "advanced" ? (
            <ProjectAdvancedPanel
              config={advancedCfg}
              onChange={setAdvancedCfg}
            />
          ) : subTab === "validation" ? (
            <ProjectValidationPanel
              latest={latestRun}
              history={runHistory}
              onRun={handleRunValidation}
              running={running}
            />
          ) : (
            <ProjectLogPanel
              lines={logEntries}
              onClear={() => setLogEntries([])}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
