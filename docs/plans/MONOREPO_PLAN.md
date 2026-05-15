# Monorepo restructure — workspace layout

A focused plan for splitting the current flat repo into a Bun
workspace with clear engine-vs-content-vs-app boundaries. This is the
prerequisite for `ENGINE_PACK_SPLIT.md` R1-R5 and `MULTIPLAYER_PLAN.md`
M1+ — those plans become "move file X from package A to package B"
instead of "introduce package boundaries mid-refactor."

Do this in ONE focused agent run. The change is mechanical but touches
every import in the codebase. Smoke-test at every step.

---

## Goal

`src/` and `resources/` and `scripts/` and `index.html` all live at
the repo root today. After this refactor:

- `packages/engine/` — the pure ECS-raycaster engine. Publishable to
  npm later if desired. Other people can fork it to ship a totally
  different game.
- `packages/default-pack/` — the standard library / "Browser Doom"
  content. Default scenes, prefabs, scripts, manifest. Just another
  workspace pack, no engine-coupled status.
- `packages/shared/` — protocol + math types client+server agree on
  (Vec2, Component<T>, future NetMessage). Imported by both engine and
  any multiplayer server.
- `apps/game/` — the thin assembly point. Imports engine, ships
  default-pack as initial content. Has the HTML, dev server, public
  static dir.
- `apps/pack-builder/` — scripts that ran at build time: bake-lights,
  build-packs. Lives as an app because it doesn't ship at runtime.
- `apps/multiplayer-server/` — future, blank slot.
- `docs/` — all plan markdowns.

## End-state layout

```
two_5_d/                              workspace root
├── package.json                      workspaces: ["packages/*", "apps/*"]
├── bun.lock
├── tsconfig.base.json                shared strict settings
├── bunfig.toml                       (already exists)
├── packages/
│   ├── engine/
│   │   ├── package.json              "@two_5_d/engine"
│   │   ├── tsconfig.json             extends base
│   │   └── src/                      (was top-level src/)
│   ├── default-pack/
│   │   ├── package.json              "@two_5_d/default-pack" (private)
│   │   ├── manifest.json
│   │   ├── config.json
│   │   ├── images/, scenes/, scripts/
│   │   └── (.apg built into apps/game/public/packs/)
│   └── shared/
│       ├── package.json              "@two_5_d/shared"
│       └── src/
├── apps/
│   ├── game/
│   │   ├── package.json              deps: @two_5_d/engine, @two_5_d/default-pack
│   │   ├── index.html
│   │   ├── index.ts                  (was top-level)
│   │   ├── server.ts                 dev server
│   │   ├── tsconfig.json
│   │   └── public/                   bundled output + packs/
│   ├── pack-builder/
│   │   ├── package.json              deps: @two_5_d/engine
│   │   └── src/
│   │       ├── build-packs.ts
│   │       ├── bake-lights.ts
│   │       ├── generate-scene.ts
│   │       ├── kill-server.ts
│   │       └── make-icons.ts
│   └── multiplayer-server/           future
└── docs/
    ├── PLAN.md
    ├── SESSION_STATE.md
    └── plans/
        ├── WALL_OVERHAUL.md
        ├── LIGHTING_OVERHAUL.md
        ├── LIGHTING_ENTITIES_REFACTOR.md
        ├── ENGINE_PACK_SPLIT.md
        ├── MULTIPLAYER_PLAN.md
        └── MONOREPO_PLAN.md          (this file)
```

## Tooling decisions

- **Bun workspaces alone** — `bun install` from the root resolves
  workspace deps via symlinks. No Turborepo or Nx. The project is
  small enough that incremental-build caching isn't a win yet.
- **Single `tsconfig.base.json`** at the root with shared `strict`,
  `target`, `lib`, `module` settings. Each package extends it and
  adds its own `rootDir`/`outDir` + path aliases as needed.
- **Path aliases stay, but qualified by package boundary**:
  - Inside `packages/engine/`: `import { Camera } from "Components"`
    keeps working (intra-package alias).
  - Across packages: `import { Camera } from "@two_5_d/engine"`.
  - Default-pack scripts import the engine via the public ModAPI
    surface — they shouldn't reach into engine internals.
- **HMR setup**: the dev server moves to `apps/game/server.ts`.
  Bun's HMR resolves workspace deps via the symlinked
  `node_modules/@two_5_d/engine` entry. Verified to work for this
  pattern in Bun ≥ 1.1.

## Migration steps

One focused agent run. Each step independently smoke-testable.

### 1. Workspace scaffolding
- Add root `package.json` with `"workspaces": ["packages/*", "apps/*"]`.
- Create `tsconfig.base.json` with the project's current `compilerOptions`
  (strict, target, lib, paths, etc.).
- Don't touch any source yet.

