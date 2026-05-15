# Session state — context-survival snapshot

Written just before a context compaction so nothing important
disappears. Pair this with `PLAN.md` and the phase-specific docs
under `docs/plans/`.

If you're a fresh session: read `docs/PLAN.md` first, then this
doc, then the specific phase doc for whatever you're working on.

Date of last update: **2026-05-15**.

---

## 1. What just shipped (this session window)

### R3 — engine/pack split, game systems moved to pack
All 9 game-specific systems migrated from `packages/engine/src/Systems/`
to `packages/default-pack/scripts/systems/`:

- `gun-render.js`
- `inventory-bar-render.js`
- `minimap-render.js`
- `pickup.js`
- `player-input.js`
- `reticle-render.js`
- `stats-render.js`
- (plus the two ECS-feeder systems wired via ModAPI)

**ModAPI surface gained:**
- `api.inventory.{addItem, removeItem, countItem, getActiveItem}`
- `api.raycast.castRayToWall`
- `api.itemImages`

**Smoke test passes:** `bun run typecheck` + `bun run build-packs` +
`bun run build` all green.

**Deferred from R3 (blocked):** `InventoryScreenSystem.tsx` and
`SettingsScreenSystem.tsx` stay in `packages/engine/src/Systems/`
because the pack-script pipeline can't load `.tsx` / Preact
imports. They need an `api.ui` surface — see task #157.

### Four new plan docs landed

- `docs/plans/EDITOR.md` — in-browser level + pack editor. Live-mode
  engine, IndexedDB-backed pack, mode-based UI, tile-preset authoring,
  Monaco scripts, store integration. Already in `docs/PLAN.md` index.
- `docs/plans/TILE_PRESETS.md` (1120 lines) — preset-driven tile
  authoring. JSONC format with `extends` + `defaults`, per-scene
  `idMap` + compact grid, build-merge dedupe with content hashes,
  `PresetResolver`, default-pack migration path. Phases T1–T5.
- `docs/plans/ENGINE_PACK_SHADERS.md` (787 lines) — R4 design.
  Role replacement + post-process passes + auto-injected uniform
  contract + build-time validation + pack-chain conflict resolution.
  Phases S1–S4.
- `docs/plans/STORE.md` (834 lines) — hosted store website + iframe
  game runner + per-pack PWA + embed-anywhere widget. Phases ST1–ST5.

### Editor app scaffolded
- `apps/editor/` exists as a scaffold (Bun + React + Tailwind, no
  functional editor yet).

### Tailwind bunfig fix
- Added `bunfig.toml` to `apps/game/` and `apps/editor/` to restore
  Tailwind plugin processing on the dev server (regression after the
  monorepo migration where the dev server wasn't loading the
  `bun-plugin-tailwind` config).

---

## 2. Open tasks (queue)

### Queued

- **#150 Doc site** — pull `docs/plans/*` into a published doc site.
  Captured for later.
- **#155 Housekeeping pass (this doc + PLAN.md)** — DONE this session.
  Mark as closed after the commit lands.
- **#156 Tile-presets impl** — implement `docs/plans/TILE_PRESETS.md`
  starting at T1 (data format + `PresetResolver` + default-pack
  migration).
- **#157 `api.ui` surface for modal screens** — designed surface for
  pack scripts to register modal Preact components. Unblocks moving
  `InventoryScreenSystem` + `SettingsScreenSystem` to the default pack
  (R3 follow-up).
- **#158 R4 impl** — implement `docs/plans/ENGINE_PACK_SHADERS.md`
  starting at S1 (role replacement only, no validation, single pack).

### Sequencing preference (per user)
**R4 first, then tile-presets immediately after.** S1 is the
recommended starting point — minimal scope, gets the uniform-injection
contract proven, defers validation + multi-pack conflict resolution.

---

## 3. Open R3 follow-up

`InventoryScreenSystem.tsx` and `SettingsScreenSystem.tsx` are still
under `packages/engine/src/Systems/`. They consume Preact + Tailwind
and can't be transpiled by the current pack-script pipeline (which
loads `.js` ES modules out of `scripts/`).

The unblock is task **#157** — design `api.ui` so pack scripts can
register modal components without needing to ship JSX/TSX. Likely
shape:

```ts
api.ui.registerModal(id, { open, close, render: (api) => h })
api.ui.openModal(id)
api.ui.closeModal(id)
```

