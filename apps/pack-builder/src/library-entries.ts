/**
 * Convenience fallback map: pack-bundled `libraries[].name` → default
 * npm import specifier handed to Bun's bundler when the manifest entry
 * does not declare its own `entry` field.
 *
 * Originally this map was an allowlist — every library name had to be
 * pre-registered here before pack-builder would bundle it. That made
 * the central registry a dogfooding gatekeeper: a third-party pack
 * could not bundle a NEW npm library without a PR to this file.
 *
 * The closed-registry behaviour has been removed (see the audit note in
 * `docs/audits/`). `PackManifest.libraries[].entry` (engine
 * `AssetPack/types.ts:527`) is now the authoritative source — packs
 * declare their own entry-point. This map remains only as a convenience
 * shorthand for the most common packages so existing manifests (and
 * trivial single-line manifests) keep working without an explicit
 * `entry` value.
 *
 * Adding entries here is OPTIONAL — third-party packs should set
 * `entry` in their manifest directly. The pack-builder consults this
 * map only as a fallback when `entry` is missing.
 */
export const LIBRARY_ENTRIES: Record<string, string> = {
  // Chart.js — `auto` subpath ESM entry so controllers / scales /
  // elements are pre-registered (saves the pack author from having to
  // call `Chart.register(...registerables)`). Resolved via the
  // chart.js `package.json#exports` map (the `auto` entry there
  // resolves to `auto/auto.js`). Kept as a convenience because chart.js
  // is the library used by the two reference editor demo packs.
  "chart.js": "chart.js/auto",
};
