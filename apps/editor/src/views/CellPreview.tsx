import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ResolvedPresetData, SceneLightmap } from "@two_5_d/engine";
import {
  Maximize2,
  Minimize2,
  RotateCw,
  RotateCcw,
  SlidersHorizontal,
  X as XIcon,
} from "lucide-react";
import { cn } from "../lib/cn";
import {
  Tooltip,
  IconButton,
  ToggleSwitch,
  SegmentedControl,
  Select,
  Slider,
  PreviewHost,
} from "../components/ui/index";
import type { PreviewEngine } from "../components/ui/index";

/**
 * CellPreview — right-rail 3D preview panel for the Map view.
 *
 * **Renders via the engine's own `WebGLRenderer`** (through the
 * `CellPreviewEngine` wrapper in `packages/engine/src/Preview/`),
 * NOT a separate Three.js scene. This is a deliberate architectural
 * choice — the previous Three.js implementation drifted from the
 * engine on every render-related change (wall height, partial walls,
 * reflectiveness, emissive light, baked lighting) and the per-feature
 * "does this match the engine?" bugs were a recurring cost.
 *
 * By driving the preview through the same renderer pipeline that
 * paints in-game pixels, this panel is guaranteed pixel-identical to
 * the engine's output. The only thing the editor wrapper owns is:
 *
 *   - synthesising the 3×3 `PreviewScene` from `MapSelectionInfo`
 *     (walls in centre, floor + ceiling across the whole 3×3),
 *   - orbit-camera state + drag-to-rotate UX,
 *   - layer-visibility toggles (W / F / C),
 *   - auto-rotate toggle (yaw spin on rAF when enabled),
 *   - the toolbar overlay (expand / shrink / close buttons).
 *
 * The engine wrapper handles every rendering decision: wall geometry,
 * materials, textures, partial-wall slabs, emissive area-lights,
 * reflections, fog, baked lightmaps — every preset field is honoured
 * automatically because the engine renderer is the one reading them.
 *
 * Dynamic-import keeps the engine renderer + WebGL machinery out of
 * the editor's initial chunk; the module loads only when MapView
 * mounts a `CellPreview`. The Three.js dep stays in the editor's
 * `package.json` because `FbxImporter` / `BakedSpritePreview` still
 * use it for FBX → spritesheet baking and AnimationEditor scratch
 * canvases — only the preview itself stops importing Three.
 */

export interface CellPreviewProps {
  /** Editor project id — needed to build an `IdbAssetPack` so the
   *  engine renderer can load preset textures from the project's
   *  IDB. Without this the preview can't paint real materials, so
   *  it falls through to the empty-state placeholder. */
  projectId: string;
  /** Preset id of the cell. `null` when no cell is selected. */
  presetId: string | null;
  /** Full resolved preset data. `null` when no preset (empty cell).
   *  Kept on the prop surface because the wrapper still uses it to
   *  render the "emissive" badge in the bottom corner. */
  presetData: ResolvedPresetData | null;
  /**
   * Cached object-URL for the preset's primary texture. Now unused
   * by the engine-backed preview (the engine loads textures itself
   * via the pack), but retained on the prop surface for API
   * stability with R4b call sites.
   */
  textureUrl?: string | null;
  /** Active layer label — used to decide which preset id goes into
   *  the centre cell's wall slot vs the floor / ceiling layers. */
  layer: "walls" | "floors" | "ceiling";
  /** Auto-rotate the preview around Y. Default true so authors see
   *  the cell from all sides without dragging. */
  autoRotate?: boolean;
  /** Fired when the user drags the canvas — the parent should disable
   *  auto-rotate so its toolbar toggle reflects the new state. */
  onAutoRotateChange?: (next: boolean) => void;
  /** Resolved floor preset for the selected cell. The engine reads
   *  the preset id (not this resolved data) — we re-derive the id
   *  from the existing `selection.floorPresetId` upstream. */
  floorPresetId?: string | null;
  floorPresetData?: ResolvedPresetData | null;
  floorTextureUrl?: string | null;
  /** Same shape as `floorPresetData` for the ceiling layer. */
  ceilingPresetId?: string | null;
  ceilingPresetData?: ResolvedPresetData | null;
  ceilingTextureUrl?: string | null;
  /** When true, render at a much larger size for the modal overlay. */
  expanded?: boolean;
  /** Fired when the user clicks the Maximize/Minimize button. */
  onToggleExpanded?: () => void;
  /** Fired when the user clicks the Close (X) on the expanded view. */
  onClose?: () => void;
  /**
   * Optional externally-owned orbit state. When provided, this ref
   * supersedes the component's internal orbit ref — drag / wheel /
   * auto-rotate writes go to the shared memory, and the rAF camera-
   * push loop reads from it. Used by MapView to keep the inline
   * preview + the expanded modal preview in lockstep (#253 follow-up).
   * If omitted, the component creates its own internal ref and behaves
   * exactly as before.
   */
  sharedOrbitRef?: React.MutableRefObject<CellPreviewOrbitState>;
  /** Controlled layer-visibility (R4b settings panel — lifted to MapView
   *  so the inline + modal previews stay in lockstep). Each pair is
   *  optional; when omitted the component falls back to internal state
   *  for API stability with older call sites. */
  showWalls?: boolean;
  setShowWalls?: (next: boolean) => void;
  showFloors?: boolean;
  setShowFloors?: (next: boolean) => void;
  showCeilings?: boolean;
  setShowCeilings?: (next: boolean) => void;
  /** Controlled room size (7 / 15 / 25 — odd only). Default 7 when omitted. */
  roomSize?: number;
  setRoomSize?: (next: number) => void;
  /** Floor preset override — when non-null, the preview synthesises
   *  the scene with this preset instead of the cell's own floor. */
  floorPresetOverride?: string | null;
  setFloorPresetOverride?: (next: string | null) => void;
  ceilingPresetOverride?: string | null;
  setCeilingPresetOverride?: (next: string | null) => void;
  /** Wall preset override — when non-null, the preview's OUTER
   *  perimeter cells use this preset as the surrounding wall context.
   *  The centre focus cell still uses the actual selected wall preset,
   *  so the author can preview their wall material against a different
   *  wall type as backdrop. */
  wallPresetOverride?: string | null;
  setWallPresetOverride?: (next: string | null) => void;
  /** Auto-rotate angular rate, in revolutions-per-minute. 1.0 = one
   *  full revolution per minute, 0.25 (default) = one per four
   *  minutes. The rAF integrator multiplies this by (2π / 60) to
   *  yield radians/second. */
  autoRotateSpeed?: number;
  setAutoRotateSpeed?: (next: number) => void;
  /** Full preset catalogue (id + label + sourcePath). CellPreview
   *  filters by sourcePath substring (`floors` / `ceilings`) to split
   *  the override dropdowns. */
  presetOptions?: ReadonlyArray<{
    id: string;
    label: string;
    sourcePath: string;
  }>;
  className?: string;
}

