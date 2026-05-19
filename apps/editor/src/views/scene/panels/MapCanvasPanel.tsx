import React from "react";
import { Eye, EyeOff, Map as MapIcon, Plus } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { MOCK_LAYERS, MOCK_SCENE_SETTINGS, type LayerRow } from "../scene-fixtures";

/**
 * MapCanvasPanel — the Scene page's primary top-down map canvas.
 *
 * Visual target: the centre region in `Editor Design/Map.png`. A 2D
 * top-down grid sized to the scene's `dimensions` (64×64 for the
 * fixture scene), letterboxed inside whatever the dock hands us. A
 * sparse set of pre-painted sample cells communicates the "tile per
 * layer" model — floors, walls, doors, sprites — and a floating
 * layer-chip strip pinned to the bottom edge exposes visibility +
 * active-layer state. Wave 3 swaps the sample cells for real
 * `EditorProjectStore` selectors; Wave 2's job is to wire the
 * canvas, selection, layer chip strip, and command-registry surface
 * so painting can land on top.
 *
 * The panel is registered with `surface: false` + `headerless: true`
 * in MapView so it renders flush against the dock — no panel chrome,
 * no card padding. That makes it the editor's centerpiece, mirroring
 * how the design comp shows the map filling the middle column.
 *
 * Persistence (per-page localStorage):
 *   - `cardboard.scene.mapCanvas.selectedCell`        JSON `{x,y}` or null
 *   - `cardboard.scene.mapCanvas.activeLayerId`       string layer id
 *   - `cardboard.scene.mapCanvas.layerVisibility`     JSON Record<id, bool>
 *   - `cardboard.scene.mapCanvas.viewZoom`            number, default 1
 *   - `cardboard.scene.mapCanvas.viewPanX`            number, default 0
 *   - `cardboard.scene.mapCanvas.viewPanY`            number, default 0
 *
 * Commands registered:
 *   - scene.mapCanvas.fitToView
 *   - scene.mapCanvas.clearSelection
 *   - scene.mapCanvas.addLayer
 *   - scene.mapCanvas.toggleLayerVisibility.<layerId>   (dynamic)
 *   - scene.mapCanvas.setActiveLayer.<layerId>          (dynamic)
 */

// ---------------------------------------------------------------------------
// localStorage helpers — same shape as sibling panels.

const LS_SELECTED_CELL = "cardboard.scene.mapCanvas.selectedCell";
const LS_ACTIVE_LAYER = "cardboard.scene.mapCanvas.activeLayerId";
const LS_LAYER_VIS = "cardboard.scene.mapCanvas.layerVisibility";
const LS_ZOOM = "cardboard.scene.mapCanvas.viewZoom";
const LS_PAN_X = "cardboard.scene.mapCanvas.viewPanX";
const LS_PAN_Y = "cardboard.scene.mapCanvas.viewPanY";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const DEFAULT_ZOOM = 1.0;

/** Below this short-edge size the canvas renders a placeholder
 *  instead of trying to fit a 64×64 grid into a postage stamp. */
const MIN_RENDER_PX = 80;
/** Height of the floating layer-chip strip in CSS pixels. */
const CHIP_STRIP_HEIGHT = 40;

