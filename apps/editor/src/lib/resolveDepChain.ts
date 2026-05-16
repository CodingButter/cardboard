/**
 * Editor-side helper that turns a list of `manifest.requires[]`
 * entries into a fully-resolved `AssetPack[]` chain — without
 * needing the current project to be a URL-addressable pack itself.
 *
 * The engine's `ChainResolver.resolveChain(rootUrl)` walks the
 * `requires[]` graph starting from a root URL. The editor's project
 * lives in IndexedDB (not at a URL), but its `manifest.requires[]`
 * still refers to URL-pinned parents — so we resolve each ENABLED
 * declared dep through `resolveChain`, then concatenate the resulting
 * sub-chains in declaration order with URL-keyed dedupe.
 *
 * Order matters: per `docs/plans/PACK_CHAIN.md` §4 + §5 the chain is
 * "dependencies first, dependent last." Concatenating each dep's
 * resolved sub-chain in declaration order produces the same ordering
 * the runtime resolver would build for the project's full chain
 * (modulo the project itself, which the editor doesn't include —
 * conflicts AMONG the project's deps are what we surface here, not
 * conflicts between the deps and the project's own assets).
 *
 * Caching: `ChainResolver` already caches by URL, so two deps that
 * share an upstream parent both find that parent in the cache and
 * dedupe correctly. We do an additional URL-set dedupe at the
 * concatenation layer so the second sub-chain doesn't re-list a
 * pack that already appeared in an earlier sub-chain.
 */

import {
  resolveChain,
  type AssetPack,
  type PackRequiresEntry,
} from "@two_5_d/engine";
import type { ChainEntry } from "./chainConflictDetector";

export interface ResolveDepChainResult {
  /** Ordered chain: every reachable pack, dependencies-first. */
  chain: ChainEntry[];
  /** Errors encountered resolving individual deps (URL → message). */
  errors: Array<{ url: string; message: string }>;
}

/**
 * Walk every ENABLED entry in `requires[]`, resolve each through
 * the engine's chain resolver, and concatenate the results into a
 * single deduped chain.
 *
 * Disabled entries (`entry.enabled === false`) are skipped — same
 * semantics the engine's runtime resolver uses (§4 of PACK_CHAIN.md).
 *
 * One bad dep (404, integrity mismatch, version mismatch, …) doesn't
 * abort the whole walk — the error is recorded against that dep's
 * URL and the other deps continue resolving. The conflict detector
 * can still produce a partial report.
 */
export async function resolveDepChain(
  requires: ReadonlyArray<PackRequiresEntry>,
): Promise<ResolveDepChainResult> {
  const out: ChainEntry[] = [];
  const seen = new Set<string>();
  const errors: Array<{ url: string; message: string }> = [];

  for (const entry of requires) {
    if (entry.enabled === false) continue;
    if (!entry.url) continue;
    let sub: AssetPack[];
    try {
      sub = await resolveChain(entry.url, entry.integrity);
    } catch (err) {
      errors.push({ url: entry.url, message: (err as Error).message });
      continue;
    }
    // The sub-chain is dependencies-first; the last element is the
    // dep we asked for. Walk in order, skipping anything already in
    // `out` so earlier-declared deps keep their position.
    for (const pack of sub) {
      // Recover the URL the pack came from. `ChainResolver` doesn't
      // surface that today — the cleanest signal we have is to use
      // the `entry.url` for the final element (the dep itself) and
      // a synthetic `pack:<id>@<version>` label for transitively-
      // resolved parents. The conflict report's UI uses these
      // labels for "WINS over X / LOST to Y" rows, so they need to
      // be unique per-pack but don't have to round-trip back to a
      // user-pinned URL.
      const isDeclaredDep = pack === sub[sub.length - 1];
      const id =
        (pack.manifest as { id?: string }).id ??
        pack.manifest.name ??
        "(unnamed)";
      const label = isDeclaredDep
        ? entry.url
        : `pack:${id}@${pack.manifest.version ?? "?"}`;
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({ url: label, pack });
    }
  }

  return { chain: out, errors };
}
