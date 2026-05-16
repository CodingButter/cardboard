/**
 * Asset packs — the Doom-WAD analog for this engine.
 *
 * A pack is a zip with a `.apg` extension containing:
 *
 *   manifest.json        the index — names, versions, and entry points
 *   config.json          (phase 2) deep-merge overrides over baseline config
 *   scenes/*.json        level definitions, layered walls/floors/ceilings
 *   images/*             texture assets, referenced by tile id in the manifest
 *   scripts/*.js         (phase 3) JS modules that register mod content
 *
 * `loadAssetPack(url?)` downloads + unzips + indexes a `.apg`, defaulting
 * to `/packs/default.apg` when no URL is given. The engine consumes
 * `AssetPack` everywhere, so adding a new backing format (HTTP folder,
 * IndexedDB, etc.) is a subclass with `textureBlob` + `textBody` + `has`.
 */

/** Crop spec for a tile sheet (matches the renderer's TILE_SHEETS shape). */
export interface SheetEntry {
  /** Path inside the pack. */
  path: string;
  tileWidth: number;
  tileHeight: number;
  offsetX: number;
  offsetY: number;
  cols: number;
  rows: number;
  /** First tile id; subsequent tiles in the sheet take consecutive ids. */
  startTileId: number;
}

/**
 * The body slots an item can be equipped to. The set is fixed — pack
 * authors pick from this list when declaring an item's `equipSlot`.
 * `mainHand` is the slot the player wields when an item is in the
 * active hotbar slot; it can also hold a fallback weapon equipped
 * directly through the inventory UI.
 */
export type EquipSlot =
  | "helmet"
  | "chest"
  | "gloves"
  | "legs"
  | "feet"
  | "mainHand"
  | "offHand"
  | "ring1"
  | "ring2"
  | "amulet";

/** All slots in a stable order — used for UI iteration. */
export const EQUIP_SLOTS: readonly EquipSlot[] = [
  "helmet",
  "chest",
  "gloves",
  "legs",
  "feet",
  "mainHand",
  "offHand",
  "ring1",
  "ring2",
  "amulet",
];

/** Weapon-specific stats. Present on `ItemDef` when `type === "weapon"`. */
export interface WeaponItemStats {
  /** PNG to use as the held viewmodel. Defaults to the ItemDef's `image`. */
  viewmodelImage?: string;
  heightFraction?: number;
  reticleGapFraction?: number;
  swayAmplitudeFraction?: number;
  swayFrequency?: number;
  recoilDuration?: number;
  recoilHeightFraction?: number;
  recoilScale?: number;
  recoilSkew?: number;
  /** Rounds per second while fire held; `0` / unset = semi-auto. */
  fireRate?: number;
  /** Magazine capacity. `0` / unset = no magazine (infinite ammo). */
  magazineSize?: number;
  /** Seconds to consummate a reload. Default 1.5. */
  reloadTime?: number;
  /** Mag count when the item is first granted. Default 0. */
  startingMag?: number;
  /** Item id this weapon consumes on fire / pulls from on reload. */
  ammoItem?: string;
}

/** Armor-specific stats. Present on `ItemDef` when `type === "armor"`. */
export interface ArmorItemStats {
  /** 0..1 damage reduction. Effects activate once damage exists. */
  damageReduction?: number;
}

/**
 * A pack-defined item. Items are the generic unit of "thing in
 * inventory" — weapons, ammo, armor, consumables. They live in the
 * player's bag/hotbar/equipment and can be picked up off the world.
 *
 * The `image` field is the small icon used in inventory UI / hotbar.
 * Weapons override that with a higher-res `weapon.viewmodelImage` when
 * needed.
 */
export interface ItemDef {
  /** Display name in HUD + inventory tooltips. */
  name: string;
  /** Inventory icon (PNG path inside the pack). */
  image: string;
  /** Behavior category — drives equip-slot validation and game logic. */
  type: "weapon" | "ammo" | "armor" | "misc";
  /** Max items in a single stack. Defaults: weapons/armor = 1, others = 64. */
  stackMax?: number;
  /** Which slot accepts this item in the equipment panel. */
  equipSlot?: EquipSlot;
  /** Required when `type === "weapon"`. */
  weapon?: WeaponItemStats;
  /** Required when `type === "armor"`. */
  armor?: ArmorItemStats;
  /**
   * Optional `manifest.sprites` id used when this item is dropped /
   * placed in the world. Lets a single item id render with one image
   * in the UI and a different (or same) sprite in 3D space.
   */
  worldSpriteId?: string;
}

/**
 * One slot's contents. The mag field is only meaningful for weapon
 * items — it stores the loaded round count of THIS weapon instance.
 * Ammo items use `count`; weapon items always have `count: 1`.
 */
export interface ItemStack {
  itemId: string;
  count: number;
  mag?: number;
}

/**
 * Seed entry for `manifest.defaultInventory`. A bare string is
 * shorthand for `{ itemId: <string>, count: 1 }`.
 */
