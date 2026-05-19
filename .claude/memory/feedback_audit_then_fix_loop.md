---
name: feedback-audit-then-fix-loop
description: "For panel polish work, run a two-agent loop per panel — a thorough AUDIT agent first (returns findings), then a focused FIX agent that acts on those findings. Sequential per panel. Orchestrator writes detailed briefs for both."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "i think when this lands you should have an indivudal agent audit a set panel thoroughly then once the audit agent lands another focused agent will take that feedback and act on it. you provide detailed direction, what the audit agent is looking for and exactly what things should look like, the agent comes back with its findings and you dispatch an agent to address them. this is important."

**The pattern:**

For each panel that needs polish:

1. **Orchestrator** writes a detailed audit brief:
   - Path to the panel file.
   - Path to the design reference (`Editor Design/Map.png` or specific zoomed screenshots).
   - A specific checklist of what the audit agent is looking for: visual issues, alignment to design, density, spacing, color, typography, missing affordances, broken responsive behavior.
   - The expected look at default panel size + any other relevant viewports.
   - Constraints (engine context, raycaster, command registry, tooltip wrap, no native title=).
   - Output format: a structured findings report — one finding per issue, with screenshot evidence.

2. **Audit agent** runs:
   - Reads the panel file + design reference.
   - Uses Playwright on its own tab to navigate the editor.
   - **Actively interacts** with the panel — resizes the dock panel by dragging splitters (or sets dockview `setConstraints` via the api ref / programmatic resize via JS), takes screenshots at multiple sizes (narrow ~150px, medium ~280px, wide ~500px+, tall, short). Verifies the panel doesn't break, lose content, scroll horizontally, or render unreadably at any reasonable size.
   - Compares against the design checklist at each size.
   - Reports findings — does NOT modify any code.
   - Returns a structured list of issues with screenshot paths at each tested size.

3. **Orchestrator** reviews findings:
   - Validates they match the original intent.
   - Adds any context the audit missed.
   - Decides which to act on.

4. **Orchestrator** writes a detailed fix brief:
   - The exact list of audit findings to address.
   - Specific implementation guidance per finding.
   - Same hard requirements (tooltips, registry, etc.).
   - Verification steps for the fix.

5. **Fix agent** runs:
   - Applies the fixes one by one.
   - Verifies via Playwright (own tab).
   - Commits + pushes to main directly.

6. **Orchestrator** reviews the fix:
   - Pulls origin, inspects the diff and the after-screenshot.
   - If the fix is solid, marks the panel done.
   - If not, repeats from step 4 with refined direction OR step 1 with a focused re-audit.

**Why this works:**

- Audit and fix have different cognitive shapes — audit needs to be critical and thorough; fix needs to be surgical and precise. Splitting them lets each agent be excellent at one job.
- The orchestrator's review-of-findings step is where high standards get enforced. The user said "be very critical" — that critical lens applies to the AUDIT brief AND the FIX brief AND the post-fix review.
- One panel at a time avoids context contention. Two parallel "this panel + that panel" agents can collide on shared design tokens or scene-fixture types.

**When NOT to use this pattern:**

- Building NEW panel content from scratch: a single build agent is fine (the equivalent of audit-then-fix is built in — they audit Map.png while building).
- Trivial single-line fixes: just do it directly in the orchestrator.
- Broad sweeps that touch every panel (e.g. "change tooltip timing across all panels"): a single sweep agent or orchestrator-driven sed pattern.

**Related rules:**
- [[feedback-no-worktrees]] — both audit and fix run in main checkout.
- [[feedback-wave-merge-gate]] — orchestrator must confirm previous fix is fully merged before starting next panel's audit.
- [[feedback-agent-playwright-contention]] — audit and fix agents must each open their own Playwright tab.
