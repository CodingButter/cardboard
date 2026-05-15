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

/**
 * Preset-attached shader-hook bundle (M2 of MATERIALS.md §8.1).
 *
 * Mirrors the `ShaderData` shape on the `Shader` ECS component — same
 * three optional fields, same semantics — except attached to a tile
 * preset rather than an entity. Cells using a preset that carries this
 * field route their world-frag hook calls through a per-cell dispatcher
 * driven by a per-cell variant id.
 *
 * `spriteHooks` and `skyHooks` are accepted for forward-compat with the
 * ECS component schema; today the cell-material path only reads
 * `worldHooks` (cells have no sprite / sky context).
 */
export interface PresetShaderData {
  worldHooks?: string;
  spriteHooks?: string;
  skyHooks?: string;
}

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
  /**
   * Per-preset shader-hook bundle (M2 of MATERIALS.md §8). Optional.
   * Cells using this preset get a non-zero variant id at scene-load
   * and route world-frag hook calls through the variant dispatcher.
   * Sprite / sky hooks on a preset are accepted for forward-compat
   * but ignored by the cell-material pipeline.
   */
  shader?: PresetShaderData;
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
  /**
   * Per-preset shader-hook bundle. Accepts EITHER the shorthand
   * string form (`"shaders/foo.glsl"` — sugar for `{ worldHooks }`)
   * or the full block form. The resolver normalises both to the
   * block shape before exposing them. See `ResolvedPresetData.shader`.
   */
  shader?: string | PresetShaderData;
}

/** Registered preset + provenance, post-resolution. */
export interface Preset {
  readonly id: string;
  readonly data: ResolvedPresetData;
  readonly sourcePackId: string;
  readonly sourcePath: string;
}

/**
 * A structured load error — accumulated so we can report all of them.
 *
 * `keyPath` is the dotted key trail inside the offending preset
 * (e.g. `["emissive", "color"]` for a bad emissive colour). It's empty
 * for file-level errors (parse failure, missing required texture).
 * `suggestion` carries the closest valid name when an unknown field
 * matches one of the schema keys within Levenshtein distance ≤ 2 OR
 * shares a ≥ 3-char prefix.
 */
export interface PresetError {
  packId: string;
  file: string;
  presetId?: string;
  keyPath: string[];
  message: string;
  suggestion?: string;
  /** @deprecated alias of `suggestion` for older callers. */
  hint?: string;
}

/** Max `extends:` chain depth before we bail with a clear error. */
const MAX_EXTENDS_DEPTH = 8;

/* --- Schema definition ------------------------------------------------- */

/**
 * Type tags for the hand-written preset schema. Kept inline (no dep on
 * Ajv / Zod) per `docs/plans/TILE_PRESETS.md` §10 — modder-friendliness
 * means small, predictable surface area + maintainable in one file.
 */
type FieldType =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "enum"; values: ReadonlyArray<string> }
  | { kind: "stringArray" }
  | { kind: "rgbTriple" }
  | { kind: "object"; schema: SchemaShape }
  /**
   * Either a string (shorthand) OR an object matching `schema`.
   * Used by the M2 `shader` field, which authors as either
   * `shader: "shaders/wet.glsl"` (= `{ worldHooks: "..." }`) or the
   * full block form `shader: { worldHooks: "...", spriteHooks: "..." }`.
   */
  | { kind: "stringOrObject"; schema: SchemaShape };

interface SchemaShape {
  [key: string]: FieldType;
}

const PARTIAL_WALL_SCHEMA: SchemaShape = {
  face: { kind: "enum", values: ["north", "south", "east", "west"] },
  startU: { kind: "number" },
  widthU: { kind: "number" },
};

const EMISSIVE_SCHEMA: SchemaShape = {
  color: { kind: "rgbTriple" },
  intensity: { kind: "number" },
  areaLight: { kind: "boolean" },
};

/**
 * `shader` sub-object — M2 of MATERIALS.md §8.1. All three fields
 * optional; a `shader: {}` block validates clean and is a no-op
 * (every hook tier falls through to the next).
 */
const SHADER_SCHEMA: SchemaShape = {
  worldHooks: { kind: "string" },
  spriteHooks: { kind: "string" },
  skyHooks: { kind: "string" },
};

/**
 * Allowed keys + types per `docs/plans/TILE_PRESETS.md` §3.3. The
 * resolver consults this AFTER `extends` resolution + defaults; any key
 * not present here is an unknown-field error (with Levenshtein hint).
 */
