## Portable memory — read these BEFORE doing anything else

The project-scoped Claude config lives at `.claude/` (gitignore is
selective — `screenshots/`, `worktrees/`, and `*.local.json` files are
ignored as per-machine state; everything else is committed).

Project memories live at `.claude/memory/` and travel with the repo so
any machine that clones gets the same behavioral rules, project
conventions, and engine context.

On session start (fresh machine OR new Claude instance):

1. Read `.claude/memory/MEMORY.md` — the index of rule files.
2. Follow each `[name](file.md)` link relevant to the current task.
3. Optionally mirror to per-user auto-memory:
   `cp .claude/memory/*.md ~/.claude/projects/<slug>/memory/`

Rules of note that govern this project right now (skim
`.claude/memory/MEMORY.md` for the full list):

- No git worktrees on this project (VHDX corruption risk).
- Voice + text both carry content — voice plays on desktop, phone reads text.
- Every interactive editor action registers via `registerCommand`.
- Progressive `<Tooltip stages={...}>` everywhere; no native `title=`.
- Wave 3 wiring must work in popped-out windows (cross-window sync).

## Project plans — read these when the user references "the plan"

All plan documentation lives in `docs/`. Forward-looking
architectural plans are in `docs/plans/`. A context-survival
snapshot lives at `docs/SESSION_STATE.md`.

Index:

**Top-level (`docs/`):**

| File | Topic |
|---|---|
| `docs/PLAN.md` | Master plan + phase status table. Start here. |
| `docs/SESSION_STATE.md` | Latest session-state snapshot — open tasks, decisions, file-touched map. Read after `PLAN.md` for current context. |
| `docs/IDEAS.md` | Idea log + future plan seeds. |

**Forward-looking plans (`docs/plans/`):**

| File | Topic |
|---|---|
| `docs/plans/WALL_OVERHAUL.md` | Variable wall heights, partial walls, caps. Phase 1 done. |
| `docs/plans/LIGHTING_OVERHAUL.md` | Bake-heavy emissive lighting model. Phases 1, 2, 4, 5 done. Phase 3 (per-wall samples) pending. Phase 7 (light entities R3+R4) absorbed from former LIGHTING_ENTITIES_REFACTOR. |
| `docs/plans/ENGINE_PACK_SPLIT.md` | Long-term: `src/` becomes pure engine, all game content lives in packs. Phases R1–R5. |
| `docs/plans/MULTIPLAYER_PLAN.md` | Networked multiplayer as a drop-in pack. Phases M1–M6. |
| `docs/plans/PACK_CHAIN.md` | Multi-pack chain loading + dependencies + override semantics + community store. Subsumes ENGINE_PACK_SPLIT R5. |

**Process docs (`docs/process/`):**

| File | Topic |
|---|---|
| `docs/process/PAGE_BUILD_PROCESS.md` | Playbook for building an editor page end-to-end. |
| `docs/process/EDITOR_DESIGN_INVENTORY.md` | Editor view × panel inventory + per-panel decisions. |

**Audits (`docs/audits/`):**

| File | Topic |
|---|---|
| `docs/audits/AUDIT_2026-05-19.md` | Reorg audit + execution record (this reorg). |

When the user mentions a phase by name (e.g. "R3 of the engine
split", "Phase 4 lighting", "M1") look it up in the corresponding
doc before acting. When they reference "the plan" generically, read
`docs/PLAN.md` first.

After significant work, append a one-line entry to `docs/PLAN.md`'s
phase status table; update `docs/SESSION_STATE.md` if open-task
state shifted.

---

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
