export { TwoDRenderer } from "./TwoDRenderer";
export type { TwoDRendererProps } from "./TwoDRenderer";
export { WebGLRenderer } from "./WebGLRenderer";
export type { WebGLRendererProps } from "./WebGLRenderer";
export { Texture } from "./Texture";
export type { SceneRenderer, SpriteDrawRequest, LightInstance } from "./SceneRenderer";
export {
  getShaderSource,
  isShaderRole,
  SHADER_ROLES,
  type ShaderRole as RendererShaderRole,
} from "./ShaderRoleRegistry";
export { headerFor } from "./shaderHeaders";
export {
  collectSpriteVariants,
  collectWorldVariants,
  collectSceneShaderLayer,
  emptySceneLayer,
  ShaderVariantSet,
  WorldShaderVariantSet,
  type ShaderVariant,
  type WorldShaderVariant,
  type SceneShaderLayer,
} from "./ShaderVariants";

// M4 — pack-chain shader cascade (materials plan §10 — see git log).
export {
  cascadeHooks,
  cascadePostPasses,
  chainHasMode1ForRole,
  findMode1WinnerForRole,
  type CascadedPostPass,
} from "./ShaderChainCascade";
