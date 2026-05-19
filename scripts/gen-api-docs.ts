#!/usr/bin/env bun
/**
 * Generate the API-reference section of the docs site from the
 * TypeScript sources in packages/engine/src/ModAPI/. Uses TypeDoc
 * with the markdown plugin, writes to
 * apps/docs/content/docs/api/. After TypeDoc runs we walk the
 * output and add a Fumadocs-compatible `title:` frontmatter to every
 * `.mdx` file that doesn't have one — typedoc-plugin-markdown's
 * default frontmatter shape doesn't quite match Fumadocs' page
 * schema, so we patch it.
 *
 * Runs as part of the `prebuild` step of apps/docs.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname;
const entryPoint = join(repoRoot, 'packages/engine/src/ModAPI/index.ts');
const outDir = join(repoRoot, 'apps/docs/content/docs/api');

// typedoc resolves the typescript version pinned by apps/docs (TS 6.x),
// and the engine's tsconfig still uses `baseUrl`, which TS 6 flags as
// a deprecation error. We can't drop `baseUrl` (the engine relies on
// bare-name path aliases) and we don't want to touch the engine's
// tsconfig from this script either. So we write a tiny shim that
// extends the engine config and silences just that one deprecation
// for the typedoc run.
const tsconfigShimPath = join(repoRoot, 'apps/docs/.typedoc.tsconfig.json');
writeFileSync(
  tsconfigShimPath,
  JSON.stringify(
    {
      extends: '../../packages/engine/tsconfig.json',
      compilerOptions: {
        ignoreDeprecations: '6.0',
      },
    },
    null,
    2,
  ) + '\n',
);
const tsconfig = tsconfigShimPath;

// Clean previous output so removed exports don't leave stale pages.
if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true });
}
mkdirSync(outDir, { recursive: true });

// Invoke TypeDoc via Bun. We resolve the binary from the docs app's
// node_modules to be sure the workspace-installed version wins.
const typedocBin = join(repoRoot, 'apps/docs/node_modules/.bin/typedoc');

const args = [
  '--plugin',
  'typedoc-plugin-markdown',
  '--entryPoints',
  entryPoint,
  '--tsconfig',
  tsconfig,
  '--out',
  outDir,
  '--readme',
  'none',
  '--hideBreadcrumbs',
  'true',
  '--hidePageHeader',
  'true',
  '--fileExtension',
  '.mdx',
  '--entryFileName',
  'index.mdx',
  '--useCodeBlocks',
  'true',
  '--expandObjects',
  'true',
  '--expandParameters',
  'true',
  '--disableSources',
  'true',
  '--excludeInternal',
  'true',
  '--excludePrivate',
  'true',
  // MDX-safety flags. typedoc-plugin-markdown by default emits raw
  // TypeScript type syntax (`Foo<Bar>`, `Record<K, V>`) and JSDoc-derived
  // prose containing bare `<...>` / `{...}` snippets. MDX 3 parses the
  // former as JSX tags and the latter as JS expressions in prose
  // contexts (i.e. anything outside fenced code), which makes the
  // fumadocs/Next pipeline reject the page. These two flags ask
  // TypeDoc to escape both before we ever see the markdown:
  //   --useHTMLEncodedBrackets converts emitted-declaration `<` / `>`
  //     to `&lt;` / `&gt;` so type params survive prose contexts.
  //   --sanitizeComments backslash-escapes `<` / `>` / `{` / `}`
  //     inside JSDoc comments so example blocks and inline snippets
  //     in TSDoc don't trip MDX/acorn.
  // Without these the generated pages for CanonicalEvents, KnownTags
  // and PackComponents fail `next build --webpack` with an MDX parse
  // error and the GitHub Pages deploy never completes.
  '--useHTMLEncodedBrackets',
  'true',
  '--sanitizeComments',
  'true',
];

console.log(`gen-api: running typedoc against ${entryPoint}`);
const result = spawnSync(typedocBin, args, { stdio: 'inherit' });
if (result.status !== 0) {
  console.error(`gen-api: typedoc exited with status ${result.status}`);
  process.exit(result.status ?? 1);
}

// Walk the output and patch every .mdx file:
//  1. Strip typedoc's existing frontmatter if any.
//  2. Inject a Fumadocs-compatible frontmatter with `title`.
function walk(dir: string): string[] {
  const entries = readdirSync(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.mdx')) {
      out.push(full);
    }
  }
  return out;
}

// Derive a title from the first H1 in the file, or fall back to
// the filename. typedoc-plugin-markdown emits an H1 at the top of
// each page even with `--hidePageHeader` disabled for some kinds,
// so we use it when present.
function deriveTitle(body: string, fallback: string): string {
  const lines = body.split('\n');
  for (const l of lines) {
    const trim = l.trim();
    if (trim.startsWith('# ')) {
      return trim.slice(2).trim().replace(/`/g, '');
    }
  }
  return fallback;
}

const files = walk(outDir);
for (const file of files) {
  let content = readFileSync(file, 'utf8');

  // Strip existing frontmatter if typedoc emitted any.
  if (content.startsWith('---\n')) {
    const end = content.indexOf('\n---', 4);
    if (end !== -1) {
      content = content.slice(end + 4).replace(/^\n+/, '');
    }
  }

  const filename = file.split('/').pop()!.replace(/\.mdx$/, '');
  const title = deriveTitle(content, filename === 'index' ? 'API reference' : filename);
  const description =
    filename === 'index'
      ? 'Generated reference for the ModAPI surface — components, prefabs, systems, input, modals.'
      : `Generated reference for ${title}.`;

  const escapedTitle = title.replace(/"/g, '\\"');
  const fm = `---\ntitle: "${escapedTitle}"\ndescription: "${description}"\n---\n\n`;
  writeFileSync(file, fm + content);
}

// Make sure there's a meta.json so the section name is "API
// reference" rather than "api".
const metaPath = join(outDir, 'meta.json');
if (!existsSync(metaPath)) {
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        title: 'API reference',
        description: 'Generated reference for the ModAPI surface.',
      },
      null,
      2,
    ) + '\n',
  );
}

console.log(`gen-api: wrote ${files.length} API page(s) to ${outDir}`);
