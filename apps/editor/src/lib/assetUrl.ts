/**
 * Build-aware asset URL helper for the editor.
 *
 * The editor runs in three configurations that differ in their URL
 * prefix:
 *
 *   1. Editor dev server (`bun --hot server.ts`) on port 3001
 *      → origin root, no prefix. `/packs/...` works directly because
 *      the dev server proxies `/packs/*` to the game's pack directory.
 *
 *   2. Static build served standalone (e.g. `bunx serve dist`)
 *      → origin root, no prefix.
 *
 *   3. GitHub Pages at `https://codingbutter.github.io/cardboard/`
 *      → all assets live under `/cardboard/`. Anything that fetches
 *      a root-absolute `/packs/...` ends up at `github.io/packs/...`
 *      which 404s.
 *
 * Strategy: derive a `BASE` prefix once at module load, then route
 * every editor-side absolute-path asset reference through `assetUrl`
 * so it inherits the prefix automatically.
 *
 * The base is discovered at runtime rather than from a build flag so
 * the same bundle works in all three configurations without rebuild:
 *
 *   - If `<base href>` is set on the document, honour that.
 *   - Else if the current `location.pathname` starts with a known
 *     deploy subpath (`/cardboard/`), use it.
 *   - Else fall back to the origin root (`/`).
 *
 * Build-time override is also available via `import.meta.env.BASE_URL`
 * (bun inlines this when the env var is set during build), used by
 * the Pages workflow to lock the prefix to `/cardboard/`.
 */

// Bun's import.meta.env shape isn't typed by default; widen it here.
interface MetaEnv {
  BASE_URL?: string;
}

function detectBase(): string {
  // 1. Explicit build-time override.
  const envBase = (import.meta as unknown as { env?: MetaEnv }).env?.BASE_URL;
  if (envBase) return normalize(envBase);

  if (typeof document === "undefined" || typeof window === "undefined") {
    return "/";
  }

  // 2. <base href> on the document, if any.
  const baseEl = document.querySelector("base[href]") as HTMLBaseElement | null;
  if (baseEl?.href) {
    try {
      const u = new URL(baseEl.href);
      return normalize(u.pathname);
    } catch {
      /* fall through */
    }
  }

  // 3. Subpath inference. GitHub Pages serves us at /<repo>/, so if the
  // current document URL starts with a known deploy prefix, use it.
  // `/cardboard/` is the only one today; extend this list if the repo
  // is ever forked or renamed.
  const KNOWN_DEPLOY_PREFIXES = ["/cardboard/"];
  for (const prefix of KNOWN_DEPLOY_PREFIXES) {
    if (window.location.pathname.startsWith(prefix)) return prefix;
  }

  return "/";
}

function normalize(p: string): string {
  if (!p) return "/";
  let out = p;
  if (!out.startsWith("/")) out = `/${out}`;
  if (!out.endsWith("/")) out = `${out}/`;
  return out;
}

/** Trailing-slash-free, leading-slash-having base. */
export const BASE_URL = detectBase();

/**
 * Resolve a root-absolute asset path (e.g. `/packs/Cardboard.apg`) to
 * a URL that works under the current deploy. Relative inputs are
 * returned unchanged on the assumption the caller knows what they
 * want.
 */
export function assetUrl(path: string): string {
  if (!path) return BASE_URL;
  // Pass through fully-qualified URLs untouched.
  if (/^[a-z]+:\/\//i.test(path)) return path;
  if (path.startsWith("//")) return path;
  // Non-absolute paths are left alone — the caller is opting in to
  // relative resolution against the current document.
  if (!path.startsWith("/")) return path;
  return `${BASE_URL.replace(/\/$/, "")}${path}`;
}
