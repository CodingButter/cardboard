import JSZip from "jszip";
import type { PackManifest } from "@two_5_d/engine";
import {
  EditorProjectStore,
  isTextPath,
  type ProjectMeta,
} from "./EditorProjectStore";

/**
 * Import pipeline for `.apg` packs. One write path, two entry points:
 *
 *  - `importPackFromBlob(blob, opts)` — §9.1 local-file import.
 *  - `importPackFromUrl(url, opts)`   — §9.4 untrusted-URL import.
 *
 * Both end up calling `writeUnzippedToStore` so the IDB layout is
 * identical regardless of source. Provenance for URL imports is
 * stamped onto `ProjectMeta.forkedFrom` (EDITOR.md §9.4).
 */

export interface ImportResult {
  /** The new project's stored metadata row. */
  project: ProjectMeta;
  /** Number of asset rows written (excluding the manifest). */
  assetCount: number;
  /** SHA-256 of the original bytes, hex-encoded — surfaced for URL imports. */
  hashHex?: string;
}

interface BlobImportOpts {
  /** Optional project name override; defaults to the manifest's `name`. */
  projectName?: string;
  /** Stamps `forkedFrom` provenance on the new project meta. */
  forkedFrom?: ProjectMeta["forkedFrom"];
}

interface UrlImportOpts extends BlobImportOpts {
  /** Optional SHA-256 (hex or `sha256-...` SRI string). Verified post-fetch. */
  expectedSha256?: string;
}

/**
 * Hex-encode a `Uint8Array`. Avoids pulling in a hex util just for
 * the integrity readout.
 */
function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

/** SHA-256 of the given bytes via SubtleCrypto. */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return toHex(new Uint8Array(digest));
}

/**
 * Accepts a SHA-256 in either bare hex or `sha256-<base64>` SRI form
 * and returns the bare-hex representation, lowercased, for compare.
 */
function normalizeSha256(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("sha256-")) {
    // Decode the base64 portion to bytes then re-hex.
    const b64 = trimmed.slice("sha256-".length);
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return toHex(bytes);
    } catch {
      throw new Error(`Invalid SHA-256 SRI string: ${input}`);
    }
  }
  // Strip an optional `0x` prefix and lowercase.
  const hex = trimmed.replace(/^0x/, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`Invalid SHA-256 hex (must be 64 chars): ${input}`);
  }
  return hex;
}

/** Decode the manifest entry from a loaded zip; throws on malformed bytes. */
async function parseManifestFromZip(zip: JSZip): Promise<PackManifest> {
  const entry = zip.file("manifest.json");
  if (!entry) throw new Error("Pack is missing manifest.json at the zip root");
  const text = await entry.async("string");
  try {
    return JSON.parse(text) as PackManifest;
  } catch (err) {
    throw new Error(`manifest.json is not valid JSON: ${(err as Error).message}`);
  }
}

/**
 * Core write path shared by §9.1 + §9.4. Given an already-loaded
 * `JSZip`, creates a new project, writes the manifest, then walks
 * every file entry and writes an asset row.
 */
async function writeUnzippedToStore(
  zip: JSZip,
  opts: BlobImportOpts,
): Promise<ImportResult> {
  const manifest = await parseManifestFromZip(zip);
  const projectName = opts.projectName ?? manifest.name ?? "Imported project";

  // Make the project. `createProject` writes a default manifest; we
  // overwrite it immediately with the imported one.
  const meta = await EditorProjectStore.createProject(projectName);
  if (opts.forkedFrom) {
    meta.forkedFrom = opts.forkedFrom;
    await EditorProjectStore.upsertProjectMeta(meta);
  }
  await EditorProjectStore.saveManifest(meta.id, manifest);

  let assetCount = 0;
  // JSZip's `forEach` gives us the in-zip path even for nested entries.
  const entries: Array<{ path: string; entry: JSZip.JSZipObject }> = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    // Skip the manifest — already written via saveManifest.
    if (path === "manifest.json") return;
    entries.push({ path, entry });
  });

  for (const { path, entry } of entries) {
    if (isTextPath(path)) {
      const text = await entry.async("string");
      await EditorProjectStore.saveAsset(meta.id, path, text);
    } else {
      const blob = await entry.async("blob");
      await EditorProjectStore.saveAsset(meta.id, path, blob);
    }
    assetCount += 1;
  }

  return { project: meta, assetCount };
}

/**
 * §9.1 — local-file import. Accepts a `File` or `Blob` (drag/drop or
 * `<input type=file>`).
 */
export async function importPackFromBlob(
  source: Blob,
  opts: BlobImportOpts = {},
): Promise<ImportResult> {
  const buffer = await source.arrayBuffer();
  const zip = await JSZip.loadAsync(buffer);
  return writeUnzippedToStore(zip, opts);
}

/**
 * §9.4 — untrusted URL import. Fetches the pack bytes, optionally
 * verifies them against `expectedSha256`, then runs the §9.1 write
 * path. Stamps `forkedFrom: { url, hash, openedAt }` on the new
 * project meta.
 *
 * NOTE: the trust-confirm dialog described in §9.4 is enforced at
 * the UI layer (HomeScreen); this function assumes the user has
 * already confirmed.
 */
export async function importPackFromUrl(
  url: string,
  opts: UrlImportOpts = {},
): Promise<ImportResult> {
  // Transparently rewrite CORS-hostile URLs (github.com/.../blob|raw/...
  // → raw.githubusercontent.com/...) before fetching. The user's
  // original URL is preserved in error messages + provenance below.
  const { rewriteCorsHostileUrl } = await import("@two_5_d/engine");
  const fetchUrl = rewriteCorsHostileUrl(url);
  let res: Response;
  try {
    res = await fetch(fetchUrl);
  } catch (err) {
    throw new Error(
      `Failed to fetch pack — ${(err as Error).message}. ` +
        `If this is a CORS error, host the pack on a server that ` +
        `sends CORS headers, or download it manually and use ` +
        `"Import .apg from file" instead.`,
    );
  }
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  const buffer = await res.arrayBuffer();
  const hashHex = await sha256Hex(buffer);

  if (opts.expectedSha256) {
    const expected = normalizeSha256(opts.expectedSha256);
    if (expected !== hashHex) {
      throw new Error(
        `SHA-256 mismatch — pack at ${url} hashed to ${hashHex.slice(0, 16)}…, ` +
          `expected ${expected.slice(0, 16)}…. Aborting import.`,
      );
    }
  }

  const zip = await JSZip.loadAsync(buffer);
  const result = await writeUnzippedToStore(zip, {
    ...opts,
    forkedFrom: {
      ...(opts.forkedFrom ?? {}),
      url,
      hash: `sha256-${hashHex}`,
      openedAt: new Date().toISOString(),
    },
  });
  return { ...result, hashHex };
}
