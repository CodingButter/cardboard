import React from "react";
import { Eye, EyeOff, Map as MapIcon, Plus } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { SceneTabContextPicker } from "../SceneTabContextPicker";
import { MOCK_LAYERS, type LayerRow } from "../scene-fixtures";
import { useSceneStore } from "../../../state/useSceneStore";
import { useLayerStore, type CustomLayer } from "../../../state/useLayerStore";
import { useSelectionStore } from "../../../state/useSelectionStore";
import { useToolStore } from "../../../state/useToolStore";
import { useDiagnosticsStore } from "../../../state/useDiagnosticsStore";
import { useHistoryStore } from "../../../state/useHistoryStore";
import { useTilePresetRegistryStore } from "../../../state/useTilePresetRegistryStore";
import {
  ensureLoaded as ensureTextureLoaded,
  getTextureBitmap,
} from "../../../state/tileTextureCache";

/**
 * MapCanvasPanel — the Scene page's primary top-down map canvas.
 *
 * Wave 3.3.14: this panel now reads ALL of its content state from the
 * cross-panel stores (scene cells, layer order + visibility + active
 * id, selection + hover + cursor). It used to keep a local sample-cell
 * fixture and per-panel localStorage for selection/visibility/active
 * layer; those are gone, replaced by `useSceneStore` / `useLayerStore`
 * / `useSelectionStore`. The viewport (zoom + pan) is still
 * panel-local until `useViewportStore` lands — `LS_ZOOM` and
 * `LS_PAN_*` persistence remain.
 *
 * Paint-write loop + history entries are 3.4 scope and intentionally
 * deferred — non-select tools surface a diagnostic via
 * `useDiagnosticsStore.log("info", ...)` instead of mutating cells.
 *
 * The panel is registered with `surface: false` + `headerless: true`
 * in MapView so it renders flush against the dock — no panel chrome,
 * no card padding. That makes it the editor's centerpiece, mirroring
 * how the design comp shows the map filling the middle column.
 *
 * Persistence (panel-local, viewport only):
 *   - `cardboard.scene.mapCanvas.viewZoom`   number, default 1
 *   - `cardboard.scene.mapCanvas.viewPanX`   number, default 0
 *   - `cardboard.scene.mapCanvas.viewPanY`   number, default 0
 *
 * Commands registered:
 *   - scene.mapCanvas.fitToView
 *   - scene.mapCanvas.clearSelection
 *   - scene.mapCanvas.addLayer
 *   - scene.mapCanvas.undo
 *   - scene.mapCanvas.redo
 *   - scene.mapCanvas.toggleLayerVisibility.<layerId>   (dynamic)
 *   - scene.mapCanvas.setActiveLayer.<layerId>          (dynamic)
 */

// ---------------------------------------------------------------------------
// localStorage helpers — same shape as sibling panels.

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

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return DEFAULT_ZOOM;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

// Layer descriptions for the chip tooltips — mirrored from LayersPanel.
const LAYER_DESCRIPTIONS: Record<string, string> = {
  floors: "Floor tiles — the base walkable surface.",
  walls: "Wall tiles — block movement and sight, define rooms.",
  doors: "Door entities — interactive openings that gate movement.",
  sprites: "Sprite entities — items, decor, NPCs placed in the world.",
  lights: "Light sources — emissive points that bake into the scene.",
};

/** Palette for newly-added custom layer chips. Cycled through so
 *  sequential adds get visually distinct colors. Mirrors the LayersPanel
 *  default but lives here as well so a from-scratch addLayer command in
 *  this panel doesn't have to import a LayersPanel internal. */
