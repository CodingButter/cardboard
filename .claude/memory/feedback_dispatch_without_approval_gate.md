---
name: feedback-dispatch-without-approval-gate
description: "User trusts my dispatch decisions — don't pause to seek explicit approval on agent briefs / panel picks / similar judgement calls."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

When the next step is clear, just dispatch and report in a one-line voice update. Don't ask "say go" or "approve the brief?" before launching agents.

**Why:** Mid-session the user said `I dont need to approve your decision you're fine` after I had been pausing on each dispatch to seek approval (panel pick, brief drafting, etc.). Asking adds latency and treats them like a checkbox approver instead of a collaborator. They'll redirect mid-flight if they disagree.

**How to apply:** Dispatch immediately when the decision is clear. Continue to confirm only when the call is genuinely ambiguous (e.g. "tree is dirty in a way that could lose work — commit before dispatching?", "the user's two earlier requests conflict — which do you want?"). Routine briefs and panel picks just go.

This complements [[feedback-always-delegate]] — that one says always use a subagent; this one says don't gate the dispatch on approval.
