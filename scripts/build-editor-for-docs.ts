/**
 * Build the cardboard editor app as a static bundle and stage it under
 * `apps/docs/public/editor/` so the docs site can serve it at
 * `https://codingbutter.github.io/cardboard/editor/`.
 *
 * Pipeline (mirrors `scripts/build-game-for-docs.ts`):
 *
 *   1. `bun build apps/editor/index.html --outdir apps/editor/dist`
 *        → static HTML + JS + (broken) CSS
 *   2. `bunx @tailwindcss/cli`
 *        → real Tailwind utilities; overwrite the bun-emitted CSS in-place
 *          at the same hashed filename so the `<link>` in `index.html`
 *          keeps resolving.
 *   3. Copy `apps/editor/dist/*` → `apps/docs/public/editor/`
 *
 * Step 2 is the load-bearing fix: `bun build`'s plugin API doesn't support
 * `onBeforeParse`, which `bun-plugin-tailwind` relies on. The CLI handles
 * `@import "tailwindcss"`, `@source`, and `@theme` correctly, so we run
 * it after `bun build` and overwrite the hashed CSS file in dist.
 *
 * The editor is a Bun-served React app that uses purely relative paths
 * (`./index.tsx`, `./index.css`) so the bundle "just works" when served
 * from a subdirectory like `/cardboard/editor/` — no basePath wiring or
 * `<base href>` injection needed.
 *
 * Safe to rerun. Idempotent.
 *
 * Flags:
 *   --skip-tw   skip the Tailwind CLI overwrite (dev iterations only;
 *               will ship broken styling).
 */
import { $ } from "bun";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EDITOR_DIR = join(ROOT, "apps/editor");
const EDITOR_DIST = join(EDITOR_DIR, "dist");
const EDITOR_CSS_IN = join(EDITOR_DIR, "index.css");
const DOCS_PUBLIC_EDITOR = join(ROOT, "apps/docs/public/editor");

const args = new Set(Bun.argv.slice(2));
const SKIP_TW = args.has("--skip-tw") || process.env.SKIP_TW === "1";

function log(msg: string): void {
  process.stdout.write(`[build-editor-for-docs] ${msg}\n`);
}

async function step1_bunBuildEditor(): Promise<void> {
  log("step 1: bun build apps/editor/index.html --outdir apps/editor/dist");
  // Clean dist so we never carry stale hashed bundles into the copy step.
  if (existsSync(EDITOR_DIST)) {
    rmSync(EDITOR_DIST, { recursive: true, force: true });
  }
  await $`bun build index.html --outdir dist`.cwd(EDITOR_DIR);
}

async function step2_tailwindOverwrite(): Promise<void> {
  if (SKIP_TW) {
    log("skip: tailwind overwrite (--skip-tw / SKIP_TW=1) — UI will be broken");
    return;
  }
  log("step 2: compile Tailwind utilities and overwrite hashed CSS in dist");
  const files = readdirSync(EDITOR_DIST);
  const cssFiles = files.filter((f) => f.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error(
      `No .css file in ${EDITOR_DIST}; bun build did not emit a stylesheet.`,
    );
  }
  if (cssFiles.length > 1) {
    log(
      `warning: ${cssFiles.length} .css files in dist (${cssFiles.join(", ")}) — overwriting all`,
    );
  }
  for (const css of cssFiles) {
    const out = join(EDITOR_DIST, css);
    log(`  → ${css}`);
    await $`bunx @tailwindcss/cli --input ${EDITOR_CSS_IN} --output ${out} --minify`.cwd(
      EDITOR_DIR,
    );
  }
  // Sanity: confirm utilities actually landed.
  const sample = await readFile(join(EDITOR_DIST, cssFiles[0]!), "utf8");
  const hits = sample.match(
    /\.(rounded|flex|grid|bg-|text-|p-|m-|w-|h-|border|justify-|items-)/g,
  );
  if (!hits || hits.length < 3) {
    throw new Error(
      `Tailwind output looks empty for ${cssFiles[0]}: found ${hits?.length ?? 0} expected utility classes.`,
    );
  }
  log(`  ok: ${hits.length} utility-class hits in ${cssFiles[0]}`);
}

async function copyRecursive(src: string, dst: string): Promise<void> {
  const entries = readdirSync(src, { withFileTypes: true });
  await mkdir(dst, { recursive: true });
  for (const e of entries) {
    const s = join(src, e.name);
    const d = join(dst, e.name);
    if (e.isDirectory()) await copyRecursive(s, d);
    else if (e.isFile()) await copyFile(s, d);
  }
}

async function step3_copyDistToDocs(): Promise<void> {
  log(`step 3: copy ${EDITOR_DIST} → ${DOCS_PUBLIC_EDITOR}`);
  if (existsSync(DOCS_PUBLIC_EDITOR)) {
    rmSync(DOCS_PUBLIC_EDITOR, { recursive: true, force: true });
  }
  await copyRecursive(EDITOR_DIST, DOCS_PUBLIC_EDITOR);
}

async function summarize(): Promise<void> {
  const files = readdirSync(DOCS_PUBLIC_EDITOR);
  log(`done. ${DOCS_PUBLIC_EDITOR} contains:`);
  let total = 0;
  for (const f of files.sort()) {
    const p = join(DOCS_PUBLIC_EDITOR, f);
    const size = Bun.file(p).size;
    total += size;
    log(`  ${f}  (${(size / 1024).toFixed(1)} KB)`);
  }
  log(`  total = ${(total / 1024).toFixed(1)} KB`);
}

await step1_bunBuildEditor();
await step2_tailwindOverwrite();
await step3_copyDistToDocs();
await summarize();
