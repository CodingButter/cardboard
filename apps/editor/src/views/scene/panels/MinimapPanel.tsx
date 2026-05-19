import React from "react";
import { Grid3x3, Map, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import type { DockPanelDef } from "../../../components/dock/DockShell";
import { Tooltip } from "../../../components/ui/Tooltip";
import { registerCommand } from "../../../state/useCommandStore";
import { MOCK_SCENE_SETTINGS } from "../scene-fixtures";

/**
 * MinimapPanel — opt-in compact overview of the whole scene.
 *
 * Renders a miniature top-down view of the scene on a `<canvas>`: an
 * optional grid lattice plus a few hard-coded "tiles" (colored squares
 * scattered around) to suggest level content, with a viewport
 * rectangle overlay marking where the (stub) main canvas is currently
 * looking. Clicking the minimap recenters that viewport.
 *
 * This is NOT in the default Map.png layout — the user adds it via
 * the Docks modal. Wave 3 will replace the fake tiles + recenter stub
 * with the real `EditorProjectStore` selectors + `MapCanvas` viewport
 * controller. The visual scaffolding here is deliberately self-contained
 * so the layout, command registry, and persistence contract are wired
 * up before real data lands.
 *
 * Persistence contract:
 *   - `cardboard.scene.minimap.showGrid`     boolean, default true
 *   - `cardboard.scene.minimap.showViewport` boolean, default true
 *   - `cardboard.scene.minimap.zoom`         number,  default 1.0 (0.5..3.0)
 *
 * Commands registered:
 *   - scene.minimap.toggleGrid
 *   - scene.minimap.toggleViewport
 *   - scene.minimap.center
 *   - scene.minimap.zoomIn / scene.minimap.zoomOut
 */

const LS_SHOW_GRID = "cardboard.scene.minimap.showGrid";
const LS_SHOW_VIEWPORT = "cardboard.scene.minimap.showViewport";
const LS_ZOOM = "cardboard.scene.minimap.zoom";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 0.25;
const DEFAULT_ZOOM = 1.0;

/** Below this short-edge size in CSS pixels the panel renders an
 *  empty-state instead of a microscopic canvas. */
const MIN_RENDER_PX = 80;
/** Below this width the corner overlay buttons hide to free space. */
const OVERLAY_HIDE_PX = 150;

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

function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return DEFAULT_ZOOM;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Hard-coded decorative "tiles" — purely for visual interest. Coords
 *  are in scene-cell space; `w`/`h` are cell-sized. Wave 3 deletes
 *  this in favor of the real scene tile grid. */
interface FakeTile {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
const FAKE_TILES: readonly FakeTile[] = [
  { x: 6, y: 8, w: 6, h: 4, color: "#f59e0b" }, // amber — wall block
  { x: 18, y: 12, w: 3, h: 3, color: "#38bdf8" }, // sky — water
  { x: 28, y: 6, w: 8, h: 2, color: "#10b981" }, // green — corridor
  { x: 44, y: 20, w: 4, h: 8, color: "#a78bfa" }, // violet — prop cluster
  { x: 10, y: 34, w: 10, h: 6, color: "#ef4444" }, // red — hazard zone
  { x: 36, y: 40, w: 6, h: 6, color: "#f59e0b" }, // amber — wall block
  { x: 52, y: 48, w: 8, h: 6, color: "#38bdf8" }, // sky — water
];

export function MinimapPanel(): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // Container size — driven by ResizeObserver, used both for the
  // canvas backing-store sizing and for the responsive overlay logic.
  const [size, setSize] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });

  // Persisted toggles + zoom.
  const [showGrid, setShowGrid] = React.useState<boolean>(() => {
    const stored = readLS(LS_SHOW_GRID);
    return stored == null ? true : stored === "true";
  });
  const [showViewport, setShowViewport] = React.useState<boolean>(() => {
    const stored = readLS(LS_SHOW_VIEWPORT);
    return stored == null ? true : stored === "true";
  });
  const [zoom, setZoom] = React.useState<number>(() => {
    const stored = readLS(LS_ZOOM);
    const parsed = stored == null ? DEFAULT_ZOOM : Number(stored);
    return clampZoom(parsed);
  });

  // Viewport center, in scene-cell coords. Click-to-recenter writes
  // here; "Center Minimap" command resets it to the scene midpoint.
  // The viewport size (in cells) is a fixed fraction of the scene —
  // big enough to be visible at any zoom, small enough to leave room
  // around it. Wave 3 replaces with real MapCanvas camera state.
  const dims = MOCK_SCENE_SETTINGS.dimensions;
  const [viewport, setViewport] = React.useState<{ cx: number; cy: number }>(
    () => ({ cx: dims.w / 2, cy: dims.h / 2 }),
  );

  // Persist toggles + zoom whenever they change.
  React.useEffect(() => {
    writeLS(LS_SHOW_GRID, String(showGrid));
  }, [showGrid]);
  React.useEffect(() => {
    writeLS(LS_SHOW_VIEWPORT, String(showViewport));
  }, [showViewport]);
  React.useEffect(() => {
    writeLS(LS_ZOOM, String(zoom));
  }, [zoom]);

  // ResizeObserver — re-measures the container so the canvas can be
  // re-sized + re-drawn whenever the dock layout changes shape.
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
    // Seed once immediately so the first paint doesn't render at 0×0.
    const rect = el.getBoundingClientRect();
    setSize({ w: Math.round(rect.width), h: Math.round(rect.height) });
    return () => ro.disconnect();
  }, []);

  // Derived: the cell-pixel size and the letterbox offset that keeps
  // the scene square centered in a possibly-rectangular panel.
  const layout = React.useMemo(() => {
    if (size.w <= 0 || size.h <= 0) {
      return { cell: 0, offX: 0, offY: 0, gridW: 0, gridH: 0 };
    }
    // Fit the larger scene axis to the smaller panel axis, scaled by
    // `zoom`. Without zoom this is a pure letterbox. With zoom we just
    // multiply the cell size — overflow stays inside the canvas via
    // clipping (no scrollbars per the spec).
    const fitCell =
      Math.min(size.w / dims.w, size.h / dims.h) * zoom;
    const cell = Math.max(0, fitCell);
    const gridW = cell * dims.w;
    const gridH = cell * dims.h;
    const offX = (size.w - gridW) / 2;
    const offY = (size.h - gridH) / 2;
    return { cell, offX, offY, gridW, gridH };
  }, [size.w, size.h, dims.w, dims.h, zoom]);

  // Canvas paint. Re-runs on every relevant input. Tiny enough to be
  // fine — the scene fixture is 64×64 and we're not animating.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (size.w <= 0 || size.h <= 0) return;
    if (size.w < MIN_RENDER_PX || size.h < MIN_RENDER_PX) return;

    // HiDPI: size the backing-store to devicePixelRatio so the grid
    // lines stay crisp on retina screens while CSS keeps it at panel
    // size.
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.max(1, Math.round(size.w * dpr));
    canvas.height = Math.max(1, Math.round(size.h * dpr));
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Background — slightly inset card tone so the minimap reads
    // as content inside the panel-surface card it lives in.
    ctx.fillStyle = "#0c0c0e";
    ctx.fillRect(0, 0, size.w, size.h);

    const { cell, offX, offY, gridW, gridH } = layout;
    if (cell <= 0) return;

    // Scene "floor" rectangle — slightly lighter than the panel bg
    // so the grid sits on a visible playfield.
    ctx.fillStyle = "#1a1a1d";
    ctx.fillRect(offX, offY, gridW, gridH);

    // Fake tiles. Drawn before the grid so the grid lattice reads
    // on top — keeps cell boundaries legible inside filled regions.
    for (const t of FAKE_TILES) {
      ctx.fillStyle = t.color;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(
        offX + t.x * cell,
        offY + t.y * cell,
        t.w * cell,
        t.h * cell,
      );
    }
    ctx.globalAlpha = 1;

    // Grid lattice. Skip drawing individual cell lines when each cell
    // is sub-pixel — they'd just smear into a gray rectangle. The
    // playfield border is always drawn so the scene extent is clear.
    if (showGrid && cell >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      // Vertical lines.
      for (let x = 0; x <= dims.w; x++) {
        const px = Math.round(offX + x * cell) + 0.5;
        ctx.moveTo(px, offY);
        ctx.lineTo(px, offY + gridH);
      }
      // Horizontal lines.
      for (let y = 0; y <= dims.h; y++) {
        const py = Math.round(offY + y * cell) + 0.5;
        ctx.moveTo(offX, py);
        ctx.lineTo(offX + gridW, py);
      }
      ctx.stroke();
    }

    // Playfield border — always drawn so the scene extent is visible
    // even when the grid lattice is hidden or too dense to render.
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      Math.round(offX) + 0.5,
      Math.round(offY) + 0.5,
      Math.round(gridW),
      Math.round(gridH),
    );

    // Viewport frustum — amber outline matching the editor accent.
    // Size: ~25% of the scene short edge, in cells.
    if (showViewport) {
      const vpCells = Math.max(2, Math.min(dims.w, dims.h) * 0.25);
      const vpW = vpCells * cell;
      const vpH = vpCells * cell;
      const vx = offX + viewport.cx * cell - vpW / 2;
      const vy = offY + viewport.cy * cell - vpH / 2;
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        Math.round(vx) + 0.5,
        Math.round(vy) + 0.5,
        Math.round(vpW),
        Math.round(vpH),
      );
      // Subtle fill so the rectangle reads even on a busy minimap.
      ctx.fillStyle = "rgba(245, 158, 11, 0.10)";
      ctx.fillRect(vx, vy, vpW, vpH);
    }
  }, [
    size.w,
    size.h,
    layout,
    showGrid,
    showViewport,
    viewport.cx,
    viewport.cy,
    dims.w,
    dims.h,
  ]);

  // ---- Handlers ----------------------------------------------------

  const handleToggleGrid = React.useCallback(() => {
    setShowGrid((g) => !g);
  }, []);

  const handleToggleViewport = React.useCallback(() => {
    setShowViewport((v) => !v);
  }, []);

  const handleCenter = React.useCallback(() => {
    setViewport({ cx: dims.w / 2, cy: dims.h / 2 });
  }, [dims.w, dims.h]);

  const handleZoomIn = React.useCallback(() => {
    setZoom((z) => clampZoom(z + ZOOM_STEP));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setZoom((z) => clampZoom(z - ZOOM_STEP));
  }, []);

  // Click-to-recenter — translates a canvas-local click into scene-
  // cell coords by inverting the same letterbox math used to paint.
  const handleCanvasClick = React.useCallback(
    (event: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const { cell, offX, offY, gridW, gridH } = layout;
      if (cell <= 0) return;
      // Reject clicks outside the letterboxed playfield — they don't
      // correspond to a scene cell.
      if (
        localX < offX ||
        localX > offX + gridW ||
        localY < offY ||
        localY > offY + gridH
      )
        return;
      const cx = (localX - offX) / cell;
      const cy = (localY - offY) / cell;
      setViewport({
        cx: Math.min(dims.w, Math.max(0, cx)),
        cy: Math.min(dims.h, Math.max(0, cy)),
      });
    },
    [layout, dims.w, dims.h],
  );

  // ---- Command-registry refs --------------------------------------
  // Canonical pattern from `state/README.md`: keep refs in sync with
  // the latest handler identity so the registration effect can run
  // exactly once.
  const toggleGridRef = React.useRef(handleToggleGrid);
  const toggleViewportRef = React.useRef(handleToggleViewport);
  const centerRef = React.useRef(handleCenter);
  const zoomInRef = React.useRef(handleZoomIn);
  const zoomOutRef = React.useRef(handleZoomOut);

  React.useEffect(() => {
    toggleGridRef.current = handleToggleGrid;
  }, [handleToggleGrid]);
  React.useEffect(() => {
    toggleViewportRef.current = handleToggleViewport;
  }, [handleToggleViewport]);
  React.useEffect(() => {
    centerRef.current = handleCenter;
  }, [handleCenter]);
  React.useEffect(() => {
    zoomInRef.current = handleZoomIn;
  }, [handleZoomIn]);
  React.useEffect(() => {
    zoomOutRef.current = handleZoomOut;
  }, [handleZoomOut]);

  React.useEffect(() => {
    const unregs: Array<() => void> = [
      registerCommand({
        id: "scene.minimap.toggleGrid",
        title: "Toggle Minimap Grid",
        category: "Minimap",
        keywords: ["minimap", "grid", "lattice", "toggle"],
        description: "Show or hide the cell lattice on the minimap.",
        run: () => toggleGridRef.current(),
      }),
      registerCommand({
        id: "scene.minimap.toggleViewport",
        title: "Toggle Minimap Viewport",
        category: "Minimap",
        keywords: ["minimap", "viewport", "frustum", "camera", "toggle"],
        description:
          "Show or hide the viewport rectangle that tracks the main canvas.",
        run: () => toggleViewportRef.current(),
      }),
      registerCommand({
        id: "scene.minimap.center",
        title: "Center Minimap",
        category: "Minimap",
        keywords: ["minimap", "center", "recenter", "reset"],
        description: "Reset the viewport rectangle to the scene center.",
        run: () => centerRef.current(),
      }),
      registerCommand({
        id: "scene.minimap.zoomIn",
        title: "Zoom Minimap In",
        category: "Minimap",
        keywords: ["minimap", "zoom", "in"],
        description: "Increase the minimap zoom level.",
        run: () => zoomInRef.current(),
      }),
      registerCommand({
        id: "scene.minimap.zoomOut",
        title: "Zoom Minimap Out",
        category: "Minimap",
        keywords: ["minimap", "zoom", "out"],
        description: "Decrease the minimap zoom level.",
        run: () => zoomOutRef.current(),
      }),
    ];
    return () => {
      for (const u of unregs) u();
    };
  }, []);

  // ---- Render -----------------------------------------------------

  const tooSmall =
    size.w > 0 && size.h > 0 && (size.w < MIN_RENDER_PX || size.h < MIN_RENDER_PX);
  const showOverlay = size.w >= OVERLAY_HIDE_PX;

  // Outer container is layout-only — DockShell wraps this in a
  // PanelSurface card (raised, `p-2` inner padding). `overflow-hidden`
  // guarantees we never spawn a scrollbar even at extreme zooms.
  return (
    <div
      ref={containerRef}
      data-panel="minimap"
      className="relative h-full w-full overflow-hidden"
    >
      {tooSmall ? (
        <div
          className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wider text-(--color-fg-muted)"
          aria-label="Minimap too small to render"
        >
          Too small
        </div>
      ) : (
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          className="absolute inset-0 block cursor-crosshair"
          aria-label="Scene minimap"
        />
      )}

      {/*
        Corner overlay — buttons hide below ~150px width to free up
        the canvas. Tooltip stages match the project-wide standard:
        2s = short label, 5s = label + description.
      */}
      {!tooSmall && showOverlay && (
        <div className="absolute top-1 right-1 flex gap-1 pointer-events-auto">
          <Tooltip
            side="bottom"
            stages={[
              { delay: 1000, content: <span>Toggle Grid</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Toggle Grid</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Show or hide the cell lattice on the minimap.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Toggle minimap grid"
              aria-pressed={showGrid}
              onClick={handleToggleGrid}
              className={[
                "h-6 w-6 rounded border flex items-center justify-center",
                "transition-colors",
                showGrid
                  ? "bg-amber-500 border-amber-500 text-zinc-950"
                  : "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60",
              ].join(" ")}
            >
              <Grid3x3 size={12} aria-hidden="true" />
            </button>
          </Tooltip>

          <Tooltip
            side="bottom"
            stages={[
              { delay: 1000, content: <span>Toggle Viewport</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Toggle Viewport</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Show or hide the rectangle that tracks the main
                      canvas viewport.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Toggle minimap viewport"
              aria-pressed={showViewport}
              onClick={handleToggleViewport}
              className={[
                "h-6 w-6 rounded border flex items-center justify-center",
                "transition-colors",
                showViewport
                  ? "bg-amber-500 border-amber-500 text-zinc-950"
                  : "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60",
              ].join(" ")}
            >
              <Maximize2 size={12} aria-hidden="true" />
            </button>
          </Tooltip>

          <Tooltip
            side="bottom"
            stages={[
              { delay: 1000, content: <span>Center</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Center Minimap</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Reset the viewport rectangle to the scene center.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Center minimap viewport"
              onClick={handleCenter}
              className={[
                "h-6 w-6 rounded border flex items-center justify-center",
                "transition-colors",
                "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60",
              ].join(" ")}
            >
              <Map size={12} aria-hidden="true" />
            </button>
          </Tooltip>

          <Tooltip
            side="bottom"
            stages={[
              { delay: 1000, content: <span>Zoom In</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Zoom In</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Increase the minimap zoom (max {ZOOM_MAX.toFixed(1)}×).
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Zoom minimap in"
              disabled={zoom >= ZOOM_MAX}
              onClick={handleZoomIn}
              className={[
                "h-6 w-6 rounded border flex items-center justify-center",
                "transition-colors",
                "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60",
                "disabled:opacity-40 disabled:hover:border-(--color-border-strong)",
              ].join(" ")}
            >
              <ZoomIn size={12} aria-hidden="true" />
            </button>
          </Tooltip>

          <Tooltip
            side="bottom"
            stages={[
              { delay: 1000, content: <span>Zoom Out</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Zoom Out</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Decrease the minimap zoom (min {ZOOM_MIN.toFixed(1)}×).
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label="Zoom minimap out"
              disabled={zoom <= ZOOM_MIN}
              onClick={handleZoomOut}
              className={[
                "h-6 w-6 rounded border flex items-center justify-center",
                "transition-colors",
                "bg-zinc-900/80 border-(--color-border-strong) text-(--color-fg-secondary) hover:border-amber-500/60",
                "disabled:opacity-40 disabled:hover:border-(--color-border-strong)",
              ].join(" ")}
            >
              <ZoomOut size={12} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon"> = {
  id: "minimap",
  title: "Minimap",
  icon: <Map size={12} />,
};

export default MinimapPanel;
