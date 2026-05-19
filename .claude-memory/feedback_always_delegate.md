---
name: feedback-always-delegate
description: Always delegate non-trivial implementation work to subagents. Keep the main context for orchestration + decisions; never spend it doing the work directly.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

For any task beyond a trivial one-file edit, **delegate to an Agent subagent**. Use Explore for read-only research; general-purpose (or a Vercel-specific specialist when it matches) for multi-file implementations. The main context exists for orchestration, decisions, and user-facing summaries — not for running greps, reading large source trees, or executing multi-file diffs.

**Why:** The user has explicitly asked this twice. Cluttering the main context with implementation detail makes the conversation harder to follow, burns cache on work that doesn't need to live here, and slows down their ability to redirect mid-work. Subagents return one concise summary, which is exactly what the main context should hold.

**How to apply:** Before doing any meaningful read/grep/edit pass, ask "could a subagent do this and report back in under 200 words?" If yes, delegate. Bundle related work into a single dispatch — don't fragment one logical change across many small agent calls. The prompt to the subagent must be self-contained (it doesn't see this conversation): include the plan docs to read, the exact file paths, the constraints, and the verification commands.
