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
 * One entry of the default-inventory recipe — formerly
 * `manifest.defaultInventory`, now packs ship this in pack data (e.g.
 * `data/default-inventory.json`) and a setup script loads it into
 * `api.singleton("DefaultInventoryRecipe").entries`. A bare string is
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
 * Allowed view-angle counts for animated sprites. Other values (3, 6,
 * 7, 9, …) are rejected by the pack-builder. See
 * `docs/plans/ANIMATIONS.md` §3.1.
 */
export type SpriteAngleCount = 1 | 2 | 4 | 5 | 8 | 16;

/**
 * One named animation on a sprite. The `frames` array holds animation-
 * local frame indices (columns within the angle's row in the sheet —
 * see `docs/plans/ANIMATIONS.md` §5.2). `frameDuration` is per-frame
 * playback time in seconds.
 *
 * A1 scope (per ANIMATIONS.md §14): no `onComplete` callback, no
 * crossfade. `loop`, `next`, and per-clip `angles` override are honoured.
 */
export interface AnimationDef {
  /**
   * Animation-local frame indices. For multi-angle sprites these are
   * column indices within the active row of the sheet (the row is
   * picked by sprite-level `rowBase + angleIndex`).
   */
  frames: number[];
  /** Per-frame duration in seconds. Must be > 0. */
  frameDuration: number;
  /** Default true. When false the animation pauses on its last frame (unless `next` is set). */
  loop?: boolean;
  /**
   * Name of another animation on the same sprite to play once this one
   * finishes (only meaningful with `loop: false`). Resets frame +
   * elapsed to 0 at the transition.
   */
  next?: string;
  /**
   * Override the sprite-level `angles` for this clip. e.g. a death
   * animation typically collapses to a single angle even when the rest
   * of the sprite uses 8. See ANIMATIONS.md §10.1.
   */
  angles?: SpriteAngleCount;
}

/**
 * A pack-defined sprite. The minimal form is `{ image }` (single PNG,
 * single frame, single angle — backwards-compatible with the pre-A1
 * sprite path). The optional fields describe a grid sprite sheet and
 * any named animations / view-angle variants. See
 * `docs/plans/ANIMATIONS.md` §4 for the full schema.
 */