export interface DefaultInventoryEntry {
  itemId: string;
  count?: number;
  /**
   * Optional placement hint: `"hotbar:N"`, `"bag:N"`, or `"equip:<slot>"`.
   * Omitting auto-places (hotbar first, then bag).
   */
  slot?: string;
}

/**
 * A pack-defined sprite. Right now this is just the image path; instance
 * properties (where to spawn, how tall, vertical offset) live on the
 * `Sprite` component of each entity. This keeps the manifest small while
 * still letting the renderer preload every sprite atlas at boot.
 */
export interface SpriteDef {
  /** Path inside the pack to the sprite PNG. Alpha channel respected. */
  image: string;
}

/**
 * Filename-suffix variants an item image can have. Discovery is
 * automatic from the manifest's `image` path (or any variant of it):
 *
 *   rifle.png         — bare (fallback when no variant matches)
 *   rifle.icon.png    — inventory + hotbar icon
 *   rifle.held.png    — first-person viewmodel
 *   rifle.world.png   — pickup sprite in the world
 */
export const ITEM_IMAGE_VARIANTS = ["icon", "held", "world"] as const;
export type ItemImageVariant = (typeof ITEM_IMAGE_VARIANTS)[number];

/**
 * Catalog of fragment-shader roles a pack can override. Kept in sync
 * with `ShaderRoleRegistry`'s `ShaderRole`; re-declared here so
 * `PackManifest` doesn't pull a renderer dep just for a type literal.
 *
 * Phase S1 of `docs/plans/ENGINE_PACK_SHADERS.md` — three roles match
 * the WebGL2 renderer's three fragment programs.
 */
export type ShaderRole = "skyFrag" | "worldFrag" | "spriteFrag";

/**
 * Hook-file variant of every role. A pack supplies `{role}Hooks` (Mode
 * 3 / S3) to redefine specific named `hook_*` functions in the engine's
 * default body, instead of replacing the whole role (`{role}Frag` —
 * Mode 1 / S1). See `docs/plans/ENGINE_PACK_SHADERS.md` §5.
 */
export type ShaderHookRole = "skyHooks" | "worldHooks" | "spriteHooks";

/** Either of the two pack-supplied shader manifest keys. */
export type ShaderEntry = ShaderRole | ShaderHookRole;

/**
 * One Mode-2 (post-process) fragment pass declared by a pack. The pack
 * ships just the body of a fragment shader (helpers + `void main()`);
 * the engine prepends an auto-injected post-pass header declaring the
 * standard contract — `u_color` (previous pass output), `u_resolution`,
 * `u_time`, `u_frame`, varying `v_uv`, output `outColor`.
 *
 * `name` is unique within the pack and surfaces in the conflict report
 * when chains collide. `frag` is the path to the GLSL body inside the
 * pack. Phase S4 of `docs/plans/ENGINE_PACK_SHADERS.md` §4.
 */
export interface PostPassDef {
  /** Unique within the pack; used for chain reporting (§9 / §10.4). */
  name: string;
  /** Path inside the pack to the fragment-shader body. */
  frag: string;
}

/**
 * Auto-injected post-pass uniforms a pack body can read without
 * redeclaration. Exposed for editor tooling that wants to surface the
 * contract; the runtime header is built from these names verbatim.
 */
export const POST_PASS_UNIFORMS = ["u_color", "u_resolution", "u_time", "u_frame"] as const;

/**
 * One declared dependency of a pack. Two resolution paths exist; for
 * Phase P1 of `docs/plans/PACK_CHAIN.md` only the URL-pinned form is
 * implemented:
 *
 *  - `{ id, url, integrity? }` — fetch the URL directly. `integrity`
 *    is an SRI hash (`sha256-…` / `sha384-…`) of the `.apg` bytes;
 *    strongly recommended for URL deps so a host swapping contents
 *    after the dependent pack was authored is a hard abort. P1 warns
 *    when `url` is given without `integrity`.
 *  - `{ id, version? }` (no url) — store-resolved lookup against a
 *    future community store (P3). Until then the resolver hard-errors
 *    with "store-backed resolution not yet implemented".
 *
 * `id` is the human-readable dependency id and lets the resolver
 * dedupe across two packs that pull in the same dep by url. `version`
 * is a semver range (P1 reserves the field but only validates exact
 * equality when both sides set it).
 *
 * See `docs/plans/PACK_CHAIN.md` § 2 + § 6.
 */
export interface PackRequiresEntry {
  /** Human id of the dependency. Optional if `url` is given. */
  id?: string;
  /** Direct URL to the `.apg` (per § 3 URL-substrate principle). */
  url?: string;
  /** Semver range or pin. Reserved — P1 only does exact-equality checks. */
  version?: string;
  /** SRI hash (`sha256-…` / `sha384-…`) of the fetched `.apg` bytes. */
  integrity?: string;
}

