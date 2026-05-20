/**
 * Build the cardboard sidecar PWA as a static bundle and stage it under
 * `apps/docs/public/sidecar/` so the docs site can serve it at
 * `https://codingbutter.github.io/cardboard/sidecar/`.
 *
 * Pipeline (mirrors `scripts/build-editor-for-docs.ts`):
 *
 *   1. `bun build apps/editor/sidecar/index.html --outdir apps/editor/sidecar/dist`
 *        → static HTML + JS + (broken) CSS
 *   2. `bunx @tailwindcss/cli`
 *        → real Tailwind utilities; overwrite the bun-emitted CSS in-place
 *          at the same hashed filename so the `<link>` in `index.html`
 *          keeps resolving. The sidecar imports `../index.css` (the editor's
 *          tailwind entry) so we compile against that file directly.
 *   3. Transpile `apps/editor/sidecar/sw.ts` → `dist/sw.js` via Bun.Transpiler
 *        → mirrors the on-the-fly transpile in `apps/editor/server.ts`, but
 *          materialised so GitHub Pages can serve a real .js file.
 *   4. Copy `apps/editor/sidecar/manifest.webmanifest` → `dist/`
 *   5. Copy `apps/editor/sidecar/dist/*` → `apps/docs/public/sidecar/`
 *
 * Step 2 is the load-bearing fix: `bun build`'s plugin API doesn't support
 * `onBeforeParse`, which `bun-plugin-tailwind` relies on. The CLI handles
 * `@import "tailwindcss"`, `@source`, and `@theme` correctly, so we run
 * it after `bun build` and overwrite the hashed CSS file in dist.
 *
 * The sidecar uses purely relative paths (`./index.tsx`, `./sw.js`,
 * `./manifest.webmanifest`) so the bundle "just works" when served from
 * `/cardboard/sidecar/` on Pages — no basePath wiring needed.
 *
 * Safe to rerun. Idempotent.
 *
 * Flags:
 *   --skip-tw   skip the Tailwind CLI overwrite (dev iterations only;
 *               will ship broken styling).
 */
