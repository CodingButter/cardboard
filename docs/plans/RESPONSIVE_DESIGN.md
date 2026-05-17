# Responsive design

A canonical plan for making the cardboard editor look and behave
correctly across desktop, tablet, and phone viewports. **Doc-only.**
Implementation lands in phases RE2–RE5 after this plan (RE1) is
merged. Every existing feature stays; this plan is about layout,
chrome, and primitives that the editor needs to gracefully degrade
from a 27" monitor down to a 6" phone screen.

This doc is the **HOW IT SCALES**. It is paired with
[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md), which remains the **HOW
IT LOOKS** spec (palette, primitives, per-view re-skins). Where this
doc adds responsive contracts to a view, the parent re-skin in
EDITOR_REDESIGN §7 is the desktop baseline; this plan describes
what changes at the tablet and phone tiers.

Cross-refs: [EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md) (R-phase
parent), [EDITOR_IFRAME.md](./EDITOR_IFRAME.md) (Playtest takes
over viewport on phone), [IMAGE_LAB.md](./IMAGE_LAB.md) and
[SOUND_LAB.md](./SOUND_LAB.md) (their tablet/phone behaviour), the
existing R4-migrated view files in `apps/editor/src/views/`
(HomeScreen.tsx, EntitiesEditor.tsx, GridEditor.tsx, MapView.tsx,
ProjectTabView.tsx), `apps/editor/src/shell/` (EditorShell.tsx,
TopBar.tsx, PrimaryTabs.tsx, StatusBar.tsx),
`apps/editor/src/components/ui/index.ts` (R2 primitive barrel),
`apps/editor/index.css` (Tailwind v4 `@theme` block).

Last revised: 2026-05-16.

---

## 0. tl;dr

The editor today targets desktop and silently breaks below ~1280px:
pinned-pixel rails (`w-72`, `grid-cols-[1fr_380px]`, fixed-width
TopBar dropdown fields) overflow, both horizontal and vertical
scrollbars appear, and there is no concept of "this view is
unauthorable on a small screen — show a fallback." The result is a
broken-looking app at any non-desktop resolution, which the user
correctly flagged as a professionalism gap.

This plan introduces a three-tier responsive model:

- **Desktop (≥1280px)** — full editor. Everything works as it does
  today. This is the only authoring-grade tier.
- **Tablet (768–1279px)** — editor with collapsible drawers. Side
  rails become Drawers (slide-out panels triggered by hamburger
  buttons), TopBar condenses to icons + tooltips, PrimaryTabs become
  horizontally scrollable, StatusBar drops low-priority sections.
  Authoring is possible but slightly indirect.
