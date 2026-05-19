# Page Build Process

A reference playbook for building out every page in the Cardboard editor.
Refined from the Scene page sprint (May 2026), which served as the proving
ground for the agent-orchestration and panel-development patterns
documented here. Future page builds — Prefabs, Components, Assets,
Scripts, Animation, Image Lab, Sound Lab, UI Builder, Project — follow
this process.

The goal is twofold: (1) end up with a page that matches `Editor Design/<Page>.png`
in visual fidelity and density, and (2) get there without thrashing the
agents or the repository.

---

## Phase 0 — Inputs

Before any code is touched, gather:

1. **The design reference**: `Editor Design/<PageName>.png` (e.g.
   `Map.png` for the Scene page). If no design exists, do not start —
   create or commission one first. Trying to build "to spec" without a
   reference creates infinite redo loops.
2. **The engine context for this page**: what is the user actually
   doing on this page, and how does it interact with the
   `packages/engine` API? Identify the domain primitives (cells, tiles,
   entities, components, assets) the page manipulates. Capture in a
   one-paragraph mental model — this anchors every panel's purpose.
3. **The relevant plan doc**: `docs/PLAN.md` and any related
   `docs/plans/<feature>.md`. Cross-reference the phase this work
   completes so the status table updates correctly at the end.
4. **The list of panels** the page hosts, from `EDITOR_DESIGN_INVENTORY.md`
   or the design reference itself. Split into "default visible" and
   "opt-in" (added via DocksModal).
5. **Tooling state**: dev server reachable on `http://localhost:3001/`;
   Playwright MCP available; `bun run typecheck` from `apps/editor/`
   exits 0 on a clean tree.

---

## Phase 1 — Pre-stage shared data

Before dispatching any panel-build agent, the orchestrator commits the
shared pieces all panels will read from. Doing this in one commit, on
`main`, BEFORE the panels build means each panel agent only touches its
own file — no contention on shared fixtures.

What to pre-stage:

1. **Fixtures**: add MOCK_* entries to `apps/editor/src/views/<page>/<page>-fixtures.ts`
   for every panel that needs data. Each fixture gets a typed interface
   with an optional `description?: string` field — that description
   powers the panel's progressive Tooltip stage-2 content. Pre-populating
   the descriptions is the orchestrator's job; the panel agent should
   not need to invent them.
2. **Shared types** that cross panels (e.g. selection state, active
   layer ID): add to a `<page>-types.ts` or extend the appropriate
   zustand store.
3. **Panel manifest stubs**: `apps/editor/src/views/<page>/panels/<PanelName>Panel.tsx`
   as 24-line stubs exporting `MANIFEST` + a placeholder component.
   This lets the page view (`<Page>View.tsx`) import them upfront so the
   build agents can fill in bodies without touching the page shell.
4. **`<Page>View.tsx` shell**: a DockShell-hosting view with a
   `buildDefaultLayout()` returning the initial dockview JSON. Sizes
   here are relative weights (see Phase 4 for tuning); start with even
   distribution and rebalance later.
5. **Workspace rail wiring**: add the `<WorkspaceRail/>` sibling on the
   page so users can open the Layouts / Docks / Settings / Help modals.

**Commit:** `editor: <page>-fixtures — add MOCK_<X> / MOCK_<Y>` and
`editor: <PageName> — panel stubs + default layout shell`.

---

## Phase 2 — Build panel bodies

Each panel body is built by a single Agent dispatch. The dispatch
strategy depends on file overlap:

- **Non-overlapping files** (each agent only touches its own `Panel.tsx`):
  parallel dispatch is allowed. Aim for batches of 4-6 agents max so the
  orchestrator can integrate them as they land.
- **Overlapping files** (multiple agents need to extend the same
  `<page>-fixtures.ts` or a shared component): serialize. Run one agent
  at a time. Cost is a few extra minutes; benefit is zero merge
  conflicts.
- **Never use git worktrees**. See [No worktrees](../<.claude memory>/feedback_no_worktrees.md) —
  WSL VHDX corruption + cwd race conditions cost us hours. Agents run
  in the main checkout and commit + push directly.

### Brief structure (every panel build dispatch must include)

