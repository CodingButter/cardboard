import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PackManifest, PresetResolver, ResolvedPresetData } from "@two_5_d/engine";
import { EditorAssetPack } from "../lib/EditorAssetPack";
import { Button } from "../components/ui";
import { cn } from "../lib/cn";

/**
 * E3 — 2D top-down grid editor for the editor's Edit mode.
 *
 * The engine's raycaster is irrelevant here: this is a pure top-down
 * authoring surface that paints preset ids into the scene's three
 * grids (walls / floors / ceiling) and keeps an `idMap` in sync.
 *
 * Per `docs/plans/EDITOR.md` §6.1 + §10 (E3):
 *   - Drag-drop preset paints (we use click-paint + drag-paint here).
 *   - Right-click erases (writes a `0`, removing the cell's link).
 *   - W/F/C swaps the active layer.
 *   - Layer toggle in the toolbar (also reflects keyboard).
 *   - Hover highlight + cell inspector when a cell is selected.
 *
 * Paint semantics: when the active preset isn't already in
 * `scene.idMap`, allocate the next free int id (max(existing) + 1)
 * and add the entry; otherwise reuse the existing int id. This keeps
 * the idMap sparse and matches the §6.1 "no duplicate refs" rule.
 *
 * State ownership: the parent owns the scene JSON + dirty flag and
 * passes a setter so we can keep a single source of truth across the
 * Save button / debounced auto-save and the in-memory engine remount
 * when the user flips back to Play mode.
 */

type LayerName = "walls" | "floors" | "ceiling";

/** Minimal scene shape we need to mutate — kept loose so the editor
 *  can round-trip arbitrary scene-extra fields untouched. */
export interface MutableScene {
  spawn?: { x: number; y: number; facing?: number };
  idMap?: Record<string, string | null>;
  walls: Array<Array<number>>;
  floors?: Array<Array<number>>;
  ceiling?: Array<Array<number>>;
  ceilings?: Array<Array<number>>;
  layerDefaults?: { floor?: string; ceiling?: string };
  // Anything else round-trips verbatim.
  [key: string]: unknown;
}

export interface GridEditorProps {
  projectId: string;
  scenePath: string;
  scene: MutableScene;
  /** Called whenever a paint mutation happens; parent dedupes + persists. */
  onSceneChange: (next: MutableScene) => void;
}

/** Brand-color palette used as deterministic swatches when a preset
 *  texture hasn't loaded (or the preset has no texture path). */
const FALLBACK_PALETTE = [
  "#d97706", // amber-600
  "#0891b2", // cyan-600
  "#65a30d", // lime-600
  "#c026d3", // fuchsia-600
  "#dc2626", // red-600
  "#4f46e5", // indigo-600
  "#0d9488", // teal-600
  "#a16207", // yellow-700
];

/** Pick a stable swatch color for a preset id (used when no texture). */
function colorForPreset(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length]!;
}

/** Read the `ceiling` grid by either name (some scenes use plural). */
function getCeilingGrid(scene: MutableScene): Array<Array<number>> | undefined {
  return scene.ceiling ?? scene.ceilings;
}

/** Write back the ceiling grid, preserving whichever key was originally used. */
function setCeilingGrid(
  scene: MutableScene,
  grid: Array<Array<number>>,
): MutableScene {
  const next = { ...scene };
  if (next.ceilings !== undefined) {
    next.ceilings = grid;
  } else {
    next.ceiling = grid;
  }
  return next;
}

/** Read the grid for a given layer (always a 2D number[][]). */
function getLayer(scene: MutableScene, layer: LayerName): Array<Array<number>> {
  if (layer === "walls") return scene.walls;
  if (layer === "floors") return scene.floors ?? [];
  return getCeilingGrid(scene) ?? [];
}

