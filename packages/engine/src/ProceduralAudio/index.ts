/**
 * Sound Lab runtime — engine surface. SL2 of `docs/plans/SOUND_LAB.md`.
 *
 * Public exports for the engine + (eventually) the editor's lab view.
 * The lab view itself lives in `apps/editor/src/views/SoundLab/` (SL3
 * — separate dispatch); SL2 ships only the runtime engine + ops library.
 */

export { RecipeStore } from "./RecipeStore";
export { compileRecipe } from "./Compiler";
export type { CompiledRecipe } from "./Compiler";
export { renderRecipeOffline, audioBufferFromCachedRecord } from "./OfflineRenderer";
export { InstrumentVoicePool } from "./LiveInstrument";
export { recipeContentHash, canonicalRecipeJson, PROCEDURAL_AUDIO_ENGINE_VERSION } from "./Hash";
export { loadCachedBake, storeCachedBake, clearCachedBakes } from "./IdbCache";
export { listSupportedOps } from "./Ops";
export type {
  AudioNodeJson,
  CachedBakeRecord,
  ModulationRouteJson,
  PlayInstrumentOpts,
  SoundRecipeJson,
} from "./types";
