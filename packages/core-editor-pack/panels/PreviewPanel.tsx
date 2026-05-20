// P3 batch D-final migration. Moved from
// `apps/editor/src/views/scene/panels/PreviewPanel.tsx` into the
// core-editor-pack with no behavioural changes — only the import
// paths flipped to pack-local `scene-fixtures` and the shell-SDK
// externals. The WebGL graceful-degradation logic from the original
// commit (try/catch around `buildPreviewScene()` + the
// `PreviewErrorBoundary` class) rides along verbatim — both layers
// are necessary (effect errors aren't caught by error boundaries,
// boundary alone wouldn't catch the common context-acquisition
// failure path).
//
// State source: Wave 3.3 — `useSceneStore` (cells + dims +
// settings.ambient), `useLayerStore` (visibility + order),
// `useTilePresetRegistryStore` (per-preset color/texture metadata +
// `texturesEpoch` repaint driver), `useDiagnosticsStore` (Output /
// Problems surfacing of WebGL failures). All four are synced Wave-3
// stores with their own BroadcastChannel; bundling duplicates would
// isolate the preview from the painter.
//
// `buildPreviewScene` stays panel-local — it's a private THREE.js
// scene-graph constructor with no third-party-pack utility (a
// custom-preview pack would build its own scene chrome from
// scratch). `three` itself is bundled into the pack via Bun's
// workspace resolution (added to the pack's `dependencies`).
import React from "react";
import * as THREE from "three";
import {
  AlertTriangle,
  Box,
  Cuboid,
  Expand,
  Grid3x3,
  Maximize2,
  Plane,
  RotateCcw,
  Shield,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../apps/editor/src/components/dock/DockShell";
// Presentational primitives — safe to bundle (no singleton state).
// `Button` and `Tooltip` are pure presentational; `EmptyState` is
// SDK-routed because it transitively imports a binary asset
// (`logo.png`) the pack-builder can't resolve.
import { Button } from "../../../apps/editor/src/components/ui/Button";
import { Tooltip } from "../../../apps/editor/src/components/ui/Tooltip";
// Externalised — Wave-3 synced stores + `EmptyState` + the wrapped
// tile-texture cache + Modal/GAME_RUNNER_URL (task #17 — engine
// toggle + Expand modal). Modal is host-routed because its portal
// stacks above dockview's drop overlays at z-index 1000 — a bundled
// duplicate would render under the dock chrome. GAME_RUNNER_URL is
// resolved by the host based on the editor's deploy base (
// `/play/` in dev, `/cardboard/play/` under GitHub Pages) and can't
// be hard-coded in the pack.
import {
  EmptyState,
  GAME_RUNNER_URL,
  Modal,
  registerCommand,
  useDiagnosticsStore,
  useLayerStore,
  useSceneStore,
  useTilePresetRegistryStore,
  loadTileTexture,
  getTileTextureSync,
} from "@cardboard/editor-shell";
import { MOCK_LAYERS } from "./scene-fixtures";

/**
 * PreviewPanel — Three.js 3D preview of the current scene.
 *
 * Wave 3.3.13 wiring: geometry is derived from `useSceneStore.cells`,
 * filtered by `useLayerStore.visibility`, and stacked per `useLayerStore.order`.
 * Each painted cell becomes a `BoxGeometry(1, height, 1)` cube; the cell
 * `(x, y)` maps to world `(x, *, y)` (Y is up in Three.js — the cell-grid
 * Y axis is the floor-plane SECOND axis, i.e. Three's Z). Scene-wide
 * ambient comes from `useSceneStore.settings.ambient`.
 *
 * Interaction:
 *   - Left-mouse drag inside the canvas orbits the camera (manual
 *     yaw/pitch — we avoid `OrbitControls` from `three/examples/jsm`
 *     since that pulls jsm into the bundle config).
 *   - Wheel zooms by adjusting the orbital radius.
 *   - Overlay toolbar (top-right) exposes reset / zoom / grid /
 *     wireframe, every action is mirrored as a `scene.preview.*`
 *     command so the palette + keybindings can drive it too.
 *
 * Persistence (per-page localStorage):
 *   - `cardboard.scene.preview.camDistance` (number, auto-fit on first mount)
 *   - `cardboard.scene.preview.camYaw`      (number, default π/5)
 *   - `cardboard.scene.preview.camPitch`    (number, default π/5)
 *
 * Writes are debounced behind `mouseup` / `wheelend` so the panel
 * doesn't thrash localStorage every animation frame.
 *
 * Responsive contract:
 *   - The canvas fills `100% × 100%`; aspect + renderer size are
 *     refreshed on every `ResizeObserver` callback.
 *   - Below ~130px in either dimension we render an `EmptyState`-style
 *     "Too small" message instead of mounting Three (degenerate aspect
 *     ratios crash internal projection math).
 *   - Overlay toolbar auto-hides below ~140px width — at that size
 *     the canvas alone is enough. Default panel width (~181px) shows
 *     the toolbar out of the box.
 */

// ---------------------------------------------------------------------------
// localStorage helpers — same shape as ToolPalettePanel / sibling panels.
// ---------------------------------------------------------------------------

const LS_CAM_DISTANCE = "cardboard.scene.preview.camDistance";
const LS_CAM_YAW = "cardboard.scene.preview.camYaw";
const LS_CAM_PITCH = "cardboard.scene.preview.camPitch";

// Default distance is a sentinel — `null` means "auto-fit on first
// mount from dims". Once the user interacts (drag/zoom/reset) we
// persist a concrete number under LS_CAM_DISTANCE and that wins.
const DEFAULT_YAW = Math.PI / 5;
// Positive pitch = camera elevation above target. ~36° tilts the
// camera down enough to put the floor in frame while still letting
// depth read on a flat grid.
const DEFAULT_PITCH = Math.PI / 5;

const MIN_DISTANCE = 2;
const MAX_DISTANCE = 250;
const ZOOM_STEP = 0.75;
// Clamp pitch so the camera never flips through poles.
const MIN_PITCH = -Math.PI / 2 + 0.05;
const MAX_PITCH = Math.PI / 2 - 0.05;

// Below either dimension we bail to the EmptyState fallback. The 130
// floor leaves a touch of headroom for PanelSurface padding so the
// canvas isn't squeezed to a degenerate aspect at the boundary.
const MIN_CANVAS_DIM = 130;
// Below this width we hide the overlay toolbar. The default panel
// width is ~181px, so we keep this comfortably below that so the
// toolbar is visible out of the box.
const MIN_TOOLBAR_WIDTH = 140;

function readLSNumber(key: string, fallback: number): number {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function readLSNumberOrNull(key: string): number | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(key);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLSNumber(key: string, value: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

/**
 * Compute the auto-fit camera distance for a given grid size.
 * A 64×64 grid wants the camera ~50 units back so the whole grid is
 * in frame; a small grid wants something closer. The 0.8 multiplier
 * was tuned to leave a little headroom around the grid edges.
 */
function autoFitDistance(w: number, h: number): number {
  return clampDistance(Math.max(w, h) * 0.8);
}

// ---------------------------------------------------------------------------
// Layer color helper — falls back to MOCK_LAYERS for built-ins.
// ---------------------------------------------------------------------------

const LAYER_COLOR_FALLBACK: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const l of MOCK_LAYERS) {
    out[l.id] = hexStringToNumber(l.color);
  }
  return out;
})();