/** Dynamically-imported engine module. Cached so subsequent
 *  CellPreview mounts share the same module instance. Importing
 *  inside a Promise keeps the engine machinery out of the editor's
 *  initial chunk — the bundler treeshakes it into a separate split. */
let enginePromise:
  | Promise<typeof import("@two_5_d/engine")>
  | null = null;
function loadEngine(): Promise<typeof import("@two_5_d/engine")> {
  if (!enginePromise) enginePromise = import("@two_5_d/engine");
  return enginePromise;
}

/** Fixed canvas height (px) for the inline panel. The square aspect
 *  ratio is enforced by `aspectRatio` on the outer container. */
const CANVAS_HEIGHT_PX = 190;

/** Pitch limits for orbit. Clamped to ±30° (≈±0.524 rad) to match the
 *  cardboard game's natural head-tilt range — no overhead / underground
 *  views. The engine's `horizonOffset` mechanism handles vertical aim;
 *  the eye height stays pinned at 0.5 regardless of pitch (see
 *  CellPreviewEngine.deriveCamera). */
const PITCH_LIMIT = (30 * Math.PI) / 180;
const PITCH_MIN = -PITCH_LIMIT;
const PITCH_MAX = PITCH_LIMIT;
/** Drag sensitivity (radians per pixel) for yaw and pitch. */
const DRAG_SENSITIVITY = 0.005;
/** Wheel sensitivity (world units per deltaY pixel). */
const WHEEL_SENSITIVITY = 0.005;
/** Minimum zoom radius — close enough to read the wall texture
 *  around the focus cell. The maximum is dynamic and derived from
 *  the current `roomSize` (see `radiusMaxForSize` below) so the
 *  camera always stays inside the room regardless of the user's
 *  size selection. */
const RADIUS_MIN = 1.5;
/** Fixed eye height (cells) — half-cell, like a standing player. */
const EYE_HEIGHT = 0.5;
/** Default orbit radius — comfortably reads the focus cell with the
 *  enclosed-room context filling the periphery. Sized to fit inside the
 *  default 7×7 room (max radius 2.4) with margin. */
const DEFAULT_RADIUS = 2.0;
/** Safety buffer (cells) between the orbit circle and the interior face
 *  of the perimeter wall — prevents the camera from touching the wall
 *  exactly at any yaw. */
const RADIUS_SAFETY = 0.1;
/** Dynamic upper bound for orbit radius, derived from the room size.
 *  The room's playable interior runs from (1, 1) to (N-1, N-1) — the
 *  perimeter cells are walls, each 1 unit thick. With the focus cell
 *  at world (N/2, N/2) and the camera orbiting around it, the orbit
 *  circle must stay strictly inside that interior, so the radius caps
 *  at `N/2 - 1 - SAFETY`. The previous formula (`N/2 - 0.5`) only
 *  cleared the outer face of the perimeter wall, which let the camera
 *  clip INSIDE the perimeter wall geometry at certain angles.
 *
 *  Examples: size 7 → 2.4, size 15 → 6.4, size 25 → 11.4. */
function radiusMaxForSize(size: number): number {
  return size / 2 - 1 - RADIUS_SAFETY;
}

/**
 * Shape of CellPreview's orbit-camera state. Exposed so MapView can
 * hoist a single ref shared between the inline + expanded-modal
 * instances — drag/zoom/tilt in either updates the same memory, so
 * the other follows on its next rAF tick without React re-renders.
 *
 * The `dragging` / `lastX` / `lastY` drag-tracking fields are part of
 * the shared shape too. They're conceptually internal to a single
 * pointer interaction, but sharing them means a drag started in one
 * canvas and continued in the other behaves sensibly (rare, but
 * supported). Worst case the second canvas's pointer-up clears
 * `dragging: false` properly.
 */
