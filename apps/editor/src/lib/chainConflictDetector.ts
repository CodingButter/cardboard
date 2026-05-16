/**
 * Chain conflict detector for the editor's Project Settings →
 * Dependencies tab.
 *
 * Pure-logic, DOM-free. Walks a resolved pack chain (in the order
 * `ChainResolver.resolveChain` returns: dependencies-first, root last)
 * and reports every overlap that would cause one pack's contribution
 * to be silently overridden by a later one. Per `docs/plans/PACK_CHAIN.md`
 * §5 the resolution itself is well-defined (last-loaded wins); this
 * module exists to make that resolution VISIBLE so modders can choose
 * intentionally instead of finding out at runtime.
 *
 * Conflict surface (matches `Conflict.kind`):
 *
 *   - "asset-path"        — two packs ship the same file path.
 *   - "manifest-sprite"   — same `manifest.sprites[X]` id.
 *   - "manifest-item"     — same `manifest.items[X]` id.
 *   - "manifest-prefab"   — same `manifest.prefabs[X]` id.
 *   - "manifest-sound"    — same `manifest.sounds[X]` id.
 *   - "tile-preset"       — same preset id, defined in JSONC files
 *                           listed under `manifest.tilePresets[]`
 *                           by two packs (or two `__legacy.<id>`
 *                           entries from `manifest.tileTextures`).
 *   - "shader-material"   — same post-pass `name` in
 *                           `manifest.shaders.postPasses[]` — these
 *                           are pack-author-named materials per the
 *                           PostPassDef schema.
 *   - "manifest-script"   — same script path declared in
 *                           `manifest.scripts[]` by two packs.
 *
 * Algorithm:
 *
 *   1. Walk `chain` in order.
 *   2. For each pack, enumerate every identifier that another pack
 *      could collide with (asset paths from `listPaths()`, manifest
 *      namespace keys, preset ids inside referenced JSONC files).
 *   3. Maintain `Map<kind+identifier, owner>`. When a later pack
 *      declares the same identifier, emit a `Conflict` (current
 *      owner becomes the loser; new pack becomes the winner) and
 *      promote the new pack to owner. Subsequent declarations push
 *      the previous owner into `losers[]` and so on.
 *   4. The `manifest.json` path is special-cased — every pack ships
 *      one and that is NOT a conflict.
 *
 * The detector accepts a `chain` of `{ url, pack }` so the UI can
 * report conflicts back against the same URL the modder pinned in
 * `manifest.requires[]` (the underlying `AssetPack.manifest.id` may
 * not match).
 */

import type { AssetPack } from "@two_5_d/engine";
import { stripJsonComments } from "@two_5_d/engine";

/** One declared collision between two packs in the resolved chain. */
export interface Conflict {
  kind:
    | "asset-path"
    | "manifest-sprite"
    | "manifest-item"
    | "manifest-prefab"
    | "manifest-sound"
    | "tile-preset"
    | "shader-material"
    | "manifest-script";
  /**
   * Path / id that collides. For `kind: "asset-path"` this is the
   * raw pack-relative path (`images/textures/brick.png`). For
   * manifest namespaces it's the bare key (`zombie`). For tile
   * presets it includes the source file for context
   * (`presets/walls.jsonc:brick.wall`).
   */
  identifier: string;
  /** URL of the pack that wins (i.e. is later in the chain). */
  winner: string;
  /**
   * URLs of every pack the winner overrides, in declaration order.
   * Usually one entry; longer when more than two packs collide on
   * the same identifier.
   */
  losers: string[];
  /** Human-readable extra info (preset file, etc.). Optional. */
  details?: string;
}

export interface ConflictReport {
  conflicts: Conflict[];
  /**
   * Dep URL → number of conflicts the dep is involved in. Counts the
   * row whether the dep wins or loses — both signals matter to the
   * modder ("am I being overridden? am I overriding someone?").
   */
  countsByDep: Map<string, number>;
}

/** One entry in the chain — the pack and the URL the editor pinned it under. */
export interface ChainEntry {
  url: string;
  pack: AssetPack;
}

/**
 * Walk a resolved chain in order and produce a `ConflictReport`.
 *
 * The chain is consumed in the same order `ChainResolver.resolveChain`
 * returns — dependencies first, root last. "Later in the chain wins"
 * per PACK_CHAIN.md §5.
 */
