/**
 * Pack-supplied hook-function parser + prelude substitutor (R4 / Phase
 * S3). Source-of-truth: `docs/plans/ENGINE_PACK_SHADERS.md` §8.3.
 *
 * Two responsibilities:
 *
 *  - `parseHookOverrides(packSource)` — given the text of a pack's
 *    `*Hooks.glsl` file, extract every `hook_*` definition (return-type
 *    + name + signature + body) as a map keyed by hook name.
 *
 *  - `substituteHooks(prelude, overrides)` — given the identity-default
 *    prelude (from `HookPrelude.ts`) and the override map, replace each
 *    identity default with the pack-supplied version. Names that don't
 *    appear in the prelude (typo / wrong-role hook) are returned as a
 *    diagnostic list — the renderer logs them and continues.
 *
 * Implementation: a one-pass brace-counting scanner. Tolerates `//` and
 * `/* … *​/` comments. No support for string literals (GLSL has none).
 * Edge cases like `#define hook_foo` are ignored — the scanner only
 * matches `<return-type> hook_<name>( … ) {` as a definition.
 *
 * v1 intentionally rejects nothing — unknown hook names are reported so
 * a pack can ship a `hook_modifyAlbedo` AND a typo, get the working hook
 * applied, and a single console warning for the typo.
 */

/** One parsed hook function: full GLSL source (header + body). */
export interface ParsedHook {
  /** Name of the hook, e.g. `hook_modifyReflectivity`. */
  name: string;
  /** Full function GLSL: `<retType> name(<params>) { <body> }`. */
  source: string;
}

/**
 * Strip GLSL comments from a source string. Preserves line breaks so
 * downstream line-number bookkeeping (S5 validation) stays accurate.
 * Block comments inside line comments and vice-versa are not handled
 * — GLSL doesn't allow nesting, so this is correct for valid source.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === "/" && c2 === "/") {
      // Line comment — consume to end of line (preserve the newline).
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && c2 === "*") {
      // Block comment — consume to `*/`, preserving newlines.
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Parse every `hook_*` function definition from a pack-supplied source.
 * Hooks declared multiple times — last wins.
 *
 * Returns a map of `hookName → full function source`. Non-function
 * statements (e.g. `#include` once we resolve it, or stray globals) are
 * silently skipped — the parser only ever extracts hook definitions.
 */
export function parseHookOverrides(packSource: string): Map<string, string> {
  const out = new Map<string, string>();
  const src = stripComments(packSource);
  // Walk the source by repeated regex search. Each match advances
  // past the function body so subsequent searches only find
  // definitions, not calls.
  const re = /(\w+)\s+(hook_\w+)\s*\(([^)]*)\)\s*\{/g;
  while (true) {
    const m = re.exec(src);
    if (!m) break;
    // Balance braces.
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      i++;
    }
    if (depth !== 0) break; // unbalanced source — bail
    out.set(m[2]!, src.slice(m.index, i));
    re.lastIndex = i;
  }
  return out;
}

/**
 * Substitute pack-supplied hook definitions into the identity-default
 * prelude. The prelude string contains identity-default functions whose
 * names start with `hook_`; this function finds each by name and
 * replaces the full function (header + body) with the override.
 *
 * Unknown hook names (override exists but no matching default) are
 * returned in `unmatched` so the caller can log a single warning. The
 * substitution still succeeds — known hooks are still applied.
 */
export function substituteHooks(
  prelude: string,
  overrides: Map<string, string>,
): { source: string; unmatched: string[] } {
  if (overrides.size === 0) return { source: prelude, unmatched: [] };
  let out = prelude;
  const matched = new Set<string>();

  for (const [name, overrideSrc] of overrides) {
    const range = findHookDefinitionRange(out, name);
    if (!range) continue;
    matched.add(name);
    out = out.slice(0, range.start) + overrideSrc + out.slice(range.end);
  }

  const unmatched: string[] = [];
  for (const name of overrides.keys()) if (!matched.has(name)) unmatched.push(name);
  return { source: out, unmatched };
}

/**
 * Find the `start`/`end` range (exclusive end) of a hook function
 * definition by name in `src`. Locates `<type> name(...) { ... }` and
 * returns the index of the start of `<type>` and one past the closing
 * `}`. Used by `substituteHooks` to splice an override into the
 * prelude. Returns `null` when the named hook isn't defined.
 */
function findHookDefinitionRange(
  src: string,
  name: string,
): { start: number; end: number } | null {
  const re = new RegExp(`(\\w+)\\s+${name}\\s*\\(`);
  const m = re.exec(src);
  if (!m) return null;
  // m[0] = "<type> name (" — m.index points at start of <type>.
  // Walk past the `(`, balancing parens through the param list.
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    const c = src[i];
    if (c === "(") parenDepth++;
    else if (c === ")") parenDepth--;
    i++;
  }
  // Skip whitespace until `{`.
  while (i < src.length && src[i] !== "{") i++;
  if (src[i] !== "{") return null;
  i++; // past `{`
  let braceDepth = 1;
  while (i < src.length && braceDepth > 0) {
    const c = src[i];
    if (c === "{") braceDepth++;
    else if (c === "}") braceDepth--;
    i++;
  }
  if (braceDepth !== 0) return null;
  return { start: m.index, end: i };
}