const DEFAULT_LAYER_COLOR = 0xb88a4a; // warm wood/amber tone — matches old corridor

function hexStringToNumber(s: string): number {
  // Accept `#RRGGBB` only — fall back to the warm wood color on parse fail.
  const m = /^#([0-9a-f]{6})$/i.exec(s);
  if (!m) return DEFAULT_LAYER_COLOR;
  const hex = m[1];
  if (!hex) return DEFAULT_LAYER_COLOR;
  return Number.parseInt(hex, 16);
}

function colorForLayer(layerId: string): number {
  return LAYER_COLOR_FALLBACK[layerId] ?? DEFAULT_LAYER_COLOR;
}

// ---------------------------------------------------------------------------
// Three.js scene builder — produces a disposable handle the React layer
// can mount / unmount. Geometry rebuilds live OUTSIDE this function: it
// only sets up the chrome (camera, lights, renderer, floor + grid
// containers) and exposes a `sceneGroup` for cell meshes to attach to.
// ---------------------------------------------------------------------------

interface PreviewSceneHandle {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  grid: THREE.GridHelper;
  ambient: THREE.AmbientLight;
  /** Container group for store-derived cell meshes. Rebuilt on
   *  `cells`/`visibility`/`order` change. */
  sceneGroup: THREE.Group;
  /** Container group for the floor plane. Rebuilt on `dims` change so
   *  the floor stays sized to the level. */
  floorGroup: THREE.Group;
  /** Material pool keyed by `${layerId}:${presetId}`. Shared across
   *  rebuilds so we don't churn GPU resources on every paint. */
  materialPool: Map<string, THREE.MeshStandardMaterial>;
  dispose: () => void;
}