import { $ } from "bun";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { mkdir, copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const EDITOR_DIR = join(ROOT, "apps/editor");
const SIDECAR_DIR = join(EDITOR_DIR, "sidecar");
const SIDECAR_DIST = join(SIDECAR_DIR, "dist");
// The sidecar's `index.tsx` does `import "../index.css"` — i.e. the editor's
// tailwind entry. Compile against that same file so the staged CSS contains
// every utility the sidecar references.
const EDITOR_CSS_IN = join(EDITOR_DIR, "index.css");
const SW_IN = join(SIDECAR_DIR, "sw.ts");
const MANIFEST_IN = join(SIDECAR_DIR, "manifest.webmanifest");
const DOCS_PUBLIC_SIDECAR = join(ROOT, "apps/docs/public/sidecar");

const args = new Set(Bun.argv.slice(2));
const SKIP_TW = args.has("--skip-tw") || process.env.SKIP_TW === "1";

function log(msg: string): void {
  process.stdout.write(`[build-sidecar-for-docs] ${msg}\n`);
}

async function step1_bunBuildSidecar(): Promise<void> {
  log("step 1: bun build apps/editor/sidecar/index.html --outdir apps/editor/sidecar/dist");
  // Clean dist so we never carry stale hashed bundles into the copy step.
  if (existsSync(SIDECAR_DIST)) {
    rmSync(SIDECAR_DIST, { recursive: true, force: true });
  }
  // Notes on flags (do not remove without retesting):
  //   - `./index.html` — explicit relative path. With a bare `index.html`,
  //     bun's bundler walks the workspace looking for an `index.html` and
  //     picks `apps/editor/index.html` (the editor's entry) instead of the
  //     sibling sidecar one. The `./` anchors resolution to cwd.
  //   - `--entry-naming '[name].[ext]'` — drop the default `[dir]/` prefix
  //     so the emitted HTML lands at `dist/index.html` rather than
  //     `dist/sidecar/index.html` (which would then reference assets at
  //     `./sidecar/...` and fail to resolve under `/sidecar/`).
  await $`bun build ./index.html --outdir dist --entry-naming ${"[name].[ext]"} --asset-naming ${"[name]-[hash].[ext]"} --chunk-naming ${"[name]-[hash].[ext]"}`.cwd(
    SIDECAR_DIR,
  );
}

async function step2_tailwindOverwrite(): Promise<void> {
  if (SKIP_TW) {
    log("skip: tailwind overwrite (--skip-tw / SKIP_TW=1) — UI will be broken");
    return;
  }
  log("step 2: compile Tailwind utilities and overwrite hashed CSS in dist");
  const files = readdirSync(SIDECAR_DIST);
  const cssFiles = files.filter((f) => f.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error(
      `No .css file in ${SIDECAR_DIST}; bun build did not emit a stylesheet.`,
    );
  }
  if (cssFiles.length > 1) {
    log(
      `warning: ${cssFiles.length} .css files in dist (${cssFiles.join(", ")}) — overwriting all`,
    );
  }
  for (const css of cssFiles) {
    const out = join(SIDECAR_DIST, css);
    log(`  → ${css}`);
    await $`bunx @tailwindcss/cli --input ${EDITOR_CSS_IN} --output ${out} --minify`.cwd(
      EDITOR_DIR,
    );
  }
  // Sanity: confirm utilities actually landed.
  const sample = await readFile(join(SIDECAR_DIST, cssFiles[0]!), "utf8");
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

async function step3_transpileServiceWorker(): Promise<void> {
  log("step 3: transpile sw.ts → dist/sw.js via Bun.Transpiler");
  if (!existsSync(SW_IN)) {
    throw new Error(`Service worker source missing: ${SW_IN}`);
  }
  const swSource = await readFile(SW_IN, "utf8");
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "browser" });
  const js = transpiler.transformSync(swSource);
  const out = join(SIDECAR_DIST, "sw.js");
  await writeFile(out, js, "utf8");
  // Sanity: make sure key SW idioms survived.
  if (!js.includes("addEventListener") || !js.includes("cardboard-sidecar-")) {
    throw new Error(
      `Transpiled sw.js looks wrong (length ${js.length}); missing expected tokens.`,
    );
  }
  log(`  ok: wrote ${out} (${(js.length / 1024).toFixed(1)} KB)`);
}

async function step4_copyManifest(): Promise<void> {
  log("step 4: copy manifest.webmanifest → dist/");
  if (!existsSync(MANIFEST_IN)) {
    throw new Error(`Manifest missing: ${MANIFEST_IN}`);
  }
  await copyFile(MANIFEST_IN, join(SIDECAR_DIST, "manifest.webmanifest"));
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

async function step5_copyDistToDocs(): Promise<void> {
  log(`step 5: copy ${SIDECAR_DIST} → ${DOCS_PUBLIC_SIDECAR}`);
  if (existsSync(DOCS_PUBLIC_SIDECAR)) {
    rmSync(DOCS_PUBLIC_SIDECAR, { recursive: true, force: true });
  }
  await copyRecursive(SIDECAR_DIST, DOCS_PUBLIC_SIDECAR);
}

async function summarize(): Promise<void> {
  const files = readdirSync(DOCS_PUBLIC_SIDECAR);
  log(`done. ${DOCS_PUBLIC_SIDECAR} contains:`);
  let total = 0;
  for (const f of files.sort()) {
    const p = join(DOCS_PUBLIC_SIDECAR, f);
    const size = Bun.file(p).size;
    total += size;
    log(`  ${f}  (${(size / 1024).toFixed(1)} KB)`);
  }
  log(`  total = ${(total / 1024).toFixed(1)} KB`);
}

await step1_bunBuildSidecar();
await step2_tailwindOverwrite();
await step3_transpileServiceWorker();
await step4_copyManifest();
await step5_copyDistToDocs();
await summarize();
