import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PackManifest, PresetResolver, ResolvedPresetData } from "@two_5_d/engine";
import { IdbAssetPack } from "@two_5_d/engine";
import { Button } from "../components/ui";
import { ToggleSwitch } from "../components/ui/index";
import { cn } from "../lib/cn";
import {
  BUILT_IN_COMPONENT_SCHEMAS,
  findComponentSchema,
} from "../lib/componentSchemas";
import {
  ColorPicker,
  ComponentSubform,
  NumberSlider,
  hexToRgb,
  rgbToHex,
} from "../components/ComponentForm";
import { bakeSceneLightmap } from "../lib/lightmapBaker";

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

/** Mutation tool the GridEditor is currently in.  Driven by keyboard
 *  shortcuts (P = paint, E = entity, L = light) plus the toolbar
 *  buttons.  Defaults to `paint` so E3's behaviour is unchanged. */
export type EditorTool = "paint" | "entity" | "light";

/** Authored entity record on a scene.  `scene.entities[]` per
 *  `docs/plans/LIGHTING_ENTITIES_REFACTOR.md` §3.A.  R1 of that plan
 *  hasn't landed in the engine runtime yet — the editor authors the
 *  shape that's already in the spec so the engine catches up cleanly.
 *  Existing engines that don't parse `entities[]` ignore it. */
export interface SceneEntity {
  /** Optional stable name. Used by the inspector + future findByName. */
  name?: string;
  /** Component bag keyed by component name. Each value is the raw
   *  component data (`PositionData`, `LightData`, etc.) untouched. */
  components: Record<string, unknown>;
}

/** Authored static light record (legacy `scene.lights[]`).  Kept as a
 *  separate authoring shorthand even though the engine plans to expand
 *  it into `entities[]` at load time — the bake reads it verbatim. */
export interface SceneLight {
  x: number;
  y: number;
  z?: number;
  color?: [number, number, number];
  intensity?: number;
  radius?: number;
  /** Editor-only marker — when `false`, the light is treated as a
   *  dynamic light (skipped by the bake).  Mirrors the
   *  `LIGHTING_ENTITIES_REFACTOR` plan's `baked` toggle.  We keep it
   *  on the JSON so it round-trips; the bake currently bakes every
   *  `scene.lights[]` entry, so dynamic lights live in `entities[]`
   *  with a `Light` component (no scene.lights row). */
  baked?: boolean;
}

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
  /** Baked (or dynamic) lights authored at scene scope. */
  lights?: SceneLight[];
  /** Scene-declared entities (LIGHTING_ENTITIES_REFACTOR §3.A). */
  entities?: SceneEntity[];
  /** Baked lightmap (set by the bake worker — round-trip only). */
  lightmap?: unknown;
  // Anything else round-trips verbatim.
  [key: string]: unknown;
}

export interface GridEditorProps {
  projectId: string;
  scenePath: string;
  scene: MutableScene;
  /** Called whenever a paint mutation happens; parent dedupes + persists. */
  onSceneChange: (next: MutableScene) => void;
  /** Prefab names available for the entity-placement tool.  When the
   *  list is empty the entity tool's popover surfaces a "No prefabs
   *  registered" hint with instructions on how to register one. */
  prefabNames?: ReadonlyArray<string>;
  /** Optional sprite-id list — drives the Sprite component picker.
   *  Sourced from `manifest.sprites` by the parent. */
  spriteIds?: ReadonlyArray<string>;
  /** Flush any in-memory edits to IDB before the ⚡ Bake button reads
   *  the scene back. The parent owns dirty state + the saveAsset path;
   *  GridEditor only knows about the in-memory `scene` prop, so we
   *  defer the pre-bake persist to it. Returning a rejected promise
   *  aborts the bake. */
  onPersistScene?: () => Promise<void>;
  /** Notify the parent that the on-disk scene was rewritten externally
   *  (i.e. the bake just landed). The parent typically re-loads the
   *  scene from IDB and posts a `{type:"scene-changed"}` message to
   *  the engine iframe so the runtime picks up the new lightmap. */
  onSceneSavedExternally?: (path: string) => void;
  /**
   * Show anonymous tile presets (id starts with `_`) in the left-aside
   * palette. Default `false` — anon presets are per-cell variants and
   * tend to clutter the palette. MapView owns the persisted state
   * (`useLocalStorage("editor.palette.showAnonymous")`) and renders a
   * small toggle above the palette list via the props threaded through
   * EditorViewport.
   *
   * NOTE: this only gates *palette visibility* — anon presets stay
   * fully editable via the cell context menu's "Edit parent preset"
   * action and the Cell Inspector's "Edit preset" button (#198).
   */
  showAnonymousPresets?: boolean;
  onShowAnonymousPresetsChange?: (next: boolean) => void;
}

