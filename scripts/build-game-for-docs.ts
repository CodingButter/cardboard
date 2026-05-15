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
import { join, basename } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const GAME_DIR = join(ROOT, "apps/game");
const GAME_DIST = join(GAME_DIR, "dist");
const GAME_CSS_IN = join(GAME_DIR, "index.css");
const PACKS_SRC = join(GAME_DIR, "public/packs");
const DOCS_PUBLIC_PLAY = join(ROOT, "apps/docs/public/play");
const DOCS_PUBLIC_PLAY_PACKS = join(DOCS_PUBLIC_PLAY, "packs");

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

async function step4_copyDistToDocs(): Promise<void> {
  log(`step 4: copy ${GAME_DIST} → ${DOCS_PUBLIC_PLAY}`);
  if (existsSync(DOCS_PUBLIC_PLAY)) {
    rmSync(DOCS_PUBLIC_PLAY, { recursive: true, force: true });
  }
  await copyRecursive(GAME_DIST, DOCS_PUBLIC_PLAY);
}

async function step5_copyPack(): Promise<void> {
  log(`step 5: copy default.apg → ${DOCS_PUBLIC_PLAY_PACKS}`);
  await mkdir(DOCS_PUBLIC_PLAY_PACKS, { recursive: true });
  const apg = join(PACKS_SRC, "default.apg");
  if (!existsSync(apg)) {
    throw new Error(`Expected ${apg} to exist after build-packs.`);
  }
  await copyFile(apg, join(DOCS_PUBLIC_PLAY_PACKS, basename(apg)));
}

async function summarize(): Promise<void> {
  const files = readdirSync(DOCS_PUBLIC_PLAY);
  const apg = join(DOCS_PUBLIC_PLAY_PACKS, "default.apg");
  const apgStat = existsSync(apg) ? Bun.file(apg).size : 0;
  log(`done. ${DOCS_PUBLIC_PLAY} contains:`);
  for (const f of files.sort()) log(`  ${f}`);
  log(`  packs/default.apg = ${(apgStat / 1024 / 1024).toFixed(2)} MB`);
}

await step1_buildPacks();
await step2_bunBuildGame();
await step3_tailwindOverwrite();
await step4_copyDistToDocs();
await step5_copyPack();
await summarize();