```markdown
# Working directory
/home/codingbutter/development/cardboard — main checkout. NO worktrees.
Commit + push directly to main.

# Visual target
- Quote the Map.png region this panel maps to.
- Default panel size in the layout (e.g. ~230×190px).
- Density expectations (e.g. "6+ items visible at default size").

# Data source
- Specific exports from <page>-fixtures.ts (named).
- LocalStorage persistence keys (named).

# Command registry (CRITICAL)
- Required command IDs in `<page>.<panel>.<verb>[.<id>]` shape.
- Reference: apps/editor/src/state/README.md for the handler-ref +
  useEffect mount pattern.

# Progressive tooltips
- Every interactive control wrapped in <Tooltip stages={[
    { delay: 1000, content: <span>{label}</span> },
    { delay: 3000, content: <div><div>{label}</div><div className="...max-w-[400px]">{description}</div></div> },
  ]}>.
- NO native `title=` attributes anywhere.

# Responsive design (HEAVY focus — agent owns)
- Panel renders at unpredictable sizes — agent picks strategy.
- Vertical scroll OK; horizontal scroll is NEVER OK for nav surfaces.
- Use ResizeObserver for breakpoints (no @container queries today).
- Wrap rows for category strips; <ScrollRow> is content-only.

# Reference files
- ToolPalettePanel.tsx is the canonical precedent for LS helpers,
  tooltip stages, dynamic command registration.
- The most-similar already-built panel for layout precedents.

# Verification
1. `bun run typecheck` from apps/editor/ → exit 0.
2. Playwright (OWN tab via browser_tabs new + select).
3. Screenshot to `screenshots/build-<panel>-after.png`.
4. Critical self-assessment vs Map.png target.

# Commit
- `git add` + `git commit -m "editor: <PanelName>Panel — <one-line>"` + Co-Authored-By trailer.
- `git push origin main`.
```

After each panel lands, the orchestrator pulls main, typechecks, and
moves to the next. The [Wave merge gate](../<.claude memory>/feedback_wave_merge_gate.md)
rule is hard: never dispatch the next agent until the previous one is
fully merged + pushed.

---

## Phase 3 — Wire the layout

Once all panels are built, the orchestrator visits `<Page>View.tsx` and
tunes the `buildDefaultLayout()` JSON:

- Sizes are relative weights — what matters is the ratio between
  siblings. Total of a branch's children sums to that branch's `size`.
- Use sizes that reflect content density, not equal thirds. Example
  from Scene page rebalance: Tools/Brush dropped from 207/207/209 to
  110/110/403 because Tools and Brush content is tight (~120px) and
  Tile Presets benefits from height.
- `surface: false` and `headerless: true` flags in the panel registry
  (not the layout) for canvases, console-style strips, status bars.
- Pre-tune for the design reference's proportions, not the maintainer's
  workspace. The default layout is what a fresh project sees.

Persisted layouts in `localStorage` under
`cardboard_workspace.state.dockLayouts[<page>::<projectId>]` override
the default. Existing projects keep their saved layout until the user
hits "Reset Layout" via the workspace rail.

**Commit:** `editor: <PageName> default layout — rebalance for content density`.

---

## Phase 4 — Holistic visual audit

After Phase 3, the orchestrator runs a full-page visual audit via
Playwright:

1. Clear `cardboard_workspace.state.dockLayouts[<page>::<projectId>]`
   (the persisted override) so the new defaults take effect.
2. Hard-reload via `browser_navigate` to `about:blank` then to the page
   URL.
3. Take a full-viewport screenshot to `screenshots/audit-<page>-overview.png`.
4. Take per-panel zoom screenshots via the `target` selector.
5. Compare each panel against `Editor Design/<PageName>.png`'s
   corresponding region.

The orchestrator's audit catches what individual agents can't:
- Cross-panel visual consistency
- Layout proportions vs design ref
- Whitespace / dead-space issues
- Color and typography drift between panels

---

## Phase 5 — Audit-then-fix loop per panel

For each panel that doesn't match the design or has UX issues, run a
two-agent loop:

### 5a. Audit agent

Orchestrator writes a detailed audit brief with:
- Specific path to the panel file and its current screenshot.
- The corresponding Map.png region (cropped if needed).
- A checklist of what to look for: density, alignment, color, typography,
  missing affordances, responsive behavior, tooltip coverage.
- The expected look at default panel size.
- Output format: structured findings — one issue per item with screenshot
  evidence.

The audit agent:
- Reads the file + design ref.
- Uses Playwright (own tab) to capture the current state.
- **Actively resizes the panel** to verify it works at multiple
  reasonable sizes — narrow (~150px), medium (~280px), wide (~500px+),
  tall, short. Either by dragging the dockview splitters in the
  Playwright session or by programmatically setting the panel
  `getBoundingClientRect`-derived width via dockview's api. Screenshots
  at each size to confirm the responsive logic holds.
- Compares against the checklist at each size.
- Returns a findings report. Does NOT modify code.

### 5b. Orchestrator review

- Validate findings match the original design intent.
- Add any context the audit missed.
- Decide which findings to act on (some may be deferred to later
  phases, e.g. real data wiring).

### 5c. Fix agent

Orchestrator writes a detailed fix brief with:
- The exact list of audit findings to address.
- Specific implementation guidance per finding (sizes, colors,
  components to use).
- Same hard requirements (Tooltip stages 1s/3s, command registry, no
  native `title=`, responsive ResizeObserver).
- Verification steps: typecheck + Playwright screenshot + critical
  self-assessment.