const PRESET_SCHEMA: SchemaShape = {
  extends: { kind: "string" },
  texture: { kind: "string" },
  topCap: { kind: "string" },
  bottomCap: { kind: "string" },
  offsetX: { kind: "number" },
  offsetY: { kind: "number" },
  wallHeight: { kind: "number" },
  wallStartZ: { kind: "number" },
  partialWall: { kind: "object", schema: PARTIAL_WALL_SCHEMA },
  floorHeight: { kind: "number" },
  ceilingHeight: { kind: "number" },
  reflectiveness: { kind: "number" },
  transition: { kind: "number" },
  riserTexture: { kind: "string" },
  emissive: { kind: "object", schema: EMISSIVE_SCHEMA },
  collision: {
    kind: "enum",
    values: ["solid", "passable", "trigger", "blockBullets"],
  },
  ambientOcclusion: { kind: "boolean" },
  displayName: { kind: "string" },
  tags: { kind: "stringArray" },
  thumbnail: { kind: "string" },
  shader: { kind: "stringOrObject", schema: SHADER_SCHEMA },
};

/**
 * Tiny Levenshtein distance — used only for typo suggestions on
 * unknown preset keys, so the inputs are short (single field names).
 * Iterative two-row DP, ~15 LOC, no allocations beyond the row
 * buffers. Threshold: distance ≤ 2 OR a shared prefix of ≥ 3 chars
 * counts as "did you mean".
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/** Return the closest schema key to `unknown` if within suggestion range. */
function suggestKey(unknown: string, candidates: ReadonlyArray<string>): string | undefined {
  let best: string | undefined;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(unknown, c);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (best === undefined) return undefined;
  // Accept on distance OR a shared 3-char prefix (catches `textur` ↔
  // `texture` already, but covers truncated typos like `displayN` →
  // `displayName` cleanly too).
  const sharedPrefix = (() => {
    let i = 0;
    while (i < unknown.length && i < best!.length && unknown[i] === best![i]) i++;
    return i;
  })();
  if (bestDist <= 2 || sharedPrefix >= 3) return best;
  return undefined;
}

/** Same suggester, used for enum values (e.g. `slid` → `solid`). */
function suggestEnum(unknown: string, values: ReadonlyArray<string>): string | undefined {
  return suggestKey(unknown, values);
}

/**
 * Type-check one value against a `FieldType`. Returns an error string
 * suitable for `message`, or null on success.
 */
function checkType(value: unknown, type: FieldType): { ok: true } | { ok: false; message: string; suggestion?: string } {
  switch (type.kind) {
    case "string":
      if (typeof value !== "string") {
        return { ok: false, message: `expected string, got ${describeType(value)}` };
      }
      return { ok: true };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return { ok: false, message: `expected number, got ${describeType(value)}` };
      }
      return { ok: true };
    case "boolean":
      if (typeof value !== "boolean") {
        return { ok: false, message: `expected boolean, got ${describeType(value)}` };
      }
      return { ok: true };
    case "enum": {
      if (typeof value !== "string") {
        return { ok: false, message: `expected one of ${quoteList(type.values)}, got ${describeType(value)}` };
      }
      if (!type.values.includes(value)) {
        const sugg = suggestEnum(value, type.values);
        return {
          ok: false,
          message: `invalid value "${value}" — allowed: ${quoteList(type.values)}`,
          suggestion: sugg,
        };
      }
      return { ok: true };
    }
    case "stringArray":
      if (!Array.isArray(value)) {
        return { ok: false, message: `expected array of strings, got ${describeType(value)}` };
      }
      for (let i = 0; i < value.length; i++) {
        if (typeof value[i] !== "string") {
          return { ok: false, message: `expected array of strings; element [${i}] is ${describeType(value[i])}` };
        }
      }
      return { ok: true };
    case "rgbTriple":
      if (!Array.isArray(value) || value.length !== 3) {
        return { ok: false, message: `expected [r, g, b] triple, got ${describeType(value)}` };
      }
      for (let i = 0; i < 3; i++) {
        if (typeof value[i] !== "number" || !Number.isFinite(value[i])) {
          return { ok: false, message: `expected [r, g, b] triple of numbers; element [${i}] is ${describeType(value[i])}` };
        }
      }
      return { ok: true };
    case "object":
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return { ok: false, message: `expected object, got ${describeType(value)}` };
      }
      return { ok: true };
    case "stringOrObject":
      if (typeof value === "string") return { ok: true };
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {
          ok: false,
          message: `expected string or object, got ${describeType(value)}`,
        };
      }
      return { ok: true };
  }
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function quoteList(values: ReadonlyArray<string>): string {
  return values.map((v) => `"${v}"`).join(", ");
}

