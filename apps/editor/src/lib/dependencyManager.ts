/**
 * Pure-logic helpers for the Project Settings → Dependencies tab.
 *
 * The dependency manager UI (in `ProjectSettingsModal.tsx`) is a thin
 * React shell on top of this file: the modal renders rows, the user
 * clicks "+ Add" / "Refresh" / "Remove" / drag-to-reorder / toggle,
 * and the shell delegates to one of the pure functions here. Pulling
 * the logic out into a DOM-free module lets the smoke test
 * (`scripts/smoke-project-settings.ts`) exercise every code path
 * without standing up jsdom or playwright.
 *
 * Network shape: `fetchAndHashPack` takes a `fetch`-shaped function
 * as a parameter (default: `globalThis.fetch`). The smoke test passes
 * a stubbed implementation that returns canned bytes; the editor
 * passes the real `fetch`.
 *
 * Hash format: the editor always writes integrity as
 * `sha256-<base64>` to match what the engine's `verifyIntegrity` and
 * the export-pipeline modal already produce. Comparison is whitespace
 * + case insensitive on the algorithm prefix to tolerate hand-edited
 * manifests.
 */

import type { PackManifest, PackRequiresEntry } from "@two_5_d/engine";
import { rewriteCorsHostileUrl } from "@two_5_d/engine";

// jszip ships with `@two_5_d/engine` (it's a runtime dep of
// `ZipAssetPack`), but consuming it through the engine barrel would
// bloat the engine surface for an editor-only need. The editor's
// own package.json already lists jszip, so import it directly.
import JSZip from "jszip";

/* ────────────────────────────────────────────────────────────────
 * Hash helpers
 * ─────────────────────────────────────────────────────────────── */

/** Encode a byte buffer as base64 using the web platform's `btoa`. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Compute the SHA-256 of a byte buffer, formatted as `sha256-<base64>`. */
export async function sha256OfBytes(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("dependencyManager: WebCrypto not available");
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes as BufferSource),
  );
  return `sha256-${bytesToBase64(digest)}`;
}

/**
 * Compare two integrity strings.
 *
 * Tolerates separator variation (`sha256-…` vs `sha256:…`) and
 * whitespace, but otherwise expects identical algorithm + body. Does
 * NOT re-hash anything — pass in the strings you want to compare.
 *
 * Returns `true` when the strings are byte-equal once normalised,
 * `false` otherwise. Empty / undefined values compare equal to each
 * other and unequal to any non-empty hash.
 */
export function integrityMatches(a: string | undefined, b: string | undefined): boolean {
  const aa = (a ?? "").trim().replace(/^sha(256|384|512)[-:]/i, (_m, n) => `sha${n}-`);
  const bb = (b ?? "").trim().replace(/^sha(256|384|512)[-:]/i, (_m, n) => `sha${n}-`);
  return aa === bb;
}

/* ────────────────────────────────────────────────────────────────
 * Fetch + parse parent manifest
 * ─────────────────────────────────────────────────────────────── */

export type FetchFn = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; arrayBuffer: () => Promise<ArrayBuffer> }>;

/**
 * Fetched-pack metadata the editor needs to populate the form. The
 * `manifest` field is best-effort — if the zip doesn't ship a
 * `manifest.json` we still return the computed integrity so the user
 * can pin it. `bytes` is intentionally NOT stored — the caller hashes
 * and parses, then drops the buffer.
 */
export interface FetchedParent {
  /** Bytes (kept on the result for the caller's hashing convenience). */
  bytes: Uint8Array;
  /** `sha256-<base64>` over the fetched bytes. */
  integrity: string;
  /** Parsed `manifest.json`, or `undefined` when the zip lacks one. */
  manifest?: PackManifest;
}

/**
 * Fetch a pack `.apg`, compute its integrity, and try to parse its
 * `manifest.json`. The CORS-hostile URL rewrite from the engine
 * (`rewriteCorsHostileUrl`) is applied so GitHub `blob/` URLs
 * resolve.
 *
 * The fetch implementation is parameterised so the smoke test can
 * substitute a deterministic in-memory shim. Browser callers pass
 * `globalThis.fetch.bind(globalThis)` (the default).
 */
