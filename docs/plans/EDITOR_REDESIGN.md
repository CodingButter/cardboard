# Editor visual overhaul — EDITOR_REDESIGN plan

A canonical design source-of-truth for the cardboard editor's visual
+ structural overhaul. **Doc-only.** Every existing feature stays;
this plan is about the chrome, the primitives, the layout, and the
per-view re-skin against seven new mockups in `Editor Design/`.

This doc is the **HOW IT LOOKS**. It is paired with
[EDITOR.md](./EDITOR.md), which remains the **WHAT IT DOES** spec
(architecture, IDB model, lifecycle, export pipeline, asset
ingestion). When implementation references "the editor plan" without
qualifier, both docs apply.

Cross-refs: [EDITOR.md](./EDITOR.md) (feature spec),
[EDITOR_IFRAME.md](./EDITOR_IFRAME.md) (Playtest depends on I2
telemetry), [MATERIALS.md](./MATERIALS.md) (visual reference for plan
doc density + tone), [ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md)
(phase-doc structure precedent),
[PACK_CHAIN.md](./PACK_CHAIN.md) (manifest/dependency surface
displayed in Project view + ProjectSettings tabs),
[../IDEAS.md](../IDEAS.md) (this redesign captured as an entry).

Last revised: 2026-05-16.

---

## 1. Goals & non-goals

### Goals

- **Visual + structural overhaul of the editor chrome and views.**
  A consistent, dense, designer-grade interface that replaces the
  current "shadcn-ish hand-rolled card stack" with a deliberate
  layout grammar (TopBar + PrimaryTabs + 3-pane workbench +
  StatusBar) backed by a small, well-typed primitive component
  library.
- **Every existing feature stays.** GridEditor still paints tiles,
  EntitiesEditor still authors prefabs, AnimationEditor still
  builds clips, ProjectSettingsModal still edits the manifest.
  The shapes change; the behaviour does not. No feature is removed.
- **Promote two views to first-class status.** "Project Settings"
  becomes a primary tab (the **Project** tab — build configuration,
  validation, log output, dependency surface), and the existing
  modal becomes a sub-surface of that tab. A new **Playtest** mode
  wraps the iframe with stats + console overlays.
- **Standardise the primitive vocabulary.** Sliders with amber
  thumbs, switches with amber-on / dark-off, property rows with
  uppercase-small-caps labels, badge pills, segmented controls,
  collapsible inspector sections. One implementation per primitive,
  used everywhere.
- **Keep the editor usable throughout the rollout.** Phased R1–R5;
  each phase is a single coherent commit. No multi-week dev branch.
  Existing smoke tests (12 + 16 + 91 + 33 + 90 + 55 + 14 + 14 +
  24 + 18 + ...) keep passing.
- **No new engine dependencies.** Editor stays React 19 + Tailwind
  v4. We are not introducing Radix, shadcn-cli, headless-ui,
  framer-motion, or any other primitive library. The new
  primitives are still hand-rolled — just more of them, and tighter.

### Non-goals

- **Not a feature addition.** No new tools, no new asset types, no
  new manifest fields. The scope is purely visual + structural.