The fix agent:
- Applies fixes one by one in the main checkout.
- Verifies via Playwright (own tab).
- Commits + pushes to main.

### 5d. Orchestrator post-fix review

- `git pull origin main`.
- Inspect the diff and the after-screenshot.
- If the result matches the design intent, mark the panel done.
- If not, return to step 5c (refined fix brief) OR step 5a (focused
  re-audit if the agent misread the requirement).

**Be very critical.** Don't accept "this is close" — return to the
audit-fix loop until the result genuinely matches Map.png at the target
density.

---

## Phase 6 — Tooltip coverage sweep

After all panels are polished, run a comprehensive tooltip coverage
check. Every interactive surface in the page MUST have a progressive
Tooltip wrap.

The Tooltip primitive (`apps/editor/src/components/ui/Tooltip.tsx`):
- Portals to `document.body` and uses `position: fixed` so it escapes
  ancestor `overflow` clipping.
- `stages` prop with 1s short label and 3s long description.
- `max-w-[400px]` on the description body — anything narrower wraps too
  tightly.

Sweep checklist:
- Every `<button>`, `[role="button"]`, `[role="tab"]`, clickable `<div>`
  → wrapped in `<Tooltip stages={...}>`.
- Every `<a href="...">` link → wrapped, even external links (they get
  a description like "Opens in a new tab").
- Modal trigger buttons in the page shell.
- Workspace rail icons (already covered globally — verify on this page).

Anti-pattern to flag and strip:
- Native `title=` attributes on any interactive element. These fire a
  separate, faster, ugly browser tooltip that conflicts with the portal
  Tooltip. Remove every one.
- Single-stage `content=` Tooltip mode for new interactive elements —
  always use `stages=` so the 1s/3s contract is uniform.

This sweep can be a single sweep agent if the page is broad, or done
inline by the orchestrator with `sed` for trivial pattern replacements.

**Commit:** `editor: <PageName> — comprehensive tooltip coverage sweep`.

---

## Phase 7 — Document + status update

After the page lands:

1. **Update `docs/PLAN.md`**: append a one-line entry to the phase
   status table marking the page complete.
2. **Update `docs/SESSION_STATE.md`**: if the page work spanned a
   long session, capture an open-task / decision snapshot.
3. **Update `docs/EDITOR_DESIGN_INVENTORY.md`**: tick off the page's
   panels in the inventory and add any decisions made along the way.
4. **Tag the page-complete commit**: `git tag scene-page-complete` (or
   similar). Tags give a fast revert point if a later page accidentally
   breaks this one.

---

## Hard rules (page-build invariants)

These apply at every phase and to every agent dispatch:

1. **No worktrees.** Agents run in the main checkout, period.
2. **Commit + push at every checkpoint.** Every orchestrator-level edit,
   every agent's work-product, every audit-fix iteration. Frequent
   commits = always-revertable.
3. **Wave merge gate.** Never dispatch the next agent until the
   previous one is fully merged to main, typechecks clean, and is
   pushed.
4. **One Playwright tab per agent.** Agents open their own tab via
   `browser_tabs new`, switch via `select`, close at end. The
   orchestrator's tab stays untouched.
5. **Command registry.** Every interactive action registered via
   `registerCommand`. The button's `onClick` and the registered `run`
   delegate to the same handler via a ref — never duplicate logic.
6. **Progressive Tooltips, no native title.** 1s short label, 3s label
   + description, `max-w-[400px]`, portaled to body. Native `title=`
   attributes get stripped.
7. **Responsive per-panel.** Each panel owns its breakpoint logic via
   `ResizeObserver`. Vertical scroll allowed; horizontal scroll never
   on navigation surfaces.
8. **Visual fidelity to design ref.** Every panel is judged against
   `Editor Design/<PageName>.png`. "Close" is not good enough — iterate
   until it matches.
9. **TTS for every milestone update.** Voice carries the substantive
   finding, not a placeholder ("checking now").
10. **No worktrees.** (Worth saying twice.)

---

## Phase summary cheat-sheet

| Phase | What | Output |
|---|---|---|
| 0 | Gather inputs (design ref, plan, engine context, panel list) | Read-only |
| 1 | Pre-stage fixtures + types + panel stubs + page shell | 2 commits |
| 2 | Build panel bodies (parallel or sequential) | 1 commit per panel |
| 3 | Wire default layout (`buildDefaultLayout()`) | 1 commit |
| 4 | Holistic visual audit (orchestrator) | Findings + screenshots |
| 5 | Audit-then-fix loop per panel needing polish | 2 commits per panel (audit findings + fix) |
| 6 | Tooltip coverage sweep + native `title=` strip | 1 commit |
| 7 | Update plan/inventory/session-state docs + tag | 1 commit + 1 tag |

Total for a typical page (~10 panels): ~15-20 commits, all on `main`,
all pushed. Every step revertable.
