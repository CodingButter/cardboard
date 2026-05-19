---
name: feedback-worktree-wave-merge
description: "Hybrid dispatch model: single agent on contained scope → main folder. Parallel wave OR large/risky single agent → worktrees. Worktrees never auto-cleaned; manual prune only. Every wave: typecheck → commit → push between dispatches. Never dispatch when git status is dirty."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: f7e2d687-9aca-4eae-927f-568e2969ddc7
---

This rule replaced the earlier "every agent gets a worktree" rule on 2026-05-18 after we found the worktree-per-agent default had real costs (cwd drift, no HMR until merge, slow bun install per worktree, 3-way merges on every wave).

## The hybrid model

**Default — main folder dispatch**. Use the main working tree as the agent's working directory when ALL of the following are true:
- Only ONE agent is running (or about to be running).
- Its scope is contained: one app, one package, or a small set of clearly non-overlapping files.
- The change is bounded — not a sweeping refactor.

**Worktree dispatch (`isolation: "worktree"`)**. Use when ANY of:
- Dispatching a PARALLEL wave (two or more agents running concurrently).
- Single agent doing substantial work — broad cross-package edits, sweeping refactor, anything where rollback might matter.
- Even a small chance of file conflicts with other in-flight work.

**Trivial edits**. If the change is one file and obvious, don't spawn an agent — do it inline myself with the Edit/Write tool. Save the dispatch for actual work.

## Before any dispatch

1. `git status` must be clean — no untracked, no uncommitted, no staged-but-not-committed. If dirty, commit or stash first (with user permission).
2. For main-folder dispatch: confirm no other agent is running and no in-progress conversation work depends on uncommitted state.
3. For worktree dispatch: file ownership must be non-overlapping across all agents in the wave.

## After each dispatch (main folder)

1. Review the diff (`git diff`, `git status`).
2. Run typecheck + build verification scoped to what changed.
3. Stage specific files (no `git add -A` / `.`) and commit with a clear message.
4. Push to origin/main.
5. `git status` clean again.

## After each dispatch (worktree)

1. Wait for the wave's agents to all complete.
2. For each worktree: typecheck + verify in the worktree before merging.
3. Merge each worktree's branch into main (FF if possible, `--no-ff` for clear history if parallel).
4. Workspace typecheck on main after all merges.
5. Push.
6. **Do NOT auto-delete the worktree.** Leave it on disk as a recovery snapshot. The user (Jamie) prunes worktrees manually when confident the work has settled and no safety net is needed (`git worktree remove <path>` + `git branch -D <branch>`).

## If a worktree merge wipes something

Stop immediately. Tell the user. Inspect both the worktree and main for the gap. Recover from the worktree (still on disk per the no-auto-cleanup rule). Do not dispatch more agents until resolved.

## Why this works

- Most dispatches are single-agent on contained scope → main folder is the right default. HMR sees changes live; you watch progress in real time.
- Parallel waves still get hard isolation when truly needed.
- Keeping worktrees on disk means rollback is always one `git checkout` away if a merge goes wrong post-hoc.
- The diff-review + commit + push gate gives the same safety the merge step gave before, with simpler mechanics.

See `[[feedback-always-delegate]]` for the broader delegation rule and `[[feedback-parallel-agents]]` for the parallel rule.
