/**
 * MapView — the Scene tab's main surface.
 *
 * NOTE: this file is intentionally still named `MapView.tsx` even
 * though the tab it powers was renamed from "Map" → "Scene" in the
 * editor IA reorg. Renaming the file would cascade into the toolbar,
 * context menu, layer types, and a long chain of grid-editor
 * internals — most of which use "map" in the spatial sense (the
 * grid layout the canvas renders), not the tab-name sense. Keep the
 * filename stable; the user-facing label is "Scene".
 *
 * **Phase 2 Wave A composition** (mockup: `Editor Design/Map.png`):
 *
 *   +─────────────────────────────────────────────────────────────────+
 *   | TopBar (shell)                                                  |
 *   | PrimaryTabs (shell)                                             |
 *   |---------------------+-------------------+-----------------------|
 *   | LEFT rail           | CENTER            | RIGHT rail            |
 *   |   PanelHeader Scene |  EditorViewport   |   Card "3D Preview"   |
 *   |   <MapPalette>      |  + MapToolbar     |   Card "Cell Inspect" |
 *   |                     |  (inline)         |   Card "Scene Set."   |
 *   |                     |                   |   Card "Quick Tools"  |
 *   +─────────────────────────────────────────────────────────────────+
 *
 * The outer grid still uses the §6.5 three-rail body grammar
 * (`grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`) — not the
 * `<ThreeRailLayout>` primitive — because Playtest mode collapses the
 * rails to a single column without remounting GridEditor's WebGL +
 * IDB context. The primitive's `<aside>` wrappers would re-render in
 * a way that disturbs that lockstep; the inline grid keeps the
 * playtest round-trip flicker-free.
 *
 * The right rail's four cards are extracted into page-local
 * components under `views/scene/`:
 *
 *   - `./scene/ScenePreview3D`     — wraps `CellPreview` (Wave B refines).
 *   - `./scene/CellInspector`      — read-only cell metadata (Wave B refines).
 *   - `./scene/SceneSettings`      — Ambient/Brightness/Fog (Wave B refines
 *                                    once per-scene render config ships).
 *   - `./scene/QuickToolsGrid`     — Fill/Replace/Erase/Clear stub buttons.
 *
 * Wave B work happens inside those files. This layout file stays a
 * thin composition that wires state through.
 */
import React from "react";
import { EditorViewport, type ViewportMode } from "./EditorViewport";
import type { EditorTool, MapSelectionInfo, MutableScene } from "./GridEditor";
import { MapToolbar, type MapLayer, type MapTool } from "./MapToolbar";
import { PlaytestOverlay, type EngineStats } from "./PlaytestOverlay";
import {
  MapContextMenu,
  type CellClipboardEntry,
  type CellContextMenuLayer,
  type CellContextMenuPayload,
} from "./MapContextMenu";
import { PresetContextMenu } from "./PresetContextMenu";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import { autoNamePreset } from "../lib/presetCrud";
import {
  CellPreview,
  defaultCellPreviewOrbit,
  type CellPreviewOrbitState,
} from "./CellPreview";
import { decodeLightmap } from "@two_5_d/engine";
import type {
  CellPreviewLightmapSource,
  SceneLightmap,
  SceneLightmapJSON,
} from "@two_5_d/engine";
import { PresetEditView } from "./PresetEditView";
import { MapPalette } from "./MapPalette";
import { useStatusBar } from "../shell/StatusBarContext";
import { useEditorActions } from "../shell/EditorActionsContext";
import { useLocalStorage } from "../lib/useLocalStorage";
// Import explicitly from the `components/ui/` directory so Node's
// resolution doesn't fall through to the legacy `components/ui.tsx`
// barrel. This matches the pattern other R3+R4 view modules use.
import {
  Button,
  Card,
  IconButton,
  LiveIndicator,
  PanelHeader,
  ScrollArea,
} from "../components/ui/index";
import { MoreVertical } from "lucide-react";

// ── Phase 2 Wave A page-local components ────────────────────────────
//
// Each of these is a thin stub that holds the inline JSX the previous
// MapView carried inside its right-rail cards. Wave B refines them
// in place — the layout file (this one) stays unchanged.
import { ScenePreview3D } from "./scene/ScenePreview3D";
import { CellInspector } from "./scene/CellInspector";
import { SceneSettings } from "./scene/SceneSettings";
import { QuickToolsGrid, type QuickToolKind } from "./scene/QuickToolsGrid";

