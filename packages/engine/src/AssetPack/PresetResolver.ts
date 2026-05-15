/**
 * `PresetResolver` — the single source of truth for "what a tile is."
 *
 * A pack's `manifest.tilePresets[]` lists JSONC files under the pack root.
 * Each file is an object whose keys are preset IDs (dotted lower-kebab for
 * named, `_<hash>` for anonymous) and whose values are partial preset
 * definitions. After load the resolver:
 *
 *   1. Strips JSONC comments + trailing commas, parses each file.
 *   2. Registers every entry with its source pack/file for diagnostics.
 *   3. Resolves `extends:` chains (cycle-detected, depth-limited).
 *   4. Applies defaults so the renderer never has to know about them.
 *   5. Freezes a `ReadonlyMap<presetId, Preset>` for runtime lookup.
 *
 * Backwards compatibility — packs that still ship `manifest.tileTextures`
 * get an in-memory `__legacy.<tileId>` preset library synthesised at
 * resolver construction time. Scenes whose grids carry bare numeric tile
 * ids fall through to those legacy presets when no `idMap` lookup is
 * provided. See `docs/plans/TILE_PRESETS.md` §5.3.
 *
 * Renderer integration — the engine's renderers continue to key on
 * integer tile ids (driven by `manifest.tileTextures`). When a scene
 * uses the new `idMap` form, `Scene.fromJSON` calls the resolver to
 * translate each preset ID into a `WallSegmentInput` / `FloorCellInput`
 * shape the existing Scene constructor consumes, so the renderer's
 * texture-loading path is unchanged. Texture paths on resolved presets
 * are reverse-looked-up against `manifest.tileTextures` to recover the
 * tile id the renderer expects.
 *
 * See `docs/plans/TILE_PRESETS.md` §§3, 6, 7 for the data + algorithm
 * spec; §11 for the migration plan this module powers.
 */

import type { PackManifest } from "./types";

/** Face of a cell a partial wall lives on. */
export type PresetWallFace = "north" | "south" | "east" | "west";

/** Emissive surface authoring shape (preset edition). */
export interface PresetEmissive {
  color: [number, number, number];
  intensity: number;
  areaLight: boolean;
}

/** Partial-wall horizontal-geometry block (Phase 3 of the wall overhaul). */
export interface PresetPartialWall {
  face: PresetWallFace;
  startU: number;
  widthU: number;
}

/**
 * What the resolver returns for a single preset, with every field
 * either set or explicitly defaulted. The renderer reads this flat
 * record without having to know the file format that fed it.
 *
 * `texture` is the **path inside the pack** (e.g. `images/tiles/wall.jpg`),
 * NOT the renderer's integer tile id. The Scene loader uses
 * `PresetResolver.tileIdForTexture(path)` to bridge to the existing
 * tile-id world for now.
 */
export interface ResolvedPresetData {
  /** Texture path inside the pack. Required. */
  texture: string;
  /** Top horizontal-cap texture path. */
  topCap?: string;
  /** Bottom horizontal-cap texture path. */
  bottomCap?: string;
  /** Texel offset along U. Default 0. */
  offsetX: number;
  /** Texel offset along V. Default 0. */
  offsetY: number;
  /** Wall vertical extent. Default 1. */
  wallHeight: number;
  /** Wall vertical start. Default 0. */
  wallStartZ: number;
  /** Partial-wall geometry. Omit = fills the cell. */
  partialWall?: PresetPartialWall;
  /** Floor world-z. Default 0. */
  floorHeight: number;
  /** Ceiling world-z. Default 1. */
  ceilingHeight: number;
  /** Floor/ceiling reflectiveness 0..1. Default 0. */
  reflectiveness: number;
  /** Floor/ceiling transition softness 0..1. Default 0. */
  transition: number;
  /** Texture used at floor/ceiling step risers. */
  riserTexture?: string;
  /** Self-illumination + area-light hint. */
  emissive?: PresetEmissive;
  /** Collision class. Default `"solid"`. */
  collision: "solid" | "passable" | "trigger" | "blockBullets";
  /** Whether AO is applied. Default true. */
  ambientOcclusion: boolean;
  /** Human label for editor pickers (not rendered). */
  displayName?: string;
  /** Editor filter tags (not rendered). */
  tags?: ReadonlyArray<string>;
  /** Editor thumbnail override (not rendered). */
  thumbnail?: string;
}

