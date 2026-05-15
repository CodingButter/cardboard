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

/** Authoritative index of a pack's contents. */
export interface PackManifest {
  name: string;
  version: string;
  /** Engine version the pack targets (semver string). */
  engine?: string;
  /** Tile id → image path. Path is resolved against the pack root. */
  tileTextures: Record<number, string>;
  /** Sprite sheets that get cropped into multiple tiles at load time. */
  tileSheets: SheetEntry[];
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
}
