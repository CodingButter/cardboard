import React from "react";
import { Eye, EyeOff, Map as MapIcon, Plus } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { SceneTabContextPicker } from "../SceneTabContextPicker";
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
/** Height of the scene-picker strip in CSS pixels. Sits ABOVE the
 *  chip strip and BELOW the canvas content, hosting the relocated
 *  SceneTabContextPicker (previously mounted into the top-bar slot).
 *  Sized to fit the picker's 32px trigger + 4px of breathing room. */
const PICKER_STRIP_HEIGHT = 36;
/** Height (in CSS px) of the X-axis ruler band drawn ABOVE the playfield.
 *  Reserved BEFORE letterboxing so numbers always have a dedicated strip. */
const RULER_TOP_PX = 18;
/** Width (in CSS px) of the Y-axis ruler band drawn LEFT of the playfield. */
const RULER_LEFT_PX = 24;
/** Muted gray-brown matching Map.png's axis chrome. */
const RULER_TEXT_COLOR = "rgba(180,160,140,0.7)";
/** Slightly darker shade for ruler tick marks (cell boundary indicators). */
const RULER_TICK_COLOR = "rgba(154,138,120,0.55)";
/** Background for the ruler bands — a touch darker than the playfield so
 *  the chrome reads as recessed without competing with cell content. */
const RULER_BG_COLOR = "#13110e";

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
//
// The cells in this fixture are intentionally shaped to read as a
// small dungeon when drawn with the textured renderer below — a few
// rooms connected by corridors, with doors at the breaks. The colors
// on each cell act as a hue *tint* on top of the procedural brick /
// stone-floor base palette so the renderer reads as "atmospheric
// dungeon" rather than "saturated tile grid".

interface PaintedCell {
  x: number;
  y: number;
  layerId: string;
  /** 6-digit `#RRGGBB`. Falls back to the layer's legend color if
   *  omitted — leaving it set per-cell lets us suggest tile variety
   *  (different brick tones, etc.) without inventing a tile fixture. */
  color?: string;
  /** Optional tile-type name surfaced under the selection chip.
   *  Mirrors the `Brick Wall 7` label in Map.png. */
  name?: string;
}

// Small helper — paint a filled axis-aligned rect of one layer/tone.
function rect(
  cells: PaintedCell[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  layerId: string,
  color: string,
  name: string,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      cells.push({ x, y, layerId, color, name });
    }
  }
}

// Outline of a rectangle (walls around a room — interior left empty).
function wallRect(
  cells: PaintedCell[],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
  name: string,
): void {
  for (let x = x0; x <= x1; x++) {
    cells.push({ x, y: y0, layerId: "walls", color, name });
    cells.push({ x, y: y1, layerId: "walls", color, name });
  }
  for (let y = y0 + 1; y < y1; y++) {
    cells.push({ x: x0, y, layerId: "walls", color, name });
    cells.push({ x: x1, y, layerId: "walls", color, name });
  }
}