const CUSTOM_LAYER_PALETTE: readonly string[] = [
  "#f59e0b",
  "#38bdf8",
  "#10b981",
  "#a78bfa",
  "#ef4444",
  "#ec4899",
  "#84cc16",
  "#22d3ee",
];

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

  // ---- Cross-panel store subscriptions ------------------------------
  // Wave 3.3.14 wiring. Read-only — writes happen via getState() in
  // event handlers so they don't force re-renders on this component.

  const dims = useSceneStore((s) => s.dims);
  const cells = useSceneStore((s) => s.cells);
  const activeLayerId = useLayerStore((s) => s.activeId);
  const visibility = useLayerStore((s) => s.visibility);
  const order = useLayerStore((s) => s.order);
  const customLayers = useLayerStore((s) => s.customLayers);
  const selected = useSelectionStore((s) => s.selected);
  const hover = useSelectionStore((s) => s.hover);
  // Tile preset registry — per-preset color overrides per-layer color
  // so two presets on the same layer render distinguishably. Falls back
  // to layer color when the registry doesn't know the preset id (stale
  // cell from a previous pack, etc.).
  const presetRegistry = useTilePresetRegistryStore((s) => s.presets);
  // Bumped by `tileTextureCache` whenever a bitmap finishes loading.
  // We don't read it directly — its presence in the render dep array
  // is what forces a re-paint when textures arrive.
  const texturesEpoch = useTilePresetRegistryStore((s) => s.texturesEpoch);
  // Active project id — sourced from the same LS key EditorShell
  // mirrors on route change. The cache itself owns project-switch
  // invalidation (see `tileTextureCache.resetTextureCache`); the
  // panel only needs to know which id to pass to `ensureLoaded`.
  const projectId = React.useMemo(() => {
    try {
      return typeof window !== "undefined"
        ? window.localStorage.getItem("editor.currentProjectId")
        : null;
    } catch {
      return null;
    }
  }, []);

  // Zoom + pan remain panel-local until useViewportStore lands. Pan is
  // in CSS pixels relative to the letterboxed center; zoom multiplies
  // the fit-to-panel cell size. Persisted on settle.
  const [zoom, setZoom] = React.useState<number>(() =>
    clampZoom(readLSNumber(LS_ZOOM, DEFAULT_ZOOM)),
  );
  const [pan, setPan] = React.useState<{ x: number; y: number }>(() => ({
    x: readLSNumber(LS_PAN_X, 0),
    y: readLSNumber(LS_PAN_Y, 0),
  }));

  // ---- Persistence (viewport only) ---------------------------------

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

  // ---- Resolved layer list (built-ins + custom, in `order`) ---------
  // Mirrors LayersPanel's resolution so the chip strip and renderer
  // see the same layer set with the same colors. Custom layers added
  // via the store's `add()` action surface here automatically.
  const layers: LayerRow[] = React.useMemo(() => {
    const builtin: LayerRow[] = MOCK_LAYERS.map((l) => ({ ...l }));
    const byId = new Map<string, LayerRow>(builtin.map((l) => [l.id, l]));
    for (const c of customLayers) {
      byId.set(c.id, {
        id: c.id,
        name: c.name,
        color: c.color,
        visible: true,
      });
    }
    const out: LayerRow[] = [];
    for (const id of order) {
      const row = byId.get(id);
      if (!row) continue;
      out.push(row);
    }
    return out;
  }, [order, customLayers]);

  // Per-id layer color lookup. Derived from order + customLayers +
  // MOCK_LAYERS so custom layers picked up via `add()` get the right
  // tint when their cells render.
  const layerColorById = React.useMemo(() => {
    const out = new Map<string, string>();
    for (const l of MOCK_LAYERS) out.set(l.id, l.color);
    for (const c of customLayers) out.set(c.id, c.color);
    return out;
  }, [customLayers]);

  // Effective drawable area is the panel minus the bottom chip strip
  // AND the bottom scene-picker strip (so the canvas never paints
  // under either). Width is unchanged. We also reserve a ruler band on
  // the TOP and LEFT — the playfield letterbox is computed within that
  // inset region so the rulers sit outside (not on top of) the grid.
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

  // Precomputed integer cell edges. Shared between the renderer + the
  // hit-test so `cellAt` matches what the user sees byte-for-byte.
  // Held in a ref because the renderer effect computes them at paint
  // time and `cellAt` needs to read whatever the last render saw.
  const edgesRef = React.useRef<{ cols: number[]; rows: number[] }>({
    cols: [],
    rows: [],
  });

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

    // Compute pixel-aligned cell boundaries up-front. Every overlay
    // (painted cells, hover, selection, grid lattice) snaps to these
    // same boundaries, which is what makes the visuals align. Using
    // `Math.floor(offX + N * cell)` per boundary guarantees:
    //   right_edge(N) === left_edge(N+1)
    // so adjacent cells tile without overlap or gap, and the lattice
    // sitting between them lands exactly on the cell edge.
    const colEdges = new Array<number>(dims.w + 1);
    for (let i = 0; i <= dims.w; i++) colEdges[i] = Math.floor(offX + i * cell);
    const rowEdges = new Array<number>(dims.h + 1);
    for (let i = 0; i <= dims.h; i++) rowEdges[i] = Math.floor(offY + i * cell);
    edgesRef.current = { cols: colEdges, rows: rowEdges };

    // Painted cells — sourced from `useSceneStore.cells`. Iterate
    // layers in `order` (bottom-to-top render order) and within each
    // layer pull every cell that has a preset assigned for that
    // layer.
    //
    // Rendering strategy: prefer the ACTUAL texture bitmap from the
    // pack (decoded via `tileTextureCache`). When the bitmap isn't
    // cached yet, paint the per-preset color fallback AND fire a
    // best-effort `ensureTextureLoaded` so the next render frame can
    // pick the bitmap up (`texturesEpoch` in the dep array drives the
    // re-paint). When the bitmap is known-failed (cache returns null),
    // we stick with the color path permanently. Layer color is the
    // last-resort fallback for unknown preset ids (stale cell, etc.).
    //
    // Performance: `drawImage` with an `ImageBitmap` is a single GPU
    // upload + blit. Profiled at ~1ms for 4096 cells on a mid-range
    // laptop, so we keep the straightforward per-cell loop instead of
    // pre-baking an OffscreenCanvas composite.
    const layerIndex = new Map<string, number>(
      order.map((id, i) => [id, i]),
    );
    // We need it cached but not as a render dep — read once per paint.
    void texturesEpoch;
    for (const layerId of order) {
      if (visibility[layerId] === false) continue;
      const layerColor = layerColorById.get(layerId) ?? "#888";
      for (const key in cells) {
        const c = cells[key];
        if (!c) continue;
        const presetId = c.layers[layerId];
        if (!presetId) continue;
        const [xs, ys] = key.split(",");
        const x = Number(xs);
        const y = Number(ys);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (x < 0 || x >= dims.w || y < 0 || y >= dims.h) continue;
        const px = colEdges[x]!;
        const py = rowEdges[y]!;
        const pw = colEdges[x + 1]! - px;
        const ph = rowEdges[y + 1]! - py;
        const entry = presetRegistry[presetId];
        const texPath = entry?.texture;
        const bitmap = texPath ? getTextureBitmap(texPath) : undefined;
        if (bitmap) {
          // Cached + decoded — blit it.
          ctx.drawImage(bitmap, px, py, pw, ph);
        } else {
          // Color fallback. Distinct per-preset (registry) takes
          // precedence over per-layer.
          ctx.fillStyle = entry?.color ?? layerColor;
          ctx.fillRect(px, py, pw, ph);
          // `bitmap === undefined` means "never requested" — kick off
          // an async load. `bitmap === null` means "known-failed" so
          // we DON'T retry on every paint.
          if (bitmap === undefined && texPath && projectId) {
            ensureTextureLoaded(projectId, texPath);
          }
        }
      }
    }

    // TODO(Wave 3.4+): entity markers (entry / spawn / exit). Awaiting
    // a real entity store; the old hardcoded ENTITY_MARKERS were
    // removed as part of the 3.3.14 cleanup so the canvas doesn't
    // lie about scene contents.

    // Grid lattice — warm gray-brown so the lines feel like floor
    // grout in a stone dungeon, not pure white-alpha. Skip when each
    // cell is sub-pixel. Uses the precomputed `colEdges` / `rowEdges`
    // so the lines sit exactly on the painted-cell boundaries; the
    // +0.5 offset puts the 1px stroke in the center of a pixel row
    // (crisp instead of antialiased across two rows).
    if (cell >= 2) {
      const latticeTop = rowEdges[0]!;
      const latticeBottom = rowEdges[dims.h]!;
      const latticeLeft = colEdges[0]!;
      const latticeRight = colEdges[dims.w]!;
      ctx.strokeStyle = "rgba(180,160,140,0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= dims.w; x++) {
        const px = colEdges[x]! + 0.5;
        ctx.moveTo(px, latticeTop);
        ctx.lineTo(px, latticeBottom);
      }
      for (let y = 0; y <= dims.h; y++) {
        const py = rowEdges[y]! + 0.5;
        ctx.moveTo(latticeLeft, py);
        ctx.lineTo(latticeRight, py);
      }
      ctx.stroke();
    }

    // Atmospheric vignette — soft radial darkening from the playfield
    // center outward. Drawn over the cells but under the selection
    // overlay so the selected cell still pops. Uses integer edges so
    // the gradient matches the visible cell grid exactly.
    {
      const playLeft = colEdges[0]!;
      const playTop = rowEdges[0]!;
      const playRight = colEdges[dims.w]!;
      const playBottom = rowEdges[dims.h]!;
      const playWInt = playRight - playLeft;
      const playHInt = playBottom - playTop;
      const cx = playLeft + playWInt / 2;
      const cy = playTop + playHInt / 2;
      const rInner = Math.min(playWInt, playHInt) * 0.35;
      const rOuter = Math.hypot(playWInt, playHInt) * 0.62;
      const vignette = ctx.createRadialGradient(cx, cy, rInner, cx, cy, rOuter);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.45)");
      ctx.fillStyle = vignette;
      ctx.fillRect(playLeft, playTop, playWInt, playHInt);
    }

    // Playfield border — slightly warmer than the old white-alpha.
    // Wraps the integer-aligned cell grid so the border is flush with
    // the lattice edges (not a sub-pixel offset away).
    {
      const playLeft = colEdges[0]!;
      const playTop = rowEdges[0]!;
      const playRight = colEdges[dims.w]!;
      const playBottom = rowEdges[dims.h]!;
      ctx.strokeStyle = "rgba(180,160,140,0.22)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        playLeft + 0.5,
        playTop + 0.5,
        playRight - playLeft - 1,
        playBottom - playTop - 1,
      );
    }

    // Hover cell indicator — amber outline, only when inside the
    // playfield. Snaps to the same integer edges as the painted cells
    // so the outline sits exactly on the cell boundary (no 1px drift
    // from the lattice).
    if (
      hover &&
      hover.x >= 0 &&
      hover.x < dims.w &&
      hover.y >= 0 &&
      hover.y < dims.h &&
      cell >= 2
    ) {
      const hx = colEdges[hover.x]!;
      const hy = rowEdges[hover.y]!;
      const hw = colEdges[hover.x + 1]! - hx;
      const hh = rowEdges[hover.y + 1]! - hy;
      ctx.strokeStyle = "rgba(245, 158, 11, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);
    }

    // Selected cell — solid amber outline + faint fill + a small
    // floating label below the selection mirroring Map.png's
    // `Brick Wall 7` chip.
    if (
      selected &&
      selected.x >= 0 &&
      selected.x < dims.w &&
      selected.y >= 0 &&
      selected.y < dims.h
    ) {
      const sx = colEdges[selected.x]!;
      const sy = rowEdges[selected.y]!;
      const sw = colEdges[selected.x + 1]! - sx;
      const sh = rowEdges[selected.y + 1]! - sy;
      ctx.fillStyle = "rgba(245, 158, 11, 0.18)";
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);

      // Lookup the topmost painted layer at this coord (highest layer
      // wins). If nothing's painted, surface "Empty".
      if (cell >= 8) {
        const cellAtSel = cells[`${selected.x},${selected.y}`];
        let label = "Empty";
        if (cellAtSel) {
          // Walk layers from top to bottom (reverse `order`) and
          // pick the first layer that has a preset assigned. Prefer
          // the preset's display name when the registry knows it;
          // fall back to the layer name otherwise.
          for (let i = order.length - 1; i >= 0; i--) {
            const lid = order[i]!;
            const pid = cellAtSel.layers[lid];
            if (pid) {
              const presetName = presetRegistry[pid]?.name;
              if (presetName) {
                label = presetName;
              } else {
                const layerRow =
                  MOCK_LAYERS.find((l) => l.id === lid) ??
                  customLayers.find((l) => l.id === lid);
                label = layerRow?.name ?? lid;
              }
              break;
            }
          }
        }
        // Measure + draw the chip background below the selection.
        ctx.font =
          "600 11px ui-sans-serif, system-ui, -apple-system, sans-serif";
        const padX = 6;
        const padY = 3;
        void padY;
        const textW = ctx.measureText(label).width;
        const chipW = Math.ceil(textW + padX * 2);
        const chipH = 18;
        // Center the chip on the selection; clamp to playfield.
        const playLeft = colEdges[0]!;
        const playRight = colEdges[dims.w]!;
        const playBottom = rowEdges[dims.h]!;
        let chipX = sx + sw / 2 - chipW / 2;
        let chipY = sy + sh + 4;
        chipX = Math.max(playLeft + 2, Math.min(playRight - chipW - 2, chipX));
        // If the chip would clip the bottom edge, flip it above the
        // selection.
        if (chipY + chipH > playBottom - 2) {
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
      const stride = cell >= 18 ? 5 : cell >= 9 ? 5 : cell >= 5 ? 10 : 20;
      const showTicks = cell >= 6;
      const showFineTicks = cell >= 30;

      // ---- Top ruler band ----
      ctx.fillStyle = RULER_BG_COLOR;
      ctx.fillRect(0, 0, layout.canvasW, RULER_TOP_PX);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, RULER_TOP_PX - 1, layout.canvasW, 1);

      // ---- Left ruler band ----
      ctx.fillStyle = RULER_BG_COLOR;
      ctx.fillRect(0, 0, RULER_LEFT_PX, layout.canvasH);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(RULER_LEFT_PX - 1, 0, 1, layout.canvasH);

      // ---- Corner cell ----
      ctx.fillStyle = "#0e0c0a";
      ctx.fillRect(0, 0, RULER_LEFT_PX, RULER_TOP_PX);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(RULER_LEFT_PX - 1, 0, 1, RULER_TOP_PX);
      ctx.fillRect(0, RULER_TOP_PX - 1, RULER_LEFT_PX, 1);

      // ---- Tick marks ----
      if (showTicks) {
        ctx.fillStyle = RULER_TICK_COLOR;
        const tickH = 4;
        const tickW = 4;
        for (let x = 0; x <= dims.w; x++) {
          const px = colEdges[x]!;
          if (px < RULER_LEFT_PX || px > layout.canvasW) continue;
          const isMajor = x % stride === 0;
          const reach = isMajor ? tickH + 2 : tickH;
          ctx.fillRect(px, RULER_TOP_PX - reach, 1, reach);
        }
        for (let y = 0; y <= dims.h; y++) {
          const py = rowEdges[y]!;
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
          const px = colEdges[x]! + 0.5;
          if (px < RULER_LEFT_PX || px > layout.canvasW) continue;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, RULER_TOP_PX);
        }
        for (let y = 0; y <= dims.h; y++) {
          const py = rowEdges[y]! + 0.5;
          if (py < RULER_TOP_PX || py > layout.canvasH) continue;
          ctx.moveTo(0, py);
          ctx.lineTo(RULER_LEFT_PX, py);
        }
        ctx.stroke();
      }

      // ---- Labels ----
      ctx.fillStyle = RULER_TEXT_COLOR;
      ctx.font =
        "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
      ctx.textBaseline = "middle";

      // X axis — column numbers along the top band.
      ctx.textAlign = "center";
      for (let x = 0; x <= dims.w; x += stride) {
        if (x >= dims.w) break;
        const px = (colEdges[x]! + colEdges[x + 1]!) / 2;
        if (px < RULER_LEFT_PX + 8) continue;
        if (px > layout.canvasW - 4) continue;
        ctx.fillText(String(x), px, RULER_TOP_PX / 2);
      }

      // Y axis — row numbers along the left band.
      ctx.textAlign = "right";
      for (let y = 0; y <= dims.h; y += stride) {
        if (y >= dims.h) break;
        const py = (rowEdges[y]! + rowEdges[y + 1]!) / 2;
        if (py < RULER_TOP_PX + 8) continue;
        if (py > layout.canvasH - 4) continue;
        ctx.fillText(String(y), RULER_LEFT_PX - 5, py);
      }

      // Reset state for downstream callers.
      ctx.textAlign = "start";
      ctx.textBaseline = "alphabetic";
    }

    // Suppress unused-var lint for layerIndex — kept as a stable
    // ordinal lookup for future render-order branches (e.g. sprite vs
    // light z-ordering inside a single layer).
    void layerIndex;
  }, [
    layout,
    cells,
    order,
    visibility,
    layerColorById,
    customLayers,
    hover,
    selected,
    dims.w,
    dims.h,
    presetRegistry,
    texturesEpoch,
    projectId,
  ]);

  // ---- Pointer handlers --------------------------------------------

  // Translate a canvas-local mouse position into a cell coord pair, or
  // null if the cursor is outside the playfield. Uses the same integer
  // colEdges/rowEdges as the renderer so the hit-test matches the
  // pixels the user sees byte-for-byte (the old `Math.floor((localX -
  // offX) / cell)` drifted by ±1px from the lattice at certain zooms).
  const cellAt = React.useCallback(
    (localX: number, localY: number): { x: number; y: number } | null => {
      const cols = edgesRef.current.cols;
      const rows = edgesRef.current.rows;
      if (cols.length < 2 || rows.length < 2) return null;
      if (localX < cols[0]! || localY < rows[0]!) return null;
      if (localX >= cols[dims.w]! || localY >= rows[dims.h]!) return null;
      // Linear walk — dims ≤ 64 in practice, so a binary search would
      // be measurably slower per call due to the extra branching.
      let cx = 0;
      while (cx < dims.w && localX >= cols[cx + 1]!) cx++;
      let cy = 0;
      while (cy < dims.h && localY >= rows[cy + 1]!) cy++;
      if (cx >= dims.w || cy >= dims.h) return null;
      return { x: cx, y: cy };
    },
    [dims.w, dims.h],
  );

  // Compute the canvas-local position for a mouse event. Encapsulated
  // so handlers don't repeat the getBoundingClientRect dance.
  const localAt = React.useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    },
    [],
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
      const local = localAt(event);
      if (!local) return;
      const c = cellAt(local.x, local.y);
      // Selection store throttles hover + cursor broadcasts at ~33Hz
      // internally, so we do NOT need to panel-throttle here — calling
      // setHover / setCursor on every mousemove is the intended flow.
      useSelectionStore.getState().setHover(c);
      useSelectionStore.getState().setCursor({ x: local.x, y: local.y });
    },
    [cellAt, localAt],
  );

  const handleMouseLeave = React.useCallback(() => {
    useSelectionStore.getState().setHover(null);
    useSelectionStore.getState().setCursor(null);
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
      const local = localAt(event);
      if (!local) return;
      const c = cellAt(local.x, local.y);
      // Tool dispatcher. `select` is the only tool wired to a real
      // store action in Wave 3.3.14; the paint family is intentionally
      // deferred to Wave 3.4 (paint-write loop + history entries).
      const tool = useToolStore.getState().activeTool;
      switch (tool) {
        case "select":
          useSelectionStore.getState().select(c);
          break;
        case "paint":
        case "eraser":
        case "fill":
        case "dropper":
        case "entity-place":
          useDiagnosticsStore
            .getState()
            .log("info", `Tool "${tool}" not wired yet (Wave 3.4)`);
          break;
        default:
          // Unknown / future tool ids — also surface a diagnostic so
          // the gap is visible in OutputPanel rather than silent.
          useDiagnosticsStore
            .getState()
            .log("info", `Tool "${tool}" not handled by MapCanvas`);
          break;
      }
    },
    [cellAt, localAt],
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
    useSelectionStore.getState().select(null);
  }, []);

  const addLayer = React.useCallback(() => {
    const state = useLayerStore.getState();
    const n = state.customLayers.length + 1;
    const color =
      CUSTOM_LAYER_PALETTE[
        state.customLayers.length % CUSTOM_LAYER_PALETTE.length
      ] ?? "#f59e0b";
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `layer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const layer: CustomLayer = { id, name: `Layer ${n}`, color };
    state.add(layer);
  }, []);

  const toggleLayerVisibility = React.useCallback((layerId: string) => {
    useLayerStore.getState().toggleVisibility(layerId);
  }, []);

  const setActiveLayer = React.useCallback((layerId: string) => {
    useLayerStore.getState().activate(layerId);
  }, []);

  const undo = React.useCallback(() => {
    // 3.3.14 wires the cursor mover; payload dispatch (replaying the
    // inverse op into scene state) lands in 3.4 alongside the paint
    // loop that creates the entries in the first place.
    useHistoryStore.getState().undo();
  }, []);

  const redo = React.useCallback(() => {
    useHistoryStore.getState().redo();
  }, []);

  // ---- Command-registry refs --------------------------------------

  const fitToViewRef = React.useRef(fitToView);
  const clearSelectionRef = React.useRef(clearSelection);
  const addLayerRef = React.useRef(addLayer);
  const toggleVisRef = React.useRef(toggleLayerVisibility);
  const setActiveRef = React.useRef(setActiveLayer);
  const undoRef = React.useRef(undo);
  const redoRef = React.useRef(redo);

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
  React.useEffect(() => {
    undoRef.current = undo;
  }, [undo]);
  React.useEffect(() => {
    redoRef.current = redo;
  }, [redo]);

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
        description: "Add a new scene layer.",
        run: () => addLayerRef.current(),
      }),
      registerCommand({
        id: "scene.mapCanvas.undo",
        title: "Undo",
        category: "Map",
        keywords: ["undo", "history", "revert"],
        description: "Undo the most recent edit (history dispatcher lands in Wave 3.4).",
        run: () => undoRef.current(),
      }),
      registerCommand({
        id: "scene.mapCanvas.redo",
        title: "Redo",
        category: "Map",
        keywords: ["redo", "history", "reapply"],
        description: "Redo the most recently undone edit (history dispatcher lands in Wave 3.4).",
        run: () => redoRef.current(),
      }),
    ];
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // Dynamic per-layer commands — re-register when the resolved layer
  // list changes (order or customLayers). Matches LayersPanel's
  // re-registration cadence.
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

  const coordsLabel = hover ? `${hover.x}, ${hover.y}` : "—, —";

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
                    Create a new scene layer. Appends to{" "}
                    <code>useLayerStore.order</code> with a generated id +
                    palette color; rename UI lands later.
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