export interface MapViewProps {
  projectId: string;
  /** Currently-active scene path (null until manifest resolves). */
  scenePath: string | null;
  /** Active scene JSON (Edit mode). */
  editScene: MutableScene | null;
  editScenePath: string | null;
  onEditSceneChange: (next: MutableScene) => void;
  /** Persist the in-memory scene to IDB. Surfaced to the TopBar's
   *  Save button via EditorActions. */
  onPersistScene: () => Promise<void>;
  /** Bake/etc rewrote IDB out-of-band. */
  onSceneRewrittenExternally: (path: string) => Promise<void> | void;
  /** Scene-pinning support — driven by the shell's ActiveSceneContext.
   *  ProjectView reads context and forwards the path here. */
  viewportScene: string | null;
  /** Viewport mode — preserved for R4h's Playtest wiring. */
  mode: ViewportMode;
  onModeChange: (mode: ViewportMode) => void;
  /** Prefab + sprite catalogues, surfaced to GridEditor's tools. */
  prefabNames: ReadonlyArray<string>;
  spriteIds: ReadonlyArray<string>;
  /** Iframe ref hand-back (the Settings modal posts `{type:"reset"}`
   *  through it). */
  iframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
  /** Fallback scene name when `viewportScene` is unset. */
  fallbackSceneName?: string;
  /** ProjectView wraps `setViewportScene` — used when the iframe
   *  resolves a scene path before the user has picked one. */
  onSceneResolved: (path: string) => void;
}