function buildPreviewScene(): PreviewSceneHandle {
  const scene = new THREE.Scene();
  // Warm dungeon-dark background. Matches MapCanvasPanel's playfield
  // tone so the preview reads as part of the same room.
  scene.background = new THREE.Color(0x1a1814);

  // --- Container groups --------------------------------------------------
  const sceneGroup = new THREE.Group();
  scene.add(sceneGroup);
  const floorGroup = new THREE.Group();
  scene.add(floorGroup);

  // --- Lights ------------------------------------------------------------
  // Ambient intensity is overwritten from `settings.ambient` in an effect;
  // 0.45 here is a sensible default for the first render before the
  // store-driven sync hook fires.
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);
  // Cool overhead-ish key light, slight blue tinge to balance the warm fill.
  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(4, 6, 3);
  scene.add(dir);
  // Warm torchlight-like fill from the front-left, low altitude.
  const warmFill = new THREE.DirectionalLight(0xfbbf24, 0.35);
  warmFill.position.set(-3, 1.5, 4);
  scene.add(warmFill);

  // --- Grid (hidden by default; toggled via command) ---------------------
  // Sized at construction; rebuilt by the dims effect when level
  // dimensions change.
  const grid = new THREE.GridHelper(20, 20, 0x666b78, 0x3a3f4b);
  grid.position.y = 0.001; // avoid z-fighting with the floor plane
  grid.visible = false;
  scene.add(grid);

  // --- Renderer + camera -------------------------------------------------
  // Start with placeholder size — caller will call setSize on mount via
  // ResizeObserver, but Three wants something positive at construction
  // time to allocate the WebGL buffer.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(
    typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio, 2),
  );
  renderer.setSize(256, 256, false);

  // Far plane bumped to comfortably contain a 64×64 grid at ~50 units back.
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
  camera.position.set(0, 2, 5);
  camera.lookAt(0, 0.75, 0);

  const materialPool = new Map<string, THREE.MeshStandardMaterial>();

  const dispose = (): void => {
    renderer.dispose();
    // Walk the tree for geometry (geometry is per-mesh — pooled meshes
    // still hold their own geometry). Materials live in the pool, so we
    // dispose them once via the pool below.
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
      } else if (obj instanceof THREE.GridHelper) {
        obj.geometry.dispose();
        const mat = obj.material as THREE.Material | THREE.Material[];
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) m.dispose();
      }
    });
    for (const m of materialPool.values()) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    materialPool.clear();
  };

  return {
    scene,
    renderer,
    camera,
    grid,
    ambient,
    sceneGroup,
    floorGroup,
    materialPool,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

/**
 * Inner component — the actual Three.js host. Wrapped by
 * `PreviewPanel` below in a class-based error boundary so any
 * synchronous render error from React-land (e.g. a descendant
 * component crashing during a state update) drops the user into the
 * same WebGL-offline fallback instead of crashing the editor.
 *
 * Errors thrown inside `useEffect` (the more common WebGL-context
 * acquisition path) are caught by the local try/catch in the mount
 * effect and surfaced via `setWebglError`. Error boundaries do NOT
 * catch effect errors — we need both layers.
 */
function PreviewPanelInner(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasHostRef = React.useRef<HTMLDivElement | null>(null);
  const handleRef = React.useRef<PreviewSceneHandle | null>(null);
  const rafRef = React.useRef<number | null>(null);

  // --- Store subscriptions ----------------------------------------------
  // Wave 3.3.13: everything geometry-related comes from the scene store;
  // visibility + order come from the layer store. We do NOT subscribe
  // to `useTilePresetStore` — material color is derived from layerId
  // (with `${layerId}:${presetId}` keying the material pool, which still
  // lets future per-preset tints land without touching this subscription
  // surface).
  const dims = useSceneStore((s) => s.dims);
  const cells = useSceneStore((s) => s.cells);
  const settings = useSceneStore((s) => s.settings);
  const visibility = useLayerStore((s) => s.visibility);
  const order = useLayerStore((s) => s.order);
  // Per-preset color registry. Box materials are keyed by preset id +
  // colored from the registry so two presets on the same layer tint
  // distinguishably; layer color is the fallback for unknown ids.
  const presetRegistry = useTilePresetRegistryStore((s) => s.presets);
  // Bumped when a tile texture bitmap finishes loading. Drives the
  // cell-mesh rebuild effect so materials swap from color-only to
  // `{ map }` the moment a bitmap is in the cache.
  const texturesEpoch = useTilePresetRegistryStore((s) => s.texturesEpoch);
  const projectId = React.useMemo(() => {
    try {
      return typeof window !== "undefined"
        ? window.localStorage.getItem("editor.currentProjectId")
        : null;
    } catch {
      return null;
    }
  }, []);

  // Container-size state drives the "Too small" + "Hide toolbar" toggles.
  // We track it in React state so render-paths can react to it; the
  // canvas itself is sized via direct Three calls inside the
  // ResizeObserver callback (cheaper than going through React).
  const [size, setSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // --- Camera orbital state (lives in refs — no React rerenders per frame).
  // Distance has a `null` sentinel meaning "auto-fit from dims on first
  // mount"; once the user reset/zoom/dragged we persist a concrete number.
  const distanceRef = React.useRef<number>(
    clampDistance(
      readLSNumberOrNull(LS_CAM_DISTANCE) ?? autoFitDistance(dims.w, dims.h),
    ),
  );
  const yawRef = React.useRef<number>(readLSNumber(LS_CAM_YAW, DEFAULT_YAW));
  const pitchRef = React.useRef<number>(
    clampPitch(readLSNumber(LS_CAM_PITCH, DEFAULT_PITCH)),
  );

  // Grid + wireframe display flags — also in refs because we toggle from
  // command handlers; React doesn't need to re-render to show the change
  // (the next animation frame surfaces it).
  const gridVisibleRef = React.useRef<boolean>(false);
  const wireframeRef = React.useRef<boolean>(false);

  // Force-rerender ticker — used by command handlers when the active
  // mode toggles, so toolbar buttons can light up correctly. Optional.
  const [, forceRerender] = React.useReducer((x: number) => x + 1, 0);

  // ----- WebGL crash state -------------------------------------------
  // When `buildPreviewScene()` (or any downstream Three.js call during
  // mount) throws — most commonly because the browser can't supply a
  // WebGL context (headless Chromium without GPU, browsers with WebGL
  // disabled, etc.) — we drop into a fallback UI instead of letting the
  // exception bubble up and unmount the whole DocksModal. `retryNonce`
  // bumps on retry to re-trigger the mount effect with a fresh attempt.
  const [webglError, setWebglError] = React.useState<string | null>(null);
  const [retryNonce, setRetryNonce] = React.useState(0);
  const retryPreview = React.useCallback(() => {
    setWebglError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  // ----- Camera math --------------------------------------------------
  const updateCameraFromOrbit = React.useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const d = distanceRef.current;
    const yaw = yawRef.current;
    const pitch = pitchRef.current;
    // Target is the center of the grid floor, just above the floor plane.
    const targetY = 0.5;
    const cy = Math.cos(pitch);
    const px = d * cy * Math.sin(yaw);
    const py = d * Math.sin(pitch) + targetY;
    const pz = d * cy * Math.cos(yaw);
    handle.camera.position.set(px, py, pz);
    handle.camera.lookAt(0, targetY, 0);
  }, []);

  // ----- Mount Three.js ----------------------------------------------
  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    // If we already bailed to the "too small" fallback last render the
    // host may not be rendered; guard via container size.
    if (size.w < MIN_CANVAS_DIM || size.h < MIN_CANVAS_DIM) return;
    // If we're in the WebGL-error fallback, skip mounting — the user
    // must click Retry to clear `webglError` (which bumps `retryNonce`
    // and re-runs this effect).
    if (webglError) return;

    // Wrap construction. `THREE.WebGLRenderer`'s constructor throws when
    // it can't acquire a WebGL context (headless Chromium without a GPU,
    // browsers with WebGL disabled, WebGL2-only browsers serving WebGL1,
    // etc.). Without this guard the exception bubbles through React and
    // unmounts the whole DocksModal tree.
    let handle: PreviewSceneHandle;
    try {
      handle = buildPreviewScene();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err ?? "unknown error");
      // Surface to the Output/Problems panels so the user can see why
      // the preview is offline. Diagnostics is broadcast-synced so
      // popouts see this too.
      try {
        useDiagnosticsStore.getState().log(
          "error",
          `3D preview unavailable — WebGL initialization failed: ${message}`,
        );
      } catch {
        /* diagnostics store unreachable — fall through */
      }
      // Keep a console trace too — `useDiagnosticsStore` only captures
      // the message string, but a stack helps when debugging locally.
      if (typeof console !== "undefined" && console.error) {
        console.error("[PreviewPanel] buildPreviewScene failed", err);
      }
      setWebglError(message);
      return;
    }

    handleRef.current = handle;
    host.appendChild(handle.renderer.domElement);
    // Renderer's canvas is positioned inside an absolutely-filled host;
    // make sure it doesn't impose its own width/height styles that
    // disagree with the host.
    handle.renderer.domElement.style.display = "block";
    handle.renderer.domElement.style.width = "100%";
    handle.renderer.domElement.style.height = "100%";

    // Sync initial size + camera pose.
    handle.renderer.setSize(size.w, size.h, false);
    handle.camera.aspect = size.w / size.h;
    handle.camera.updateProjectionMatrix();
    handle.grid.visible = gridVisibleRef.current;
    updateCameraFromOrbit();

    const renderLoop = (): void => {
      const h = handleRef.current;
      if (!h) return;
      try {
        h.renderer.render(h.scene, h.camera);
      } catch (err) {
        // A runtime render failure (lost context, GPU reset, etc.)
        // shouldn't keep firing the rAF loop forever. Bail to the
        // fallback the same way an init failure does.
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        const message =
          err instanceof Error ? err.message : String(err ?? "unknown error");
        try {
          useDiagnosticsStore.getState().log(
            "error",
            `3D preview render failed: ${message}`,
          );
        } catch {
          /* ignore */
        }
        if (typeof console !== "undefined" && console.error) {
          console.error("[PreviewPanel] render loop failed", err);
        }
        setWebglError(message);
        return;
      }
      rafRef.current = requestAnimationFrame(renderLoop);
    };
    rafRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      try {
        host.removeChild(handle.renderer.domElement);
      } catch {
        /* already detached */
      }
      handle.dispose();
      handleRef.current = null;
    };
    // We intentionally re-mount when crossing the size threshold —
    // size.w/h are part of the gate above. `retryNonce` bumps when the
    // user clicks Retry from the WebGL-error fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w >= MIN_CANVAS_DIM && size.h >= MIN_CANVAS_DIM, webglError, retryNonce]);

  // ----- Floor + grid rebuild on dims change -------------------------
  // Floor PlaneGeometry is sized to dims so it always sits exactly under
  // the painted cells. Grid is rebuilt at the same time so its divisions
  // match the cell count.
  React.useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    // Dispose the old floor + old grid before swapping in new ones.
    for (const child of handle.floorGroup.children.slice()) {
      handle.floorGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        for (const m of mats) m.dispose();
      }
    }

    const floorGeo = new THREE.PlaneGeometry(dims.w, dims.h);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x3a3027,
      roughness: 0.9,
      metalness: 0.0,
      wireframe: wireframeRef.current,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 0);
    handle.floorGroup.add(floor);

    // Replace the grid helper with one sized to the level.
    handle.scene.remove(handle.grid);
    handle.grid.geometry.dispose();
    const gridMat = handle.grid.material as THREE.Material | THREE.Material[];
    const gridMats = Array.isArray(gridMat) ? gridMat : [gridMat];
    for (const m of gridMats) m.dispose();
    const maxDim = Math.max(dims.w, dims.h);
    const newGrid = new THREE.GridHelper(maxDim, maxDim, 0x666b78, 0x3a3f4b);
    newGrid.position.y = 0.001;
    newGrid.visible = gridVisibleRef.current;
    handle.scene.add(newGrid);
    handle.grid = newGrid;
  }, [dims.w, dims.h, size.w >= MIN_CANVAS_DIM && size.h >= MIN_CANVAS_DIM]);

  // ----- Cell-mesh rebuild on scene/layer change ---------------------
  // Geometry rebuild is keyed on the store slices the cells depend on.
  // We iterate the sparse `cells` map, stack one BoxGeometry per
  // (cell, layer) where the layer is visible and has a preset assigned.
  // Coord mapping: cell (x, y) → world (x - dims.w/2 + 0.5, height/2, y - dims.h/2 + 0.5).
  // The dims/2 offset centers the grid on the camera target so cell (0, 0)
  // doesn't land at world (0, 0). Three.js Y is UP: the cell-grid Y axis
  // is the floor-plane SECOND axis, i.e. Three's Z.
  React.useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    // Dispose previous cell meshes (geometry only — materials are pooled).
    for (const child of handle.sceneGroup.children.slice()) {
      handle.sceneGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }

    // Flush the material pool so a registry repopulation (new pack
    // imported, hydrated colors changed) doesn't render cells at the
    // previous pack's stale colors. The pool is per-rebuild now; that's
    // fine — a 4096-cell grid creates at most ~dozens of distinct
    // (layer, preset) keys, not thousands. We also dispose any
    // attached texture maps — `THREE.CanvasTexture` wraps a GPU
    // resource that `material.dispose()` does NOT free automatically.
    for (const m of handle.materialPool.values()) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
    handle.materialPool.clear();

    const halfW = dims.w / 2 - 0.5;
    const halfH = dims.h / 2 - 0.5;

    for (const key in cells) {
      const cell = cells[key];
      if (!cell) continue;
      const [xs, ys] = key.split(",");
      const x = Number(xs);
      const y = Number(ys);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

      for (const layerId of order) {
        if (visibility[layerId] === false) continue;
        const presetId = cell.layers[layerId];
        if (!presetId) continue;

        // Material pool — keyed by `${layerId}:${presetId}:${textured}`
        // where `textured` is `"tex"` once a bitmap is available and
        // `"flat"` while we're still on the color fallback. The extra
        // segment is what lets the SAME preset start as a flat-color
        // material on first paint, then get replaced with a textured
        // one once the bitmap loads — without it, the cached
        // flat-color material would survive the texturesEpoch rebuild
        // and the bitmap would never reach the GPU.
        const entry = presetRegistry[presetId];
        const texPath = entry?.texture;
        // Hot-path bitmap lookup. `undefined` = never requested,
        // `null` = known-failed, otherwise = ready.
        const bitmap = texPath
          ? getTileTextureSync(presetId, texPath)
          : undefined;
        if (bitmap === undefined && texPath && projectId) {
          // Fire an async load; the next `texturesEpoch` bump will
          // re-run this effect and pick up the bitmap.
          loadTileTexture(projectId, presetId, texPath);
        }
        const variant = bitmap ? "tex" : "flat";
        const matKey = `${layerId}:${presetId}:${variant}`;
        let mat = handle.materialPool.get(matKey);
        if (!mat) {
          const presetColor = entry?.color;
          const colorNum = presetColor
            ? hexStringToNumber(presetColor)
            : colorForLayer(layerId);
          if (bitmap) {
            // ImageBitmap → THREE.CanvasTexture. CanvasTexture accepts
            // any `TexImageSource`, including `ImageBitmap`, and bumps
            // `needsUpdate=true` automatically on construction. We
            // leave the material color at white so the texture's own
            // colors pass through unchanged.
            const tex = new THREE.CanvasTexture(bitmap);
            tex.colorSpace = THREE.SRGBColorSpace;
            // Crisp pixel-art-ish look matching the top-down map.
            tex.magFilter = THREE.NearestFilter;
            tex.minFilter = THREE.LinearMipMapLinearFilter;
            tex.anisotropy = 4;
            mat = new THREE.MeshStandardMaterial({
              map: tex,
              color: 0xffffff,
              roughness: 0.7,
              metalness: 0.05,
              wireframe: wireframeRef.current,
            });
          } else {
            mat = new THREE.MeshStandardMaterial({
              color: colorNum,
              roughness: 0.7,
              metalness: 0.05,
              wireframe: wireframeRef.current,
            });
          }
          handle.materialPool.set(matKey, mat);
        }
        // Keep pooled materials in sync with the current wireframe flag.
        mat.wireframe = wireframeRef.current;

        const h = Math.max(cell.height, 1);
        const geo = new THREE.BoxGeometry(1, h, 1);
        const mesh = new THREE.Mesh(geo, mat);
        // Cell (x, y) → world (x, *, y). Y in Three is UP; cell-grid
        // y is the SECOND floor-plane axis (Three's Z).
        mesh.position.set(x - halfW, h / 2, y - halfH);
        handle.sceneGroup.add(mesh);
      }
    }
  }, [cells, visibility, order, dims.w, dims.h, presetRegistry, texturesEpoch, projectId, size.w >= MIN_CANVAS_DIM && size.h >= MIN_CANVAS_DIM]);

  // ----- Ambient intensity from scene settings -----------------------
  React.useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    // settings.ambient is 0..1 — Three's AmbientLight intensity is the
    // same convention (a multiplier on the light's color contribution).
    // settings.fog deferred until THREE.FogExp2 plumbing lands.
    handle.ambient.intensity = settings.ambient;
  }, [settings.ambient, size.w >= MIN_CANVAS_DIM && size.h >= MIN_CANVAS_DIM]);

  // ----- ResizeObserver ----------------------------------------------
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const rect = entry.contentRect;
      const w = Math.floor(rect.width);
      const h = Math.floor(rect.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      const handle = handleRef.current;
      if (handle && w >= MIN_CANVAS_DIM && h >= MIN_CANVAS_DIM) {
        handle.renderer.setSize(w, h, false);
        handle.camera.aspect = w / h;
        handle.camera.updateProjectionMatrix();
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // ----- Mouse drag (orbit) ------------------------------------------
  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onDown = (ev: PointerEvent): void => {
      if (ev.button !== 0) return;
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      host.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent): void => {
      if (!dragging) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      lastX = ev.clientX;
      lastY = ev.clientY;
      // 0.005 rad/px ≈ 0.3°/px — feels right for a thumbnail preview.
      yawRef.current = yawRef.current - dx * 0.005;
      pitchRef.current = clampPitch(pitchRef.current - dy * 0.005);
      updateCameraFromOrbit();
    };
    const onUp = (ev: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      try {
        host.releasePointerCapture(ev.pointerId);
      } catch {
        /* pointer already released */
      }
      // Persist on mouseup only — never on every move.
      writeLSNumber(LS_CAM_YAW, yawRef.current);
      writeLSNumber(LS_CAM_PITCH, pitchRef.current);
    };

    host.addEventListener("pointerdown", onDown);
    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerup", onUp);
    host.addEventListener("pointercancel", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
    };
  }, [updateCameraFromOrbit]);

  // ----- Wheel zoom (debounced persistence) --------------------------
  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    let persistTimer: ReturnType<typeof setTimeout> | null = null;

    const onWheel = (ev: WheelEvent): void => {
      ev.preventDefault();
      // deltaY > 0 = scroll down = zoom out.
      const factor = ev.deltaY > 0 ? 1.1 : 1 / 1.1;
      distanceRef.current = clampDistance(distanceRef.current * factor);
      updateCameraFromOrbit();
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        writeLSNumber(LS_CAM_DISTANCE, distanceRef.current);
      }, 250);
    };
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      host.removeEventListener("wheel", onWheel);
      if (persistTimer) clearTimeout(persistTimer);
    };
  }, [updateCameraFromOrbit]);

  // ----- Action handlers ---------------------------------------------
  const resetCamera = React.useCallback(() => {
    // Reset distance to the auto-fit value for the CURRENT dims — a
    // user reset on a 64×64 grid should land back at the "whole grid
    // visible" pose, not the old 7-unit default.
    const fit = autoFitDistance(dims.w, dims.h);
    distanceRef.current = fit;
    yawRef.current = DEFAULT_YAW;
    pitchRef.current = DEFAULT_PITCH;
    writeLSNumber(LS_CAM_DISTANCE, fit);
    writeLSNumber(LS_CAM_YAW, DEFAULT_YAW);
    writeLSNumber(LS_CAM_PITCH, DEFAULT_PITCH);
    updateCameraFromOrbit();
  }, [updateCameraFromOrbit, dims.w, dims.h]);

  const zoomIn = React.useCallback(() => {
    distanceRef.current = clampDistance(distanceRef.current - ZOOM_STEP);
    writeLSNumber(LS_CAM_DISTANCE, distanceRef.current);
    updateCameraFromOrbit();
  }, [updateCameraFromOrbit]);

  const zoomOut = React.useCallback(() => {
    distanceRef.current = clampDistance(distanceRef.current + ZOOM_STEP);
    writeLSNumber(LS_CAM_DISTANCE, distanceRef.current);
    updateCameraFromOrbit();
  }, [updateCameraFromOrbit]);

  const toggleGrid = React.useCallback(() => {
    gridVisibleRef.current = !gridVisibleRef.current;
    const handle = handleRef.current;
    if (handle) handle.grid.visible = gridVisibleRef.current;
    forceRerender();
  }, []);

  const toggleWireframe = React.useCallback(() => {
    wireframeRef.current = !wireframeRef.current;
    const handle = handleRef.current;
    if (handle) {
      // Apply to pooled materials.
      for (const m of handle.materialPool.values()) {
        m.wireframe = wireframeRef.current;
        m.needsUpdate = true;
      }
      // Apply to the floor's material (it's not pooled — one-off).
      handle.floorGroup.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          const mats = Array.isArray(obj.material)
            ? obj.material
            : [obj.material];
          for (const mm of mats) {
            if (mm instanceof THREE.MeshStandardMaterial) {
              mm.wireframe = wireframeRef.current;
              mm.needsUpdate = true;
            }
          }
        }
      });
    }
    forceRerender();
  }, []);

  // ----- Command registry --------------------------------------------
  // Canonical handler-ref + mount-once effect pattern (state/README.md).
  const resetRef = React.useRef(resetCamera);
  const zoomInRef = React.useRef(zoomIn);
  const zoomOutRef = React.useRef(zoomOut);
  const toggleGridRef = React.useRef(toggleGrid);
  const toggleWireframeRef = React.useRef(toggleWireframe);

  React.useEffect(() => {
    resetRef.current = resetCamera;
  }, [resetCamera]);
  React.useEffect(() => {
    zoomInRef.current = zoomIn;
  }, [zoomIn]);
  React.useEffect(() => {
    zoomOutRef.current = zoomOut;
  }, [zoomOut]);
  React.useEffect(() => {
    toggleGridRef.current = toggleGrid;
  }, [toggleGrid]);
  React.useEffect(() => {
    toggleWireframeRef.current = toggleWireframe;
  }, [toggleWireframe]);

  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    unregs.push(
      registerCommand({
        id: "scene.preview.resetCamera",
        title: "Reset Preview Camera",
        category: "Preview",
        keywords: ["preview", "camera", "reset", "default"],
        description: "Restore the 3D preview camera to its default angle.",
        run: () => resetRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "scene.preview.zoomIn",
        title: "Zoom Preview In",
        category: "Preview",
        keywords: ["preview", "zoom", "in", "closer"],
        description: "Move the preview camera closer to the scene.",
        run: () => zoomInRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "scene.preview.zoomOut",
        title: "Zoom Preview Out",
        category: "Preview",
        keywords: ["preview", "zoom", "out", "farther"],
        description: "Move the preview camera farther from the scene.",
        run: () => zoomOutRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "scene.preview.toggleGrid",
        title: "Toggle Preview Grid",
        category: "Preview",
        keywords: ["preview", "grid", "helper", "toggle"],
        description: "Show or hide the floor grid in the 3D preview.",
        run: () => toggleGridRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "scene.preview.toggleWireframe",
        title: "Toggle Preview Wireframe",
        category: "Preview",
        keywords: ["preview", "wireframe", "solid", "toggle"],
        description: "Switch the preview between solid and wireframe shading.",
        run: () => toggleWireframeRef.current(),
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // ----- Render ------------------------------------------------------
  const tooSmall = size.w > 0 && size.h > 0 && (size.w < MIN_CANVAS_DIM || size.h < MIN_CANVAS_DIM);
  // Toolbar is suppressed in fallback states — there's nothing to act on
  // when the canvas isn't rendering.
  const showToolbar = size.w >= MIN_TOOLBAR_WIDTH && !tooSmall && !webglError;

  return (
    <div
      ref={containerRef}
      data-panel-content="preview-topdown"
      className="relative h-full w-full overflow-hidden"
    >
      {tooSmall ? (
        // Lightweight inline fallback — full EmptyState would overflow the
        // tiny dock area; we want a single legible line.
        <div className="absolute inset-0 flex items-center justify-center text-center px-2">
          <span className="text-[10px] uppercase tracking-wide text-(--color-fg-muted)">
            Panel too small
          </span>
        </div>
      ) : webglError ? (
        // WebGL-unavailable fallback — render an EmptyState with a
        // Retry button. The detail message is captured in
        // `useDiagnosticsStore` (Output/Problems panel) but we also
        // surface the first line here so the user has context without
        // hunting for the panel.
        <div
          data-preview-fallback="webgl"
          className="absolute inset-0 flex items-center justify-center overflow-auto"
        >
          <EmptyState
            icon={<AlertTriangle size={24} />}
            title="WebGL unavailable — preview offline"
            description={
              <>
                The browser couldn&apos;t initialise a 3D context for the
                preview. This usually means WebGL is disabled or the
                browser is running without GPU acceleration.
                {size.w >= 260 && (
                  <span className="block mt-2 text-[10px] text-zinc-600 font-mono break-all">
                    {webglError}
                  </span>
                )}
              </>
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={retryPreview}
                leadingIcon={<RotateCcw size={12} />}
              >
                Retry
              </Button>
            }
          />
        </div>
      ) : (
        <div
          ref={canvasHostRef}
          // Three appends its <canvas> here. We give the host an
          // explicit cursor for the orbit affordance and a touch-action
          // override so wheel events aren't hijacked by the browser.
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        />
      )}

      {showToolbar && (
        <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
          <PreviewIconButton
            tooltipLabel="Reset camera"
            tooltipDescription="Restore the 3D preview camera to its default angle."
            onClick={resetCamera}
          >
            <RotateCcw size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="Zoom in"
            tooltipDescription="Move the preview camera closer to the scene."
            onClick={zoomIn}
          >
            <ZoomIn size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="Zoom out"
            tooltipDescription="Move the preview camera farther from the scene."
            onClick={zoomOut}
          >
            <ZoomOut size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="Toggle grid"
            tooltipDescription="Show or hide the floor grid helper."
            pressed={gridVisibleRef.current}
            onClick={toggleGrid}
          >
            <Grid3x3 size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="Toggle wireframe"
            tooltipDescription="Switch between solid and wireframe shading."
            pressed={wireframeRef.current}
            onClick={toggleWireframe}
          >
            <Maximize2 size={14} />
          </PreviewIconButton>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clampDistance(d: number): number {
  if (!Number.isFinite(d)) return MIN_DISTANCE;
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
}

function clampPitch(p: number): number {
  if (!Number.isFinite(p)) return DEFAULT_PITCH;
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, p));
}

interface PreviewIconButtonProps {
  tooltipLabel: string;
  tooltipDescription: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function PreviewIconButton({
  tooltipLabel,
  tooltipDescription,
  pressed,
  disabled,
  onClick,
  children,
}: PreviewIconButtonProps): React.JSX.Element {
  return (
    <Tooltip
      side="bottom"
      stages={[
        { delay: 1000, content: <span>{tooltipLabel}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{tooltipLabel}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {tooltipDescription}
              </div>
            </div>
          ),
        },
      ]}
    >
      <button
        type="button"
        aria-label={tooltipLabel}
        aria-pressed={pressed ?? undefined}
        disabled={disabled}
        onClick={onClick}
        className={[
          "flex items-center justify-center w-6 h-6 rounded",
          "border transition-colors",
          disabled
            ? "bg-zinc-900/40 border-(--color-border-strong) text-(--color-fg-faint) cursor-not-allowed opacity-60"
            : pressed
              ? "bg-amber-500 border-amber-500 text-zinc-950"
              : "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {children}
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Error boundary — last-resort safety net.
// ---------------------------------------------------------------------------
// The inner component's mount-effect try/catch handles the common
// WebGL-context-acquisition failure (effect errors are NOT caught by
// error boundaries, so a boundary alone would still let the editor
// crash). The boundary picks up the rest: synchronous render errors
// from descendants, errors thrown during a re-render after a state
// update, or anything the try/catch didn't anticipate. Either layer in
// isolation leaves a real crash path open.

interface PreviewErrorBoundaryProps {
  children: React.ReactNode;
}
interface PreviewErrorBoundaryState {
  error: Error | null;
}

class PreviewErrorBoundary extends React.Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  override state: PreviewErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PreviewErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    try {
      useDiagnosticsStore.getState().log(
        "error",
        `3D preview crashed: ${error.message}`,
      );
    } catch {
      /* diagnostics unreachable — ignore */
    }
    if (typeof console !== "undefined" && console.error) {
      console.error("[PreviewPanel] error boundary caught", error, info);
    }
  }

  handleRetry = (): void => {
    this.setState({ error: null });
  };

  override render(): React.ReactNode {
    if (this.state.error) {
      return (
        <div
          data-panel="preview"
          data-preview-fallback="boundary"
          className="relative h-full w-full overflow-auto flex items-center justify-center"
        >
          <EmptyState
            icon={<AlertTriangle size={24} />}
            title="WebGL unavailable — preview offline"
            description={
              <>
                The 3D preview hit an unexpected error and is offline.
                The rest of the editor is unaffected.
                <span className="block mt-2 text-[10px] text-zinc-600 font-mono break-all">
                  {this.state.error.message}
                </span>
              </>
            }
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={this.handleRetry}
                leadingIcon={<RotateCcw size={12} />}
              >
                Retry
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Task #17 — Engine-rendered preview branch + mode/expand wrapper.
// ---------------------------------------------------------------------------
//
// The wrapper owns three pieces of local state:
//   - previewMode : "top-down" | "engine"
//   - controls    : { fly, god }
//   - expanded    : boolean
//
// Mode "top-down" renders the existing THREE.js scene (PreviewPanelInner).
// Mode "engine" mounts an iframe pointed at GAME_RUNNER_URL with
// `?source=editor&projectId=…&flyMode=…&godMode=…`. The fly/god flags are
// also relayed to the engine over postMessage so toggling them mid-session
// doesn't require an iframe reload — the engine reads them at the top of
// each frame (see apps/game/src/editor-bridge.ts + the default-pack
// player-input system).
//
// Expand opens the same content inside a Modal (host-routed via shell
// SDK) so the user can fly through the engine view at full editor-window
// size and dismiss with Esc or backdrop click.
//
// All three features degrade gracefully:
//   - No active project → engine toggle is disabled (tooltip explains).
//   - Engine iframe boot fails → the engine branch shows an EmptyState
//     and the top-down branch remains available.
//   - WebGL unavailable → existing fallback in PreviewPanelInner stays
//     intact (the wrapper only adds chrome around it).

interface PreviewControls {
  fly: boolean;
  god: boolean;
}

type PreviewMode = "top-down" | "engine";

interface EngineIframePreviewProps {
  projectId: string;
  controls: PreviewControls;
  /** When false, the toolbar's engine-toggle button is suppressed —
   *  the modal's top toolbar owns mode switching. */
  showFallbackHint?: boolean;
}

/**
 * EngineIframePreview — mounts an iframe at `<GAME_RUNNER_URL>?source=editor&…`
 * and relays `controls` over postMessage. The iframe element itself stays
 * in the DOM across control changes (re-mounting would reload the engine
 * and lose camera position). The src is computed once per projectId so
 * project switches still bounce the iframe.
 *
 * Status overlay surfaces three states: "Booting…" (no `ready` received
 * yet), "Running" (after `ready`), and "Error: …" (after an `error`
 * message). The engine bridge always posts `ready` after install, so the
 * booting overlay is bounded by the engine's boot time (~1-2 s).
 */
function EngineIframePreview({
  projectId,
  controls,
}: EngineIframePreviewProps): React.JSX.Element {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  const [status, setStatus] = React.useState<"booting" | "running" | "error">(
    "booting",
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Build the src once per projectId. Fly/god toggles flow via
  // postMessage to avoid an iframe reload on each switch.
  const src = React.useMemo(() => {
    try {
      const u = new URL(GAME_RUNNER_URL, window.location.href);
      u.searchParams.set("source", "editor");
      u.searchParams.set("projectId", projectId);
      // Seed initial control state so the engine respects fly/god
      // before any postMessage round-trip lands. The bridge applies
      // these at boot.
      if (controls.fly) u.searchParams.set("flyMode", "true");
      if (controls.god) u.searchParams.set("godMode", "true");
      return u.toString();
      // controls are intentionally NOT in the dep array — see comment
      // above. We seed once at iframe mount; subsequent toggles use
      // postMessage so the engine doesn't reload.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } catch {
      // Malformed URL — surface an error state. Defensive; in
      // practice GAME_RUNNER_URL is always a valid relative path.
      return "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Listen for ready/error messages from THIS iframe specifically.
  React.useEffect(() => {
    function onMessage(ev: MessageEvent): void {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      const m = ev.data as { type?: string; message?: string };
      if (!m || typeof m.type !== "string") return;
      if (m.type === "ready") {
        setStatus("running");
        setErrorMessage(null);
      } else if (m.type === "error") {
        setStatus("error");
        setErrorMessage(typeof m.message === "string" ? m.message : "Unknown error");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Relay control changes to the iframe. The engine bridge mutates
  // its preview-controls slot on receipt; the next pack-side frame
  // picks up the new value. We only post AFTER the iframe is running
  // so the first message isn't dropped pre-ready.
  React.useEffect(() => {
    if (status !== "running") return;
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.postMessage({ type: "set-controls", fly: controls.fly, god: controls.god }, "*");
  }, [controls.fly, controls.god, status]);

  return (
    <div className="absolute inset-0 bg-black">
      {src ? (
        <iframe
          ref={iframeRef}
          data-preview-engine-iframe="true"
          src={src}
          // Pointer-lock + fullscreen + gamepad permissions per iframe
          // so the engine's WASD-with-mouse-look works inside the
          // editor's preview pane. Same allow string as the editor's
          // main viewport.
          allow="pointer-lock fullscreen gamepad screen-wake-lock"
          title="Engine preview"
          style={{
            width: "100%",
            height: "100%",
            border: 0,
            display: "block",
            background: "#000",
          }}
        />
      ) : null}
      {status === "booting" && (
        <div
          data-preview-engine-status="booting"
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <span className="text-[11px] uppercase tracking-wide text-(--color-fg-muted) bg-zinc-900/80 px-3 py-1 rounded">
            Booting engine…
          </span>
        </div>
      )}
      {status === "error" && (
        <div
          data-preview-engine-status="error"
          className="absolute inset-0 flex items-center justify-center overflow-auto"
        >
          <EmptyState
            icon={<AlertTriangle size={24} />}
            title="Engine preview unavailable"
            description={
              <>
                The engine iframe reported an error. The top-down
                preview is still available — switch back via the toolbar.
                {errorMessage ? (
                  <span className="block mt-2 text-[10px] text-zinc-600 font-mono break-all">
                    {errorMessage}
                  </span>
                ) : null}
              </>
            }
          />
        </div>
      )}
    </div>
  );
}

/**
 * Top control strip rendered ABOVE the preview canvas — owns the
 * mode toggle (top-down ↔ engine), fly/god control buttons (engine
 * mode only), and the Expand button. Always visible when the panel
 * is wide enough; suppressed when too narrow so the existing
 * toolbar inside PreviewPanelInner gets the available pixels.
 */
interface PreviewTopToolbarProps {
  mode: PreviewMode;
  onModeChange: (mode: PreviewMode) => void;
  controls: PreviewControls;
  onControlsChange: (controls: PreviewControls) => void;
  expanded: boolean;
  onExpandToggle: () => void;
  /** When falsy, the engine-toggle button is disabled with an
   *  explanatory tooltip. Pass `null` when no active project. */
  canUseEngine: boolean;
  /** When in modal mode, suppress the Expand button (clicking it
   *  would dismiss the modal — we want a dedicated close button
   *  in the modal footer instead). */
  inModal?: boolean;
}

function PreviewTopToolbar({
  mode,
  onModeChange,
  controls,
  onControlsChange,
  expanded,
  onExpandToggle,
  canUseEngine,
  inModal = false,
}: PreviewTopToolbarProps): React.JSX.Element {
  // Used to disable the engine-toggle when no project is loaded.
  const engineDisabled = !canUseEngine && mode !== "engine";
  return (
    <div className="absolute top-1 left-1 flex items-center gap-1 z-10">
      <PreviewIconButton
        tooltipLabel="Top-down preview"
        tooltipDescription="Editor-rendered orthographic-ish overhead view of the painted scene."
        pressed={mode === "top-down"}
        onClick={() => onModeChange("top-down")}
      >
        <Box size={14} />
      </PreviewIconButton>
      <PreviewIconButton
        tooltipLabel={
          engineDisabled
            ? "Engine preview (no active project)"
            : "Engine preview"
        }
        tooltipDescription={
          engineDisabled
            ? "Open a project before switching to the engine-rendered preview."
            : "Embed the actual game engine inside the preview, with collision and physics."
        }
        pressed={mode === "engine"}
        disabled={engineDisabled}
        onClick={() => onModeChange("engine")}
      >
        <Cuboid size={14} />
      </PreviewIconButton>
      {mode === "engine" && (
        <>
          {/* Visual separator between mode toggle and control modes. */}
          <span className="inline-block w-px h-4 bg-zinc-700 mx-1" aria-hidden="true" />
          <PreviewIconButton
            tooltipLabel="Fly mode"
            tooltipDescription="Free-camera WASD movement with no gravity. Use jump (space) to ascend and crouch (ctrl) to descend."
            pressed={controls.fly}
            onClick={() => onControlsChange({ ...controls, fly: !controls.fly })}
          >
            <Plane size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="God mode"
            tooltipDescription="Disable wall collision so the player clips through geometry. Combine with Fly for full flythrough."
            pressed={controls.god}
            onClick={() => onControlsChange({ ...controls, god: !controls.god })}
          >
            <Shield size={14} />
          </PreviewIconButton>
        </>
      )}
      {!inModal && (
        <>
          <span className="inline-block w-px h-4 bg-zinc-700 mx-1" aria-hidden="true" />
          <PreviewIconButton
            tooltipLabel={expanded ? "Collapse preview" : "Expand preview"}
            tooltipDescription={
              expanded
                ? "Return the preview to its docked size."
                : "Open the preview in a fullscreen modal for a real flythrough."
            }
            onClick={onExpandToggle}
          >
            <Expand size={14} />
          </PreviewIconButton>
        </>
      )}
    </div>
  );
}

/**
 * Shared state shape passed down by PreviewPanel into both the
 * docked-pane shell and the modal-expanded shell. Lifted out of the
 * shell component so the modal mirrors the docked mode/controls
 * instead of resetting to defaults on open.
 */
interface PreviewShellState {
  mode: PreviewMode;
  setMode: (m: PreviewMode) => void;
  controls: PreviewControls;
  setControls: (c: PreviewControls) => void;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  projectId: string | null;
}

/**
 * PreviewPanelShell — task #17 inner shell. Receives state from the
 * top-level `PreviewPanel` (or the modal renderer) so toggling
 * inside the modal mirrors the docked panel and vice-versa. The
 * shell itself is stateless; it just composes the preview body +
 * top toolbar against the supplied state surface.
 */
function PreviewPanelShell({
  state,
  inModal = false,
}: {
  state: PreviewShellState;
  inModal?: boolean;
}): React.JSX.Element {
  const { mode, setMode, controls, setControls, expanded, setExpanded, projectId } = state;
  const canUseEngine = projectId !== null && projectId !== "";

  // If the engine toggle is on but the project disappears, fall back
  // to top-down so the user isn't staring at a permanent error.
  React.useEffect(() => {
    if (mode === "engine" && !canUseEngine) {
      setMode("top-down");
    }
  }, [mode, canUseEngine, setMode]);

  const previewBody =
    mode === "engine" && canUseEngine && projectId ? (
      <EngineIframePreview projectId={projectId} controls={controls} />
    ) : (
      <PreviewPanelInner />
    );

  return (
    <div
      data-panel="preview"
      data-preview-mode={mode}
      data-preview-expanded={expanded ? "true" : "false"}
      data-preview-in-modal={inModal ? "true" : "false"}
      className="relative h-full w-full overflow-hidden"
    >
      {previewBody}
      <PreviewTopToolbar
        mode={mode}
        onModeChange={setMode}
        controls={controls}
        onControlsChange={setControls}
        expanded={expanded}
        onExpandToggle={() => setExpanded(!expanded)}
        canUseEngine={canUseEngine}
        inModal={inModal}
      />
    </div>
  );
}

export function PreviewPanel(): React.JSX.Element {
  // Lifted state — both the docked shell and the modal-expanded
  // shell read the same surface so toggles inside the modal mirror
  // to the docked panel and vice-versa. Without the lift the modal's
  // shell would mount with default state every open and forget the
  // user's mode/controls.
  const [mode, setMode] = React.useState<PreviewMode>("top-down");
  const [controls, setControls] = React.useState<PreviewControls>({
    fly: false,
    god: false,
  });
  const [expanded, setExpanded] = React.useState(false);

  const projectId = React.useMemo(() => {
    try {
      return typeof window !== "undefined"
        ? window.localStorage.getItem("editor.currentProjectId")
        : null;
    } catch {
      return null;
    }
    // mode is in the deps so a project-switch dispatched between
    // mode toggles re-reads the localStorage. Cheap enough; React
    // batches anyway.
  }, [mode]);

  const state: PreviewShellState = {
    mode,
    setMode,
    controls,
    setControls,
    expanded,
    setExpanded,
    projectId,
  };

  return (
    <PreviewErrorBoundary>
      <PreviewPanelShell state={state} />
      {/* Modal mirrors the docked shell — same state, same toolbar
          (with the Expand button suppressed via inModal so the
          modal isn't double-expanded). Esc / backdrop click closes
          the modal; the engine iframe re-mounts because it's a
          fresh component tree, which loses pointer-lock + boot
          state. The pack-side `set-controls` slot survives because
          it's window-scoped, not React-state-scoped. */}
      <Modal
        open={expanded}
        onClose={() => setExpanded(false)}
        width="3xl"
        title="3D Preview"
        description={
          mode === "engine"
            ? controls.fly || controls.god
              ? "Engine-rendered preview — fly/god controls active."
              : "Engine-rendered preview — full collision and physics."
            : "Top-down editor preview."
        }
      >
        <div className="relative w-full" style={{ height: "70vh" }}>
          <PreviewPanelShell state={state} inModal={true} />
        </div>
      </Modal>
    </PreviewErrorBoundary>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "preview",
  title: "3D Preview",
  category: "Viewport",
  icon: <Box size={12} />,
};

export default PreviewPanel;
