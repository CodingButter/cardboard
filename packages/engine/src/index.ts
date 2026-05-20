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
export {
  Scene,
  decodeLightmap,
  decodeRleGrid,
  encodeRleGrid,
  isRleGrid,
  normaliseGridField,
} from "./Scene";
export type {
  SceneJSON,
  SceneGrid,
  SceneOptions,
  SceneLightmap,
  SceneLightmapJSON,
  SceneEntityJSON,
  SceneControllerJSON,
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
  GridField,
  RleGrid,
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
  satisfies,
  rewriteCorsHostileUrl,
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
  ComponentDef,
} from "./AssetPack";

// ECS Component class — re-exported so generated pack `.d.ts` files
// (see `packages/shared/src/generatePackTypes.ts`) can declare
// `Component<T>` instances in the `PackComponents` augmentation
// without reaching past the engine's public surface.
export { Component } from "./ECS";

// ModAPI types — pack-side `.tsx` scripts need the public-API type
// names so their compiled output typechecks against `@two_5_d/engine`.
export type {
  ModAPI,
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
  PackComponents,
  BuiltInComponents,
  KnownTags,
  Tag,
} from "./ModAPI";

// Settings overlay type — needed by SettingsScreen (pack-side after R4)
// to type the user-overlay prop it receives.
export type { PartialGameConfig } from "./Settings";

// GameConfig type — pack-side SettingsScreen reads live CONFIG.
export type { GameConfig } from "./GameConfig";

// KeyBindings + KeyCode — settings UI iterates bindings and binds keys.
export type { KeyBindings } from "./Controllers/Bindings";
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

// Shader validation surface (M5 / materials plan §11 — see git log). Pack-builder
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

// ── M4 — pack-chain shader cascade (materials plan §10, see git log) ──
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

// Editor cell-preview engine — consumed by `apps/editor`'s
// `CellPreview.tsx` via a dynamic import. Kept here so the editor
// doesn't reach into engine internals via a deep path.
export {
  CellPreviewEngine,
  type CellPreviewEngineOptions,
  type PreviewScene,
  type OrbitCamera,
  type CellPreviewLightmapSource,
} from "./Preview";
