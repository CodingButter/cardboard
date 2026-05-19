---
name: feedback-wave-merge-gate
description: "Never dispatch a new wave of agents until the previous wave's work is fully merged into main, conflicts resolved, typecheck clean, and pushed. Hard gate — no exceptions."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

Before dispatching ANY new batch of parallel worktree agents, the previous batch MUST be in this state:

1. **Every commit from the previous batch cherry-picked into `main`** (or merged equivalently).
2. **All conflicts resolved** — no abort/skip cherry-picks left dangling, no `nothing to commit` cherry-pick stalls left unresolved.
3. **`bun run typecheck` from `apps/editor/` exits 0** on the current main HEAD.
4. **`git push origin main` succeeded** — origin is in sync with local main.
5. **`git status` is clean** — no uncommitted modifications, no untracked files that should be tracked.

Only THEN dispatch the next wave.

**Why:** Worktree agents branch off the current `main` state of the repo. If wave 1's commits are still sitting on worktree branches when wave 2 dispatches, wave 2 sees the OLD main — they'll build against a stale baseline and their merges will conflict in confusing ways (especially in shared files like `scene-fixtures.ts`). The user explicitly flagged this: "never dispatch a second batch of agents without making sure everything previously done is merged and committed without errors."

**Why also push, not just commit locally:**
- If the local `.git/` corrupts (WSL/disk failure scenarios have happened on this project), uncommitted/unpushed work disappears.
- Future worktree branches resolve their base via origin in some flows.
- Push acts as an early audit — if the push fails, something is wrong (rejected, non-fast-forward, hook failure).

**How to apply (checklist before every dispatch):**

```
# 1. Confirm clean tree
git status   # → "nothing to commit, working tree clean"

# 2. Confirm origin sync
git log origin/main..HEAD   # → empty (or push first if non-empty)

# 3. Confirm typecheck
cd apps/editor && bun run typecheck   # → exit 0
```

If any check fails, FIX before dispatching. Do not assume "this small thing will sort itself out" — it won't, and the next wave compounds the problem.

**Special case: agents that committed to their own worktree branch AND to main accidentally.** Some agents have committed directly to `main` from inside their worktree (because git worktrees share `.git/` — when an agent does `git checkout main` it can land on the shared branch). When that happens, the orchestrator's `main` may already have the commit before cherry-pick is attempted. Always check `git log --oneline -5` to confirm what's actually on main before cherry-picking.

**Conflict resolution policy:**
- Prefer `git cherry-pick <sha>` over `git merge` for each agent's branch — it's surgical and preserves authorship.
- If cherry-pick stalls with "nothing to commit" and is non-empty diff, investigate before continuing — the cwd may have shifted into a worktree (common bug; `cd` back to the project root and retry).
- For predictable conflicts on shared files (e.g. `scene-fixtures.ts` when multiple agents extend it), pre-stage the shared changes yourself in a single commit BEFORE dispatching the dependent agents, so each agent only touches its own files. See the wave-4 dispatch pattern.

**Never skip the gate "because the agents need to start now."** A 30-second integrity check beats a 30-minute conflict-recovery session.
