---
name: feedback-playwright-screenshots-folder
description: Playwright screenshots go under ./screenshots/ (already gitignored). Never leave PNGs in repo root.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

When calling `mcp__playwright__browser_take_screenshot`, always pass a `filename:` value that begins with `screenshots/` (e.g. `screenshots/scene-after-X.png`). The `screenshots/` folder is already in `.gitignore` so captures stay out of commits.

**Why:** A long debugging session left 8 PNGs scattered in the repo root that had to be `rm`'d before committing. The user explicitly flagged this and asked future playwright captures to go in the existing `screenshots/` folder.

**How to apply:** Every `browser_take_screenshot` call must set `filename` to `screenshots/<descriptive-name>.png`. The default behaviour (writing to cwd / `.playwright-mcp/`) leaks files; always be explicit.
