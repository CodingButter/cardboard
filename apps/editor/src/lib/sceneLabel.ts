/**
 * Scene display-label helpers.
 *
 * The Scene picker (and any future scene-display surface) shows a
 * human-readable name for each `scenes/*.json` asset rather than the
 * raw filename. Two sources, checked in order:
 *
 *   1. The scene JSON's `name` field if it exists and is non-empty.
 *      Authors can override the derived name by writing
 *      `{"name": "Whatever I Want"}` at the top of their scene file.
 *   2. The filename, with `.json` stripped, `_`/`-`/spaces treated as
 *      word boundaries, and each word title-cased. E.g.
 *      `scenes/forest_clearing.json` → `Forest Clearing`.
 */

/** Strip the `scenes/` directory prefix + the trailing `.json`. */
function stripPath(path: string): string {
  return path.replace(/^scenes\//, "").replace(/\.json$/i, "");
}

/** Title-case a single word; preserves runs of all-uppercase (e.g.
 *  acronyms like "UI") since blindly lowercasing them reads worse. */
function titleCaseWord(word: string): string {
  if (!word) return word;
  // Treat all-caps tokens longer than 1 char as acronyms — keep as-is.
  if (word.length > 1 && word === word.toUpperCase()) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Derive a display label from a scene path.
 *
 *   `scenes/foo.json`              → `Foo`
 *   `scenes/forest_clearing.json`  → `Forest Clearing`
 *   `scenes/level-01.json`         → `Level 01`
 *   `scenes/UI_test.json`          → `UI Test`
 */
export function deriveSceneLabelFromPath(path: string): string {
  const stem = stripPath(path);
  if (!stem) return path;
  const words = stem.split(/[_\-\s]+/).filter(Boolean);
  return words.map(titleCaseWord).join(" ");
}

/**
 * Resolve a scene's display label, preferring the JSON's `name` field
 * if one is present and non-empty, otherwise falling back to the
 * filename derivation.
 *
 * The `nameFromJson` argument is the parsed `.name` from the scene's
 * JSON content (or `undefined` if the file hasn't been read yet, or
 * the field is missing). Whitespace-only names are treated as missing.
 */
export function resolveSceneLabel(
  path: string,
  nameFromJson: string | undefined,
): string {
  const trimmed = nameFromJson?.trim();
  if (trimmed) return trimmed;
  return deriveSceneLabelFromPath(path);
}