function readLS(key: string): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLS(key: string, value: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, value);
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function readLSNumber(key: string, fallback: number): number {
  const raw = readLS(key);
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readJSON<T>(key: string, fallback: T): T {
  const raw = readLS(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    writeLS(key, JSON.stringify(value));
  } catch {
    /* JSON.stringify can throw on circular refs — defensive only */
  }
}

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return DEFAULT_ZOOM;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// ---------------------------------------------------------------------------
// Sample painted cells. Hardcoded for Wave 2 so the canvas has visible
// content before the real scene tile store lands. Wave 3 replaces with
// `EditorProjectStore` cell reads.

interface PaintedCell {
  x: number;
  y: number;
  layerId: string;
  /** 6-digit `#RRGGBB`. Falls back to the layer's legend color if
   *  omitted — leaving it set per-cell lets us suggest tile variety
   *  (different brick tones, etc.) without inventing a tile fixture. */
  color?: string;
}

const SAMPLE_CELLS: readonly PaintedCell[] = [
  // A small room outline — walls on the perimeter, floors inside.
  { x: 10, y: 12, layerId: "walls", color: "#38bdf8" },
  { x: 11, y: 12, layerId: "walls", color: "#38bdf8" },
  { x: 12, y: 12, layerId: "walls", color: "#38bdf8" },
  { x: 13, y: 12, layerId: "walls", color: "#38bdf8" },
  { x: 14, y: 12, layerId: "walls", color: "#38bdf8" },
  { x: 10, y: 13, layerId: "walls", color: "#38bdf8" },
  { x: 10, y: 14, layerId: "walls", color: "#38bdf8" },
  { x: 14, y: 13, layerId: "walls", color: "#38bdf8" },
  { x: 14, y: 14, layerId: "walls", color: "#38bdf8" },
  { x: 10, y: 15, layerId: "walls", color: "#38bdf8" },
  { x: 12, y: 15, layerId: "walls", color: "#38bdf8" },
  { x: 13, y: 15, layerId: "walls", color: "#38bdf8" },
  { x: 14, y: 15, layerId: "walls", color: "#38bdf8" },
  // Door at (11,15) — the gap in the south wall.
  { x: 11, y: 15, layerId: "doors", color: "#10b981" },
  // Floor inside the room.
  { x: 11, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 12, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 13, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 11, y: 14, layerId: "floors", color: "#f59e0b" },
  { x: 12, y: 14, layerId: "floors", color: "#f59e0b" },
  { x: 13, y: 14, layerId: "floors", color: "#f59e0b" },
  // A sprite in the room (barrel) + another out in the open.
  { x: 12, y: 13, layerId: "sprites", color: "#a78bfa" },
  { x: 30, y: 24, layerId: "sprites", color: "#a78bfa" },
  // A short corridor of floors heading east from the room.
  { x: 15, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 16, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 17, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 18, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 19, y: 13, layerId: "floors", color: "#f59e0b" },
  { x: 20, y: 13, layerId: "floors", color: "#f59e0b" },
];

// Layer descriptions for the chip tooltips — mirrored from LayersPanel.
const LAYER_DESCRIPTIONS: Record<string, string> = {
  floors: "Floor tiles — the base walkable surface.",
  walls: "Wall tiles — block movement and sight, define rooms.",
  doors: "Door entities — interactive openings that gate movement.",
  sprites: "Sprite entities — items, decor, NPCs placed in the world.",
  lights: "Light sources — emissive points that bake into the scene.",
};

// ---------------------------------------------------------------------------
// Initial-state builders.

function defaultVisibility(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const l of MOCK_LAYERS) out[l.id] = l.visible;
  return out;
}

function defaultActiveId(): string {
  return MOCK_LAYERS[0]?.id ?? "";
}

// ---------------------------------------------------------------------------