/** Authoritative index of a pack's contents. */
export interface PackManifest {
  /**
   * Globally unique pack id. Optional in P1 for backwards-compat with
   * the existing default-pack which only ships `name`. Once
   * pack-chain `requires` becomes load-bearing every pack will have
   * to set this (P2+); the resolver dedupes by url today.
   */
  id?: string;
  name: string;
  version: string;
  /** Engine version the pack targets (semver string). */
  engine?: string;
  /**
   * Declared dependencies. The chain resolver walks every entry,
   * fetches the referenced pack, verifies integrity, and inserts
   * dependencies before the dependent in the resulting chain. P1 of
   * `docs/plans/PACK_CHAIN.md` § 11.
   */
  requires?: PackRequiresEntry[];
  /**
   * Tile id → image path. Path is resolved against the pack root.
   *
   * **Deprecated** in favour of `tilePresets[]` but kept indefinitely
   * as the only renderer texture source — the resolver synthesises
   * `__legacy.<id>` presets from this table and the migrated scene
   * `idMap` entries point at preset ids that round-trip through here
   * for the renderer's tile-id world. See
   * `docs/plans/TILE_PRESETS.md` § 5.3.
   */
  tileTextures: Record<number, string>;
  /** Sprite sheets that get cropped into multiple tiles at load time. */
  tileSheets: SheetEntry[];
  /**
   * Optional list of JSONC preset library paths (relative to the pack
   * root). Each file is `{ "preset.id": { ...PresetSource } }`. Order
   * matters only for in-pack ID collisions — later file wins. See
   * `docs/plans/TILE_PRESETS.md` § 3 + § 5.1.
   */
  tilePresets?: string[];
  /** Path inside the pack to the scene loaded at startup. */
  startScene: string;
  /**
   * Optional path to a `config.json` inside the pack. Loaded values are
   * deep-merged over the engine's baseline `game.config.json`, so packs
   * only need to specify the fields they want to change.
   */
  config?: string;
  /**
   * Optional list of script paths inside the pack. Each script is loaded
   * as an ES module via a Blob URL and its default export is invoked
   * with the engine's `ModAPI` to register components, prefabs, and
   * systems.
   */
  scripts?: string[];
  /**
   * Item catalog. Keys are item ids referenced by `defaultInventory`,
   * `Pickup` components, and the inventory UI. Replaced the old
   * `weapons` catalog — weapons are now `ItemDef` entries with
   * `type: "weapon"`.
   */
  items?: Record<string, ItemDef>;
  /**
   * Items the player starts the session holding. Entries can be a
   * bare item id (shorthand for `{ itemId, count: 1 }`) or a full
   * `DefaultInventoryEntry` with count + optional slot placement.
   */
  defaultInventory?: ReadonlyArray<string | DefaultInventoryEntry>;
  /**
   * Sprite catalog. Keys are the ids referenced by entities' `Sprite`
   * component. Renderers preload every image at boot so spawning is
   * a synchronous component-add.
   */
  sprites?: Record<string, SpriteDef>;
  /**
   * Bake-time lighting tuning. Consumed by `scripts/build-packs.ts`
   * and forwarded to `bakeScene` as `BakeOpts`; ignored at runtime
   * (the baked lightmap already carries its `resolution`). Both
   * fields default to the bake script's `DEFAULT_LIGHTMAP_RESOLUTION`
   * / `DEFAULT_LIGHT_SUPERSAMPLE` (4 / 4) when absent.
   */
  lighting?: {
    /** K-factor — sub-samples per cell on each axis. */
    lightmapResolution?: number;
    /** Jitter samples per light per corner (1 = hard shadows). */
    supersample?: number;
  };
  /**
   * Optional per-role fragment shaders.
   *
   *  - `{role}Frag` (Mode 1, S1) — full role replacement. The pack
   *    ships the **body** of a fragment shader (helpers + `void
   *    main()`); the engine prepends the auto-injected header
   *    declaring every uniform / varying / `#define`. See
   *    `shaderHeaders.ts`.
   *  - `{role}Hooks` (Mode 3, S3) — pack ships ONLY `hook_*` function
   *    definitions which override the engine's identity-default hooks
   *    at fixed call sites in the engine's `main()`. No `main()` and
   *    no boilerplate in the file. See `HookPrelude.ts` and
   *    `docs/plans/ENGINE_PACK_SHADERS.md` §5 + §7.
   *
   * Mode 1 and Mode 3 are mutually exclusive per-role per-pack (§5.5)
   * — a manifest with both `worldFrag` and `worldHooks` set drops the
   * hooks file with a console warning at boot.
   *
   * WebGL2 backend only. On the canvas2d backend any entries here are
   * silently ignored.
   *
   * `postPasses` (Mode 2, S4) — an ordered array of full-screen
   * fragment passes that run AFTER the world + sprite passes and
   * BEFORE the HUD compositing step (per §4.4). Each pass receives
   * the previous color buffer as `u_color`, runs against an FBO
   * ping-pong, and the final pass writes to the default framebuffer.
   * Passes apply in array order (index 0 first). Empty / missing is
   * a no-op and renders byte-identically to a build without S4.
   */
  shaders?: Partial<Record<ShaderEntry, string>> & {
    postPasses?: PostPassDef[];
  };
}
