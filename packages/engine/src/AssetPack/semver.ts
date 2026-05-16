/**
 * Tiny semver matcher for PACK_CHAIN `requires[].version` enforcement.
 *
 * Implements the subset of npm-style semver the chain resolver actually
 * needs today (PACK_CHAIN.md §4 — version pinning). Deliberately tiny so
 * the engine doesn't pull a dependency just to compare three integers.
 *
 * Supported range syntax:
 *  - Exact:  `"1.2.3"`           → version must equal `1.2.3` exactly.
 *  - Caret:  `"^1.2.3"`          → `>=1.2.3 <2.0.0` (compatible-with).
 *  - Tilde:  `"~1.2.3"`          → `>=1.2.3 <1.3.0` (minor-locked).
 *  - Empty / undefined           → no constraint, anything matches.
 *
 * DEFERRED to a v2 enhancement:
 *  - Compound ranges (`">=1.0.0 <2"`, `"1.2 || 2.0"`).
 *  - Prerelease + build metadata (`"1.2.3-alpha.1"`, `"1.2.3+build.7"`).
 *  - `x`/`*` wildcards (`"1.2.x"`, `"*"`).
 *  - Hyphen ranges (`"1.0.0 - 2.0.0"`).
 *
 * Throws `Error` on malformed version or range strings so a typo in a
 * manifest surfaces as a hard fail at chain-resolve time rather than a
 * silent always-false match.
 */

/** Strict `major.minor.patch` — no prereleases, no build metadata (v2). */
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(s: string, label: string): ParsedVersion {
  const m = VERSION_RE.exec(s.trim());
  if (!m) {
    throw new Error(
      `semver: malformed ${label} "${s}". Expected "<major>.<minor>.<patch>" ` +
        `(prereleases / build metadata are not yet supported — see semver.ts).`,
    );
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/** Lex-compare two parsed versions. Returns -1 / 0 / 1. */
function cmp(a: ParsedVersion, b: ParsedVersion): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * `true` iff `version` satisfies `range` per the supported subset above.
 *
 * Examples:
 *   satisfies("1.2.3", "1.2.3")       → true
 *   satisfies("1.2.4", "1.2.3")       → false   (exact)
 *   satisfies("1.2.4", "^1.2.3")      → true    (caret)
 *   satisfies("2.0.0", "^1.2.3")      → false   (caret upper bound)
 *   satisfies("1.2.5", "~1.2.3")      → true    (tilde)
 *   satisfies("1.3.0", "~1.2.3")      → false   (tilde upper bound)
 *   satisfies("9.9.9", undefined)     → true    (no constraint)
 *   satisfies("9.9.9", "")            → true    (no constraint)
 */
export function satisfies(version: string, range: string | undefined): boolean {
  if (range === undefined || range.trim() === "") return true;

  const trimmed = range.trim();
  const v = parseVersion(version, "version");

  if (trimmed.startsWith("^")) {
    const base = parseVersion(trimmed.slice(1), "caret range");
    // `>=base <next-major`. Special-case 0.x: caret semantics in npm treat
    // 0.y.z as locking the minor, but PACK_CHAIN authoring favours the
    // simpler model — keep it major-locked for clarity (a v2 enhancement
    // can refine this if the community store finds a real misuse case).
    const upperMajor: ParsedVersion = { major: base.major + 1, minor: 0, patch: 0 };
    return cmp(v, base) >= 0 && cmp(v, upperMajor) < 0;
  }

  if (trimmed.startsWith("~")) {
    const base = parseVersion(trimmed.slice(1), "tilde range");
    // `>=base <next-minor`.
    const upperMinor: ParsedVersion = {
      major: base.major,
      minor: base.minor + 1,
      patch: 0,
    };
    return cmp(v, base) >= 0 && cmp(v, upperMinor) < 0;
  }

  // Exact pin.
  const exact = parseVersion(trimmed, "exact range");
  return cmp(v, exact) === 0;
}