const SAMPLE_CELLS: readonly PaintedCell[] = (() => {
  const c: PaintedCell[] = [];

  // ---- Room A — top-left "great hall" ----------------------------
  rect(c, 9, 8, 19, 16, "floors", "#7a6a55", "Stone Floor 2");
  wallRect(c, 8, 7, 20, 17, "#6b4a30", "Brick Wall 7");
  // Door east of room A → corridor.
  c.push({ x: 20, y: 12, layerId: "doors", color: "#caa46a", name: "Oak Door" });

  // ---- Corridor east → Room B ------------------------------------
  rect(c, 21, 11, 28, 13, "floors", "#6e5e4a", "Stone Floor 3");
  // Corridor walls — north + south.
  for (let x = 21; x <= 28; x++) {
    c.push({ x, y: 10, layerId: "walls", color: "#6b4a30", name: "Brick Wall 5" });
    c.push({ x, y: 14, layerId: "walls", color: "#6b4a30", name: "Brick Wall 5" });
  }

  // ---- Room B — middle "library" --------------------------------
  rect(c, 29, 9, 38, 17, "floors", "#7a6a55", "Stone Floor 2");
  wallRect(c, 28, 8, 39, 18, "#6b4a30", "Brick Wall 7");
  // Re-open the corridor entrance.
  c.push({ x: 28, y: 12, layerId: "doors", color: "#caa46a", name: "Oak Door" });
  // Sprites inside room B — three barrels along the south wall.
  c.push({ x: 31, y: 16, layerId: "sprites", color: "#b08050", name: "Barrel" });
  c.push({ x: 33, y: 16, layerId: "sprites", color: "#b08050", name: "Barrel" });
  c.push({ x: 35, y: 16, layerId: "sprites", color: "#b08050", name: "Barrel" });
  // A light source at the centre of the room.
  c.push({ x: 33, y: 12, layerId: "lights", color: "#f4c668", name: "Torch" });

  // ---- South corridor from Room A ↓ to Room C --------------------
  rect(c, 13, 18, 15, 26, "floors", "#6e5e4a", "Stone Floor 3");
  for (let y = 18; y <= 26; y++) {
    c.push({ x: 12, y, layerId: "walls", color: "#6b4a30", name: "Brick Wall 5" });
    c.push({ x: 16, y, layerId: "walls", color: "#6b4a30", name: "Brick Wall 5" });
  }
  // Door at the room A south boundary.
  c.push({ x: 14, y: 17, layerId: "doors", color: "#caa46a", name: "Oak Door" });

  // ---- Room C — bottom-left "chamber" ---------------------------
  rect(c, 9, 27, 19, 35, "floors", "#7a6a55", "Stone Floor 1");
  wallRect(c, 8, 26, 20, 36, "#6b4a30", "Brick Wall 7");
  c.push({ x: 14, y: 26, layerId: "doors", color: "#caa46a", name: "Oak Door" });
  // A lone light + a sprite.
  c.push({ x: 14, y: 31, layerId: "lights", color: "#f4c668", name: "Torch" });
  c.push({ x: 11, y: 34, layerId: "sprites", color: "#b08050", name: "Barrel" });

  // ---- East tower — Room D ---------------------------------------
  rect(c, 41, 21, 50, 30, "floors", "#7a6a55", "Stone Floor 2");
  wallRect(c, 40, 20, 51, 31, "#6b4a30", "Brick Wall 7");
  // Connecting corridor west from room D to corridor under room B.
  rect(c, 34, 25, 39, 26, "floors", "#6e5e4a", "Stone Floor 3");
  for (let x = 34; x <= 39; x++) {
    c.push({ x, y: 24, layerId: "walls", color: "#6b4a30", name: "Brick Wall 5" });
    c.push({ x, y: 27, layerId: "walls", color: "#6b4a30", name: "Brick Wall 5" });
  }
  c.push({ x: 40, y: 25, layerId: "doors", color: "#caa46a", name: "Oak Door" });
  // Two sprites + a light in room D.
  c.push({ x: 45, y: 25, layerId: "sprites", color: "#b08050", name: "Crate" });
  c.push({ x: 48, y: 28, layerId: "sprites", color: "#b08050", name: "Crate" });
  c.push({ x: 45, y: 26, layerId: "lights", color: "#f4c668", name: "Brazier" });

  return c;
})();

// ---------------------------------------------------------------------------
// Entity markers — entry / spawn / exit overlay glyphs. Hardcoded
// fixtures for Wave 2; Wave 3 reads from the real entity store.

interface EntityMarker {
  x: number;
  y: number;
  glyph: string;
  /** Background colour for the marker disc. */
  color: string;
  name: string;
}

const ENTITY_MARKERS: readonly EntityMarker[] = [
  { x: 14, y: 12, glyph: "E", color: "#10b981", name: "Entry" },
  { x: 33, y: 13, glyph: "S", color: "#3b82f6", name: "Spawn" },
  { x: 14, y: 31, glyph: "S", color: "#3b82f6", name: "Spawn" },
  { x: 45, y: 25, glyph: "X", color: "#ef4444", name: "Exit" },
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
// Color helpers — tiny RGB packers used by the textured-cell renderer.
// Kept inline (no external dep) and stable so the renderer stays
// <16ms even when sweeping every cell.

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return {
      r: parseInt(h[0]! + h[0]!, 16),
      g: parseInt(h[1]! + h[1]!, 16),
      b: parseInt(h[2]! + h[2]!, 16),
    };
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Convert 0..255 channels to a `#rrggbb` string. Clamped + integerised
 *  so the return value is always re-parseable by `parseHex` — critical
 *  because `mix(mix(...), ...)` is the workhorse of the tile renderer
 *  and broken chaining produces accidental neon colors. */
function rgbHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (v: number) => clamp(v).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Mix two colors at `t`. t=0 → a, t=1 → b. Returns a `#rrggbb` string
 *  so the result can feed back into `mix` again — `parseHex` only
 *  understands hex, not `rgba(...)` notation. */
function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return rgbHex(
    ca.r + (cb.r - ca.r) * t,
    ca.g + (cb.g - ca.g) * t,
    ca.b + (cb.b - ca.b) * t,
  );
}

