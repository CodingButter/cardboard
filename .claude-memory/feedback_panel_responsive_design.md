---
name: feedback-panel-responsive-design
description: Every scene-panel body build must be heavily responsive. Avoid native scrollbars; use the TabStrip-style hover-to-auto-scroll pattern as the universal overflow primitive.
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

Dock panels in the editor render at **unpredictable sizes and shapes** — the dockview layout is fully user-configurable, panels can be popped out, narrow rails can shrink to ~150px, wide spans can stretch to 1000px+. Every panel-body agent must design for that from the start.

**Overflow rules:**

- **Vertical scroll** — native scrollbars are acceptable (the editor already themes them via the global `*::-webkit-scrollbar-*` rules in `apps/editor/index.css`).
- **Horizontal scroll** — **no native horizontal scrollbar**. Use the hover-area pattern from `apps/editor/src/components/ui/TabStrip.tsx` (`scrollable={true}` mode):
  - Edge fades only appear when the content actually overflows the panel width (`ResizeObserver` + `scrollWidth` comparison).
  - Hovering an edge fade triggers continuous auto-scroll in that direction.
  - Clicking a fade jumps to the extreme.
  - When content fits, no fades, no chrome.
- **Per-row, not per-panel**: if a panel has multiple rows of items (e.g. ToolPalette's 3×2 grid), each row scrolls horizontally *independently*. A user dragging the second row doesn't pull the first row off-screen. Implementation: each row gets its own `<ScrollRow>` container; don't share a parent overflow.

**Minimum sizes:** every tile / button must have a `min-w-*` that prevents collapse below something useful (Tools panel tile minimum: 50–60px). Without this, flex/grid layouts squish tiles into unreadable slivers when the panel is narrow before the scroll kicks in.

**Responsive logic is per-panel, not universal.** No one-size-fits-all primitive — different panel contents need different behaviour. The team explicitly rolled back the earlier "every panel uses the same reflow pattern" framing. What's universal: every panel should *think about* wide / tall / square dock shapes when its body is built.

**For button-or-icon grids specifically** (Tool palette, Brush kinds, Layer toggles, Quick-tools): the auto-fit + minmax reflow is the natural fit — items have min AND max widths, the grid reflows from vertical-stack to horizontal-row as the panel widens.

```tsx
// Tool tiles example (min 56px, max 80px):
<div className="grid gap-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(56px, 80px))' }}>
  {tiles}
</div>
```

**For other content types** (lists, tables, charts, forms, code editors, canvas regions): use whatever makes sense — native vertical scroll for long lists, fixed aspect ratios for previews, etc. Document the choice in the panel's docstring.

**Per-panel agent briefs must call out**:
- What aspect ratios the panel might see (narrow-tall, wide-short, square).
- The agent's specific strategy for each (e.g. "narrow-tall: 1-col tile stack with vertical scroll; wide-short: tiles in a horizontal row with ScrollRow fallback if min-width can't fit; square: auto-fit minmax reflows naturally").

**Why:** The user explicitly flagged this — native scrollbars look out of place in the editor's flat-chrome aesthetic and feel imprecise in narrow panel widths. The TabStrip pattern was the canonical scroll affordance in the topbar tab row; subsequent panels should generalize it.

**How to apply:**

1. Every panel-body agent brief must include: "responsive design is a HEAVY focus; panel widths/heights are unpredictable. Use the TabStrip `scrollable` pattern from `apps/editor/src/components/ui/TabStrip.tsx` as the overflow affordance — never expose native scrollbars."
2. The first panel agent that needs vertical-scroll behavior should extract the pattern into a shared `<ScrollArea>` primitive under `apps/editor/src/components/ui/` rather than re-implement it inline. Future panels import that primitive.
3. Content density must adapt — short labels on narrow widths, full labels on wide. Use `@container` queries or `ResizeObserver` where Tailwind responsive breakpoints (window-width based) won't help, since panel widths don't track the window.
4. Tile/button grids should use `grid-cols-[repeat(auto-fit,minmax(40px,1fr))]` or similar so the layout reflows naturally. Avoid fixed-column-count grids unless the spec explicitly requires it (ToolPalette's 3×2 is one of the explicit-grid exceptions).