export async function detectConflicts(
  chain: ReadonlyArray<ChainEntry>,
): Promise<ConflictReport> {
  // identifier key (kind + path) → currently-owning URL.
  const owners = new Map<string, { url: string; details?: string }>();
  // identifier key → accumulated Conflict row (so a third collider
  // appends to `losers[]` instead of producing a fresh row).
  const conflicts = new Map<string, Conflict>();

  const bump = (
    kind: Conflict["kind"],
    identifier: string,
    packUrl: string,
    details?: string,
  ) => {
    const key = `${kind}|${identifier}`;
    const prior = owners.get(key);
    if (!prior) {
      owners.set(key, { url: packUrl, details });
      return;
    }
    if (prior.url === packUrl) {
      // Same pack declares the id twice (e.g. two `__legacy.<id>`
      // synthesised by the resolver from a single manifest). Not a
      // cross-pack conflict — ignore.
      return;
    }
    // Append (or create) the conflict row. The newer pack becomes
    // the winner; the prior owner is recorded as a loser and the
    // new pack takes over for any subsequent collisions.
    let row = conflicts.get(key);
    if (!row) {
      row = {
        kind,
        identifier,
        winner: packUrl,
        losers: [prior.url],
      };
      if (details ?? prior.details) {
        row.details = details ?? prior.details;
      }
      conflicts.set(key, row);
    } else {
      // Promote the previously-winning pack into the losers stack.
      row.losers.push(row.winner);
      row.winner = packUrl;
      if (details && !row.details) row.details = details;
    }
    owners.set(key, { url: packUrl, details });
  };

  for (const entry of chain) {
    const { url, pack } = entry;
    const manifest = pack.manifest as unknown as {
      sprites?: Record<string, unknown>;
      items?: Record<string, unknown>;
      prefabs?: Record<string, unknown>;
      sounds?: Record<string, unknown>;
      scripts?: string[];
      tilePresets?: string[];
      tileTextures?: Record<string | number, unknown>;
      shaders?: { postPasses?: Array<{ name: string }> };
    };

    // ── 1. Asset paths. `manifest.json` is universal — skip it. ──
    const paths = pack.listPaths();
    for (const p of paths) {
      if (p === "manifest.json") continue;
      bump("asset-path", p, url);
    }

    // ── 2. Manifest sprites / items / prefabs / sounds. ──
    for (const id of Object.keys(manifest.sprites ?? {})) {
      bump("manifest-sprite", id, url);
    }
    for (const id of Object.keys(manifest.items ?? {})) {
      bump("manifest-item", id, url);
    }
    for (const id of Object.keys(manifest.prefabs ?? {})) {
      bump("manifest-prefab", id, url);
    }
    for (const id of Object.keys(manifest.sounds ?? {})) {
      bump("manifest-sound", id, url);
    }

    // ── 3. Manifest scripts — order-significant but collisions on
    //      the same path across packs still warrant a flag (one will
    //      double-run, or one's source will be served from the wrong
    //      pack via the asset-path collision above; reporting both
    //      makes the relationship obvious). ──
    for (const p of manifest.scripts ?? []) {
      bump("manifest-script", p, url);
    }

    // ── 4. Tile presets. Two surfaces:
    //
    //      a) JSONC files under `manifest.tilePresets[]`. Each file
    //         is `{ "preset.id": <source> }`; parse + extract keys.
    //         Conflicts are keyed by preset id, with the file path
    //         attached as `details` for the UI.
    //      b) Legacy `manifest.tileTextures[<tileId>]` entries are
    //         synthesised into `__legacy.<tileId>` presets at runtime
    //         (per `PresetResolver`); two packs both shipping the
    //         same numeric tile id would clobber each other the same
    //         way. ──
    for (const file of manifest.tilePresets ?? []) {
      // Don't fail the whole report on one bad file — packs that
      // fail to parse will surface elsewhere. Skip silently here.
      if (!pack.has(file)) continue;
      let text: string;
      try {
        text = await pack.textBody(file);
      } catch {
        continue;
      }
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (!parsed || typeof parsed !== "object") continue;
      for (const presetId of Object.keys(parsed)) {
        bump("tile-preset", presetId, url, `from ${file}`);
      }
    }
    for (const tileId of Object.keys(manifest.tileTextures ?? {})) {
      bump("tile-preset", `__legacy.${tileId}`, url, "from manifest.tileTextures");
    }

    // ── 5. Shader materials (post-pass names). ──
    for (const pass of manifest.shaders?.postPasses ?? []) {
      if (pass?.name) bump("shader-material", pass.name, url);
    }
  }

  const ordered = Array.from(conflicts.values());
  // Build the per-dep count map. A pack is "involved" in a conflict
  // if it appears as the winner OR in the losers list — both sides
  // are interesting.
  const countsByDep = new Map<string, number>();
  for (const c of ordered) {
    countsByDep.set(c.winner, (countsByDep.get(c.winner) ?? 0) + 1);
    for (const l of c.losers) {
      countsByDep.set(l, (countsByDep.get(l) ?? 0) + 1);
    }
  }

  return { conflicts: ordered, countsByDep };
}
