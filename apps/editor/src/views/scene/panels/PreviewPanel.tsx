import React from "react";
import * as THREE from "three";
import {
  Box,
  Grid3x3,
  Maximize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";

/**
 * PreviewPanel — Three.js 3D preview of the current scene.
 *
 * Visual target: the small 3D PREVIEW region in `Editor Design/Map.png`
 * — a thumbnail-sized render of the scene-in-progress. For Wave 1 the
 * scene is hardcoded placeholder geometry (floor + a few wall cubes +
 * a directional light); Wave 2 will swap that for the real scene's
 * tile/wall data.
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
 *   - `cardboard.scene.preview.camDistance` (number, default 5)
 *   - `cardboard.scene.preview.camYaw`      (number, default π/4)
 *   - `cardboard.scene.preview.camPitch`    (number, default -π/6)
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

const DEFAULT_DISTANCE = 7;
const DEFAULT_YAW = Math.PI / 5;
// Positive pitch = camera elevation above target (the math below uses
// `d * sin(pitch) + targetY` for py, so positive lifts the camera up).
// A ~35° elevation tilts the camera down enough to put the floor in
// frame while still letting the back wall + corridor depth read.
const DEFAULT_PITCH = Math.PI / 5;

const MIN_DISTANCE = 2;
const MAX_DISTANCE = 25;
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

function writeLSNumber(key: string, value: number): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(value));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

// ---------------------------------------------------------------------------
// Three.js scene builder — produces a disposable handle the React layer
// can mount / unmount.
// ---------------------------------------------------------------------------

interface PreviewSceneHandle {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  grid: THREE.GridHelper;
  /** All materials that participate in the wireframe toggle. */
  wireframeMaterials: THREE.MeshStandardMaterial[];
  dispose: () => void;
}