### 2. Engine package
- `mkdir packages/engine && mv src packages/engine/src`.
- Add `packages/engine/package.json` (name: `@two_5_d/engine`, main:
  `src/index.ts`).
- Add `packages/engine/tsconfig.json` extending base, with the same
  path aliases the current `tsconfig.json` has but rooted at
  `./src/`.
- Add `packages/engine/src/index.ts` as a barrel re-exporting the
  ModAPI surface, plus any types consumers need (Camera, Position,
  etc.).
- Smoke: `bun --cwd packages/engine run tsc --noEmit`.

### 3. Default-pack package
- `mkdir packages/default-pack && mv resources/packs/default/* packages/default-pack/`.
- Add `packages/default-pack/package.json` (name: `@two_5_d/default-pack`,
  `private: true`, no main/exports since it's content not code).
- Delete the now-empty `resources/` directory.

### 4. Shared package
- `mkdir packages/shared/src && touch packages/shared/src/index.ts`.
- Move shared math/types here if any obvious candidates exist; if not,
  leave as empty placeholder for now. (Multiplayer plan will populate
  it.)
- Add `packages/shared/package.json`.

### 5. Game app
- `mkdir apps/game && mv index.html index.ts apps/game/ && mv server.ts apps/game/ && mv public apps/game/`.
- Add `apps/game/package.json` with deps on `@two_5_d/engine` +
  `@two_5_d/default-pack`. Scripts: `dev`, `build`.
- Update `apps/game/index.ts` to import from `@two_5_d/engine`.
- Update `apps/game/server.ts` paths if any are relative to the
  old root.
- Move `bunfig.toml` to root (it's workspace-level config).
- Smoke: `bun --cwd apps/game run dev` boots; the canvas appears.

### 6. Pack-builder app
- `mkdir apps/pack-builder/src && mv scripts/*.ts apps/pack-builder/src/`.
- Add `apps/pack-builder/package.json`.
- Update root `package.json` `scripts.build-packs` to call into the
  app: `"bun --cwd apps/pack-builder run build-packs"`.
- Build-packs reads source from `packages/default-pack/`, outputs to
  `apps/game/public/packs/default.apg`.
- Smoke: `bun run build-packs` produces the same `.apg` as before.

### 7. Docs reorg
- `mkdir docs docs/plans`.
- `mv PLAN.md SESSION_STATE.md docs/`.
- `mv WALL_OVERHAUL.md LIGHTING_OVERHAUL.md LIGHTING_ENTITIES_REFACTOR.md ENGINE_PACK_SPLIT.md MULTIPLAYER_PLAN.md MONOREPO_PLAN.md docs/plans/`.
- Update `CLAUDE.md` (or `docs/CLAUDE.md` — see step 8).

### 8. CLAUDE.md update
- Keep `CLAUDE.md` at root (it's the loadbearing convention for Claude
  Code). Append a "Plans index" section listing the new locations so
  future sessions know where to look.

### 9. Final smoke
```sh
bun install                          # resolves workspaces
bunx tsc -b                          # composite build of all packages
bun run build-packs                  # bakes + zips into apps/game/public/packs/
bun --cwd apps/game run dev          # game runs locally
bun --cwd apps/game build            # production bundle
```

All green. The user reloads the dev server and the demo still works.

## Risks

- **Bun workspace edge cases** — Bun ≥ 1.1 should handle this fine
  but there may be HMR or symlink rough spots. Fallback: pnpm
  workspaces (same layout, change root `package.json`'s
  `"workspaces"` to `pnpm-workspace.yaml`). Don't preemptively do
  this; only if Bun chokes.
- **Mechanical churn** — every import touches it. Agent should run a
  global find/replace on import strings. Smoke catches escapes.
- **Path aliases inside engine** — keep `tsconfig.json`'s current
  `paths` map intra-package; nothing changes for engine internal code.
- **Pack-builder must import engine** to use `Scene` types in the
  bake. Confirm the engine package's `main` exports include
  `bakeScene`'s deps (Scene, castRayThroughWalls, Vec2).

## What stays at root after this

- `package.json` (workspace root)
- `tsconfig.base.json`
- `bun.lock`
- `bunfig.toml`
- `CLAUDE.md`
- `README.md` (if any)
- `.gitignore`
- `.prettierrc` / `.prettierignore`
- `.vscode/`
- `docs/`

Nothing else.

## Next steps (after this lands)

1. **`ENGINE_PACK_SPLIT.md` R2** — move `Prefabs/` from
   `packages/engine/src/Prefabs/` to
   `packages/default-pack/scripts/prefabs/`. Now a trivial move
   instead of an architectural change.
2. **`ENGINE_PACK_SPLIT.md` R3** — same for game-specific systems.
3. **`MULTIPLAYER_PLAN.md` M1** — create `apps/multiplayer-server/`
   slot, populate `packages/shared/` with protocol types.