/** Reasonable default-pack prefabs surfaced when the editor hasn't
 *  managed to introspect pack scripts (no sandboxed script-run yet —
 *  see EDITOR.md E5 follow-ups).  These are pulled from the
 *  `packages/default-pack/scripts/` registerPrefab calls. */
const FALLBACK_BUILTIN_PREFABS: ReadonlyArray<string> = [
  "player",
  "marker",
];

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

/* --- Entity + light scene helpers --------------------------------------- */

/** Append a new entity to `scene.entities[]`, returning a fresh scene. */
function addEntityToScene(
  scene: MutableScene,
  entity: SceneEntity,
): MutableScene {
  const entities = [...(scene.entities ?? []), entity];
  return { ...scene, entities };
}

/** Replace `scene.entities[index]` with `entity`, returning a fresh scene. */
function replaceEntity(
  scene: MutableScene,
  index: number,
  entity: SceneEntity,
): MutableScene {
  const entities = [...(scene.entities ?? [])];
  if (index < 0 || index >= entities.length) return scene;
  entities[index] = entity;
  return { ...scene, entities };
}

/** Remove `scene.entities[index]`, returning a fresh scene. */
function removeEntity(scene: MutableScene, index: number): MutableScene {
  const entities = [...(scene.entities ?? [])];
  if (index < 0 || index >= entities.length) return scene;
  entities.splice(index, 1);
  return { ...scene, entities };
}

/** Append a new light to `scene.lights[]`, returning a fresh scene. */
function addLightToScene(scene: MutableScene, light: SceneLight): MutableScene {
  const lights = [...(scene.lights ?? []), light];
  return { ...scene, lights };
}

/** Replace `scene.lights[index]` with `light`, returning a fresh scene. */
function replaceLight(
  scene: MutableScene,
  index: number,
  light: SceneLight,
): MutableScene {
  const lights = [...(scene.lights ?? [])];
  if (index < 0 || index >= lights.length) return scene;
  lights[index] = light;
  return { ...scene, lights };
}

/** Remove `scene.lights[index]`, returning a fresh scene. */
function removeLight(scene: MutableScene, index: number): MutableScene {
  const lights = [...(scene.lights ?? [])];
  if (index < 0 || index >= lights.length) return scene;
  lights.splice(index, 1);
  return { ...scene, lights };
}

/** Pull `Position` out of an entity's component bag — used for both the
 *  on-canvas glyph and the cell-snap on placement. */
function getEntityPosition(
  entity: SceneEntity,
): { x: number; y: number; z?: number } | null {
  const pos = entity.components.Position as
    | { x?: number; y?: number; z?: number }
    | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") {
    return null;
  }
  return { x: pos.x, y: pos.y, z: pos.z };
}

/** Mutate an entity's Position component to `(x, y[, z])`. */
function setEntityPosition(
  entity: SceneEntity,
  x: number,
  y: number,
  z?: number,
): SceneEntity {
  const existing = (entity.components.Position ?? {}) as Record<
    string,
    unknown
  >;
  const next: Record<string, unknown> = { ...existing, x, y };
  if (z !== undefined) next.z = z;
  return {
    ...entity,
    components: { ...entity.components, Position: next },
  };
}

interface TexturePreviewBundle {
  presetId: string;
  data: ResolvedPresetData;
  /** Object URL for the preset's primary texture; null if not loaded yet. */
  url: string | null;
  /** "anonymous" for ids starting with `_` (per-cell variants), "named"
   *  otherwise. Drives the italic styling + the count of hidden
   *  anonymous entries surfaced next to the "Show anonymous" toggle. */
  kind: "named" | "anonymous";
}

/** Texture loader for the preset palette + cell renderer. Resolves
 *  the manifest preset → texture path → IDB blob → object URL. Caches
 *  by texture path so the same URL is shared across all consumers. */