export interface CellPreviewOrbitState {
  yaw: number;
  pitch: number;
  radius: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

/** Factory for the initial orbit state — yaw ~30° off-axis so the user
 *  sees one side face of the wall plus the floor/ceiling spread,
 *  rather than a head-on view that hides the depth of the surrounding
 *  cells. Pitch starts level; radius at the comfortable default. */
export function defaultCellPreviewOrbit(): CellPreviewOrbitState {
  return {
    yaw: Math.PI / 6,
    pitch: 0,
    radius: DEFAULT_RADIUS,
    dragging: false,
    lastX: 0,
    lastY: 0,
  };
}

/** Default room-scene dimensions. The focus cell sits in the middle of
 *  the grid (`floor(size/2)`); the outer perimeter forms an enclosed
 *  room while the inner area is open floor + ceiling. Room size is now
 *  user-controlled (7 / 15 / 25) — odd sizes only, so the focus cell
 *  index `floor(N/2)` sits exactly at world coords `(N/2, N/2)`, the
 *  room's geometric centre. With even sizes the focus was off-centre
 *  by half a cell and the orbit clipped outside the room at certain
 *  yaws (#272). Default 7 to keep the focus cell legible inside the
 *  small inline preview panel. */
const DEFAULT_ROOM_SIZE = 7;
/** Valid room sizes surfaced by the settings panel. Odd-only — see
 *  `DEFAULT_ROOM_SIZE` for the rationale. */
const ROOM_SIZE_OPTIONS = [7, 15, 25] as const;

/** Build a uniform-fill array of `size × size` cells. Used for the
 *  floor / ceiling layers, which always tile the focus preset across
 *  the whole room so the user sees how the material reads in volume
 *  (bake + reflectiveness spread naturally across cells). */
function fillRoom(id: string | null, size: number): (string | null)[] {
  const total = size * size;
  const arr: (string | null)[] = new Array(total);
  for (let i = 0; i < total; i++) arr[i] = id;
  return arr;
}

/**
 * Synthesise the engine `PreviewScene` (size×size "room") from the
 * selected cell. Behaviour varies by active layer:
 *
 *   - **walls**: outer perimeter (top / bottom / left / right rows)
 *     and the focus cell (col=size/2, row=size/2) all use the wall
 *     preset, creating an enclosed room context. Inner cells are
 *     open (no wall) so the user can see through the volume. When
 *     `wallOverride` is set, the perimeter cells use the override
 *     preset while the focus cell still uses the real preset — so
 *     authors can preview their wall in context of a DIFFERENT wall
 *     type as boundary. Floor + ceiling tile across all cells.
 *   - **floors**: no walls (full visibility into the floor tile);
 *     focus floor preset across the whole grid; focus ceiling
 *     preset across the whole grid so ambient lighting looks right.
 *   - **ceiling**: mirror of floors — no walls, uniform floor,
 *     focus ceiling preset across the whole grid.
 */
function synthesizePreviewScene(
  presetId: string | null,
  layer: "walls" | "floors" | "ceiling",
  floorId: string | null,
  ceilingId: string | null,
  size: number,
  wallOverride: string | null,
): {
  walls: (string | null)[];
  floors: (string | null)[];
  ceilings: (string | null)[];
  focusX: number;
  focusY: number;
} {
  const total = size * size;
  const walls: (string | null)[] = new Array(total).fill(null);
  const focusX = Math.floor(size / 2);
  const focusY = Math.floor(size / 2);
  if (layer === "walls" && presetId) {
    // Outer perimeter — the four edges of the size×size grid.
    // Override wins when set; otherwise the perimeter mirrors the
    // focus preset so the room reads as one material.
    const perimeterId = wallOverride ?? presetId;
    for (let i = 0; i < size; i++) {
      walls[0 * size + i] = perimeterId;             // top row
      walls[(size - 1) * size + i] = perimeterId;    // bottom row
      walls[i * size + 0] = perimeterId;             // left col
      walls[i * size + (size - 1)] = perimeterId;    // right col
    }
    // Focus cell — always uses the actual selected wall preset so
    // the author sees their material at the centre, even when the
    // surrounding cells were swapped to a different preset.
    walls[focusY * size + focusX] = presetId;
  }
  return {
    walls,
    floors: fillRoom(floorId, size),
    ceilings: fillRoom(ceilingId, size),
    focusX,
    focusY,
  };
}

export function CellPreview({
  projectId,
  presetId,
  presetData,
  layer,
  autoRotate = true,
  onAutoRotateChange,
  floorPresetId = null,
  floorPresetData = null,
  ceilingPresetId = null,
  ceilingPresetData = null,
  expanded = false,
  onToggleExpanded,
  onClose,
  sharedOrbitRef,
  showWalls: showWallsProp,
  setShowWalls: setShowWallsProp,
  showFloors: showFloorsProp,
  setShowFloors: setShowFloorsProp,
  showCeilings: showCeilingsProp,
  setShowCeilings: setShowCeilingsProp,
  roomSize: roomSizeProp,
  setRoomSize: setRoomSizeProp,
  floorPresetOverride: floorPresetOverrideProp,
  setFloorPresetOverride: setFloorPresetOverrideProp,
  ceilingPresetOverride: ceilingPresetOverrideProp,
  setCeilingPresetOverride: setCeilingPresetOverrideProp,
  wallPresetOverride: wallPresetOverrideProp,
  setWallPresetOverride: setWallPresetOverrideProp,
  autoRotateSpeed: autoRotateSpeedProp,
  setAutoRotateSpeed: setAutoRotateSpeedProp,
  presetOptions,
  className,
}: CellPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** SVG polyline that traces the four corners of the focus cell on
   *  the floor (z=0). Updated each rAF from the engine's projection
   *  helper so it tracks orbit yaw / pitch / radius without forcing
   *  a React re-render. Only rendered when the walls layer is active
   *  (the floor + ceiling layers fill the whole grid with the focus
   *  preset, so a single-cell highlight would be redundant there). */
  /** Engine wrapper instance — opaque type from `@two_5_d/engine`.
   *  Populated by the `PreviewEngine` adapter below once its async
   *  `mount` finishes. Every other effect in this file pushes scene
   *  / camera / visibility updates through this ref. */
  const engineRef = useRef<{
    setScene: (scene: {
      walls: (string | null)[];
      floors: (string | null)[];
      ceilings: (string | null)[];
      focusX?: number;
      focusY?: number;
    }) => void;
    setCamera: (c: { yaw?: number; pitch?: number; radius?: number; height?: number }) => void;
    setLayerVisibility: (w: boolean, f: boolean, c: boolean) => void;
    projectWorldToScreen: (
      wx: number,
      wy: number,
      wz: number,
    ) => { x: number; y: number } | null;
    resize: (w: number, h: number) => void;
    dispose: () => void;
  } | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Layer-visibility toggles. Default all on — the engine treats
  // hidden layers as empty cells, so shadows / AO / reflections
  // honour the toggle automatically.
  //
  // **Controlled / uncontrolled hybrid.** MapView lifts these (and the
  // settings-panel state below) so the inline + modal CellPreview
  // instances stay in lockstep. When a prop pair (value + setter) is
  // omitted, fall back to internal `useState` for API stability with
  // older call sites.
  const [showWallsLocal, setShowWallsLocal] = useState(true);
  const [showFloorLocal, setShowFloorLocal] = useState(true);
  const [showCeilingLocal, setShowCeilingLocal] = useState(true);
  const showWalls = showWallsProp ?? showWallsLocal;
  const setShowWalls = setShowWallsProp ?? setShowWallsLocal;
  const showFloor = showFloorsProp ?? showFloorLocal;
  const setShowFloor = setShowFloorsProp ?? setShowFloorLocal;
  const showCeiling = showCeilingsProp ?? showCeilingLocal;
  const setShowCeiling = setShowCeilingsProp ?? setShowCeilingLocal;

  // Room size + per-preview floor / ceiling overrides. Same controlled /
  // uncontrolled pattern — see the layer-visibility block above.
  const [roomSizeLocal, setRoomSizeLocal] = useState(DEFAULT_ROOM_SIZE);
  const [floorOverrideLocal, setFloorOverrideLocal] = useState<string | null>(
    null,
  );
  const [ceilingOverrideLocal, setCeilingOverrideLocal] = useState<
    string | null
  >(null);
  const [wallOverrideLocal, setWallOverrideLocal] = useState<string | null>(
    null,
  );
  /** Default auto-rotate speed — 0.25 rev/min ≈ one full revolution
   *  every four minutes. Slow enough that the cell is readable while
   *  the camera drifts. */
  const [autoRotateSpeedLocal, setAutoRotateSpeedLocal] = useState(0.25);
  const roomSize = roomSizeProp ?? roomSizeLocal;
  const setRoomSize = setRoomSizeProp ?? setRoomSizeLocal;
  const floorOverride =
    floorPresetOverrideProp !== undefined
      ? floorPresetOverrideProp
      : floorOverrideLocal;
  const setFloorOverride =
    setFloorPresetOverrideProp ?? setFloorOverrideLocal;
  const ceilingOverride =
    ceilingPresetOverrideProp !== undefined
      ? ceilingPresetOverrideProp
      : ceilingOverrideLocal;
  const setCeilingOverride =
    setCeilingPresetOverrideProp ?? setCeilingOverrideLocal;
  const wallOverride =
    wallPresetOverrideProp !== undefined
      ? wallPresetOverrideProp
      : wallOverrideLocal;
  const setWallOverride =
    setWallPresetOverrideProp ?? setWallOverrideLocal;
  const autoRotateSpeed = autoRotateSpeedProp ?? autoRotateSpeedLocal;
  const setAutoRotateSpeed = setAutoRotateSpeedProp ?? setAutoRotateSpeedLocal;

  // Effective floor / ceiling preset ids — override wins when set.
  const effectiveFloorId = floorOverride ?? floorPresetId ?? null;
  const effectiveCeilingId = ceilingOverride ?? ceilingPresetId ?? null;

  // Settings-panel open state. Filter icon toggles this; panel renders
  // via `createPortal` to escape the preview's container bounds (the
  // small sidebar preview is only ~190px tall, so the panel would clip
  // without a portal).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const settingsPanelRef = useRef<HTMLDivElement | null>(null);
  const [settingsPanelStyle, setSettingsPanelStyle] = useState<
    React.CSSProperties
  >({});

  // Orbit state. Initial yaw ~30° off-axis (Math.PI/6) so the user
  // sees one side face of the wall plus the floor/ceiling spread,
  // rather than a head-on view that hides the depth of the
  // surrounding cells. Pitch starts level — vertical drag tilts the
  // gaze (clamped ±30°), not the eye position; mouse wheel adjusts
  // `radius` within [RADIUS_MIN, RADIUS_MAX].
  //
  // Always create the internal ref (rules-of-hooks: useRef must be
  // called unconditionally) then prefer the externally-supplied
  // `sharedOrbitRef` when MapView wants the inline + modal previews
  // to share orbit state. The internal ref is then unused but cheap.
  const internalOrbitRef = useRef<CellPreviewOrbitState>(
    defaultCellPreviewOrbit(),
  );
  const orbitRef = sharedOrbitRef ?? internalOrbitRef;
  /** Auto-rotate yaw integration — only runs when the toggle is on
   *  and the user isn't dragging. Stored on a ref so the rAF
   *  callback reads the latest value without re-binding. */
  const autoRotateRef = useRef(autoRotate);
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);
  /** Auto-rotate speed (rev/min) on a ref so the rAF camera loop
   *  reads the latest slider value without forcing a re-bind. */
  const autoRotateSpeedRef = useRef(autoRotateSpeed);
  useEffect(() => {
    autoRotateSpeedRef.current = autoRotateSpeed;
  }, [autoRotateSpeed]);

