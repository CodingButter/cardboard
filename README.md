# cardboard

A browser-based 2.5D raycaster engine where every game ships as a
hot-loadable asset pack.

## What it is

Wolfenstein-style raycaster written in TypeScript + Bun, rendered to
canvas2d or WebGL2. Walls have variable heights and partial-cell
shape (knee walls, hangers); lighting is bake-heavy with optional
dynamic lights; reflections on floor + walls; sprite entities with
ECS-driven behavior.

The engine knows nothing about the game it's running. All game
content — scenes, prefabs, scripts, textures, manifest — ships as a
single `.apg` zip. The runner loads whichever pack you point it at
via `?pack=<url>`.

This means:

- Modders can build entire games without forking the engine.
- Packs can extend each other via a `requires[]` dependency chain.
- Any pack hosted anywhere is playable in the official runner.
- The community store is one distribution path; raw URL is another.

## Status

In active development. The engine renders, walks, shoots, picks up
items, and supports baked + dynamic lighting on partial-wall
geometry. Most game logic has moved out of the engine and into the
default pack as ModAPI scripts.

Designed but not yet built: in-browser editor, community store
website, opt-in pack-shipped shader overrides, tile-preset
authoring, networked multiplayer. All have full plan docs under
`docs/plans/` — start at `docs/PLAN.md`.

## Quick start

```sh
bun install
bun run build-packs   # build the default pack into apps/game/public/packs/
bun run dev           # game runner on http://localhost:3000
```

## Architecture

Bun workspaces, three publishable packages + four apps:

```
packages/engine          ECS, raycaster (canvas2d + WebGL2), ModAPI,
                         asset-pack interface, lightmap baker.
packages/default-pack    Reference content pack: scenes, scripts,
                         images, manifest. Ships as default.apg.
packages/shared          Cross-package helpers.

apps/game                Thin runner: loads engine + a pack URL.
apps/editor              In-browser pack editor (scaffold).
apps/pack-builder        CLI for building .apg packs.
apps/multiplayer-server  (Planned) Self-hostable game server.
```

## Plan docs

`docs/PLAN.md` is the master index. Each long-running initiative
has its own plan doc under `docs/plans/`:

| Doc | Topic |
|---|---|
| `ENGINE_PACK_SPLIT.md` | Migrating everything game-specific out of the engine and into packs. |
| `PACK_CHAIN.md` | Pack manifest, dependency resolution, community store API. |
| `EDITOR.md` | In-browser editor: live mode, IndexedDB, Monaco scripts, tile-preset authoring, store integration. |
| `TILE_PRESETS.md` | Preset-driven tile authoring with content-hash dedupe + per-scene `idMap`. |
| `ENGINE_PACK_SHADERS.md` | Opt-in pack shaders with auto-injected uniforms (role replacement + post-process passes). |
| `STORE.md` | Hosted store website, iframe game runner, per-pack PWA, embed-anywhere widget. |
| `MULTIPLAYER_PLAN.md` | Networked multiplayer as a drop-in pack. |
| `WALL_OVERHAUL.md` | Variable wall heights, partial walls, caps. |
| `LIGHTING_OVERHAUL.md` | Bake-heavy emissive lighting model. |
| `MONOREPO_PLAN.md` | Workspace restructure (mostly landed). |
