/**
 * Pack-chain resolver — Phase P1 of `docs/plans/PACK_CHAIN.md`.
 *
 * Given a root pack URL (and optionally an SRI integrity hash for it),
 * fetch the pack, walk its `manifest.requires[]` graph, dedupe, detect
 * cycles, and return the resolved chain in topological order
 * (dependencies first, root last).
 *
 * Scope notes for P1:
 *  - URL-pinned `requires` entries only. `{ id, version }` without a
 *    `url` is reserved for the community store (P3) and currently
 *    hard-errors with a clear "not yet implemented" message.
 *  - SRI integrity is verified when supplied; the resolver warns when
 *    a URL-only dep ships without `integrity` (§ 6.4 trust model).
 *  - Caching is in-memory + URL-keyed for the session. Two packs that
 *    reference the same dep URL share a single `ZipAssetPack`.
 *  - The resolver returns `AssetPack[]` only — override / merge
 *    semantics belong to a later phase (P2/P3). Today `main.ts` keeps
 *    using only the root pack; the chain is built to validate it
 *    resolves cleanly without changing runtime behaviour.
 */

import type { AssetPack } from "./AssetPack";
import { ZipAssetPack } from "./ZipAssetPack";
import { satisfies } from "./semver";
import type { PackRequiresEntry } from "./types";

/** Hex-encode a byte buffer (lowercase, no separator). */
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/** Base64-encode a byte buffer (using Web `btoa`, available in Bun + browsers). */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/**
 * Subresource-integrity verification. `integrity` is one of:
 *   `sha256-<base64>`
 *   `sha384-<base64>`
 *   `sha512-<base64>`
 *   `sha256:<hex>`            (engine-friendly variant)
 *
 * Either separator is accepted to keep manifest authoring forgiving.
 * Throws on mismatch with a hint that includes the computed hash so a
 * modder can paste the corrected line back into their manifest.
 */
async function verifyIntegrity(
  bytes: Uint8Array,
  integrity: string,
  source: string,
): Promise<void> {
  const m = /^(sha(?:256|384|512))[-:]([A-Za-z0-9+/=_-]+)$/.exec(integrity.trim());
  if (!m) {
    throw new Error(
      `Pack ${source}: malformed integrity string "${integrity}". ` +
        `Expected sha256-<base64> | sha256:<hex> | sha384-... | sha512-...`,
    );
  }
  const algoLabel = m[1]!.toUpperCase();
  const algo = `${algoLabel.slice(0, 3)}-${algoLabel.slice(3)}`; // "SHA-256"
  const expected = m[2]!;

  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(`Pack ${source}: integrity verification needs WebCrypto`);
  }
  const digest = new Uint8Array(await crypto.subtle.digest(algo, bytes as BufferSource));

  // Compare hex-style first when the expected matches /^[0-9a-fA-F]+$/
  // and is the right length; otherwise compare base64.
  const expectedIsHex =
    /^[0-9a-fA-F]+$/.test(expected) && expected.length === digest.length * 2;
  const actualHex = bytesToHex(digest);
  const actualB64 = bytesToBase64(digest);
  const ok = expectedIsHex
    ? expected.toLowerCase() === actualHex
    : expected === actualB64;
  if (!ok) {
    throw new Error(
      `Pack ${source}: integrity mismatch.\n` +
        `  expected: ${integrity}\n` +
        `  actual:   ${algoLabel.toLowerCase()}-${actualB64}  (hex: ${actualHex})`,
    );
  }
}

/**
 * Module-scoped cache keyed by absolute URL. Two `requires` entries
 * that point at the same URL across different packs in the chain are
 * resolved to the same `AssetPack` instance — and the `.apg` is only
 * fetched + unzipped once per session. § 4.5 of PACK_CHAIN.md.
 */
const cache = new Map<string, Promise<AssetPack>>();

/** Drop every cached pack. Exposed so tests can reset between runs. */
export function clearChainCache(): void {
  cache.clear();
}