  // ── PreviewEngine adapter ────────────────────────────────────────
  // Wraps the cardboard `CellPreviewEngine` behind the generic
  // `PreviewEngine` interface that `PreviewHost` consumes. The
  // adapter's identity is keyed on `projectId` so PreviewHost
  // disposes + remounts only when the project changes — every other
  // input (preset / layer / room size / visibility) flows through
  // imperative setters in the effects below.
  //
  // Refs hold the "current values at first mount" inputs so the
  // adapter can capture them without participating in React's
  // identity comparison. The push effects below keep the engine in
  // sync after the initial mount.
  const initialScenePropsRef = useRef({
    presetId,
    layer,
    effectiveFloorId,
    effectiveCeilingId,
    roomSize,
    wallOverride,
    showWalls,
    showFloor,
    showCeiling,
    orbitRef,
  });
  // Keep the ref in sync on every render so the next adapter
  // rebuild (when projectId changes) sees the latest inputs.
  initialScenePropsRef.current = {
    presetId,
    layer,
    effectiveFloorId,
    effectiveCeilingId,
    roomSize,
    wallOverride,
    showWalls,
    showFloor,
    showCeiling,
    orbitRef,
  };

  // Track ready state so PreviewHost can hide its loading overlay
  // exactly when our internal `ready` flag flips. Mirrors the
  // semantics of the previous in-component bootstrap effect.
  const setReadyRef = useRef(setReady);
  setReadyRef.current = setReady;
  const setErrorRef = useRef(setError);
  setErrorRef.current = setError;