function useTexturePack(projectId: string, manifest: PackManifest) {
  const cacheRef = useRef<Map<string, string>>(new Map());
  const inflightRef = useRef<Map<string, Promise<string>>>(new Map());
  const packRef = useRef<IdbAssetPack | null>(null);
  const [, force] = useState(0);

  // Build the pack once; the inner manifest reference may change but
  // the project id won't, so the pack object is stable.
  useEffect(() => {
    let alive = true;
    IdbAssetPack.fromProject(projectId).then((pack) => {
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
  pack: IdbAssetPack | null,
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

/**
 * Inspector-pane selection state.  The cell selection from E3 is still
 * the default; entity / light selections come from clicking glyphs in
 * the canvas or rows in the entities list (TODO E5 — see report).
 */
type InspectorSelection =
  | { kind: "cell"; x: number; y: number }
  | { kind: "entity"; index: number }
  | { kind: "light"; index: number }
  | null;

export function GridEditor({
  projectId,
  scenePath,
  scene,
  onSceneChange,
  prefabNames,
  spriteIds,
  onPersistScene,
  onSceneSavedExternally,
  showAnonymousPresets = false,
  onShowAnonymousPresetsChange,
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
  /** Selection-aware inspector slot — supersedes the bare `selected`
   *  cell state when an entity or light is picked.  We keep `selected`
   *  in sync (cell coords of the entity / light) so the canvas
   *  highlight ring still shows the right square. */
  const [inspector, setInspector] = useState<InspectorSelection>(null);
  const [layer, setLayer] = useState<LayerName>("walls");
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [presetFilter, setPresetFilter] = useState("");
  /** Active tool — paint / entity / light.  Driven by keyboard
   *  shortcuts (P / E / L) and the toolbar buttons. */
  const [tool, setTool] = useState<EditorTool>("paint");
  /** Prefab-picker popover state — opens on entity-tool click. */
  const [prefabPopover, setPrefabPopover] = useState<{
    x: number;
    y: number;
    cell: { x: number; y: number };
  } | null>(null);
  /** ⚡ Bake-lightmap button state. `idle` is the default; `running`
   *  disables the button + shows a progress string; `done` shows the
   *  last completion blurb until the user mutates the scene again
   *  (any onSceneChange flips us back to `idle`). */
  const [bakeStatus, setBakeStatus] = useState<
    | { kind: "idle" }
    | { kind: "running"; message: string }
    | { kind: "done"; message: string }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const handleBake = useCallback(async () => {
    setBakeStatus({ kind: "running", message: "Starting bake…" });
    try {
      // Flush pending edits to IDB so the worker reads the latest scene.
      if (onPersistScene) {
        await onPersistScene();
      }
      const result = await bakeSceneLightmap(
        projectId,
        scenePath,
        (status) => setBakeStatus({ kind: "running", message: status }),
      );
      setBakeStatus({
        kind: "done",
        message: `Baked · ${result.stats.lights} light(s) · ${result.stats.ms.toFixed(0)} ms`,
      });
      // Notify the parent so it can re-load the now-lightmap-bearing
      // scene + tell the engine iframe to reloadScene. The bake
      // mutated only the `lightmap` field, but the parent's in-memory
      // copy is stale — easiest is to let it re-read from IDB.
      onSceneSavedExternally?.(scenePath);
    } catch (err) {
      setBakeStatus({
        kind: "error",
        message: (err as Error)?.message ?? String(err),
      });
    }
  }, [projectId, scenePath, onPersistScene, onSceneSavedExternally]);

  // Whenever the in-memory scene mutates after a successful bake, drop
  // back to idle so the toolbar doesn't keep claiming "Baked". Errors
  // stick until the user clicks the button again or dismisses.
  useEffect(() => {
    if (bakeStatus.kind === "done") setBakeStatus({ kind: "idle" });
    // intentionally omit bakeStatus from deps so the effect ONLY fires
    // when the scene object identity changes (i.e. a paint mutation).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // Resolve prefab list — caller-supplied names win; otherwise fall
  // back to a small built-in list so the editor's entity tool is
  // usable against default-pack.  See EDITOR.md §6.3 — full
  // script-introspected discovery is an E5 follow-up.
  const resolvedPrefabs = useMemo(() => {
    const set = new Set<string>(prefabNames ?? []);
    for (const p of FALLBACK_BUILTIN_PREFABS) set.add(p);
    return Array.from(set).sort();
  }, [prefabNames]);

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

  // Center the viewport on the scene every time the scene changes
  // (path, or dimensions if scenes were edited externally). The user
  // can pan with middle-button drag (or space+drag) thereafter — the
  // dependency list intentionally excludes cellSize so user zoom is
  // preserved across re-centers.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPan({
      x: Math.floor(r.width / 2 - (width * cellSize) / 2),
      y: Math.floor(r.height / 2 - (height * cellSize) / 2),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenePath, width, height]);

  // Preset palette — sorted, exposes a swatch + texture-url-or-null.
  // We materialise the FULL list here (named + anonymous) so the
  // header's "+N hidden" counter has something to count against; the
  // user-visible `presetList` filters anonymous out at the next step
  // unless the toggle is on.
  const allPresets = useMemo<TexturePreviewBundle[]>(() => {
    if (!resolver) return [];
    const out: TexturePreviewBundle[] = [];
    for (const preset of resolver) {
      // Skip __legacy.* aliases from the picker — they're a back-compat
      // shim, not authoring vocabulary (per TILE_PRESETS.md §5.3).
      if (preset.id.startsWith("__legacy.")) continue;
      const kind: "named" | "anonymous" = preset.id.startsWith("_")
        ? "anonymous"
        : "named";
      out.push({
        presetId: preset.id,
        data: preset.data,
        url: loadTexture(preset.data.texture),
        kind,
      });
    }
    // Named presets first, then anonymous; within each bucket alphabetical.
    out.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "named" ? -1 : 1;
      return a.presetId.localeCompare(b.presetId);
    });
    return out;
  }, [resolver, loadTexture]);

  // Count of anonymous presets currently being suppressed by the
  // toggle. Drives the "+N hidden" hint in the palette header so the
  // user knows what they'd reveal by flipping the switch.
  const hiddenAnonCount = useMemo(() => {
    if (showAnonymousPresets) return 0;
    let n = 0;
    for (const p of allPresets) if (p.kind === "anonymous") n++;
    return n;
  }, [allPresets, showAnonymousPresets]);

  // Palette list as the user sees it — anonymous entries excluded
  // unless the toggle is on. Kept as `presetList` so the rest of the
  // GridEditor body (default-active-preset effect, search filter, etc.)
  // doesn't need to know about the toggle.
  const presetList = useMemo<TexturePreviewBundle[]>(() => {
    if (showAnonymousPresets) return allPresets;
    return allPresets.filter((p) => p.kind !== "anonymous");
  }, [allPresets, showAnonymousPresets]);

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

      // ── Light tool — drop a new light at the clicked cell.
      // Left-click adds at default values; right-click on an existing
      // light removes it.
      if (tool === "light") {
        if (e.button === 0) {
          const lights = scene.lights ?? [];
          // Was an existing light clicked? Snap to its index so the
          // inspector edits it instead of stacking another one.
          const hitIdx = lights.findIndex(
            (l) => Math.floor(l.x) === cell.x && Math.floor(l.y) === cell.y,
          );
          if (hitIdx >= 0) {
            setSelected(cell);
            setInspector({ kind: "light", index: hitIdx });
            return;
          }
          const newLight: SceneLight = {
            x: cell.x + 0.5,
            y: cell.y + 0.5,
            z: 0.5,
            color: [1, 1, 1],
            intensity: 1,
            radius: 5,
            baked: true,
          };
          const next = addLightToScene(scene, newLight);
          onSceneChange(next);
          setSelected(cell);
          setInspector({
            kind: "light",
            index: (next.lights?.length ?? 1) - 1,
          });
          return;
        }
        if (e.button === 2) {
          e.preventDefault();
          const lights = scene.lights ?? [];
          const hitIdx = lights.findIndex(
            (l) => Math.floor(l.x) === cell.x && Math.floor(l.y) === cell.y,
          );
          if (hitIdx >= 0) {
            onSceneChange(removeLight(scene, hitIdx));
            setInspector(null);
          }
          return;
        }
        return;
      }

      // ── Entity tool — left-click opens the prefab picker popover.
      // Right-click on an existing entity removes it.
      if (tool === "entity") {
        if (e.button === 0) {
          // Snap to an existing entity if the user clicked one (lets
          // them re-open the inspector without removing).
          const entities = scene.entities ?? [];
          const hitIdx = entities.findIndex((ent) => {
            const p = getEntityPosition(ent);
            return p && Math.floor(p.x) === cell.x && Math.floor(p.y) === cell.y;
          });
          if (hitIdx >= 0) {
            setSelected(cell);
            setInspector({ kind: "entity", index: hitIdx });
            return;
          }
          // Otherwise open the prefab picker — placement happens via
          // the popover's click handler.
          setPrefabPopover({ x: e.clientX, y: e.clientY, cell });
          return;
        }
        if (e.button === 2) {
          e.preventDefault();
          const entities = scene.entities ?? [];
          const hitIdx = entities.findIndex((ent) => {
            const p = getEntityPosition(ent);
            return p && Math.floor(p.x) === cell.x && Math.floor(p.y) === cell.y;
          });
          if (hitIdx >= 0) {
            onSceneChange(removeEntity(scene, hitIdx));
            setInspector(null);
          }
          return;
        }
        return;
      }

      // ── Paint tool (E3 default).
      if (e.button === 0) {
        dragRef.current = { button: 0, last: `${cell.x},${cell.y}` };
        setSelected(cell);
        setInspector({ kind: "cell", x: cell.x, y: cell.y });
        paintCell(cell.x, cell.y, "paint");
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      } else if (e.button === 2) {
        dragRef.current = { button: 2, last: `${cell.x},${cell.y}` };
        paintCell(cell.x, cell.y, "erase");
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        e.preventDefault();
      }
    },
    [pan, screenToCell, paintCell, tool, scene, onSceneChange],
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
      else if (e.key === "p" || e.key === "P") setTool("paint");
      else if (e.key === "e" || e.key === "E") setTool("entity");
      else if (e.key === "l" || e.key === "L") setTool("light");
      else if (e.key === "Escape") {
        setPrefabPopover(null);
        setInspector(null);
      } else if (e.key === "+" || e.key === "=")
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

      // ── Light glyphs.  Baked lights get a yellow filled circle;
      // dynamic lights (baked: false) get a hollow white ring.
      const lights = scene.lights ?? [];
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i]!;
        const px = pan.x + L.x * cellSize;
        const py = pan.y + L.y * cellSize;
        const r = Math.max(3, cellSize * 0.22);
        const baked = L.baked !== false;
        if (baked) {
          ctx.fillStyle = "#fde047"; // amber-300
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
        } else {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        // Radius hint while selected.
        if (
          inspector &&
          inspector.kind === "light" &&
          inspector.index === i &&
          L.radius
        ) {
          ctx.strokeStyle = "rgba(253, 224, 71, 0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, L.radius * cellSize, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ── Entity glyphs.  A small square + first-letter label.  Any
      // entity with a Position component shows up.
      const entitiesArr = scene.entities ?? [];
      for (let i = 0; i < entitiesArr.length; i++) {
        const ent = entitiesArr[i]!;
        const pos = getEntityPosition(ent);
        if (!pos) continue;
        const px = pan.x + pos.x * cellSize;
        const py = pan.y + pos.y * cellSize;
        const r = Math.max(4, cellSize * 0.25);
        ctx.fillStyle = "#06b6d4"; // cyan-500
        ctx.fillRect(px - r, py - r, r * 2, r * 2);
        ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px - r, py - r, r * 2, r * 2);
        // Label — first letter of name OR first letter of first component.
        const label =
          ent.name?.[0] ??
          Object.keys(ent.components)[0]?.[0] ??
          "?";
        if (cellSize >= 14) {
          ctx.fillStyle = "#0c0a09";
          ctx.font = `${Math.max(8, Math.floor(cellSize * 0.4))}px monospace`;
          ctx.textBaseline = "middle";
          ctx.textAlign = "center";
          ctx.fillText(label.toUpperCase(), px, py);
        }
        if (
          inspector &&
          inspector.kind === "entity" &&
          inspector.index === i
        ) {
          ctx.strokeStyle = "#f59e0b"; // amber-500
          ctx.lineWidth = 2;
          ctx.strokeRect(px - r - 2, py - r - 2, (r + 2) * 2, (r + 2) * 2);
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
  }, [scene, layer, pan, cellSize, hover, selected, resolver, size, inspector]);

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
        {/* Anon-preset visibility row — sits between the filter input
            and the scrolling palette list. Anonymous presets (id
            starts with `_`) are per-cell variants; the toggle defaults
            OFF so the palette stays focused on the authored vocab.
            The "+N hidden" hint surfaces only when the toggle is off
            AND there's actually something to reveal. */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-zinc-800">
          <ToggleSwitch
            size="sm"
            checked={showAnonymousPresets}
            onChange={(next) => onShowAnonymousPresetsChange?.(next)}
            aria-label="Show anonymous presets"
            disabled={!onShowAnonymousPresetsChange}
          />
          <span className="text-[11px] text-zinc-400 truncate">
            Show anonymous
          </span>
          {!showAnonymousPresets && hiddenAnonCount > 0 ? (
            <span className="text-[11px] text-zinc-500 ml-auto shrink-0">
              +{hiddenAnonCount} hidden
            </span>
          ) : null}
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
          <span className="text-zinc-500 uppercase tracking-wide">Tool</span>
          {(
            [
              { id: "paint" as const, label: "Paint (P)", hint: "Paint tiles" },
              { id: "entity" as const, label: "Entity (E)", hint: "Place entities" },
              { id: "light" as const, label: "Light (L)", hint: "Place lights" },
            ]
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              className={cn(
                "px-2 py-1 rounded border",
                tool === t.id
                  ? "bg-amber-500 text-zinc-950 border-amber-500"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800",
              )}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
          <div className="mx-2 h-4 w-px bg-zinc-800" />
          <span className="text-zinc-500 uppercase tracking-wide">Layer</span>
          {(["walls", "floors", "ceiling"] as const).map((l) => (
            <button
              key={l}
              onClick={() => setLayer(l)}
              disabled={tool !== "paint"}
              className={cn(
                "px-2 py-1 rounded border",
                tool !== "paint" && "opacity-50 cursor-not-allowed",
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
          <button
            onClick={handleBake}
            disabled={bakeStatus.kind === "running"}
            className={cn(
              "px-2 py-1 rounded border text-xs",
              bakeStatus.kind === "running" &&
                "opacity-60 cursor-wait border-amber-500 text-amber-300",
              bakeStatus.kind === "done" &&
                "border-emerald-500 text-emerald-300 hover:bg-zinc-800",
              bakeStatus.kind === "error" &&
                "border-red-500 text-red-300 hover:bg-zinc-800",
              bakeStatus.kind === "idle" &&
                "border-zinc-700 text-zinc-200 hover:bg-zinc-800",
            )}
            title={
              bakeStatus.kind === "error"
                ? bakeStatus.message
                : "Bake the scene's lights into a static lightmap (Web Worker)"
            }
          >
            {bakeStatus.kind === "running"
              ? bakeStatus.message
              : bakeStatus.kind === "done"
                ? bakeStatus.message
                : bakeStatus.kind === "error"
                  ? "⚡ Bake failed (retry)"
                  : "⚡ Bake lighting"}
          </button>
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
            className={cn(
              "block absolute inset-0",
              tool === "paint" && "cursor-crosshair",
              tool === "entity" && "cursor-cell",
              tool === "light" && "cursor-pointer",
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onWheel={onWheel}
            // Right-click is paint-erase / entity-remove; suppress menu.
            onContextMenu={(e) => e.preventDefault()}
          />
          {/* Hover badge — bottom-left, like the in-game minimap label. */}
          {hover ? (
            <div className="absolute bottom-2 left-2 text-[10px] bg-zinc-950/80 border border-zinc-800 rounded px-2 py-1 font-mono">
              ({hover.x}, {hover.y}) ·{" "}
              {tool === "paint"
                ? (presetForCell(scene, layer, hover.x, hover.y) ?? "(empty)")
                : tool === "entity"
                  ? "click to place entity"
                  : "click to place light"}
            </div>
          ) : null}
          {/* Prefab picker popover.  Anchored to the click coords; closes
              on Escape or backdrop click.  Selecting a prefab spawns an
              entity at the popover's cell + closes the popover. */}
          {prefabPopover ? (
            <PrefabPickerPopover
              x={prefabPopover.x}
              y={prefabPopover.y}
              prefabs={resolvedPrefabs}
              onClose={() => setPrefabPopover(null)}
              onPick={(name) => {
                const cell = prefabPopover.cell;
                const entity: SceneEntity = {
                  name: `${name}_${(scene.entities?.length ?? 0) + 1}`,
                  components: {
                    Position: { x: cell.x + 0.5, y: cell.y + 0.5, z: 0 },
                  },
                };
                // Stamp a prefab marker via a free-form `prefab` field
                // so the engine + smoke tests can spot the source.
                // `SceneEntity` doesn't declare a string index signature,
                // so TS requires the double-cast through `unknown`.
                (entity as unknown as Record<string, unknown>).prefab = name;
                const next = addEntityToScene(scene, entity);
                onSceneChange(next);
                setSelected(cell);
                setInspector({
                  kind: "entity",
                  index: (next.entities?.length ?? 1) - 1,
                });
                setPrefabPopover(null);
              }}
            />
          ) : null}
        </div>
      </div>

      {/* Right: inspector — switches form on selection kind. */}
      <aside className="w-72 shrink-0 border-l border-zinc-800 flex flex-col text-xs">
        <div className="px-3 py-2 border-b border-zinc-800">
          <div className="uppercase tracking-wide text-zinc-400">
            {inspector?.kind === "entity"
              ? "Entity inspector"
              : inspector?.kind === "light"
                ? "Light inspector"
                : "Cell inspector"}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {inspector?.kind === "light" ? (
            <LightInspector
              index={inspector.index}
              scene={scene}
              onSceneChange={onSceneChange}
              onClose={() => setInspector(null)}
            />
          ) : inspector?.kind === "entity" ? (
            <EntityInspector
              index={inspector.index}
              scene={scene}
              spriteIds={spriteIds}
              onSceneChange={onSceneChange}
              onClose={() => setInspector(null)}
            />
          ) : !selected ? (
            <div className="text-zinc-500">
              Left-click a cell to inspect it.
              <div className="mt-2 text-zinc-600">
                P = paint · E = entity · L = light
              </div>
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

/* --- Inspector sub-components ----------------------------------------- */

// `ColorPicker`, `NumberSlider`, `ComponentSubform`, `ComponentField`,
// and `JsonComponentEditor` live in `apps/editor/src/components/ComponentForm.tsx`
// (extracted so EntitiesEditor shares the same widgets — EDITOR.md §6.3).
// Re-import them at the top of this file.

function LightInspector({
  index,
  scene,
  onSceneChange,
  onClose,
}: {
  index: number;
  scene: MutableScene;
  onSceneChange: (next: MutableScene) => void;
  onClose: () => void;
}) {
  const light = scene.lights?.[index];
  if (!light) {
    return <div className="text-zinc-500">Light not found.</div>;
  }
  const patch = (p: Partial<SceneLight>): void => {
    onSceneChange(replaceLight(scene, index, { ...light, ...p }));
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-zinc-500">Light #{index}</div>
        <button
          onClick={onClose}
          className="text-[10px] text-zinc-400 hover:text-amber-300"
          title="Close inspector (Escape)"
        >
          ✕
        </button>
      </div>
      <div>
        <div className="text-zinc-500 mb-1">Position</div>
        <div className="grid grid-cols-2 gap-2">
          <NumberSlider
            value={light.x}
            onChange={(n) => patch({ x: n })}
            step={0.5}
          />
          <NumberSlider
            value={light.y}
            onChange={(n) => patch({ y: n })}
            step={0.5}
          />
        </div>
      </div>
      <div>
        <div className="text-zinc-500 mb-1">Color (RGB)</div>
        <ColorPicker
          value={light.color ?? [1, 1, 1]}
          onChange={(rgb) => patch({ color: rgb })}
        />
      </div>
      <div>
        <div className="text-zinc-500 mb-1">
          Intensity ({(light.intensity ?? 1).toFixed(2)})
        </div>
        <NumberSlider
          value={light.intensity ?? 1}
          onChange={(n) => patch({ intensity: n })}
          min={0}
          max={10}
          step={0.1}
        />
      </div>
      <div>
        <div className="text-zinc-500 mb-1">
          Radius ({(light.radius ?? 5).toFixed(1)})
        </div>
        <NumberSlider
          value={light.radius ?? 5}
          onChange={(n) => patch({ radius: n })}
          min={0}
          max={20}
          step={0.5}
        />
      </div>
      <div>
        <div className="text-zinc-500 mb-1">
          Z height ({(light.z ?? 0.5).toFixed(2)})
        </div>
        <NumberSlider
          value={light.z ?? 0.5}
          onChange={(n) => patch({ z: n })}
          min={0}
          max={2}
          step={0.05}
        />
      </div>
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={light.baked !== false}
            onChange={(e) => patch({ baked: e.target.checked })}
          />
          <span className="text-zinc-300">
            Baked{" "}
            <span className="text-zinc-500">
              (uncheck for dynamic — skipped by the bake)
            </span>
          </span>
        </label>
      </div>
      <div className="pt-2 border-t border-zinc-800">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => {
            onSceneChange(removeLight(scene, index));
            onClose();
          }}
        >
          Remove light
        </Button>
      </div>
    </div>
  );
}

function EntityInspector({
  index,
  scene,
  spriteIds,
  onSceneChange,
  onClose,
}: {
  index: number;
  scene: MutableScene;
  spriteIds?: ReadonlyArray<string>;
  onSceneChange: (next: MutableScene) => void;
  onClose: () => void;
}) {
  const entity = scene.entities?.[index];
  if (!entity) {
    return <div className="text-zinc-500">Entity not found.</div>;
  }
  const componentNames = Object.keys(entity.components);
  const availableToAdd = BUILT_IN_COMPONENT_SCHEMAS.map((s) => s.name).filter(
    (n) => !componentNames.includes(n),
  );

  const patchComponent = (
    name: string,
    next: Record<string, unknown>,
  ): void => {
    onSceneChange(
      replaceEntity(scene, index, {
        ...entity,
        components: { ...entity.components, [name]: next },
      }),
    );
  };
  const removeComponent = (name: string): void => {
    const copy = { ...entity.components };
    delete copy[name];
    onSceneChange(
      replaceEntity(scene, index, { ...entity, components: copy }),
    );
  };
  const addComponent = (name: string): void => {
    const schema = findComponentSchema(name);
    const data = schema ? { ...schema.defaultData } : {};
    patchComponent(name, data);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-zinc-500">Entity #{index}</div>
        <button
          onClick={onClose}
          className="text-[10px] text-zinc-400 hover:text-amber-300"
          title="Close inspector (Escape)"
        >
          ✕
        </button>
      </div>
      <div>
        <div className="text-zinc-500 mb-1">Name</div>
        <input
          value={entity.name ?? ""}
          onChange={(e) => {
            const trimmed = e.target.value;
            onSceneChange(
              replaceEntity(scene, index, {
                ...entity,
                name: trimmed.length === 0 ? undefined : trimmed,
              }),
            );
          }}
          placeholder="(unnamed)"
          className="w-full h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-mono"
        />
      </div>
      {typeof (entity as unknown as Record<string, unknown>).prefab ===
      "string" ? (
        <div>
          <div className="text-zinc-500">Prefab</div>
          <div className="font-mono">
            {(entity as unknown as Record<string, unknown>).prefab as string}
          </div>
        </div>
      ) : null}
      {componentNames.map((name) => (
        <ComponentSubform
          key={name}
          name={name}
          data={entity.components[name] as Record<string, unknown>}
          spriteIds={spriteIds}
          onPatch={(next) => patchComponent(name, next)}
          onRemove={() => removeComponent(name)}
        />
      ))}
      {availableToAdd.length > 0 ? (
        <div className="pt-2 border-t border-zinc-800">
          <div className="text-zinc-500 mb-1">Add component</div>
          <select
            onChange={(e) => {
              const v = e.target.value;
              if (v) {
                addComponent(v);
                e.target.value = "";
              }
            }}
            className="w-full h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px]"
            defaultValue=""
          >
            <option value="" disabled>
              + add component…
            </option>
            {availableToAdd.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <div className="pt-2 border-t border-zinc-800">
        <Button
          variant="danger"
          size="sm"
          className="w-full"
          onClick={() => {
            onSceneChange(removeEntity(scene, index));
            onClose();
          }}
        >
          Remove entity
        </Button>
      </div>
    </div>
  );
}

/** Floating popover anchored at (x, y).  Lists prefabs; click selects. */
function PrefabPickerPopover({
  x,
  y,
  prefabs,
  onClose,
  onPick,
}: {
  x: number;
  y: number;
  prefabs: ReadonlyArray<string>;
  onClose: () => void;
  onPick: (name: string) => void;
}) {
  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-56 rounded border border-zinc-700 bg-zinc-900 shadow-xl text-xs"
        style={{ left: x + 8, top: y + 8 }}
      >
        <div className="px-3 py-2 border-b border-zinc-800 text-zinc-400 uppercase tracking-wide">
          Place prefab
        </div>
        <div className="max-h-64 overflow-auto py-1">
          {prefabs.length === 0 ? (
            <div className="px-3 py-2 text-zinc-500">
              No prefabs registered.
              <div className="mt-1 text-[10px] text-zinc-600">
                Pack scripts must call <code>api.registerPrefab</code>.
              </div>
            </div>
          ) : (
            prefabs.map((name) => (
              <button
                key={name}
                className="w-full text-left px-3 py-1.5 hover:bg-zinc-800 text-zinc-200"
                onClick={() => onPick(name)}
              >
                {name}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}

/** Shared image cache keyed by object-URL. Lives at module scope so it
 *  survives GridEditor remounts (preset palette + grid draw share the
 *  same Image instances). The URL itself is owned by `useTexturePack`
 *  and revoked on unmount; the Image just goes stale at that point. */
const imageCache = new Map<string, HTMLImageElement>();
