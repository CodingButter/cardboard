---
name: feedback-no-worktrees
description: STOP using git worktrees on this project. Shared .git/ dir causes WSL filesystem corruption (VHDX) and cwd race conditions where agent edits leak into main. Serialize overlapping agent work instead.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

**Hard rule: no worktrees on this project.**

User said: "we had some huge issues and the vhdx got corrupted we are back now. this seems to be issues with work trees. Can we please stop using worktrees. instead i'm fine with serializing agent work that might overlap."

**Why worktrees broke things here:**

1. **VHDX corruption** — too many concurrent git worktrees on the same shared `.git/` directory inside WSL2's VHDX virtual disk caused the file system to corrupt. Recovery was painful.
2. **Cwd race conditions** — the Bash tool's persistent cwd would sometimes end up pointing inside an agent's worktree even when the orchestrator thought it was in the main checkout. This caused phantom modifications to leak from the agent's intended worktree edit into the orchestrator's `main`, leading to dirty trees right before pushes.
3. **Agents committing to main directly** — because the `.git/` is shared across worktrees, an agent that `git checkout main`-ed (or one whose worktree HEAD silently aligned with `main`) committed directly to main from inside its worktree, polluting the branch without the orchestrator's knowledge.

**How to apply (every dispatch from now on):**

1. **Never pass `isolation: "worktree"` to the Agent tool.** Just run agents in the main checkout.
2. **For overlapping work, serialize.** Don't dispatch 6 agents in parallel if two of them touch the same file (or even the same fixtures file). Run them one at a time; each agent commits + pushes before the next begins.
3. **For non-overlapping work, parallel is still fine** — but they must all operate against the same main checkout. The orchestrator stages and dispatches them one after another but doesn't have to wait for the first to complete before dispatching the second IF they touch different files.
4. **Clean up existing leftover worktrees** by hand (user pruning) — don't run `git worktree remove --force` unsupervised since dirs are inside `.claude/worktrees/` and may contain user-side state.

**Concrete dispatch pattern (replaces the previous wave-of-N worktrees):**

For a wave of M panels:
- If panels touch ONLY their own files (e.g. each panel touches its own `*Panel.tsx`): dispatch agents in the main checkout one-by-one OR in a single batch with clear non-overlap; commit/push after each lands.
- If panels share a file (e.g. all need to extend `scene-fixtures.ts`): orchestrator pre-stages the shared edits in a single commit FIRST, then dispatches per-panel agents that only touch their own panel file.
- For "fix" waves where each agent edits ONE panel file: serialize them. The wall-clock cost of running 6 agents back-to-back is only marginally more than 6-in-parallel because each agent is small (~3 min), and the savings from zero conflict/recovery work dominate.

**Related rules:**
- [[feedback-wave-merge-gate]] — never dispatch next batch until previous merged + pushed cleanly.
- [[feedback-agent-dev-server-ports]] / [[feedback-agent-playwright-contention]] — same anti-collision principle: shared resources need explicit allocation, or serialize.