/** Replace a layer in the scene immutably. */
function replaceLayer(
  scene: MutableScene,
  layer: LayerName,
  grid: Array<Array<number>>,
): MutableScene {
  if (layer === "walls") return { ...scene, walls: grid };
  if (layer === "floors") return { ...scene, floors: grid };
  return setCeilingGrid(scene, grid);
}

/** Ensure an idMap exists, returning a fresh ref. */
function ensureIdMap(scene: MutableScene): Record<string, string | null> {
  return { ...(scene.idMap ?? { "0": null }) };
}

/** Return the int id already mapped to `presetId`, or null if none. */
function findIdForPreset(
  idMap: Record<string, string | null>,
  presetId: string,
): number | null {
  for (const [k, v] of Object.entries(idMap)) {
    if (v === presetId) return Number(k);
  }
  return null;
}

/** Allocate the next free int id (max + 1, starting from 1). */
function nextFreeId(idMap: Record<string, string | null>): number {
  let max = 0;
  for (const k of Object.keys(idMap)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/** Resolve a numeric cell to a preset id via idMap, or null if open. */
function presetForCell(
  scene: MutableScene,
  layer: LayerName,
  x: number,
  y: number,
): string | null {
  const grid = getLayer(scene, layer);
  const cell = grid[y]?.[x];
  if (typeof cell !== "number" || cell === 0) {
    // Honour per-layer defaults for floors / ceilings — a `0` resolves
    // to the layer default if one's set (matches engine semantics).
    if (cell === 0 || cell === undefined) {
      if (layer === "floors") return scene.layerDefaults?.floor ?? null;
      if (layer === "ceiling") return scene.layerDefaults?.ceiling ?? null;
    }
    return null;
  }
  return scene.idMap?.[String(cell)] ?? null;
}

interface TexturePreviewBundle {
  presetId: string;
  data: ResolvedPresetData;
  /** Object URL for the preset's primary texture; null if not loaded yet. */
  url: string | null;
}

/** Texture loader for the preset palette + cell renderer. Resolves
 *  the manifest preset → texture path → IDB blob → object URL. Caches
 *  by texture path so the same URL is shared across all consumers. */
function useTexturePack(projectId: string, manifest: PackManifest) {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const inflightRef = useRef<Map<string, Promise<string>>>(new Map());
  const packRef = useRef<EditorAssetPack | null>(null);
  const [, force] = useState(0);

  // Build the pack once; the inner manifest reference may change but
  // the project id won't, so the pack object is stable.
  useEffect(() => {
    let alive = true;
    EditorAssetPack.fromProject(projectId).then((pack) => {
      if (!alive) return;
      packRef.current = pack;
      force((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  // Revoke any object URLs we created on unmount.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      cache.clear();
    };
  }, []);

  const loadTexture = useCallback(
    (path: string): string | null => {
      const cached = cacheRef.current.get(path);
      if (cached) return cached;
      const pack = packRef.current;
      if (!pack || !pack.has(path)) return null;
      if (inflightRef.current.has(path)) return null;
      const promise = pack.textureBlob(path).then((blob) => {
        const url = URL.createObjectURL(blob);
        cacheRef.current.set(path, url);
        inflightRef.current.delete(path);
        force((n) => n + 1);
        return url;
      });
      inflightRef.current.set(path, promise);
      return null;
    },
    [],
  );

  return { pack: packRef.current, loadTexture };
}

/** Build a resolver from the editor pack and cache it across renders.
 *  We rebuild whenever the manifest reference changes (preset edits
 *  during E4 — for E3 it's effectively a one-shot). */
function useResolver(
  pack: EditorAssetPack | null,
): { resolver: PresetResolver | null; error: string | null } {
  const [state, setState] = useState<{
    resolver: PresetResolver | null;
    error: string | null;
  }>({ resolver: null, error: null });

  useEffect(() => {
    if (!pack) return;
    let alive = true;
    pack
      .presets()
      .then((resolver) => {
        if (!alive) return;
        setState({ resolver, error: null });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setState({ resolver: null, error: (err as Error).message });
      });
    return () => {
      alive = false;
    };
  }, [pack]);

  return state;
}

export function GridEditor({
  projectId,
  scenePath,
  scene,
  onSceneChange,
}: GridEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const { pack, loadTexture } = useTexturePack(projectId, /* manifest unused */ {} as PackManifest);
  const { resolver, error: resolverError } = useResolver(pack);

  // Pan + zoom state. `cellSize` is the px-per-tile at zoom=1.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [layer, setLayer] = useState<LayerName>("walls");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [presetFilter, setPresetFilter] = useState("");

  // Drag-paint state — track which button is held + last cell painted
  // so we don't re-paint the same cell mid-stroke (cheaper for big strokes).
  const dragRef = useRef<{ button: 0 | 2 | null; last: string | null }>({
    button: null,
    last: null,
  });
  const isPanningRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  }>({ active: false, startX: 0, startY: 0, panX: 0, panY: 0 });

  const wallsGrid = scene.walls;
  const height = wallsGrid.length;
  const width = wallsGrid[0]?.length ?? 0;
  const cellSize = Math.max(2, Math.floor(20 * zoom));

  // Center the viewport on the scene the first time we mount it. The
  // user can pan with middle-button drag (or space+drag) thereafter.
  const centeredRef = useRef(false);
  useEffect(() => {
    if (centeredRef.current) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPan({
      x: Math.floor(r.width / 2 - (width * cellSize) / 2),
      y: Math.floor(r.height / 2 - (height * cellSize) / 2),
    });
    centeredRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height]);

  // Preset palette — sorted, exposes a swatch + texture-url-or-null.
  const presetList = useMemo<TexturePreviewBundle[]>(() => {
    if (!resolver) return [];
    const out: TexturePreviewBundle[] = [];
    for (const preset of resolver) {
      // Skip __legacy.* aliases from the picker — they're a back-compat
      // shim, not authoring vocabulary (per TILE_PRESETS.md §5.3).
      if (preset.id.startsWith("__legacy.")) continue;
      // Skip anonymous content-hash presets — they're per-cell tweaks
      // and don't belong in the global palette.
      if (preset.id.startsWith("_")) continue;
      out.push({
        presetId: preset.id,
        data: preset.data,
        url: loadTexture(preset.data.texture),
      });
    }
    out.sort((a, b) => a.presetId.localeCompare(b.presetId));
    return out;
  }, [resolver, loadTexture]);

  const filteredPresets = useMemo(() => {
    const q = presetFilter.trim().toLowerCase();
    if (!q) return presetList;
    return presetList.filter((p) => p.presetId.toLowerCase().includes(q));
  }, [presetList, presetFilter]);

  // Pick a default active preset when the palette first populates.
  useEffect(() => {
    if (!activePreset && presetList.length > 0) {
      setActivePreset(presetList[0]!.presetId);
    }
  }, [presetList, activePreset]);

  // ── Painting -------------------------------------------------------
  const paintCell = useCallback(
    (x: number, y: number, mode: "paint" | "erase") => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const grid = getLayer(scene, layer);
      // Floors / ceiling grids may be sparse — materialise rows on demand.
      const rows: Array<Array<number>> = new Array(height);
      for (let yy = 0; yy < height; yy++) {
        const src = grid[yy];
        if (src && src.length === width) {
          rows[yy] = yy === y ? [...src] : src;
        } else {
          // Pad / create a row of zeros so the layer matches the wall grid.
          const padded = new Array<number>(width);
          for (let xx = 0; xx < width; xx++) padded[xx] = src?.[xx] ?? 0;
          rows[yy] = padded;
        }
      }
      const targetRow = rows[y]!;
      const currentValue = targetRow[x] ?? 0;

      if (mode === "erase") {
        if (currentValue === 0) return; // already empty
        const nextRow = [...targetRow];
        nextRow[x] = 0;
        rows[y] = nextRow;
        onSceneChange(replaceLayer(scene, layer, rows));
        return;
      }

      // Paint with the active preset. Allocate / reuse an idMap id.
      if (!activePreset) return;
      const idMap = ensureIdMap(scene);
      let id = findIdForPreset(idMap, activePreset);
      let nextScene = scene;
      if (id === null) {
        id = nextFreeId(idMap);
        idMap[String(id)] = activePreset;
        nextScene = { ...nextScene, idMap };
      }
      if (currentValue === id) return; // already this preset
      const nextRow = [...targetRow];
      nextRow[x] = id;
      rows[y] = nextRow;
      onSceneChange(replaceLayer(nextScene, layer, rows));
    },
    [scene, layer, width, height, activePreset, onSceneChange],
  );

  // ── Mouse interaction ---------------------------------------------
  const screenToCell = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const lx = clientX - rect.left - pan.x;
      const ly = clientY - rect.top - pan.y;
      const x = Math.floor(lx / cellSize);
      const y = Math.floor(ly / cellSize);
      if (x < 0 || y < 0 || x >= width || y >= height) return null;
      return { x, y };
    },
    [pan, cellSize, width, height],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      // Middle-mouse-button or space-held = pan; left = paint; right = erase.
      if (e.button === 1) {
        isPanningRef.current = {
          active: true,
          startX: e.clientX,
          startY: e.clientY,
          panX: pan.x,
          panY: pan.y,
        };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
        return;
      }
      const cell = screenToCell(e.clientX, e.clientY);
      if (!cell) return;
      if (e.button === 0) {
        dragRef.current = { button: 0, last: `${cell.x},${cell.y}` };
        setSelected(cell);
        paintCell(cell.x, cell.y, "paint");
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (e.button === 2) {
        dragRef.current = { button: 2, last: `${cell.x},${cell.y}` };
        paintCell(cell.x, cell.y, "erase");
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    [pan, screenToCell, paintCell],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isPanningRef.current.active) {
        const dx = e.clientX - isPanningRef.current.startX;
        const dy = e.clientY - isPanningRef.current.startY;
        setPan({
          x: isPanningRef.current.panX + dx,
          y: isPanningRef.current.panY + dy,
        });
        return;
      }
      const cell = screenToCell(e.clientX, e.clientY);
      setHover(cell);
      if (!cell) return;
      const drag = dragRef.current;
      if (drag.button !== null) {
        const key = `${cell.x},${cell.y}`;
        if (drag.last !== key) {
          drag.last = key;
          paintCell(cell.x, cell.y, drag.button === 0 ? "paint" : "erase");
        }
      }
    },
    [screenToCell, paintCell],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (isPanningRef.current.active) {
      isPanningRef.current.active = false;
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      return;
    }
    dragRef.current = { button: null, last: null };
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setZoom((z) => Math.max(0.25, Math.min(6, z * factor)));
  }, []);

  // Layer keyboard shortcuts — W / F / C. We listen on window but
  // ignore keystrokes targeted at inputs so the preset filter still works.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "w" || e.key === "W") setLayer("walls");
      else if (e.key === "f" || e.key === "F") setLayer("floors");
      else if (e.key === "c" || e.key === "C") setLayer("ceiling");
      else if (e.key === "+" || e.key === "=")
        setZoom((z) => Math.min(6, z * 1.2));
      else if (e.key === "-" || e.key === "_")
        setZoom((z) => Math.max(0.25, z / 1.2));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Track wrapper size so the canvas matches its container.
  const [size, setSize] = useState({ w: 800, h: 480 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Draw loop (rAF) ----------------------------------------------
  // Re-render on any state that affects the canvas. We do this inside
  // a rAF callback rather than synchronously inside `useEffect` so
  // multiple rapid state updates (drag-paint) coalesce into one frame.
  useEffect(() => {
    const canvasEl = canvasRef.current;
    if (!canvasEl) return;
    const ctx2d = canvasEl.getContext("2d");
    if (!ctx2d) return;
    // Re-alias as non-null locals so the nested draw() closure
    // doesn't lose the narrowing TS performed up here.
    const canvas: HTMLCanvasElement = canvasEl;
    const ctx: CanvasRenderingContext2D = ctx2d;

    let raf = 0;
    let cancelled = false;

    const presetUrlByPath = (path: string) => {
      // Reuse the texture pack's cache. `loadTexture` returns null on
      // miss + kicks off a fetch that re-renders us when it resolves.
      return loadTexture(path);
    };

    function draw() {
      if (cancelled) return;
      ctx.fillStyle = "#0c0a09"; // zinc-950
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const grid = getLayer(scene, layer);
      const idMap = scene.idMap ?? {};

      // Visible cell range — culls work outside the viewport so big
      // maps stay performant.
      const x0 = Math.max(0, Math.floor(-pan.x / cellSize));
      const y0 = Math.max(0, Math.floor(-pan.y / cellSize));
      const x1 = Math.min(width, Math.ceil((canvas.width - pan.x) / cellSize));
      const y1 = Math.min(
        height,
        Math.ceil((canvas.height - pan.y) / cellSize),
      );

      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const id = grid[y]?.[x] ?? 0;
          const px = pan.x + x * cellSize;
          const py = pan.y + y * cellSize;

          // Background fill — empty cells get a checkered floor pattern
          // so the user can tell open from out-of-bounds.
          if (id === 0) {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#1c1917" : "#171410";
            ctx.fillRect(px, py, cellSize, cellSize);
            continue;
          }

          const presetId = idMap[String(id)];
          let drewTexture = false;
          if (presetId) {
            const preset = resolver?.get(presetId);
            const tex = preset?.data.texture;
            if (tex) {
              const url = presetUrlByPath(tex);
              if (url) {
                const img = imageCache.get(url);
                if (img && img.complete && img.naturalWidth > 0) {
                  ctx.drawImage(img, px, py, cellSize, cellSize);
                  drewTexture = true;
                } else if (!img) {
                  // First sighting — kick off a load that re-renders
                  // us via state when complete.
                  const next = new Image();
                  next.src = url;
                  next.onload = () => {
                    imageCache.set(url, next);
                    // Force a re-render by bumping a useState.
                    bumpRef.current?.();
                  };
                  imageCache.set(url, next);
                }
              }
            }
          }
          if (!drewTexture) {
            ctx.fillStyle = presetId
              ? colorForPreset(presetId)
              : "#52525b"; // unknown id → zinc-600
            ctx.fillRect(px, py, cellSize, cellSize);
          }

          // Grid line.
          ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, cellSize - 1, cellSize - 1);
        }
      }

      // Spawn marker (player position).
      const sx = scene.spawn?.x;
      const sy = scene.spawn?.y;
      if (typeof sx === "number" && typeof sy === "number") {
        const px = pan.x + sx * cellSize;
        const py = pan.y + sy * cellSize;
        ctx.fillStyle = "#fbbf24"; // amber-400
        ctx.beginPath();
        ctx.arc(px, py, Math.max(4, cellSize * 0.25), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // Facing arrow.
        const facing = scene.spawn?.facing ?? 0;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(
          px + Math.cos(facing) * cellSize * 0.5,
          py + Math.sin(facing) * cellSize * 0.5,
        );
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Hover highlight.
      if (hover) {
        const hx = pan.x + hover.x * cellSize;
        const hy = pan.y + hover.y * cellSize;
        ctx.strokeStyle = "rgba(251, 191, 36, 0.8)"; // amber-400
        ctx.lineWidth = 2;
        ctx.strokeRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
      }

      // Selection outline.
      if (selected) {
        const hx = pan.x + selected.x * cellSize;
        const hy = pan.y + selected.y * cellSize;
        ctx.strokeStyle = "#f59e0b"; // amber-500
        ctx.lineWidth = 3;
        ctx.strokeRect(hx + 1, hy + 1, cellSize - 2, cellSize - 2);
      }
    }

    function loop() {
      draw();
      raf = requestAnimationFrame(loop);
    }
    loop();
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // We deliberately omit `loadTexture` + `resolver` from deps so the
    // draw loop doesn't restart on every render. They're read out of
    // closures that capture the latest refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, layer, pan, cellSize, hover, selected, resolver, size]);

  // Bump trigger for re-render when an image finishes loading mid-draw.
  const bumpRef = useRef<(() => void) | null>(null);
  const [, setBump] = useState(0);
  useEffect(() => {
    bumpRef.current = () => setBump((n) => n + 1);
    return () => {
      bumpRef.current = null;
    };
  }, []);

  // Resize the canvas pixel buffer to match the container at devicePixelRatio = 1
  // for simplicity (the editor doesn't need crisp HiDPI for swatches).
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = size.w;
    c.height = size.h;
  }, [size]);

  // ── Cell inspector data --------------------------------------------
  const selectedPresetId = selected
    ? presetForCell(scene, layer, selected.x, selected.y)
    : null;
  const selectedPreset = selectedPresetId
    ? resolver?.get(selectedPresetId)
    : undefined;

  return (
    <div className="flex h-full w-full bg-zinc-950 text-zinc-100">
      {/* Left: preset palette. */}
      <aside className="w-56 shrink-0 border-r border-zinc-800 flex flex-col">
        <div className="px-3 py-2 border-b border-zinc-800">
          <div className="text-xs uppercase tracking-wide text-zinc-400 mb-1">
            Tile presets
          </div>
          <input
            value={presetFilter}
            onChange={(e) => setPresetFilter(e.target.value)}
            placeholder="filter…"
            className="w-full h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-xs"
          />
        </div>
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {resolverError ? (
            <div className="text-xs text-red-400">
              Preset load failed: {resolverError}
            </div>
          ) : null}
          {filteredPresets.length === 0 && !resolverError ? (
            <div className="text-xs text-zinc-500 py-2">
              {resolver
                ? "No named presets in manifest.tilePresets[]."
                : "Loading…"}
            </div>
          ) : null}
          {filteredPresets.map((p) => (
            <button
              key={p.presetId}
              onClick={() => setActivePreset(p.presetId)}
              className={cn(
                "flex items-center gap-2 w-full rounded px-2 py-1 text-left text-xs",
                activePreset === p.presetId
                  ? "bg-amber-500 text-zinc-950"
                  : "hover:bg-zinc-800 text-zinc-200",
              )}
              title={p.presetId}
            >
              <span
                className="block w-6 h-6 rounded border border-zinc-700 shrink-0"
                style={{
                  background: p.url
                    ? `url("${p.url}") center/cover`
                    : colorForPreset(p.presetId),
                }}
              />
              <span className="truncate">{p.presetId}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Middle: canvas + toolbar. */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 text-xs">
          <span className="text-zinc-500 uppercase tracking-wide">Layer</span>
          {(["walls", "floors", "ceiling"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              className={cn(
                "px-2 py-1 rounded border",
                layer === l
                  ? "bg-amber-500 text-zinc-950 border-amber-500"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
              )}
              title={`Edit ${l} layer (${l[0]?.toUpperCase()})`}
            >
              {l} ({l[0]?.toUpperCase()})
            </button>
          ))}
          <div className="mx-2 h-4 w-px bg-zinc-800" />
          <span className="text-zinc-500">{width}×{height}</span>
          <div className="mx-2 h-4 w-px bg-zinc-800" />
          <span className="text-zinc-500">
            zoom {(zoom * 100).toFixed(0)}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(6, z * 1.2))}
            className="h-6 px-2"
          >
            +
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(0.25, z / 1.2))}
            className="h-6 px-2"
          >
            −
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const el = wrapRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              setPan({
                x: Math.floor(r.width / 2 - (width * cellSize) / 2),
                y: Math.floor(r.height / 2 - (height * cellSize) / 2),
              });
            }}
            className="h-6 px-2"
          >
            recenter
          </Button>
          <div className="ml-auto text-[10px] text-zinc-500 truncate">
            {scenePath}
          </div>
        </div>

        <div
          ref={wrapRef}
          className="relative flex-1 overflow-hidden bg-zinc-900"
        >
          <canvas
            ref={canvasRef}
            className="block absolute inset-0 cursor-crosshair"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onWheel={onWheel}
            // Right-click is paint-erase; suppress the browser menu.
            onContextMenu={(e) => e.preventDefault()}
          />
          {/* Hover badge — bottom-left, like the in-game minimap label. */}
          {hover ? (
            <div className="absolute bottom-2 left-2 text-[10px] bg-zinc-950/80 border border-zinc-800 rounded px-2 py-1 font-mono">
              ({hover.x}, {hover.y}) ·{" "}
              {presetForCell(scene, layer, hover.x, hover.y) ?? "(empty)"}
            </div>
          ) : null}
        </div>
      </div>

      {/* Right: cell inspector. */}
      <aside className="w-64 shrink-0 border-l border-zinc-800 flex flex-col text-xs">
        <div className="px-3 py-2 border-b border-zinc-800">
          <div className="uppercase tracking-wide text-zinc-400">
            Cell inspector
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {!selected ? (
            <div className="text-zinc-500">
              Left-click a cell to inspect it.
            </div>
          ) : (
            <>
              <div>
                <div className="text-zinc-500">Coords</div>
                <div className="font-mono">
                  ({selected.x}, {selected.y}) · {layer}
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Preset id</div>
                <div className="font-mono break-all">
                  {selectedPresetId ?? "(empty)"}
                </div>
              </div>
              {selectedPreset ? (
                <>
                  <div>
                    <div className="text-zinc-500">Texture</div>
                    <div className="font-mono break-all text-zinc-300">
                      {selectedPreset.data.texture}
                    </div>
                  </div>
                  {selectedPreset.data.partialWall ? (
                    <div>
                      <div className="text-zinc-500">Partial wall</div>
                      <pre className="font-mono text-[10px] text-zinc-300 bg-zinc-900 border border-zinc-800 rounded p-2">
                        {JSON.stringify(
                          selectedPreset.data.partialWall,
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  ) : null}
                  <div>
                    <div className="text-zinc-500">Source</div>
                    <div className="font-mono text-[10px] text-zinc-400 break-all">
                      {selectedPreset.sourcePath}
                    </div>
                  </div>
                  <div className="pt-2 border-t border-zinc-800 space-y-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="w-full"
                      onClick={() => {
                        // Deferred to E4 — see report. Surface the
                        // preset's source file path so a power user can
                        // edit the JSONC in the manifest "Advanced"
                        // textarea for now.
                        alert(
                          `Edit preset is deferred to E4.\n\nFor now, edit ${selectedPreset.sourcePath} via the manifest "Advanced" pane or the asset list.`,
                        );
                      }}
                    >
                      Edit preset (E4)
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="w-full text-zinc-500"
                      disabled
                      title="Break-link / Promote-to-named land in E4"
                    >
                      Break link / Promote (E4)
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-zinc-500">
                  Empty cell. Click a preset on the left, then left-click
                  here to paint it.
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** Shared image cache keyed by object-URL. Lives at module scope so it
 *  survives GridEditor remounts (preset palette + grid draw share the
 *  same Image instances). The URL itself is owned by `useTexturePack`
 *  and revoked on unmount; the Image just goes stale at that point. */
const imageCache = new Map<string, HTMLImageElement>();
