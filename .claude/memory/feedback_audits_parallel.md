---
name: audits-parallel
description: Audits are read-only by nature; ALWAYS parallelize them with other work (another audit, code edits in disjoint files, doc updates, planning). Never sit idle waiting for an audit to finish.
metadata:
  type: feedback
---

**Rule:** Audits are read-only by nature. Dispatch them with
`run_in_background: true` and IMMEDIATELY pick up the next piece of
disjoint work (another audit, code edits in non-overlapping files,
doc updates, planning, memory hygiene) without waiting for the audit
to finish. The completion notification arrives when ready; you're
not blocking on it.

**Why:** Jamie, 2026-05-20 — *"i feel like audits can always be
paralellized with other audits or actual work. audits are by nature
read only."* Sitting idle while an audit runs wastes session length
and burns Jamie's wall-clock time. Audits don't write files, so they
never collide with parallel edits. The only constraint is "don't
edit files the audit needs to read at the same moment it's reading
them" — but the audit captures snapshots progressively, so even that
is a soft constraint.

**How to apply:**

- **When dispatching an audit, immediately decide what comes next**:
  another audit (the same parallel-audits memory applies recursively),
  a known code fix on a disjoint file tree, a doc update, memory
  hygiene, planning for the next phase.
- **Hard avoid**: "the audit is running, I'll wait for the result."
  That phrase is the bug. Always end an audit-dispatch turn with
  parallel work already in motion.
- **Soft constraint**: don't dispatch a FIX agent against the same
  area the audit is auditing — wait for the findings. But you CAN
  do other work, including unrelated FIX agents, plan docs,
  refactors in different file trees.
- **The single exception**: when the audit findings dictate the next
  step (e.g. "audit-then-fix loop" per
  [[feedback-audit-then-fix-loop]]) and there's literally nothing
  else queued. Then idle-wait is acceptable. But check the task list
  first — usually something IS queued.

Related:
- [[feedback-parallel-agents]] — independent agents dispatch in one
  message so they run concurrently.
- [[feedback-audit-then-fix-loop]] — the 2-agent pattern this rule
  composes with.
- [[feedback-always-delegate]] — non-trivial work goes to agents; if
  multiple non-trivial streams exist, they should fan out in
  parallel.