export function MapCanvasPanel(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Container size — driven by ResizeObserver, used both for the
  // canvas backing-store sizing and for responsive layout decisions.
  const [size, setSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // Cursor coords (in cell space). null when the cursor isn't over a
  // valid cell. Displayed in a small chip pinned to the canvas; future
  // selection-store work feeds the same value into a centralized read.
  const [hoverCell, setHoverCell] = React.useState<{ x: number; y: number } | null>(
    null,
  );

  // Selected cell — sticky, persists across reloads. Wave 3 hooks this
  // into the real selection store; today it just paints a marker.
  const [selectedCell, setSelectedCell] = React.useState<{
    x: number;
    y: number;
  } | null>(() => readJSON<{ x: number; y: number } | null>(LS_SELECTED_CELL, null));

  // Per-layer visibility — toggled by the chip strip.
  const [visibility, setVisibility] = React.useState<Record<string, boolean>>(
    () => {
      const stored = readJSON<Record<string, boolean>>(
        LS_LAYER_VIS,
        defaultVisibility(),
      );
      return { ...defaultVisibility(), ...stored };
    },
  );

  // Active painting layer.
  const [activeLayerId, setActiveLayerId] = React.useState<string>(() => {
    const stored = readLS(LS_ACTIVE_LAYER);
    if (stored && MOCK_LAYERS.some((l) => l.id === stored)) return stored;
    return defaultActiveId();
  });

  // Zoom + pan. Pan is in CSS pixels relative to the letterboxed center;
  // zoom multiplies the fit-to-panel cell size. Persisted on settle.
  const [zoom, setZoom] = React.useState<number>(() =>
    clampZoom(readLSNumber(LS_ZOOM, DEFAULT_ZOOM)),
  );
  const [pan, setPan] = React.useState<{ x: number; y: number }>(() => ({
    x: readLSNumber(LS_PAN_X, 0),
    y: readLSNumber(LS_PAN_Y, 0),
  }));

  // ---- Persistence -------------------------------------------------

  React.useEffect(() => {
    writeJSON(LS_SELECTED_CELL, selectedCell);
  }, [selectedCell]);
  React.useEffect(() => {
    writeJSON(LS_LAYER_VIS, visibility);
  }, [visibility]);
  React.useEffect(() => {
    writeLS(LS_ACTIVE_LAYER, activeLayerId);
  }, [activeLayerId]);
  React.useEffect(() => {
    writeLS(LS_ZOOM, String(zoom));
  }, [zoom]);
  React.useEffect(() => {
    writeLS(LS_PAN_X, String(pan.x));
    writeLS(LS_PAN_Y, String(pan.y));
  }, [pan.x, pan.y]);

  // ---- ResizeObserver ----------------------------------------------

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cr = entry.contentRect;
        setSize({ w: Math.round(cr.width), h: Math.round(cr.height) });
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    return () => ro.disconnect();
  }, []);

  // Effective drawable area is the panel minus the bottom chip strip
  // (so the canvas never paints under the chips). Width is unchanged.
  const dims = MOCK_SCENE_SETTINGS.dimensions;
  const layout = React.useMemo(() => {
    const canvasW = size.w;
    const canvasH = Math.max(0, size.h - CHIP_STRIP_HEIGHT);
    if (canvasW <= 0 || canvasH <= 0) {
      return { cell: 0, offX: 0, offY: 0, gridW: 0, gridH: 0, canvasW, canvasH };
    }
    const fitCell = Math.min(canvasW / dims.w, canvasH / dims.h) * zoom;
    const cell = Math.max(0, fitCell);
    const gridW = cell * dims.w;
    const gridH = cell * dims.h;
    const offX = (canvasW - gridW) / 2 + pan.x;
    const offY = (canvasH - gridH) / 2 + pan.y;
    return { cell, offX, offY, gridW, gridH, canvasW, canvasH };
  }, [size.w, size.h, dims.w, dims.h, zoom, pan.x, pan.y]);

  // Per-id layer color lookup. Falls back to a neutral gray.
  const layerColorById = React.useMemo(() => {
    const out: Record<string, string> = {};
    for (const l of MOCK_LAYERS) out[l.id] = l.color;
    return out;
  }, []);

  // ---- Canvas paint ------------------------------------------------

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (layout.canvasW <= 0 || layout.canvasH <= 0) return;
    if (layout.canvasW < MIN_RENDER_PX || layout.canvasH < MIN_RENDER_PX) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(layout.canvasW * dpr));
    canvas.height = Math.max(1, Math.round(layout.canvasH * dpr));
    canvas.style.width = `${layout.canvasW}px`;
    canvas.style.height = `${layout.canvasH}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Background — dark editor tone.
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    const { cell, offX, offY, gridW, gridH } = layout;
    if (cell <= 0) return;

    // Scene playfield — slightly lighter so the grid sits on a visible
    // floor, like the comp.
    ctx.fillStyle = "#15151a";
    ctx.fillRect(offX, offY, gridW, gridH);

    // Painted sample cells — drawn before the grid so the lattice
    // reads on top. Filter by layer visibility. We respect MOCK_LAYERS
    // order so higher-index layers (sprites, lights) draw on top of
    // lower-index ones (floors, walls).
    const layerIndex = new Map<string, number>(
      MOCK_LAYERS.map((l, i) => [l.id, i]),
    );
    const cellsByOrder = SAMPLE_CELLS.slice().sort(
      (a, b) =>
        (layerIndex.get(a.layerId) ?? 0) - (layerIndex.get(b.layerId) ?? 0),
    );
    ctx.globalAlpha = 0.8;
    for (const c of cellsByOrder) {
      if (!visibility[c.layerId]) continue;
      const color = c.color ?? layerColorById[c.layerId] ?? "#888";
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.round(offX + c.x * cell),
        Math.round(offY + c.y * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      );
    }
    ctx.globalAlpha = 1;

    // Grid lattice — skip individual cell lines when each cell is
    // sub-pixel.
    if (cell >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= dims.w; x++) {
        const px = Math.round(offX + x * cell) + 0.5;
        ctx.moveTo(px, offY);
        ctx.lineTo(px, offY + gridH);
      }
      for (let y = 0; y <= dims.h; y++) {
        const py = Math.round(offY + y * cell) + 0.5;
        ctx.moveTo(offX, py);
        ctx.lineTo(offX + gridW, py);
      }
      ctx.stroke();
    }

    // Playfield border.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(offX) + 0.5,
      Math.round(offY) + 0.5,
      Math.round(gridW),
      Math.round(gridH),
    );

    // Hover cell indicator — amber outline, only when inside the
    // playfield.
    if (
      hoverCell &&
      hoverCell.x >= 0 &&
      hoverCell.x < dims.w &&
      hoverCell.y >= 0 &&
      hoverCell.y < dims.h &&
      cell >= 2
    ) {
      ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        Math.round(offX + hoverCell.x * cell) + 0.5,
        Math.round(offY + hoverCell.y * cell) + 0.5,
        Math.ceil(cell) - 1,
        Math.ceil(cell) - 1,
      );
    }

    // Selected cell — solid amber outline + faint fill.
    if (
      selectedCell &&
      selectedCell.x >= 0 &&
      selectedCell.x < dims.w &&
      selectedCell.y >= 0 &&
      selectedCell.y < dims.h
    ) {
      ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
      ctx.fillRect(
        Math.round(offX + selectedCell.x * cell),
        Math.round(offY + selectedCell.y * cell),
        Math.ceil(cell),
        Math.ceil(cell),
      );
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.round(offX + selectedCell.x * cell) + 0.5,
        Math.round(offY + selectedCell.y * cell) + 0.5,
        Math.ceil(cell) - 1,
        Math.ceil(cell) - 1,
      );
    }
  }, [
    layout,
    visibility,
    hoverCell,
    selectedCell,
    layerColorById,
    dims.w,
    dims.h,
  ]);

  // ---- Pointer handlers --------------------------------------------

  // Translate a canvas-local mouse position into a cell coord pair, or
  // null if the cursor is outside the playfield. Shared by hover +
  // click handlers.
  const cellAt = React.useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const { cell, offX, offY, gridW, gridH } = layout;
      if (cell <= 0) return null;
      if (
        localX < offX ||
        localX > offX + gridW ||
        localY < offY ||
        localY > offY + gridH
      )
        return null;
      const cx = Math.floor((localX - offX) / cell);
      const cy = Math.floor((localY - offY) / cell);
      if (cx < 0 || cx >= dims.w || cy < 0 || cy >= dims.h) return null;
      return { x: cx, y: cy };
    },
    [layout, dims.w, dims.h],
  );

  // Pan-drag state — held in a ref so the listener callbacks read the
  // freshest value without forcing a re-render per mousemove.
  const panDragRef = React.useRef<{
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);

  const handleMouseMove = React.useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = panDragRef.current;
      if (drag) {
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
        setPan({ x: drag.startPanX + dx, y: drag.startPanY + dy });
        return;
      }
      const c = cellAt(event.clientX, event.clientY);
      setHoverCell(c);
    },
    [cellAt],
  );

  const handleMouseLeave = React.useCallback(() => {
    setHoverCell(null);
  }, []);

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      // Middle-button or Alt+left starts a pan-drag. Anything else
      // falls through to the click handler for selection.
      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        event.preventDefault();
        panDragRef.current = {
          startClientX: event.clientX,
          startClientY: event.clientY,
          startPanX: pan.x,
          startPanY: pan.y,
        };
      }
    },
    [pan.x, pan.y],
  );

  const handleMouseUp = React.useCallback(() => {
    panDragRef.current = null;
  }, []);

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      // Skip selection clicks if we just finished a pan.
      if (panDragRef.current) return;
      // Alt+click is reserved for pan-drag — don't double-fire on it.
      if (event.altKey) return;
      const c = cellAt(event.clientX, event.clientY);
      if (!c) return;
      setSelectedCell(c);
    },
    [cellAt],
  );

  const handleWheel = React.useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      // Don't prevent-default — that breaks the React passive-listener
      // contract and React logs a warning. Native wheel events on the
      // canvas bubble up to the page; since the panel doesn't scroll,
      // the page won't move either, so the UX matches a hard preventDefault.
      const factor = event.deltaY > 0 ? 1 / 1.1 : 1.1;
      setZoom((z) => clampZoom(z * factor));
    },
    [],
  );

  // ---- Action handlers (also exposed as commands) ------------------

  const fitToView = React.useCallback(() => {
    setZoom(DEFAULT_ZOOM);
    setPan({ x: 0, y: 0 });
  }, []);

  const clearSelection = React.useCallback(() => {
    setSelectedCell(null);
  }, []);

  const addLayer = React.useCallback(() => {
    // Wave 3 wires this to the real scene-layer store. Today we log so
    // the affordance is reachable end-to-end via button + palette.
    // eslint-disable-next-line no-console
    console.log("[MapCanvasPanel] scene.mapCanvas.addLayer invoked (stub)");
  }, []);

  const toggleLayerVisibility = React.useCallback((layerId: string) => {
    setVisibility((prev) => ({ ...prev, [layerId]: !(prev[layerId] ?? true) }));
  }, []);

  const setActiveLayer = React.useCallback((layerId: string) => {
    setActiveLayerId(layerId);
  }, []);

  // ---- Command-registry refs --------------------------------------

  const fitToViewRef = React.useRef(fitToView);
  const clearSelectionRef = React.useRef(clearSelection);
  const addLayerRef = React.useRef(addLayer);
  const toggleVisRef = React.useRef(toggleLayerVisibility);
  const setActiveRef = React.useRef(setActiveLayer);

  React.useEffect(() => {
    fitToViewRef.current = fitToView;
  }, [fitToView]);
  React.useEffect(() => {
    clearSelectionRef.current = clearSelection;
  }, [clearSelection]);
  React.useEffect(() => {
    addLayerRef.current = addLayer;
  }, [addLayer]);
  React.useEffect(() => {
    toggleVisRef.current = toggleLayerVisibility;
  }, [toggleLayerVisibility]);
  React.useEffect(() => {
    setActiveRef.current = setActiveLayer;
  }, [setActiveLayer]);

  // Static commands — registered once.
  React.useEffect(() => {
    const unregs: Array<() => void> = [
      registerCommand({
        id: "scene.mapCanvas.fitToView",
        title: "Fit Map to View",
        category: "Map",
        keywords: ["map", "canvas", "fit", "view", "reset", "zoom", "pan"],
        description: "Reset the map canvas zoom and pan to fit the scene.",
        run: () => fitToViewRef.current(),
      }),
      registerCommand({
        id: "scene.mapCanvas.clearSelection",
        title: "Clear Map Selection",
        category: "Map",
        keywords: ["map", "canvas", "clear", "selection", "deselect"],
        description: "Clear the currently selected map cell.",
        run: () => clearSelectionRef.current(),
      }),
      registerCommand({
        id: "scene.mapCanvas.addLayer",
        title: "Add Layer",
        category: "Map",
        keywords: ["map", "layer", "add", "new", "create"],
        description: "Add a new scene layer (stub).",
        run: () => addLayerRef.current(),
      }),
    ];
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // Dynamic per-layer commands — re-register when the layer roster
  // changes. (For Wave 2 this is static since MOCK_LAYERS is fixed,
  // but the shape mirrors LayersPanel so Wave 3 lands cleanly.)
  const layers: LayerRow[] = React.useMemo(
    () => MOCK_LAYERS.map((l) => ({ ...l })),
    [],
  );

  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const l of layers) {
      unregs.push(
        registerCommand({
          id: `scene.mapCanvas.toggleLayerVisibility.${l.id}`,
          title: `Toggle Layer Visibility: ${l.name}`,
          category: "Map",
          keywords: ["map", "layer", "visibility", "toggle", l.name.toLowerCase()],
          description: `Show or hide the ${l.name} layer on the map canvas.`,
          run: () => toggleVisRef.current(l.id),
        }),
      );
      unregs.push(
        registerCommand({
          id: `scene.mapCanvas.setActiveLayer.${l.id}`,
          title: `Set Active Layer: ${l.name}`,
          category: "Map",
          keywords: ["map", "layer", "active", "set", l.name.toLowerCase()],
          description: `Make ${l.name} the active painting layer.`,
          run: () => setActiveRef.current(l.id),
        }),
      );
    }
    return () => {
      for (const u of unregs) u();
    };
  }, [layers]);

  // ---- Render ------------------------------------------------------

  const tooSmall =
    size.w > 0 &&
    size.h > 0 &&
    (size.w < MIN_RENDER_PX || size.h < MIN_RENDER_PX + CHIP_STRIP_HEIGHT);

  const coordsLabel = hoverCell ? `${hoverCell.x}, ${hoverCell.y}` : "—, —";

  return (
    <div
      ref={containerRef}
      data-panel="map-canvas"
      className="relative h-full w-full overflow-hidden bg-zinc-950"
    >
      {tooSmall ? (
        <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-(--color-fg-muted)">
          Panel too small
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onWheel={handleWheel}
          className="absolute left-0 right-0 top-0 block cursor-crosshair"
          style={{ bottom: `${CHIP_STRIP_HEIGHT}px` }}
          aria-label="Scene map canvas"
        />
      )}

      {/* Top-left coords readout — small chip pinned in the corner so
       *  it doesn't fight the layer strip at the bottom. */}
      {!tooSmall && (
        <div
          data-slot="coords-readout"
          className="absolute left-2 top-2 rounded border border-(--color-border-strong) bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px] text-(--color-fg-secondary) backdrop-blur pointer-events-none"
          aria-label="Hover cell coordinates"
        >
          {coordsLabel}
        </div>
      )}

      {/* Bottom layer-chip strip — primary navigation chips. Wraps to
       *  multiple rows at narrow widths instead of spawning a
       *  horizontal scrollbar (per the panel responsive standard). */}
      <div
        data-slot="layer-chip-strip"
        className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-1 border-t border-(--color-border-strong) bg-zinc-900/85 px-2 py-1.5 backdrop-blur"
        style={{ minHeight: `${CHIP_STRIP_HEIGHT}px` }}
      >
        {layers.map((l) => {
          const isActive = activeLayerId === l.id;
          const isVisible = visibility[l.id] ?? true;
          const description = LAYER_DESCRIPTIONS[l.id] ?? `${l.name} layer.`;
          return (
            <Tooltip
              key={l.id}
              side="top"
              stages={[
                { delay: 2000, content: <span>{l.name}</span> },
                {
                  delay: 5000,
                  content: (
                    <div>
                      <div className="font-semibold">{l.name}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                        {description}
                      </div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1">
                        Click to set active. Eye toggles visibility.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <div
                className={[
                  "flex items-center gap-1 rounded-full border px-1.5 py-0.5",
                  "transition-colors",
                  isActive
                    ? "border-amber-500 bg-amber-500/10"
                    : "border-(--color-border-strong) bg-zinc-900/70 hover:border-amber-500/40",
                ].join(" ")}
              >
                <button
                  type="button"
                  aria-label={`${isVisible ? "Hide" : "Show"} ${l.name} layer`}
                  aria-pressed={isVisible}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerVisibility(l.id);
                  }}
                  className={[
                    "flex h-4 w-4 items-center justify-center rounded",
                    isVisible
                      ? "text-(--color-fg-secondary) hover:text-(--color-fg-primary)"
                      : "text-(--color-fg-muted) hover:text-(--color-fg-secondary)",
                  ].join(" ")}
                >
                  {isVisible ? (
                    <Eye size={10} aria-hidden="true" />
                  ) : (
                    <EyeOff size={10} aria-hidden="true" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`Set ${l.name} as active layer`}
                  aria-pressed={isActive}
                  onClick={() => setActiveLayer(l.id)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-(--color-fg-secondary) hover:text-(--color-fg-primary)"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: l.color }}
                  />
                  <span>{l.name}</span>
                </button>
              </div>
            </Tooltip>
          );
        })}

        {/* Add-layer trailing chip — dashed outline matches the design
         *  comp's affordance for "create new" inline buttons. */}
        <Tooltip
          side="top"
          stages={[
            { delay: 2000, content: <span>Add Layer</span> },
            {
              delay: 5000,
              content: (
                <div>
                  <div className="font-semibold">Add Layer</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[220px] whitespace-normal">
                    Create a new scene layer. Wave 3 will prompt for a
                    name + color; today this is a stub.
                  </div>
                </div>
              ),
            },
          ]}
        >
          <button
            type="button"
            aria-label="Add layer"
            onClick={addLayer}
            className={[
              "flex items-center gap-1 rounded-full border border-dashed border-(--color-border-strong) px-1.5 py-0.5",
              "text-[10px] uppercase tracking-wide text-(--color-fg-muted)",
              "hover:border-amber-500/60 hover:text-(--color-fg-secondary) transition-colors",
            ].join(" ")}
          >
            <Plus size={10} aria-hidden="true" />
            <span>Add Layer</span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "map-canvas",
  title: "Map",
  icon: <MapIcon size={12} />,
};

export default MapCanvasPanel;