  const previewEngine = useMemo<PreviewEngine>(() => {
    let readyPromise: Promise<void> | null = null;
    let canvas: HTMLCanvasElement | null = null;
    return {
      async mount(c) {
        canvas = c;
        if (!projectId) {
          // No project → can't load the IDB pack. Resolve as a
          // no-op; the outer empty-state overlay covers the canvas
          // so the user never sees a half-mounted preview.
          return;
        }
        const mod = await loadEngine();
        const pack = await mod.IdbAssetPack.fromProject(projectId);
        const props = initialScenePropsRef.current;
        const initial = synthesizePreviewScene(
          props.presetId,
          props.layer,
          props.effectiveFloorId,
          props.effectiveCeilingId,
          props.roomSize,
          props.wallOverride,
        );
        const engine = new mod.CellPreviewEngine({
          canvas: c,
          pack,
          scene: initial,
          camera: {
            yaw: props.orbitRef.current.yaw,
            pitch: props.orbitRef.current.pitch,
            radius: props.orbitRef.current.radius,
            height: 0.5,
          },
          showWalls: props.showWalls,
          showFloors: props.showFloor,
          showCeilings: props.showCeiling,
        });
        engineRef.current = engine as unknown as typeof engineRef.current;
        readyPromise = (engine as unknown as {
          ready: () => Promise<void>;
        }).ready();
      },
      ready() {
        // Resolves once tile / sprite uploads finish — gates
        // PreviewHost's loading overlay so it drops only when the
        // first real frame is about to paint.
        const p = readyPromise ?? Promise.resolve();
        return p.then(() => {
          setReadyRef.current(true);
        });
      },
      resize(w, h) {
        engineRef.current?.resize(w, h);
      },
      dispose() {
        if (engineRef.current) {
          try {
            engineRef.current.dispose();
          } catch {
            /* swallow */
          }
          engineRef.current = null;
        }
        canvas = null;
        readyPromise = null;
        setReadyRef.current(false);
      },
    };
    // Intentionally only re-create when projectId flips — see the
    // adapter's docstring above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const handlePreviewError = (err: Error) => {
    setErrorRef.current(err.message);
  };

  // ── Scene composition push ───────────────────────────────────────
  // Whenever the selection / layer / preset data changes, send a
  // fresh `PreviewScene` to the engine. The engine re-resolves
  // preset → tile-id internally via PresetResolver (cached) so this
  // is sub-ms.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = synthesizePreviewScene(
      presetId,
      layer,
      effectiveFloorId,
      effectiveCeilingId,
      roomSize,
      wallOverride,
    );
    engine.setScene(next);
  }, [
    presetId,
    layer,
    effectiveFloorId,
    effectiveCeilingId,
    roomSize,
    wallOverride,
    // `ready` is in the dep list so that once the async engine bootstrap
    // resolves (engineRef populated + first frame ready), the scene gets
    // re-pushed with the current resolved override / size state — covers
    // the race where overrides changed during bootstrap.
    ready,
    // presetData / floorPresetData / ceilingPresetData are not direct
    // inputs to the engine (the engine reads from the pack via id),
    // but a change in the resolved data implies a change in the
    // pack's preset library — refresh the scene so renderer state
    // re-reads it.
    presetData,
    floorPresetData,
    ceilingPresetData,
  ]);

  // ── Layer-visibility push ────────────────────────────────────────
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLayerVisibility(showWalls, showFloor, showCeiling);
  }, [showWalls, showFloor, showCeiling]);

  // Resize on container size change is now handled by PreviewHost
  // via its ResizeObserver — PreviewEngine.resize forwards to the
  // engine's GL resize.

  // ── Auto-rotate + camera push loop ───────────────────────────────
  // Drives a rAF that spins `orbitRef.yaw` when auto-rotate is on
  // and the user isn't dragging, then pushes the orbit state to
  // the engine. The engine itself runs its own render-rAF — this
  // loop only owns the camera state + the focus-cell SVG overlay.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (autoRotateRef.current && !orbitRef.current.dragging) {
        // `autoRotateSpeed` is in revolutions-per-minute. Convert to
        // radians-per-second: rev/min × (2π rad / rev) × (1 min / 60 s).
        // Slider default of 0.25 ⇒ one revolution every four minutes.
        const radPerSec =
          (autoRotateSpeedRef.current * Math.PI * 2) / 60;
        orbitRef.current.yaw += dt * radPerSec;
      }
      const engine = engineRef.current;
      if (engine) {
        engine.setCamera({
          yaw: orbitRef.current.yaw,
          pitch: orbitRef.current.pitch,
          radius: orbitRef.current.radius,
          height: EYE_HEIGHT,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // Depend on orbitRef IDENTITY — if MapView swaps in `sharedOrbitRef`
    // after first mount, we need to re-establish the rAF closure so it
    // reads from the live ref (otherwise the small preview's rAF would
    // keep reading from the stale internalOrbitRef while the pointer
    // handlers, recreated each render, write to the new shared ref).
    // In practice both refs are stable, so this re-runs at most once.
  }, [orbitRef]);

  // ── Drag-to-rotate ───────────────────────────────────────────────
  // Raw pointer events; no OrbitControls dep. Horizontal drag yaws the
  // orbit, vertical drag pitches the gaze (clamped ±30°). The drag
  // toggles auto-rotate off via the parent-supplied callback.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    orbitRef.current.dragging = true;
    orbitRef.current.lastX = e.clientX;
    orbitRef.current.lastY = e.clientY;
    if (autoRotate && onAutoRotateChange) onAutoRotateChange(false);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!orbitRef.current.dragging) return;
    const dx = e.clientX - orbitRef.current.lastX;
    const dy = e.clientY - orbitRef.current.lastY;
    orbitRef.current.lastX = e.clientX;
    orbitRef.current.lastY = e.clientY;
    // Yaw: horizontal drag orbits around the wall (Y axis).
    orbitRef.current.yaw -= dx * DRAG_SENSITIVITY;
    // Pitch: vertical drag tilts the gaze up / down. Drag-up (negative
    // dy) tilts the view *up* (positive pitch), matching cursor-aim
    // direction. Clamped to ±30° to match the cardboard head range.
    orbitRef.current.pitch = Math.max(
      PITCH_MIN,
      Math.min(PITCH_MAX, orbitRef.current.pitch - dy * DRAG_SENSITIVITY),
    );
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!orbitRef.current.dragging) return;
    try {
      (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
    } catch { /* already released */ }
    orbitRef.current.dragging = false;
  };

  // ── Wheel-to-zoom ────────────────────────────────────────────────
  // React's `onWheel` is passive by default in modern React, which
  // means `preventDefault()` is a no-op and the page scrolls under
  // us. Bind the native listener imperatively with `passive: false`
  // so the wheel adjusts `radius` instead of scrolling the editor.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !presetId) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = orbitRef.current.radius + e.deltaY * WHEEL_SENSITIVITY;
      // Upper bound is room-size-dependent — keeps the camera inside
      // the perimeter walls regardless of which size the author picked.
      const maxR = radiusMaxForSize(roomSize);
      orbitRef.current.radius = Math.max(
        RADIUS_MIN,
        Math.min(maxR, next),
      );
      // Wheel-zoom pauses auto-rotate too — feels jarring otherwise.
      if (autoRotate && onAutoRotateChange) onAutoRotateChange(false);
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, [presetId, autoRotate, onAutoRotateChange, roomSize]);

  // When the user shrinks the room (e.g. 25 → 7 via the SegmentedControl),
  // the previously-good orbit radius may now sit outside the new
  // perimeter walls. Clamp the current radius down on every room-size
  // change so the camera stays inside the room without waiting for the
  // next wheel event. Writes directly to the live orbit ref (shared or
  // internal) — the rAF camera loop reads it on its next tick.
  useEffect(() => {
    const max = radiusMaxForSize(roomSize);
    if (orbitRef.current.radius > max) {
      orbitRef.current.radius = max;
    }
  }, [roomSize, orbitRef]);

  // Position the settings panel relative to the Filter-icon trigger.
  // Right-align by default (panel's right edge matches trigger's right
  // edge); flip to left-align if it would overflow the viewport. Uses
  // `position: fixed` + body-level portal so the panel escapes the
  // small preview container — without that the sidebar preview clips
  // the panel and the modal's backdrop traps z-index.
  const SETTINGS_PANEL_WIDTH = 280;
  useLayoutEffect(() => {
    if (!settingsOpen || !settingsTriggerRef.current) return;
    const rect = settingsTriggerRef.current.getBoundingClientRect();
    const top = rect.bottom + 6;
    // Default: anchor panel's right edge to trigger's right edge.
    let left = rect.right - SETTINGS_PANEL_WIDTH;
    if (left < 8) {
      // Would clip off the left of the viewport — flip to left-align.
      left = rect.left;
      const overflowRight = left + SETTINGS_PANEL_WIDTH - window.innerWidth + 8;
      if (overflowRight > 0) left -= overflowRight;
    }
    setSettingsPanelStyle({
      position: "fixed",
      top,
      left,
      width: SETTINGS_PANEL_WIDTH,
      zIndex: 1000,
    });
  }, [settingsOpen, expanded]);

  // Outside-click + Escape close for the settings panel. Excludes both
  // the trigger and the portal'd panel so clicks inside either keep it
  // open.
  useEffect(() => {
    if (!settingsOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (settingsTriggerRef.current?.contains(target)) return;
      if (settingsPanelRef.current?.contains(target)) return;
      setSettingsOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  // Reset camera — restore the shared orbit ref to its default state.
  // Writes happen on the live ref (whether shared or internal); the
  // rAF camera-push loop picks the new values up on its next tick.
  const handleResetCamera = () => {
    const def = defaultCellPreviewOrbit();
    orbitRef.current.yaw = def.yaw;
    orbitRef.current.pitch = def.pitch;
    orbitRef.current.radius = def.radius;
    orbitRef.current.dragging = false;
    orbitRef.current.lastX = def.lastX;
    orbitRef.current.lastY = def.lastY;
  };

  // Split preset options into floor / ceiling candidate lists. Default
  // pack convention: preset files are named `walls.jsonc` /
  // `floors.jsonc` / `ceilings.jsonc`, and `sourcePath` carries that
  // file path verbatim. For third-party packs that don't follow the
  // convention, presets without "floor" / "ceiling" in their source
  // path fall through to BOTH lists (acceptable — author can still
  // select them; the engine doesn't care which slot a preset goes in).
  const floorPresetChoices = React.useMemo(() => {
    if (!presetOptions) return [];
    return presetOptions.filter((p) => {
      const sp = p.sourcePath.toLowerCase();
      if (sp.includes("floor")) return true;
      // Fall-through: presets with no clear file-name signal appear in
      // both floor + ceiling lists.
      return !sp.includes("wall") && !sp.includes("ceiling");
    });
  }, [presetOptions]);
  const ceilingPresetChoices = React.useMemo(() => {
    if (!presetOptions) return [];
    return presetOptions.filter((p) => {
      const sp = p.sourcePath.toLowerCase();
      if (sp.includes("ceiling")) return true;
      return !sp.includes("wall") && !sp.includes("floor");
    });
  }, [presetOptions]);
  /** Wall preset candidates for the preview's outer-perimeter override.
   *  Same convention as floor / ceiling: presets whose source-path
   *  contains "wall" qualify; presets with no clear file-name signal
   *  fall through into all three lists so author-defined packs that
   *  don't follow the naming convention still appear. */
  const wallPresetChoices = React.useMemo(() => {
    if (!presetOptions) return [];
    return presetOptions.filter((p) => {
      const sp = p.sourcePath.toLowerCase();
      if (sp.includes("wall")) return true;
      return !sp.includes("floor") && !sp.includes("ceiling");
    });
  }, [presetOptions]);

  // Expanded sizing — same bounds as the previous implementation.
  // Width is only forced in expanded mode; inline mode uses the
  // parent's width via `w-full` on the outer wrapper class.
  const wrapperStyle: React.CSSProperties | undefined = expanded
    ? { width: "min(80vw, 800px)", height: "min(70vh, 700px)" }
    : undefined;

  // Custom error / loading / empty-state overlays that match the
  // previous CellPreview look + copy. Routed through PreviewHost's
  // `errorFallback` / `loadingFallback` slots so the host's R2
  // chrome wraps consistently.
  const loadingFallback = (
    <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 pointer-events-none">
      Loading preview…
    </div>
  );
  const errorFallback = error ? (
    <div className="absolute inset-0 flex items-center justify-center text-xs text-red-300 px-4 text-center pointer-events-none">
      Preview failed: {error}
    </div>
  ) : undefined;

  return (
    <div
      // Apply expanded-mode shadow + w-full sizing here; the
      // PreviewHost provides the inner canvas chrome (border,
      // bg, overflow). Stacking the two wrappers keeps the
      // outer presentational class surface decoupled from the
      // mount primitive (#261).
      className={cn(
        expanded ? "shadow-2xl shadow-black/60" : "w-full",
        className,
      )}
      style={wrapperStyle}
    >
      <PreviewHost
        engine={previewEngine}
        onError={handlePreviewError}
        aspectRatio={expanded ? undefined : undefined}
        fixedHeight={expanded ? undefined : CANVAS_HEIGHT_PX}
        className={cn("h-full w-full")}
        loadingFallback={presetId ? loadingFallback : null}
        errorFallback={errorFallback}
      >
      {/* Overlay layer — orbit drag surface, wheel zoom target.
          Sits above the canvas (PreviewHost mounts the canvas
          under `absolute inset-0`) and below the toolbar /
          settings panel siblings. Pointer-events are gated by
          `presetId` so the empty-state placeholder isn't
          accidentally interactive. */}
      <div
        ref={containerRef}
        className={cn(
          "absolute inset-0",
          presetId ? "cursor-grab active:cursor-grabbing" : "",
        )}
        onPointerDown={presetId ? onPointerDown : undefined}
        onPointerMove={presetId ? onPointerMove : undefined}
        onPointerUp={presetId ? onPointerUp : undefined}
        onPointerCancel={presetId ? onPointerUp : undefined}
      />

      {/* Empty-state overlay. PreviewHost's own loading / error
          fallbacks cover the bootstrap path; this one covers
          the "no cell selected" case where we never mount. */}
      {!presetId ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-xs text-zinc-500 px-4 pointer-events-none">
          <span className="text-2xl opacity-40">⌖</span>
          <span>Select a cell to preview</span>
        </div>
      ) : null}

      {/* Settings + expand/close. Top-right overlay.
          The W/F/C trio was replaced by a single Filter icon that opens
          a Sketchfab-style settings panel (#268). Wrapper keeps the
          translucent backdrop so ghost-variant icons stay legible
          against the 3D scene. */}
      {presetId && !error ? (
        <div className="absolute top-1.5 right-1.5 flex items-center gap-1 bg-zinc-950/70 backdrop-blur-sm border border-zinc-800/80 rounded-md px-1 py-0.5 shadow-md">
          <Tooltip content="Preview settings">
            <IconButton
              ref={settingsTriggerRef}
              size="sm"
              variant={settingsOpen ? "primary" : "ghost"}
              tooltip="Preview settings"
              icon={<SlidersHorizontal size={14} />}
              onClick={() => setSettingsOpen((v) => !v)}
            />
          </Tooltip>
          {onToggleExpanded ? (
            <>
              <span aria-hidden className="mx-0.5 h-5 w-px bg-zinc-700" />
              <Tooltip
                content={expanded ? "Shrink preview" : "Expand preview"}
              >
                <IconButton
                  size="sm"
                  variant="ghost"
                  tooltip={expanded ? "Shrink preview" : "Expand preview"}
                  icon={
                    expanded ? (
                      <Minimize2 size={14} />
                    ) : (
                      <Maximize2 size={14} />
                    )
                  }
                  onClick={onToggleExpanded}
                />
              </Tooltip>
            </>
          ) : null}
          {expanded && onClose ? (
            <Tooltip content="Close (Esc)">
              <IconButton
                size="sm"
                variant="ghost"
                tooltip="Close preview"
                icon={<XIcon size={14} />}
                onClick={onClose}
              />
            </Tooltip>
          ) : null}
        </div>
      ) : null}

      {/* Sketchfab-style settings panel — body-level portal so the panel
          escapes the preview's container bounds (the small sidebar
          preview is only ~190px tall; without a portal the panel
          would clip). Positioning is computed in `useLayoutEffect`
          above — right-aligned to trigger by default, flips left if
          it would clip the left viewport edge. */}
      {settingsOpen && presetId && !error
        ? createPortal(
            <div
              ref={settingsPanelRef}
              style={settingsPanelStyle}
              className={cn(
                "bg-zinc-900/85 backdrop-blur-md",
                "border border-zinc-700 rounded-lg shadow-2xl",
                "p-4 text-zinc-100",
              )}
              role="dialog"
              aria-label="Preview settings"
            >
              {/* Layer visibility -------------------------------- */}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                  Layer visibility
                </div>
                <div className="space-y-1.5">
                  <SettingsToggleRow
                    label="Walls"
                    checked={showWalls}
                    onChange={setShowWalls}
                  />
                  <SettingsToggleRow
                    label="Floors"
                    checked={showFloor}
                    onChange={setShowFloor}
                  />
                  <SettingsToggleRow
                    label="Ceiling"
                    checked={showCeiling}
                    onChange={setShowCeiling}
                  />
                </div>
              </div>

              {/* Room size --------------------------------------- */}
              <div className="border-t border-zinc-800 pt-3 mt-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                  Room size
                </div>
                <SegmentedControl
                  size="sm"
                  aria-label="Room size"
                  value={String(roomSize)}
                  onChange={(next) => {
                    if (!next) return;
                    setRoomSize(Number(next));
                  }}
                  options={ROOM_SIZE_OPTIONS.map((n) => ({
                    id: String(n),
                    label: `${n}×${n}`,
                  }))}
                />
              </div>

              {/* Wall preset (preview override) ------------------ */}
              {/* Lives ABOVE floor / ceiling so the order in the
                  panel mirrors the natural Z-stack: walls form the
                  vertical boundary, then floor + ceiling cap top
                  and bottom. Override only affects the OUTER
                  perimeter cells; the centre focus cell keeps the
                  actual selected preset so the author sees their
                  wall in context. */}
              <div className="border-t border-zinc-800 pt-3 mt-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                  Wall preset (preview)
                </div>
                <Select
                  size="sm"
                  value={wallOverride ?? "__cell__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setWallOverride(v === "__cell__" ? null : v);
                  }}
                  options={[
                    { value: "__cell__", label: "Use cell's wall preset" },
                    ...wallPresetChoices.map((p) => ({
                      value: p.id,
                      label: p.label,
                    })),
                  ]}
                />
              </div>

              {/* Floor preset (preview override) ----------------- */}
              <div className="border-t border-zinc-800 pt-3 mt-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                  Floor preset (preview)
                </div>
                <Select
                  size="sm"
                  value={floorOverride ?? "__cell__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFloorOverride(v === "__cell__" ? null : v);
                  }}
                  options={[
                    { value: "__cell__", label: "Use cell's floor" },
                    ...floorPresetChoices.map((p) => ({
                      value: p.id,
                      label: p.label,
                    })),
                  ]}
                />
              </div>

              {/* Ceiling preset (preview override) --------------- */}
              <div className="border-t border-zinc-800 pt-3 mt-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                  Ceiling preset (preview)
                </div>
                <Select
                  size="sm"
                  value={ceilingOverride ?? "__cell__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    setCeilingOverride(v === "__cell__" ? null : v);
                  }}
                  options={[
                    { value: "__cell__", label: "Use cell's ceiling" },
                    ...ceilingPresetChoices.map((p) => ({
                      value: p.id,
                      label: p.label,
                    })),
                  ]}
                />
              </div>

              {/* Camera ------------------------------------------ */}
              <div className="border-t border-zinc-800 pt-3 mt-3">
                <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium mb-2">
                  Camera
                </div>
                <div className="space-y-2">
                  <SettingsToggleRow
                    label="Auto-rotate"
                    checked={autoRotate}
                    onChange={(v) => onAutoRotateChange?.(v)}
                    icon={<RotateCw size={12} />}
                  />
                  {/* Auto-rotate speed — revolutions-per-minute. Range
                      0.05 (slow drift, ≈20 min/rev) → 1.0 (one full
                      revolution per minute). The integrator multiplies
                      this by (2π / 60) to get rad/s. */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-zinc-200 select-none shrink-0">
                      Speed
                    </span>
                    <Slider
                      className="flex-1"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={autoRotateSpeed}
                      onChange={setAutoRotateSpeed}
                      valueLabel={`${autoRotateSpeed.toFixed(2)}×`}
                      disabled={!autoRotate}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleResetCamera}
                    className={cn(
                      "w-full inline-flex items-center justify-center gap-1.5",
                      "h-8 px-3 rounded-md text-xs font-medium",
                      "border border-zinc-700 bg-zinc-800/50",
                      "text-zinc-200 hover:bg-zinc-800 hover:text-zinc-50",
                      "transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
                    )}
                  >
                    <RotateCcw size={12} />
                    Reset camera
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* Preset label badge — bottom-left. */}
      {presetId ? (
        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-center justify-between gap-2 pointer-events-none">
          <span className="text-[10px] font-mono text-zinc-200 bg-zinc-950/80 border border-zinc-800 rounded px-1.5 py-0.5 truncate max-w-full">
            {presetId}
          </span>
          {presetData?.emissive ? (
            <span className="text-[9px] uppercase tracking-wider text-amber-300 bg-amber-500/15 border border-amber-500/40 rounded px-1 py-0.5">
              emissive
            </span>
          ) : null}
        </div>
      ) : null}
      </PreviewHost>
    </div>
  );
}

/**
 * Small inline row used inside the settings panel — a label on the
 * left and an R2 `ToggleSwitch` on the right. Local to CellPreview
 * because the layout is panel-specific (no PropertyRow wrapper — the
 * panel uses its own spacing rhythm).
 */
function SettingsToggleRow({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-zinc-200 cursor-pointer select-none">
      <span className="inline-flex items-center gap-2">
        {icon ? (
          <span className="text-zinc-400 inline-flex items-center justify-center w-3 h-3">
            {icon}
          </span>
        ) : null}
        {label}
      </span>
      <ToggleSwitch
        size="sm"
        aria-label={label}
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
}
