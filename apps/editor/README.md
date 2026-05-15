# @two_5_d/editor

Browser-based level editor for two_5_d games. Currently a placeholder
scaffold — see `docs/plans/` (specifically the future Editor section,
TBD) for what this becomes. Stack: React + Tailwind + shadcn/ui.
Imports `@two_5_d/engine` for live-test of edited scenes. Runs on
port 3001 to coexist with the game dev server on port 3000.

## Run

```sh
bun --cwd apps/editor run dev    # http://localhost:3001
bun --cwd apps/editor run build  # bundles into ./public
```

## shadcn/ui

shadcn components aren't installed yet — only the utility prerequisites
(`clsx`, `tailwind-merge`, and the standard `cn()` helper at
`src/lib/utils.ts`). Future `bunx shadcn add ...` invocations will
slot in naturally.