Either the engine hosts the Preact tree and packs return VDOM
nodes via `api.h` / `api.ui.widgets.*`, or the pack-build pipeline
gains TSX-transpile support (heavier). The former is preferred —
see the "Mod widget library" note in earlier sessions.

---

## 4. Active design decisions worth preserving

- **Monaco over CodeMirror** for the editor's script panel —
  chosen for TypeScript IntelliSense against a shipped `ModAPI.d.ts`.
- **Tile presets are JSONC** — hand-authorable. Anonymous entries
  use content-hash IDs; named library entries use stable string IDs.
  See `docs/plans/TILE_PRESETS.md` for the full format.
- **Pack shaders are opt-in** — engine ships default fragment/vertex
  pairs for each role (world, sprite, sky, post). Packs override a
  role by shipping `shaders/<role>.frag` (etc.) and/or add named
  post-process passes. Uniform contract is auto-injected.
- **Store iframe is multi-purpose** — chrome (store header bar +
  pack picker) + security sandbox (origin isolation) + PWA install
  unit (one PWA per pack, embedded inside the store shell).
- **Save data namespaces by pack-id, NOT origin** — so a save made
  while playing inside the store iframe is readable when the same
  pack is loaded directly (and vice-versa). Storage key prefix:
  `pack:<pack-id>:save:*`.

---

## 5. File-touched map (recent)

| Area | Files |
|------|-------|
| R3 systems moved | `packages/default-pack/scripts/systems/{gun-render,inventory-bar-render,minimap-render,pickup,player-input,reticle-render,stats-render}.js` |
| ModAPI extensions | `packages/engine/src/ModAPI.ts` — added `api.inventory.*`, `api.raycast.castRayToWall`, `api.itemImages` |
| Engine systems remaining (modals) | `packages/engine/src/Systems/{InventoryScreenSystem,SettingsScreenSystem}.tsx` |
| Editor scaffold | `apps/editor/` (full tree) |
| Tailwind dev fix | `apps/game/bunfig.toml`, `apps/editor/bunfig.toml` |
| New plan docs | `docs/plans/{EDITOR,TILE_PRESETS,ENGINE_PACK_SHADERS,STORE}.md` |
| Index update | `docs/PLAN.md` (this session) |

---

## 6. User preferences + standing rules

### Process / safety
- **Don't background the dev server from an agent shell.** User runs
  `bun run dev` in their own terminal.
- **Never kill by port.** Use `scripts/kill-server.ts` (pgrep by
  literal command line).
- **Don't commit unless asked.**

### Code style
- Bun primitives over Node (`Bun.serve`, `Bun.file`, `bun:sqlite`).
- Edit existing files in preference to creating new ones.
- Comments only when WHY is non-obvious.
- Don't add error handling for impossible scenarios.

### Doc conventions
- Plan-doc index in `docs/PLAN.md` table — keep one row per
  `docs/plans/*` file. Match column structure.
- After significant work, append/update phase status table at the
  bottom of `docs/PLAN.md`.
- This file (`SESSION_STATE.md`) is rewrite-on-update — keep it
  short, focused on what next session needs.

---

## 7. Smoke-test recipe

```sh
bun install                          # workspace resolution
bunx tsc -b                          # composite typecheck
bun run build-packs                  # bakes + zips default.apg
bun --cwd apps/game build            # production bundle
```

All four should pass cleanly. Cosmetic `@theme` / `@tailwind`
warnings from `bun build` are expected (plugin uses `onBeforeParse`,
which the `bun build` CLI doesn't run).

---

## 8. Recommended next implementation work

**Option A — R4 / S1 (preferred per user):** start
`docs/plans/ENGINE_PACK_SHADERS.md` phase S1.
- Role replacement only.
- No build-time validation yet.
- Single-pack only (skip pack-chain conflict resolution).
- Goal: prove the uniform auto-injection contract on the existing
  WebGL world shader by letting `default-pack` ship a passthrough
  override.

**Option B — Tile-presets / T1:** start
`docs/plans/TILE_PRESETS.md` phase T1.
- Data format (JSONC `extends` + `defaults`).
- `PresetResolver` class.
- Migrate `default-pack` scenes to the new format.

User has expressed preference: **finish R4 first, then tile-presets
immediately after.**

---

## 9. Next-session bootstrap

```sh
cat docs/PLAN.md
cat docs/SESSION_STATE.md
cat docs/plans/ENGINE_PACK_SHADERS.md   # if starting R4 / S1
cat docs/plans/TILE_PRESETS.md          # if starting tile-presets
```