- **Not an engine-UX redesign.** The engine-side modals
  (InventoryScreen, SettingsScreen, MainMenu, etc.) live in
  `packages/default-pack/scripts/ui/` and are pack content. Pack
  authors style their own modals via `api.ui.*`. This plan does
  not touch those — see [§12 open question](#12-open-questions) re:
  whether a coordinated re-skin is desirable later.
- **Not a Tailwind major-version bump.** Tailwind v4 stays. Token
  additions go in the `@theme` block of `apps/editor/index.css`.
- **Not a Monaco re-skin.** The Monaco editor in the Scripts view
  keeps its built-in dark theme; we control the chrome around it
  (tabs, status strip, problem list) but not its syntax-highlight
  palette.
- **Not a documentation site overhaul.** `apps/docs` already has
  its own visual identity via `fumadocs`. This plan is editor-only.
- **Not a mobile / touch redesign.** Editor targets desktop browsers
  at >=1366px wide. Tablet support is best-effort; phone support
  is out of scope.
- **Not adopting Component Reference.ts wholesale.** That file
  imports from `@/components/ui/*` (a shadcn-resolved alias the
  editor doesn't have) and uses Radix-backed primitives we are
  not bringing in. Treat it as a **design source**, not a
  drop-in starting point. Every primitive in §4 is a from-scratch
  hand-rolled implementation matching the *visual* contract
  Component Reference establishes.

### Design intent vs literal pixels

The seven mockups in `Editor Design/` were authored as visual
direction, not pixel-perfect specs. Treat them as canonical for:

- **Color palette + theme** — zinc-900 panels, amber accent for
  primary actions + slider thumbs + active-tab indicators, green
  for save/success, red for destructive/error.
- **Layout architecture** — TopBar + PrimaryTabs + 3-pane
  workbench + StatusBar; per-view rail composition.
- **Density + spacing + typography** — uppercase-small-caps panel
  headers with thin underlines, tight property rows, status pills,
  amber sliders with value chips.
- **Information hierarchy** — what goes in which pane, scan order,
  primary-vs-secondary action emphasis.

Treat them as **illustrative** for:

- **Property panel contents** — fields shown in Entity / Component
  / Build / etc. panels are GPT's guesses at what cardboard exposes.
  Real fields come from cardboard's actual data shapes:
  `packages/engine/src/AssetPack/types.ts` (`PackManifest`,
  `DeclarativePrefab`, `SpriteDef`, `SoundDef`), `apps/editor/src/
  lib/componentSchemas.ts` (`BUILT_IN_COMPONENT_SCHEMAS`), and the
  per-feature inspector specs in [EDITOR.md](./EDITOR.md). R4 view
  migrations populate the new visual containers with cardboard's
  real schemas; they don't copy the mockups' field lists verbatim.
- **Branding text** — wordmark says "CARDBOARD" not "RAYCAST";
  logo glyph is TBD pending user-provided icon.
- **Exact widget shapes** — implementer judgment governs. Slider
  has amber thumb + value chip (the *pattern*); exact dimensions
  are tuned during R2 against real content.

---

## 2. Status quo

Today's editor (commit `2edb94a`) is a working but visually
unfinished React 19 / Tailwind v4 app. Its shell is essentially the
pattern that fell out of the iframe pivot (I1) — `ProjectView.tsx`
renders a horizontal `workflow-mode` tab strip ("Map / Entities /
Scripts / Assets / Animation") above a per-mode surface, with a
single hard-coded "Project Settings" cog opening a giant modal.
The HomeScreen is a separate top-level page (project picker → enter
project → ProjectView). There is no concept of a Playtest mode;
the iframe runs continuously inside Map mode, mode-toggled via
buttons in EditorViewport's local header.

The visual language is the shadcn-derived zinc/amber palette spelled
out at the top of `apps/editor/src/components/ui.tsx`:
zinc-950 surface, zinc-900 panels, zinc-800 borders, amber-400
accents, with one `Card` / `CardHeader` / `CardContent` shape used
for almost every container. Buttons have four variants (primary
amber / secondary zinc / ghost / danger), inputs are a single
forwarded `<input>` with focus-ring amber-400, and a `Modal` helper
handles the URL-import + Settings overlays. The current scrollbar
treatment is the only deliberate cross-view aesthetic — amber thumb,
defined in `index.css` (`scrollbar-color: rgba(180,83,9,0.7)`).

Gaps the new mockups expose: no `Slider`, no `Switch`/`ToggleSwitch`,
no segmented control, no property-row layout, no status pill, no
progress bar, no log panel, no FPS graph, no pie chart, no key-value
list, no collapsible section, no inspector accordion, no compact
icon button with tooltip, no dropdown menu, no proper top-bar with
project + scene dropdowns, no status bar. The "no proper top-bar"
gap is the loudest — every view today reinvents its own header
(project name + back button + mode toggles + scene switcher) and
none of them agree on heights, gaps, or alignment. Densely
inspector-heavy views like EntitiesEditor have 1100+ LOC of
ad-hoc `<div className="flex items-center justify-between">`
rows that should collapse into a `PropertyRow` primitive.

---

## 3. Design vocabulary

Extracted from the seven PNGs and Component Reference.ts. This is
the *complete* aesthetic contract — R2 builds primitives to satisfy
it, R4 re-skins views to consume it. Where the mockup and Component
Reference disagree, the **mockup wins** (Component Reference is a
shadcn-port sketch; the rendered mockups are the renderable truth).

### 3.1 Colour palette

| Role | Token | Hex | Notes |
|---|---|---|---|
| App background | `--bg-app` | `#08090b` | Outermost frame. With a subtle top-left radial-gradient warm tint (`radial-gradient(circle at top left, #17120a 0, #08090b 36%, #050607 100%)`). |
| Panel surface | `--bg-panel` | `#0c0d0f` / `zinc-950/70` | Sidebars, inspector. |
| Card surface | `--bg-card` | `#0a0b0d` / `black/30` over panel | Inspector cards float a half-step darker than the panel. |
| Elevated card | `--bg-card-elev` | `#101114` | Tile-preset section headers, dropdown menus when open. |
| Active row | `--bg-active` | `amber-500/10` | Selected list item / active tab background. |
| Hover row | `--bg-hover` | `zinc-900` / `white/3` | Subtle. |
| Border default | `--border-default` | `zinc-800` (`#27272a` at 80% alpha — `zinc-800/80`) | Every panel edge. |
| Border accent | `--border-accent` | `amber-400` / `amber-500/50` | Active card edges, selected tiles. |
| Accent primary | `--accent-primary` | `amber-500` (`#f59e0b`) | Save buttons, sliders, switch-on, active-tab underline. |
| Accent hover | `--accent-primary-hover` | `amber-400` (`#fbbf24`) | Hover state. |
| Accent muted | `--accent-muted` | `amber-500/10` over panel | Active-tab fill. |
| Success | `--accent-success` | `emerald-500` (`#10b981`) / `emerald-400` text | "All changes saved" dot, "Live" badge. |
| Warning | `--accent-warn` | `yellow-400` (`#facc15`) | Validation warnings. |
| Danger | `--accent-danger` | `red-500` (`#ef4444`) | Destructive buttons, validation errors, Stop button border. |
| Info | `--accent-info` | `sky-400` (`#38bdf8`) | Build-info pie segments, draw-call meter. |
| Special | `--accent-special` | `purple-400` (`#c084fc`) | Tag pills (e.g. `wall`, `solid` on cell inspector). |
| Text primary | `--fg-primary` | `zinc-100` (`#f4f4f5`) | Headings, body. |
| Text secondary | `--fg-secondary` | `zinc-300` (`#d4d4d8`) | Property labels in row form. |
| Text muted | `--fg-muted` | `zinc-500` (`#71717a`) | Section labels, value units. |
| Text faint | `--fg-faint` | `zinc-600` (`#52525b`) | Empty-state, "Last edited" metadata. |
| Text mono | `--fg-mono` | `zinc-200` mono | Values: positions, file paths, hex codes. |

Background ratios observed in mockups: ~70% panel surface,
~15% card surface, ~10% canvas / iframe, ~5% TopBar dark.

### 3.2 Spacing scale

Tailwind defaults; cardboard-editor specific usages:

- **Panel padding**: `p-4` (16px) on sidebars, `p-5` (20px) on
  inspectors. Modal content panels: `p-6` (24px).
- **Card padding**: `px-5 pt-5 pb-3` on CardHeader,
  `px-5 py-4` on CardContent.
- **PropertyRow vertical rhythm**: `py-2` (8px) per row.
- **Section gap**: `space-y-6` (24px) between named sections in
  a sidebar (e.g. tile-preset categories "Walls / Floors /
  Ceilings"). `space-y-4` (16px) between cards in an inspector.
- **Inline gap**: `gap-2` (8px) for icon+label, `gap-3` (12px) for
  primary-action button row, `gap-5` for dual-pane layout columns.
- **TopBar gutter**: `px-5` (20px) horizontal.

### 3.3 Radius scale

- `rounded-sm` (2px) — chip swatches inside tile-preset tiles.
- `rounded-md` (6px) — most buttons, inputs, tile-preset tile body.
- `rounded-lg` (8px) — cards, dropdown panels, log container.
- `rounded-xl` (12px) — CARDBOARD logo plaque, large preview frames.
- `rounded-full` — avatar circle, status dots, slider thumbs, pills.

### 3.4 Typography

- **Family**: system UI stack (`-apple-system, BlinkMacSystemFont,
  "Segoe UI", Roboto, "Inter", sans-serif`). Mono: `ui-monospace,
  SFMono-Regular, "JetBrains Mono", monospace` for values, log
  output, Monaco.
- **Sizes** (Tailwind):
  - `text-[10px] uppercase tracking-wider` — top-row hint labels
    ("PROJECT", "SCENE", "POSITION" above an input).
  - `text-xs` (12px) — section labels (uppercase), badge text,
    metadata, status-bar info.
  - `text-sm` (14px) — body, property labels (non-uppercase),
    button labels.
  - `text-base` (16px) — card titles in inspectors.
  - `text-lg` (18px) — CARDBOARD logo word, recent-project name.
- **Weights**:
  - `font-black` (900) — RAYCAST wordmark.
  - `font-bold` (700) — value highlights in TopBar hint row
    (`Classic 90°`, `16 × 16`).
  - `font-semibold` (600) — card titles, primary nav button.
  - `font-medium` (500) — body emphasis.
  - `400` — default body.
- **Tracking**: `tracking-[0.25em]` for the "EDITOR" subtitle
  under the logo, `tracking-wider` for uppercase section labels.

### 3.5 Iconography

`lucide-react` is already a dep. The mockup uses:

- `Home, Grid3X3, Cuboid, ImageIcon, Code2, Film, Package` — nav tabs.
- `Play, Square (Stop), Pause, RotateCcw, Eye` — Playtest controls.
- `Save, Upload, Settings, Plus, Search, Folder, X` — TopBar + asset.
- `WandSparkles` — "Generate Preview" affordance on assets.
- `ChevronDown` — dropdowns, collapsibles.
- `AlertTriangle, AlertCircle, Info, CheckCircle2` — log line types,
  validation chips.
- `Bug` — debug-view toggle in Playtest.
- `Box` — placeholder logo glyph; user-provided icon swaps in once
  cardboard's brand glyph is authored (TBD — incoming via
  `Editor Design/` per current discussion). The red plaque + the
  "CARDBOARD" wordmark + the typography all stay.

No custom SVGs anticipated for R1–R4. If R5 polish reveals a gap
(e.g. an isometric-grid icon for the Map tab), add it then.

### 3.6 Animations

Subtle, fast, no spring/bounce:

- **Hover transitions**: `transition-colors duration-150`.
- **Focus rings**: `ring-2 ring-amber-400` (instant, no animation).
- **Tab underline shift**: `transition-[border-color] duration-200`.
- **Collapsible expand**: `transition-[max-height] duration-200
  ease-out`. (Max-height trick — no animated layout.)
- **Slider thumb drag**: no transition (immediate).
- **Toggle switch flip**: `transition-transform duration-150`.

No framer-motion. No `view-transitions` API. No layout animation
beyond toggle/collapsible. Page-level mode transitions are
instant.

---

## 4. Missing-primitive inventory

What `apps/editor/src/components/ui.tsx` ships today: `Card`,
`CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
`Button` (4 variants × 2 sizes), `Input`, `Textarea`, `Label`,
`Separator`, `Modal`. 11 primitives.

What the mockups require beyond that — **27 new primitives**.
Each gets a short shape description + props sketch. R2 builds them
into `apps/editor/src/components/ui/` (a directory per primitive,
or one file per primitive — R2 decides the file layout).

### 4.1 `Slider`

Horizontal range slider with amber thumb, dark track, fill before
the thumb tinted amber.

```ts
interface SliderProps {
  value: number;
  min?: number;        // default 0
  max?: number;        // default 100
  step?: number;       // default 1
  onChange: (next: number) => void;
  disabled?: boolean;
  /** Inline value chip on the right ("90°"). */
  valueLabel?: React.ReactNode;
  /** Optional value-chip variant — `outline` (border-zinc-700)
   *  vs `solid` (bg-amber-500/10). Default outline. */
  valueChipVariant?: "outline" | "solid";
}
```

Layout: `[───●─────] 90°`. Thumb is a `rounded-full` 14px circle,
amber-500 with a subtle inner ring. Track height 4px. Use native
`<input type="range">` styled via `::slider-thumb`.

### 4.2 `ToggleSwitch`

iOS-style toggle, amber-on / zinc-700-off.

```ts
interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";       // sm = 28x16, md = 36x20
  "aria-label": string;     // required (a11y)
}
```

Track rounded-full, thumb `rounded-full` slides left↔right via
`transform`.

### 4.3 `PropertyRow`

The workhorse row for inspectors: small-caps label on the left,
control on the right, optional unit chip after the control.

```ts
interface PropertyRowProps {
  label: React.ReactNode;
  /** Label modifier — uppercase tracking small caps (default)
   *  or sentence-case. */
  labelStyle?: "small-caps" | "plain";
  /** Optional inline help text below the label. */
  hint?: React.ReactNode;
  /** Right-side control (Input, Slider, ToggleSwitch, Select). */
  children: React.ReactNode;
  /** Optional unit chip rendered after the control. */
  unit?: React.ReactNode;
  /** Full-width control? Default false (label : control 40/60). */
  stacked?: boolean;
}
```

Used by EntitiesEditor's component sub-forms, GridEditor's cell
inspector, ProjectSettings tabs, AnimationEditor's clip inspector.

### 4.4 `PanelHeader`

Section header inside a panel/sidebar: uppercase small-caps label,
optional trailing action (button or count), thin underline.

```ts
interface PanelHeaderProps {
  title: React.ReactNode;
  /** Optional trailing element — Badge with count, Button "+ New",
   *  IconButton with Search, etc. */
  action?: React.ReactNode;
  /** Visual size. Default `md`. */
  size?: "sm" | "md";
}
```

### 4.5 `CollapsibleSection`

An expand/collapse section with a chevron + uppercase label, used
by the Entities inspector to fold/unfold a Light component, a
Sprite component, a Movement component, etc.

```ts
interface CollapsibleSectionProps {
  title: React.ReactNode;
  /** Defaults to closed. */
  defaultOpen?: boolean;
  /** Controlled mode. */
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Optional trailing element (e.g. ToggleSwitch to enable the
   *  whole component). */
  trailing?: React.ReactNode;
  /** Optional icon left of the title (Light → Sun, Sprite →
   *  ImageIcon, etc.). */
  icon?: React.ReactNode;
  children: React.ReactNode;
}
```

### 4.6 `ColorChip`

Native-color-picker swatch + readable value (hex), with optional
click-to-open behaviour.

```ts
interface ColorChipProps {
  value: string;        // hex, e.g. "#f59e0b"
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Shape — square swatch vs circle. */
  shape?: "square" | "circle";
}
```

Used by Light component (color), Sprite tint, ProjectSettings
brand colour.

### 4.7 `Badge`

Small inline status indicator. Multiple intent colours. Already
informally used in Component Reference — this is the formal
typed primitive.

```ts
interface BadgeProps {
  children: React.ReactNode;
  variant?: "amber" | "emerald" | "sky" | "red" | "purple" |
            "zinc" | "yellow";
  shape?: "rounded" | "pill";    // rounded-md vs rounded-full
  outlined?: boolean;            // border vs solid bg
}
```

Examples: `<Badge variant="amber">Walls</Badge>`,
`<Badge variant="emerald">Live</Badge>`,
`<Badge variant="purple">solid</Badge>`.

### 4.8 `StatusPill`

A larger, pill-shaped status indicator with leading dot, used by
TopBar for "All changes saved", by ProjectView header for
build-state.

```ts
interface StatusPillProps {
  variant: "ok" | "warn" | "error" | "info" | "neutral";
  children: React.ReactNode;
  /** Hide the leading dot. */
  noDot?: boolean;
}
```

### 4.9 `IconButton`

Icon-only button with a tooltip (`title` attribute for now; if R5
demands richer tooltip behaviour, swap to a `Tooltip` primitive).

```ts
interface IconButtonProps extends Omit<ButtonProps, "children"> {
  icon: React.ReactNode;
  tooltip: string;
  /** Size override — defaults to `sm` (32x32). */
  size?: "sm" | "md";
}
```

### 4.10 `TabStrip`

Horizontal tab navigation. Two variants used in the mockups:

- **Primary** (PrimaryTabs): icon + label, 40-48px tall, active tab
  has amber underline + amber text + faint amber background.
  Used as global app nav (Home / Map / Entities / Assets / Scripts /
  Animation / Project).
- **Secondary** (modal tabs): label-only, 32-36px tall, active tab
  has amber text + transparent background + amber bottom border.
  Used in ProjectSettings modal (Manifest / Dependencies / Export /
  Advanced) and StatusConsole (Output / Problems / Search).

```ts
interface TabStripProps<T extends string> {
  variant: "primary" | "secondary";
  tabs: ReadonlyArray<{
    id: T;
    label: React.ReactNode;
    icon?: React.ReactNode;     // primary only
    badge?: React.ReactNode;    // secondary — e.g. error count
  }>;
  value: T;
  onChange: (next: T) => void;
}
```

### 4.11 `TopBar`

Full app header. ~64px tall. Layout (left → right):

1. Cardboard logo plaque (`rounded-xl` 40px square + word "CARDBOARD"
   over "EDITOR" subtitle).
2. Vertical separator.
3. Project DropdownMenu (label "PROJECT" above, current name below,
   chevron). Width ~224px.
4. Scene DropdownMenu (label "SCENE" above). Width ~224px.
5. Spacer.
6. StatusPill (`<StatusPill variant="ok">All changes saved</StatusPill>`).
7. Playtest toggle Button (outlined when off, amber filled when on).
8. Export Button (amber outlined, leading `Upload` icon).
9. Save Button (amber solid, leading `Save` icon).
10. Settings IconButton (cog) — opens the Project Settings tab
    (or the modal during R3 transition; see §10).
11. Avatar disc — user initials, sky-300 text.

```ts
interface TopBarProps {
  projectName: string;
  projects: ReadonlyArray<{ id: string; name: string }>;
  onSelectProject: (id: string) => void;
  sceneName: string;
  scenes: ReadonlyArray<{ path: string; label: string }>;
  onSelectScene: (path: string) => void;
  saveState: "saved" | "saving" | "dirty" | "error";
  /** Map → "Playtest" toggle. When true, renders the Playtest view. */
  playtestActive: boolean;
  onTogglePlaytest: () => void;
  onExport: () => void;
  onSave: () => void;
  onOpenSettings: () => void;
  /** User initials for the avatar disc. */
  userInitials?: string;
}
```

### 4.12 `StatusBar`

Bottom-fixed strip. ~28-32px tall. Mosaic of context-sensitive
info: cursor cell (Map), zoom level (Map / Animation), build state
(Project), playhead time (Animation), file path (Scripts), or
custom slots per view.

```ts
interface StatusBarProps {
  /** Sections, rendered left → right, separated by vertical
   *  rule (`border-r border-zinc-800`). The last section is
   *  right-aligned. */
  sections: ReadonlyArray<{
    id: string;
    label?: React.ReactNode;
    value: React.ReactNode;
    align?: "left" | "right";
  }>;
}
```

### 4.13 `ProgressBar`

Horizontal progress bar. Amber fill, dark track. Used for export
builds, light bakes, asset imports.

```ts
interface ProgressBarProps {
  value: number;          // 0..1
  /** Optional secondary indicator — animated stripes for
   *  indeterminate. */
  indeterminate?: boolean;
  size?: "sm" | "md";
  /** Optional label above the bar (e.g. "Baking lights…"). */
  label?: React.ReactNode;
}
```

### 4.14 `LogPanel`

Scrollable log output. Each line has a type + timestamp + message.
Used in StatusConsole (Map / Entities footer), Project view's main
log, Playtest view's footer.

```ts
type LogLineType = "info" | "warn" | "error" | "success" | "debug";

interface LogLine {
  id: string;            // stable for keying
  type: LogLineType;
  time?: string;         // pre-formatted "[12:34:21]"
  message: React.ReactNode;
}

interface LogPanelProps {
  lines: ReadonlyArray<LogLine>;
  /** Auto-scroll to bottom on new lines. */
  follow?: boolean;
  /** Filter pills above the log. */
  filter?: ReadonlyArray<LogLineType>;
  onFilterChange?: (next: ReadonlyArray<LogLineType>) => void;
  /** "Clear" button shown in the panel header. */
  onClear?: () => void;
}
```

### 4.15 `StatsBlock`

Compact label-above-value vertical pair, used in Playtest's stats
column. Multiple StatsBlocks compose into a stats card.

```ts
interface StatsBlockProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Trend indicator — small ↑ / ↓ / − after the value, in a tone
   *  colour. Optional. */
  trend?: "up" | "down" | "flat";
  /** Override value text colour for emphasis (e.g. amber for FPS
   *  drop below 60). */
  emphasis?: "default" | "warn" | "error" | "success";
  /** Force value font — mono (default for numeric) or sans. */
  font?: "mono" | "sans";
}
```

### 4.16 `KeyValueList`

Table-like display of metadata. Two columns: label / value. Used
in HomeScreen's recent-project card, ProjectSettings dependency
sub-tab, Asset inspector.

```ts
interface KeyValueListProps {
  rows: ReadonlyArray<{ label: React.ReactNode; value: React.ReactNode }>;
  /** Visual density — `comfortable` (py-2) vs `dense` (py-1). */
  density?: "comfortable" | "dense";
  /** Render rows with bottom borders (default true). */
  divided?: boolean;
}
```

### 4.17 `FpsGraph`

Small inline canvas-based real-time line chart. Used in Playtest's
footer. Renders frame-time as a sparkline with red overlay when
above target.

```ts
interface FpsGraphProps {
  /** Buffer of samples. Ring-buffer; pass the latest N. */
  samples: ReadonlyArray<number>;     // frame times in ms
  /** Target frame time (16.67ms for 60fps). Drawn as a horizontal
   *  reference line. */
  target?: number;
  /** Width / height — fixed 220x60 by default. */
  width?: number;
  height?: number;
  /** Optional legend (e.g. "16.7ms target"). */
  legend?: React.ReactNode;
}
```

Implementation: imperative canvas via `useEffect`, repaints when
`samples` reference changes. No external charting lib.

### 4.18 `DropdownMenu`

A button that opens a panel of selectable options. Used by TopBar's
Project + Scene pickers, by ProjectView's "Region" / "Brush"
selectors.

```ts
interface DropdownMenuProps<T extends string> {
  /** Triggers — usually a styled button with chevron. */
  trigger: React.ReactNode;
  value: T;
  options: ReadonlyArray<{
    id: T;
    label: React.ReactNode;
    /** Optional icon. */
    icon?: React.ReactNode;
    /** Optional disabled flag. */
    disabled?: boolean;
  }>;
  onChange: (next: T) => void;
  /** Alignment under the trigger. Default `start`. */
  align?: "start" | "end";
  /** Width override. Default = match trigger. */
  width?: number;
}
```

Hand-rolled with `useRef` + `useLayoutEffect` for positioning. No
Radix.

### 4.19 `SegmentedControl`

Radio-button-style grouped toggles, all visible at once. Used for
the Playtest top action bar's view-mode toggles ("Free Camera /
Half Walk / Debug View"), for the Animation editor's playback
direction (forward / reverse / ping-pong).

```ts
interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<{
    id: T;
    label?: React.ReactNode;
    icon?: React.ReactNode;
  }>;
  value: T;
  onChange: (next: T) => void;
  size?: "sm" | "md";
  /** Allow zero selection (e.g. tone toggles). */
  allowEmpty?: boolean;
}
```

### 4.20 `FilePicker`

Drag-drop zone + button-triggered file picker, used by HomeScreen
("Import Pack") and Assets view ("Import Files"). Wraps a hidden
`<input type="file">`.

```ts
interface FilePickerProps {
  accept?: string;          // ".apg,.zip" or "image/*"
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  /** Render mode — `button` for a single trigger, `dropzone` for
   *  the big drag-drop variant. */
  mode?: "button" | "dropzone";
  /** Children inside the dropzone — usually a Cuboid icon +
   *  instructional text. */
  children?: React.ReactNode;
  /** Disabled while a file is being processed. */
  disabled?: boolean;
}
```

### 4.21 `PieChart`

Small inline canvas-based pie/donut chart. Used by Project view's
"Build Size Composition" card.

```ts
interface PieSegment {
  id: string;
  label: React.ReactNode;
  value: number;
  /** Token colour name from §3.1 ("amber", "emerald", "sky",
   *  "red", "purple"). */
  variant: "amber" | "emerald" | "sky" | "red" | "purple" | "zinc";
}

