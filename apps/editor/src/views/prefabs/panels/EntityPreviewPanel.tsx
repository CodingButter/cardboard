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
import { MOCK_ENTITIES, type EntityRow } from "../prefabs-fixtures";

/**
 * EntityPreviewPanel — small 3D preview of the SELECTED entity.
 *
 * Visual target: the top-left "PREVIEW" region of
 * `Editor Design/Entities.png` — a single hovering entity rendered
 * against a warm-dark backdrop with subtle ambient + a fill point
 * light hanging off the camera. Mirrors the Scene page's
 * `PreviewPanel` for DPR scaling, ResizeObserver, manual orbit,
 * wheel-zoom, and the overlay toolbar pattern, but the scene contents
 * are derived from the active entity instead of the playfield.
 *
 * Phase 2 sources the active entity from `MOCK_ENTITIES[0]` (the
 * "light" entity). Wave 3 swaps this for the real selected-entity
 * id coming from `EntityListPanel`.
 *
 * Interaction:
 *   - Left-mouse drag inside the canvas orbits the camera (manual
 *     yaw/pitch — no `OrbitControls` jsm dep).
 *   - Wheel zooms by adjusting orbital radius.
 *   - Overlay toolbar (top-right) — reset / zoom in / zoom out /
 *     toggle grid / toggle wireframe. Every action is mirrored as a
 *     `prefabs.preview.*` command so the palette + keybindings can
 *     drive it too.
 *
 * Persistence (per-page localStorage):
 *   - `cardboard.prefabs.preview.camDistance` (default 5)
 *   - `cardboard.prefabs.preview.camYaw`      (default π/5)
 *   - `cardboard.prefabs.preview.camPitch`    (default π/5)
 *
 * Writes are debounced behind `mouseup` / `wheelend` so the panel
 * doesn't thrash localStorage every animation frame.
 *
 * Responsive contract:
 *   - Canvas fills `100% × 100%`; aspect + renderer size refreshed
 *     on every `ResizeObserver` callback.
 *   - Below ~130px in either dimension we render a "Resize panel"
 *     fallback (degenerate aspect ratios break projection math).
 *   - Overlay toolbar auto-hides below ~140px width.
 */

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const LS_CAM_DISTANCE = "cardboard.prefabs.preview.camDistance";
const LS_CAM_YAW = "cardboard.prefabs.preview.camYaw";
const LS_CAM_PITCH = "cardboard.prefabs.preview.camPitch";

const DEFAULT_DISTANCE = 5;
const DEFAULT_YAW = Math.PI / 5;
const DEFAULT_PITCH = Math.PI / 5;

const MIN_DISTANCE = 1.5;
const MAX_DISTANCE = 25;
const ZOOM_STEP = 0.5;
const MIN_PITCH = -Math.PI / 2 + 0.05;
const MAX_PITCH = Math.PI / 2 - 0.05;

const MIN_CANVAS_DIM = 130;
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
// Entity geometry resolution
//
// Given an EntityRow, build the mesh that visually represents it inside
// the preview. Light entities get the glowing-orb treatment (additive
// sphere + wireframe halo); everything else gets a placeholder cube /
// sphere scaled by the sprite component's scale field if present.
// ---------------------------------------------------------------------------

interface EntityVisual {
  /** Root Object3D the camera frames. */
  root: THREE.Object3D;
  /** Materials that participate in the wireframe toggle. */
  wireframeMaterials: THREE.MeshStandardMaterial[];
  /** Disposes geometries + materials owned by this visual. */
  dispose: () => void;
}

function getSpriteScale(entity: EntityRow): number {
  const sprite = entity.components.find((c) => c.kind === "sprite");
  if (!sprite) return 1.0;
  const raw = (sprite.data as Record<string, unknown>).scale;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0
    ? raw
    : 1.0;
}

function getLightColor(entity: EntityRow): number {
  const light = entity.components.find((c) => c.kind === "light");
  if (!light) return 0xfbbf24; // default warm amber
  const raw = (light.data as Record<string, unknown>).color;
  if (typeof raw === "string") {
    try {
      return new THREE.Color(raw).getHex();
    } catch {
      /* fall through */
    }
  }
  return 0xfbbf24;
}

