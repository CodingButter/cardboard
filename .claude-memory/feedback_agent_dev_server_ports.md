---
name: feedback-agent-dev-server-ports
description: "When an agent brief needs the agent to run/verify with `bun dev` (or any dev server), the brief MUST specify a unique unused port per agent. Default port 3001 collides between concurrent worktree agents and with the orchestrator."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

When dispatching multiple worktree agents that may each spin up a dev server (e.g. to verify a panel via Playwright), every brief MUST assign each agent a distinct, currently-unused port. Default port 3001 is already taken — by another agent's dev server, the user's IDE, or the orchestrator's own dev server.

**Why:** When agents collide on the same port, the first to bind wins; subsequent agents either silently fail to verify, or their `bun --hot server.ts` exits with `EADDRINUSE` and they skip verification. Worse: the user (or orchestrator) hitting `localhost:3001` may end up looking at a different agent's worktree output and not realize it. The user explicitly called this out: "agents should specify different unused ports. this shouldn happen again in the future."

**How to apply:**

1. **Pre-allocate ports per agent in the dispatch.** Pick a range like `3010-3099` for agents (avoid `3000-3001` since those are the user's defaults). Each agent brief gets one unique value.
2. **Tell the agent how to override the port.** The editor's `apps/editor/server.ts` likely accepts `PORT=<n> bun dev` or similar — verify the convention before the dispatch and bake the exact invocation into the brief.
3. **Default the orchestrator's own dev server to a non-3001 port** when bringing it up — so it doesn't compete with agents' fallback assumptions.
4. **For waves with N agents, allocate N+1 ports** — the +1 is for the orchestrator's own verification server, started after the wave lands.

**Example brief snippet to include:**

> "If you spin up a dev server for verification, use `PORT=3017 bun dev` (your assigned port). Do NOT use port 3001 — other agents and the orchestrator use other ports in the 3010-3099 range."

**Other reasons this matters:** Even when only one agent runs a dev server, the orchestrator's later verification screenshot may capture stale state if the dev server is still running from a previous agent's worktree. Always note which port belongs to which worktree, and tear down or replace before re-screenshotting.