interface PieChartProps {
  segments: ReadonlyArray<PieSegment>;
  size?: number;              // px diameter, default 96
  innerRadius?: number;       // donut hole, default 60% of size
  /** Render a legend to the side. */
  legend?: boolean;
}
```

### 4.22 `ScrollArea`

A scrollable container that *forces* the editor's amber-thumb
scrollbar styling (already global in `index.css`). Wraps `overflow:
auto` + a defined `maxHeight` and a sticky-fade gradient at the
bottom when content overflows. Cheap; could be a className helper
but R2 should formalise it.

```ts
interface ScrollAreaProps {
  className?: string;
  /** Direction — vertical default. */
  axis?: "y" | "x" | "both";
  children: React.ReactNode;
}
```

### 4.23 `Toolbar`

A horizontal row of grouped controls separated by vertical rules,
used by GridEditor's tool palette + Animation editor's clip
toolbar + Playtest's top action bar.

```ts
interface ToolbarProps {
  /** Sections of controls, separated by `Separator` between them. */
  groups: ReadonlyArray<{
    id: string;
    children: React.ReactNode;
  }>;
  /** Optional right-aligned tail group. */
  tail?: React.ReactNode;
}
```

### 4.24 `EmptyState`

A centred placeholder for empty surfaces — "No projects yet", "No
animations defined", "No assets imported". Icon + heading +
caption + optional CTA.

```ts
interface EmptyStateProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;     // a Button or two
}
```

### 4.25 `Tooltip`

Hover tooltip. Hand-rolled, no Radix. Trigger element wraps a
target; tooltip body floats absolutely.

```ts
interface TooltipProps {
  content: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  /** ms delay before showing. Default 400. */
  delay?: number;
  children: React.ReactElement;
}
```

R5 priority — most of R2/R3/R4 can rely on the browser-native
`title` attribute. Tooltip is the polish primitive.

### 4.26 `Select`

A native-`<select>`-styled dropdown for forms. Distinct from
`DropdownMenu` (which is a custom-painted floating panel and
supports icons / groupings). `Select` is the cheap one — used in
inspector PropertyRows.

```ts
interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: ReadonlyArray<{ value: string; label: React.ReactNode }>;
  size?: "sm" | "md";
}
```

### 4.27 `ChartLegend`

Tiny shared legend rendered inline with PieChart and FpsGraph.

```ts
interface ChartLegendProps {
  items: ReadonlyArray<{
    label: React.ReactNode;
    variant: "amber" | "emerald" | "sky" | "red" | "purple" | "zinc";
    value?: React.ReactNode;
  }>;
  layout?: "horizontal" | "vertical";
}
```

### Summary inventory

| # | Primitive | Used in views |
|---|---|---|
| 1 | Slider | Map (FOV, Ambient, Brightness), Entities (Light intensity), Animation (speed), Project (export quality), Playtest (FOV, light intensity) |
| 2 | ToggleSwitch | Map (Solid, BlockLight, Fog), Entities (component-enabled, all sub-rows), Project (Minify, Source Maps, etc), Playtest (overlays) |
| 3 | PropertyRow | All inspectors |
| 4 | PanelHeader | All sidebars |
| 5 | CollapsibleSection | Entities inspector, ProjectSettings tabs |
| 6 | ColorChip | Entities (Light color, Sprite tint), ProjectSettings (brand) |
| 7 | Badge | Map (layer pills), Entities (tag chips), Project (validation counts), Playtest (debug categories) |
| 8 | StatusPill | TopBar, Project header, validation summary |
| 9 | IconButton | Toolbars, inspector kebab menus |
| 10 | TabStrip | PrimaryTabs (top), modal tabs, StatusConsole tabs, Scripts file tabs |
| 11 | TopBar | App shell |
| 12 | StatusBar | App shell |
| 13 | ProgressBar | Project build, light bake, asset import |
| 14 | LogPanel | Map footer, Project main log, Playtest console |
| 15 | StatsBlock | Playtest left rail, HomeScreen recent-projects |
| 16 | KeyValueList | ProjectSettings dependencies, Asset inspector, HomeScreen project metadata |
| 17 | FpsGraph | Playtest footer |
| 18 | DropdownMenu | TopBar project/scene, GridEditor brushes |
| 19 | SegmentedControl | Playtest mode toggles, Animation playback direction, ProjectSettings tone toggles |
| 20 | FilePicker | HomeScreen import, Assets import, Entities sprite picker |
| 21 | PieChart | Project build-size composition |
| 22 | ScrollArea | All sidebars + log panels |
| 23 | Toolbar | Map tool palette, Animation toolbar, Playtest action bar |
| 24 | EmptyState | Home (no projects), Assets (no imports), Animation (no clips), Scripts (no files) |
| 25 | Tooltip | R5 polish — applies everywhere |
| 26 | Select | Inspector forms, ProjectSettings, StatusConsole filters |
| 27 | ChartLegend | PieChart + FpsGraph |

**Total: 27 new primitives.** Combined with the 11 existing
(`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`,
`Button`, `Input`, `Textarea`, `Label`, `Separator`, `Modal`), the
final ui library lands at **38 primitives**.

---

## 5. Tailwind token additions

`apps/editor/index.css` currently imports Tailwind v4 + sets
scrollbar styling. We add a `@theme` block defining the cardboard
editor's token vocabulary so the primitives in §4 reference named
tokens, not raw hex/zinc strings sprinkled across the codebase.

### 5.1 Proposed `@theme` block additions

```css
@theme {
  /* Surface ramp */
  --color-bg-app: #08090b;
  --color-bg-panel: oklch(0.18 0 0 / 0.7);          /* zinc-950/70 */
  --color-bg-card: oklch(0.14 0 0 / 0.7);           /* black/30 over panel */
  --color-bg-card-elev: #101114;
  --color-bg-active: oklch(0.74 0.18 65 / 0.1);     /* amber-500/10 */
  --color-bg-hover: oklch(0.20 0 0);                /* zinc-900 */

  /* Border ramp */
  --color-border: oklch(0.27 0 0 / 0.8);            /* zinc-800/80 */
  --color-border-strong: oklch(0.32 0 0);           /* zinc-700 */
  --color-border-accent: oklch(0.74 0.18 65);       /* amber-500 */

  /* Accent ramp */
  --color-accent: oklch(0.74 0.18 65);              /* amber-500 */
  --color-accent-hover: oklch(0.79 0.17 65);        /* amber-400 */
  --color-accent-muted: oklch(0.74 0.18 65 / 0.1);
  --color-accent-strong: oklch(0.65 0.20 65);       /* amber-600 */

  /* Semantic intent */
  --color-ok: oklch(0.70 0.17 162);                 /* emerald-500 */
  --color-warn: oklch(0.85 0.16 90);                /* yellow-400 */
  --color-danger: oklch(0.65 0.22 25);              /* red-500 */
  --color-info: oklch(0.74 0.15 235);               /* sky-400 */
  --color-special: oklch(0.71 0.20 295);            /* purple-400 */

  /* Text ramp */
  --color-fg-primary: oklch(0.95 0 0);              /* zinc-100 */
  --color-fg-secondary: oklch(0.85 0 0);            /* zinc-300 */
  --color-fg-muted: oklch(0.55 0 0);                /* zinc-500 */
  --color-fg-faint: oklch(0.45 0 0);                /* zinc-600 */

  /* Shadows */
  --shadow-panel: 0 1px 0 oklch(1 0 0 / 0.04) inset,
                  0 8px 24px -16px oklch(0 0 0 / 0.6);
  --shadow-popover: 0 12px 32px -8px oklch(0 0 0 / 0.7);

  /* Radii (formalising what's used) */
  --radius-card: 0.5rem;       /* 8px */
  --radius-button: 0.375rem;   /* 6px */
  --radius-pill: 9999px;
  --radius-logo: 0.75rem;      /* 12px */

  /* Spacing rhythm tokens (named for clarity) */
  --gap-panel: 1rem;           /* 16px */
  --gap-inspector: 1.25rem;    /* 20px */
  --gap-section: 1.5rem;       /* 24px */
}
```

Components reference `bg-(--color-bg-panel)`, `text-(--color-fg-muted)`,
etc. directly; Tailwind v4 resolves CSS variables in arbitrary
values via the `@theme` block.

### 5.2 Scrollbar adjustment

`index.css`'s existing scrollbar treatment already matches §3
(amber thumb, transparent track). Confirm it stays unchanged in
R5 polish. No alteration in R1–R4.

### 5.3 New utility classes (sparing)

A handful of patterns appear often enough to be worth a utility
shortcut. R2 adds these as `@utility` declarations:

```css
@utility uppercase-label {
  text-transform: uppercase;
  letter-spacing: 0.05em;        /* tracking-wider */
  font-size: 0.75rem;             /* text-xs */
  color: var(--color-fg-muted);
  font-weight: 500;
}

