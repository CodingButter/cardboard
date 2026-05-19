---
name: feedback-agent-playwright-contention
description: "Parallel worktree agents must NOT all reach for the shared Playwright MCP browser — it's a single chrome session. Brief them to verify with curl/jsdom/build/typecheck instead, or pre-allocate Playwright slots."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

When dispatching parallel worktree agents that need to "verify" their work, they CANNOT all use Playwright. The Playwright MCP server hosts a single chrome session — concurrent agents fight over the same browser tab, page loads, snapshots, and screenshots collide, and the orchestrator's own audit/screenshot work gets clobbered.

**User said:** "looks like agents are fighting over a single playwright chrome".

**How to apply (every parallel-wave dispatch):**

1. **Default agent verification = NOT Playwright.** Prefer:
   - `bun run typecheck` (cheap, always available)
   - `bun build` (catches loader/transpile errors)
   - Read the file back, walk the JSX manually, reason about layout
   - For dimensions/responsive: do the math (auto-fit minmax(40, 56) at 230px width = 5 columns of 40-46px = 5 brushes fit, etc.) instead of opening a browser
2. **Tell the agent explicitly: "Do NOT spawn or use a Playwright session — the orchestrator owns the browser. Verify via typecheck + reasoning only."**
3. **If a wave genuinely needs Playwright verification per panel:**
   - Run that wave **sequentially**, not parallel — one agent at a time owns the browser.
   - OR have the agents emit verification SQL (panel size + visible-element queries) and have the orchestrator run them in batch after the wave lands.
4. **Orchestrator's audit Playwright session must NOT compete** with mid-wave agents either — pause the audit until the wave is fully merged.

**Cost of getting this wrong:** Agents claim "verified" but show stale screenshots, or their `browser_take_screenshot` calls error out and they silently skip verification. The user sees the broken UI in the merged result and the audit was a no-op.

**Related rules:**
- [[feedback-agent-dev-server-ports]] — if each agent does spin up a dev server for verification, they need distinct ports. But the cleanest fix is to NOT spin up dev servers in the agent at all; rely on the orchestrator's running server post-merge.
