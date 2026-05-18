# @two_5_d/editor

Browser-based level editor for two_5_d games. Currently a placeholder
scaffold — see `docs/plans/` (specifically the future Editor section,
TBD) for what this becomes. Stack: React + Tailwind + shadcn/ui.
Imports `@two_5_d/engine` for live-test of edited scenes. Runs on
port 3001 to coexist with the game dev server on port 3000.

## Run

```sh
bun --cwd apps/editor run dev    # http://localhost:3001
bun --cwd apps/editor run build  # bundles into ./dist
```

## shadcn/ui

shadcn components aren't installed yet — only the utility prerequisites
(`clsx`, `tailwind-merge`, and the standard `cn()` helper at
`src/lib/utils.ts`). Future `bunx shadcn add ...` invocations will
slot in naturally.

## Deployed preview

The `main` branch auto-deploys to
[https://codingbutter.github.io/cardboard/](https://codingbutter.github.io/cardboard/)
via [`.github/workflows/deploy-editor.yml`](../../.github/workflows/deploy-editor.yml)
on every push (and on-demand via `workflow_dispatch`).

The workflow:

1. Builds both `apps/game` and `apps/editor`.
2. Flattens `apps/game/dist/` into `apps/editor/dist/play/` so the
   iframe game runner is served at `<editor>/play/`.
3. Copies `apps/game/public/packs/` into both `apps/editor/dist/packs/`
   (for the editor's starter-template fetch) and
   `apps/editor/dist/play/packs/` (for the game iframe's engine
   fetch).
4. Rewrites root-absolute `/packs/...`, `/sw.js`, `/manifest.webmanifest`,
   `/icons/...`, `/images/...` references in the built game bundle to
   document-relative `./packs/...` so they resolve under the
   `/cardboard/play/` Pages subpath. The engine's hardcoded
   `DEFAULT_PACK_URL` lives in the engine package; we patch the
   built output rather than touching the engine source.

### Reproducing the deploy tree locally

```sh
bun run --cwd apps/editor build:pages
# then serve the flattened tree, ideally under a /cardboard/ subpath:
mkdir -p /tmp/pages && ln -sfn $PWD/apps/editor/dist /tmp/pages/cardboard
bunx serve /tmp/pages
# visit http://localhost:3000/cardboard/
```

### Base URL handling

The editor doesn't bake the deploy base into its bundle. It detects
`/cardboard/` at runtime from `location.pathname` (see
[`src/lib/assetUrl.ts`](src/lib/assetUrl.ts)). Bun's HTML bundler
emits relative `./index-<hash>.js` URLs for its own chunks, so the
same `apps/editor/dist/` works both at the origin root (`bunx serve`)
and under the `/cardboard/` Pages subpath without rebuild.