/**
 * Walk a source object against a schema, pushing errors for unknown
 * fields, wrong types, and bad enum values. Recurses into nested
 * objects (`partialWall`, `emissive`).
 */
function validateAgainstSchema(
  obj: Record<string, unknown>,
  schema: SchemaShape,
  ctx: {
    packId: string;
    file: string;
    presetId: string;
    keyPath: string[];
    errors: PresetError[];
  },
): void {
  const allowed = Object.keys(schema);
  for (const [key, value] of Object.entries(obj)) {
    const type = schema[key];
    if (!type) {
      const suggestion = suggestKey(key, allowed);
      ctx.errors.push({
        packId: ctx.packId,
        file: ctx.file,
        presetId: ctx.presetId,
        keyPath: [...ctx.keyPath, key],
        message: suggestion
          ? `unknown field "${key}" (did you mean "${suggestion}"?)`
          : `unknown field "${key}"`,
        suggestion,
        hint: suggestion,
      });
      continue;
    }
    if (value === undefined) continue;
    const result = checkType(value, type);
    if (!result.ok) {
      ctx.errors.push({
        packId: ctx.packId,
        file: ctx.file,
        presetId: ctx.presetId,
        keyPath: [...ctx.keyPath, key],
        message: result.message,
        suggestion: result.suggestion,
        hint: result.suggestion,
      });
      continue;
    }
    if (type.kind === "object") {
      validateAgainstSchema(value as Record<string, unknown>, type.schema, {
        ...ctx,
        keyPath: [...ctx.keyPath, key],
      });
    } else if (type.kind === "stringOrObject" && typeof value !== "string") {
      validateAgainstSchema(value as Record<string, unknown>, type.schema, {
        ...ctx,
        keyPath: [...ctx.keyPath, key],
      });
    }
  }
}

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
    // `shader` is normalised from either shorthand string form
    // (`shader: "shaders/wet.glsl"` → `{ worldHooks: "shaders/wet.glsl" }`)
    // or the block form. The shallow `extends` merge below already
    // handles inheritance: a child setting `shader` whole-field
    // overrides the parent's `shader` whole-field, matching the
    // documented §7.1-style "child wins per-field" semantic. An
    // empty child shader (`shader: {}`) is allowed and behaves as
    // no override.
    shader: normaliseShader(src.shader),
  };
}

/**
 * Normalise a preset's `shader` field. Accepts the shorthand string
 * form (sugar for `worldHooks`) and returns the canonical block
 * `PresetShaderData` shape; the block form passes through verbatim.
 * `undefined` stays `undefined`.
 */
function normaliseShader(
  raw: PresetSource["shader"] | string | undefined,
): PresetShaderData | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw === "string") return { worldHooks: raw };
  return raw;
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
          keyPath: [],
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
          keyPath: [],
          message: `invalid JSONC: ${(err as Error).message}`,
        });
        continue;
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        errors.push({
          packId,
          file: filePath,
          keyPath: [],
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
            keyPath: [],
            message: `preset definition must be an object`,
          });
          continue;
        }
        // Full schema validation — unknown fields, wrong types, bad
        // enum values, nested partialWall / emissive checked too.
        // §13 of TILE_PRESETS.md (T3 phase) — surfaces with Levenshtein
        // typo suggestions where appropriate.
        validateAgainstSchema(source as Record<string, unknown>, PRESET_SCHEMA, {
          packId,
          file: filePath,
          presetId: id,
          keyPath: [],
          errors,
        });
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
          keyPath: ["extends"],
          message: `preset references unknown id "${id}"`,
        });
        return null;
      }
      if (chain.length >= MAX_EXTENDS_DEPTH) {
        errors.push({
          packId,
          file: entry.sourcePath,
          presetId: id,
          keyPath: ["extends"],
          message: `extends chain exceeds depth ${MAX_EXTENDS_DEPTH} — likely a structural mistake`,
        });
        return null;
      }
      if (chain.includes(id)) {
        errors.push({
          packId,
          file: entry.sourcePath,
          presetId: id,
          keyPath: ["extends"],
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
          keyPath: ["texture"],
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
