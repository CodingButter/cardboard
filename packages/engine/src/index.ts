/**
 * Public barrel for `@two_5_d/engine`.
 *
 * Cross-package consumers (`apps/game`, `apps/pack-builder`) import
 * everything they need from here. Intra-engine code keeps using the
 * project-relative path aliases (`"Scene"`, `"Components"`, etc.) —
 * see `tsconfig.json#paths`.
 *
 * Keep this surface tight; don't re-export internals just because a
 * consumer happens to need them today. Add a deliberate re-export
 * line below when a new boundary crossing is needed.
 */

// Bootstrap entry — `apps/game/index.ts` calls `main()`.
export { main } from "./main";
export type { GameState } from "./Game";

// Scene module — the bake script (`apps/pack-builder`) parses, mutates,
// and re-emits SceneJSON, and uses the `Scene` class for LOS queries.
export { Scene } from "./Scene";
export type {
  SceneJSON,
  SceneGrid,
  SceneSpawn,
  SceneOptions,
  SceneLightmap,
  SceneLightmapJSON,
  Cell,
  WallSegment,
  WallSegmentInput,
  WallCellInput,
  WallFace,
  EmissiveSpec,
  FloorData,
  CeilingData,
  FloorCellInput,
  CeilingCellInput,
  StructuredFloorSpec,
  TileSpec,
  LightDef,
} from "./Scene";

// Asset-pack surface — pack-builder + editor consume preset types.
export {
  PresetResolver,
  stripJsonComments,
  ZipAssetPack,
  type Preset,
  type PresetSource,
  type PresetError,
  type PresetEmissive,
  type PresetPartialWall,
  type PresetWallFace,
  type ResolvedPresetData,
} from "./AssetPack";
export type { PackManifest, SheetEntry } from "./AssetPack";

// Raycast helpers used by the bake script.
export { castRayThroughWalls, castRayToWall, traceRay } from "./Libs/Raycast";
export type { WallHit, RayTrace } from "./Libs/Raycast";
export { WallSide } from "./Libs/Raycast";

// Vector — `Vec2` shows up in bake-lights' light-vector construction.
export { Vec2 } from "./Libs/Vector";