export async function fetchAndHashPack(
  url: string,
  opts?: { fetchImpl?: FetchFn; signal?: AbortSignal },
): Promise<FetchedParent> {
  const fetchImpl: FetchFn =
    opts?.fetchImpl ?? ((u, init) => fetch(u, init) as unknown as ReturnType<FetchFn>);
  const rewritten = rewriteCorsHostileUrl(url);
  const res = await fetchImpl(rewritten, { signal: opts?.signal });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (${res.status})`);
  }
  const buf = new Uint8Array(await res.arrayBuffer());
  const integrity = await sha256OfBytes(buf);

  let manifest: PackManifest | undefined;
  try {
    const zip = await JSZip.loadAsync(buf as unknown as ArrayBuffer);
    const manifestFile = zip.file("manifest.json");
    if (manifestFile) {
      const text = await manifestFile.async("text");
      manifest = JSON.parse(text) as PackManifest;
    }
  } catch (err) {
    // Bad zip / bad JSON: the user can still pin the integrity hash
    // by hand. Surface the parse failure on the form so they know
    // what's up but don't abort — they may be hashing a non-pack
    // artifact intentionally.
    console.warn(`dependencyManager: parent manifest parse failed —`, err);
  }

  return { bytes: buf, integrity, manifest };
}

/* ────────────────────────────────────────────────────────────────
 * Manifest requires[] mutations
 * ─────────────────────────────────────────────────────────────── */

/** Clone a manifest with a fresh `requires` array reference. */
function withRequires(
  manifest: PackManifest,
  requires: PackRequiresEntry[] | undefined,
): PackManifest {
  const out: PackManifest = { ...manifest };
  if (requires && requires.length > 0) out.requires = requires;
  else delete out.requires;
  return out;
}

/** Returns the manifest's `requires` array (always a fresh copy). */
export function listRequires(manifest: PackManifest): PackRequiresEntry[] {
  return (manifest.requires ?? []).map((r) => ({ ...r }));
}

/**
 * Append an entry to `manifest.requires[]`. Idempotent on URL — if
 * an entry with the same `url` already exists, the existing row is
 * replaced (with the new fields merged in). The chain resolver
 * dedupes by URL anyway; surfacing it earlier avoids a confusing
 * duplicate row in the UI.
 */
export function addDependency(
  manifest: PackManifest,
  entry: PackRequiresEntry,
): PackManifest {
  const cur = listRequires(manifest);
  if (entry.url) {
    const idx = cur.findIndex((r) => r.url === entry.url);
    if (idx !== -1) {
      cur[idx] = { ...cur[idx], ...entry };
      return withRequires(manifest, cur);
    }
  }
  cur.push({ ...entry });
  return withRequires(manifest, cur);
}

/** Remove the entry at index `i`. No-op when out of range. */
export function removeDependency(manifest: PackManifest, i: number): PackManifest {
  const cur = listRequires(manifest);
  if (i < 0 || i >= cur.length) return manifest;
  cur.splice(i, 1);
  return withRequires(manifest, cur);
}

/**
 * Move the entry at `from` to position `to`. Out-of-range indices
 * are clamped — caller's drag-drop handler doesn't have to bounds-
 * check. Order is significant for the chain resolver: later entries
 * in `requires[]` are dependents-of (and override) earlier ones in
 * a depth-first walk. The Dependencies UI surfaces this by labeling
 * "bottom = highest precedence."
 */
export function reorderDependency(
  manifest: PackManifest,
  from: number,
  to: number,
): PackManifest {
  const cur = listRequires(manifest);
  if (cur.length === 0) return manifest;
  const lastIdx = cur.length - 1;
  const f = Math.max(0, Math.min(lastIdx, from));
  const t = Math.max(0, Math.min(lastIdx, to));
  if (f === t) return manifest;
  const [moved] = cur.splice(f, 1);
  cur.splice(t, 0, moved!);
  return withRequires(manifest, cur);
}

/**
 * Patch a single field on the entry at `i`. The `patch` object is
 * shallow-merged onto the existing entry. Unsetting a field via
 * `{ foo: undefined }` deletes it from the entry so the manifest
 * stays clean.
 */
export function patchDependency(
  manifest: PackManifest,
  i: number,
  patch: Partial<PackRequiresEntry>,
): PackManifest {
  const cur = listRequires(manifest);
  if (i < 0 || i >= cur.length) return manifest;
  const merged: PackRequiresEntry = { ...cur[i], ...patch };
  for (const k of Object.keys(patch) as Array<keyof PackRequiresEntry>) {
    if (patch[k] === undefined) {
      delete (merged as Record<string, unknown>)[k];
    }
  }
  cur[i] = merged;
  return withRequires(manifest, cur);
}

/** Toggle the `enabled` flag on the entry at `i`. */
export function toggleDependencyEnabled(
  manifest: PackManifest,
  i: number,
  enabled: boolean,
): PackManifest {
  // `enabled === true` is the default — drop the field so the
  // manifest doesn't ship a redundant `"enabled": true` on every
  // entry. Only persist when the user explicitly disables.
  if (enabled) return patchDependency(manifest, i, { enabled: undefined });
  return patchDependency(manifest, i, { enabled: false });
}

/* ────────────────────────────────────────────────────────────────
 * Verification flow
 * ─────────────────────────────────────────────────────────────── */

/**
 * Result of comparing a user-supplied integrity hash against the
 * one computed from the fetched bytes. `kind: "match"` means the
 * user's pin is valid; `"mismatch"` carries both hashes so the
 * editor can show them side-by-side in the warn modal; `"none"`
 * means the user supplied no pin and the editor should auto-fill
 * with the computed hash.
 */
export type VerifyResult =
  | { kind: "match"; computed: string }
  | { kind: "mismatch"; computed: string; userProvided: string }
  | { kind: "none"; computed: string };

export function verifyIntegrity(
  computed: string,
  userProvided: string | undefined,
): VerifyResult {
  if (!userProvided || userProvided.trim().length === 0) {
    return { kind: "none", computed };
  }
  if (integrityMatches(computed, userProvided)) {
    return { kind: "match", computed };
  }
  return { kind: "mismatch", computed, userProvided: userProvided.trim() };
}

/* ────────────────────────────────────────────────────────────────
 * Display helpers (used by the UI)
 * ─────────────────────────────────────────────────────────────── */

/** Hostname of a URL, or the original string when it can't be parsed. */
export function hostnameOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Shorten `sha256-<long-base64>` for display (keeps the algo prefix). */
export function truncateIntegrity(integrity: string | undefined, head = 10): string {
  if (!integrity) return "";
  const m = /^(sha(?:256|384|512)[-:])(.+)$/i.exec(integrity);
  if (!m) return integrity;
  const algo = m[1]!;
  const body = m[2]!;
  if (body.length <= head + 3) return integrity;
  return `${algo}${body.slice(0, head)}…`;
}