function buildEntityVisual(entity: EntityRow): EntityVisual {
  const root = new THREE.Group();
  const wireframeMaterials: THREE.MeshStandardMaterial[] = [];
  const disposables: Array<{ dispose: () => void }> = [];

  if (entity.category === "light") {
    // Glowing-orb treatment: a small emissive sphere with an additive
    // material plus a wireframe halo to read as "light source".
    const color = getLightColor(entity);

    const orbGeo = new THREE.SphereGeometry(0.45, 32, 24);
    const orbMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const orb = new THREE.Mesh(orbGeo, orbMat);
    root.add(orb);
    disposables.push(orbGeo, orbMat);

    // Outer additive glow — slightly bigger sphere, lower opacity.
    const glowGeo = new THREE.SphereGeometry(0.75, 32, 24);
    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(glowGeo, glowMat);
    root.add(glow);
    disposables.push(glowGeo, glowMat);

    // Wireframe halo for the "light" affordance.
    const haloGeo = new THREE.SphereGeometry(1.0, 16, 12);
    const haloMat = new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    root.add(halo);
    disposables.push(haloGeo, haloMat);

    // A tiny embedded PointLight casts color onto any subsequent
    // helpers / ground if we add them later. Keeps the scene from
    // feeling totally flat.
    const inner = new THREE.PointLight(color, 1.0, 6, 1.5);
    inner.position.set(0, 0, 0);
    root.add(inner);
  } else {
    // Placeholder for actor/item/trigger/decor. Sphere for round
    // categories (item), cube for the rest.
    const scale = getSpriteScale(entity);
    const useSphere = entity.category === "item";

    const geo = useSphere
      ? new THREE.SphereGeometry(0.55, 32, 24)
      : new THREE.BoxGeometry(1, 1.2, 1);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xb88a4a,
      roughness: 0.65,
      metalness: 0.08,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(scale);
    root.add(mesh);
    wireframeMaterials.push(mat);
    disposables.push(geo, mat);

    // Subtle accent "shadow" disk under the entity so it doesn't
    // float in the void.
    const diskGeo = new THREE.CircleGeometry(0.7 * scale, 32);
    const diskMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.35,
    });
    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = -0.7 * scale;
    root.add(disk);
    disposables.push(diskGeo, diskMat);
  }

  const dispose = (): void => {
    for (const d of disposables) {
      try {
        d.dispose();
      } catch {
        /* ignore */
      }
    }
  };

  return { root, wireframeMaterials, dispose };
}

// ---------------------------------------------------------------------------
// Three.js scene builder
// ---------------------------------------------------------------------------

interface PreviewSceneHandle {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  grid: THREE.GridHelper;
  /** Materials that participate in the wireframe toggle. */
  wireframeMaterials: THREE.MeshStandardMaterial[];
  /** PointLight that follows the camera for fill. */
  cameraFill: THREE.PointLight;
  dispose: () => void;
}

function buildPreviewScene(entity: EntityRow): PreviewSceneHandle {
  const scene = new THREE.Scene();
  // Warm dungeon-dark background — matches MapCanvasPanel + the Scene
  // PreviewPanel so the preview reads as part of the same room.
  scene.background = new THREE.Color(0x1a1814);

  // --- Lights ------------------------------------------------------------
  // Soft ambient — keeps placeholder cubes from going fully black on
  // the dark side.
  const ambient = new THREE.AmbientLight(0xffffff, 0.45);
  scene.add(ambient);

  // PointLight that lives at the camera position for fill. The mount
  // effect updates its position every frame so it always reads as a
  // camera-attached lamp.
  const cameraFill = new THREE.PointLight(0xffe8c2, 1.6, 30, 1.2);
  cameraFill.position.set(0, 2, 5);
  scene.add(cameraFill);

  // --- Entity visual -----------------------------------------------------
  const visual = buildEntityVisual(entity);
  scene.add(visual.root);

  // --- Grid (hidden by default; toggled via command) ---------------------
  const grid = new THREE.GridHelper(10, 10, 0x666b78, 0x3a3f4b);
  grid.position.y = -1; // beneath the entity
  grid.visible = false;
  scene.add(grid);

  // --- Renderer + camera -------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(
    typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio, 2),
  );
  renderer.setSize(256, 256, false);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 2, 5);
  camera.lookAt(0, 0, 0);

  const dispose = (): void => {
    renderer.dispose();
    visual.dispose();
    scene.traverse((obj) => {
      if (obj instanceof THREE.GridHelper) {
        obj.geometry.dispose();
        const mat = obj.material as THREE.Material | THREE.Material[];
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) m.dispose();
      }
    });
  };

  return {
    scene,
    renderer,
    camera,
    grid,
    wireframeMaterials: visual.wireframeMaterials,
    cameraFill,
    dispose,
  };
}

// ---------------------------------------------------------------------------
// React component
// ---------------------------------------------------------------------------