@utility panel-surface {
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border);
}

@utility card-surface {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-card);
}
```

Avoid utility sprawl — `@utility` is for genuine repeated patterns,
not for one-off compositions.

### 5.4 Note on Tailwind v4 vs v3

Editor uses Tailwind v4. Token additions go in `@theme`, not
`tailwind.config.js`. `@source` directives in `index.css` already
pull in pack-side classes for engine modal compatibility; those
stay untouched.

---

## 6. Shell architecture

The chrome that wraps every view. Stable across R3+; new views
slot into the body slot.

### 6.1 Vertical structure

```
+-------------------------------------------------------------+
| TopBar                                       (64px tall)    |
+-------------------------------------------------------------+
| PrimaryTabs                                  (48px tall)    |
+-------------------------------------------------------------+
|                                                             |
|                                                             |
|   ViewBody — fills available height                         |
|   (per-view 3-pane / 2-pane / 1-pane layout)                |
|                                                             |
|                                                             |
+-------------------------------------------------------------+
| StatusBar                                    (32px tall)    |
+-------------------------------------------------------------+
```

Total chrome reserves 144px vertical (64 + 48 + 32). On a
1080p browser at 100% zoom, ViewBody gets ~936px. On a
1440x900 browser, ~756px.

### 6.2 TopBar contents

See §4.11. Always present. The Playtest button is a *toggle* —
when active, the entire ViewBody is replaced by the Playtest view
regardless of which PrimaryTab is selected. Click again to exit
back to the underlying tab.

### 6.3 PrimaryTabs

7 tabs in fixed order (the order matters — left-to-right reflects
authoring flow):

1. **Home** — `Home` icon. Project picker + recents.
2. **Map** — `Grid3X3` icon. Tile/scene editor (current GridEditor + Viewport).
3. **Entities** — `Cuboid` icon. Prefab/component editor.
4. **Assets** — `ImageIcon` icon. Asset library browser (new view in R4g).
5. **Scripts** — `Code2` icon. Monaco script editor.
6. **Animation** — `Film` icon. Sprite-sheet animation editor.
7. **Project** — `Package` icon. Build configuration + validation + log (promoted from modal).

PrimaryTabs reads/writes the workflow-mode `localStorage` key
(currently `editor.workflowMode`). New persisted vocabulary:
`"home" | "map" | "entities" | "assets" | "scripts" | "animation"
| "project" | "playtest"`. (Playtest is persisted so that a tab
reload returns the user to the same view they left.)

### 6.4 StatusBar

Bottom-fixed strip. Sections vary per view:

- **Home**: app version (right-aligned).
- **Map**: cursor cell `(33, 31, 0)` | active layer "Walls" | tile name "Brick Wall 01" | selection "1 cell" | zoom "100%".
- **Entities**: selected prefab name | component count | asset bytes.
- **Assets**: selection count | total file bytes | filter active state.
- **Scripts**: file path | cursor line/col | language mode | indent.
- **Animation**: frame `12 / 24` | playhead `0.400s` | speed `1.0×` | loop mode.
- **Project**: build status | last build time | output bytes.
- **Playtest**: FPS | draw calls | player pos (delegated to Playtest footer instead — see §7.9).

### 6.5 Body layout grammar

Per-view body uses one of:

- **3-pane**: `grid-cols-[300px_1fr_380px]` — left rail / center
  canvas / right inspector. Used by Map, Entities, Animation,
  Scripts.
- **2-pane**: `grid-cols-[300px_1fr]` or `grid-cols-[1fr_360px]` —
  used by Assets (left filters + center grid + right inspector
  collapsing to 2-pane on narrow widths), Project (left categories
  + center config).
- **1-pane**: full-width single surface. Used by Home (centred
  layout up to 1280px) and Playtest in fullscreen variant.

Body grid columns are pinned widths, never percentage. Resizable
splitters are R5 polish — not in scope for R3/R4.

---

## 7. Per-view migration plans

One section per view. **Order**: Home, Map, Entities, Assets,
Scripts, Animation, Project, ProjectSettings modal, Playtest.
Each section: current state → mockup analysis → migration steps →
required primitives (cross-ref §4) → which agent can land it
independently.

### 7.1 Home (mockup: Component Reference §HomeProjectPageReference)

**Current state.** `apps/editor/src/views/HomeScreen.tsx` (380 LOC)
renders a project picker: list of recent projects on the left,
"New Project" / "Import Pack" / "Open URL Pack" actions on the
right. Layout is a vertically-stacked sequence of `Card`s. No
template gallery. No project thumbnails. No "last edited" metadata
beyond a single timestamp line.

**Mockup analysis.** Two-column layout (`grid-cols-[1.2fr_1fr]`,
`gap-5`, `p-6`):

- Left column: "Recent Projects" Card with vertically stacked
  rows. Each row: 180px-wide thumbnail (radial-gradient placeholder
  for projects without screenshots) + project name + last-edited
  metadata + two version Badges + a circular amber Play
  IconButton on the right.
- Right column: top "Create or Import" Card with three full-width
  action buttons (New Project amber, Import Pack outlined, Open URL
  outlined). Bottom "Templates" Card with a 3-column grid of
  template tiles (Empty / Classic Dungeon / Sci-Fi Base).

**Migration steps.**

1. Rebuild `HomeScreen.tsx` against the new shell — it's
   inside-the-shell now (TopBar shows "Home" tab active, no
   project selected so Project/Scene dropdowns disabled).
2. Compose the layout from new primitives:
   `Card` + `CardHeader` + `CardContent` (existing) + `Badge` +
   `KeyValueList` + `EmptyState` + `FilePicker` (drag-drop
   variant for "Import Pack").
3. Recent-project row: `grid-cols-[180px_1fr_auto]` `gap-4`
   `rounded-lg` border-zinc-800. Selected/most-recent variant has
   `border-amber-400 bg-amber-500/5`.
4. Project thumbnail: in R4a, use the existing
   `EditorProjectStore.getProjectThumbnail(projectId)` if a
   thumbnail bake exists, else the radial-gradient placeholder.
   (Thumbnail bake is a Project-tab-side concern; HomeScreen just
   reads the latest cached PNG.)
5. Template tiles: `grid-cols-3` `gap-3`, each a tile with
   aspect-video preview + name + caption. Hover state:
   `hover:border-amber-400`. Click → bootstrap project from
   template.

**Primitives needed.** Card (existing), Badge, KeyValueList,
EmptyState, FilePicker, IconButton, Button (existing).

**Agent**: R4a. Independent. No dependencies.

### 7.2 Map (mockup: Map.png)

**Current state.** `apps/editor/src/views/GridEditor.tsx` (1806 LOC)
renders a top-down grid canvas in the centre, a tile-palette
sidebar on the left, and an inspector on the right that includes a
3D preview, cell inspector, scene settings card, and quick tools.
`EditorViewport.tsx` (330 LOC) wraps this with an iframe overlay
in play mode. The current layout is fluid-width and doesn't have
the deliberate panel rhythm the mockup establishes.

**Mockup analysis.** 3-pane shell:

- **Left rail (300px wide)**: at the top, a "TOOLS" PanelHeader
  with `grid-cols-2` of tool tiles (Select / Paint / Entity / Light
  / Eraser / Fill — six tiles in 3 rows of 2, with the active tool
  amber-filled). Below: a "Brush" SegmentedControl. Below: tile
  category sections "TILES", "WALLS", "FLOORS", "CEILINGS",
  "DOORS", "DECOR" — each is a CollapsibleSection with a 4-column
  grid of `aspect-square rounded-md` tile chips. Active tile has
  `border-amber-400` ring.
- **Center (fluid)**: a 14-tall Toolbar at the top with
  `Select / Paint / Entity / Light` tool buttons + vertical
  separator + layer Badges (Walls amber-tinted-active, Floors,
  Ceilings, Entities, all toggleable) + right-aligned scene path
  `scenes/scene1.json`. Below: the grid canvas itself, with
  CSS-grid background lines + cells drawn by the existing
  canvas-painter. Bottom-left floating: a layer-legend pill
  containing the 5 layer Badges as a quick-reference.
- **Right inspector (380px wide)**: stack of cards:
  1. **3D Preview** card — `aspect-video` mini preview of the
     current cell from the player's POV + FOV Slider with
     `valueLabel="90°"`. Header has "LIVE" emerald Badge.
  2. **Cell Inspector** card — 3-column `(X, Y, Z)` StatsBlocks +
     Layer Select + Tile Select + Solid ToggleSwitch + BlockLight
     ToggleSwitch + Height Input + bottom tag pills row.
  3. **Scene Settings** card — Ambient Light Slider + Brightness
     Slider + Fog ToggleSwitch.
  4. **Quick Tools** card — `grid-cols-2` of Fill Area / Replace /
     Erase / Clear secondary Buttons.

Bottom of view: StatusConsole footer (Output / Problems / Search
tabs) with log lines + a 4-cell info grid on the right showing
Position / Cell / Layer / Selection.

**Migration steps.**

1. Split GridEditor.tsx into:
   - `GridCanvas.tsx` — the grid painter (preserve existing
     paint/erase/entity-place behaviour, no logic change).
   - `MapLeftRail.tsx` — tool palette + brush + tile categories.
   - `MapInspector.tsx` — 3D preview + cell + scene + quick tools.
   - `MapStatusConsole.tsx` — bottom log + info grid.
2. Compose them in `MapView.tsx` (new top-level view container)
   using the 3-pane grammar from §6.5.
3. The 3D preview card mounts a *non-interactive* iframe pinned to
   the current cell (or a screenshot-bake fallback if the iframe
   isn't loaded — saves the second iframe for low-end users).
4. Replace every `<div className="flex items-center justify-between">`
   property row in the existing inspector with `<PropertyRow>`.
5. Replace inline `<input type="range">` with `<Slider>`.
6. Replace inline checkbox toggles with `<ToggleSwitch>`.

**Primitives needed.** PanelHeader, CollapsibleSection, Toolbar,
Badge, ScrollArea, PropertyRow, Slider, ToggleSwitch, Select,
Card (existing), StatsBlock, Button (existing), SegmentedControl,
LogPanel, KeyValueList, TabStrip (secondary, for StatusConsole tabs).

**Agent**: R4b. Independent — touches only `GridEditor.tsx` +
`EditorViewport.tsx` + new files. Acceptance: existing scene-paint
smoke tests pass.

### 7.3 Entities (mockup: Entities.png)

**Current state.** `apps/editor/src/views/EntitiesEditor.tsx`
(1164 LOC) is a prefab list on the left, a giant component-form
editor in the middle, and a JSON preview on the right. The
component-form section has manually-built collapsible sub-forms
per component with inline labels, sliders, and selects.

**Mockup analysis.** 3-pane:

- **Left rail (300px)**: "ENTITIES" PanelHeader with "+ NEW"
  Button. Search Input. ScrollArea below containing prefab list
  items — each row has an icon + name + tag pill. Selected row
  has `bg-amber-500/10 text-amber-400`. At the bottom: a
  drag-drop FilePicker zone for prefab JSON imports
  ("Drag & drop prefab here").
- **Center (fluid)**: at the top, a header strip showing the
  selected prefab name + a "+ Add Component" Button to the right
  + tag input bar. Below: a vertical stack of
  CollapsibleSections, one per component on the prefab. Each
  CollapsibleSection has the component icon + name on the left,
  ToggleSwitch on the right (enable/disable component
  inclusion). When expanded, content is a vertical stack of
  PropertyRows.
  - Example: Light component → Color ColorChip + Intensity Slider
    + Radius Slider + AmbientFloor Slider + Falloff
    SegmentedControl.
  - Example: Sprite → Image FilePicker (or Select from existing
    sprites) + Scale Slider + Tint ColorChip + Movement
    SegmentedControl.
  - Example: Movement → SegmentedControl for direction + speed
    Input.
  - Example: Position → 3-column Inputs X/Y/Z.
- **Right inspector (380px)**: "JSON PREVIEW" card with a
  monospace code block (read-only, copyable) showing the
  resolved prefab JSON. Below: a "SAVE" primary Button + a
  "SAVE & TEST" outlined Button.

**Migration steps.**

1. Replace the ad-hoc collapsible-per-component logic with
   `CollapsibleSection` (one per component). Component icon
   resolved from a lookup table (Light → Sun, Sprite → Image,
   Movement → ArrowRight, Position → MapPin).
2. Move every `<div className="grid grid-cols-2">…label/control…</div>`
   to `<PropertyRow>`.
3. Add the JSON preview right rail using the existing
   `serializePrefab` helper (no code change in serialiser —
   just relocate the rendering).
4. Replace existing left-rail prefab list with a re-styled
   version using `PanelHeader` + `PropertyRow`-less list rows.

**Primitives needed.** PanelHeader, CollapsibleSection,
PropertyRow, Slider, ToggleSwitch, Select, ColorChip,
SegmentedControl, FilePicker, ScrollArea, Button (existing),
Badge, IconButton.

**Agent**: R4c. Independent. Acceptance: existing prefab
smoke tests pass.

### 7.4 Assets (mockup: Component Reference §AssetLibraryPageReference)

**Current state.** No standalone Assets view exists. Asset
ingestion happens inline (Sprite-picker dialog inside
EntitiesEditor, Texture-picker inside GridEditor, FBX importer
in `FbxImporter.tsx` as a sub-modal). The Assets PrimaryTab is
currently a placeholder ("future phase").

**Mockup analysis.** 3-pane:

- **Left rail (280px)**: Search Input at top. Filter list below
  with categories All Assets / Textures / Wall Textures / Floor
  Textures / Ceiling Textures / Sprites / Pickups / Weapons /
  Enemies / Audio / Prefabs — each with a count Badge on the
  right. Active filter has amber background.
- **Center (fluid)**: top action row with three Buttons:
  "Import Files" (amber primary, Upload icon), "New Folder"
  (outlined, Folder icon), "Generate Preview" (outlined,
  WandSparkles icon). Below: a 6-column grid of asset tiles
  (`aspect-video rounded` thumbnail + truncated name below).
  Hover state: `border-amber-400`.
- **Right inspector (360px)**: Asset Inspector card with
  aspect-video preview, then a KeyValueList of metadata
  (Name, Type, Dimensions, Used In). Bottom: "Rename" outlined
  Button + "Delete" red destructive Button.

**Migration steps.**

1. Create new `apps/editor/src/views/AssetsView.tsx`. Pull
   metadata from `EditorProjectStore.listAssets()`.
2. Compose using the 3-pane grammar.
3. Tile thumbnails generated on-demand using the existing
   `generateAssetThumbnail` worker (already used by the
   sprite-picker dialog). Cache in IDB.
4. Asset deletion still routes through
   `EditorProjectStore.deleteAsset()` — but now from the
   inspector's delete button (with a confirm Modal).

**Primitives needed.** Input, PanelHeader, ScrollArea, Badge,
Button, IconButton, FilePicker, EmptyState (when no assets),
KeyValueList, Modal (existing, for delete confirm).

**Agent**: R4g. Depends on `EditorProjectStore.listAssets` API
shape (already exists). Acceptance: ingesting an `.png`,
seeing it in the tile grid, selecting it, deleting it. Plus
`Generate Preview` round-trips through the existing baker.

### 7.5 Scripts (mockup: Scripting.png)

**Current state.** Scripts PrimaryTab is a placeholder. Monaco
isn't yet integrated. Pack scripts (`scripts/*.js`) can be
loaded via the FBX importer's adjacent file-picker, but there is
no in-browser editing.

**Mockup analysis.** 3-pane:

- **Left rail (240px)**: a file tree. Top has a Search Input +
  collapse-all IconButton. Below: a tree of folders
  (`components/`, `systems/`, `ui/`, etc.) with file leaves.
  Selected file has amber tint. New-file IconButton at the bottom
  of each folder header.
- **Center (fluid)**: Monaco editor. Above: a horizontal Tab strip
  of open files (each tab has filename + close `x`). Below
  Monaco: a problems strip showing 0–N errors with a small
  IconButton to expand/collapse.
- **Right inspector (320px)**: "SCRIPT INSPECTOR" card showing:
  - Component name (the script's declared component name).
  - Exported properties: a KeyValueList of declared `@property`
    JSDoc fields → default values.
  - Component usage: list of prefabs using this component, each
    a hyperlink to Entities.
  - Live edit: a Live Edit ToggleSwitch + Save Button.

**Migration steps.**

1. Add Monaco bundling to `apps/editor` (`monaco-editor` is a
   reasonable dep — confirm it's installed; if not, add it
   minimally with the `monaco-editor/esm/vs/editor/editor.main.js`
   import + the default-language workers config).
2. Create `apps/editor/src/views/ScriptsView.tsx` with the 3-pane
   shell.
3. File tree: hand-rolled component using
   `EditorProjectStore.listScripts()`. Folder nodes are
   collapsible (CollapsibleSection variant — or just plain
   chevron + indent).
4. Tab strip: a vertical-content TabStrip (or a separate
   `EditorTabStrip` if scripts evolve to need it — for R4e a
   plain horizontal `TabStrip` works).
5. Script inspector pulls component metadata from the existing
   `parseComponentScript` helper (already used by the engine
   loader). No new parser logic.
6. Live edit ToggleSwitch maps to the existing
   `EditorAssetPack.hotReloadScript(scriptPath)` flow.

**Primitives needed.** Input, IconButton, PanelHeader,
ScrollArea, TabStrip (file tabs — primary, but smaller size),
Card, KeyValueList, ToggleSwitch, Button, Badge (for problem
counts).

**Agent**: R4e. Depends on Monaco being added to package.json.
Acceptance: opening a script file, editing it, seeing IDB
persist, reload-engine button triggers iframe to pick up the new
script.

### 7.6 Animation (mockup: Animation.png)

**Current state.** `apps/editor/src/views/AnimationEditor.tsx`
(1779 LOC) — already a substantial implementation per the
[ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md) plan. Has the
sprite-sheet preview, frame timeline, keyframe markers,
playback controls. Visual style is the current shadcn-ish look.

**Mockup analysis.** 3-pane:

- **Left rail (260px)**: "ANIMATIONS" PanelHeader with "+ NEW"
  Button. Search Input. List of animation clips (Player, Walk
  Forward, Walk Back, Idle, Run, Jump, Attack — each with a
  duration sub-label and icon). Selected has amber tint.
- **Center (fluid)**:
  - Top row: Toolbar with "Create Animation", "Onion Skin"
    ToggleSwitch, "Auto-Step" ToggleSwitch, "Export Sprite
    Sheet" outlined Button. Right-aligned: PLAYTEST MODE label
    + a green dot status.
  - Below toolbar: the sprite-sheet preview row — horizontally
    scrollable strip of frame thumbnails with a yellow scrubber
    handle.
  - Below preview: the timeline — vertical rows for body parts
    or layers, horizontal frame markers, draggable keyframe
    dots. Bottom of timeline: play/pause/reverse SegmentedControl
    + speed Slider + loop ToggleSwitch + frame counter Badge.
- **Right inspector (300px)**:
  - **Preview** card — animated preview of the active clip
    looping. With small play/pause/reverse buttons under.
  - **Animation Inspector** card — Name Input + Duration Input
    + Frame Count StatsBlock + Loop Mode SegmentedControl +
    Event Markers list.

**Migration steps.**

1. Re-skin only — no logic refactor. Animation editor's data
   model + IDB schema + keyframe engine stays put.
2. Replace inline buttons + sliders with the new primitives.
3. Wrap top-level structure in the 3-pane grammar.
4. Restyle the timeline rows to match the mockup (rounded
   amber/grey track segments instead of the current solid lines).

**Primitives needed.** PanelHeader, Input, ScrollArea, Toolbar,
ToggleSwitch, Slider, SegmentedControl, Button, Badge, Card,
PropertyRow, StatsBlock, IconButton, EmptyState (when no clips).

**Agent**: R4d. Independent. Acceptance: existing animation
smoke tests pass.

### 7.7 Project (mockup: ProjectManagement.png)

**Current state.** No standalone Project view exists. The
Project Settings modal is the only configuration surface, and
it's invoked via the cog IconButton from the editor header. Pack
export uses a one-shot "Export Pack" button in ProjectView.tsx's
top-right corner.

**Mockup analysis.** This is the most information-dense view.
3-pane:

- **Left rail (280px)**: a vertical category list — Settings /
  Build / Export / Assets / Scripts / Production Stats /
  Web (Build) / Setup / etc. Active category has amber tint.
  At the top: "PROJECT" small-caps label. Below the list: a
  log-mini-tile showing the last 3 log lines.
- **Center (fluid)**:
  - **Build Configuration** Card: full-width inputs for
    Version, Output Directory. Below: Asset Bundling section
    with Browser Bundles / Asset Files / Include Comments
    ToggleSwitch, Granularity Select, etc. Optimisation row
    with multiple ToggleSwitches: "Minify Assets", "Compress
    Lights" (with sub-row "Aggressive"), "Remove Unused
    Assets", "Map Settings Editor" link, "Compress Audio".
    Image & Audio row: Engine Version Select + Target Platform
    SegmentedControl (Browser / Web / Node).
  - Right of inner forms: **Advanced Options** CollapsibleSection
    with "Async Generation", "Cache Build Artifacts", etc.
  - Bottom: large amber "Repack Package" Button + "Build Web
    Version" outlined Button + "Export Package" amber Button +
    "Validate" outlined.
- **Right inspector (380px)**:
  - **Project Validation** Card with a 4-column count grid:
    Issues Total / Errors / Warnings / Info. Each a coloured
    Badge.
  - **Validation Issues** scrollable list — each row has an
    AlertCircle/Triangle icon + severity tag pill +
    short message. Click → opens the file.
  - **Build Output** KeyValueList: Output Size, Compressed,
    Walls Bytes, Scripts Bytes, etc.
  - **Build Size Composition** Card with a PieChart (Walls,
    Floors, Sprites, Scripts, Audio, Manifest, Other).
- **Bottom strip**: a horizontal LogPanel of build/validation
  output (full-width).

**Migration steps.**

1. Create `apps/editor/src/views/ProjectBuildView.tsx`.
2. Pull the export pipeline calls out of the current
   `ProjectSettingsModal.tsx`'s "Export" button and into this
   new view. The modal still exists (re-skinned per §7.8) but
   the heavy build configuration lives here.
3. Validation surface uses the existing `validatePack(meta)`
   pipeline (`apps/pack-builder`'s validator, re-imported into
   the editor). Counts are derived from the validator's
   `issues[]` output.
4. Build Output stats come from `EditorAssetPack.estimateBuildSize()`
   — a new helper that calculates total/per-bucket bytes by
   summing IDB asset records. (R4f's only `EditorProjectStore`
   change.)
5. PieChart segments computed from the same helper.
6. Bottom LogPanel subscribes to the existing
   `EditorBuildLog.subscribe(callback)` stream.

**Primitives needed.** PanelHeader, ScrollArea, Card,
PropertyRow, Input, ToggleSwitch, Select, SegmentedControl,
Slider, Badge, Button, KeyValueList, PieChart, ChartLegend,
LogPanel, ProgressBar, CollapsibleSection, StatusPill, StatsBlock.

**Agent**: R4f. Depends on `EditorAssetPack.estimateBuildSize`
(new helper to add) — but that helper is read-only, no schema
change. Acceptance: triggering a build from this view produces
byte-identical output to today's `bun run build-packs` for the
default pack.

### 7.8 ProjectSettings modal (mockup: ProjectSettings.png)

**Current state.** `apps/editor/src/views/ProjectSettingsModal.tsx`
(1209 LOC). Large floating modal opened via cog IconButton.
Currently a vertically-tall stack of forms — Manifest fields,
dependency list, advanced flags, export options — all visible
simultaneously.

**Mockup analysis.** Modal redesign — same content, paginated
into 4 secondary tabs:

- **Manifest** tab — fields: Name, Description, Version,
  Engine Version Select, Start Scene Select, Author, Website,
  Description Textarea, "These settings define your project's
  identity and entry point" hint paragraph at the bottom.
- **Dependencies** tab — list of dependency packs (KeyValueList
  with name → version + remove IconButton per row), "Add
  Dependency" button at the bottom.
- **Export** tab — Build target Select, Output directory Input,
  bundle options ToggleSwitch grid.
- **Advanced** tab — engine version pin, feature flags, telemetry
  opt-in ToggleSwitches, advanced flags (most users won't touch).

Modal footer: "Reload Running Game" left-aligned outlined
Button, "Cancel" + "Save" right-aligned (Save is amber).

**Migration steps.**

1. Wrap modal content in a secondary `TabStrip` with the 4 tabs.
2. Migrate each existing form section to a tab body, replacing
   inline labels + inputs with `PropertyRow` + `Input` /
   `Textarea` / `Select` / `ToggleSwitch`.
3. The modal stays in scope — it remains the dependency-add /
   advanced-flag surface even after R4f makes Project a
   first-class tab. But basic manifest fields (Name, Version,
   Start Scene) are *also* editable from the Project tab's
   Build Configuration card, so users have two entry points.

**Primitives needed.** Modal (existing), TabStrip (secondary),
PropertyRow, Input, Textarea, Select, ToggleSwitch, Button,
KeyValueList, IconButton, Badge.

**Agent**: R4f (paired with ProjectBuildView since they share the
manifest read/write surface). Acceptance: every existing
manifest field still round-trips through this modal; "Reload
Running Game" still broadcasts the reset message.

### 7.9 Playtest (mockup: GamePreview.png) — NEW VIEW

**Current state.** No equivalent today. The iframe runs
inside Map's right-pane preview or full-pane play mode, but
there is no debug overlay around it. The mockup introduces
this as a *first-class debug runner* — essentially the runtime
game with telemetry panels grafted around it.

**Mockup analysis.** A specialised full-screen-ish layout that
overrides the normal PrimaryTab view when activated:

- **Top action bar** (under PrimaryTabs, on top of the existing
  shell): `Stop` red-outlined button, `Pause` yellow-outlined
  button, `Restart` outlined button, `Free Camera` outlined
  toggle, `Half Walk` outlined toggle, `Debug View` outlined
  toggle. Right-aligned: render mode SegmentedControl ("Editor /
  Playtest"), FOV display Badge.
- **Left rail (260px)** stacked Cards:
  - **Runtime Stats**: StatsBlocks for FPS, Frame Time, Draw
    Calls, Active Lights, Total Cells, Active Frames.
  - **Player Stats**: StatsBlocks for Position (x/y/z), Facing
    (degrees), Velocity (x/y).
  - **World Stats**: StatsBlocks for Active Entities, Lights,
    Baked Cells.
- **Center**: the game iframe. No editor chrome inside it —
  this is the raw engine running with telemetry going via
  postMessage.
- **Right rail (300px)** stacked Cards:
  - **Inspector** (current selected entity): name, type, tags,
    position, etc.
  - **Camera FOV** Slider.
  - **Lighting Settings**: Ambient Slider, Intensity Slider,
    "Trigger Bake" Button.
  - **Debug Navigation**: SegmentedControl for nav-overlay mode
    + "Move Camera To Target" outlined Button.
- **Bottom strip**: a 2-column footer:
  - Left: LogPanel scrolling runtime logs (errors / warns /
    info from the engine, prefixed with `[Engine]` /
    `[ModAPI]`).
  - Right: an FpsGraph drawing the last 240 frame times +
    sub-label of average FPS.

**Migration steps.**

1. Create `apps/editor/src/views/PlaytestView.tsx`.
2. PlaytestView mounts the same iframe URL as the Map's play
   mode but with `?source=editor&mode=playtest` so the engine
   knows to emit telemetry frames. (URL convention extension —
   `EDITOR_IFRAME.md §4` already allows additional `mode=` query
   params.)
3. Telemetry stream: `EDITOR_IFRAME.md §6` defines
   `player-state` postMessages. Playtest extends with:
   - `engine-stats` (FPS, frame-time, draw-calls, light-count) —
     1Hz throttled.
   - `world-stats` (entity-count, baked-cells, active-frame-id) —
     1Hz throttled.
   - `selection` (currently picked entity id) — on change.
   This is **I2 territory** (EDITOR_IFRAME.md §12). Playtest
   view is *blocked* on I2 landing. Until then, the view can
   render with placeholder values (StatsBlocks showing "—").
4. The Playtest top action bar is its own `Toolbar`, *not*
   PrimaryTabs (which stays visible above for context).
5. Exiting playtest: clicking the TopBar's Playtest button again
   (now amber-filled to indicate active) returns to the
   previous PrimaryTab.

**Primitives needed.** Toolbar, Button, IconButton, Card,
StatsBlock, KeyValueList, Slider, ToggleSwitch, SegmentedControl,
LogPanel, FpsGraph, ChartLegend, Badge, StatusPill.

**Agent**: R4h. **Blocked on EDITOR_IFRAME I2** (telemetry
postMessages). Can land the shell with placeholder data and
upgrade incrementally as I2 ships individual message types.

---

## 8. Playtest view — addition justification

The Playtest view is the only **new** view this plan introduces.
Every other R4 phase is a re-skin. Calling it out explicitly:

- It is a **debug game runner**, not a re-skin of the existing
  play-mode iframe pane. The iframe is the same; the *chrome
  around it* is entirely new.
- It depends on the postMessage telemetry protocol specced (but
  not shipped) in `EDITOR_IFRAME.md` I2:
  - `player-state` — position + facing.
  - Plus new (this plan adds the spec extension):
    - `engine-stats` — `{ fps, frameTimeMs, drawCalls, lights, cells }`,
      1Hz throttled.
    - `world-stats` — `{ entities, bakedCells, activeFrameId }`,
      1Hz throttled.
    - `selection-change` — `{ entityId, prefab, components: string[] }`.
- The engine must emit those messages from inside the iframe.
  Hooks needed:
  - In the engine's render loop, capture `gl.drawArraysInstanced`
    + `gl.drawArrays` counts → `engine-stats.drawCalls`.
  - In the engine's ECS update, count entities + baked-cells per
    tick → `world-stats`.
  - In `api.world.pick(...)` and the engine's debug-picker, fire
    `selection-change`.
- All three messages should be **opt-in** via the `mode=playtest`
  URL param so the iframe doesn't pay the cost in normal play.
- This view should NOT replace the Map view's existing live
  iframe (which stays the authoring loop — paint and walk through).
  It is an *additional* surface for debugging session-time
  behaviour with stats + log overlays.

§12 captures open questions about whether the Playtest view
*replaces* the current Play/Edit mode toggle or lives alongside.

---

## 9. Tab structure migration

Current: 5 modes (`map | entities | scripts | assets | animation`)
persisted as `editor.workflowMode` in localStorage. HomeScreen is a
separate top-level page reached by clicking "Back to Projects" in
the header.

New: 7 PrimaryTabs + 1 header-toggle (Playtest).

### 9.1 Persisted vocabulary

The `editor.workflowMode` key changes from:

```ts
type WorkflowMode = "map" | "entities" | "scripts" | "assets" | "animation";
```

to:

```ts
type WorkflowMode =
  | "home"
  | "map"
  | "entities"
  | "assets"
  | "scripts"
  | "animation"
  | "project"
  | "playtest";
```

The migration: legacy values still load correctly (they're a
subset). Old values stay valid; new keys are added.

### 9.2 Home as a tab — navigation semantics

In R3+, "Home" is a tab in the same `PrimaryTabs` strip as the
other modes. But it's *project-independent* — the Home view's
state is which project to enter (a list), so clicking the Home tab
when a project is open is equivalent to "switch projects". The
TopBar's project dropdown stays disabled while on Home (since no
project is loaded).

Edge case: what if the user clicks Home while there's unsaved
work? The current "Back to Projects" button already handles this
with a confirm dialog. Same logic moves to the Home-tab click
handler. (Open question in §12 about whether this is the right
default.)

### 9.3 Project as a tab — settings modal coexistence

The Project tab and the ProjectSettings modal *both* exist.
The Project tab is the build/configure dashboard (most-used
fields). The Settings modal is the deep-settings + dependencies
+ advanced-flags surface. The cog IconButton in TopBar opens the
modal regardless of which tab is active. The Project tab also has
a "Open Settings" Button that opens the same modal (which is
itself slightly redundant — see §12 open question).

### 9.4 Playtest as a button — special override

Playtest is *not* a PrimaryTab. It's a TopBar button. When active:

- The PrimaryTab strip stays visible (showing the underlying tab,
  greyed out — "this is where you'll go when you exit Playtest").
- The `ViewBody` slot renders PlaytestView instead of the
  underlying tab's view.
- The TopBar's Playtest button shows amber-filled to indicate
  active state.
- Pressing it again exits back to the underlying tab.

Persistence: `editor.workflowMode = "playtest"` so that a reload
returns the user to playtest with the previously active
underlying tab restored from a separate `editor.workflowMode.prev`
key.

---

## 10. Phased rollout R1–R5

### R1 — this plan doc

Already done by virtue of you reading this. No code changes.

### R2 — primitive component library

Build the 27 new primitives in §4 into
`apps/editor/src/components/ui/` — one file per primitive (or
small clusters where they're related, e.g.
`Slider` + `Switch` + `SegmentedControl` in one
`controls.tsx` if that's cleaner). All hand-rolled, no Radix, no
shadcn-cli.

Acceptance:
- Every primitive has a TypeScript prop type matching §4.
- Every primitive renders a representative example in a new
  `apps/editor/src/views/_StyleGuide.tsx` (route: dev-only,
  not shipped in production builds, used to manually verify
  the visual contract).
- Tailwind tokens added to `@theme` in `index.css` per §5.
- No existing views touched.
- Existing editor smokes pass unchanged.

Single agent. ~1–2 days of work for an unblocked agent.

### R3 — editor shell

Build the TopBar + PrimaryTabs + StatusBar chrome around the
existing views. Each existing view renders inside the new shell
*unchanged* (still using its current visual style — re-skinning
happens in R4).

Acceptance:
- TopBar renders with project + scene dropdowns wired to current
  `EditorContext`.
- PrimaryTabs reads/writes the extended `editor.workflowMode`
  localStorage key.
- StatusBar renders a per-view section set (each view exposes
  a `getStatusBarSections()` helper).
- Home is a tab; project picker still works.
- Project tab renders a placeholder ("Project Settings — see
  cog modal for now"). Modal still opens via cog.
- Playtest button is present but disabled (until R4h).
- Assets and Scripts tabs render placeholders.
- No regressions in Map, Entities, Animation, ProjectSettings
  modal.

Single agent. ~2 days. Depends on R2.

### R4 — per-view migrations

Each sub-phase is parallel-safe. Different agents can land them
in any order after R3. Each phase is a single coherent commit.

- **R4a — Home** (§7.1). Independent.
- **R4b — Map** (§7.2). Independent. Largest re-skin (~1800 LOC of
  GridEditor touched).
- **R4c — Entities** (§7.3). Independent. ~1200 LOC.
- **R4d — Animation** (§7.6). Independent. ~1800 LOC (mostly
  visual — data model untouched).
- **R4e — Scripts** (§7.5). Requires Monaco bundled (small
  package.json change). ~new file, ~600 LOC.
- **R4f — Project + ProjectSettings** (§7.7 + §7.8). Paired
  because they share the manifest surface. ~new file 700 LOC +
  re-skin of existing 1200-LOC modal.
- **R4g — Assets** (§7.4). New view. ~500 LOC.
- **R4h — Playtest** (§7.9). **Blocked on EDITOR_IFRAME I2.**
  Can land with placeholder telemetry; upgrade as I2 ships.
  ~500 LOC.

R4 total: ~7000 LOC touched, but ~80% replacements (line-for-line
swap of old primitive usage for new). Parallel-safe — different
view files.

### R5 — polish pass

- Transitions (collapsible expand, dropdown open).
- Hover and focus rings — confirm everywhere.
- Empty states for every view that can be empty.
- Keyboard nav — Tab order through every form, Esc to close
  modals + dropdowns, Enter to confirm.
- Density pass — review every view at 1366x768 and at 1920x1080,
  fix any cramped or sparse layouts.
- Tooltip primitive built (§4.25) and applied to every
  IconButton + Toolbar element.
- Performance: confirm no view renders >2 React reconciliation
  passes per interaction (React DevTools profiler).
- Accessibility audit: aria-labels on all IconButtons,
  role="tablist" on every TabStrip, alt text on every preview
  image.

Single agent. ~3 days. Independent of all R4 sub-phases as long
as they're complete.

---

## 11. Compatibility / migration risk

### 11.1 Editor stays usable every step

R2 introduces new primitives but doesn't consume them. R3
swaps in the shell — every existing view continues to render its
current self inside it. R4 sub-phases consume new primitives one
view at a time; the others stay on the old primitive set until
their R4 sub-phase lands. No multi-week branch — main works at
every commit.

### 11.2 Per-phase commit coherence

| Phase | Commit boundary | Visible to user? |
|---|---|---|
| R1 | This doc only | No |
| R2 | New `ui/` directory + style-guide route | No (style guide is dev-only) |
| R3 | New TopBar/PrimaryTabs/StatusBar + Home as tab | Yes — chrome changes |
| R4a–R4h | One commit each | Yes — view-by-view |
| R5 | One commit | Yes — polish |

### 11.3 Smoke test integrity

Editor's smoke battery currently:
- 12 EditorAssetPack tests
- 16 EditorProjectStore tests
- 91 GridEditor tile/paint tests
- 33 EntitiesEditor prefab tests
- 90 AnimationEditor clip tests
- 55 PackBuilder export tests
- 14 IframeMessage tests
- 14 FbxImporter tests
- 24 ProjectSettings modal tests
- 18 BakedSpritePreview tests
- + the pack-chain smokes from PACK_CHAIN.md M1.

None of these touch JSX styling. Every test is a data-shape or
behaviour test. R1–R5 must not break any.

R2's style-guide route is non-routed in production; tests don't
hit it. R3's shell is purely additive (TopBar mounts above
existing views). R4 sub-phases replace JSX but preserve component
behaviour — *behaviour-level* tests (does GridEditor still paint
walls?) keep passing. R5 is polish-only.

### 11.4 Shims R2/R3 may need to leave

R2 may leave compatibility shims so the *existing* views compile
unchanged against the new primitives. Specifically:

- The current `ui.tsx` `Button` has a `variant: "primary" |
  "secondary" | "ghost" | "danger"` enum. The new Button (in
  `ui/Button.tsx`) keeps this exact enum to avoid touching every
  existing call site.
- Same for `Modal` — props match identically. R4f's modal
  re-skin uses the same `Modal` open/close props and adds a
  `tabs` slot via composition (TabStrip nested inside the
  modal body), not a new modal type.
- `Card` / `CardHeader` / `CardContent` keep the same props.
  The mockups vary card padding subtly (some are `pt-3 pb-4`,
  others `pt-5 pb-3`), but the existing defaults are within the
  visual tolerance for R3. R4 sub-phases can pass `className`
  to override if needed.

After R4 is complete, R5 can audit + delete any shims that
became unused.

### 11.5 Bundle-size budget

Editor's current production bundle is ~840KB gzipped (Monaco not
included yet). New primitives are all hand-rolled functional
components; expected delta: ~15KB gzipped. Monaco's addition in
R4e will spike +1.2MB (it's huge); see [§12 open question on
Monaco bundling strategy](#12-open-questions).

### 11.6 IndexedDB schema impact

**Zero.** This plan is doc + JSX. The IDB schema is owned by
EDITOR.md §3 (EditorAssetPack). No schema field added or
removed. `EditorAssetPack.estimateBuildSize()` (added for §7.7)
reads existing fields — no migration.

---

## 12. Open questions

1. **Should the Playtest button replace the current Map mode's
   Play/Edit toggle entirely, or live alongside it?** RESOLVED.
   Per design discussion: drop Map's inline Play/Edit toggle.
   Replace it with the **Cell Preview panel** that the Map.png
   mockup already shows in the top-right (labelled "3D PREVIEW").
   The preview re-renders live as the user edits a cell's preset
   — reflectiveness, partial-wall config, emissive, etc. — with
   optional rotation. This serves the tile-authoring loop better
   than walking around does (cf. Substance Designer / Blender's
   material-preview pattern).

   **Playtest** becomes the only "actually run the game" entry
   point, accessed via the header button. **State is preserved**
   across Edit ↔ Playtest transitions: player position, rotation,
   entity ECS state, AI state, inventory — all kept. Live edits
   apply on the fly. Only an explicit "Rerun" button (or full
   reload) resets the world. The iframe never unmounts — Map mode
   hides it via `invisible pointer-events-none`; Playtest shows
   it with the debug-overlay chrome. The "2-click cost of going
   to Playtest" disappears because no work is lost.

   Implementation: R4b (Map view) replaces the Play/Edit toggle
   with the cell-preview rail. R4h (Playtest) wires the state-
   preserved iframe show/hide + the Rerun button. Removes the
   `ViewportMode` type from EditorViewport's props once Playtest
   subsumes "play."

2. **Project Settings access via the cog icon — what does the
   cog actually do?** RESOLVED. Per design discussion: complete
   split between project-scoped and editor-scoped config.

   - **Project tab** = project-scoped config that lives in the
     `.apg` and travels with the pack — manifest metadata,
     dependencies, export modes, advanced flags, build
     configuration, validation, log. No modal; the tab IS the
     surface. ProjectSettingsModal (Manifest/Deps/Export/Advanced)
     dissolves into this tab's sub-surfaces.
   - **Cog icon → Editor Settings modal** = editor-scoped
     preferences that live in localStorage and apply across all
     projects — theme, accent color, keybindings, panel
     visibility, auto-save interval, recent-project list cap,
     telemetry opt-in, future store credentials.

   Zero overlap. Matches the convention of VSCode / Photoshop /
   Blender, where the cog never opens project settings — only
   editor preferences. Implementation: R4f rebuilds the existing
   `ProjectSettingsModal.tsx` AS the Project tab; a new
   `EditorSettingsModal.tsx` (probably small) is what the cog
   opens. R3 wires the cog button to the new modal.

3. **Logo branding — drop the red plaque, use the cardboard hex
   logo image with wordmark.** RESOLVED. User-provided logo at
   `Editor Design/logo.png` is the canonical brand mark: a
   hexagonal cardboard box opened to reveal a top-down dungeon
   floor plan with an amber light pour from a corner. Warm
   cardboard browns + amber accent pair naturally with the
   editor's amber-on-zinc theme. The bright-red plaque from the
   GPT mockups would clash with the logo's warm palette and is
   discarded. TopBar layout: 28-32px logo image + "CARDBOARD"
   wordmark in `text-lg` next to it (or wordmark-only at very
   small sizes). Favicon: the hex silhouette + amber pour at
   16/32/48 — the inner dungeon detail loses but the silhouette
   still reads. Amber stays as the UI accent everywhere else
   (sliders, buttons, action states).

4. **Engine vs pack UI boundary — WHICH modals does the engine
   ship, which belong to packs?** RESOLVED. Per design discussion:
   the architecture today is wrong. The R3 follow-up moved
   *everything* into default-pack including SettingsScreen, which
   means a pack that doesn't depend on default-pack has no
   Settings modal at all. The clean split:

   **Engine ships (universal to every game built on cardboard):**
   - Default **Settings** modal — graphics/audio/controls bindings.
     Every game needs settings access. Lives at
     `packages/engine/src/UI/DefaultSettingsScreen.tsx`. Engine
     auto-registers via the same `api.ui.registerModal` path that
     packs use; packs can override by registering "settings" again.
   - Default **Console** (CONSOLE.md / #199) — universal dev tool.
     Lives at `packages/engine/src/UI/DefaultConsoleScreen.tsx`.

   **Default-pack ships (game-specific to its Doom-style shooter):**
   - InventoryScreen, hotbar, minimap, ammo counter, reticle,
     stats overlay, MainMenu. Stay where they are (under
     `packages/default-pack/scripts/ui/` + `scripts/systems/`).
     Packs that don't depend on default-pack have NO inventory /
     hotbar / minimap — those are game concepts, not engine
     concepts.

   Implementation impact: R4 includes moving SettingsScreen from
   default-pack back into the engine (partial undo of one R3-
   follow-up decision, with the correct architectural reasoning
   this time). Default-pack scripts/ui/SettingsScreen.tsx is
   either deleted or kept as an example "this is how a pack
   would override the engine's settings modal."

   Default-pack's modals **adopt the new primitives** (Slider,
   ToggleSwitch, etc.) so they look consistent with the editor.
   Not a layout redesign — just a primitive-adoption pass.

   **Related new direction (separate task #212)**: visual
   **UI Builder tab** for authoring pack UI without writing
   TSX — drag-drop builder outputs structured JSON UI trees that
   `api.ui.renderTree()` interprets at runtime. Substantial
   feature comparable to AE2 in scope; gets its own plan doc
   (`docs/plans/UI_BUILDER.md`). Adds an 8th primary workflow
   tab (Home / Map / Entities / Assets / Scripts / Animation /
   UI Builder / Project) — slot allocated as **R4i** in the
   editor-redesign phase grouping.

   **Related new direction (separate task #212)**: visual
   **UI Builder tab** for authoring pack UI without writing
   TSX — drag-drop builder outputs structured JSON UI trees that
   `api.ui.renderTree()` interprets at runtime. Substantial
   feature comparable to AE2 in scope; gets its own plan doc
   (`docs/plans/UI_BUILDER.md`). Adds an 8th primary workflow
   tab (Home / Map / Entities / Assets / Scripts / Animation /
   UI Builder / Project) — slot allocated as **R4i** in the
   editor-redesign phase grouping.

5. **For Playtest's stats panel — does this require new ModAPI
   surfaces (`api.debug.*`) for things like draw-call counts,
   or are these all derivable from existing `api.world` + ECS
   state?** Some (entity count, light count, baked-cell count)
   are trivially derivable. Others (draw-calls, GPU memory,
   shader-program switches) require engine-internal
   instrumentation. Decision: **EDITOR_IFRAME I2 adds the
   internal-only telemetry channel** (`engine-stats`,
   `world-stats`) — those are postMessage data, not ModAPI
   surface. Mods can't read them. If demand exists later, a
   read-only `api.debug.stats()` helper can be added — but it's
   not required for Playtest.

6. **Component Reference.ts is non-empty (24KB) — do we use it
   as the R2 primitive starting point, or treat it as a
   visual-spec-only reference?** It uses `@/components/ui/*`
   paths the editor doesn't have, depends on Radix-backed shadcn
   primitives, and uses `Card` / `Tabs` / etc. with a different
   prop shape than `apps/editor/src/components/ui.tsx`'s
   existing components. Lean: **treat as visual spec only**.
   R2 reads the file for layout + class structure but
   re-implements every primitive in cardboard's hand-rolled
   style. The existing `Card` / `Button` / `Input` shapes win.

7. **Monaco bundling strategy for R4e — full Monaco (~1.2MB) or
   monaco-editor-core (no language workers, ~400KB) plus only
   the languages the editor needs (TypeScript + JSON + GLSL)?**
   Lean: **monaco-editor-core + targeted languages**. Cardboard
   pack scripts are JS/TS only; GLSL shaders are pack-built
   ahead-of-time and editor sees them as text. Saves ~700KB.
   Bundle split lazy-loads the Monaco chunks only when the
   Scripts tab is first opened.

8. **Where do view-specific `getStatusBarSections()` helpers
   live?** Options: (a) each view exports the helper and the
   shell composes them, (b) the shell has a context that views
   write into via `useEffect`. Lean: **(b) — context.** Cleaner
   separation; views don't need to know about the shell's
   data shape.

9. **Should the TopBar's project dropdown be disabled while on
   Home, or show a "Switch to project…" link that opens Home?**
   It feels redundant since clicking Home already shows the
   list. Lean: **disabled while on Home**.

10. **EmptyState design — do we draw an isometric mascot
    illustration for empty views, or stay text+icon-only?**
    Cardboard's brand voice favours minimal. Lean: **icon +
    text only** for now. A mascot is a fun R5+ stretch goal.

---

## 13. Cross-references

- **[EDITOR.md](./EDITOR.md)** — feature spec (the *what*, not
  the *how it looks*). This doc is read in parallel; styling
  concerns live here, feature semantics live there.
- **[EDITOR_IFRAME.md](./EDITOR_IFRAME.md)** — Playtest view
  depends on **I2** (telemetry postMessages). R4h is blocked on
  I2 landing. The new message types (`engine-stats`,
  `world-stats`, `selection-change`) need to be added to
  EDITOR_IFRAME.md §6 as part of I2's implementation.
- **[MATERIALS.md](./MATERIALS.md)** — visual reference for
  what a quality plan doc looks like. Density + tone target.
- **[ANIMATION_EDITOR.md](./ANIMATION_EDITOR.md)** — phase-doc
  structure precedent. The R-phase rollout mirrors AE's phase
  pattern.
- **[PACK_CHAIN.md](./PACK_CHAIN.md)** — manifest + dependency
  fields surfaced in §7.7 (Project view) and §7.8
  (ProjectSettings modal Dependencies tab).
- **[../IDEAS.md](../IDEAS.md)** — this redesign should be
  captured as an entry: `2026-05-16 — Editor visual overhaul
  (EDITOR_REDESIGN.md)` with status `Planning`. Append on commit
  of this doc.
- **[../PLAN.md](../PLAN.md)** — append a one-liner to the
  phase-status table:
  `EDITOR_REDESIGN | R1 (plan) ✅ | R2 primitives, R3 shell,
  R4 views, R5 polish pending`.
- **[../SESSION_STATE.md](../SESSION_STATE.md)** — mention this
  doc as the next-priority editor work; the file-touched map
  should add `docs/plans/EDITOR_REDESIGN.md` under "open tasks
  → editor".

---

## 14. Implementation summary

R1 (this doc) is the contract between design and engineering.
R2–R5 are the implementation lanes:

```
R1 plan ─┐
         │
R2 primitives ─┐                                          ┌─ R5 polish
         │     │                                          │
R3 shell ─┴─→  R4 ┬─ R4a Home ────────────────────────────┤
                  ├─ R4b Map ─────────────────────────────┤
                  ├─ R4c Entities ────────────────────────┤
                  ├─ R4d Animation ───────────────────────┤
                  ├─ R4e Scripts ─────── (+Monaco) ───────┤
                  ├─ R4f Project + Settings modal ────────┤
                  ├─ R4g Assets ──────────────────────────┤
                  └─ R4h Playtest ◄── EDITOR_IFRAME I2 ───┘
```

Critical-path: R1 → R2 → R3 → R4 (any order, parallel-safe) → R5.

Earliest possible R5 ship: ~3 weeks of focused agent-time
(R2: 2d, R3: 2d, R4 worst-case-sequential: 10d, R5: 3d). With
parallel R4 agents, ~10d wall-clock minimum.

After R5 ships, this doc graduates from "plan" to "historical
record + reference for the shipped surface" — same status
treatment as MATERIALS.md is in today (see its line 9 banner).

---

End of EDITOR_REDESIGN.md.