export function MapView({
  projectId,
  scenePath,
  editScene,
  editScenePath,
  onEditSceneChange,
  onPersistScene,
  onSceneRewrittenExternally,
  viewportScene,
  mode,
  onModeChange,
  prefabNames,
  spriteIds,
  iframeRef,
  fallbackSceneName,
  onSceneResolved,
}: MapViewProps) {
  // ── Selection state pushed up by GridEditor.
  const [selection, setSelection] = React.useState<MapSelectionInfo | null>(
    null,
  );

  // Active layer + tool driven by MapToolbar above the EditorViewport.
  const [mapLayer, setMapLayer] = React.useState<MapLayer>("walls");
  const [mapTool, setMapTool] = React.useState<MapTool>("select");
  const [snapToGrid, setSnapToGrid] = useLocalStorage(
    "editor.map.snapToGrid",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  // Active palette preset. Surfaced up so the Eyedropper tool in
  // GridEditor can push the clicked cell's preset back into the
  // toolbar's "active preset" slot.
  const [activePresetId, setActivePresetId] = React.useState<string | null>(
    null,
  );
  // Anonymous tile presets (id starts with `_`) — palette clutter,
  // hidden by default. The flag flows into `selection.presetOptions`
  // so CellPreview's override dropdowns stay in lockstep with the
  // palette's visible set.
  const [showAnonymousPresets, setShowAnonymousPresets] = useLocalStorage(
    "editor.palette.showAnonymous",
    false,
    (v): v is boolean => typeof v === "boolean",
  );

  // ── Playtest mode state ─────────────────────────────────────────
  //
  // `playtestActive` flips the MapView into Playtest mode: a
  // full-takeover overlay (`<PlaytestOverlay>`) renders on top of the
  // existing Map layout. The iframe game-runner inside
  // `<EditorViewport>` is NOT remounted — `EditorViewport` keeps the
  // iframe mounted regardless of `mode`, and we additionally flip
  // `mode` to "play" so the iframe is `visible` again (edit mode
  // currently sets `invisible pointer-events-none`).
  const [playtestActive, setPlaytestActive] = React.useState(false);
  const [latestStats, setLatestStats] = React.useState<EngineStats | null>(
    null,
  );

  // Cell right-click context menu state.
  const [contextMenu, setContextMenu] = React.useState<{
    open: boolean;
    payload: CellContextMenuPayload | null;
  }>({ open: false, payload: null });
  const [clipboard, setClipboard] = React.useState<CellClipboardEntry | null>(
    null,
  );

  // Palette right-click context menu state.
  const [presetContextMenu, setPresetContextMenu] = React.useState<{
    open: boolean;
    presetId: string | null;
    screenX: number;
    screenY: number;
  }>({ open: false, presetId: null, screenX: 0, screenY: 0 });

  // Preset Edit Mode — when non-null, MapView swaps its normal layout
  // for the full-screen `PresetEditView`.
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(
    null,
  );

  // Scene-settings local placeholders — preview-only until the engine
  // exposes per-scene render config (ambient / fog / brightness).
  const [sceneAmbient, setSceneAmbient] = useLocalStorage(
    "editor.scene.ambient",
    50,
    (v): v is number => typeof v === "number",
  );
  const [sceneBrightness, setSceneBrightness] = useLocalStorage(
    "editor.scene.brightness",
    100,
    (v): v is number => typeof v === "number",
  );
  const [sceneFog, setSceneFog] = useLocalStorage(
    "editor.scene.fog",
    false,
    (v): v is boolean => typeof v === "boolean",
  );

  // CellPreview — autorotate + expanded modal + shared orbit ref.
  const [autoRotate, setAutoRotate] = useLocalStorage(
    "editor.cellPreview.autoRotate",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  const [cellPreviewExpanded, setCellPreviewExpanded] = React.useState(false);
  const cellPreviewOrbitRef = React.useRef<CellPreviewOrbitState>(
    defaultCellPreviewOrbit(),
  );
  // Sketchfab-style settings panel state — lifted here so both
  // CellPreview instances (inline + modal) stay in lockstep.
  const [cellPreviewShowWalls, setCellPreviewShowWalls] = useLocalStorage(
    "editor.cellPreview.showWalls",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  const [cellPreviewShowFloors, setCellPreviewShowFloors] = useLocalStorage(
    "editor.cellPreview.showFloors",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  const [cellPreviewShowCeilings, setCellPreviewShowCeilings] = useLocalStorage(
    "editor.cellPreview.showCeilings",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  const [cellPreviewRoomSize, setCellPreviewRoomSize] = useLocalStorage(
    "editor.cellPreview.roomSize",
    7,
    (v): v is number =>
      typeof v === "number" && [7, 15, 25].includes(v),
  );
  const [cellPreviewFloorOverride, setCellPreviewFloorOverride] =
    useLocalStorage<string | null>(
      "editor.cellPreview.floorOverride",
      null,
      (v) => v === null || typeof v === "string",
    );
  const [cellPreviewCeilingOverride, setCellPreviewCeilingOverride] =
    useLocalStorage<string | null>(
      "editor.cellPreview.ceilingOverride",
      null,
      (v) => v === null || typeof v === "string",
    );
  const [cellPreviewWallOverride, setCellPreviewWallOverride] =
    useLocalStorage<string | null>(
      "editor.cellPreview.wallOverride",
      null,
      (v) => v === null || typeof v === "string",
    );
  const [cellPreviewRotateSpeed, setCellPreviewRotateSpeed] = useLocalStorage(
    "editor.cellPreview.rotateSpeed",
    0.25,
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );

  // ESC closes the cell-preview-expanded modal.
  React.useEffect(() => {
    if (!cellPreviewExpanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setCellPreviewExpanded(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cellPreviewExpanded]);

  // Preset Edit Mode takes over the whole view — close the
  // cell-preview modal the moment edit mode is entered.
  React.useEffect(() => {
    if (editingPresetId !== null) setCellPreviewExpanded(false);
  }, [editingPresetId]);

  // ── Baked-lightmap source for CellPreview ────────────────────────
  // Decode the active scene's `lightmap` blob once (memoised on raw
  // JSON identity) so the preview reads the same bake the engine does.
  const decodedSceneLightmap = React.useMemo<SceneLightmap | null>(() => {
    const raw = editScene?.lightmap;
    if (!raw || typeof raw !== "object") return null;
    try {
      return decodeLightmap(raw as SceneLightmapJSON);
    } catch (err) {
      console.warn("[MapView] decodeLightmap failed:", err);
      return null;
    }
  }, [editScene?.lightmap]);
  const cellPreviewLightmapSource =
    React.useMemo<CellPreviewLightmapSource | null>(() => {
      if (!decodedSceneLightmap) return null;
      const sel = selection?.selected;
      if (!sel) return null;
      return {
        lightmap: decodedSceneLightmap,
        selectedX: sel.x,
        selectedY: sel.y,
      };
    }, [decodedSceneLightmap, selection?.selected]);

  // ── StatusBar wiring ─────────────────────────────────────────────
  const { setSections } = useStatusBar();
  React.useEffect(() => {
    const coords = selection?.selected ?? selection?.hover ?? null;
    const sections = [
      {
        id: "cell-coords",
        label: "Cell",
        value: coords ? `X: ${coords.x}, Y: ${coords.y}` : "—",
      },
      {
        id: "entity-count",
        label: "Entities",
        value: String(selection?.entityCount ?? 0),
      },
      {
        id: "selected-preset",
        label: "Preset",
        value: selection?.selectedPresetId ?? "—",
      },
      ...(scenePath
        ? [
            {
              id: "scene-path",
              label: "Scene",
              value: scenePath.replace(/^scenes\//, ""),
              align: "right" as const,
            },
          ]
        : []),
    ];
    setSections(sections);
    return () => setSections([]);
  }, [selection, scenePath, setSections]);

  // ── EditorActions registration (Save + Playtest start/stop/rerun)
  const { register } = useEditorActions();
  const rerunIframe = React.useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "reset" }, "*");
  }, [iframeRef]);
  const startPlaytest = React.useCallback(async () => {
    try {
      await onPersistScene();
    } catch (err) {
      console.warn("[MapView] save-on-playtest-start failed —", err);
    }
    if (editScenePath) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "scene-changed", path: editScenePath },
        "*",
      );
    }
    iframeRef.current?.contentWindow?.postMessage({ type: "resume" }, "*");
    onModeChange("play");
    setPlaytestActive(true);
  }, [onPersistScene, editScenePath, iframeRef, onModeChange]);
  const stopPlaytest = React.useCallback(() => {
    setPlaytestActive(false);
    setLatestStats(null);
    iframeRef.current?.contentWindow?.postMessage({ type: "pause" }, "*");
    onModeChange("edit");
  }, [iframeRef, onModeChange]);
  React.useEffect(() => {
    return register({
      save: async () => {
        await onPersistScene();
      },
      playtestStart: playtestActive ? undefined : startPlaytest,
      playtestStop: playtestActive ? stopPlaytest : undefined,
      rerun: playtestActive ? rerunIframe : undefined,
    });
  }, [
    register,
    onPersistScene,
    playtestActive,
    startPlaytest,
    stopPlaytest,
    rerunIframe,
  ]);

  // ESC closes Playtest mode while active.
  React.useEffect(() => {
    if (!playtestActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        stopPlaytest();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playtestActive, stopPlaytest]);

  // ── Cell context-menu close + action handlers ───────────────────
  const closeContextMenu = React.useCallback(() => {
    setContextMenu((s) => ({ open: false, payload: s.payload }));
  }, []);

  const handleCopyCell = React.useCallback(
    (x: number, y: number, layer: CellContextMenuLayer) => {
      const presetId = readCellPreset(editScene, layer, x, y);
      setClipboard({ layer, presetId });
    },
    [editScene],
  );

  const handlePasteCell = React.useCallback(
    (x: number, y: number, layer: CellContextMenuLayer) => {
      if (!editScene || !clipboard) return;
      if (!isPaintGridLayer(layer)) return;
      const next = writeCellPreset(editScene, layer, x, y, clipboard.presetId);
      if (next !== editScene) onEditSceneChange(next);
    },
    [editScene, clipboard, onEditSceneChange],
  );

  const handleClearCell = React.useCallback(
    (x: number, y: number, layer: CellContextMenuLayer) => {
      if (!editScene) return;
      if (!isPaintGridLayer(layer)) return;
      const next = writeCellPreset(editScene, layer, x, y, null);
      if (next !== editScene) onEditSceneChange(next);
    },
    [editScene, onEditSceneChange],
  );

  // Stubbed actions — WIRING comments mark the follow-up work.
  const handleEditParentPreset = React.useCallback((presetId: string) => {
    setEditingPresetId(presetId);
  }, []);

  const handleSelectAllWithPreset = React.useCallback((presetId: string) => {
    // WIRING: future canvas-side highlight of every cell on the active
    // layer that resolves to `presetId`.
    console.log("[MapView] would highlight all cells with preset", presetId);
  }, []);

  const handleJumpToPlaytestHere = React.useCallback(
    (x: number, y: number) => {
      // WIRING: requires an EDITOR_IFRAME `teleport-player` message
      // protocol.
      console.log("[MapView] would jump-to-playtest at", { x, y });
    },
    [],
  );

  const handleShowPackChainAttribution = React.useCallback(
    (presetId: string) => {
      // WIRING: future modal showing which pack supplied this preset.
      console.log("[MapView] would show attribution for", presetId);
    },
    [],
  );

  // Quick Tools — Wave B will land the real layer-scoped mutations.
  const handleQuickTool = React.useCallback(
    (kind: QuickToolKind) => {
      console.log("[MapView] quick-tool", kind, {
        layer: mapLayer,
        activePresetId,
        selected: selection?.selected ?? null,
      });
    },
    [mapLayer, activePresetId, selection],
  );

  // ── Palette context-menu helpers ────────────────────────────────
  const presetUsageCount = React.useCallback(
    (presetId: string): number => {
      if (!editScene) return 0;
      const idMap = editScene.idMap ?? {};
      let numericId: number | null = null;
      for (const [k, v] of Object.entries(idMap)) {
        if (v === presetId) {
          numericId = Number(k);
          break;
        }
      }
      const width = editScene.walls[0]?.length ?? 0;
      const height = editScene.walls.length;
      let count = 0;
      const grids: Array<{
        grid: ReadonlyArray<ReadonlyArray<number>>;
        layer: "walls" | "floors" | "ceiling";
      }> = [
        { grid: editScene.walls, layer: "walls" },
        { grid: editScene.floors ?? [], layer: "floors" },
        { grid: editScene.ceiling ?? editScene.ceilings ?? [], layer: "ceiling" },
      ];
      for (const { grid, layer } of grids) {
        for (let y = 0; y < height; y++) {
          const row = grid[y];
          for (let x = 0; x < width; x++) {
            const cell = row?.[x] ?? 0;
            if (cell === 0) {
              if (
                layer === "floors" &&
                editScene.layerDefaults?.floor === presetId
              ) {
                count++;
              } else if (
                layer === "ceiling" &&
                editScene.layerDefaults?.ceiling === presetId
              ) {
                count++;
              }
              continue;
            }
            if (numericId !== null && cell === numericId) count++;
          }
        }
      }
      return count;
    },
    [editScene],
  );

  const closePresetContextMenu = React.useCallback(() => {
    setPresetContextMenu((s) => ({ ...s, open: false }));
  }, []);

  const sourcePathForPreset = React.useCallback(
    (presetId: string): string | null => {
      const opt = selection?.presetOptions.find((p) => p.id === presetId);
      return opt?.sourcePath ?? null;
    },
    [selection],
  );

  const stripJsonComments = React.useCallback((src: string): string => {
    let out = "";
    let i = 0;
    const n = src.length;
    let inString = false;
    let stringChar = "";
    while (i < n) {
      const c = src[i]!;
      const next = i + 1 < n ? src[i + 1]! : "";
      if (inString) {
        out += c;
        if (c === "\\" && i + 1 < n) {
          out += next;
          i += 2;
          continue;
        }
        if (c === stringChar) inString = false;
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        inString = true;
        stringChar = c;
        out += c;
        i++;
        continue;
      }
      if (c === "/" && next === "/") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && next === "*") {
        i += 2;
        while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }, []);

  const handleDuplicatePreset = React.useCallback(
    async (presetId: string) => {
      const sourcePath = sourcePathForPreset(presetId);
      if (!sourcePath) {
        console.warn(
          "[MapView] cannot duplicate preset — no sourcePath for",
          presetId,
        );
        return;
      }
      try {
        const raw = await EditorProjectStore.loadAsset(projectId, sourcePath);
        if (typeof raw !== "string") {
          console.warn(
            "[MapView] cannot duplicate — source file not in IDB:",
            sourcePath,
          );
          return;
        }
        const parsed = JSON.parse(stripJsonComments(raw)) as Record<
          string,
          unknown
        >;
        if (!(presetId in parsed)) {
          console.warn(
            "[MapView] cannot duplicate — preset key missing from",
            sourcePath,
          );
          return;
        }
        const existingIds = Object.keys(parsed);
        const newId = autoNamePreset(presetId, existingIds);
        const sourceEntry = parsed[presetId];
        parsed[newId] = JSON.parse(JSON.stringify(sourceEntry)) as unknown;
        const nextText = JSON.stringify(parsed, null, 2);
        await EditorProjectStore.saveAsset(projectId, sourcePath, nextText);
      } catch (err) {
        console.error("[MapView] duplicate preset failed —", err);
      }
    },
    [projectId, sourcePathForPreset, stripJsonComments],
  );

  const handleDeletePreset = React.useCallback(
    async (presetId: string) => {
      const sourcePath = sourcePathForPreset(presetId);
      if (!sourcePath) {
        console.warn(
          "[MapView] cannot delete preset — no sourcePath for",
          presetId,
        );
        return;
      }
      const ok = window.confirm(`Delete preset "${presetId}"?`);
      if (!ok) return;
      try {
        const raw = await EditorProjectStore.loadAsset(projectId, sourcePath);
        if (typeof raw !== "string") {
          console.warn(
            "[MapView] cannot delete — source file not in IDB:",
            sourcePath,
          );
          return;
        }
        const parsed = JSON.parse(stripJsonComments(raw)) as Record<
          string,
          unknown
        >;
        if (!(presetId in parsed)) {
          console.warn(
            "[MapView] cannot delete — preset key missing from",
            sourcePath,
          );
          return;
        }
        delete parsed[presetId];
        const nextText = JSON.stringify(parsed, null, 2);
        await EditorProjectStore.saveAsset(projectId, sourcePath, nextText);
      } catch (err) {
        console.error("[MapView] delete preset failed —", err);
      }
    },
    [projectId, sourcePathForPreset, stripJsonComments],
  );

  // ── Preset Edit Mode early-exit ─────────────────────────────────
  // When `editingPresetId` is set, swap the entire Map layout for
  // PresetEditView. We pull the resolved preset data straight off the
  // latest `selection` snapshot if the ids match.
  if (editingPresetId !== null) {
    let presetDataForEdit:
      | import("@two_5_d/engine").ResolvedPresetData
      | null = null;
    let layerHintForEdit: "walls" | "floors" | "ceiling" = "walls";
    let sourcePathForEdit: string | undefined;
    if (selection) {
      if (selection.selectedPresetId === editingPresetId) {
        presetDataForEdit = selection.selectedPresetData;
        layerHintForEdit = cellPreviewLayer(selection.layer);
      } else if (selection.floorPresetId === editingPresetId) {
        presetDataForEdit = selection.floorPresetData;
        layerHintForEdit = "floors";
      } else if (selection.ceilingPresetId === editingPresetId) {
        presetDataForEdit = selection.ceilingPresetData;
        layerHintForEdit = "ceiling";
      }
      const opt = selection.presetOptions.find(
        (p) => p.id === editingPresetId,
      );
      if (opt) sourcePathForEdit = opt.sourcePath;
    }

    if (!presetDataForEdit) {
      return (
        <div className="flex h-full items-center justify-center bg-zinc-950 text-zinc-400">
          <div className="space-y-2 text-center">
            <p>Cannot resolve preset data for {editingPresetId}.</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditingPresetId(null)}
            >
              Back to map
            </Button>
          </div>
        </div>
      );
    }

    return (
      <PresetEditView
        projectId={projectId}
        presetId={editingPresetId}
        presetData={presetDataForEdit}
        layerHint={layerHintForEdit}
        presetOptions={selection?.presetOptions ?? []}
        presetSourcePath={sourcePathForEdit}
        onSave={() => {
          // WIRING: a follow-up should bump a project-wide "preset
          // rev" so other open views invalidate their caches without
          // a project reload.
        }}
        onCancel={() => setEditingPresetId(null)}
        onExit={() => setEditingPresetId(null)}
      />
    );
  }

  // ── Common props for both ScenePreview3D instances ──────────────
  // (inline + expanded modal). Lifting them keeps the two preview
  // surfaces in lockstep without repeating the prop list twice.
  const scenePreviewSharedProps = {
    projectId,
    presetId: selection?.selectedPresetId ?? null,
    presetData: selection?.selectedPresetData ?? null,
    textureUrl: selection?.selectedPresetTextureUrl ?? null,
    layer: cellPreviewLayer(selection?.layer),
    autoRotate,
    onAutoRotateChange: setAutoRotate,
    floorPresetId: selection?.floorPresetId ?? null,
    floorPresetData: selection?.floorPresetData ?? null,
    floorTextureUrl: selection?.floorPresetTextureUrl ?? null,
    ceilingPresetId: selection?.ceilingPresetId ?? null,
    ceilingPresetData: selection?.ceilingPresetData ?? null,
    ceilingTextureUrl: selection?.ceilingPresetTextureUrl ?? null,
    sharedOrbitRef: cellPreviewOrbitRef,
    showWalls: cellPreviewShowWalls,
    setShowWalls: setCellPreviewShowWalls,
    showFloors: cellPreviewShowFloors,
    setShowFloors: setCellPreviewShowFloors,
    showCeilings: cellPreviewShowCeilings,
    setShowCeilings: setCellPreviewShowCeilings,
    roomSize: cellPreviewRoomSize,
    setRoomSize: setCellPreviewRoomSize,
    floorPresetOverride: cellPreviewFloorOverride,
    setFloorPresetOverride: setCellPreviewFloorOverride,
    ceilingPresetOverride: cellPreviewCeilingOverride,
    setCeilingPresetOverride: setCellPreviewCeilingOverride,
    wallPresetOverride: cellPreviewWallOverride,
    setWallPresetOverride: setCellPreviewWallOverride,
    autoRotateSpeed: cellPreviewRotateSpeed,
    setAutoRotateSpeed: setCellPreviewRotateSpeed,
    presetOptions: selection?.presetOptions ?? [],
    lightmapSource: cellPreviewLightmapSource,
  };

  return (
    <div
      className={
        // §6.5 shell-body grammar — Scene tab is a 3-rail layout.
        // Playtest mode collapses the side rails so the iframe owns
        // the full body; both rails stay MOUNTED but `hidden` so
        // CellPreview's WebGL context (and the palette's resolver/IDB
        // cache) survive the Edit ↔ Playtest round-trip.
        playtestActive
          ? "relative grid h-full grid-cols-[1fr] min-h-0 bg-[var(--color-bg-app)]"
          : "relative grid h-full grid-cols-[var(--rail-left)_1fr_var(--rail-right)] gap-section min-h-0 bg-[var(--color-bg-app)] p-[var(--gap-section)]"
      }
    >
      {/* ── LEFT rail — Scene header + Tile preset palette ─────── */}
      <aside
        className="panel-surface flex flex-col min-h-0 rounded-card overflow-hidden"
        hidden={playtestActive}
      >
        <PanelHeader
          size="sm"
          title="Scene"
          action={
            scenePath ? (
              <span
                className="text-[10px] font-mono text-zinc-300 truncate max-w-[160px]"
                title={scenePath}
              >
                {scenePath.replace(/^scenes\//, "")}
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500">no scene</span>
            )
          }
        />

        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <MapPalette
            projectId={projectId}
            activePresetId={activePresetId}
            onActivePresetChange={setActivePresetId}
            showAnonymousPresets={showAnonymousPresets}
            onShowAnonymousPresetsChange={setShowAnonymousPresets}
            onEditPreset={(id) => setEditingPresetId(id)}
            onPresetContextMenu={(id, x, y) =>
              setPresetContextMenu({
                open: true,
                presetId: id,
                screenX: x,
                screenY: y,
              })
            }
          />
        </div>
      </aside>

      {/* ── CENTER — EditorViewport (canvas) + inline MapToolbar ─ */}
      <main className="panel-surface relative flex flex-col gap-section min-h-0 rounded-card overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <EditorViewport
            projectId={projectId}
            sceneName={viewportScene ?? fallbackSceneName}
            onSceneResolved={onSceneResolved}
            mode={mode}
            onModeChange={onModeChange}
            editScene={editScene}
            editScenePath={editScenePath}
            onEditSceneChange={onEditSceneChange}
            onPersistScene={onPersistScene}
            iframeRef={iframeRef}
            onSceneRewrittenExternally={onSceneRewrittenExternally}
            prefabNames={prefabNames}
            spriteIds={spriteIds}
            toolbarSlot={
              <MapToolbar
                layer={mapLayer}
                onLayerChange={setMapLayer}
                tool={mapTool}
                onToolChange={setMapTool}
                snapToGrid={snapToGrid}
                onSnapToGridChange={setSnapToGrid}
              />
            }
            snapToGrid={snapToGrid}
            onMapSelectionChange={setSelection}
            onEngineStats={playtestActive ? setLatestStats : undefined}
            gridLayer={
              mapLayer satisfies MapLayer as MapSelectionInfo["layer"]
            }
            onGridLayerChange={(next) => {
              setMapLayer(next as MapLayer);
            }}
            gridTool={mapTool satisfies MapTool as EditorTool}
            onGridToolChange={(next) => {
              setMapTool(toMapTool(next));
            }}
            activePresetId={activePresetId}
            onActivePresetChange={setActivePresetId}
            showAnonymousPresets={showAnonymousPresets}
            onShowAnonymousPresetsChange={setShowAnonymousPresets}
            onCellContextMenu={(payload) =>
              setContextMenu({ open: true, payload })
            }
            onEditPreset={(id) => setEditingPresetId(id)}
            onPresetContextMenu={(id, x, y) =>
              setPresetContextMenu({
                open: true,
                presetId: id,
                screenX: x,
                screenY: y,
              })
            }
            hidePalette
            hideInspector
          />
        </div>

        {/* Expanded CellPreview modal (scoped to the centre pane). */}
        {cellPreviewExpanded ? (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setCellPreviewExpanded(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Expanded cell preview"
          >
            <div onClick={(e) => e.stopPropagation()}>
              {/* The expanded variant uses CellPreview directly (not
                  ScenePreview3D) because it skips the right-rail card
                  gutter inset and toggles the `expanded` prop. */}
              <CellPreview
                {...scenePreviewSharedProps}
                expanded
                onToggleExpanded={() => setCellPreviewExpanded(false)}
                onClose={() => setCellPreviewExpanded(false)}
              />
            </div>
          </div>
        ) : null}
      </main>

      {/* ── RIGHT rail — four stacked Cards (mockup §7.2) ──────── */}
      <aside
        className="flex flex-col min-h-0 overflow-hidden"
        hidden={playtestActive}
      >
        <ScrollArea fade={false} className="h-full">
          <div className="flex flex-col gap-section">
            {/* Card 1 — 3D Preview (LIVE indicator) */}
            <Card padded className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="section-eyebrow">3D Preview</h3>
                <LiveIndicator active />
              </div>
              <ScenePreview3D
                {...scenePreviewSharedProps}
                expanded={false}
                onToggleExpanded={() => setCellPreviewExpanded((v) => !v)}
              />
            </Card>

            {/* Card 2 — Cell Inspector (Wave B: page-local refine) */}
            <Card padded className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="section-eyebrow">Cell Inspector</h3>
                <IconButton
                  size="sm"
                  variant="ghost"
                  tooltip="Cell actions"
                  icon={<MoreVertical size={14} />}
                  // WIRING (Wave B): kebab menu populated in CellInspector.
                  onClick={() => undefined}
                />
              </div>
              <CellInspector
                selection={selection}
                onEditPreset={(id) => setEditingPresetId(id)}
              />
            </Card>

            {/* Card 3 — Scene Settings (Wave B: per-scene render config) */}
            <Card padded className="space-y-3">
              <h3 className="section-eyebrow">Scene Settings</h3>
              <SceneSettings
                ambient={sceneAmbient}
                onAmbientChange={setSceneAmbient}
                brightness={sceneBrightness}
                onBrightnessChange={setSceneBrightness}
                fog={sceneFog}
                onFogChange={setSceneFog}
              />
            </Card>

            {/* Card 4 — Quick Tools (Wave B: real layer-scoped mutations) */}
            <Card padded className="space-y-3">
              <h3 className="section-eyebrow">Quick Tools</h3>
              <QuickToolsGrid onAction={handleQuickTool} />
            </Card>
          </div>
        </ScrollArea>
      </aside>

      {/* Playtest overlay — full-takeover stats rail over the grid. */}
      {playtestActive ? (
        <PlaytestOverlay
          engineStats={latestStats}
          onRerun={rerunIframe}
          onExit={stopPlaytest}
        />
      ) : null}

      {/* Cell right-click context menu. */}
      <MapContextMenu
        open={contextMenu.open}
        payload={contextMenu.payload}
        onClose={closeContextMenu}
        onEditParentPreset={handleEditParentPreset}
        onCopyCell={handleCopyCell}
        onPasteCell={handlePasteCell}
        onClearCell={handleClearCell}
        onSelectAllWithPreset={handleSelectAllWithPreset}
        onJumpToPlaytestHere={handleJumpToPlaytestHere}
        onShowPackChainAttribution={handleShowPackChainAttribution}
        hasClipboard={clipboard !== null}
      />

      {/* Palette right-click context menu. */}
      <PresetContextMenu
        open={presetContextMenu.open}
        presetId={presetContextMenu.presetId}
        screenX={presetContextMenu.screenX}
        screenY={presetContextMenu.screenY}
        usageCount={
          presetContextMenu.presetId
            ? presetUsageCount(presetContextMenu.presetId)
            : 0
        }
        onClose={closePresetContextMenu}
        onEditPreset={(id) => setEditingPresetId(id)}
        onDuplicatePreset={(id) => {
          void handleDuplicatePreset(id);
        }}
        onShowPackChainAttribution={handleShowPackChainAttribution}
        onDeletePreset={(id) => {
          void handleDeletePreset(id);
        }}
      />
    </div>
  );
}

/* ─── Cell-paint helpers ──────────────────────────────────────────
 *
 * Small inline helpers for the context-menu Copy / Paste / Clear flow.
 * These intentionally duplicate the same paint logic GridEditor uses
 * internally (`replaceLayer` + idMap allocation) so MapView doesn't
 * need to grow a back-channel through GridEditor's ref. When the §7.2
 * GridEditor split lands and the paint helpers move to a shared
 * `lib/scene` module, both call sites collapse.
 *
 * `readCellPreset` returns the preset id resolved at (layer, x, y),
 * honouring `layerDefaults` for empty floor / ceiling cells (matches
 * the engine + GridEditor.presetForCell semantics).
 *
 * `writeCellPreset` writes a preset id (or null = clear) to the cell.
 * Allocates a fresh idMap row when the preset isn't already known.
 * Returns the SAME scene reference when there's nothing to change so
 * callers can short-circuit `onEditSceneChange`.
 */

function isPaintGridLayer(
  l: CellContextMenuLayer,
): l is "walls" | "floors" | "ceiling" {
  return l === "walls" || l === "floors" || l === "ceiling";
}

function getGrid(
  scene: MutableScene,
  layer: "walls" | "floors" | "ceiling",
): ReadonlyArray<ReadonlyArray<number>> {
  if (layer === "walls") return scene.walls;
  if (layer === "floors") return scene.floors ?? [];
  return scene.ceiling ?? scene.ceilings ?? [];
}

function readCellPreset(
  scene: MutableScene | null,
  layer: CellContextMenuLayer,
  x: number,
  y: number,
): string | null {
  if (!scene) return null;
  if (!isPaintGridLayer(layer)) return null;
  const grid = getGrid(scene, layer);
  const cell = grid[y]?.[x];
  if (typeof cell !== "number" || cell === 0) {
    if (layer === "floors") return scene.layerDefaults?.floor ?? null;
    if (layer === "ceiling") return scene.layerDefaults?.ceiling ?? null;
    return null;
  }
  return scene.idMap?.[String(cell)] ?? null;
}

function writeCellPreset(
  scene: MutableScene,
  layer: "walls" | "floors" | "ceiling",
  x: number,
  y: number,
  presetId: string | null,
): MutableScene {
  const width = scene.walls[0]?.length ?? 0;
  const height = scene.walls.length;
  if (x < 0 || y < 0 || x >= width || y >= height) return scene;

  const sourceGrid = getGrid(scene, layer);
  const rows: Array<Array<number>> = new Array(height);
  for (let yy = 0; yy < height; yy++) {
    const src = sourceGrid[yy];
    if (src && src.length === width) {
      rows[yy] = yy === y ? [...src] : (src as Array<number>);
    } else {
      const padded = new Array<number>(width);
      for (let xx = 0; xx < width; xx++) padded[xx] = src?.[xx] ?? 0;
      rows[yy] = padded;
    }
  }
  const targetRow = rows[y]!;
  const currentValue = targetRow[x] ?? 0;

  if (presetId === null) {
    if (currentValue === 0) return scene;
    const nextRow = [...targetRow];
    nextRow[x] = 0;
    rows[y] = nextRow;
    return assignLayer(scene, layer, rows);
  }

  const idMap = { ...(scene.idMap ?? { "0": null }) };
  let id: number | null = null;
  for (const [k, v] of Object.entries(idMap)) {
    if (v === presetId) {
      id = Number(k);
      break;
    }
  }
  let nextScene: MutableScene = scene;
  if (id === null) {
    let max = 0;
    for (const k of Object.keys(idMap)) {
      const n = Number(k);
      if (Number.isFinite(n) && n > max) max = n;
    }
    id = max + 1;
    idMap[String(id)] = presetId;
    nextScene = { ...nextScene, idMap };
  }
  if (currentValue === id) return scene;
  const nextRow = [...targetRow];
  nextRow[x] = id;
  rows[y] = nextRow;
  return assignLayer(nextScene, layer, rows);
}

function assignLayer(
  scene: MutableScene,
  layer: "walls" | "floors" | "ceiling",
  rows: Array<Array<number>>,
): MutableScene {
  if (layer === "walls") return { ...scene, walls: rows };
  if (layer === "floors") return { ...scene, floors: rows };
  if (scene.ceilings !== undefined) return { ...scene, ceilings: rows };
  return { ...scene, ceiling: rows };
}

/**
 * Clamp the active Map layer (which includes "lighting" / "entities")
 * to the paint-grid subset CellPreview understands.
 */
function cellPreviewLayer(
  layer: import("./GridEditor").MapSelectionInfo["layer"] | undefined,
): "walls" | "floors" | "ceiling" {
  if (layer === "floors" || layer === "ceiling") return layer;
  return "walls";
}

/**
 * Narrow the wider GridEditor `EditorTool` union down to the MapTool
 * set the toolbar exposes. Legacy `entity` / `light` values map to
 * "paint" — they still fire through GridEditor's pointer-down router
 * when the active layer is lighting / entities.
 */
function toMapTool(next: import("./GridEditor").EditorTool): MapTool {
  if (
    next === "select" ||
    next === "move" ||
    next === "paint" ||
    next === "eyedropper" ||
    next === "erase"
  ) {
    return next;
  }
  return "paint";
}