export interface SpriteDef {
  /** Path inside the pack to the sprite PNG. Alpha channel respected. */
  image: string;
  /**
   * Grid frame width in source-image pixels. Omit → single-image
   * sheet (the renderer reads the whole image as one frame).
   */
  frameWidth?: number;
  /** Grid frame height in source-image pixels. */
  frameHeight?: number;
  /** Columns in the source sheet (max frames per animation row). */
  cols?: number;
  /** Rows in the source sheet (sum of per-animation angle strips). */
  rows?: number;
  /**
   * Default view-angle count for animations that don't override.
   * Defaults to 1 (view-independent). See ANIMATIONS.md §3.1.
   */
  angles?: SpriteAngleCount;
  /**
   * Named animations. Keys are the identifiers passed to
   * `api.anim.play(entity, name)`. Iteration order matters — the
   * renderer computes per-animation `rowBase` by walking entries in
   * insertion order. See ANIMATIONS.md §5.1.
   */
  animations?: Record<string, AnimationDef>;
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
 * Editor-authored declarative prefab — pure component bundle used at
 * authoring time as a reusable template. Prefabs are EDITOR-ONLY per
 * the prefabs-editor-only plan (shipped 2026-05-17, see git log): the engine never reads
 * `manifest.prefabs` or this shape. The editor stores templates here
 * (or under `pack/prefabs/*.json`) and stamps the flattened component
 * data into `scene.entities[]` records at save time.
 *
 * `components` is `componentName → componentData`. At authoring time
 * the editor validates the data against each component's schema; the
 * shape round-trips into scene records verbatim and the engine reads
 * those records via its scene-entity load loop.
 */
export interface DeclarativePrefab {
  /** Prefab id — same as the Record key. Kept on the value for clarity. */
  name: string;
  /** componentName → component-data-per-its-schema. */
  components: Record<string, unknown>;
  /** Optional tag list (filtering in the editor's prefab list). */
  tags?: string[];
  /** Optional one-liner shown in the editor's prefab list. */
  description?: string;
}

/**
 * Sound-group routing. Each group has its own gain node and Settings
 * slider — `master` is the global multiplier feeding the destination,
 * the other four feed into `master`. See `docs/plans/AUDIO.md` §5.1.
 */
export type SoundGroup = "master" | "sfx" | "music" | "ambient" | "voice";

/**
 * One playable sound declared in `manifest.audio`. Pack scripts
 * reference sounds by their manifest id via `api.audio.play(id)`. See
 * `docs/plans/AUDIO.md` §3.2.
 */
export interface SoundDef {
  /**
   * Path inside the pack. Browser-decodable: `.ogg`, `.mp3`, `.wav`,
   * `.opus`, `.m4a`. Recommend `.ogg` for cross-browser + license
   * friendliness. See AUDIO.md §7.
   */
  file: string;
  /**
   * Per-sound base volume (0..1). Applied as a static gain on top of
   * the group's live volume. Defaults to 1.0.
   */
  volume?: number;
  /**
   * Group the sound routes to. Drives which Settings slider mixes it.
   * Defaults to `"sfx"`. `"master"` bypasses the per-group sliders.
   */
  group?: SoundGroup;
  /**
   * Default looping behaviour. `playLoop(id)` ignores this; `play(id)`
   * respects it. Defaults to `false`.
   */
  loop?: boolean;
  /**
   * Eager-preload hint. `true` (default for `sfx` / `voice`) loads +
   * decodes the buffer at pack-load time. `false` (default for `music`
   * / `ambient`) defers the fetch to the first play call. See
   * AUDIO.md §5.5.
   */
  preload?: boolean;
}

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
 * One manifest-declared component (WORLD_STATE.md §4 + §10.3). Engine
 * uses only `name` for registration; `schema` is consulted at
 * `world.add(e, C, value)` time to back-fill any missing fields whose
 * declared `default` is present (the JSON-Schema `default` keyword).
 * `tags` is editor-only metadata that round-trips opaquely so
 * component pickers can filter without hard-coding built-ins.
 *
 * The `schema` shape is a JSON-Schema-ish subset (`type` +
 * `properties` + `required` + `items` + `default`) — see
 * `generatePackTypes.ts` for the supported surface. Top-level
 * primitive schemas (`{ "type": "number", "default": 0 }`) honour
 * `default` at the value-root; object schemas honour `default` per
 * property and recurse into nested object properties.
 */
export interface ComponentDef {
  /** Component identifier referenced by entities + Systems component. */
  name: string;
  /**
   * Editor-side schema describing fields. The engine reads only the
   * `default` keyword (consulted by `World.add` to fill missing
   * fields); everything else is opaque.
   *
   * Supported subset (per-property under `schema.properties`):
   *  - `{ "type": "number" | "string" | "boolean" | "array" | "object" }`
   *  - `{ "default": <literal> }` — applied when the field is missing
   *  - `{ "items": <subSchema> }` for arrays (not walked at runtime)
   *  - Nested object `{ "type": "object", "properties": { ... } }` —
   *    inner `default` keywords are honoured recursively.
   *
   * Top-level non-object schemas (e.g. `{ "type": "number",
   * "default": 0 }`) attach to the whole component value: the engine
   * substitutes `default` when the caller passes `undefined`.
   */
  schema?: Record<string, unknown>;
  /** Free-form classification tags for editor filtering. */
  tags?: readonly string[];
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
 * is a semver range enforced against the fetched parent pack's
 * `manifest.version` — see PACK_CHAIN.md § 4 and `AssetPack/semver.ts`
 * for the supported syntax (exact pin, caret `^x.y.z`, tilde `~x.y.z`).
 *
 * See `docs/plans/PACK_CHAIN.md` § 2 + § 6.
 */
export interface PackRequiresEntry {
  /** Human id of the dependency. Optional if `url` is given. */
  id?: string;
  /** Direct URL to the `.apg` (per § 3 URL-substrate principle). */
  url?: string;
  /**
   * Semver range matched against the fetched pack's `manifest.version`.
   * ENFORCED by `ChainResolver.resolveChain` after the integrity check
   * — a mismatch throws with a "version mismatch" error. See
   * `AssetPack/semver.ts` for the supported subset (exact, caret,
   * tilde; compound ranges + prereleases deferred to v2). Empty or
   * unset = no constraint (back-compat with pre-enforcement manifests).
   * See PACK_CHAIN.md § 4.
   */
  version?: string;
  /** SRI hash (`sha256-…` / `sha384-…`) of the fetched `.apg` bytes. */
  integrity?: string;
  /**
   * Editor-side enable flag. Default `true`. When set to `false` the
   * chain resolver treats the entry as if it were absent from
   * `requires[]` — the referenced pack is NOT fetched, NOT added to
   * the visited set, and NOT pushed into the discover queue. Used by
   * the editor's Project Settings → Dependencies tab so the author
   * can pin a dep but switch it off without removing the row from
   * the manifest (handy for A/B testing override packs).
   *
   * Round-trips as a manifest field so the flag persists across
   * editor sessions. Runtime resolver semantics are the same as if
   * the entry were never declared.
   */
  enabled?: boolean;
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
   * Scopes this pack contributes to. Defaults to `["game"]` for
   * back-compat — every pre-existing manifest (no `scope` field)
   * loads into the runtime engine only.
   *
   *  - `"game"`  — runtime-side contributions (components, scripts,
   *    prefabs, tile textures, sprites, audio, …). Tree-shaken OUT of
   *    editor-only loads.
   *  - `"editor"` — editor-side contributions (currently
   *    `editorPanels`; future: command-palette entries, inspectors,
   *    keybindings). Tree-shaken OUT of production game builds.
   *
   * A pack MAY declare both — paired contributions (e.g. a runtime
   * component schema + an editor inspector for that component) live
   * in the same manifest. See `docs/plans/EDITOR_ENGINE.md` §6.
   */
  scope?: ReadonlyArray<"game" | "editor">;
  /**
   * Editor-scope: list of JSON panel-spec files (paths relative to
   * the pack root). The editor's pack loader fetches each file at
   * startup, validates it against `PanelSpec` from
   * `apps/editor/src/panel-renderer/types.ts`, and registers the
   * panel as a `DockPanelDef` so it appears in the DocksModal under
   * its declared `category`. Loaded panels render via
   * `<PanelRenderer spec={…}>` — same component a hand-written panel
   * would use to mount JSON-authored content.
   *
   * Ignored on the runtime engine side (the engine never reads this
   * field). See `docs/plans/EDITOR_ENGINE.md` §4 + §8 Phase 0.
   */
  editorPanels?: ReadonlyArray<string>;
  /**
   * Editor-scope: list of `.tutorial.json` files (paths relative to
   * the pack root). The editor's pack loader fetches each file at
   * startup, parses it as a `TutorialDef`, and registers it with the
   * runtime tutorial registry via `api.tutorials._register`. Pack
   * tutorials follow the same pack-chain semantics as the rest of the
   * editor-scope catalog — last-pack-wins on slug collision and live
   * unregister-on-disable via the per-pack cleanup ring.
   *
   * Ignored on the runtime engine side (the engine never reads this
   * field). See `docs/plans/TUTORIALS.md` §3 T2 + §4.1.
   */
  tutorials?: ReadonlyArray<string>;
  /**
   * Editor-scope pack scripts. Each path is a `.js` (or `.ts` at
   * source-time; the pack-builder transpiles to `.js`) module inside
   * the pack root that the editor loads AFTER panel registration. The
   * loader fetches the source via `pack.textBody(path)`, wraps it in a
   * Blob URL, and dynamically imports the module as ESM. The default
   * export is invoked with an `EditorPackContext` exposing the same
   * `registerCommand` API the editor app uses itself — the script can
   * register commands, settings, etc. that its declarative panels then
   * reference by id (e.g. `{ onClick: { script: "demo.selection.clear" } }`).
   *
   * Scope rules mirror `editorPanels`: this field is ignored on the
   * runtime engine side; runtime-scope pack code lives in
   * `world.json.scripts[]` and `Scripts` components. See
   * `docs/plans/EDITOR_ENGINE.md` §8 Phase 2a (pack-bundled scripts).
   */
  scripts?: ReadonlyArray<string>;
  /**
   * Editor-scope: pack-bundled npm libraries. Each entry is a JS file
   * inside the pack root that the editor loads as ESM via a content-
   * hash-deduped Blob URL. The loader exposes the resolved module to
   * pack scripts through `ctx.importLibrary(name)`.
   *
   * Pack-builder resolves `entry` (an npm import specifier such as
   * `"chart.js/auto"`) against the pack's `node_modules`, runs Bun's
   * bundler to produce a single self-contained ESM file, computes
   * SHA-256 of the bytes, and writes the hash into this manifest
   * entry (replacing any `"PLACEHOLDER"` value the author wrote).
   * See `docs/plans/PERFORMANCE_PROFILER.md` §4 and
   * `docs/plans/EDITOR_ENGINE.md` §5.
   *
   * Ignored on the runtime engine side — the runtime engine has no
   * notion of pack-bundled npm modules; runtime-scope script imports
   * resolve through the pack-script compile step.
   */
  libraries?: ReadonlyArray<{
    /** npm package name the library was bundled from (e.g. "chart.js"). */
    name: string;
    /** Pinned npm version (informational; SRI hash is the auth gate). */
    version: string;
    /**
     * npm import specifier handed directly to Bun's bundler at pack-
     * build time (e.g. `"chart.js/auto"`). Resolves against the pack's
     * own `node_modules`. Optional in legacy manifests — pack-builder
     * falls back to a small built-in convenience map keyed by `name`
     * when `entry` is omitted, but third-party packs SHOULD set it
     * explicitly so the pack-builder never depends on a centrally-
     * maintained allowlist.
     */
    entry?: string;
    /** Path inside the pack, relative to the pack root. */
    path: string;
    /** SRI-style content hash of the file bytes (e.g. "sha256-<base64>"). */
    hash: string;
  }>;
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
   *
   * Optional when the pack's `scope` does NOT include `"game"`
   * (editor-only packs don't ship texture content). Game-scope packs
   * SHOULD set this — omitting it results in a pack that contributes
   * no tile textures.
   */
  tileTextures?: Record<number, string>;
  /**
   * Sprite sheets that get cropped into multiple tiles at load time.
   * Optional under the same conditions as `tileTextures`.
   */
  tileSheets?: SheetEntry[];
  /**
   * Optional list of JSONC preset library paths (relative to the pack
   * root). Each file is `{ "preset.id": { ...PresetSource } }`. Order
   * matters only for in-pack ID collisions — later file wins. See
   * `docs/plans/TILE_PRESETS.md` § 3 + § 5.1.
   */
  tilePresets?: string[];
  /**
   * Path inside the pack to the scene loaded at startup.
   *
   * Optional when the pack's `scope` does NOT include `"game"`
   * (editor-only packs don't ship a startup scene). Game-scope packs
   * SHOULD set this.
   */
  startScene?: string;
  /**
   * Optional path to a `config.json` inside the pack. Loaded values are
   * deep-merged over the engine's baseline `game.config.json`, so packs
   * only need to specify the fields they want to change.
   */
  config?: string;
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
  /**
   * Audio registry — Au1 of `docs/plans/AUDIO.md`. Keys are the ids
   * referenced by `api.audio.play(id)` et al. Files live anywhere in
   * the pack; convention is `audio/sfx/`, `audio/music/`,
   * `audio/ambient/`. A pack with no `audio` field skips the audio
   * subsystem entirely (no `AudioContext` instantiation, byte-
   * identical to pre-Au1).
   *
   * Renamed from `sounds` for consistency: the folder is `audio/`, the
   * runtime API is `api.audio.*`, the engine module is `AudioRegistry`
   * — `sounds` was the odd one out.
   */
  audio?: Record<string, SoundDef>;
  /**
   * Editor-authored declarative prefabs — see `DeclarativePrefab`.
   * Keys are stable prefab ids referenced by editor tooling (the
   * Prefabs view, scene-spawner controllers, drag-from-browser
   * inserts). The engine no longer exposes a runtime spawn API for
   * these — `api.spawn(name)` was removed when prefabs became
   * editor-only authoring assets (verified against `types.ts` 2026-05-20).
   * Instead, the editor flattens every prefab reference into
   * `scene.entities[]` at scene-save time; the engine boots those
   * entities directly. Walked AFTER `runPackScripts()` so JS scripts
   * have a chance to register any pack-defined components the
   * declarative shapes reference. See `docs/plans/EDITOR.md` §6.3 +
   * `.claude/memory/project_prefabs_declarative_assets.md`.
   */
  prefabs?: Record<string, DeclarativePrefab>;
  /**
   * Manifest-declared components (WORLD_STATE.md §4). Each entry
   * gives the engine a `name`, optional `schema`, and optional `tags`
   * (`"entity"` / `"scene"` / `"world"` / …). The engine registers
   * every entry against the shared `ComponentRegistry` BEFORE pack
   * scripts run, so script-side spawns and scene-controller spawns
   * can resolve pack-declared component names. Built-in conflicts
   * are tolerated — the built-in instance keeps the live storage and
   * the manifest entry augments tags/schema for editor pickers.
   */
  components?: ComponentDef[];
  /**
   * Procedural image recipes — IL2 of `docs/plans/IMAGE_LAB.md`.
   * Keys are recipe ids referenced by `api.procedural.load(id)`;
   * values point at the `.recipe.json` file inside the pack. A pack
   * with no `recipes` field skips the procedural subsystem entirely
   * (no offscreen WebGL context, byte-identical to pre-IL2).
   *
   * Recipes are loaded lazily — the engine scans this map at boot
   * but defers GLSL compilation + bake to the first `load(id)` call.
   * Pack-chain semantics mirror sprites / sounds: last-pack wins on
   * id conflicts.
   */
  recipes?: Record<string, RecipeManifestEntry>;
}

/**
 * One entry of `manifest.recipes` — points at a `.recipe.json` file
 * inside the pack. Kept minimal in IL2; additive fields (per-instance
 * variation flags, rebake triggers, manifest-level seed overrides)
 * land in later phases without breaking the schema.
 */
export interface RecipeManifestEntry {
  /** Path inside the pack to the recipe JSON (e.g. `"recipes/brick.recipe.json"`). */
  file: string;
}
