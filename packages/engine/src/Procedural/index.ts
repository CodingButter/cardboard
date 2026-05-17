/**
 * Procedural — Image Lab runtime engine (IL2).
 *
 * Public barrel: types + the API impl used by `ModAPI`. See
 * `docs/plans/IMAGE_LAB.md` for the canonical spec; this module is
 * IL2 scope (engine-side runtime + ops MVP). Editor surfaces (IL3+)
 * live in `apps/editor/src/views/ImageLab/`.
 */

export type {
  RecipeJson,
  NodeJson,
  RecipeDef,
  OpDescriptor,
  OpEmitContext,
  PortKind,
  BakedRecipe,
  Spritesheet,
} from "./types";

export { compileRecipe, hashRecipe } from "./Compiler";
export type { CompiledRecipe, CompileOptions } from "./Compiler";

export { ProceduralRenderer } from "./Renderer";
export type { BakeOptions } from "./Renderer";

export { RecipeStore } from "./RecipeStore";
export { ProceduralIDBCache } from "./IDBCache";
export type { CachedBake } from "./IDBCache";

export { bakeAnimated } from "./AnimatedBaker";
export type { BakeAnimatedOptions } from "./AnimatedBaker";

export { ProceduralAPIImpl } from "./ProceduralAPI";
export type { ProceduralAPI } from "./ProceduralAPI";

export { OPS, resolveOp } from "./Ops";