export function EntityPreviewPanel(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasHostRef = React.useRef<HTMLDivElement | null>(null);
  const handleRef = React.useRef<PreviewSceneHandle | null>(null);
  const rafRef = React.useRef<number | null>(null);

  // Phase 2: hardcoded to the "light" entity. Wave 3 sources this from
  // EntityListPanel's selected-id state.
  const activeEntity: EntityRow = MOCK_ENTITIES[0];

  const [size, setSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // --- Camera orbital state ------------------------------------------
  const distanceRef = React.useRef<number>(
    clampDistance(readLSNumber(LS_CAM_DISTANCE, DEFAULT_DISTANCE)),
  );
  const yawRef = React.useRef<number>(readLSNumber(LS_CAM_YAW, DEFAULT_YAW));
  const pitchRef = React.useRef<number>(
    clampPitch(readLSNumber(LS_CAM_PITCH, DEFAULT_PITCH)),
  );

  const gridVisibleRef = React.useRef<boolean>(false);
  const wireframeRef = React.useRef<boolean>(false);

  const [, forceRerender] = React.useReducer((x: number) => x + 1, 0);

  // ----- Camera math --------------------------------------------------
  const updateCameraFromOrbit = React.useCallback(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const d = distanceRef.current;
    const yaw = yawRef.current;
    const pitch = pitchRef.current;
    // Target is the entity origin.
    const targetY = 0;
    const cy = Math.cos(pitch);
    const px = d * cy * Math.sin(yaw);
    const py = d * Math.sin(pitch) + targetY;
    const pz = d * cy * Math.cos(yaw);
    handle.camera.position.set(px, py, pz);
    handle.camera.lookAt(0, targetY, 0);
    // The fill light shadows the camera position so the entity always
    // has light coming from the viewer's POV.
    handle.cameraFill.position.copy(handle.camera.position);
  }, []);

  // ----- Mount Three.js ----------------------------------------------
  React.useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return;
    if (size.w < MIN_CANVAS_DIM || size.h < MIN_CANVAS_DIM) return;

    const handle = buildPreviewScene(activeEntity);
    handleRef.current = handle;
    host.appendChild(handle.renderer.domElement);
    handle.renderer.domElement.style.display = "block";
    handle.renderer.domElement.style.width = "100%";
    handle.renderer.domElement.style.height = "100%";

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
    // We intentionally re-mount when crossing the size threshold or the
    // active entity changes — both are part of the gate above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w >= MIN_CANVAS_DIM && size.h >= MIN_CANVAS_DIM, activeEntity.id]);

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
        id: "prefabs.preview.resetCamera",
        title: "Reset Preview Camera",
        category: "Prefabs Preview",
        keywords: ["prefabs", "preview", "camera", "reset", "default"],
        description:
          "Restore the entity preview camera to its default angle.",
        run: () => resetRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "prefabs.preview.zoomIn",
        title: "Zoom Preview In",
        category: "Prefabs Preview",
        keywords: ["prefabs", "preview", "zoom", "in", "closer"],
        description: "Move the entity preview camera closer to the entity.",
        run: () => zoomInRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "prefabs.preview.zoomOut",
        title: "Zoom Preview Out",
        category: "Prefabs Preview",
        keywords: ["prefabs", "preview", "zoom", "out", "farther"],
        description: "Move the entity preview camera farther from the entity.",
        run: () => zoomOutRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "prefabs.preview.toggleGrid",
        title: "Toggle Preview Grid",
        category: "Prefabs Preview",
        keywords: ["prefabs", "preview", "grid", "helper", "toggle"],
        description: "Show or hide the floor grid helper in the entity preview.",
        run: () => toggleGridRef.current(),
      }),
    );
    unregs.push(
      registerCommand({
        id: "prefabs.preview.toggleWireframe",
        title: "Toggle Preview Wireframe",
        category: "Prefabs Preview",
        keywords: ["prefabs", "preview", "wireframe", "solid", "toggle"],
        description:
          "Switch the entity preview between solid and wireframe shading.",
        run: () => toggleWireframeRef.current(),
      }),
    );
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // ----- Render ------------------------------------------------------
  const tooSmall =
    size.w > 0 &&
    size.h > 0 &&
    (size.w < MIN_CANVAS_DIM || size.h < MIN_CANVAS_DIM);
  const showToolbar = size.w >= MIN_TOOLBAR_WIDTH && !tooSmall;

  return (
    <div
      ref={containerRef}
      data-panel="entity-preview"
      className="relative h-full w-full overflow-hidden"
    >
      {tooSmall ? (
        <div className="absolute inset-0 flex items-center justify-center text-center px-2">
          <span className="text-[10px] uppercase tracking-wide text-(--color-fg-muted)">
            Resize panel
          </span>
        </div>
      ) : (
        <div
          ref={canvasHostRef}
          className="absolute inset-0 cursor-grab active:cursor-grabbing"
          style={{ touchAction: "none" }}
        />
      )}

      {showToolbar && (
        <div className="absolute top-1 right-1 flex items-center gap-1 z-10">
          <PreviewIconButton
            tooltipLabel="Reset camera"
            tooltipDescription="Restore the entity preview camera to its default angle."
            onClick={resetCamera}
          >
            <RotateCcw size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="Zoom in"
            tooltipDescription="Move the preview camera closer to the entity."
            onClick={zoomIn}
          >
            <ZoomIn size={14} />
          </PreviewIconButton>
          <PreviewIconButton
            tooltipLabel="Zoom out"
            tooltipDescription="Move the preview camera farther from the entity."
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
  id: "entity-preview",
  title: "Preview",
  icon: <Box size={12} />,
};

export default EntityPreviewPanel;
