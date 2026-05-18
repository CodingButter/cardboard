#!/usr/bin/env bun
/**
 * Local equivalent of the GitHub Pages deploy workflow's flatten step.
 *
 * Runs the editor + game production builds, then copies the game's
 * dist + packs into the editor's dist tree so the static layout
 * exactly mirrors what `https://codingbutter.github.io/cardboard/`
 * serves. Useful for sanity-checking deploys before pushing.
 *
 * Usage (from repo root):
 *   bun run --cwd apps/editor build:pages
 *
 * Then serve `apps/editor/dist/` with any static server, ideally
 * mounted at `/cardboard/` to mimic GH Pages exactly:
 *
 *   bunx serve apps/editor/dist
 *   # then visit http://localhost:3000/
 *
 * Or test under the Pages subpath:
 *
 *   mkdir -p /tmp/pages && ln -sfn $PWD/apps/editor/dist /tmp/pages/cardboard
 *   bunx serve /tmp/pages
 *   # then visit http://localhost:3000/cardboard/
 *
 * Run from anywhere — paths below are resolved relative to this file.
 */

import { cp, mkdir, readdir, stat, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import tailwindPlugin from "bun-plugin-tailwind";

const SCRIPT_DIR = new URL(".", import.meta.url).pathname;
const EDITOR_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(EDITOR_DIR, "..", "..");
const GAME_DIR = resolve(REPO_ROOT, "apps", "game");

const EDITOR_DIST = join(EDITOR_DIR, "dist");
const GAME_DIST = join(GAME_DIR, "dist");
const GAME_PUBLIC = join(GAME_DIR, "public");

console.log("[build:pages] editor =", EDITOR_DIR);
console.log("[build:pages] game   =", GAME_DIR);

// Programmatic build with the Tailwind plugin explicitly loaded.
//
// The CLI `bun build` does NOT pick up the [serve.static] plugins
// declared in bunfig.toml — that section is dev-server-only — so a
// CLI build ships the raw Tailwind v4 source (`@theme default { … }`
// blocks intact, no `:root` token expansion, no utility classes
// emitted). That's exactly what crashed the first deploy: the
// stylesheet loaded with status 200 but contained zero usable rules.
//
// Calling `Bun.build({ plugins: [tailwindPlugin] })` runs the
// plugin's `setup(build)` hook at the same point the dev server does,
// producing a fully compiled CSS file in the dist output.
async function buildApp(label: string, cwd: string) {
  const distDir = join(cwd, "dist");
  if (existsSync(distDir)) {
    await rm(distDir, { recursive: true, force: true });
  }
  const entry = join(cwd, "index.html");
  console.log(`[build:pages] building ${label}…`);
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: distDir,
    splitting: true,
    plugins: [tailwindPlugin],
    root: cwd,
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`[build:pages] ${label} build failed`);
  }
}

await buildApp("game", GAME_DIR);
await buildApp("editor", EDITOR_DIR);

// Step 3: flatten the deploy tree.
console.log("[build:pages] flattening…");

async function copyDir(src: string, dst: string) {
  if (!existsSync(src)) {
    console.warn(`[build:pages] skip: ${src} doesn't exist`);
    return;
  }
  await mkdir(dst, { recursive: true });
  await cp(src, dst, { recursive: true });
}

// 3.0. Editor's own public/ → editor/dist/ (popout.html etc.).
// Bun's HTML bundler doesn't copy `public/` over automatically.
const EDITOR_PUBLIC = join(EDITOR_DIR, "public");
if (existsSync(EDITOR_PUBLIC)) {
  for (const entry of await readdir(EDITOR_PUBLIC, { withFileTypes: true })) {
    const src = join(EDITOR_PUBLIC, entry.name);
    const dst = join(EDITOR_DIST, entry.name);
    if (entry.isDirectory()) {
      await copyDir(src, dst);
    } else {
      await cp(src, dst);
    }
  }
}

// 3a. apps/game/dist/ → apps/editor/dist/play/
await copyDir(GAME_DIST, join(EDITOR_DIST, "play"));

// 3b. apps/game/public/packs/ → apps/editor/dist/packs/
await copyDir(join(GAME_PUBLIC, "packs"), join(EDITOR_DIST, "packs"));

// 3c. Also copy packs to `dist/play/packs/` so the game iframe's
// hardcoded `/packs/Cardboard.apg` resolves when rewritten to
// relative `./packs/...` in step 4 below.
await copyDir(join(GAME_PUBLIC, "packs"), join(EDITOR_DIST, "play", "packs"));

// 3d. Game-side root statics (manifest.webmanifest, icons, images).
// The game iframe runs under `/cardboard/play/`, and its
// manifest / icon references use root-absolute paths; flatten them
// into `play/` so the rewritten relative URLs in step 4 resolve.
//
// `sw.js` is intentionally excluded: the game's SW does pathname-
// equality checks (`p === "/manifest.webmanifest"`) against
// `url.pathname` (always origin-absolute), which a rewrite to
// `./manifest.webmanifest` would silently break. Without the file
// the game's `register('/sw.js')` rejects in its existing
// `.catch()` handler — harmless for a preview deploy.
for (const name of ["manifest.webmanifest", "icons", "images"]) {
  const src = join(GAME_PUBLIC, name);
  if (!existsSync(src)) continue;
  const s = await stat(src);
  const dst = join(EDITOR_DIST, "play", name);
  if (s.isDirectory()) {
    await copyDir(src, dst);
  } else {
    await mkdir(join(EDITOR_DIST, "play"), { recursive: true });
    await cp(src, dst);
  }
}

// Step 4: rewrite root-absolute /packs/ references in the game's JS
// bundle to be document-relative (`./packs/...`). The engine's
// `DEFAULT_PACK_URL` is hardcoded as `/packs/Cardboard.apg`; on
// Pages that absolute path resolves to the origin root (which we
// don't control), so we patch the built output instead of touching
// engine source.
console.log("[build:pages] rewriting absolute pack URLs in game bundle…");
const playDir = join(EDITOR_DIST, "play");
async function rewriteAbsPacks(dir: string) {
  if (!existsSync(dir)) return;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Don't recurse into the copied packs dir.
      if (entry.name === "packs") continue;
      await rewriteAbsPacks(full);
      continue;
    }
    if (!/\.(js|mjs|css|html|webmanifest|json)$/.test(entry.name)) continue;
    const before = await readFile(full, "utf8");
    // `"/packs/...` → `"./packs/...` (preserve the leading quote so
    // we only touch string literals, not bare path fragments).
    const after = before
      .replace(/(["'`])\/packs\//g, "$1./packs/")
      .replace(/(["'`])\/sw\.js\b/g, "$1./sw.js")
      .replace(/(["'`])\/manifest\.webmanifest\b/g, "$1./manifest.webmanifest")
      .replace(/(["'`])\/icons\//g, "$1./icons/")
      .replace(/(["'`])\/images\//g, "$1./images/");
    if (after !== before) await writeFile(full, after, "utf8");
  }
}
await rewriteAbsPacks(playDir);

console.log("[build:pages] done. Tree:");
console.log("  apps/editor/dist/index.html");
console.log("  apps/editor/dist/play/index.html");
console.log("  apps/editor/dist/packs/Cardboard.apg");
console.log("  apps/editor/dist/play/packs/Cardboard.apg");
