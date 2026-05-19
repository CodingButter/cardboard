/**
 * Build the cardboard game runner as a static bundle and stage it
 * (plus the default asset pack) under `apps/docs/public/play/` so the
 * docs landing page can embed it via iframe at `/cardboard/play/`.
 *
 * Pipeline:
 *
 *   1. `bun run build-packs`               → fresh `default.apg`
 *   2. `bun build apps/game/index.html`    → static HTML + JS + (broken) CSS
 *   3. `bunx @tailwindcss/cli`             → real Tailwind utilities;
 *                                            overwrite the bun-emitted CSS
 *                                            in-place so the hashed reference
 *                                            in `index.html` keeps working.
 *   4. Copy `apps/game/dist/*`             → `apps/docs/public/play/`
 *   5. Copy `apps/game/public/packs/*.apg` → `apps/docs/public/play/packs/`
 *
 * Step 3 is the load-bearing fix: `bun build`'s plugin API doesn't
 * support `onBeforeParse`, which `bun-plugin-tailwind` needs. The CLI
 * processes `@import "tailwindcss"`, `@source`, and `@theme` correctly,
 * so we run it after `bun build` and overwrite the hashed CSS file.
 *
 * Designed to be safe to rerun, and idempotent.
 */
import { $ } from "bun";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const GAME_DIR = join(ROOT, "apps/game");
const GAME_DIST = join(GAME_DIR, "dist");
const GAME_CSS_IN = join(GAME_DIR, "index.css");
const PACKS_SRC = join(GAME_DIR, "public/packs");
const DOCS_PUBLIC_PLAY = join(ROOT, "apps/docs/public/play");
const DOCS_PUBLIC_PLAY_PACKS = join(DOCS_PUBLIC_PLAY, "packs");
const EDITOR_PUBLIC_PLAY = join(ROOT, "apps/editor/public/play");
const EDITOR_PUBLIC_PLAY_PACKS = join(EDITOR_PUBLIC_PLAY, "packs");
/**
 * Two stage targets:
 *  - `apps/docs/public/play/`   → docs landing iframe at /cardboard/play/
 *  - `apps/editor/public/play/` → editor's Play-mode iframe in dev
 * Both serve identical bytes; cheaper to stage once and copy twice than
 * to build twice. EDITOR_PUBLIC_PLAY is gitignored (build product).
 */
const PLAY_TARGETS: Array<{ dir: string; packs: string; label: string }> = [
  { dir: DOCS_PUBLIC_PLAY, packs: DOCS_PUBLIC_PLAY_PACKS, label: "docs" },
  { dir: EDITOR_PUBLIC_PLAY, packs: EDITOR_PUBLIC_PLAY_PACKS, label: "editor" },
];

const args = new Set(Bun.argv.slice(2));
const SKIP_PACKS = args.has("--skip-packs") || process.env.SKIP_PACKS === "1";

function log(msg: string): void {
  process.stdout.write(`[build-game-for-docs] ${msg}\n`);
}

async function step1_buildPacks(): Promise<void> {
  if (SKIP_PACKS) {
    log("skip: build-packs (--skip-packs / SKIP_PACKS=1)");
    return;
  }
  log("step 1: bun run build-packs");
  await $`bun run build-packs`.cwd(ROOT);
}

async function step2_bunBuildGame(): Promise<void> {
  log("step 2: bun build apps/game/index.html --outdir apps/game/dist");
  // Clean dist so we never carry stale hashed bundles into the copy step.
  if (existsSync(GAME_DIST)) {
    rmSync(GAME_DIST, { recursive: true, force: true });
  }
  await $`bun build index.html --outdir dist`.cwd(GAME_DIR);
}

