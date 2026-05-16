export type {
  SheetEntry,
  EquipSlot,
  WeaponItemStats,
  ArmorItemStats,
  ItemDef,
  ItemStack,
  DefaultInventoryEntry,
  SpriteDef,
  ItemImageVariant,
  PackManifest,
  PackRequiresEntry,
  ShaderRole,
  ShaderHookRole,
  ShaderEntry,
  PostPassDef,
} from "./types";
export { EQUIP_SLOTS, ITEM_IMAGE_VARIANTS, POST_PASS_UNIFORMS } from "./types";
export { discoverItemVariants } from "./discoverItemVariants";
export { AssetPack } from "./AssetPack";
export { ZipAssetPack } from "./ZipAssetPack";
export { DEFAULT_PACK_URL, loadAssetPack } from "./loadAssetPack";
export { resolveChain, clearChainCache } from "./ChainResolver";
export {
  PresetResolver,
  stripJsonComments,
  type Preset,
  type PresetSource,
  type PresetError,
  type PresetEmissive,
  type PresetPartialWall,
  type PresetShaderData,
  type PresetWallFace,
  type ResolvedPresetData,
} from "./PresetResolver";