/** Authoring shape — every field optional, including `texture` if `extends` provides it. */
export interface PresetSource {
  extends?: string;
  texture?: string;
  topCap?: string;
  bottomCap?: string;
  offsetX?: number;
  offsetY?: number;
  wallHeight?: number;
  wallStartZ?: number;
  partialWall?: PresetPartialWall;
  floorHeight?: number;
  ceilingHeight?: number;
  reflectiveness?: number;
  transition?: number;
  riserTexture?: string;
  emissive?: { color: [number, number, number]; intensity: number; areaLight?: boolean };
  collision?: "solid" | "passable" | "trigger" | "blockBullets";
  ambientOcclusion?: boolean;
  displayName?: string;
  tags?: ReadonlyArray<string>;
  thumbnail?: string;
}

/** Registered preset + provenance, post-resolution. */
export interface Preset {
  readonly id: string;
  readonly data: ResolvedPresetData;
  readonly sourcePackId: string;
  readonly sourcePath: string;
}

/** A structured load error — accumulated so we can report all of them. */
export interface PresetError {
  packId: string;
  file: string;
  presetId?: string;
  message: string;
  hint?: string;
}

/** Max `extends:` chain depth before we bail with a clear error. */
const MAX_EXTENDS_DEPTH = 8;

/**
 * Strip `//`-to-EOL and `/* ... *‍/` comments from a JSONC document.
 * Preserves string literals (including escapes) verbatim, and also
 * tolerates trailing commas before `}` / `]` for hand-author convenience.
 * Tiny inlined implementation — no jsonc-parser dep.
 */
export function stripJsonComments(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;
  let inString = false;
  let stringQuote = "";

  while (i < n) {
    const ch = text[i]!;

    if (inString) {
      out.push(ch);
      if (ch === "\\" && i + 1 < n) {
        // Preserve the escape sequence verbatim — both the backslash
        // and the next character. This keeps `\"` inside strings from
        // confusing the string-terminator check.
        out.push(text[i + 1]!);
        i += 2;
        continue;
      }
      if (ch === stringQuote) {
        inString = false;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out.push(ch);
      i++;
      continue;
    }

    if (ch === "/" && i + 1 < n) {
      const next = text[i + 1]!;
      if (next === "/") {
        // Line comment — skip to next \n (keep the newline so line
        // numbers in error messages still line up).
        i += 2;
        while (i < n && text[i] !== "\n") i++;
        continue;
      }
      if (next === "*") {
        // Block comment — skip to matching `*/`. Preserve embedded
        // newlines so line numbers stay aligned.
        i += 2;
        while (i < n) {
          if (text[i] === "*" && text[i + 1] === "/") {
            i += 2;
            break;
          }
          if (text[i] === "\n") out.push("\n");
          i++;
        }
        continue;
      }
    }

    out.push(ch);
    i++;
  }

  // Strip trailing commas before `}` or `]`. JSON.parse rejects them
  // but JSONC tolerates them, and modders forget the comma rules.
  // Run as a regex pass on the comment-stripped text.
  return out.join("").replace(/,(\s*[}\]])/g, "$1");
}

/* --- The resolver ------------------------------------------------------ */

const TEXTURE_FIELDS_REQUIRING_PATH = ["texture", "topCap", "bottomCap", "riserTexture"] as const;

/**
 * Defaults applied AFTER `extends` resolution. Mirrors the §7.3 table
 * in the plan doc. Every field is set so the renderer never has to
 * branch on `undefined`.
 */
function withDefaults(src: PresetSource): ResolvedPresetData {
  return {
    texture: src.texture!, // checked by caller before this is called
    topCap: src.topCap,
    bottomCap: src.bottomCap,
    offsetX: src.offsetX ?? 0,
    offsetY: src.offsetY ?? 0,
    wallHeight: src.wallHeight ?? 1,
    wallStartZ: src.wallStartZ ?? 0,
    partialWall: src.partialWall,
    floorHeight: src.floorHeight ?? 0,
    ceilingHeight: src.ceilingHeight ?? 1,
    reflectiveness: src.reflectiveness ?? 0,
    transition: src.transition ?? 0,
    riserTexture: src.riserTexture,
    emissive: src.emissive
      ? {
          color: src.emissive.color,
          intensity: src.emissive.intensity,
          areaLight: src.emissive.areaLight ?? true,
        }
      : undefined,
    collision: src.collision ?? "solid",
    ambientOcclusion: src.ambientOcclusion ?? true,
    displayName: src.displayName,
    tags: src.tags,
    thumbnail: src.thumbnail,
  };
}