async function step3_tailwindOverwrite(): Promise<void> {
  log("step 3: compile Tailwind utilities and overwrite hashed CSS in dist");
  const files = readdirSync(GAME_DIST);
  const cssFiles = files.filter((f) => f.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error(
      `No .css file in ${GAME_DIST}; bun build did not emit a stylesheet.`,
    );
  }
  if (cssFiles.length > 1) {
    log(
      `warning: ${cssFiles.length} .css files in dist (${cssFiles.join(", ")}) — overwriting all`,
    );
  }
  // Run Tailwind CLI against the game's `index.css` (which `@import`s
  // tailwindcss and `@source`s the engine + default-pack trees).
  for (const css of cssFiles) {
    const out = join(GAME_DIST, css);
    log(`  → ${css}`);
    await $`bunx @tailwindcss/cli --input ${GAME_CSS_IN} --output ${out} --minify`.cwd(
      GAME_DIR,
    );
  }
  // Sanity: confirm utilities actually landed.
  const sample = await readFile(join(GAME_DIST, cssFiles[0]!), "utf8");
  const hits = sample.match(/\.(rounded-lg|flex|bg-slate-300|p-0|justify-center)/g);
  if (!hits || hits.length < 3) {
    throw new Error(
      `Tailwind output looks empty for ${cssFiles[0]}: found ${hits?.length ?? 0} expected utility classes.`,
    );
  }
  log(`  ok: ${hits.length} utility-class hits in ${cssFiles[0]}`);
}

async function copyRecursive(src: string, dst: string): Promise<void> {
  // Bun.file + Bun.write doesn't recurse, and node:fs.cp's API is
  // node-version-dependent — easiest is to walk the tree ourselves.
  const entries = readdirSync(src, { withFileTypes: true });
  await mkdir(dst, { recursive: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) await copyRecursive(s, d);
    else if (e.isFile()) await copyFile(s, d);
  }
}

async function step4_copyDistToTargets(): Promise<void> {
  for (const t of PLAY_TARGETS) {
    log(`step 4 (${t.label}): copy ${GAME_DIST} → ${t.dir}`);
    if (existsSync(t.dir)) {
      rmSync(t.dir, { recursive: true, force: true });
    }
    await copyRecursive(GAME_DIST, t.dir);
  }
}

async function step5_copyPack(): Promise<void> {
  // The pack-builder writes `${manifest.name}.apg` (e.g. `Cardboard.apg`),
  // but consumer URLs in the docs landing iframe + smoke scripts load
  // `/packs/default.apg`. Discover whatever `*.apg` files exist in the
  // source dir, copy them all preserving names, and ALSO write a
  // canonical `default.apg` alias so URL consumers keep working.
  if (!existsSync(PACKS_SRC)) {
    throw new Error(
      `No *.apg packs in ${PACKS_SRC} — run \`bun run build:packs\` first.`,
    );
  }
  const apgs = readdirSync(PACKS_SRC).filter((f) => f.endsWith(".apg")).sort();
  if (apgs.length === 0) {
    throw new Error(
      `No *.apg packs in ${PACKS_SRC} — run \`bun run build:packs\` first.`,
    );
  }
  // Pick the canonical pack for the `default.apg` alias. If a file is
  // already named `default.apg`, use that; otherwise prefer the first
  // lexicographic entry (which after sort() is deterministic).
  const canonical = apgs.includes("default.apg") ? "default.apg" : apgs[0]!;
  for (const t of PLAY_TARGETS) {
    log(
      `step 5 (${t.label}): copy ${apgs.length} pack(s) → ${t.packs} (alias default.apg = ${canonical})`,
    );
    await mkdir(t.packs, { recursive: true });
    for (const name of apgs) {
      await copyFile(join(PACKS_SRC, name), join(t.packs, name));
    }
    // Write the canonical alias (skip the copy if it already lives at
    // `default.apg` because of the loop above).
    if (canonical !== "default.apg") {
      await copyFile(join(PACKS_SRC, canonical), join(t.packs, "default.apg"));
    }
  }
}

async function summarize(): Promise<void> {
  for (const t of PLAY_TARGETS) {
    const files = readdirSync(t.dir);
    const apg = join(t.packs, "default.apg");
    const apgStat = existsSync(apg) ? Bun.file(apg).size : 0;
    log(`done (${t.label}). ${t.dir} contains:`);
    for (const f of files.sort()) log(`  ${f}`);
    log(`  packs/default.apg = ${(apgStat / 1024 / 1024).toFixed(2)} MB`);
  }
}

await step1_buildPacks();
await step2_bunBuildGame();
await step3_tailwindOverwrite();
await step4_copyDistToTargets();
await step5_copyPack();
await summarize();