/** Cheap deterministic 0..1 pseudo-random for tile variation, so
 *  bricks at the same coord look the same on every paint. */
function hash01(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 1000) / 1000;
}

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
  // AND the bottom scene-picker strip (so the canvas never paints
  // under either). Width is unchanged. We also reserve a ruler band on
  // the TOP and LEFT — the playfield letterbox is computed within that
  // inset region so the rulers sit outside (not on top of) the grid.
  const dims = MOCK_SCENE_SETTINGS.dimensions;
  const layout = React.useMemo(() => {
    const canvasW = size.w;
    const canvasH = Math.max(0, size.h - CHIP_STRIP_HEIGHT - PICKER_STRIP_HEIGHT);
    if (canvasW <= 0 || canvasH <= 0) {
      return {
        cell: 0,
        offX: 0,
        offY: 0,
        gridW: 0,
        gridH: 0,
        canvasW,
        canvasH,
        playW: 0,
        playH: 0,
      };
    }
    // Inner playfield region after reserving the ruler bands.
    const playW = Math.max(0, canvasW - RULER_LEFT_PX);
    const playH = Math.max(0, canvasH - RULER_TOP_PX);
    if (playW <= 0 || playH <= 0) {
      return {
        cell: 0,
        offX: RULER_LEFT_PX,
        offY: RULER_TOP_PX,
        gridW: 0,
        gridH: 0,
        canvasW,
        canvasH,
        playW,
        playH,
      };
    }
    const fitCell = Math.min(playW / dims.w, playH / dims.h) * zoom;
    const cell = Math.max(0, fitCell);
    const gridW = cell * dims.w;
    const gridH = cell * dims.h;
    // Letterbox within the inner playfield region, then offset by the
    // ruler bands so the playfield sits to the right/below the chrome.
    const offX = RULER_LEFT_PX + (playW - gridW) / 2 + pan.x;
    const offY = RULER_TOP_PX + (playH - gridH) / 2 + pan.y;
    return { cell, offX, offY, gridW, gridH, canvasW, canvasH, playW, playH };
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

    // Background — dark editor tone with a warm brown undertone so
    // the playfield reads as "torchlit dungeon" rather than pure noir.
    ctx.fillStyle = "#0a0a0c";
    ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);

    const { cell, offX, offY, gridW, gridH } = layout;
    if (cell <= 0) return;

    // Scene playfield — warmer base than the old `#15151a` so the
    // textured tiles sit on a brown-toned floor matching Map.png.
    ctx.fillStyle = "#1a1814";
    ctx.fillRect(offX, offY, gridW, gridH);

    // Painted sample cells — drawn before the grid so the lattice
    // reads on top. We respect MOCK_LAYERS order so higher-index
    // layers (sprites, lights) draw on top of lower-index ones.
    const layerIndex = new Map<string, number>(
      MOCK_LAYERS.map((l, i) => [l.id, i]),
    );
    const cellsByOrder = SAMPLE_CELLS.slice().sort(
      (a, b) =>
        (layerIndex.get(a.layerId) ?? 0) - (layerIndex.get(b.layerId) ?? 0),
    );

    // Detail thresholds — below these zooms we collapse procedural
    // patterns back to a flat fill so the render stays cheap on small
    // cells. (At zoom-out, 4096 cells × dozens of strokes = jank.)
    // Keep these aggressive so even ~6px cells get a hint of brick
    // texture — that's what makes Map.png read as a dungeon.
    const showDetail = cell >= 5;
    const showFineDetail = cell >= 12;

    for (const c of cellsByOrder) {
      if (!visibility[c.layerId]) continue;
      const x = Math.round(offX + c.x * cell);
      const y = Math.round(offY + c.y * cell);
      const w = Math.ceil(cell);
      const h = Math.ceil(cell);
      const tint = c.color ?? layerColorById[c.layerId] ?? "#888";

      if (c.layerId === "walls") {
        // Brick pattern — warm brown base + per-cell tint mix +
        // staggered mortar lines so consecutive walls read as bricks
        // rather than a solid bar. Per-cell jitter on the base keeps
        // long wall runs from reading as one flat slab; kept small
        // so neighboring cells read as the same wall, not a quilt.
        const jitter = hash01(c.x, c.y, 7) * 0.06 - 0.03;
        const base = mix("#5a3a22", tint, 0.3 + jitter);
        const dark = mix(base, "#1a0e08", 0.6);
        ctx.fillStyle = base;
        ctx.fillRect(x, y, w, h);
        if (showDetail) {
          // Horizontal mortar line at cell midpoint.
          ctx.fillStyle = dark;
          ctx.fillRect(x, y + Math.round(cell * 0.5), w, 1);
          // Single vertical mortar — staggered every other row so
          // adjacent walls read as offset brick courses.
          const stagger = c.y % 2 === 0 ? Math.round(cell * 0.5) : 0;
          ctx.fillRect(x + stagger, y, 1, Math.round(cell * 0.5));
          ctx.fillRect(
            x + Math.round(cell * 0.5) - stagger,
            y + Math.round(cell * 0.5),
            1,
            Math.round(cell * 0.5),
          );
        }
      } else if (c.layerId === "floors") {
        // Stone-tile floor — warm gray base, per-cell jitter, and a
        // faint diagonal division. We deliberately keep this LOW
        // contrast so the floor reads as atmospheric backdrop rather
        // than competing with the brick walls.
        const jitter = hash01(c.x, c.y, 11) * 0.08 - 0.04;
        const base = mix("#3a3530", tint, 0.28 + jitter);
        ctx.fillStyle = base;
        ctx.fillRect(x, y, w, h);
        if (showFineDetail) {
          // A faint single division at the cell midpoint — gives the
          // floor a tiled look without becoming a checkerboard. Only
          // when each cell is wide enough that 1px reads as a seam.
          const mid = mix(base, "#231f1c", 0.45);
          ctx.fillStyle = mid;
          ctx.fillRect(x + Math.round(w / 2), y, 1, h);
          ctx.fillRect(x, y + Math.round(h / 2), w, 1);
        }
      } else if (c.layerId === "doors") {
        // Door — wood plank with a `D` glyph centered.
        const base = mix("#8b5a2b", tint, 0.4);
        ctx.fillStyle = base;
        ctx.fillRect(x, y, w, h);
        if (showDetail) {
          // Two vertical plank divisions.
          const dark = mix(base, "#000", 0.4);
          ctx.fillStyle = dark;
          ctx.fillRect(x + Math.round(w / 3), y, 1, h);
          ctx.fillRect(x + Math.round((w * 2) / 3), y, 1, h);
          if (showFineDetail) {
            // Iron hinges as small dark dots.
            ctx.fillStyle = "#1a1410";
            ctx.fillRect(x + 1, y + 2, 2, 1);
            ctx.fillRect(x + 1, y + h - 3, 2, 1);
          }
        }
      } else if (c.layerId === "sprites") {
        // Sprite — smaller diamond in the cell center, doesn't fill.
        const cx = x + w / 2;
        const cy = y + h / 2;
        const r = Math.max(2, cell * 0.32);
        ctx.fillStyle = tint;
        ctx.beginPath();
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r, cy);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r, cy);
        ctx.closePath();
        ctx.fill();
        if (showDetail) {
          ctx.strokeStyle = mix(tint, "#000", 0.5);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      } else if (c.layerId === "lights") {
        // Light — soft radial glow, not a hard square.
        const cx = x + w / 2;
        const cy = y + h / 2;
        const r = Math.max(2, cell * 0.9);
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        grad.addColorStop(0, mix(tint, "#fff", 0.4));
        grad.addColorStop(0.4, tint);
        grad.addColorStop(1, "rgba(244,198,104,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(x - cell, y - cell, w + cell * 2, h + cell * 2);
      } else {
        // Fallback — flat fill for any future layer id.
        ctx.fillStyle = tint;
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
      }
    }

    // Grid lattice — warm gray-brown so the lines feel like floor
    // grout in a stone dungeon, not pure white-alpha. Skip when each
    // cell is sub-pixel.
    if (cell >= 2) {
      ctx.strokeStyle = "rgba(180,160,140,0.08)";
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

    // Entity markers — entry/spawn/exit glyphs over their cells.
    // Drawn AFTER the grid so they sit on top like map pins.
    if (cell >= 6) {
      for (const m of ENTITY_MARKERS) {
        if (m.x < 0 || m.x >= dims.w || m.y < 0 || m.y >= dims.h) continue;
        const cx = offX + m.x * cell + cell / 2;
        const cy = offY + m.y * cell + cell / 2;
        const r = Math.max(4, cell * 0.42);
        // Drop-shadow halo for legibility.
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.arc(cx + 1, cy + 1, r, 0, Math.PI * 2);
        ctx.fill();
        // Colored disc.
        ctx.fillStyle = m.color;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        // Bright outline so the disc reads against the brick.
        ctx.strokeStyle = mix(m.color, "#fff", 0.4);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Glyph.
        if (cell >= 7) {
          ctx.fillStyle = "#0b0a08";
          ctx.font = `bold ${Math.max(8, Math.round(r * 1.3))}px ui-sans-serif, system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(m.glyph, cx, cy + 0.5);
          // Reset text alignment for any subsequent draw calls so we
          // don't leak state into the selection chip below.
          ctx.textAlign = "start";
          ctx.textBaseline = "alphabetic";
        }
      }
    }

    // Atmospheric vignette — soft radial darkening from the playfield
    // center outward. Drawn over the cells but under the selection
    // overlay so the selected cell still pops.
    {
      const cx = offX + gridW / 2;
      const cy = offY + gridH / 2;
      const rInner = Math.min(gridW, gridH) * 0.35;
      const rOuter = Math.hypot(gridW, gridH) * 0.62;
      const vignette = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vignette;
      ctx.fillRect(offX, offY, gridW, gridH);
    }

    // Playfield border — slightly warmer than the old white-alpha.
    ctx.strokeStyle = "rgba(180,160,140,0.22)";
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

    // Selected cell — solid amber outline + faint fill + a small
    // floating label below the selection mirroring Map.png's
    // `Brick Wall 7` chip.
    if (
      selectedCell &&
      selectedCell.x >= 0 &&
      selectedCell.x < dims.w &&
      selectedCell.y >= 0 &&
      selectedCell.y < dims.h
    ) {
      const sx = Math.round(offX + selectedCell.x * cell);
      const sy = Math.round(offY + selectedCell.y * cell);
      ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
      ctx.fillRect(sx, sy, Math.ceil(cell), Math.ceil(cell));
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        sx + 0.5,
        sy + 0.5,
        Math.ceil(cell) - 1,
        Math.ceil(cell) - 1,
      );

      // Lookup the topmost painted cell's tile-type name at this
      // coord (highest layer wins). If nothing's painted, surface
      // the active layer's name + an `Empty` qualifier.
      if (cell >= 8) {
        const stack = SAMPLE_CELLS.filter(
          (c) => c.x === selectedCell.x && c.y === selectedCell.y,
        );
        let label = "Empty";
        if (stack.length > 0) {
          stack.sort(
            (a, b) =>
              (layerIndex.get(b.layerId) ?? 0) -
              (layerIndex.get(a.layerId) ?? 0),
          );
          label = stack[0]!.name ?? stack[0]!.layerId;
        }
        // Measure + draw the chip background below the selection.
        ctx.font =
          "600 11px ui-sans-serif, system-ui, -apple-system, sans-serif";
        const padX = 6;
        const padY = 3;
        const textW = ctx.measureText(label).width;
        const chipW = Math.ceil(textW + padX * 2);
        const chipH = 18;
        // Center the chip on the selection; clamp to playfield.
        let chipX = sx + Math.ceil(cell) / 2 - chipW / 2;
        let chipY = sy + Math.ceil(cell) + 4;
        chipX = Math.max(offX + 2, Math.min(offX + gridW - chipW - 2, chipX));
        // If the chip would clip the bottom edge, flip it above the
        // selection.
        if (chipY + chipH > offY + gridH - 2) {
          chipY = sy - chipH - 4;
        }
        // Drop-shadow.
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.roundRect(chipX + 1, chipY + 1, chipW, chipH, 4);
        ctx.fill();
        // Chip body.
        ctx.fillStyle = "rgba(20,18,14,0.95)";
        ctx.beginPath();
        ctx.roundRect(chipX, chipY, chipW, chipH, 4);
        ctx.fill();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = 1;
        ctx.stroke();
        // Label text.
        ctx.fillStyle = "#f4c668";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, chipX + padX, chipY + chipH / 2 + 0.5);
        // Reset text alignment for any subsequent draw calls.
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
    }

    // -----------------------------------------------------------------
    // X / Y axis ruler frame — drawn LAST so any panned cells that
    // bleed past the playfield edges get cleanly clipped under the
    // ruler bands. Mirrors `Editor Design/Map.png` chrome: a narrow
    // band above + left of the grid with cell-stride number labels and
    // tick marks at every cell boundary.
    if (cell > 0) {
      // Stride — number every Nth cell. At low zoom the labels get
      // crowded so we widen the stride; at high zoom we narrow it.
      // Picked so that at default zoom (cell ~10-14px on a typical
      // panel) we get a label every 5 cells, matching Map.png.
      const stride = cell >= 18 ? 5 : cell >= 9 ? 5 : cell >= 5 ? 10 : 20;
      // Tick marks: a thin dash at every cell boundary. Skip when
      // cells are sub-6px wide — at that point the ticks just merge
      // into a smeared bar and only the numbers carry meaning.
      const showTicks = cell >= 6;
      // Per-cell vertical lines inside the ruler when zoomed in
      // tightly (cell > 30px) — gives the ruler a thin grid look
      // matching the design comp at zoom.
      const showFineTicks = cell >= 30;

      // ---- Top ruler band ----
      ctx.fillStyle = RULER_BG_COLOR;
      ctx.fillRect(0, 0, layout.canvasW, RULER_TOP_PX);
      // Inner shadow / lower border so the band reads as recessed.
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, RULER_TOP_PX - 1, layout.canvasW, 1);

      // ---- Left ruler band ----
      ctx.fillStyle = RULER_BG_COLOR;
      ctx.fillRect(0, 0, RULER_LEFT_PX, layout.canvasH);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(RULER_LEFT_PX - 1, 0, 1, layout.canvasH);

      // ---- Corner cell ----
      // A clean dark square where the two rulers meet. Slight inner
      // shadow on the two playfield-facing edges anchors the corner
      // visually — same trick Photoshop / Aseprite use.
      ctx.fillStyle = "#0e0c0a";
      ctx.fillRect(0, 0, RULER_LEFT_PX, RULER_TOP_PX);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(RULER_LEFT_PX - 1, 0, 1, RULER_TOP_PX);
      ctx.fillRect(0, RULER_TOP_PX - 1, RULER_LEFT_PX, 1);

      // ---- Tick marks ----
      // Ticks scroll WITH the playfield — they sit at every
      // cell-boundary x/y, clipped to the visible playfield extent so
      // they don't bleed into the corner cell.
      if (showTicks) {
        ctx.fillStyle = RULER_TICK_COLOR;
        const tickH = 4;
        const tickW = 4;
        // X-axis ticks — vertical dashes at the bottom of the top band.
        for (let x = 0; x <= dims.w; x++) {
          const px = Math.round(offX + x * cell);
          if (px < RULER_LEFT_PX || px > layout.canvasW) continue;
          // Major ticks (every stride) reach further into the band.
          const isMajor = x % stride === 0;
          const reach = isMajor ? tickH + 2 : tickH;
          ctx.fillRect(px, RULER_TOP_PX - reach, 1, reach);
        }
        // Y-axis ticks — horizontal dashes at the right of the left band.
        for (let y = 0; y <= dims.h; y++) {
          const py = Math.round(offY + y * cell);
          if (py < RULER_TOP_PX || py > layout.canvasH) continue;
          const isMajor = y % stride === 0;
          const reach = isMajor ? tickW + 2 : tickW;
          ctx.fillRect(RULER_LEFT_PX - reach, py, reach, 1);
        }
      }

      // ---- Fine grid lines inside the ruler bands when zoomed in ----
      if (showFineTicks) {
        ctx.strokeStyle = "rgba(120,108,94,0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= dims.w; x++) {
          const px = Math.round(offX + x * cell) + 0.5;
          if (px < RULER_LEFT_PX || px > layout.canvasW) continue;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, RULER_TOP_PX);
        }
        for (let y = 0; y <= dims.h; y++) {
          const py = Math.round(offY + y * cell) + 0.5;
          if (py < RULER_TOP_PX || py > layout.canvasH) continue;
          ctx.moveTo(0, py);
          ctx.lineTo(RULER_LEFT_PX, py);
        }
        ctx.stroke();
      }

      // ---- Labels ----
      // Tabular monospaced 10px, muted gray-brown. Numbers scroll WITH
      // the playfield (i.e. label at column N sits exactly above the
      // visible column N), and we skip any label that would land
      // inside the corner cell.
      ctx.fillStyle = RULER_TEXT_COLOR;
      ctx.font =
        "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textBaseline = "middle";

      // X axis — column numbers along the top band.
      ctx.textAlign = "center";
      for (let x = 0; x <= dims.w; x += stride) {
        // Don't label x=0 if it would crash into the corner cell —
        // start at the next stride instead.
        const px = offX + x * cell + cell / 2;
        if (px < RULER_LEFT_PX + 8) continue;
        if (px > layout.canvasW - 4) continue;
        ctx.fillText(String(x), px, RULER_TOP_PX / 2);
      }

      // Y axis — row numbers along the left band.
      ctx.textAlign = "right";
      for (let y = 0; y <= dims.h; y += stride) {
        const py = offY + y * cell + cell / 2;
        if (py < RULER_TOP_PX + 8) continue;
        if (py > layout.canvasH - 4) continue;
        ctx.fillText(String(y), RULER_LEFT_PX - 5, py);
      }

      // Reset state for downstream callers.
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
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
    (size.w < MIN_RENDER_PX ||
      size.h < MIN_RENDER_PX + CHIP_STRIP_HEIGHT + PICKER_STRIP_HEIGHT);

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
          style={{ bottom: `${CHIP_STRIP_HEIGHT + PICKER_STRIP_HEIGHT}px` }}
          aria-label="Scene map canvas"
        />
      )}

      {/* Top-left coords readout — small chip pinned just inside the
       *  playfield region (i.e. past the ruler bands) so it doesn't
       *  collide with the X/Y coordinate frame chrome painted into
       *  the canvas. */}
      {!tooSmall && (
        <div
          data-slot="coords-readout"
          className="absolute rounded border border-(--color-border-strong) bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px] text-(--color-fg-secondary) backdrop-blur pointer-events-none"
          style={{ left: `${RULER_LEFT_PX + 6}px`, top: `${RULER_TOP_PX + 6}px` }}
          aria-label="Hover cell coordinates"
        >
          {coordsLabel}
        </div>
      )}

      {/* Scene-picker strip — relocated from the top-bar slot. Sits
       *  above the layer chip strip + below the canvas content so it
       *  doesn't fight the X-axis ruler. Subtle background (matches
       *  the chip strip) for a contiguous bottom-chrome stack. */}
      <div
        data-slot="scene-picker-strip"
        className="absolute left-0 right-0 flex items-center border-t border-(--color-border-strong) bg-zinc-900/70 px-2 backdrop-blur"
        style={{
          bottom: `${CHIP_STRIP_HEIGHT}px`,
          height: `${PICKER_STRIP_HEIGHT}px`,
          paddingLeft: `${RULER_LEFT_PX + 6}px`,
        }}
      >
        <SceneTabContextPicker />
      </div>

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
                { delay: 1000, content: <span>{l.name}</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">{l.name}</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
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
            { delay: 1000, content: <span>Add Layer</span> },
            {
              delay: 3000,
              content: (
                <div>
                  <div className="font-semibold">Add Layer</div>
                  <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
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