/** Fetch + verify + decode a pack, caching by URL. */
async function fetchPack(url: string, integrity?: string): Promise<AssetPack> {
  const cached = cache.get(url);
  if (cached) return cached;

  const promise = (async () => {
    const { rewriteCorsHostileUrl } = await import("./rewriteUrl");
    const fetchUrl = rewriteCorsHostileUrl(url);
    const res = await fetch(fetchUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch pack ${url} (${res.status})`);
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (integrity) {
      await verifyIntegrity(buf, integrity, url);
    }
    return ZipAssetPack.loadFromBytes(buf, url);
  })();

  cache.set(url, promise);
  // If the load fails, evict so a retry doesn't return the bad promise
  // forever.
  promise.catch(() => cache.delete(url));
  return promise;
}

/**
 * Validate a single `requires[]` entry well enough to fetch it. § 5
 * defines the two shapes; only the URL-pinned form is implemented in
 * P1 — store-resolved entries (`{ id, version }` without `url`) throw
 * with a clear "not yet implemented" message so a modder doesn't get
 * a confusing 404.
 */
function urlForRequires(entry: PackRequiresEntry, dependentSource: string): string {
  if (entry.url && entry.url.length > 0) {
    if (!entry.integrity) {
      // § 6.4 — warn loudly but don't abort. The community store will
      // attach integrity automatically (P3); raw URL deps without
      // integrity are a developer's choice and need to keep working
      // for `file://` smoke tests + same-origin packs.
      console.warn(
        `[chain] ${dependentSource} requires ${entry.url} without an integrity hash. ` +
          `URL deps should pin "integrity": "sha256-…" to defend against host swap.`,
      );
    }
    return entry.url;
  }
  // Store-resolved path — deferred to P3.
  const idLabel = entry.id ? `"${entry.id}"` : "(no id)";
  throw new Error(
    `Pack ${dependentSource} requires ${idLabel}: store-backed resolution ` +
      `is not yet implemented. Provide a "url" field on the requires entry, or ` +
      `wait for P3 (community store) of PACK_CHAIN.md.`,
  );
}

interface QueueEntry {
  url: string;
  integrity?: string;
  /**
   * Semver range from the introducing `requires[]` entry. Checked
   * against the parent pack's `manifest.version` immediately after
   * `fetchPack()` returns — see § 4 of PACK_CHAIN.md. `undefined`
   * means no constraint (back-compat with manifests authored before
   * `requires[].version` was enforced).
   */
  versionRange?: string;
  /** Source label of the manifest that introduced this entry (for errors). */
  introducedBy: string;
}

/**
 * Walk a root pack's dependency graph and return the resolved chain in
 * topological order — dependencies before dependents, root last.
 *
 * Algorithm (§ 4 of PACK_CHAIN.md):
 *   1. Fetch root → verify integrity → parse manifest.
 *   2. Push every ENABLED `manifest.requires[]` entry onto a queue.
 *      Entries with `enabled === false` are skipped at the top of the
 *      discover loop — they are NOT fetched, NOT added to the visited
 *      set, and NOT pushed onto the queue. Disabled deps behave as if
 *      they were missing from `requires[]`. The editor's Project
 *      Settings → Dependencies tab toggles this flag so an author can
 *      pin a dep but switch it off without removing the row.
 *   3. For each queue entry: fetch + verify + parse; dedupe by URL;
 *      recurse into its `requires`.
 *   4. Topological sort with a DFS cycle check. Hard error on cycle.
 *   5. Return the ordered list; root is the LAST element.
 *
 * @param rootUrl       Absolute URL (http(s)://, file://, /relative).
 * @param rootIntegrity Optional SRI hash for the root pack itself.
 */
export async function resolveChain(
  rootUrl: string,
  rootIntegrity?: string,
): Promise<AssetPack[]> {
  // url → AssetPack. Acts both as visited-set and pack store.
  const packs = new Map<string, AssetPack>();
  // url → list of dep urls (build the DAG so we can topo-sort).
  const deps = new Map<string, string[]>();

  const queue: QueueEntry[] = [{ url: rootUrl, integrity: rootIntegrity, introducedBy: "<root>" }];

  while (queue.length > 0) {
    const { url, integrity, versionRange, introducedBy } = queue.shift()!;
    if (packs.has(url)) continue;

    let pack: AssetPack;
    try {
      pack = await fetchPack(url, integrity);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      throw new Error(`Resolving pack chain (introduced by ${introducedBy}): ${msg}`);
    }

    // Version-range enforcement — § 4 of PACK_CHAIN.md. Runs AFTER
    // `fetchPack()` (so integrity has already been verified) and BEFORE
    // the pack is registered in the topo graph. A mismatch hard-fails
    // with a message shaped like the integrity error so pack-builder
    // and editor surfaces both render it the same way. `undefined` /
    // empty `versionRange` short-circuits inside `satisfies()` for
    // back-compat with manifests authored before this check existed.
    if (versionRange !== undefined && versionRange !== "") {
      const parentVersion = pack.manifest.version;
      if (!satisfies(parentVersion, versionRange)) {
        throw new Error(
          `Pack ${url}: version mismatch. ` +
            `Required: ${versionRange}. Found: ${parentVersion}.\n` +
            `Update your requires[].version to match, or pin a different pack URL.`,
        );
      }
    }

    packs.set(url, pack);

    const requires = pack.manifest.requires ?? [];
    const depUrls: string[] = [];
    for (const entry of requires) {
      // Editor-side disable: skip the entry entirely. The disabled
      // dep is NOT fetched, NOT pushed into the queue, and NOT
      // recorded as a dep edge for topo sort — runtime behaviour is
      // identical to the entry not being declared at all.
      if (entry.enabled === false) continue;
      const depUrl = urlForRequires(entry, url);
      depUrls.push(depUrl);
      if (!packs.has(depUrl)) {
        queue.push({
          url: depUrl,
          integrity: entry.integrity,
          versionRange: entry.version,
          introducedBy: url,
        });
      }
    }
    deps.set(url, depUrls);
  }

  // Topological sort via DFS with grey/black coloring for cycle
  // detection. Iterative to avoid stack blowups on pathological chains.
  const ORDER: string[] = [];
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const color = new Map<string, number>();
  for (const url of packs.keys()) color.set(url, WHITE);

  const visit = (start: string): void => {
    // (url, depIndex) frames.
    const stack: Array<[string, number]> = [[start, 0]];
    color.set(start, GREY);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const [url, idx] = top;
      const ds = deps.get(url) ?? [];
      if (idx >= ds.length) {
        color.set(url, BLACK);
        ORDER.push(url);
        stack.pop();
        continue;
      }
      top[1] = idx + 1;
      const next = ds[idx]!;
      const c = color.get(next) ?? WHITE;
      if (c === GREY) {
        // Cycle. Reconstruct path through the stack for a useful error.
        const cyclePath = stack.map(([u]) => u).concat(next);
        throw new Error(
          `Pack chain has a dependency cycle: ${cyclePath.join(" → ")}`,
        );
      }
      if (c === WHITE) {
        color.set(next, GREY);
        stack.push([next, 0]);
      }
    }
  };

  // Root first so the resulting topological order puts the root last
  // (DFS post-order from the root visits leaves first).
  visit(rootUrl);
  // Any pack reachable but not yet visited via the root — shouldn't
  // happen given BFS above seeds from root, but be defensive.
  for (const url of packs.keys()) {
    if ((color.get(url) ?? WHITE) === WHITE) visit(url);
  }

  return ORDER.map((u) => {
    const p = packs.get(u);
    if (!p) throw new Error(`Internal: missing pack for ${u}`);
    return p;
  });
}
