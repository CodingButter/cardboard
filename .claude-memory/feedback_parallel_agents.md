---
name: feedback-parallel-agents
description: "Dispatch independent Agent subagents in parallel in a single message rather than sequentially. Only serialise when one's output feeds the next."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

When delegating multiple pieces of work that don't depend on each other, send all the `Agent` tool calls in a **single assistant message** so they run concurrently. Don't dispatch one, wait for it, then dispatch the next when the second didn't need the first's output.

**Why:** Sequential dispatch wastes wall-clock time and burns the cache window while one agent runs alone. The user has explicitly asked for parallel dispatch; serial dispatch is a regression.

**How to apply:** Before dispatching, ask "do later agents need any output from earlier agents?" If no → bundle them all into one message. If yes → only serialise the dependent ones; everything else still parallelises. Read agents (Explore) often need to return BEFORE implementation agents start, so that part stays serial — but multiple independent implementation agents can fan out from one Explore result. See `[[feedback-always-delegate]]` for the broader delegation rule.