/**
 * Registers + resolves preset libraries from a pack's manifest.
 *
 * Usage:
 *
 *   const resolver = await PresetResolver.fromPack(pack);
 *   const data = resolver.resolveCell("brick.wall");
 *
 * The resolver is immutable after construction. Build errors are
 * collected on `.errors` rather than thrown so the engine can render
 * the full list to the user.
 */
export class PresetResolver {
  /** Every preset by id. Frozen after construction. */
  readonly presets: ReadonlyMap<string, Preset>;
  /** Diagnostics gathered during load. Empty = clean. */
  readonly errors: ReadonlyArray<PresetError>;
  /** Reverse map for renderer integration: texture path → first tile id seen. */
  private readonly textureToTileId: ReadonlyMap<string, number>;

  private constructor(
    presets: ReadonlyMap<string, Preset>,
    errors: ReadonlyArray<PresetError>,
    textureToTileId: ReadonlyMap<string, number>,
  ) {
    this.presets = presets;
    this.errors = errors;
    this.textureToTileId = textureToTileId;
  }

  /**
   * Build a resolver from a pack's manifest. Loads every file listed in
   * `manifest.tilePresets[]`, synthesises legacy presets for any entries
   * in `manifest.tileTextures`, then resolves `extends` chains and
   * applies defaults.
   *
   * `loadText(path)` reads a UTF-8 text file at the given pack-relative
   * path. AssetPack subclasses pass their own `textBody`.
   */
  static async build(
    manifest: PackManifest,
    packId: string,
    loadText: (path: string) => Promise<string>,
  ): Promise<PresetResolver> {
    const errors: PresetError[] = [];
    // Raw (post-parse, pre-extends) entries keyed by id.
    type Entry = { source: PresetSource; sourcePackId: string; sourcePath: string };
    const raw = new Map<string, Entry>();

    // ── 1. Legacy compat shim — synthesise __legacy.<id> presets from
    //       manifest.tileTextures. These are always available so scenes
    //       with bare numeric tile ids continue to resolve.
    const tileTextures = manifest.tileTextures ?? {};
    for (const [idStr, path] of Object.entries(tileTextures)) {
      const id = `__legacy.${idStr}`;
      raw.set(id, {
        source: { texture: path },
        sourcePackId: packId,
        sourcePath: "manifest.tileTextures",
      });
    }

    // ── 2. Modder-authored preset libraries. Files listed later in
    //       manifest.tilePresets[] override earlier entries with the
    //       same id (last-in-pack wins per § 5.1).
    const files = manifest.tilePresets ?? [];
    for (const filePath of files) {
      let text: string;
      try {
        text = await loadText(filePath);
      } catch (err) {
        errors.push({
          packId,
          file: filePath,
          message: `failed to read preset file: ${(err as Error).message}`,
        });
        continue;
      }
      let parsed: Record<string, PresetSource>;
      try {
        const stripped = stripJsonComments(text);
        parsed = JSON.parse(stripped) as Record<string, PresetSource>;
      } catch (err) {
        errors.push({
          packId,
          file: filePath,
          message: `invalid JSONC: ${(err as Error).message}`,
        });
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        errors.push({
          packId,
          file: filePath,
          message: `expected an object at the top level (key → preset)`,
        });
        continue;
      }
      for (const [id, source] of Object.entries(parsed)) {
        if (typeof source !== "object" || source === null || Array.isArray(source)) {
          errors.push({
            packId,
            file: filePath,
            presetId: id,
            message: `preset definition must be an object`,
          });
          continue;
        }
        // Sanity-check texture-bearing fields are strings if present.
        for (const f of TEXTURE_FIELDS_REQUIRING_PATH) {
          const v = (source as Record<string, unknown>)[f];
          if (v !== undefined && typeof v !== "string") {
            errors.push({
              packId,
              file: filePath,
              presetId: id,
              message: `field "${f}" must be a string (path inside the pack)`,
            });
          }
        }
        raw.set(id, { source, sourcePackId: packId, sourcePath: filePath });
      }
    }

    // ── 3. Resolve `extends` chains and apply defaults.
    const resolved = new Map<string, Preset>();
    const resolving = new Set<string>();
    const lookupSource = (id: string): Entry | undefined => raw.get(id);

    function resolveSource(id: string, chain: string[]): PresetSource | null {
      const entry = lookupSource(id);
      if (!entry) {
        errors.push({
          packId,
          file: chain[0] ? "(extends chain)" : "(unknown)",
          presetId: id,
          message: `preset references unknown id "${id}"`,
        });
        return null;
      }
      if (chain.length >= MAX_EXTENDS_DEPTH) {
        errors.push({
          packId,
          file: entry.sourcePath,
          presetId: id,
          message: `extends chain exceeds depth ${MAX_EXTENDS_DEPTH} — likely a structural mistake`,
        });
        return null;
      }
      if (chain.includes(id)) {
        errors.push({
          packId,
          file: entry.sourcePath,
          presetId: id,
          message: `extends cycle: ${[...chain, id].join(" -> ")}`,
        });
        return null;
      }
      const src = entry.source;
      if (!src.extends) {
        // Drop the extends key when flattening so it doesn't reappear
        // in the merged data.
        const { extends: _, ...rest } = src;
        return rest;
      }
      const parent = resolveSource(src.extends, [...chain, id]);
      if (!parent) return null;
      const { extends: _drop, ...childOwn } = src;
      // Shallow merge — child fields win whole-field. emissive +
      // partialWall sub-objects are taken whole from whichever side
      // provided them last (per § 7.1).
      return { ...parent, ...childOwn };
    }

    for (const [id, entry] of raw) {
      if (resolved.has(id)) continue;
      if (resolving.has(id)) continue;
      resolving.add(id);
      const flat = resolveSource(id, []);
      resolving.delete(id);
      if (!flat) continue;
      if (typeof flat.texture !== "string" || flat.texture.length === 0) {
        errors.push({
          packId,
          file: entry.sourcePath,
          presetId: id,
          message: `preset is missing required field "texture" (and no \`extends\` provides one)`,
        });
        continue;
      }
      resolved.set(id, {
        id,
        data: Object.freeze(withDefaults(flat)),
        sourcePackId: entry.sourcePackId,
        sourcePath: entry.sourcePath,
      });
    }

    // ── 4. Build the texture-path → tile-id reverse map so the Scene
    //       loader can bridge from a resolved preset back to the
    //       renderer's tile-id world.
    const textureToTileId = new Map<string, number>();
    for (const [idStr, path] of Object.entries(tileTextures)) {
      const tileId = Number(idStr);
      if (!Number.isFinite(tileId)) continue;
      // First-id-wins — keeps results deterministic when two manifest
      // entries point at the same image (rare but legal).
      if (!textureToTileId.has(path)) textureToTileId.set(path, tileId);
    }

    return new PresetResolver(resolved, errors, textureToTileId);
  }

  /** Convenience lookup. Returns `undefined` for unknown ids. */
  get(id: string): Preset | undefined {
    return this.presets.get(id);
  }

  /**
   * Resolve a preset id to its flat data record, or `null` for `null`/
   * unknown input. Used by `Scene.fromJSON` when a grid carries an
   * `idMap` reference.
   */
  resolveCell(presetId: string | null | undefined): ResolvedPresetData | null {
    if (presetId === null || presetId === undefined) return null;
    return this.presets.get(presetId)?.data ?? null;
  }

  /**
   * Return the integer tile id that backs `texture` in
   * `manifest.tileTextures`, or `undefined` if the path isn't a
   * registered tile texture. Used by the Scene loader to convert a
   * resolved preset's `texture` path into the renderer's preferred
   * tile-id representation.
   */
  tileIdForTexture(texture: string | undefined): number | undefined {
    if (!texture) return undefined;
    return this.textureToTileId.get(texture);
  }

  /** Iterate every registered preset. */
  [Symbol.iterator](): IterableIterator<Preset> {
    return this.presets.values();
  }
}