function buildPreviewScene(): PreviewSceneHandle {
  const scene = new THREE.Scene();
  // Warm dungeon-dark background. Matches MapCanvasPanel's playfield
  // tone so the preview reads as part of the same room.
  scene.background = new THREE.Color(0x1a1814);

  // --- Floor -------------------------------------------------------------
  const floorGeo = new THREE.PlaneGeometry(20, 20);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x3a3027,
    roughness: 0.9,
    metalness: 0.0,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  // --- Walls (corridor-shape placeholder) --------------------------------
  // Hardcoded "back wall + two side walls + a center pillar" arrangement,
  // hinting at a corridor / room corner. Wave 2 swaps this for real
  // scene-derived geometry.
  const wallSpec: Array<[number, number, number, number, number, number]> = [
    // [x, y, z, width, height, depth]
    // Back wall — two segments forming the far end of the corridor.
    [-1.5, 0.75, -3.5, 1.5, 1.5, 1],
    [1.5, 0.75, -3.5, 1.5, 1.5, 1],
    // Left side wall — runs along the corridor.
    [-2.5, 0.75, -1.5, 1, 1.5, 2],
    // Right side wall — mirror.
    [2.5, 0.75, -1.5, 1, 1.5, 2],
    // Center pillar — gives the camera something interesting to look at.
    [0.0, 0.5, -1.5, 0.6, 1.0, 0.6],
  ];
  const wallColor = 0xb88a4a; // warm wood/amber tone
  const wireframeMaterials: THREE.MeshStandardMaterial[] = [floorMat];
  for (const [x, y, z, w, h, d] of wallSpec) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({
      color: wallColor,
      roughness: 0.7,
      metalness: 0.05,
    });
    const cube = new THREE.Mesh(geo, mat);
    cube.position.set(x, y, z);
    scene.add(cube);
    wireframeMaterials.push(mat);
  }

  // Back wall plane behind the corridor — a flat backdrop so the camera
  // never sees through to the void at the far end.
  const backWallGeo = new THREE.PlaneGeometry(12, 4);
  const backWallMat = new THREE.MeshStandardMaterial({
    color: 0x2a2118,
    roughness: 0.95,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const backWall = new THREE.Mesh(backWallGeo, backWallMat);
  backWall.position.set(0, 2, -6);
  scene.add(backWall);
  wireframeMaterials.push(backWallMat);

  // --- Lights ------------------------------------------------------------
  // Softer ambient — the warm key light below carries the dungeon tone.
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

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 2, 5);
  camera.lookAt(0, 0.75, 0);

  const dispose = (): void => {
    renderer.dispose();
    // Geometries / materials in the placeholder scene are small but we
    // walk the tree anyway so future additions don't leak.
    scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose();
      } else if (obj instanceof THREE.GridHelper) {
        obj.geometry.dispose();
        const mat = obj.material as THREE.Material | THREE.Material[];
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) m.dispose();
      }
    });
  };

  return { scene, renderer, camera, grid, wireframeMaterials, dispose };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export function PreviewPanel(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasHostRef = React.useRef<HTMLDivElement | null>(null);
  const handleRef = React.useRef<PreviewSceneHandle | null>(null);
  const rafRef = React.useRef<number | null>(null);

  // Container-size state drives the "Too small" + "Hide toolbar" toggles.
  // We track it in React state so render-paths can react to it; the
  // canvas itself is sized via direct Three calls inside the
  // ResizeObserver callback (cheaper than going through React).
  const [size, setSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // --- Camera orbital state (lives in refs — no React rerenders per frame).
  const distanceRef = React.useRef<number>(
    clampDistance(readLSNumber(LS_CAM_DISTANCE, DEFAULT_DISTANCE)),
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

  // ----- Camera math --------------------------------------------------
  const updateCameraFromOrbit = React.useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const d = distanceRef.current;
    const yaw = yawRef.current;
    const pitch = pitchRef.current;
    // Standard spherical → cartesian. Target is the cube cluster
    // centroid (~origin, slightly above the floor).
    const targetY = 0.75;
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

    const handle = buildPreviewScene();
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
    applyWireframe(handle.wireframeMaterials, wireframeRef.current);
    updateCameraFromOrbit();

    const renderLoop = (): void => {
      const h = handleRef.current;
      if (!h) return;
      h.renderer.render(h.scene, h.camera);
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
    // size.w/h are part of the gate above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w >= MIN_CANVAS_DIM && size.h >= MIN_CANVAS_DIM]);

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
    distanceRef.current = DEFAULT_DISTANCE;
    yawRef.current = DEFAULT_YAW;
    pitchRef.current = DEFAULT_PITCH;
    writeLSNumber(LS_CAM_DISTANCE, DEFAULT_DISTANCE);
    writeLSNumber(LS_CAM_YAW, DEFAULT_YAW);
    writeLSNumber(LS_CAM_PITCH, DEFAULT_PITCH);
    updateCameraFromOrbit();
  }, [updateCameraFromOrbit]);

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
    if (handle) applyWireframe(handle.wireframeMaterials, wireframeRef.current);
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
  const showToolbar = size.w >= MIN_TOOLBAR_WIDTH && !tooSmall;

  return (
    <div
      ref={containerRef}
      data-panel="preview"
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
  if (!Number.isFinite(d)) return DEFAULT_DISTANCE;
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d));
}

function clampPitch(p: number): number {
  if (!Number.isFinite(p)) return DEFAULT_PITCH;
  return Math.min(MAX_PITCH, Math.max(MIN_PITCH, p));
}

function applyWireframe(
  mats: THREE.MeshStandardMaterial[],
  wireframe: boolean,
): void {
  for (const m of mats) {
    m.wireframe = wireframe;
    m.needsUpdate = true;
  }
}

interface PreviewIconButtonProps {
  tooltipLabel: string;
  tooltipDescription: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function PreviewIconButton({
  tooltipLabel,
  tooltipDescription,
  pressed,
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
        onClick={onClick}
        className={[
          "flex items-center justify-center w-6 h-6 rounded",
          "border transition-colors",
          pressed
            ? "bg-amber-500 border-amber-500 text-zinc-950"
            : "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60 hover:text-(--color-fg-primary)",
        ].join(" ")}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "preview",
  title: "3D Preview",
  icon: <Box size={12} />,
};

export default PreviewPanel;
