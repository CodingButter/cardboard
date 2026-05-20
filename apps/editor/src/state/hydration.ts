import { normaliseGridField, type GridField } from "@two_5_d/engine";
import { EditorProjectStore } from "../lib/EditorProjectStore";
import { useSceneStore, type SceneCell } from "./useSceneStore";
import { useLayerStore } from "./useLayerStore";
import { useTilePresetStore } from "./useTilePresetStore";

/**
 * hydrateStoresFromIdb — bridge the IDB → Zustand gap that Wave 3.3
 * forgot to wire.
 *
 * Pack-import (`importPack.ts`) writes the pack contents to IDB via
 * `EditorProjectStore.saveAsset`. Wave 3.3 migrated 14 panels off
 * `MOCK_*` fixtures onto `useSceneStore` / `useLayerStore` /
 * `useTilePresetStore` — but nothing populates those stores from IDB
 * when a project opens. Result: MapCanvas, LayersPanel, TilePresetPanel,
 * SceneSettingsPanel, MinimapPanel and PreviewPanel render empty after
 * `importPack`.
 *
 * This helper closes the loop on the READ side only:
 *
 *   1. Load the project's manifest from IDB.
 *   2. Resolve the active scene path — explicit `cardboard_editor_active_scene_<id>`
 *      LS value wins, else `manifest.startScene`.
 *   3. Parse the scene's `walls` / `floors` / `ceilings` grids (RLE or
 *      nested) and project them into the sparse `useSceneStore.cells`
 *      map keyed by `"x,y"`, with `layers[<layerId>] = "tile:<tileId>"`.
 *   4. Push `dims` from the grid extent.
 *   5. Push a default layer set that includes the engine's three grid
 *      layers (`walls`, `floors`, `ceilings`) so the panel chip strip
 *      and the MapCanvas iteration both see them.
 *
 * WRITE-BACK is out of scope here. Once the user paints a cell, the
 * `useSceneStore` mutation lands in LS via the persist middleware but
 * is NOT written back to IDB — that's the bigger D4-class fix the
 * caller will tackle next. Cross-window edit sync still works via the
 * `storage` event because `useSceneStore` is built on `createSyncedStore`.
 *
 * This helper deliberately does NOT touch `importPack.ts` or any panel
 * file — both are working as designed; the gap was always the missing
 * READ-side hook.
 */

const ACTIVE_SCENE_KEY_PREFIX = "cardboard_editor_active_scene_";

/** Engine grid layer keys we hydrate into `useSceneStore.cells`. */
const GRID_LAYERS = ["walls", "floors", "ceilings"] as const;
type GridLayerId = (typeof GRID_LAYERS)[number];

/** Layer-store snapshot we install on hydrate. Keeps the panel chips
 *  visible for the three engine grids plus the legacy `doors`/`sprites`/
 *  `lights` placeholders the design comp expects. */
const DEFAULT_LAYER_ORDER = [
  "floors",
  "walls",
  "ceilings",
  "doors",
  "sprites",
  "lights",
] as const;

const DEFAULT_LAYER_VISIBILITY: Record<string, boolean> = {
  floors: true,
  walls: true,
  ceilings: true,
  doors: true,
  sprites: true,
  lights: false,
};

/** Type guard for the nested-grid form returned by `normaliseGridField`. */
function isFiniteCell(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v !== 0;
}

/**
 * Read the per-project active scene path persisted by
 * `<ActiveSceneProvider/>` (key `cardboard_editor_active_scene_<id>`).
 * Falls back to the manifest's `startScene` field.
 */
function resolveActiveScenePath(
  projectId: string,
  manifestStartScene: string | null | undefined,
): string | null {
  try {
    const pinned = localStorage.getItem(ACTIVE_SCENE_KEY_PREFIX + projectId);
    if (pinned && pinned.trim()) return pinned;
  } catch {
    // ignore — LS unavailable (private mode etc.)
  }
  return manifestStartScene ?? null;
}

/**
 * Convert an engine-shape scene's grid layers into the editor's sparse
 * `cells` map. Each non-zero cell on a grid becomes a `layers[<layer>]`
 * entry with a synthetic preset id `tile:<tileId>`.
 *
 * Anonymous synthetic preset ids are fine for Wave 3.3 — MapCanvasPanel
 * paints by LAYER color, not by preset content; SceneSettings/Layers/
 * TilePreset panels read only their own slices. A future pass can
 * reconcile these synthetic ids with `manifest.tilePresets` lookups.
 */
