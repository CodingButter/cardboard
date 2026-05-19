---
name: feedback-no-horizontal-scroll-for-categories
description: "Category/filter chip strips and similar discoverable navigation surfaces must NEVER use horizontal scrolling. If chips don't fit on one row, wrap to two rows. ScrollRow is for content overflow, not navigation."
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7c1d9c99-8bc0-445e-84a2-2fadbbb70b5c
---

User direction: "really think about the user experience and if a certain visual layout or look actually is acceptable. for instance the tile presets category selectors are in a horizontally scrolling section this is really ugly and not professional they should probably be given enough room to exist on 2 rows or something that removes the horizontal scrolling".

**Hard rule:** Category filter chips, tab strips for filter navigation, and similar small-discrete-navigation surfaces must NEVER horizontally scroll. Horizontal scroll on these surfaces:

- Hides options the user needs to discover ("All / Walls / Floors / Ceilings / Decor" — they all need to be visible).
- Feels unprofessional — it's the kind of thing budget templates do.
- Adds an extra interaction (scroll edge, hover, etc.) for what should be a one-tap pick.

**What to do instead:**

1. **Wrap to multiple rows.** A 4-chip strip that doesn't fit on one row becomes 2 rows of 2. Flex-wrap is your friend.
2. **Use smaller chips or icons** if real estate is tight. A chip with just an icon + count is fine for "All (8) / Walls (3) / Floors (2)" when widths are narrow.
3. **At very narrow widths** (~<140px), if even 2 rows don't fit, switch to a single icon-only kebab or "More…" dropdown. But that's a last resort — wrap rows are almost always enough.

**Where `<ScrollRow>` IS appropriate (it's not banned, just don't put it here):**
- Long content lists with no discoverability requirement (e.g. a media gallery, a recents list of tens of items).
- Tag clouds where overflow into a "more" is acceptable.
- Anywhere a horizontal scroll is genuinely the most natural interaction (e.g. a horizontal carousel of large preview cards).

**Audit checklist for any chip strip you're tempted to put in `<ScrollRow>`:**
- Are these chips a primary navigation surface (filters, tabs, modes)? → NO ScrollRow. Wrap rows.
- Is the user expected to discover all options at a glance? → NO ScrollRow.
- Is the option count fixed and small (≤8)? → NO ScrollRow.
- Is it a search-results-style overflow where seeing "20 more" makes sense to scroll? → ScrollRow is OK.

**Concrete pattern for category strips:**

```tsx
{/* Wrap to 2 rows if needed. No ScrollRow. */}
<div className="flex flex-wrap gap-1">
  {CATEGORIES.map((c) => (
    <Chip key={c.id} active={c.id === active} onClick={...}>
      {narrowWidth ? <c.icon /> : <><c.icon /> {c.label} ({c.count})</>}
    </Chip>
  ))}
</div>
```

**Where this applies in the editor:** TilePresetPanel category strip, PrefabBrowserPanel category strip, AssetReferencesPanel kind filter, ProblemsPanel level filter, OutputPanel level filter — anywhere agents have wrapped category chips in `<ScrollRow>` historically. They all need a sweep.
