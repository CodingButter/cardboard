---
name: feedback-progressive-tooltips
description: "Project-wide standard for hover tooltips — two-stage progressive reveal (2s short name, 5s full description) via the shared `<Tooltip stages={...}>` primitive. Apply to every interactive element where context-on-hover is useful."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

The editor uses a **progressive tooltip** as its standard hover affordance everywhere: page tabs, dock panel buttons, action buttons, settings toggles, scene-selector dropdown items, status bar chips — anywhere the user might pause over a control.

**The two-stage timing contract:**

- **2 seconds hover** → tooltip appears with the element's **short name / label** (e.g. tool name, tab title, button text).
- **5 seconds hover** → tooltip swaps to show the **short name AND a fuller description** (1–2 sentence explanation of what the control does).
- Hover-away cancels both pending stages and hides the tooltip immediately.

**Why staged:**

- 2s is short enough that an intentional hover surfaces help quickly, long enough that a passing cursor doesn't pop tooltips everywhere.
- 5s is the "I'm genuinely confused, what does this do?" reveal. Most users never see stage 2 — and that's fine; the short label handles the common case.
- Single threshold (always show full description at 2s) would be too noisy; never showing the description at all would be too sparse for an editor with many controls.

**Implementation:** the shared primitive is `apps/editor/src/components/ui/Tooltip.tsx`, extended in the `progressive-tooltips` PR to support a `stages?: TooltipStage[]` prop:

```tsx
<Tooltip
  stages={[
    { delay: 2000, content: <span>{control.label}</span> },
    { delay: 5000, content: (
      <div>
        <div className="font-semibold">{control.label}</div>
        <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[240px]">
          {control.description}
        </div>
      </div>
    ) },
  ]}
>
  <Button ... />
</Tooltip>
```

The single-`content` Tooltip mode is still supported and used for trivial labels (e.g. a close button), but new interactive content should default to the staged pattern.

**Data source:** every interactive control's label and description should live on its fixture / config / manifest entry so the tooltip wraps it consistently. For tools: `MOCK_TOOLS[].description`. For page tabs: extend the tab config. For panel manifests: consider adding `description?: string` to `DockPanelDef`.

**Apply throughout future panel agent briefs:** every panel-build dispatch must include "wrap interactive controls in `<Tooltip stages={...}>` per [[feedback-progressive-tooltips]]". The 2s/5s timing is project-wide and shouldn't be tuned per-panel.