function projectGridsIntoCells(scene: Record<string, unknown>): {
  cells: Record<string, SceneCell>;
  dims: { w: number; h: number };
} {
  const cells: Record<string, SceneCell> = {};
  let width = 0;
  let height = 0;

  for (const layerId of GRID_LAYERS) {
    const raw = scene[layerId] as GridField<unknown> | undefined;
    if (raw === undefined) continue;
    const grid = normaliseGridField(raw);
    if (!grid) continue;
    if (grid.length > height) height = grid.length;
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y]!;
      if (row.length > width) width = row.length;
      for (let x = 0; x < row.length; x++) {
        const v = row[x];
        // Cells can be bare ints OR `{ tile, ... }` structured specs.
        let tileId: number | null = null;
        if (typeof v === "number") {
          tileId = v;
        } else if (v && typeof v === "object" && "tile" in v) {
          const t = (v as { tile: unknown }).tile;
          if (typeof t === "number") tileId = t;
          else if (typeof t === "string") {
            // Underscore form like "2_050_030" — first segment is the tile id.
            const head = t.split("_", 1)[0];
            const n = Number(head);
            if (Number.isFinite(n)) tileId = n;
          }
        }
        if (!isFiniteCell(tileId)) continue;
        const key = `${x},${y}`;
        const existing = cells[key];
        if (existing) {
          existing.layers[layerId] = `tile:${tileId}`;
        } else {
          cells[key] = {
            layers: { [layerId as GridLayerId]: `tile:${tileId}` },
            height: 0,
            tags: [],
            properties: {},
          };
        }
      }
    }
  }
  return { cells, dims: { w: width, h: height } };
}

/**
 * Hydrate the wave-3 Zustand stores from the project's IDB rows. Safe
 * to call multiple times — each call REPLACES the relevant slices.
 *
 * Failure modes:
 *   - No manifest → push empty cells + default 64×64 dims + default layers.
 *   - Scene asset missing → same as no manifest (panels render the
 *     "no painted cells" state rather than throwing).
 *   - Malformed scene JSON → caught; logged via console; empty hydration.
 */
export async function hydrateStoresFromIdb(projectId: string): Promise<void> {
  // 1) Manifest. Drives `startScene` resolution.
  const manifest = await EditorProjectStore.loadManifest(projectId);
  const scenePath = resolveActiveScenePath(projectId, manifest?.startScene);

  // 2) Scene JSON. Tolerate every kind of "no scene yet" state — a
  //    fresh project with no scenes assets shouldn't crash hydrate.
  let sceneRaw: string | null = null;
  if (scenePath) {
    const body = await EditorProjectStore.loadAsset(projectId, scenePath);
    if (typeof body === "string") sceneRaw = body;
  }

  let cells: Record<string, SceneCell> = {};
  let dims = { w: 64, h: 64 };
  let sceneName = "level-01";

  if (sceneRaw) {
    try {
      const parsed = JSON.parse(sceneRaw) as Record<string, unknown>;
      const projected = projectGridsIntoCells(parsed);
      cells = projected.cells;
      if (projected.dims.w > 0) dims = projected.dims;
      // Scenes sometimes carry a top-level `name`; the engine's scene
      // controller object doesn't define one but the editor's panels
      // read it. Fall back to the manifest name when absent.
      const n = parsed.name;
      if (typeof n === "string" && n.trim()) sceneName = n.trim();
      else if (manifest?.name) sceneName = manifest.name;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[hydration] failed to parse scene ${scenePath}: ${(err as Error).message}`,
      );
    }
  } else if (manifest?.name) {
    sceneName = manifest.name;
  }

  // 3) Push into useSceneStore. `setState` here replaces only the data
  //    slice; action functions on the store remain intact.
  useSceneStore.setState({
    dims,
    cells,
    settings: {
      name: sceneName,
      // Default fog/ambient — scene JSONs don't expose these in the
      // engine's current shape, so keep the editor's defaults. A future
      // pass can read `scene.controller.fog` if/when that lands.
      fog: 0.25,
      ambient: 0.35,
    },
  });

  // 4) Push the default layer set. Adds `ceilings` to the legacy
  //    `floors`/`walls`/`doors`/`sprites`/`lights` order so the
  //    engine's third grid renders too. Preserves any custom layers
  //    the user added in this session.
  const existingLayer = useLayerStore.getState();
  const visibility = { ...DEFAULT_LAYER_VISIBILITY };
  for (const c of existingLayer.customLayers) {
    if (visibility[c.id] === undefined) visibility[c.id] = true;
  }
  const order = [
    ...DEFAULT_LAYER_ORDER,
    ...existingLayer.customLayers
      .map((c) => c.id)
      .filter((id) => !DEFAULT_LAYER_ORDER.includes(id as typeof DEFAULT_LAYER_ORDER[number])),
  ];
  useLayerStore.setState({
    activeId: existingLayer.activeId in visibility
      ? existingLayer.activeId
      : "walls",
    visibility,
    order,
    customLayers: existingLayer.customLayers,
  });

  // 5) TilePreset store — pure UI selection state, no IDB source. Reset
  //    to a sensible default if the previously-selected preset id is
  //    obviously stale (a `MOCK_*` id from before Wave 3.3) so the
  //    panel doesn't render a broken "active" pill. Otherwise leave the
  //    user's last selection alone.
  const tp = useTilePresetStore.getState();
  if (tp.activeId === "" || tp.activeId === undefined) {
    useTilePresetStore.setState({
      activeId: "tile:1",
      activeCategory: tp.activeCategory ?? "all",
    });
  }
}
