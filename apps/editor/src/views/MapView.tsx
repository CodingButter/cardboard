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
// barrel (which only exports Card / Button / Input / Modal). This
// matches the pattern other R3+R4 view modules use.
import {
  Badge,
  CollapsibleSection,
  PanelHeader,
  PropertyRow,
  ScrollArea,
  Select,
  StatsBlock,
  ToggleSwitch,
  IconButton,
} from "../components/ui/index";
import { Button } from "../components/ui";
import { MoreVertical, Pencil } from "lucide-react";

/**
 * MapView — R4b re-skin of the Map workflow tab.
 *
 * **Composition (per EDITOR_REDESIGN.md §7.2 + §6.5):**
 *
 *     +--------------------------------------------------------+
 *     | Toolbar (R2)  Layers · scene path                       |
 *     +--------------------+-------------------+----------------+
 *     | (LEFT — preserved  | CENTER — GridEditor| RIGHT rail —  |
 *     |  inside GridEditor | canvas via         | Cell Preview  |
 *     |  for R4b; full     | EditorViewport     | + Cell        |
 *     |  split lands in    | (Edit mode)        | Inspector +   |
 *     |  follow-up.)       |                    | Scene Settings|
 *     +--------------------+--------------------+----------------+
 *
 * **R4b scope per brief (Q1 resolution):**
 *   - Re-skins the chrome AROUND the existing GridEditor — does NOT
 *     rewrite the canvas. GridEditor keeps its own internal palette +
 *     inspector for this phase; the full §7.2 split into
 *     `GridCanvas` / `MapLeftRail` / `MapInspector` is a follow-up.
 *   - Adds the **Cell Preview panel** in the right rail. Drives off
 *     `GridEditor.onSelectionChange` (added in this PR) and re-renders
 *     a single Three.js cell live as the user edits preset properties.
 *   - Removes the inline Play/Edit toggle from EditorViewport
 *     (now-blank top-right corner of the canvas).
 *   - Pushes 3 StatusBar sections: cell coords, entity count, selected
 *     preset name.
 *   - Registers `save` with EditorActions so the TopBar Save button
 *     fires the project-level scene persist.
 *
 * The right rail is fixed-width (380px per §6.5) and overflows
 * vertically; the canvas pane fills the rest. We intentionally keep
 * the GridEditor's internal left palette + right inspector visible for
 * this phase — folding them in lives in R4b's follow-up.
 */

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
  /** Viewport mode — preserved for R4h's Playtest wiring even though
   *  R4b drops the inline toggle. */
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

  // #246 — active layer + tool driven by MapToolbar (top of the Map
  // tab, above the EditorViewport). Default tool is `select` so the
  // user can click cells to inspect them WITHOUT mutating the scene —
  // the core unblock for cell inspection. Default layer is `walls`.
  const [mapLayer, setMapLayer] = React.useState<MapLayer>("walls");
  const [mapTool, setMapTool] = React.useState<MapTool>("select");
  // Snap-to-grid — controls drag behaviour for the `move` tool (and
  // future entity-drag affordances under `select`). Persisted across
  // sessions; default ON because authors usually want grid-aligned
  // placement, and the no-snap mode is opt-in for sub-cell tuning.
  const [snapToGrid, setSnapToGrid] = useLocalStorage(
    "editor.map.snapToGrid",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  // #246 — active palette preset. Surfaced up so the Eyedropper tool
  // in GridEditor can push the clicked cell's preset back into the
  // toolbar's "active preset" slot.
  const [activePresetId, setActivePresetId] = React.useState<string | null>(
    null,
  );
  // Anonymous tile presets (id starts with `_`) are per-cell variants
  // — most of the time they're palette clutter. Hidden by default; the
  // header row above the GridEditor palette exposes a toggle. The same
  // flag flows into `selection.presetOptions` so CellPreview's override
  // dropdowns stay in lockstep with the palette's visible set.
  // (#198 "Edit preset" still works on hidden anons — the cell context
  // menu's "Edit parent preset" + Cell Inspector's edit button reach
  // them by id regardless of palette visibility.)
  const [showAnonymousPresets, setShowAnonymousPresets] = useLocalStorage(
    "editor.palette.showAnonymous",
    false,
    (v): v is boolean => typeof v === "boolean",
  );

  // ── R4h — Playtest mode.
  //
  // `playtestActive` flips the MapView into "Playtest mode": a
  // full-takeover overlay (`<PlaytestOverlay>`) renders on top of the
  // existing Map layout. The iframe game-runner inside
  // `<EditorViewport>` is NOT remounted — `EditorViewport` keeps the
  // iframe mounted regardless of `mode`, and we additionally flip
  // `mode` to "play" so the iframe is `visible` again (edit mode
  // currently sets `invisible pointer-events-none`).
  //
  // §12 Q1 of EDITOR_REDESIGN.md: state survives across Edit ↔
  // Playtest transitions; only the explicit Rerun button (or full
  // reload) resets the world.
  //
  // `latestStats` is the most-recent engine-stats snapshot pushed by
  // the iframe at ~10Hz (EDITOR_IFRAME.md I2 telemetry). We only set
  // state while playtest is ACTIVE — the 10Hz push during normal Edit
  // mode is wasted re-renders otherwise.
  const [playtestActive, setPlaytestActive] = React.useState(false);
  const [latestStats, setLatestStats] = React.useState<EngineStats | null>(
    null,
  );

  // ── #254 — cell right-click context menu.
  //
  // GridEditor emits `onCellContextMenu(payload)` on Select-tool
  // right-click; we stash the payload + `open` flag here and render
  // the {@link MapContextMenu} from this view. Closing the menu
  // (outside-click / Escape / action picked) flips `open` back to
  // false but keeps the last payload around — avoids re-anchoring
  // flicker if the same click somehow re-opens it.
  const [contextMenu, setContextMenu] = React.useState<{
    open: boolean;
    payload: CellContextMenuPayload | null;
  }>({ open: false, payload: null });
  // Clipboard for cell Copy / Paste. `{layer, presetId}` is all we
  // need today; future enhancements (clipboard of multi-cell rects,
  // light entries, etc.) layer on top of the same state slot.
  const [clipboard, setClipboard] = React.useState<CellClipboardEntry | null>(
    null,
  );

  // ── #284 — palette right-click context menu.
  //
  // GridEditor's left-aside palette buttons emit `onPresetContextMenu`
  // when right-clicked; we stash the preset id + cursor coords here
  // and render the {@link PresetContextMenu}. Double-click goes
  // straight through `setEditingPresetId` — no state slot needed.
  const [presetContextMenu, setPresetContextMenu] = React.useState<{
    open: boolean;
    presetId: string | null;
    screenX: number;
    screenY: number;
  }>({ open: false, presetId: null, screenX: 0, screenY: 0 });

  // ── Preset Edit Mode (T4 / #198 entry-point).
  //
  // When non-null, MapView swaps its normal grid + right-rail layout
  // for the full-screen `PresetEditView` — a large 3D preview on the
  // left and a property editor on the right. The MapToolbar is hidden
  // in edit mode (the back / save buttons in PresetEditView's own
  // top bar are sufficient — no need for layer/tool controls while
  // editing a single preset).
  const [editingPresetId, setEditingPresetId] = React.useState<string | null>(
    null,
  );

  // ── Right-rail panel state (controlled CollapsibleSections so the
  //    user's open/close preferences survive selection changes).
  const [inspectorOpen, setInspectorOpen] = React.useState(true);
  const [sceneSettingsOpen, setSceneSettingsOpen] = React.useState(false);
  const [autoRotate, setAutoRotate] = useLocalStorage(
    "editor.cellPreview.autoRotate",
    true,
    (v): v is boolean => typeof v === "boolean",
  );
  // Cell-preview expand modal — overlays the centre Map pane with a
  // larger CellPreview so authors can inspect lighting + reflections.
  // The inline preview in the right rail stays mounted for continuity.
  const [cellPreviewExpanded, setCellPreviewExpanded] = React.useState(false);
  // Shared orbit-camera state across both CellPreview instances (inline
  // + expanded modal). Lives on a ref — not React state — so 60Hz
  // pointer-move updates don't trigger re-renders. Each preview's rAF
  // loop reads from this ref and pushes the camera to its own engine
  // instance; both end up in lockstep.
  const cellPreviewOrbitRef = React.useRef<CellPreviewOrbitState>(
    defaultCellPreviewOrbit(),
  );
  // Sketchfab-style settings panel state — lifted here so both
  // CellPreview instances (inline + modal) stay in lockstep. Per
  // user direction (#268): toggling layers / room-size / preset
  // overrides in one mirrors to the other.
  //
  // Persisted to localStorage via `useLocalStorage` (#XXX) so the
  // author's preview prefs survive page reload. Keys are scoped to
  // `editor.cellPreview.*` — editor-wide, not per-project, matching
  // the "tweak once, apply everywhere" feel of the right rail.
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
  // Default 7×7 — odd-sized so the focus cell at index floor(N/2) sits
  // exactly at the room's geometric centre, keeping the orbit camera
  // symmetric around the focus at every yaw (#272). The small inline
  // preview reads the focus cell legibly at this size; users can dial
  // up to 15 / 25 via the Room size SegmentedControl for full-room
  // context. Validated so a stale stored value outside [7, 15, 25]
  // (e.g. from a future SegmentedControl revision) falls back to 7.
  const [cellPreviewRoomSize, setCellPreviewRoomSize] = useLocalStorage(
    "editor.cellPreview.roomSize",
    7,
    (v): v is number =>
      typeof v === "number" && [7, 15, 25].includes(v),
  );
  // Preset-override ids: `string | null`. We deliberately do not
  // validate against the active pack here — if the stored id no
  // longer exists, CellPreview's resolver falls back to the cell's
  // own preset (existing behaviour for nulls).
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
  // Auto-rotate angular rate (revolutions-per-minute). Default 0.25 ≈
  // one full revolution every four minutes — slower than the previous
  // hard-coded 1 rev/8s so the camera doesn't whip past the focus
  // cell before the author can read it.
  const [cellPreviewRotateSpeed, setCellPreviewRotateSpeed] = useLocalStorage(
    "editor.cellPreview.rotateSpeed",
    0.25,
    (v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0,
  );

  // ESC closes the modal. The listener is only bound while the modal
  // is open so we don't intercept the key in normal editing.
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

  // #198 / T4 — Preset Edit Mode takes over the whole view, so the
  // cell-preview-expand modal must NOT linger behind / over it. Clear
  // the expanded flag the moment edit mode is entered.
  React.useEffect(() => {
    if (editingPresetId !== null) setCellPreviewExpanded(false);
  }, [editingPresetId]);

  // ── #260 — Baked-lightmap source for CellPreview ─────────────────
  // Decode the active scene's `lightmap` blob once (memoised on the
  // raw JSON identity) so the preview reads the same bake the engine
  // does. Selection-cell coords flow through `lightmapSource` so the
  // engine's slice origin tracks the user's clicks without re-decoding.
  const decodedSceneLightmap = React.useMemo<SceneLightmap | null>(() => {
    const raw = editScene?.lightmap;
    if (!raw || typeof raw !== "object") return null;
    try {
      return decodeLightmap(raw as SceneLightmapJSON);
    } catch (err) {
      // Bake corruption shouldn't break the preview — log + fall
      // back to dynamic-only lighting.
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

  // ── StatusBar wiring — push cell coords / entity count / preset name
  //    whenever selection changes. The cleanup clears the bar on
  //    unmount.
  const { setSections } = useStatusBar();
  React.useEffect(() => {
    const coords =
      selection?.selected ??
      selection?.hover ??
      null;
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

  // ── EditorActions — register `save` so the TopBar's Save button
  //    persists the in-memory scene. WIRING: `onPersistScene` is
  //    ProjectView's debounced persistScene helper.
  //
  //    R4h also wires `playtestStart` / `playtestStop` / `rerun`:
  //
  //    - playtest INACTIVE → expose `playtestStart` only. The shell's
  //      `handleTogglePlaytest` calls `playtestStop` first, falling
  //      back to `playtestStart` (see `EditorShell.tsx`), so this
  //      means "click TopBar Playtest → enter Playtest mode".
  //    - playtest ACTIVE → expose `playtestStop` + `rerun`. Click
  //      TopBar Playtest = exit. Click Rerun (inside the overlay) =
  //      send `{type:"reset"}` to the iframe.
  //
  //    On enter: persist any pending edits, ask the iframe to reread
  //    the (now-saved) scene from IDB so the engine boots on the
  //    fresh bytes, then resume the engine + flip viewport mode →
  //    "play" so the iframe becomes visible.
  //
  //    On exit: flip viewport mode → "edit" so the canvas + brush
  //    pane comes back. `EditorViewport` already posts `{type:"pause"}`
  //    on the play→edit transition; that single side-effect is what
  //    we want here too.
  const { register } = useEditorActions();
  // The iframe ref is plumbed in from ProjectView (used by Settings
  // modal's "Reload running game"). We reuse it for `{type:"reset"}`
  // postMessage on Rerun.
  const rerunIframe = React.useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage({ type: "reset" }, "*");
  }, [iframeRef]);
  const startPlaytest = React.useCallback(async () => {
    try {
      await onPersistScene();
    } catch (err) {
      // eslint-disable-next-line no-console
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
    // Clear cached stats so the overlay shows fresh values on next
    // entry (otherwise the first frame after re-entering shows the
    // stale snapshot until the iframe's next 10Hz push lands).
    setLatestStats(null);
    iframeRef.current?.contentWindow?.postMessage({ type: "pause" }, "*");
    onModeChange("edit");
  }, [iframeRef, onModeChange]);
  React.useEffect(() => {
    return register({
      save: async () => {
        await onPersistScene();
      },
      // Stack registration: only expose ONE of start/stop at a time so
      // the shell's toggle picks the right one without needing extra
      // state in EditorActions.
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

  // ESC closes Playtest mode. Bind only while active so we don't
  // intercept the key during normal editing (GridEditor's own ESC
  // bindings clear the active brush, etc.).
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

  // ── #254 — context-menu close + action handlers.
  //
  // Close just flips `open` to false. We keep `payload` around so the
  // close animation (if any future polish lands) doesn't see a null
  // payload mid-fade.
  const closeContextMenu = React.useCallback(() => {
    setContextMenu((s) => ({ open: false, payload: s.payload }));
  }, []);

  // ── Copy / Paste / Clear are the only end-to-end-wired actions in
  //    this dispatch. The rest log + carry a WIRING comment for the
  //    follow-up that lands real navigation / playtest / attribution.
  const handleCopyCell = React.useCallback(
    (x: number, y: number, layer: CellContextMenuLayer) => {
      // Read the cell's preset at the active layer. Lighting / entities
      // layers don't have a paint-grid preset; we snapshot `null` so
      // Paste on those layers is a no-op (the menu disables Paste when
      // clipboard is null, and after pasting null the snapshot becomes
      // stale anyway).
      const presetId = readCellPreset(editScene, layer, x, y);
      setClipboard({ layer, presetId });
    },
    [editScene],
  );

  const handlePasteCell = React.useCallback(
    (x: number, y: number, layer: CellContextMenuLayer) => {
      if (!editScene || !clipboard) return;
      // Only paint-grid layers support cell paste (walls / floors /
      // ceiling). Pasting onto lighting / entities is a no-op for now;
      // future work could paste light defaults / prefab references
      // here.
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

  // ── Stubbed actions. Each one logs + carries a WIRING comment so
  //    the follow-up implementing it is one-grep away.
  const handleEditParentPreset = React.useCallback((presetId: string) => {
    // #198 / T4 — enters Preset Edit Mode. The PresetEditView replaces
    // the normal Map layout until the user clicks Back / Cancel / Save.
    setEditingPresetId(presetId);
  }, []);

  const handleSelectAllWithPreset = React.useCallback((presetId: string) => {
    // WIRING: future canvas-side highlight of every cell on the active
    // layer that resolves to `presetId`. Needs GridEditor to expose a
    // "highlight set" prop — left for the follow-up dispatch.
    // eslint-disable-next-line no-console
    console.log(
      "[MapView] would highlight all cells with preset",
      presetId,
    );
  }, []);

  const handleJumpToPlaytestHere = React.useCallback(
    (x: number, y: number) => {
      // WIRING: requires an EDITOR_IFRAME `teleport-player` message
      // protocol (not yet defined — see EDITOR_IFRAME.md §6). The menu
      // already disables this row when the cell is a solid wall, so by
      // the time we ship the protocol we only need to hand it the (x, y)
      // we've already captured.
      // eslint-disable-next-line no-console
      console.log("[MapView] would jump-to-playtest at", { x, y });
    },
    [],
  );

  const handleShowPackChainAttribution = React.useCallback(
    (presetId: string) => {
      // WIRING: future small modal showing which pack supplied this
      // preset (pack chain id + source path). Needs the pack-resolver
      // to expose per-preset provenance — see PACK_CHAIN.md.
      // eslint-disable-next-line no-console
      console.log("[MapView] would show attribution for", presetId);
    },
    [],
  );

  // ── #284 — palette context-menu state + actions.
  //
  // Usage count for the right-clicked preset, scoped to the CURRENT
  // SCENE only (cross-scene scan flagged as a WIRING follow-up). We
  // walk `editScene.idMap` for the numeric id mapped to the preset
  // then count grid cells referencing that id across walls / floors /
  // ceiling. `layerDefaults.floor` / `layerDefaults.ceiling` count
  // every empty cell on those layers as a user (matches engine semantics).
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
      const grids: Array<{ grid: ReadonlyArray<ReadonlyArray<number>>; layer: "walls" | "floors" | "ceiling" }> = [
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
              // Empty cell on floors / ceiling resolves to the layer
              // default — count those toward whichever preset is the
              // default.
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

  // Look up the source-path that a preset id lives in. Pulled off the
  // `selection.presetOptions` catalogue (built by GridEditor's
  // resolver iteration). Returns null when the preset is unknown or
  // the active selection hasn't populated yet — both cases bail the
  // Duplicate / Delete flows with a console warning.
  const sourcePathForPreset = React.useCallback(
    (presetId: string): string | null => {
      const opt = selection?.presetOptions.find((p) => p.id === presetId);
      return opt?.sourcePath ?? null;
    },
    [selection],
  );

  // Strip JSONC line + block comments. Same minimal logic
  // PresetEditView uses for JSONC reads — duplicated here so the two
  // flows stay decoupled (a future consolidation can lift this into
  // `lib/jsonc.ts`).
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
        // eslint-disable-next-line no-console
        console.warn(
          "[MapView] cannot duplicate preset — no sourcePath for",
          presetId,
        );
        return;
      }
      try {
        const raw = await EditorProjectStore.loadAsset(projectId, sourcePath);
        if (typeof raw !== "string") {
          // eslint-disable-next-line no-console
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
          // eslint-disable-next-line no-console
          console.warn(
            "[MapView] cannot duplicate — preset key missing from",
            sourcePath,
          );
          return;
        }
        const existingIds = Object.keys(parsed);
        const newId = autoNamePreset(presetId, existingIds);
        // Deep clone the source entry so the new key is fully detached.
        const sourceEntry = parsed[presetId];
        parsed[newId] = JSON.parse(JSON.stringify(sourceEntry)) as unknown;
        const nextText = JSON.stringify(parsed, null, 2);
        await EditorProjectStore.saveAsset(projectId, sourcePath, nextText);
        // WIRING — the new preset shows up in the palette after the
        // resolver re-fires (driven by GridEditor's IdbAssetPack
        // change-listener). No project reload required.
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[MapView] duplicate preset failed —", err);
      }
    },
    [projectId, sourcePathForPreset, stripJsonComments],
  );

  const handleDeletePreset = React.useCallback(
    async (presetId: string) => {
      const sourcePath = sourcePathForPreset(presetId);
      if (!sourcePath) {
        // eslint-disable-next-line no-console
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
          // eslint-disable-next-line no-console
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
          // eslint-disable-next-line no-console
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
        // eslint-disable-next-line no-console
        console.error("[MapView] delete preset failed —", err);
      }
    },
    [projectId, sourcePathForPreset, stripJsonComments],
  );

  // ── Preset Edit Mode early-exit ──────────────────────────────────
  // When `editingPresetId` is set, swap the entire Map layout for
  // PresetEditView. We pull the resolved preset data straight off the
  // latest `selection` snapshot if the ids match — the context-menu
  // path always picks a preset from the currently-hovered cell, and
  // the Cell Inspector "Edit preset" button is gated on the same
  // selection. WIRING: if a future entry point opens edit mode for a
  // preset NOT in the active selection (e.g. a Tile Presets browser),
  // we'll need to plumb a resolver lookup here.
  if (editingPresetId !== null) {
    // Resolve the edit-target preset's data from the selection. We
    // accept either the active-layer preset OR the floor / ceiling
    // preset on the selected cell (the context menu can target any of
    // them via the §3 submenu structure).
    let presetDataForEdit: import("@two_5_d/engine").ResolvedPresetData | null =
      null;
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
      // Look up the source-path hint from the preset catalogue so the
      // save flow knows which JSONC to write back to.
      const opt = selection.presetOptions.find(
        (p) => p.id === editingPresetId,
      );
      if (opt) sourcePathForEdit = opt.sourcePath;
    }

    if (!presetDataForEdit) {
      // Defensive: edit mode was triggered but we don't have data.
      // Drop back to the map rather than crashing.
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
          // WIRING: the JSONC write is owned by PresetEditView. The
          // pack's preset cache lives in CellPreview's IdbAssetPack +
          // GridEditor's resolver; both re-resolve when their inputs
          // change. A follow-up should bump a project-wide "preset
          // rev" so other open views invalidate their caches without
          // a project reload.
        }}
        onCancel={() => setEditingPresetId(null)}
        onExit={() => setEditingPresetId(null)}
      />
    );
  }

  return (
    <div
      className={
        // §6.5 shell-body grammar — Scene tab is a 3-rail layout:
        // LEFT (Scene picker + Tile preset palette + anonymous toggle)
        // · CENTER (canvas + inner toolbar / MapToolbar) · RIGHT (Cell
        // Preview + Cell Inspector).
        //
        // Rail widths are sourced from the editor design tokens
        // (`--rail-left`, `--rail-right`) declared in index.css §5.
        // `gap-section` is the §5 `--gap-section` rhythm token — the
        // outer grid uses it so the inter-column gutter matches the
        // intra-rail vertical rhythm.
        //
        // Playtest mode collapses the side rails so the iframe owns the
        // full body. Both rails stay MOUNTED but `hidden`, which keeps
        // CellPreview's WebGL context (and the palette's resolver/IDB
        // cache) alive across the Edit ↔ Playtest round-trip.
        playtestActive
          ? "relative grid h-full grid-cols-[1fr] min-h-0 bg-[var(--color-bg-app)]"
          : "relative grid h-full grid-cols-[var(--rail-left)_1fr_var(--rail-right)] gap-section min-h-0 bg-[var(--color-bg-app)] p-[var(--gap-section)]"
      }
    >
      {/* LEFT rail — per §7.2: Scene picker (top) → Tile preset palette
          → anonymous-preset toggle (within MapPalette). Composed via
          R2 primitives (PanelHeader, CollapsibleSection, ScrollArea
          inside MapPalette, ToggleSwitch inside MapPalette) so the
          rail visually matches the rest of the editor's shell. */}
      <aside
        className="panel-surface flex flex-col gap-section min-h-0 rounded-card overflow-hidden"
        hidden={playtestActive}
      >
        {/* Scene-picker section — read-only summary of the active scene
            (the TopBar dropdown is the canonical switcher per §6.2). */}
        <CollapsibleSection title="Scene" defaultOpen>
          <div className="text-[11px] text-zinc-400">
            {scenePath ? (
              <span
                className="font-mono text-zinc-300 break-all"
                title={scenePath}
              >
                {scenePath.replace(/^scenes\//, "")}
              </span>
            ) : (
              <span className="text-zinc-500">No scene loaded</span>
            )}
          </div>
        </CollapsibleSection>

        {/* Tile preset palette — hoisted out of GridEditor into its own
            component so the left rail honours the §6.5 three-rail
            grammar. MapPalette owns the PanelHeader("Tile Presets") +
            filter input + ToggleSwitch (show-anonymous) + ScrollArea
            internally. */}
        <div className="flex-1 min-h-0 flex flex-col card-surface overflow-hidden">
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

      {/* CENTER pane — canvas (via EditorViewport). GridEditor's
          internal left palette + right inspector are hidden via the
          new `hidePalette` / `hideInspector` props so this column
          carries only the canvas + its inner toolbar (Bake / size /
          zoom + MapToolbar). Per §6.5 the centre uses `flex flex-col
          gap-section min-h-0`. */}
      <main className="panel-surface relative flex flex-col gap-section min-h-0 rounded-card overflow-hidden">
        {/* #246 — two-row Map toolbar (Layers + Tools). Sits below the
            shell PrimaryTabs and above the EditorViewport. Owns the
            active layer + tool state is forwarded into the
            GridEditor (via EditorViewport) so the canvas + toolbar
            stay in lockstep.

            #280 — MapToolbar is passed as a `toolbarSlot` prop into
            GridEditor's inner toolbar (the row that already houses
            the Bake Lighting button + zoom controls). This places
            the Layer + Tool segmented controls above the CANVAS
            ONLY, not above the left palette aside. */}
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
            // R4b — receive selection snapshots from the GridEditor
            // inside EditorViewport. We bubble it through a ref-style
            // prop drilled down via EditorViewport (added below).
            onMapSelectionChange={setSelection}
            // R4h — engine telemetry forwarded into the PlaytestOverlay
            // (see below). We only stash the snapshot while Playtest
            // mode is active so the 10Hz push doesn't trigger
            // re-renders during normal editing.
            onEngineStats={
              playtestActive ? setLatestStats : undefined
            }
            // #246 — forward layer / tool / activePreset to the
            // GridEditor so it stays in lockstep with the new
            // MapToolbar. The cast widens the toolbar's MapLayer
            // (walls / floors / ceiling / lighting / entities) into
            // the GridEditor's LayerName superset — same string
            // unions, just declared in two modules.
            gridLayer={mapLayer satisfies MapLayer as MapSelectionInfo["layer"]}
            onGridLayerChange={(next) => {
              // GridEditor's LayerName matches MapLayer 1:1 right
              // now; the cast is here so a future divergence (e.g.
              // GridEditor adds a debug-only layer) doesn't silently
              // break the toolbar.
              setMapLayer(next as MapLayer);
            }}
            gridTool={mapTool satisfies MapTool as EditorTool}
            onGridToolChange={(next) => {
              // GridEditor's EditorTool includes the legacy
              // `entity` / `light` values; if a keyboard shortcut
              // fires one of those, narrow to the closest MapTool
              // (`paint`) so the toolbar stays sensible.
              setMapTool(toMapTool(next));
            }}
            activePresetId={activePresetId}
            onActivePresetChange={setActivePresetId}
            // Anon-preset palette visibility — see `showAnonymousPresets`
            // state at the top of MapView. Threaded down so GridEditor's
            // palette list AND its `presetOptions` snapshot both respect
            // the toggle.
            showAnonymousPresets={showAnonymousPresets}
            onShowAnonymousPresetsChange={setShowAnonymousPresets}
            // #254 — Select-tool right-click opens the cell context
            // menu, which we render below.
            onCellContextMenu={(payload) =>
              setContextMenu({ open: true, payload })
            }
            // #284 — palette double-click = enter PresetEditView
            // (same path as the cell context menu's "Edit parent
            // preset"). Palette right-click = open PresetContextMenu.
            onEditPreset={(id) => setEditingPresetId(id)}
            onPresetContextMenu={(id, x, y) =>
              setPresetContextMenu({
                open: true,
                presetId: id,
                screenX: x,
                screenY: y,
              })
            }
            // §7.2 — palette + inspector live in MapView's outer rails,
            // not GridEditor's internal asides.
            hidePalette
            hideInspector
          />
        </div>

        {/* Expanded CellPreview modal — scoped to the centre pane
            (absolute inset-0 on this relative wrapper) rather than
            the full viewport. The right rail's inline preview stays
            visible + interactive. We used a custom fixed-position
            overlay rather than the R2 `Modal` primitive because that
            primitive (a) wraps content in a Card with a max-w-md cap
            and (b) covers the full viewport — neither fits the
            "huge canvas overlaying the grid" requirement. */}
        {cellPreviewExpanded ? (
          <div
            className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={() => setCellPreviewExpanded(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Expanded cell preview"
          >
            <div onClick={(e) => e.stopPropagation()}>
              <CellPreview
                projectId={projectId}
                presetId={selection?.selectedPresetId ?? null}
                presetData={selection?.selectedPresetData ?? null}
                textureUrl={selection?.selectedPresetTextureUrl ?? null}
                layer={cellPreviewLayer(selection?.layer)}
                autoRotate={autoRotate}
                onAutoRotateChange={setAutoRotate}
                floorPresetId={selection?.floorPresetId ?? null}
                floorPresetData={selection?.floorPresetData ?? null}
                floorTextureUrl={selection?.floorPresetTextureUrl ?? null}
                ceilingPresetId={selection?.ceilingPresetId ?? null}
                ceilingPresetData={selection?.ceilingPresetData ?? null}
                ceilingTextureUrl={
                  selection?.ceilingPresetTextureUrl ?? null
                }
                expanded
                onToggleExpanded={() => setCellPreviewExpanded(false)}
                onClose={() => setCellPreviewExpanded(false)}
                sharedOrbitRef={cellPreviewOrbitRef}
                showWalls={cellPreviewShowWalls}
                setShowWalls={setCellPreviewShowWalls}
                showFloors={cellPreviewShowFloors}
                setShowFloors={setCellPreviewShowFloors}
                showCeilings={cellPreviewShowCeilings}
                setShowCeilings={setCellPreviewShowCeilings}
                roomSize={cellPreviewRoomSize}
                setRoomSize={setCellPreviewRoomSize}
                floorPresetOverride={cellPreviewFloorOverride}
                setFloorPresetOverride={setCellPreviewFloorOverride}
                ceilingPresetOverride={cellPreviewCeilingOverride}
                setCeilingPresetOverride={setCellPreviewCeilingOverride}
                wallPresetOverride={cellPreviewWallOverride}
                setWallPresetOverride={setCellPreviewWallOverride}
                autoRotateSpeed={cellPreviewRotateSpeed}
                setAutoRotateSpeed={setCellPreviewRotateSpeed}
                presetOptions={selection?.presetOptions ?? []}
                lightmapSource={cellPreviewLightmapSource}
              />
            </div>
          </div>
        ) : null}
      </main>

      {/* RIGHT rail — per §7.2: Cell Preview (3D, top) + Cell Inspector
          (bottom). Both sections live inside R2 CollapsibleSection
          primitives so the user can fold panels they don't need.
          Hidden (but kept mounted) while Playtest mode is active so the
          iframe gets the full centre + right area; CellPreview keeps
          its WebGL context alive across the round-trip. */}
      <aside
        className="panel-surface flex flex-col gap-section min-h-0 rounded-card overflow-hidden"
        hidden={playtestActive}
      >
        <ScrollArea fade={false} className="h-full">
          <div className="p-[var(--gap-panel)] flex flex-col gap-section">
            {/* ── Cell Preview ──────────────────────────────────── */}
            <CollapsibleSection
              title="Cell Preview"
              defaultOpen
              trailing={
                <Badge variant="emerald" outlined>
                  LIVE
                </Badge>
              }
            >
              {/* Auto-rotate moved into the new settings panel's Camera
                  section (#268) — consolidates all preview controls
                  under the Filter icon. */}
              <div className="-mx-3 -my-2">
                <CellPreview
                  projectId={projectId}
                  presetId={selection?.selectedPresetId ?? null}
                  presetData={selection?.selectedPresetData ?? null}
                  textureUrl={selection?.selectedPresetTextureUrl ?? null}
                  layer={cellPreviewLayer(selection?.layer)}
                  autoRotate={autoRotate}
                  onAutoRotateChange={setAutoRotate}
                  floorPresetId={selection?.floorPresetId ?? null}
                  floorPresetData={selection?.floorPresetData ?? null}
                  floorTextureUrl={selection?.floorPresetTextureUrl ?? null}
                  ceilingPresetId={selection?.ceilingPresetId ?? null}
                  ceilingPresetData={selection?.ceilingPresetData ?? null}
                  ceilingTextureUrl={
                    selection?.ceilingPresetTextureUrl ?? null
                  }
                  expanded={false}
                  onToggleExpanded={() =>
                    setCellPreviewExpanded((v) => !v)
                  }
                  sharedOrbitRef={cellPreviewOrbitRef}
                  showWalls={cellPreviewShowWalls}
                  setShowWalls={setCellPreviewShowWalls}
                  showFloors={cellPreviewShowFloors}
                  setShowFloors={setCellPreviewShowFloors}
                  showCeilings={cellPreviewShowCeilings}
                  setShowCeilings={setCellPreviewShowCeilings}
                  roomSize={cellPreviewRoomSize}
                  setRoomSize={setCellPreviewRoomSize}
                  floorPresetOverride={cellPreviewFloorOverride}
                  setFloorPresetOverride={setCellPreviewFloorOverride}
                  ceilingPresetOverride={cellPreviewCeilingOverride}
                  setCeilingPresetOverride={setCellPreviewCeilingOverride}
                  wallPresetOverride={cellPreviewWallOverride}
                  setWallPresetOverride={setCellPreviewWallOverride}
                  autoRotateSpeed={cellPreviewRotateSpeed}
                  setAutoRotateSpeed={setCellPreviewRotateSpeed}
                  presetOptions={selection?.presetOptions ?? []}
                  lightmapSource={cellPreviewLightmapSource}
                />
              </div>
            </CollapsibleSection>

            {/* ── Cell Inspector card ──────────────────────────── */}
            <CollapsibleSection
              title="Cell Inspector"
              open={inspectorOpen}
              onOpenChange={setInspectorOpen}
              trailing={
                <IconButton
                  size="sm"
                  variant="ghost"
                  tooltip="Cell actions"
                  icon={<MoreVertical size={14} />}
                  // WIRING: kebab menu — populated in R5 polish.
                  onClick={() => undefined}
                />
              }
            >
              {selection?.selected ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <StatsBlock
                      label="X"
                      value={selection.selected.x}
                    />
                    <StatsBlock
                      label="Y"
                      value={selection.selected.y}
                    />
                    <StatsBlock
                      label="Z"
                      value={0}
                    />
                  </div>
                  <PropertyRow label="Layer">
                    <Select
                      size="sm"
                      value={selection.layer}
                      // WIRING: layer selection still lives inside
                      // GridEditor — drop this read-only until the
                      // full §7.2 split.
                      disabled
                      options={[
                        { value: "walls", label: "Walls" },
                        { value: "floors", label: "Floors" },
                        { value: "ceiling", label: "Ceilings" },
                      ]}
                      onChange={() => undefined}
                    />
                  </PropertyRow>
                  <PropertyRow label="Preset">
                    <span className="text-xs font-mono text-zinc-200 truncate">
                      {selection.selectedPresetId ?? "(empty)"}
                    </span>
                  </PropertyRow>
                  {/* T4 entry point — opens Preset Edit Mode for the
                      selected cell's active-layer preset. Disabled when
                      no preset is selected (empty cell). Acts as the
                      manual fallback while the context-menu route
                      (#254 / `onEditParentPreset`) is the canonical
                      surface. */}
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!selection.selectedPresetId}
                      onClick={() => {
                        if (selection.selectedPresetId) {
                          setEditingPresetId(selection.selectedPresetId);
                        }
                      }}
                      className="w-full"
                    >
                      <Pencil size={12} className="mr-1.5" />
                      Edit preset
                    </Button>
                  </div>
                  {/* R4b bonus — surface the floor + ceiling preset ids
                      assigned to this cell alongside the active-layer
                      preset, so the inspector reflects the full material
                      stack the CellPreview renders. */}
                  <PropertyRow label="Floor preset">
                    <span className="text-[11px] font-mono text-zinc-300 truncate">
                      {selection.floorPresetId ?? "(none)"}
                    </span>
                  </PropertyRow>
                  <PropertyRow label="Ceiling preset">
                    <span className="text-[11px] font-mono text-zinc-300 truncate">
                      {selection.ceilingPresetId ?? "(none)"}
                    </span>
                  </PropertyRow>
                  {selection.selectedPresetData ? (
                    <>
                      <PropertyRow label="Texture">
                        <span className="text-[11px] font-mono text-zinc-300 truncate">
                          {selection.selectedPresetData.texture}
                        </span>
                      </PropertyRow>
                      <PropertyRow label="Reflectiveness">
                        <span className="text-xs font-mono text-zinc-200">
                          {selection.selectedPresetData.reflectiveness.toFixed(
                            2,
                          )}
                        </span>
                      </PropertyRow>
                      <PropertyRow label="Solid">
                        <ToggleSwitch
                          aria-label="Solid collision"
                          size="sm"
                          checked={
                            selection.selectedPresetData.collision === "solid"
                          }
                          // Read-only summary for R4b — preset edits
                          // happen via the (future) Tile Presets surface.
                          disabled
                          onChange={() => undefined}
                        />
                      </PropertyRow>
                      {/* Wall vertical-extent rows. Shown only on the
                          walls layer and only when the preset deviates
                          from the engine defaults (`wallStartZ: 0`,
                          `wallHeight: 1` — see ResolvedPresetData in
                          packages/engine/src/AssetPack/PresetResolver.ts).
                          Surfaces the data the CellPreview reads so the
                          inspector + 3D view agree at a glance. */}
                      {selection.layer === "walls" &&
                      selection.selectedPresetData.wallHeight !== 1 ? (
                        <PropertyRow label="Wall height">
                          <span className="text-xs font-mono text-zinc-200">
                            {selection.selectedPresetData.wallHeight.toFixed(2)}
                          </span>
                        </PropertyRow>
                      ) : null}
                      {selection.layer === "walls" &&
                      selection.selectedPresetData.wallStartZ !== 0 ? (
                        <PropertyRow label="Wall start Z">
                          <span className="text-xs font-mono text-zinc-200">
                            {selection.selectedPresetData.wallStartZ.toFixed(2)}
                          </span>
                        </PropertyRow>
                      ) : null}
                      {selection.selectedPresetData.partialWall ? (
                        <PropertyRow label="Partial wall">
                          <span className="text-[11px] font-mono text-zinc-300">
                            {selection.selectedPresetData.partialWall.face} ·{" "}
                            {(
                              selection.selectedPresetData.partialWall.widthU *
                              100
                            ).toFixed(0)}
                            %
                          </span>
                        </PropertyRow>
                      ) : null}
                      {selection.selectedPresetData.emissive ? (
                        <>
                          {/* Emissive surfaces both the color and the
                              intensity. The color is a small swatch +
                              hex readout (read-only — preset edits land
                              in the future Tile Presets surface, see
                              comment on the Solid toggle above); the
                              intensity stays as a separate row so it's
                              greppable + scannable.
                              The engine stores color as linear RGB
                              floats [0..1] (PresetEmissive in
                              PresetResolver.ts line 60); we convert to
                              sRGB 0..255 for the swatch + hex. */}
                          <PropertyRow label="Emissive color">
                            <EmissiveSwatch
                              color={selection.selectedPresetData.emissive.color}
                            />
                          </PropertyRow>
                          <PropertyRow label="Emissive intensity">
                            <span className="text-xs font-mono text-zinc-200">
                              {selection.selectedPresetData.emissive.intensity.toFixed(
                                2,
                              )}
                              <span className="text-zinc-500"> ×</span>
                            </span>
                          </PropertyRow>
                        </>
                      ) : null}
                      {selection.selectedPresetData.tags &&
                      selection.selectedPresetData.tags.length > 0 ? (
                        <div className="pt-1 flex flex-wrap gap-1">
                          {selection.selectedPresetData.tags.map((t) => (
                            <Badge key={t} variant="sky" outlined>
                              {t}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-zinc-500">
                  Left-click a cell in the grid to inspect it. The 3D
                  preview above re-renders live as you edit the cell's
                  preset.
                </p>
              )}
            </CollapsibleSection>

            {/* Scene list was removed in cleanup — the shell TopBar's
                scene dropdown is the canonical scene selector. */}

            {/* ── Scene settings (placeholder card — full impl R4f) ── */}
            <CollapsibleSection
              title="Scene Settings"
              open={sceneSettingsOpen}
              onOpenChange={setSceneSettingsOpen}
            >
              <p className="text-xs text-zinc-500">
                Ambient light, fog, brightness — surface lands once
                the engine exposes per-scene render config (currently
                only baked lightmaps + per-light controls inside
                GridEditor's light tool).
              </p>
            </CollapsibleSection>
          </div>
        </ScrollArea>
      </aside>

      {/* R4h — Playtest overlay. Full-takeover stats rail that sits
          on top of MapView's grid while playtest is active. The
          `<EditorViewport>` iframe above stays MOUNTED and visible —
          §12 Q1 of EDITOR_REDESIGN.md: state survives across Edit ↔
          Playtest. The overlay is `pointer-events-none` on its
          wrapper with the left rail re-enabling input on its own
          element, so the iframe behind keeps receiving input. */}
      {playtestActive ? (
        <PlaytestOverlay
          engineStats={latestStats}
          onRerun={rerunIframe}
          onExit={stopPlaytest}
        />
      ) : null}

      {/* #254 — anchored right-click context menu. Renders into a
          body-level portal (handled by the component) so the floating
          panel escapes MapView's grid stacking context. The component
          is mounted unconditionally so its open/close transitions
          live alongside MapView's state — when `open` is false it
          short-circuits to `null` internally. */}
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

      {/* #284 — palette right-click context menu. Portal-rendered so
          it escapes the GridEditor aside's stacking context. The
          usage count is scoped to the CURRENT SCENE only — cross-scene
          scan is a WIRING follow-up (would need every scene's idMap +
          grids loaded into memory, currently only the active edit
          scene is loaded). */}
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

/* ─── #254 cell-paint helpers ──────────────────────────────────────
 *
 * Small inline helpers for the context-menu Copy / Paste / Clear flow.
 * These intentionally duplicate the same paint logic GridEditor uses
 * internally (`replaceLayer` + idMap allocation) so MapView doesn't
 * need to grow a back-channel through GridEditor's ref. The duplication
 * is contained — when the §7.2 GridEditor split lands and the paint
 * helpers move to a shared `lib/scene` module, both call sites collapse.
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
    // Mirror engine semantics for empty floor / ceiling cells.
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
  // Materialise rows on demand so sparse floor / ceiling grids end up
  // wall-shaped after a paste. Matches GridEditor.paintCell.
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
    if (currentValue === 0) return scene; // already empty
    const nextRow = [...targetRow];
    nextRow[x] = 0;
    rows[y] = nextRow;
    return assignLayer(scene, layer, rows);
  }

  // Reuse or allocate an idMap entry for the preset id.
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
  if (currentValue === id) return scene; // already this preset
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
  // Preserve whichever spelling the scene round-tripped in with.
  if (scene.ceilings !== undefined) return { ...scene, ceilings: rows };
  return { ...scene, ceiling: rows };
}

/**
 * Clamp the active Map layer (which now includes "lighting" / "entities"
 * per #246) to the paint-grid subset CellPreview understands. The 3D
 * preview always renders a room — the active-layer choice just picks
 * which surface the inspector highlights — so falling back to "walls"
 * on the non-paint layers keeps the preview meaningful while we wait
 * for follow-ups to surface lighting / entity previews properly.
 */
function cellPreviewLayer(
  layer: import("./GridEditor").MapSelectionInfo["layer"] | undefined,
): "walls" | "floors" | "ceiling" {
  if (layer === "floors" || layer === "ceiling") return layer;
  return "walls";
}

/**
 * Narrow the wider GridEditor `EditorTool` union (which includes the
 * legacy `entity` / `light` direct-place tools) down to the four-tool
 * MapTool set the toolbar exposes. Legacy values map to "paint" — they
 * still fire through GridEditor's pointer-down router when the active
 * layer is lighting / entities, so functionality is preserved.
 */
function toMapTool(
  next: import("./GridEditor").EditorTool,
): MapTool {
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

/**
 * Small read-only colour swatch + hex readout for the Cell Inspector's
 * Emissive row. Mirrors `ColorChip`'s visual language (zinc-700 border
 * on a zinc-950 card with the swatch + mono hex side-by-side), but is
 * pure read-only — no `<input type="color">` underneath. Edits will
 * land in the future Tile Presets surface (see Solid toggle comment).
 *
 * `color` is the engine's linear-RGB triple (`PresetEmissive.color` in
 * packages/engine/src/AssetPack/PresetResolver.ts line 60). We convert
 * to sRGB 0..255 with a γ=2.2 approximation — close enough for an
 * inspector chip, and what the Three.js MeshStandardMaterial.emissive
 * path effectively renders into the framebuffer.
 */
function EmissiveSwatch({
  color,
}: {
  color: readonly [number, number, number];
}) {
  const toByte = (c: number) => {
    const clamped = Math.max(0, Math.min(1, c));
    // γ=2.2 linear → sRGB. Approximation; matches what Three's
    // SRGBColorSpace conversion of the linear emissive value renders.
    const srgb = Math.pow(clamped, 1 / 2.2);
    return Math.round(srgb * 255);
  };
  const r = toByte(color[0]);
  const g = toByte(color[1]);
  const b = toByte(color[2]);
  const hex = `#${[r, g, b]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
  return (
    <span className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1">
      <span
        aria-hidden
        className="inline-block w-4 h-4 rounded-sm border border-zinc-700 shrink-0"
        style={{ background: `rgb(${r}, ${g}, ${b})` }}
      />
      <span className="text-[11px] font-mono uppercase text-zinc-200 select-text">
        {hex}
      </span>
    </span>
  );
}
