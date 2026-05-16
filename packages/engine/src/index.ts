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

// Bootstrap entry — `apps/game/index.ts` calls `main()`. The
// editor iframe boot path uses `bootFromChain` directly so it can
// supply an `IdbAssetPack` instead of going through URL-based pack
// resolution (see EDITOR_IFRAME.md §4).
export { main, bootFromChain } from "./main";
export { Game } from "./Game";
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
  IdbAssetPack,
  DEFAULT_EDITOR_DB_NAME,
  DEFAULT_EDITOR_DB_VERSION,
  resolveChain,
  clearChainCache,
  AssetPack,
  type Preset,
  type PresetSource,
  type PresetError,
  type PresetEmissive,
  type PresetPartialWall,
  type PresetWallFace,
  type ResolvedPresetData,
} from "./AssetPack";
export type {
  PackManifest,
  PackRequiresEntry,
  SheetEntry,
  EquipSlot,
  ItemDef,
  ItemStack,
  WeaponItemStats,
  ArmorItemStats,
  SoundDef,
  SoundGroup,
  DeclarativePrefab,
} from "./AssetPack";
export { registerDeclarativePrefabs } from "./AssetPack";

// Inventory types — pack-side modal UIs (InventoryScreen) need
// `InventoryShape` so they can type the inventory component they
// receive as a prop. The helper functions stay engine-internal; pack
// scripts reach them through `api.inventory`.
export type { InventoryShape } from "./Libs/Inventory";

// ModAPI types — pack-side `.tsx` scripts need the public-API type
// names so their compiled output typechecks against `@two_5_d/engine`.
export type {
  ModAPI,
  InventoryAPI,
  ItemImagesAPI,
  UIAPI,
  SettingsAPI,
  BindingsAPI,
  ModalsAPI,
  InputAPI,
  KeyboardInputAPI,
  MouseInputAPI,
  AudioAPI,
  AudioHandle,
  PlayOpts,
} from "./ModAPI";

// Settings overlay type — needed by SettingsScreen (pack-side after R4)
// to type the user-overlay prop it receives.
export type { PartialGameConfig } from "./Settings";

// GameConfig type — pack-side SettingsScreen reads live CONFIG.
export type { GameConfig } from "./GameConfig";

// KeyBindings + KeyCode — settings UI iterates bindings and binds keys.
export type { KeyBindings } from "./Components";
export type { KeyCode } from "./Controllers/KeyboardController";

// Raycast helpers used by the bake script.
export { castRayThroughWalls, castRayToWall, traceRay } from "./Libs/Raycast";
export type { WallHit, RayTrace } from "./Libs/Raycast";
export { WallSide } from "./Libs/Raycast";

// Vector — `Vec2` shows up in bake-lights' light-vector construction.
export { Vec2 } from "./Libs/Vector";

// Lightmap bake — engine-side `bakeScene`, consumed by BOTH the CLI
// `apps/pack-builder/build-packs.ts` and the editor's Web Worker
// (`apps/editor/src/workers/bake.worker.ts`). Per EDITOR.md Q11.2 the
// bake lives in the engine so the two callers stay in sync.
export { bakeScene } from "./Lighting";
export type { BakeOpts, BakeResult, BakeStats } from "./Lighting";

// Shader validation surface (M5 / MATERIALS.md §11). Pack-builder
// consumes this at build-time. Kept additive — never imported by
// the runtime renderer. See `Renderers/ShaderValidator.ts`.
export {
  collectShaderReferences,
  formatValidationError,
  resolveShaderBackend,
  validateShaderFile,
  validateShaderSource,
  type ShaderValidationError,
  type ShaderValidationResult,
  type ShaderValidationOrigin,
  type ShaderRefToValidate,
  type BackendStatus,
} from "./Renderers/ShaderValidator";

// ── M4 — pack-chain shader cascade (MATERIALS.md §10) ─────────────────
// Exposed for the multi-pack smoke test + the future P2 conflict-
// report UI in Settings → Packs. Kept additive in its own section so
// the parallel engine-pack-split work (R3/R4) doesn't collide on this
// barrel. Single-pack callers don't need to import these.
export {
  cascadeHooks,
  cascadePostPasses,
  chainHasMode1ForRole,
  findMode1WinnerForRole,
  type CascadedPostPass,
} from "./Renderers/ShaderChainCascade";