- **Phone (<768px)** — view, browse, and play. Most authoring views
  show a ResponsiveGuard EmptyState ("Use a larger screen to edit
  this surface"). The phone experience is: pick a project, browse
  assets read-only, see project metadata, and **playtest** the pack
  full-screen. Authoring is explicitly **not** a goal.

Six new primitives (Drawer, Sheet, BottomNav, Hamburger, TouchButton
variant, ResponsiveGuard) plus shell-level adaptations across
TopBar, PrimaryTabs, and StatusBar make this possible. Per-view
contracts (§7) spell out exactly what happens to each existing
PrimaryTab at each tier. Rollout is phased RE1–RE5, with RE4
parallel-safe per view (mirrors EDITOR_REDESIGN R4's structure).

Phone is **deliberately constrained**. There is no value in
pretending Monaco script editing or a node-graph Image Lab works on
a 6" screen, and a half-broken authoring view is worse for cardboard's
positioning than an honest "open this on desktop" guard. This is the
right tradeoff.

---

## 1. Goals & non-goals

### Goals

- **No broken layouts at any viewport width.** Shrinking the window
  to a tablet or phone width should never produce double scrollbars,
  truncated TopBars, or content visually clipped behind another
  panel. Every view either gracefully reflows or shows an explicit
  "this view requires a larger screen" surface.
- **First-class tablet support.** iPad-class devices (768–1279px,
  primary input: touch) are a real authoring surface, not just a
  reduced-functionality version of desktop. Side rails become
  Drawers; the editor stays usable.
- **Honest phone support.** Phone (<768px, primary input: touch) is
  a **browser of work + game player**, not an authoring tool. Home
  works, Playtest works, Assets browse works, Project metadata
  reads. Everything else shows a "use a larger device" guard.
- **One responsive system across all views.** Each PrimaryTab gets
  one tier-specific contract (§7). No view invents its own breakpoint
  logic. The shell + primitives + Tailwind tokens cover the cases.
- **Touch-input affordances where they matter.** Tap targets meet
  WCAG 2.1 / Apple HIG minimums (44×44pt). Drag, pinch, and pan are
  disambiguated where the view needs them (Map canvas, Image Lab
  graph). The same components still work cleanly with a mouse — touch
  is additive, never replacement.
- **Honest visible degradation.** When a feature isn't available on
  a smaller tier, the user sees an EmptyState explaining why and
  what to do — never a silently-missing button or broken layout.
- **Phased rollout that doesn't break the desktop editor.** Each
  RE phase is a coherent commit. Desktop never regresses; tablet
  and phone improve view-by-view.

### Non-goals

- **Not a Tailwind major-version bump.** Tailwind v4 stays. New
  breakpoint tokens go in the `@theme` block of
  `apps/editor/index.css`.
- **Not a full mobile-first rewrite.** Desktop remains the design
  baseline; tablet and phone are adaptations of the desktop layout,
  not separate apps. This matches the user's stated direction
  ("full editor on desktop, mostly-full on tablet, hamburger +
  reduced functionality on phone").
- **Not adopting a mobile UI library.** No Framework7, no Ionic,
  no Onsen UI. Cardboard's hand-rolled primitives extend with six
  more primitives in RE2 — same conventions, same Tailwind tokens.
- **Not native-app shells.** PWA standalone mode is supported
  (cf. #242) but no Cordova / Capacitor / Tauri wrapper. The phone
  experience is a browser experience.
- **Not authoring on a phone.** Map painting, prefab editing,
  Monaco scripting, node-graph procedural authoring, animation
  timeline editing, UI Builder dragging — none of these get phone
  implementations. The cost vastly exceeds the value. Phone =
  consumption tier.
- **Not a desktop layout reflow on resize-down.** Once the window
  crosses below the desktop breakpoint, the layout switches to the
  tablet grammar — it doesn't try to scale the desktop layout. This
  avoids weird intermediate states where rails are 100px wide and
  unusable. Breakpoint-driven, not fluid-scaled.
- **Not a redesign of pack-shipped engine modals.** Pack authors
  build their own UI via `api.ui.*`. Whether that UI is responsive is
  the pack author's problem, with utilities to help (future task).
  This plan is editor-chrome-only.
- **Not handling sub-320px viewports.** Below 320px (i.e. legacy
  phones) we show a single "your screen is too narrow — please use a
  device with at least 320px of width" message. Not worth designing
  for.

---

## 2. Status quo (what breaks today)

The editor today is built around three implicit assumptions that all
fail outside desktop:

1. **Fixed-pixel side rails.** `EntitiesEditor.tsx` line 609 / 855
   uses `w-72` (288px) for both left and right `<aside>` rails;
   `MapView.tsx` line 206 uses `grid-cols-[1fr_380px]` for its
   inspector column. On a 1024px-wide tablet, the rails consume
   576px (288 × 2) + a 380px inspector + center canvas, totalling
   well over the available width — the center canvas collapses to
   ~60px wide and the inspector horizontally overflows. **Result**:
   horizontal scrollbar on the document, broken layout.

2. **No-scroll inner panes.** The shell wraps `<main>` in
   `overflow-hidden` (EditorShell.tsx line 411) so the only scroll
   is inside individual panels. When those panels themselves don't
   have `overflow-auto` set on the right children (e.g. some
   inspector cards), content clips invisibly instead of producing a
   scrollbar. **Result**: data hidden, no visual cue.

3. **TopBar assumes ~960px+ of right-side action space.** TopBar.tsx
   renders the brand block, two 224px dropdown fields (PROJECT,
   SCENE), and four action buttons (Playtest, Export, Save, Settings)
   in a single non-wrapping flex row. On viewports below ~1100px,
   the right-side actions wrap below the brand and bleed into the
   PrimaryTabs row, or the dropdowns truncate to single-character
   labels. **Result**: chrome breaks before any view does.

4. **PrimaryTabs has no scroll behaviour.** 10 tabs at ~110px each
   = ~1100px of tab strip. Below 1100px the tabs overflow and
   either truncate (no `overflow-x-auto` on the strip) or push
   StatusBar off-screen. **Result**: tabs become un-clickable on
   tablet portrait.

5. **No "this view is too complex for your screen" surface.** Every
   view tries to render at any width, with no concept of "skip this
   view on phone." The result on a 393px-wide iPhone is each view
   rendering at ~120px usable, with sliders and property rows
   compressed below their minimum readable form.

6. **No touch tap targets sized for fingers.** Most buttons are 32px
   tall (`size="sm"` in Button.tsx). On touch, the minimum target
   is 44×44pt per Apple HIG / WCAG. Buttons are tappable but
   awkward — easy to mis-tap adjacent rows.

7. **Drag, pan, and pinch are mouse-only.** GridEditor's pan-canvas,
   AnimationEditor's timeline scrub, Image Lab's node-graph drag —
   all are wired to `mousedown` / `mousemove` only. On touch, they
   fall back to native browser behaviour (page scroll on drag,
   pinch-zoom on the page) which is wrong.

8. **No detection of phone clients in the routing layer.** A user
   following a `#/p/<id>` deep-link from a phone lands in the Map
   view with the broken layout described above. There is no "phone
   landing" experience.

9. **Some sub-views use 12-column grids with breakpoint-aware
   column counts** (HomeScreen.tsx lines 205 / 266 / 356 already
   use `col-span-12 lg:col-span-3`). This is the only existing
   responsive-aware view, and it proves the pattern works — but
   it's an isolated example.

This plan addresses each of these systematically.

---

## 3. Tier definitions

Three tiers, mapped to three breakpoint ranges. Each tier has a
distinct interaction model and feature surface. Implementation
treats them as discrete modes — at the breakpoint boundary, the
layout *switches*, it doesn't continuously interpolate.

### 3.1 Desktop (≥1280px) — "Full editor"

- **Pixel range**: 1280px and wider.
- **Primary input**: mouse + keyboard. Touch is optional.
- **Typical devices**:
  - MacBook Air 13" (1280×800 logical; usable after URL bar).
  - MacBook Pro 14" (1512×982).
  - 1080p monitors (1920×1080).
  - 1440p monitors (2560×1440).
  - 4K monitors (3840×2160).
  - Surface Studio (4500×3000).
- **What works**: everything. The editor renders exactly as
  EDITOR_REDESIGN.md §6/§7 specifies. Three-pane shells, full
  TopBar with both dropdowns and all four action buttons in their
  full-label form, PrimaryTabs strip showing all 10 tabs with label
  text, StatusBar with full per-view sections.
- **What's NOT supported here**: nothing. This is the authoring
  baseline.
- **Notes**: 1280px is the lower bound; below this, certain views
  feel cramped even on desktop (Map's three rails + canvas + status
  console total ~1240px of fixed content) — switching to the tablet
  grammar at 1280px is the cleaner break than trying to support
  intermediate widths.

### 3.2 Tablet (768–1279px) — "Editor with collapsible drawers"

- **Pixel range**: 768px to 1279px.
- **Primary input**: touch primary, mouse/keyboard via Bluetooth.
- **Typical devices**:
  - iPad Mini (768×1024 portrait, 1024×768 landscape).
  - iPad Air 11" (820×1180 portrait, 1180×820 landscape).
  - iPad Pro 12.9" (1024×1366 portrait, 1366×1024 landscape).
  - Microsoft Surface Pro (912×1368 portrait).
  - Most ChromeOS tablets at default zoom.
  - Desktop browsers shrunk to ~half-screen (a real-world case —
    the user resizing the window or running side-by-side with
    another app).
- **What works**:
  - Home tab full-functional.
  - Map authoring with the **left and right rails collapsed into
    Drawers** (slide out via hamburger buttons in the local view
    toolbar; Drawer overlays the canvas).
  - Entities authoring with both rails as Drawers.
  - Animation editor with the timeline + preview pinned, inspector
    drawer.
  - Scripts editing with narrower Monaco + drawer-ified file tree.
  - Project tab with the category nav collapsed into a top-row
    horizontal tab strip instead of a vertical rail.
  - Assets browser with grid reduced to 3 columns + inspector
    drawer.
  - Image / Sound Lab / UI Builder with their side rails drawer-ified.
  - Playtest in condensed-chrome mode.
- **What's NOT supported**:
  - Resizable splitters (R5 polish — not built; doesn't apply here).
  - Side-by-side panel comparison (e.g. two prefabs open at once).
- **Notes**: 768px matches Tailwind's `md` breakpoint and Apple's
  iPad-portrait minimum width. This is the *lower* tablet bound;
  the upper bound is 1279px (the lower-desktop bound − 1px). At
  1024px landscape (iPad Air 11") the editor is fully usable for
  most workflows; the experience is "editor with one extra tap to
  open a panel" rather than "phone-grade reduced version."

### 3.3 Phone (<768px) — "View, browse, basic edits"

- **Pixel range**: 320px (lower clamp) to 767px.
- **Primary input**: touch only.
- **Typical devices**:
  - iPhone SE (375×667).
  - iPhone 15 / 15 Pro (393×852).
  - iPhone 16 Pro Max (440×956).
  - Pixel 8 (412×915).
  - Galaxy S24 (360×800).
  - Galaxy Z Fold inner screen (904×… landscape) — note: Fold
    landscape qualifies as **tablet**, not phone.
  - Any desktop browser shrunk below 768px width.
- **What's VIEWABLE** (read-only / browse-only surfaces):
  - **Home** — project list, recent projects, last-edited
    metadata, total counts. Tap a project to open. "New project"
    + "Import pack" + "Open URL" actions present.
  - **Playtest** — full-screen game runner. Minimal overlay
    (Stop button, FPS pill). The most useful phone experience —
    show off your work to a friend or playtest a pack you built
    earlier on desktop.
  - **Assets browser** — read-only list of assets in the project,
    tap an asset to see its preview + metadata. No import, no
    delete, no rename.
  - **Project metadata** — read-only Manifest tab (name, version,
    author, dependencies). Tapping any edit affordance shows a
    "Edit on desktop" guard.
- **What's NOT VIEWABLE (use desktop / tablet)**:
  - **Map authoring** — tile painting, brush selection,
    layer toggling. ResponsiveGuard on the view: "Map authoring
    requires a larger screen. You can still preview your scenes
    via the Playtest tab."
  - **Entities authoring** — prefab list + component editing.
    ResponsiveGuard with "Edit prefabs on desktop or tablet."
  - **Scripts** — Monaco doesn't fit on a 393px-wide screen at
    any usable density. ResponsiveGuard: "Script editing requires
    a larger screen." Possibly show the file tree read-only for
    review.
  - **Image Lab / Sound Lab** — node-graph authoring; needs a
    cursor. ResponsiveGuard.
  - **UI Builder** — drag-drop authoring; needs a cursor +
    inspector. ResponsiveGuard.
  - **Animation** — frame-grid scrubbing is touch-doable in
    theory, but the timeline + preview + inspector layout needs
    width. ResponsiveGuard. Optional: spritesheet preview as a
    read-only animation player.
  - **Complex Project settings** — Build configuration, Advanced
    flags. Read-only.
- **Notes**: The phone experience is **intentionally narrow**.
  Cardboard's positioning ("Substance Designer for raycaster
  game packs") implies the authoring loop is a desktop loop;
  the phone surface is for showing your work and quickly browsing
  your library. A user who taps "Edit prefab" from a phone gets
  a "this needs desktop — here's a QR code to open the project on
  a paired desktop session" message (future Store feature — see
  §12 open question 3).

### 3.4 Why these breakpoints (real device sizes + Tailwind alignment)

| Device | Logical width | Tier |
|---|---|---|
| iPhone SE | 375 | phone |
| iPhone 15 Pro | 393 | phone |
| iPhone 16 Pro Max | 440 | phone |
| iPhone landscape (15 Pro) | 852 | tablet |
| Pixel 8 | 412 | phone |
| Galaxy S24 | 360 | phone |
| Galaxy Z Fold (inner, portrait) | 904 | tablet |
| iPad Mini | 768 | tablet |
| iPad Air 11" portrait | 820 | tablet |
| iPad Air 11" landscape | 1180 | tablet |
| iPad Pro 12.9" portrait | 1024 | tablet |
| iPad Pro 12.9" landscape | 1366 | desktop |
| Surface Pro portrait | 912 | tablet |
| Surface Pro landscape | 1368 | desktop |
| Chromebook 11" | 1366 | desktop |
| MacBook Air 13" | 1280 | desktop |
| 1080p monitor | 1920 | desktop |
| 1440p monitor | 2560 | desktop (+ wide variant below) |
| 4K monitor | 3840 | desktop (+ wide variant below) |

The 768 / 1280 split aligns naturally with Tailwind's `md` / `xl`
boundaries (Tailwind defaults: `sm` 640px, `md` 768px, `lg` 1024px,
`xl` 1280px, `2xl` 1536px). We bypass the `sm` and `lg` levels —
they don't correspond to meaningful tier transitions for the
editor:

- `sm` (640px) would split phone into "small phone" and "large
  phone" — neither has any authoring surface so there's no useful
  layout difference.
- `lg` (1024px) would split tablet into "portrait tablet" and
  "landscape tablet" — but the meaningful behaviour (drawer-ified
  rails) is the same across both portrait and landscape tablet.
  Drawer width can adjust within the tier without a layout switch.

We also define an optional **wide** breakpoint at 1920px for the
"cap the layout width" decision (see §12 open question 5):

- Wide (≥1920px) — the editor centers within a max-width container
  to avoid stretched-out 4K layouts. **Not a tier of its own** —
  wide is a desktop sub-mode, not a separate interaction model.

---

## 4. Breakpoint tokens

### 4.1 Tailwind v4 @theme additions

Add to `apps/editor/index.css`'s existing `@theme` block (after the
shadow / radius / gap declarations):

```css
@theme {
  /* ... existing tokens ... */

  /* Responsive breakpoints (RESPONSIVE_DESIGN.md §4) */
  --breakpoint-phone: 0px;        /* implicit base — no min-width */
  --breakpoint-tablet: 768px;     /* iPad Mini portrait */
  --breakpoint-desktop: 1280px;   /* MacBook Air 13" */
  --breakpoint-wide: 1920px;      /* 1080p+ — layout cap */
}
```

Tailwind v4's `@theme` registers these as named breakpoints that
generate utility-class variants. After this block, Tailwind emits:

- `phone:foo-bar` — applies on all viewports (equivalent to no
  prefix). Mostly used for explicit phone-only overrides via
  `desktop:foo-bar` cancellation; rarely needed standalone.
- `tablet:foo-bar` — applies at ≥768px.
- `desktop:foo-bar` — applies at ≥1280px.
- `wide:foo-bar` — applies at ≥1920px.

### 4.2 Naming convention

Explicit semantic names (`tablet:` / `desktop:`) beat Tailwind's
abstract `md:` / `lg:` / `xl:` because:

- New contributors don't need to memorise "is `md` 768 or 960?".
- The class name communicates *intent* not pixel range — when a
  designer says "this should show up on tablet and above," the
  Tailwind class is literally `tablet:visible`.
- It mirrors the §3 tier vocabulary so the plan doc, the design
  reviews, and the JSX all use the same language.
- The R2 primitives (which already use `bg-(--color-bg-panel)`
  named tokens, not raw `bg-zinc-950/70`) get the same treatment
  for breakpoints.

**Migration of existing breakpoint usage**: the existing
HomeScreen.tsx (and `KeyValueList.tsx`'s `md:text-left`) use
Tailwind's default `lg:` / `md:` / `sm:`. RE2 keeps both working
by leaving Tailwind's default breakpoints in `@theme` undisturbed
(they're additive — adding `--breakpoint-tablet` doesn't remove
`--breakpoint-md`). RE4 migrations swap them over view-by-view.

### 4.3 How views consume tokens

The breakpoint utility is the **first** responsive tool, but views
should NOT reach for it as the only tool. Patterns from most-
preferred to least:

1. **Use a responsive primitive.** If the answer is "this whole
   side rail becomes a drawer on tablet," use the Drawer primitive
   (§5.1) with `tier="tablet"` — the primitive handles the logic.
   No breakpoint utilities in the view code.
2. **Use semantic shell behaviour.** If the answer is "the TopBar
   collapses these three buttons to icons," that's a TopBar prop,
   not a view-level concern.
3. **Use breakpoint utilities** for genuine view-level grid /
   spacing adjustments — `grid-cols-1 tablet:grid-cols-2
   desktop:grid-cols-3`, `gap-2 tablet:gap-4`, etc.
4. **Use container queries** (Tailwind v4 `@container` /
   `@sm:foo-bar`) only when a panel's layout depends on the
   *panel's* width, not the viewport's. Example: an inspector
   that's 380px wide on desktop but becomes 100vw inside a Drawer
   on tablet — its internal `grid-cols-2` vs `grid-cols-1` should
   depend on its own width, not the viewport. See §12 open
   question 1.

The cap utility (wide):

```html
<div class="mx-auto wide:max-w-[1920px]">
  <!-- shell content -->
</div>
```

Wraps the shell root, caps it at 1920px so a 4K monitor sees a
centred 1920px-wide editor with margins, not a stretched layout.
This is one of the few raw-utility uses justified at the shell
level.

---

## 5. New primitives needed

Six new primitives, added to `apps/editor/src/components/ui/`. Like
the R2 primitives, all are hand-rolled (no Radix, no Headless UI).

### 5.1 Drawer (side-pop)

A panel that slides in from the left or right edge of the viewport,
overlaying the main content with a backdrop. Used for the
drawer-ified side rails on tablet.

**Component name + props interface**

```ts
interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** Which edge it slides in from. */
  side: "left" | "right";
  /** Width when open. Default 320px. Can be a number (px) or
   *  string (`100vw` for full-screen on phone). */
  width?: number | string;
  /** Optional title rendered in the drawer's own header strip. */
  title?: React.ReactNode;
  /** Optional trailing action(s) in the header (close button is
   *  always present and rendered automatically). */
  headerAction?: React.ReactNode;
  /** When set, the drawer is "modal" — backdrop click closes,
   *  Esc closes, focus is trapped inside. Default true. */
  modal?: boolean;
  /** Restrict to a tier — if specified, the drawer is only
   *  rendered at that tier and below. At larger tiers, the
   *  consumer renders the rail inline instead. */
  tier?: "tablet" | "phone";
  children: React.ReactNode;
}
```

**Visual + behavioural spec**

- Slides in over the canvas with a `transform: translateX()`
  transition (200ms ease-out).
- Backdrop: `bg-black/40` covering the rest of the viewport.
- Header: 48px tall, `panel-surface`, with the title left-aligned
  and the close `X` IconButton right-aligned. Header is sticky.
- Body: `flex-1 overflow-y-auto` — scrolls independently.
- Footer: optional, set via a `Drawer.Footer` sub-component if
  needed (e.g. a sticky Save button at the bottom of a long form).
- Width: defaults to 320px on tablet (narrower than the desktop
  rail's 380px); on phone, set `width="100vw"` for a full-screen
  drawer.
- Closes on: backdrop click, Esc key, drawer's own X button,
  consumer-triggered `setOpen(false)`.

**Accessibility requirements**

- `role="dialog"` with `aria-modal="true"` when `modal` is true.
- `aria-labelledby` pointing at the title element.
- Focus trap: when open, Tab cycles within the drawer; Esc closes.
- On close, focus returns to the trigger element (the hamburger
  button that opened it).
- Backdrop has `aria-hidden="true"`.
- Reduced-motion: `prefers-reduced-motion: reduce` disables the
  transition.

**Where it lives**: `apps/editor/src/components/ui/Drawer.tsx`.

**Implementation hint**: portal the drawer into `document.body`
to escape the editor shell's overflow constraints. Use a `useRef`
on the previously-focused element for restoration. The focus trap
can be a small `useEffect` that listens for Tab and wraps within
the drawer's element subtree.

### 5.2 Sheet (modal that slides up from bottom)

A bottom sheet — the mobile-pattern modal that slides up from the
bottom of the viewport, typically used for action menus,
contextual choices, or compact editors.

**Component name + props interface**

```ts
interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Height when open. Default 60vh. Pass `"auto"` to size to
   *  content, capped at 80vh. Pass `"full"` for a top-edge-clipped
   *  full-screen sheet. */
  height?: number | string | "auto" | "full";
  /** Optional title in the sheet's header. */
  title?: React.ReactNode;
  /** Whether to show the grab-handle bar at the top. Default
   *  true on touch viewports. */
  handle?: boolean;
  /** When true, supports drag-down-to-close. Default true on
   *  touch viewports. */
  draggable?: boolean;
  modal?: boolean;        // defaults to true
  children: React.ReactNode;
}
```

**Visual + behavioural spec**

- Slides up from the bottom (200ms ease-out).
- Rounded top corners (`rounded-t-xl`).
- Grab handle: a small horizontal pill (4px high, 32px wide,
  centered, `bg-zinc-700`) above the header. Indicates draggability.
- Backdrop: same as Drawer.
- Drag-down: touch-only. Threshold 50px or fast velocity → closes.
- Used by: phone "select an asset to view" picker; tablet's
  "filter by tag" menu in the Assets view; "more actions" menus.

**Accessibility**

- `role="dialog"` with `aria-modal="true"`.
- Focus trap. Esc closes. Backdrop click closes.
- Drag-down ARIA: announce "Sheet closed" to screen readers when
  drag-dismiss completes.

**Where it lives**: `apps/editor/src/components/ui/Sheet.tsx`.

**Implementation hint**: share the portal + focus-trap helpers with
Drawer (extract to `apps/editor/src/lib/dialog.ts`). The drag
gesture is a `pointerdown` / `pointermove` / `pointerup` listener
that adjusts `transform: translateY()` directly.

### 5.3 BottomNav (phone-only nav bar)

A bottom-pinned 4-tab horizontal navigation bar for phone-tier
PrimaryTabs replacement. Fixed at the bottom of the viewport,
above the home indicator. Each tab is a 44×44pt minimum tap
target.

**Component name + props interface**

```ts
interface BottomNavTab {
  id: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface BottomNavProps<T extends string> {
  tabs: ReadonlyArray<BottomNavTab>;
  value: T;
  onChange: (next: T) => void;
  /** Optional "more" affordance — opens a Sheet containing the
   *  remaining tabs that don't fit in the bottom strip. */
  more?: ReadonlyArray<BottomNavTab>;
}
```

**Visual + behavioural spec**

- Pinned via `fixed bottom-0 inset-x-0` on phone tier.
- 56px tall (44 tap + 12 padding to clear the home indicator).
- Up to 5 tab slots — 4 primary + 1 "more" (the more button opens
  a Sheet listing the rest).
- Each tab: icon stacked above a label (text-[10px]); active tab
  has amber-tinted icon + label.
- Background: `panel-surface` with a top border + `backdrop-blur`.

**For cardboard's 10 PrimaryTabs on phone**: only 4 are useful
(Home, Assets, Project, Playtest); the rest hide behind "More"
or simply don't appear (since they're all guard-stated). So
BottomNav on phone shows: [Home] [Assets] [Project] [Playtest]
[More]. The "More" sheet lists the gated tabs with their
"requires desktop" caption.

**Accessibility**

- `role="tablist"` on the container, `role="tab"` on each tab.
- `aria-current="page"` on the active tab.
- Tap targets are 44×44pt minimum.

**Where it lives**: `apps/editor/src/components/ui/BottomNav.tsx`.

**Implementation hint**: composes the existing TabStrip behaviour
but with vertical-icon-stack layout and `fixed` positioning. Hide
on `desktop:hidden` (and possibly `tablet:hidden` too — see §6.2
where PrimaryTabs stays on tablet).

### 5.4 Hamburger menu

A small icon button that, when tapped, opens a Drawer (or a Sheet,
depending on which side). Used in two places:

- **TopBar (tablet + phone)**: replaces the PROJECT and SCENE
  dropdown fields with a single hamburger that opens a
  full-height Drawer containing both pickers.
- **View-level toolbar (tablet)**: each view that drawer-ifies a
  side rail has a hamburger button in its local toolbar to open
  the rail's Drawer.

**Component name + props interface**

```ts
interface HamburgerProps {
  onClick: () => void;
  /** Label announced to screen readers. */
  label: string;
  /** Visual variant. */
  variant?: "default" | "ghost";
  /** Optional badge dot for "drawer has unsaved changes." */
  badge?: boolean;
  /** Optional active-state indication (drawer currently open). */
  active?: boolean;
}
```

**Visual + behavioural spec**

- 44×44 minimum tap target (uses TouchButton variant under the
  hood; see §5.5).
- Three-line icon (Lucide `Menu`). Active state: lines morph to an
  `X` (Lucide `X`) with a 150ms transition.
- Badge: small amber dot on the top-right corner when `badge=true`.

**Accessibility**

- `aria-label` from the `label` prop.
- `aria-expanded` reflects the `active` prop.
- Keyboard activatable.

**Where it lives**: `apps/editor/src/components/ui/Hamburger.tsx`.

**Implementation hint**: thin wrapper around IconButton + TouchButton.

### 5.5 Touch-friendly button (min 44×44 tap target variant)

A `TouchButton` variant — or really, a `size="touch"` extension to
the existing Button primitive. 44×44pt minimum (Apple HIG + WCAG
2.1 2.5.5).

**Approach**: don't add a new primitive — **extend Button**.

```ts
// existing Button.tsx (R2)
interface ButtonProps {
  // ...
  size?: "sm" | "md" | "touch";   // ← new value
}
```

- `sm` → 32px tall (current). Mouse-only.
- `md` → 40px tall (current). Mouse-friendly.
- `touch` → 44px tall, min-width 44px. **Use on tablet + phone
  contexts.** Mouse-friendly too.

Same change applies to IconButton: add `size="touch"` (44×44).

**Where it lives**: edits to existing
`apps/editor/src/components/ui/Button.tsx` and `IconButton.tsx`,
no new file.

**Hint**: avoid sprinkling `size="touch"` everywhere — instead,
have the shell pass down a `touch` context flag via a React
context (`TouchInputContext`), and Button reads it as a default
when no explicit size is set. Set by the shell based on viewport
+ pointer-type detection (see §8).

### 5.6 ResponsiveGuard helper

Renders a "use a larger screen" EmptyState below a minimum tier.
Used per-view to gate authoring surfaces.

**Component name + props interface**

```ts
interface ResponsiveGuardProps {
  /** The minimum tier this surface supports. Below this, render
   *  the guard EmptyState; at or above, render `children`. */
  minTier: "tablet" | "desktop";
  /** Custom title for the guard. Default depends on the tier
   *  (`"Edit on desktop"` or `"Edit on a larger screen"`). */
  guardTitle?: React.ReactNode;
  /** Custom description. */
  guardDescription?: React.ReactNode;
  /** Optional "open on desktop" CTA (e.g. QR-code-share for the
   *  paired-session feature — see §12 open question 3). */
  guardCta?: React.ReactNode;
  /** Optional Lucide icon override. Default depends on minTier. */
  guardIcon?: React.ReactNode;
  children: React.ReactNode;
}
```

**Visual + behavioural spec**

- Below `minTier`: renders an EmptyState centered in the available
  space, with:
  - Icon: defaults to `Monitor` (desktop required) or `Tablet`
    (tablet+ required).
  - Title: defaults as above.
  - Description: defaults to a one-liner explaining the limitation.
  - CTA: optional. Could be "Continue anyway" (escape hatch) or
    "Open on desktop" (paired session).
- At or above `minTier`: renders `children`.
- Hooked into the same TouchInputContext (or a sibling
  ResponsiveContext) so the tier is reactive to viewport changes.

**Where it lives**: `apps/editor/src/components/ui/ResponsiveGuard.tsx`.

**Implementation hint**: use a `useTier()` hook (lives in
`apps/editor/src/lib/responsive.ts`) that subscribes to
`window.matchMedia` for the breakpoint thresholds and returns
`"phone" | "tablet" | "desktop" | "wide"`. The guard reads this
hook and either renders children or the EmptyState. Make sure
to handle SSR / first-paint without flicker — return a sane
default (`"desktop"`) on the server side.

### 5.7 Primitive count + summary

| # | Primitive | Purpose | File |
|---|---|---|---|
| 1 | Drawer | Side-edge slide-out panel | `Drawer.tsx` |
| 2 | Sheet | Bottom slide-up modal | `Sheet.tsx` |
| 3 | BottomNav | Phone-only bottom nav | `BottomNav.tsx` |
| 4 | Hamburger | Trigger button for Drawer | `Hamburger.tsx` |
| 5 | (Button `size="touch"`) | 44pt min tap target — extension to existing Button/IconButton | edits to `Button.tsx`, `IconButton.tsx` |
| 6 | ResponsiveGuard | Below-tier EmptyState | `ResponsiveGuard.tsx` |

Plus a supporting hook + context (`useTier`, `TouchInputContext`)
in `apps/editor/src/lib/responsive.ts` — these are not primitives
but they're the glue.

**Total: 6 new primitives** (counting the Button size variant as
one primitive change, not a new primitive). RE2 builds these alongside
the existing 38-primitive library.

---

## 6. Shell-level responsive behavior

Shell adaptations live in `apps/editor/src/shell/`. Each is opt-in
via a tier-aware render path; the desktop rendering stays unchanged.

### 6.1 TopBar — desktop full / tablet condensed / phone hamburger

#### Desktop (≥1280px)

Current behaviour (no change):

```
[LOGO + CARDBOARD/EDITOR] [PROJECT ↓] [SCENE ↓]    [Save state] [Playtest] [Export] [Save] [⚙]
```

All elements visible. 64px tall.

#### Tablet (768–1279px)

Condense to fit ~768px minimum width:

```
[LOGO] [PROJECT ↓ shrunk to ~140px] [SCENE ↓ shrunk to ~140px]    [PT] [Ex] [Sv] [⚙]
```

- Brand wordmark "CARDBOARD/EDITOR" hides below ≤1024px; logo glyph
  stays.
- PROJECT and SCENE dropdown fields shrink from 224px → 140px.
- Playtest / Export / Save buttons collapse to **icon-only** with a
  Tooltip on hover/long-press (Play, Upload, Save icons). Labels
  hidden. Each remains a TouchButton-sized 44×44.
- Settings cog stays.
- Save state pill shortens to a single dot + tooltip (no "Saved"
  text).

Below ~960px, an alternative path: collapse PROJECT + SCENE into
a single Hamburger button on the left that opens a Drawer
containing both pickers. Threshold: when both dropdowns + buttons
no longer fit, swap to hamburger. Detection: use a
`ResizeObserver` on the TopBar element measuring overflow, not a
viewport breakpoint — this handles edge cases like long project
names that push past the breakpoint at a wider viewport.

#### Phone (<768px)

```
[☰] [LOGO]                  [▶ FAB-style Playtest]
```

- Hamburger on the left. Opens a full-height Drawer:
  - PROJECT dropdown (full-width inside the drawer).
  - SCENE dropdown (full-width).
  - Save / Export / Settings actions as full-width list rows
    (a "row of actions" pattern rather than a button strip).
- Brand: logo glyph only (28×28), no wordmark.
- Right side: a single floating Play button (Playtest), 44×44.
  This is the single most useful action on phone.
- No Save / Export / Settings buttons at the top level on phone
  — they're inside the hamburger drawer because their usefulness
  on phone is low (most authoring is guard-stated).

### 6.2 PrimaryTabs — desktop horizontal / tablet scrollable / phone hamburger drawer

#### Desktop

Current: 10 tabs in a horizontal strip below TopBar. ~110px each.
~1100px total width. No change.

#### Tablet

- All 10 tabs still visible, but the strip becomes **horizontally
  scrollable** (`overflow-x-auto`). On a narrower tablet (768px
  portrait), the user swipes the strip left-right to access
  rightmost tabs.
- Icon-only collapse below ~900px wide: tabs shrink to icon-only
  with the label hidden, fitting all 10 in ~480px. Active tab
  shows its label inline (so the user knows where they are).
- Tap targets remain 44×44 minimum per tab.

#### Phone

- PrimaryTabs **hides entirely** on phone tier.
- Replaced by BottomNav (§5.3) pinned to the bottom of the viewport.
- BottomNav shows the 4 phone-relevant tabs (Home, Assets, Project,
  Playtest) plus a "More" sheet for the others (each renders a
  guard when tapped).

### 6.3 StatusBar — desktop full / tablet most sections / phone hidden

#### Desktop

Current: full per-view section set, ~32px tall. No change.

#### Tablet

- StatusBar remains visible.
- Each section gets a `priority?: "primary" | "secondary"` flag
  (added to the `StatusBarSection` type). Secondary sections drop
  below 1024px. Primary always shows.
- Section labels (e.g. "POSITION") hide; only values show. Tooltip
  on the value surfaces the label.
- Density: padding shrinks from `px-2` to `px-1`.

#### Phone

- StatusBar **hides entirely** on phone. The 32px is reclaimed for
  BottomNav (56px). Net: gain 24px of viewport for content (which
  matters on a 667px-tall iPhone SE).
- Critical status info (e.g. "Saving…") moves to a transient toast
  pattern on phone (existing pattern: bottom-positioned toast that
  appears for 2s and dismisses).

### 6.4 Project dropdown collapses to icon-button on tablet+

(Covered in 6.1.) When both PROJECT and SCENE dropdowns + the
action buttons can't fit, swap to a single Hamburger on the left
that opens a settings-like Drawer with both pickers stacked
vertically. Same pattern as macOS Finder's "show window-fragment"
collapse behaviour.

### 6.5 Save/Export/Playtest buttons collapse to icons + tooltips

(Covered in 6.1.) Below ~1100px, buttons swap to icon-only mode.
Long-press on touch surfaces a Tooltip showing the action name.

### 6.6 ShellChrome responsive layout grammar

Add a `tier` prop (or `useTier()` consumption) to `EditorShell`'s
`ShellChrome`. The render branches:

```tsx
function ShellChrome(props) {
  const tier = useTier();

  return (
    <div className="flex flex-col h-screen min-h-screen">
      {tier === "phone" ? (
        <>
          <TopBarPhone {...props} />
          <main className="flex-1 min-h-0 overflow-hidden pb-14">
            <ShellBody {...props} />
          </main>
          <BottomNavBar {...props} />
        </>
      ) : (
        <>
          <TopBar {...props} mode={tier === "tablet" ? "condensed" : "full"} />
          <PrimaryTabs {...props} scrollable={tier === "tablet"} />
          <main className="flex-1 min-h-0 overflow-hidden">
            <ShellBody {...props} />
          </main>
          <StatusBar {...props} mode={tier === "tablet" ? "condensed" : "full"} />
        </>
      )}
    </div>
  );
}
```

The `mode` props let TopBar / StatusBar choose their own layout
internally — keeps the responsive logic *inside* each shell
component rather than in the chrome wrapper.

---

## 7. Per-view responsive contracts

For each existing R4 view: desktop (current, unchanged), tablet
adaptation, phone adaptation. Each phone adaptation that's
"ResponsiveGuard" uses the §5.6 primitive.

### 7.1 Home

#### Desktop
Current 12-column grid (HomeScreen.tsx): `col-span-12 lg:col-span-3`
recents rail + `lg:col-span-6` main grid + `lg:col-span-3` actions
rail. Already responsive.

#### Tablet
- 8-column grid: recents rail + main grid (2 cols of project cards)
  + actions rail. Or fall back to 2-col main + 1-col actions if
  recents are deemed lower priority.
- Project cards: still readable; reduce from 4-col grid to 2-col.
- Tap-to-open each project card (whole card is the tap target).

#### Phone
- Vertical stack:
  - Action row at the top: "New project" + "Import" + "Open URL"
    as a horizontal Toolbar of icon+label buttons (each 44pt tall).
  - Recents list below, full-width.
  - Each recent project: full-width card, tap-to-open, with name +
    last-edited + a small Play icon button on the right.
- No "actions sidebar" — actions are inline above the list.
- EmptyState (no projects) reads identically.

**Verdict**: Home is fully usable on phone. No guard.

### 7.2 Map

#### Desktop
Current 3-pane: left rail (tools + tile categories) + center grid
canvas + right rail (3D preview + cell inspector + scene settings
+ quick tools). StatusConsole footer.

#### Tablet
- Left rail (300px wide on desktop) becomes a **left Drawer**,
  triggered by a hamburger in the view's local toolbar (top of the
  canvas).
- Right rail (380px on desktop) becomes a **right Drawer**,
  triggered by an "inspector" IconButton in the local toolbar.
- Center canvas takes the full width.
- StatusConsole at the bottom is collapsible — a single bar with
  the latest log line + a chevron to expand into the full panel
  in a Sheet.
- Toolbar in the canvas top: hamburger (left rail) | tool icons
  | layer pills | scene path | inspector toggle (right rail).
- 3D preview moves into the right Drawer.

#### Phone
- ResponsiveGuard: "Map authoring requires a larger screen."
- Icon: Monitor.
- Description: "Tile painting and entity placement need more
  space than this device gives. Open this project on a tablet or
  desktop to author the map."
- CTA: "Run in Playtest" → switches to the Playtest tab to let
  the user walk through whatever map state currently exists.

**Hand-wave**: an interactive read-only "tap to walk" minimap
overlay is *future* work (§12 open question 6) — for RE4 we ship
the guard and the Playtest fallback.

### 7.3 Entities

#### Desktop
Current 3-pane: left rail (prefab list + search) + center prefab
editor + right rail (JSON preview + save buttons). See
EntitiesEditor.tsx.

#### Tablet
- Left rail → Drawer (hamburger in the view's local toolbar).
- Right rail → Drawer (toggle button in the local toolbar).
- Center prefab editor takes full width.
- Component CollapsibleSections stack vertically inside center.
- ToggleButton in the StatusBar shows current drawer states (e.g.
  a small dot indicates which drawer is open).

#### Phone
- Show only the prefab list (read-only).
- Tap a prefab → opens read-only inspector (full-screen Sheet with
  the prefab's component list expanded, all controls disabled).
- Tap "Edit" anywhere → ResponsiveGuard EmptyState: "Edit prefabs
  on a larger screen."
- Future enhancement (§12 open question 3): "Open on desktop"
  CTA with a QR code to a paired desktop session.

### 7.4 Animation

#### Desktop
Current 3-pane: left rail (clip list) + center (toolbar + preview
strip + timeline) + right rail (preview + animation inspector).

#### Tablet
- Left rail (clip list) → Drawer.
- Right rail (preview + inspector) → Drawer.
- Center: toolbar + preview strip + timeline takes full width.
- Timeline: horizontally scrollable on narrower viewports (already
  does this on desktop for long clips).

#### Phone
- ResponsiveGuard: "Animation editing requires a larger screen."
- Alternative consideration: a read-only **spritesheet preview**
  mode — list of clips, tap one to see it loop in a centered
  preview. No editing.
  - This is **stretch** for RE5. For RE4 we ship the guard.

### 7.5 Scripts

#### Desktop
Current 3-pane: left rail (file tree) + center (Monaco editor with
tabs) + right rail (script inspector).

#### Tablet
- Monaco at narrower width. Monaco itself handles narrow widths
  fine (it's used in VS Code on iPad via web), but the editor's
  layout needs to adapt.
- Left rail (file tree) → Drawer.
- Right rail (script inspector) → Drawer.
- Tabs strip above Monaco stays inline.

#### Phone
- ResponsiveGuard: "Script editing requires a larger screen."
- Read-only file list is acceptable (browse the project's
  scripts/), but tapping a file shows a guard.
- Monaco bundle is ~1.2MB — don't even load it on phone. The
  guard is rendered without bundling Monaco at all.

### 7.6 Project

#### Desktop
Current 3-pane: left rail (sub-tab nav) + center (build config) +
right rail (validation + build size).

#### Tablet
- Left rail (sub-tab vertical nav) → becomes a **top-row horizontal
  TabStrip** (like the secondary `TabStrip` variant in R2). Not a
  Drawer — sub-tabs are part of the page navigation, not auxiliary
  content, so a top strip is the right adaptation.
- Right rail (validation + build size) → Drawer toggled by an
  "inspector" button in the view's local toolbar.
- Center takes full width; PropertyRows reflow into
  `grid-cols-1 tablet:grid-cols-2` based on content density.

#### Phone
- Read-only: Manifest tab shows name, version, author, dependencies.
- Tap any edit affordance → ResponsiveGuard.
- "Build" and "Validation" and "Build size" tabs accessible but
  show read-only data. Triggering an actual build → guard.

### 7.7 Assets

#### Desktop
Current 3-pane (per EDITOR_REDESIGN §7.4): left rail (filters) +
center (asset grid) + right rail (asset inspector). 6-col grid.

#### Tablet
- Left rail (filters) → Drawer.
- Right rail (asset inspector) → Drawer triggered by tapping an
  asset.
- Center: asset grid drops from 6-col to 4-col.

#### Phone
- Vertical list (not grid). Each row: 60px thumb + name + size +
  type Badge. Tappable.
- Tap → opens a Sheet with full-screen preview + KeyValueList of
  metadata. Sheet has no "edit / delete / rename" actions on
  phone — read-only.
- Filter affordance: top-of-list "Filter" button that opens a
  Sheet of filter checkboxes.
- No import (no FilePicker on phone). Tap "Import" → guard:
  "Import assets on a larger screen."

### 7.8 Image Lab

#### Desktop
Current 4-column shell (per IMAGE_LAB.md): recipe list +
node-graph canvas + preview + inspector.

#### Tablet
- Recipe list (left) → Drawer.
- Inspector (right) → Drawer.
- Node graph + preview share the center; vertical stack on narrower
  tablets (preview on top, graph below), horizontal split on wider
  tablets.
- Node-graph drag uses touch (long-press to grab, drag to move,
  pinch-zoom for canvas zoom). See §8.

#### Phone
- ResponsiveGuard: "Procedural authoring requires a larger screen."
- Procedural recipes are not phone-authoring-viable. Even a
  preview-only mode is borderline — defer to Assets view for the
  baked output.

### 7.9 Sound Lab

#### Desktop
Same shell as Image Lab (per SOUND_LAB.md): recipe list + node-graph
+ preview + inspector.

#### Tablet
- Same drawer-ification as Image Lab.
- Audio playback affordances (preview play, isolate node) get
  touch-friendly tap targets.

#### Phone
- ResponsiveGuard.
- Alternative: a read-only "play this sound" list (browse recipes,
  preview audio). Stretch for RE5.

### 7.10 UI Builder

#### Desktop
Drag-drop UI authoring (per the not-yet-written UI_BUILDER.md).

#### Tablet
- Drawer-ify the element palette + inspector.
- Center is the canvas (the rendered UI tree).
- Touch-drag for element placement; pinch-zoom for canvas.

#### Phone
- ResponsiveGuard.

### 7.11 Playtest

#### Desktop
Specialised full-screen layout (per EDITOR_REDESIGN §7.9): top
action bar + left rail (Runtime/Player/World stats) + center
(iframe) + right rail (Inspector/FOV/Lighting/Nav) + bottom strip
(LogPanel + FpsGraph).

#### Tablet
- Top action bar: stays.
- Left and right rails → Drawers.
- Bottom LogPanel → collapsible (collapsed by default; expand to
  show in a Sheet).
- FpsGraph: floats in the bottom-right as a small overlay (not in
  a panel).
- Center iframe: maximises to fill.

#### Phone
- **Full-screen game runner**. The iframe takes 100vw × (100vh -
  TopBar - BottomNav) ≈ entire viewport.
- Top: minimal overlay — a Stop button (red, 44×44) + a Pause
  button (yellow, 44×44) + an FPS pill on the right.
- Bottom: BottomNav (so the user can navigate back to Home /
  Assets).
- Stats / inspectors / log: tucked behind a "debug" hamburger
  button (top-right) that opens a Sheet with the panels stacked
  vertically. Hidden by default.
- Touch input is forwarded to the iframe via the engine's existing
  touch handlers (already implemented for in-game controls — no
  new wiring needed).
- **This is the *best* phone experience cardboard offers.** Users
  show their packs to friends; the editor is a frame around the
  game.

---

## 8. Touch-input affordances

### 8.1 Tap target minimum

44×44pt per Apple HIG, 44×44 CSS pixels per WCAG 2.1 SC 2.5.5.
Tap targets smaller than this are easy to mis-tap.

- Button `size="touch"` is 44px tall (§5.5).
- IconButton `size="touch"` is 44×44.
- Tab buttons in PrimaryTabs (tablet icon-only mode) are 44×44.
- BottomNav tabs are 44×44 (within the 56px strip — extra space
  is bottom-padding for the home indicator).
- PropertyRow controls on tablet+ use `size="touch"` variants.

Detection: a `TouchInputContext` set by the shell on first paint:
- `(window.matchMedia('(pointer: coarse)').matches)` → touch
  primary.
- Tier-based fallback: phone + tablet default to touch even if
  the device claims `pointer: fine` (Bluetooth mouse on iPad).
- Override: a future "use mouse layout" toggle in EditorSettings
  for iPad-with-keyboard-and-trackpad users (out of scope for
  RE2/3/4 — captured in §12 open question 7).

Within views, components opt into the context — Button reads
`useTouchInput()` and defaults to `size="touch"` when it returns
true (unless an explicit `size` is set).

### 8.2 Drag semantics on touch

For canvases that pan (GridEditor's map canvas, Image Lab's
node-graph), distinguish:

- **Single-finger drag**: pan the canvas. Same as middle-mouse-drag
  on desktop.
- **Two-finger drag**: scroll the page (if the canvas is in a
  scrollable container). Rarely used in editor views — most
  canvases fill their container.
- **Long-press + drag**: grab + move the under-finger element
  (entity, node, frame keyframe). 400ms hold.
- **Tap**: select.
- **Double-tap**: zoom in / focus on the tapped element.

Implementation pattern: use Pointer Events (already supported in
React 19). A small helper in `apps/editor/src/lib/touchGestures.ts`
wraps a pointer-event subscription into the four semantics above.
GridEditor's existing pan logic (which currently listens for
`mousedown` / `mousemove`) replaces those with pointer events,
gaining touch support for free.

### 8.3 Pinch-zoom on Map / Image Lab graph

- Map canvas: pinch-zoom maps to the grid's zoom level.
- Image Lab graph: pinch-zoom changes the graph's transform
  scale (currently mouse-wheel only).
- Implementation: use a small pinch-detection helper. Two
  `pointerdown` events → enter pinch mode; track distance between
  the two pointers as zoom delta.

### 8.4 Scroll vs pan disambiguation

The fundamental tension on touch: when the user single-finger-drags
on a canvas, do they mean "pan the canvas" or "scroll the page"?

Resolution:

- Canvases inside `overflow-hidden` containers (Map's center, Image
  Lab's center) consume single-finger drag as pan. There's no page
  scroll to compete with — the shell is `overflow-hidden`.
- Scrollable lists (Assets list on phone, prefab list in
  EntitiesEditor's drawer, file tree) consume single-finger drag
  as native scroll. The list elements don't need pan.
- Drawers themselves are scrollable lists; single-finger drag
  inside a Drawer scrolls its content. Pinch-zoom inside a Drawer
  is a no-op.

Pen input (Apple Pencil, Surface Pen): treat as mouse for now
(see §12 open question 7). Pressure-sensitivity for the Map's
brush tool is a stretch goal.

---

## 9. "Coming from a phone" UX

### 9.1 Detect viewport on first load

The shell's `useTier()` hook returns the current tier on every
render. On first paint, the shell wraps with `TouchInputContext`
+ `TierContext` providers, and the body picks the right render
path based on the initial tier.

To avoid first-paint flicker (the wrong tier rendering for a
moment before client-side JS hydrates), use `matchMedia` directly
on the body element via inline `<script>` set the right body
class before React mounts. RE2 / RE3 owns this.

### 9.2 If phone, show banner: "Best on desktop or tablet — view-only on phone"

On first load at phone tier, the shell shows a one-time dismissible
banner at the top of the viewport (under TopBar):

> 📱 You're on a small screen. Editing is best on tablet or desktop
> — you can browse, share, and playtest here. **Got it →**

Dismissed-state persisted to `localStorage` under
`editor.phoneBannerDismissed`. Doesn't reappear after dismissal.

The banner is a small `bg-amber-500/10 text-amber-200` strip with a
right-side dismiss `X`. 36px tall.

### 9.3 Phone landing experience

When a user opens the editor on a phone:

1. If no project is open (Home tier): land on Home. Show the
   banner (§9.2).
2. If a `#/p/<id>` deep-link is hit: open the project, but route
   to the **Playtest tab** by default, not whatever the persisted
   workflow-mode was. This is the most-useful entry point for
   phone users.
   - Override: a query param `?view=assets` lets a phone user
     deep-link to the Assets browser (e.g. for sharing a specific
     pack's contents).
3. Provide a clear "share to desktop" affordance somewhere — in
   the hamburger drawer, a "Open this project on desktop" item
   that, when tapped, generates a session-pair QR code (future
   Store feature — see §12 open question 3) or a deep-link the
   user can email to themselves.

This is the **shape** of the phone landing UX. RE5 polishes the
banner copy + QR-code-share if/when the paired session feature
ships.

---

## 10. Accessibility

### 10.1 Touch-target + WCAG compliance

- All interactive elements meet 44×44 CSS pixels (WCAG 2.1 SC
  2.5.5 Level AAA) on touch tiers.
- Spacing between adjacent tap targets ≥8px to avoid mis-taps.
- Focus rings (already amber-400 ring in R2) stay visible on touch
  focus too — keyboard users on iPads with Bluetooth keyboards see
  the same affordance.

### 10.2 Hamburger menu keyboard nav

- Hamburger button is keyboard-focusable.
- When activated, the Drawer opens and focus moves to the first
  focusable element inside.
- Tab cycles within the Drawer (focus trap).
- Esc closes the Drawer; focus returns to the Hamburger button.
- Screen reader announces "Project picker, dialog" (from
  `aria-label` on the Drawer).

### 10.3 Drawer focus management

(Covered in §5.1.) Specifically:

- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing
  at the title element.
- Initial focus: the first focusable element inside the Drawer.
- Esc closes; focus returns to the trigger.
- Background content has `aria-hidden="true"` while the Drawer is
  open, so screen readers don't read it.

### 10.4 Reduced motion

Respect `prefers-reduced-motion: reduce`:

- Drawer slide-in: instant instead of 200ms.
- Sheet slide-up: instant.
- Tab underline shift: instant.

### 10.5 High contrast

The R2 token vocabulary already targets WCAG AA contrast (zinc-100
text on zinc-950 background ≈ 17:1 contrast). No tier-specific
contrast change needed — but verify that condensed-mode TopBar's
icon-only buttons retain ≥3:1 against their background (Lucide
icons at default weight should be fine).

### 10.6 Screen-reader-only tier announcement

When the tier changes (e.g. user rotates an iPad from portrait to
landscape and the tier shifts from tablet to desktop), the shell
fires a polite ARIA live-region announcement:

> "Now showing desktop layout."

Helps screen-reader users understand why the UI rearranged. Implemented
via a hidden `aria-live="polite"` region in the shell.

---

## 11. Phased rollout RE1–RE5

### RE1 — this plan doc

This document. No code changes. Establishes the contract for
RE2–RE5.

### RE2 — breakpoint tokens + new primitives

Single agent. Builds:

1. **Tokens**: add `--breakpoint-phone/tablet/desktop/wide` to the
   `@theme` block in `apps/editor/index.css`. Tailwind v4 emits
   `tablet:` / `desktop:` / `wide:` variants.
2. **Primitives** (§5):
   - `Drawer.tsx` (§5.1).
   - `Sheet.tsx` (§5.2).
   - `BottomNav.tsx` (§5.3).
   - `Hamburger.tsx` (§5.4).
   - Extend `Button.tsx` + `IconButton.tsx` with `size="touch"` (§5.5).
   - `ResponsiveGuard.tsx` (§5.6).
3. **Support utilities**: `apps/editor/src/lib/responsive.ts` with
   `useTier()`, `TouchInputContext`, `useTouchInput()`.
4. **Style guide entries**: add representative examples to
   `apps/editor/src/views/_StyleGuide.tsx` so reviewers can
   manually verify each primitive at each tier.

Acceptance:
- All new primitives have a TypeScript prop type matching §5.
- Each primitive renders correctly at all three tiers in the
  StyleGuide.
- Existing views are untouched.
- Existing smoke tests pass unchanged.

Estimated effort: ~2 days.

### RE3 — shell-level responsive behavior

Single agent. Modifies the shell:

- `EditorShell.tsx` — wraps body in `TierContext` + `TouchInputContext`.
- `TopBar.tsx` — adds `mode="full" | "condensed"` prop; condensed
  mode hides labels, shrinks dropdowns, optionally swaps to
  Hamburger.
- `PrimaryTabs.tsx` — adds `scrollable` prop; horizontal scroll on
  tablet, hidden entirely on phone.
- `StatusBar.tsx` — adds `priority` to sections; secondary sections
  hide below 1024px; entire bar hides on phone.
- Add `BottomNav` to the shell, rendered only at phone tier.
- Add the first-load banner (§9.2) gated by
  `editor.phoneBannerDismissed`.
- Phone-deep-link behaviour (§9.3) — route to Playtest tab when a
  project is opened on phone.

Acceptance:
- Resizing the browser window from 1920px → 320px crosses both
  tier boundaries cleanly, with no visual artifacts.
- TopBar, PrimaryTabs, StatusBar all respond correctly.
- BottomNav appears on phone with the 4 visible tabs (Home /
  Assets / Project / Playtest) + a More sheet.
- Existing views still render correctly inside the shell (they
  may not yet adapt internally — that's RE4).
- Existing smoke tests pass unchanged.

Estimated effort: ~2 days. Depends on RE2.

### RE4 — per-view responsive contracts (PARALLEL-SAFE)

Each sub-phase is a single per-view migration. Like EDITOR_REDESIGN
R4, different views can land independently after RE3 is in.

- **RE4a — Home** (§7.1). Lowest risk; the view already uses
  responsive grids. Migrate `lg:` to `desktop:`, add phone vertical
  layout. Independent.
- **RE4b — Map** (§7.2). Drawer-ify left + right rails on tablet;
  ResponsiveGuard on phone. Tests: paint a tile via the tablet
  drawer-rail flow still works. Independent. Largest migration.
- **RE4c — Entities** (§7.3). Drawer-ify rails on tablet; phone
  shows read-only prefab list. Independent.
- **RE4d — Animation** (§7.4). Drawer-ify rails on tablet; phone
  ResponsiveGuard. Independent.
- **RE4e — Scripts** (§7.5). Drawer-ify rails on tablet; phone
  ResponsiveGuard. Monaco does not load on phone. Independent.
- **RE4f — Project** (§7.6). Sub-tab nav collapses to top
  horizontal strip on tablet; right rail → drawer. Phone shows
  read-only Manifest. Independent.
- **RE4g — Assets** (§7.7). Drawer-ify on tablet; vertical list +
  Sheet preview on phone. Independent.
- **RE4h — Image Lab** (§7.8). Drawer-ify on tablet; phone guard.
  Depends on IMAGE_LAB.md ship (currently in design).
- **RE4i — Sound Lab** (§7.9). Same as Image Lab. Depends on
  SOUND_LAB.md ship.
- **RE4j — UI Builder** (§7.10). Drawer-ify on tablet; phone
  guard. Depends on UI_BUILDER.md ship.
- **RE4k — Playtest** (§7.11). Drawer-ify side rails on tablet;
  full-screen game runner with minimal overlay on phone. Depends
  on Playtest view (R4h of EDITOR_REDESIGN) being live.
- **RE4l — Project Settings modal** (legacy modal that survived
  R4f). Migrate its layout to also be drawer-friendly on tablet
  / phone — though as the cog opens the Editor Settings modal (not
  Project Settings) post-R4f, this is mostly the editor settings
  modal getting tier-aware layout.

Estimated effort: 2–4 days per sub-phase, parallel-safe.
Worst-case sequential: 8 × 3d = 24d. With parallel agents:
~5d wall-clock.

### RE5 — polish (touch input affordances + animations + phone landing UX)

Single agent. Catches everything not covered view-by-view:

- Touch gesture wiring on Map / Image Lab canvases (§8.2 / §8.3).
- Pen-input handling — initially "treat as mouse" (§12 open
  question 7), enhanced later if user feedback warrants.
- Drawer / Sheet animation polish.
- Reduced-motion verification across all transitions (§10.4).
- High-contrast verification (§10.5).
- Screen-reader announcement on tier change (§10.6).
- Phone landing UX polish: banner copy, "share to desktop" QR
  code if Store paired-session lands.
- Performance: verify no layout thrash on rotation (iPad portrait
  ↔ landscape).
- Empty-state copy review for each ResponsiveGuard.
- Comprehensive cross-device manual QA on:
  - iPhone SE (375px, smallest realistic phone).
  - iPhone 16 Pro (393px, common phone).
  - iPad Mini portrait (768px, tablet floor).
  - iPad Air 11" portrait (820px) + landscape (1180px).
  - iPad Pro 12.9" landscape (1366px, desktop floor).
  - MacBook Air 13" (1280px, desktop floor).
  - 1080p monitor (1920px, wide floor).
  - 4K monitor (3840px, wide ceiling).

Estimated effort: ~3 days. Depends on RE4 being complete.

### Summary timeline

| Phase | Effort | Depends on | Parallel? |
|---|---|---|---|
| RE1 | doc | — | n/a |
| RE2 | 2d | RE1 | no |
| RE3 | 2d | RE2 | no |
| RE4a–l | 2–4d each | RE3 + per-view R4 sibling | yes |
| RE5 | 3d | RE4 (all) | no |

Earliest-possible RE5 ship: ~10–12 days with parallel agents.

---

## 12. Open questions

1. **Q1**: Container queries vs viewport breakpoints — use Tailwind v4 container queries instead of viewport
   breakpoints? Container queries (`@container` + `@sm:foo`)
   target the *parent's* width, not the viewport's. More accurate
   for nested-panel layouts — e.g. a Drawer's contents can adapt
   to the Drawer's width regardless of viewport. But container
   queries are newer (broad browser support landed 2023) and
   Tailwind v4 supports them.
   - **Proposed default**: viewport breakpoints for shell-level
     (TopBar, PrimaryTabs, BottomNav choice); container queries
     for panel-internal layouts (Drawer body, Sheet body, inspector
     PropertyRow density).
   - Open: do we standardise this split formally in RE2, or let
     view authors choose case-by-case?

   **RESOLVED**: Container queries. Accurate for nested-panel layouts where a sub-rail may be wide despite small viewport.

2. **Q2**: UA vs viewport tier detection — detect phone via UA sniffing or viewport-only? Viewport-only
   is what §3 / §4 propose — purely
   `(min-width: 768px)` media queries via `matchMedia`. UA sniffing
   is more accurate for "is this a phone-shaped device" but is a
   mess (Chrome on iPad reports iPad, but Safari on iPad reports
   "iPhone" if requesting desktop mode, etc.).
   - **Proposed default**: viewport-only. Cheaper, more honest,
     no UA-parsing logic.
   - Edge case: user shrinks their desktop browser to <768px wide.
     They get the phone tier. Acceptable — the layout still works.

   **RESOLVED**: Viewport-based + reactive (re-render on resize). UA is unreliable; viewport adapts to actual available space.

3. **"QR code to pair to desktop session" for phone users wanting
   to author — useful or feature creep?** A phone user taps "Edit
   prefab," sees a guard, sees a "Open on desktop" CTA, taps it,
   gets a QR code on the phone. They scan the QR with their
   desktop browser, which opens the same project in the same state
   (via the future Store's paired-session infrastructure).
   - This is genuinely useful — it's exactly the "I want to keep
     working on the bus → at home" handoff.
   - But depends on STORE.md and a paired-session feature that
     doesn't exist yet. RE4 phone guards include the CTA as a
     **no-op placeholder** (à la EmptyState's `tutorial` prop —
     see EDITOR_REDESIGN §12 Q10) that lights up when the Store
     ships.
   - **Proposed default**: ship the placeholder; defer the actual
     pairing to Store phase 3+.

4. **Q4**: PWA standalone differentiation — should the phone PWA hide more
   UI than the browser version? PWA standalone mode (after #242)
   has no URL bar, so more vertical space is available. Some apps
   use this for a beefier bottom nav or a permanent header.
   - **Proposed default**: same layout. Standalone mode + browser
     mode look identical at the same viewport. Avoids cognitive
     load.
   - Open: if user feedback says "the phone-PWA experience feels
     identical to a website," consider differentiation in RE5
     polish.

   **RESOLVED**: Identical UI to browser. No hidden chrome in standalone.

5. **Q5**: Ultra-wide cap (>1920px) — cap layout width or stretch?
   §3.4 defines `wide` (≥1920px) as a desktop sub-mode. Two
   options:
   - **Option A**: cap the editor at 1920px max-width, centred,
     with the rest of the viewport as zinc-950 margin. Avoids
     stretched-out 4K layouts.
   - **Option B**: stretch indefinitely. Pre-defined "1920px-and-
     beyond" rail widths grow with extra real estate (e.g. wider
     inspector, more thumbnail columns in Assets).
   - **Proposed default**: Option A. Most editor work happens in
     the center; ultra-wide stretch makes the rails feel
     disproportionate. Wrap the shell in `mx-auto wide:max-w-[1920px]`.
   - Open: a few power users on 4K displays may want B. RE5 could
     surface an EditorSettings toggle ("Use full window width" off
     by default).

   **RESOLVED**: Cap content at 1920px max-width, center horizontally on ultra-wide displays.

6. **Q6**: Phone deep-link behavior — go to phone-friendly view
   automatically? Today a `#/p/<id>` link opens the project on
   whichever tab was last persisted. On phone, that might be Map,
   which immediately shows a guard.
   - **Proposed default**: when a deep-link is hit on phone tier,
     override the persisted tab and land on Playtest (per §9.3).
     If the deep-link includes a `?view=` query param, honour that
     instead.

   **RESOLVED**: Auto-redirect phone visitors to view-only mode. Preserve deep-link via `?from=<original-url>` query param.

7. **Q7**: Pen input handling (Apple Pencil, Surface Pen) — first-class or "treat
   as mouse"? Pen has more precision than finger touch (sub-pixel
   accuracy, pressure sensitivity, hover detection on Surface Pen
   Pro). Authoring use cases:
   - Map painting with brush size from pressure.
   - Image Lab's procedural authoring (no obvious pen-specific
     win).
   - Animation timeline scrubbing — more precise than finger.
   - UI Builder element placement — more precise.
   - **Proposed default**: treat as mouse for RE2/3/4. Pointer
     events already report `pointerType === "pen"`; views can
     detect and optionally use pen-specific gestures later (RE5
     enhancement or post-RE5 feature task).
   - **Stretch**: Map brush pressure-sensitivity as a RE5 polish
     item if the brush tool supports a numeric "brush size" param
     (currently fixed-size).

   **RESOLVED**: Treat as mouse for MVP. First-class pen support deferred.

8. **Q8**: ResponsiveGuard escape hatch — should ResponsiveGuard always allow an "I know — continue
   anyway" escape hatch? Power users with a 600px-wide desktop
   browser window might genuinely want to use Map authoring at
   that size, even though it's cramped.
   - **Pro**: respects user choice; avoids "the tool tells me what
     I can do" frustration.
   - **Con**: muddies the design contract — if everything has an
     escape hatch, the tier model is theatrical.
   - **Proposed default**: NO escape hatch in RE4. Make the guard
     authoritative. If user feedback demands it, RE5 adds a hidden
     EditorSettings toggle ("Show all views regardless of screen
     size") that defaults off.

   **RESOLVED**: `?desktop=1` query parameter overrides the auto-detected tier. Developer/testing affordance + power-user override.

9. **Q9**: Reactive vs fixed-at-mount tier — should the breakpoint detection be reactive or fixed-at-mount?
   When the user rotates an iPad from portrait (820px, tablet) to
   landscape (1180px, still tablet) — fine, same tier. But
   portrait → landscape on a Surface Pro (912 → 1368) crosses the
   desktop boundary. Should the layout actually rearrange mid-
   session?
   - **Proposed default**: YES, reactive. `useTier()` subscribes to
     `matchMedia` change events. Layouts adapt live.
   - Caveat: ensure no in-progress state (drawer open, drag in
     progress) breaks across the transition. RE3 + RE4 should
     test this explicitly.

   **RESOLVED**: Reactive. Re-render on viewport / orientation change.

10. **Q10**: Light-mode treatment — do we treat `prefers-color-scheme: light` as a tier? Tier
    is about layout, not theme. Light mode is a theme concern.
    - **Proposed default**: out of scope. Editor stays dark-only
      for now. If light mode ships later, it's orthogonal to
      this plan's responsive layout.

    **RESOLVED**: Out of scope. Dark-only. Light mode is a future-future polish that nobody needs now.

---

## 13. Cross-references

- **[EDITOR_REDESIGN.md](./EDITOR_REDESIGN.md)** — R-phase parent.
  Each per-view section in §7 here is the responsive contract for
  the desktop baseline in EDITOR_REDESIGN §7. EDITOR_REDESIGN.md
  should gain a new **§6.6 "Responsive behaviour"** subsection
  cross-referencing this doc, with one sentence per view
  pointing to the §7 entry here.
- **[EDITOR_IFRAME.md](./EDITOR_IFRAME.md)** — Playtest takes
  over the viewport on phone (§7.11). The iframe's existing touch
  input handling already works for the in-game pad controls; this
  plan adds no new iframe message protocol.
- **[IMAGE_LAB.md](./IMAGE_LAB.md)** — Image Lab's tablet/phone
  behaviour (§7.8) defers procedural authoring to desktop.
  IMAGE_LAB.md should call out that the lab is desktop-only and
  cite this doc.
- **[SOUND_LAB.md](./SOUND_LAB.md)** — Sound Lab's tablet/phone
  behaviour (§7.9). Same desktop-only-authoring framing as Image
  Lab.
- **[STORE.md](./STORE.md)** — paired-session for "open on
  desktop" (§9.3, §12 open question 3). The QR-code CTA on phone
  guards is a placeholder until Store paired-session ships.
- **[CONSOLE.md](./CONSOLE.md)** — engine debug console is part
  of the engine, not the editor chrome; its responsive behaviour
  is the pack author's concern (the console is rendered inside
  the iframe). Out of scope here.
- **Apple Human Interface Guidelines — Touch Targets**:
  44×44pt minimum for interactive elements.
- **WCAG 2.1 Success Criterion 2.5.5 (Target Size)**: Level AAA,
  44×44 CSS pixels minimum.
- **Tailwind v4 docs**:
  - Container queries: https://tailwindcss.com/docs/responsive-design#container-queries
  - Breakpoint customisation via `@theme`:
    https://tailwindcss.com/docs/theme
- **MDN — Pointer Events**:
  https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- **../IDEAS.md** — this plan should be captured as an entry:
  `2026-05-16 — Responsive design (RESPONSIVE_DESIGN.md)` with
  status `Planning`. Append on commit of this doc.
- **../PLAN.md** — append a one-liner to the phase-status table:
  `RESPONSIVE_DESIGN | RE1 (plan) ✅ | RE2 primitives, RE3 shell,
  RE4 views, RE5 polish pending`.
- **../SESSION_STATE.md** — mention this doc as a parallel-priority
  editor work item alongside the remaining R4 phases. File-touched
  map: `docs/plans/RESPONSIVE_DESIGN.md` under "open tasks →
  editor."

---

## 14. Implementation summary

```
RE1 plan ─┐
          │
RE2 primitives ─┐                                        ┌─ RE5 polish
          │     │                                        │
RE3 shell ─┴─→  RE4 ┬─ RE4a Home ────────────────────────┤
                    ├─ RE4b Map ─────────────────────────┤
                    ├─ RE4c Entities ────────────────────┤
                    ├─ RE4d Animation ───────────────────┤
                    ├─ RE4e Scripts ─────────────────────┤
                    ├─ RE4f Project ─────────────────────┤
                    ├─ RE4g Assets ──────────────────────┤
                    ├─ RE4h Image Lab ◄── IMAGE_LAB ship ┤
                    ├─ RE4i Sound Lab ◄── SOUND_LAB ship ┤
                    ├─ RE4j UI Builder ◄ UI_BUILDER ship ┤
                    ├─ RE4k Playtest ◄── R4h ship ───────┤
                    └─ RE4l Editor Settings modal ───────┘
```

Critical-path: RE1 → RE2 → RE3 → RE4 (parallel-safe) → RE5.

Earliest-possible RE5 ship: ~10–12 days with parallel RE4 agents
(RE2: 2d, RE3: 2d, RE4 worst-case-sequential: 24d, RE5: 3d).

After RE5 ships, this doc graduates from "plan" to "historical
record + reference for the shipped surface." The shipped editor
is professional-grade at every viewport from a 320px iPhone to a
4K monitor — the user's stated bar for the editor's
professionalism is met.

---

End of RESPONSIVE_DESIGN.md.
