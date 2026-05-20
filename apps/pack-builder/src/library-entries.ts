/**
 * Allowlist mapping pack-bundled `libraries[]` names → canonical
 * `node_modules/<name>/<entry>` paths the pack-builder will bundle
 * + ship inside the `.apg`.
 *
 * Adding a new library is one line in `LIBRARY_ENTRIES` below. The
 * entry resolves to whatever `node_modules/<name>/<entry>` exists at
 * pack-build time. Bun's bundler is invoked with that file as the
 * entry point and `--format=esm --target=browser --packages=bundle`,
 * producing a single self-contained ESM file the editor's loader can
 * `import()` via a Blob URL.
 *
 * Why an allowlist rather than free-form: pack-bundled libraries
 * become part of the marketplace surface — a typo in a manifest's
 * `libraries[].name` would otherwise silently bundle the wrong thing.
 * Forcing the name through this map keeps the build deterministic
 * and gives the implementation a single place to add a library's
 * canonical entry path (some libraries ship multiple ESM entries —
 * e.g. `chart.js` has `dist/chart.js` (low-level) and `auto/auto.js`
 * (pre-registered controllers); we pick `auto` here so packs don't
 * have to call `Chart.register(...registerables)` themselves).
 */
export const LIBRARY_ENTRIES: Record<string, string> = {
  // Chart.js — use the `auto` subpath ESM entry so controllers /
  // scales / elements are pre-registered (saves the pack author from
  // having to call `Chart.register(...registerables)`). The packaged
  // file pulls in `@kurkle/color`; Bun's bundler resolves that
  // transitively at bundle time so the emitted .js is fully
  // self-contained.
  //
  // Resolved via the chart.js `package.json#exports` map (the `auto`
  // entry there resolves to `auto/auto.js`).
  "chart.js": "chart.js/auto",
};
