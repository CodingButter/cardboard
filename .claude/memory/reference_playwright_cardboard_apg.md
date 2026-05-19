---
name: reference-playwright-cardboard-apg
description: A ready-to-import Cardboard.apg test pack lives at `~/Downloads/Cardboard.apg` and `apps/game/public/packs/Cardboard.apg`. Use either when a Playwright agent needs to load a real pack into the editor or game.
metadata:
  type: reference
---

When a Playwright agent (or anything driving the editor / game through
the browser) needs to load a real `.apg` pack — to exercise import
flows, scene loading, or runtime/asset paths — there are two
ready-to-use copies on disk:

- `~/Downloads/Cardboard.apg` — useful for exercising the "user picks
  a file from disk" import path. Playwright can drive a file input by
  passing this absolute path.
- `apps/game/public/packs/Cardboard.apg` — useful when the agent
  prefers to serve it from origin (e.g. `fetch("/packs/Cardboard.apg")`
  in the editor or `/cardboard/play/packs/Cardboard.apg` on Pages).
  Also aliased to `default.apg` post-staging — see
  `scripts/build-game-for-docs.ts`.

**How to apply:**

- For drag-and-drop / file-input testing, prefer the Downloads path —
  it doesn't require the staging pipeline to have run.
- For URL-based loading, use the game/public/packs path.
- Don't generate a new pack inside a Playwright run; `bun run build-packs`
  is slow and Cardboard.apg is the canonical fixture.
- The pack is rebuilt automatically when its sources change, so
  filename `Cardboard.apg` is stable. If you ever see `default.apg`
  referenced in a URL, that's the staging-side alias from
  `build-game-for-docs.ts` step 5 — see [[project-idb-source-of-truth]].
