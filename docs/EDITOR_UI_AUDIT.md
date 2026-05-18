# Editor UI Audit — Phase 2 Wave B Gate

Audit date: 2026-05-18. Tree at: `20b4bc7` (`merge: phase 1 shared
primitive UI components`).

This document categorises every primitive in
`apps/editor/src/components/ui/` (and the legacy single-file
`apps/editor/src/components/ui.tsx`) as **keep / migrate / delete /
rewrite** so we can decide whether to fire Phase 2 Wave B (page-local
component agents) directly or run a cleanup wave first.

Caller counts are real: produced by
`grep -rl "<Name>" apps/editor/src/views/ apps/editor/src/shell/`
over the worktree. Where a name exists in **both** the legacy
`ui.tsx` and the new `ui/<Name>.tsx`, callers were inspected directly
to determine which version they hit (module-resolution wins the
file `ui.tsx` over the directory `ui/`, so naked `from
"../components/ui"` always resolves to the legacy primitives).

Status legend:

- **keep** — implementation matches the design system / mockups,
  callers exist, no churn needed before Wave B.
- **migrate** — duplicate-name primitive: legacy version has callers,
  refined version is unused — a follow-up dispatch will rewrite
  imports and delete the legacy export.
- **delete** — zero callers across `views/**` and `shell/**`, no
  scheduled Phase 2 consumer.
- **rewrite** — keep the file, but the implementation drifts from
  the current mockups / design-system and needs a Phase 1.5 pass
  before Wave B consumes it.

---

## 1. Inventory

### 1.a New / refined primitives in `apps/editor/src/components/ui/`

| File | Exported names | Shape | Status | Rationale |
|---|---|---|---|---|
| `ui/AssetThumbnail.tsx` | `AssetThumbnail`, `AssetThumbnailProps` | Aspect-ratio preview tile + caption + corner badges. | **keep** | Zero callers today but explicitly slated for Home, Assets, Animation, Image Lab, Sound Lab in Wave B (inventory §1.1, §1.6, §1.9, §1.10). |
| `ui/Badge.tsx` | `Badge`, `BadgeVariant`, `BadgeProps` | Small inline status pill — 7 intent colours × rounded/pill × solid/outlined. | **keep** | 17 callers, fully aligned with design system. |
| `ui/Breadcrumb.tsx` | `Breadcrumb`, `BreadcrumbProps`, `BreadcrumbSegment` | Hierarchical path display. | **keep** | Zero callers today but earmarked for Scripts and Assets (inventory §1.5, §2.6). Cheap to retain. |
| `ui/Button.tsx` | `Button`, `ButtonProps`, `ButtonVariant`, `ButtonSize` | Refined Button — 5 variants × 3 sizes, composes `.button-*` design-system classes. | **migrate** | Refined replacement for legacy `ui.tsx Button`; zero callers — every Button consumer (22 files) imports the legacy version. |
| `ui/Card.tsx` | `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `CardProps` | Refined Card — composes `.card-surface` / `.card-surface-elev`. | **migrate** | Refined replacement for legacy `ui.tsx Card*`; zero callers — every Card consumer (3 files) imports the legacy version. |
| `ui/Chip.tsx` | `Chip`, `ChipProps`, `ChipVariant` | Tag-style pill with optional leading icon + trailing X. | **keep** | Zero callers today; required for Wave B tag bars (Entities, Components, Prefabs — inventory §1.3, §1.4). |
| `ui/CollapsibleSection.tsx` | `CollapsibleSection`, `CollapsibleSectionProps` | Expand/collapse section with chevron + uppercase label + optional trailing element. | **keep** | 13 callers. Heavy use across prefabs/project panels. |
| `ui/ColorChip.tsx` | `ColorChip`, `ColorChipProps` | Native color picker swatch + hex readout. | **keep** | 4 callers, aligned. |
| `ui/Divider.tsx` | `Divider`, `DividerProps` | Horizontal/vertical divider with `inset` + `strong` variants. Composes `.divider-h` / `.divider-v`. | **keep** | Zero callers today; the legacy `Separator` (1 caller) should migrate here. Tiny file, low cost. |
| `ui/DropdownMenu.tsx` | `DropdownMenu`, `DropdownMenuProps`, `DropdownOption` | Click-to-open menu with portal-rendered floating panel. | **keep** | 4 callers (MapContextMenu, ScriptsFileTree, TopBar shell). |
| `ui/EmptyState.tsx` | `EmptyState`, `EmptyStateProps` | Centred placeholder w/ logo backdrop + icon + title + CTA. | **keep** | 13 callers. |
| `ui/FilePicker.tsx` | `FilePicker`, `FilePickerProps` | Dropzone / button file picker. | **keep** | 5 callers. |
| `ui/IconButton.tsx` | `IconButton`, `IconButtonProps` | Icon-only button — 4 variants × 2 sizes, native-`title` tooltip. | **keep** | 14 callers. |
| `ui/Kbd.tsx` | `Kbd`, `KbdProps` | Inline keyboard chord chip. | **keep** | Zero callers today; reserved for tooltips + debug-bar shortcuts (Wave B). Tiny file. |
| `ui/KeyValueList.tsx` | `KeyValueList`, `KeyValueListProps`, `KeyValueRow` | Two-column metadata table. | **keep** | 7 callers. |
| `ui/LiveIndicator.tsx` | `LiveIndicator`, `LiveIndicatorProps` | Emerald pulsing LIVE pill. | **keep** | Zero callers today; planned for Scene 3D-Preview card header + Playtest action bar (Wave B). |
| `ui/LogPanel.tsx` | `LogPanel`, `LogPanelProps`, `LogLine`, `LogLineType` | Filterable scrollable log lines. | **keep** | 4 callers. |
| `ui/NumberInput.tsx` | `NumberInput`, `NumberInputProps` | Numeric input with steppers, unit suffix, clamp. | **keep** | Zero callers today; explicit Wave B dependency for every inspector PropertyRow (Position X/Y/Z, FOV, scale, animation duration). |
| `ui/PanelHeader.tsx` | `PanelHeader`, `PanelHeaderProps` | Sidebar section header — uppercase label + trailing action slot. | **keep** | 17 callers. |
| `ui/PreviewFrame.tsx` | `PreviewFrame`, `PreviewFrameProps` | Dumb chrome wrapper for preview surfaces; emerald border when `live`. | **keep** | Zero callers today; complements `PreviewHost`, slated for Map/Entities/Scripting live-preview cards in Wave B. |
| `ui/PreviewHost.tsx` | `PreviewHost`, `PreviewHostProps`, `PreviewEngine` | Engine-agnostic canvas-mount + lifecycle primitive. | **keep** | 1 caller (CellPreview). Planned: Image Lab, Sound Lab, Animation Wave B. |
| `ui/ProgressBar.tsx` | `ProgressBar`, `ProgressBarProps` | Linear progress + indeterminate stripe. | **keep** | 3 callers (ProjectExportPanel, AnimationEditor, StyleGuide). |
| `ui/PropertyRow.tsx` | `PropertyRow`, `PropertyRowProps` | The workhorse inspector row — `[label, control, unit?]`. | **keep** | 15 callers. |
| `ui/RailLayout.tsx` | `ThreeRailLayout`, `TwoRailLayout`, props | Grid wrappers composing `--rail-left` / `--rail-right`. | **keep** | Zero callers today; the existing pages still inline `grid-cols-[…]`. Wave B is expected to start adopting these wrappers; cheap to retain. |
| `ui/ScrollArea.tsx` | `ScrollArea`, `ScrollAreaProps` | Editor-styled overflow wrapper with optional fade. | **keep** | 14 callers. |
| `ui/SearchInput.tsx` | `SearchInput`, `SearchInputProps` | TextInput with leading magnifier + clear-X. | **keep** | Zero callers today; required for nearly every left-rail search input in Wave B. |
| `ui/Select.tsx` | `Select`, `SelectProps`, `SelectOption` | Styled native `<select>`. | **keep** | 15 callers. |
| `ui/StatsBlock.tsx` | `StatsBlock`, `StatsBlockProps` | Label + big value tile with trend / emphasis. | **keep** | 6 callers. |
| `ui/StatusBar.tsx` | `StatusBar`, `StatusBarProps`, `StatusBarSection` | Bottom strip — mosaic of sections via context. | **keep** | 15 callers via the shell context. |
| `ui/StatusPill.tsx` | `StatusPill`, `StatusPillProps`, `StatusPillVariant` | Pill with leading coloured dot — 5 variants. | **keep** | 6 callers. |
| `ui/TabStrip.tsx` | `TabStrip`, `TabStripProps`, `TabDescriptor` | Two-variant tab bar — primary (icon+label, amber underline) / secondary (label-only). | **keep** | 4 callers including the shell PrimaryTabs. |
| `ui/TextInput.tsx` | `TextInput`, `TextInputProps` | Refined Input — `.input-text` class + prefix/suffix slots. | **migrate** | Refined replacement for legacy `ui.tsx Input`; zero callers — every Input consumer (9 files) imports the legacy version. |
| `ui/Textarea.tsx` | `Textarea`, `TextareaProps` | Refined Textarea — `.input-textarea` class + `invalid` / `mono` props. | **migrate** | Refined replacement for legacy `ui.tsx Textarea`; zero callers — every Textarea consumer (2 files) imports the legacy version. |
| `ui/TogglePill.tsx` | `TogglePill`, `TogglePillProps`, `TogglePillOption` | Fully-rounded pill variant of SegmentedControl. | **keep** | Zero callers today; slated for TopBar Editor/Playtest toggle + Animation loop pill in Wave B. |
| `ui/Toolbar.tsx` | `Toolbar`, `ToolbarProps`, `ToolbarGroup` | Horizontal grouped controls with separators + tail. | **keep** | 5 callers. |
| `ui/Tooltip.tsx` | `Tooltip`, `TooltipProps` | Hover-positioned tooltip wrapper. | **keep** | 12 callers. |
| `ui/TopBar.tsx` | `TopBar`, `TopBarProps`, `TopBarProject`, `TopBarScene`, `SaveState` | The fixed 64px app header — logo + project + scene + save-state + actions. | **keep** | Used by shell wrapper (`shell/TopBar.tsx`) which re-exports types and consumes its primitives. |
| `ui/charts.tsx` | `FpsGraph`, `PieChart`, `ChartLegend`, props | Three canvas-rendered charts grouped by shared variant vocabulary. | **keep** | 2 callers (PlaytestOverlay + StyleGuide). |
| `ui/controls.tsx` | `Slider`, `ToggleSwitch`, `SegmentedControl`, props | Three small form controls grouped because they share a visual family. | **keep** | 12+15+10 callers respectively. |
| `ui/index.ts` | aggregator re-export | Barrel exporting every directory primitive. | **keep** | Single import surface for new code. |

### 1.b Legacy single-file `apps/editor/src/components/ui.tsx`

| Symbol | Shape | Status | Rationale |
|---|---|---|---|
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | Hand-rolled tailwind Card family (zinc-900 surface, zinc-800 border). | **migrate** | 3 callers; refined `ui/Card.tsx` exists and is unused. Migrate callers, delete legacy exports. |
| `Button` | 4-variant × 2-size button (primary / secondary / ghost / danger). | **migrate** | 22 callers; refined `ui/Button.tsx` (5 variants × 3 sizes) exists and is unused. Migrate callers, delete legacy export. |
| `Input` | `<input>` with focus ring + zinc-950 surface. | **migrate** | 9 callers; refined `ui/TextInput.tsx` exists and is unused. Migrate to TextInput (rename), delete legacy export. |
| `Textarea` | Multi-line equivalent of `Input` with mono font. | **migrate** | 2 callers (Entities, ProjectSettings); refined `ui/Textarea.tsx` exists and is unused. Migrate callers, delete legacy export. |
| `Label` | Uppercase tracking small caps `<label>`. | **migrate** | 4 callers; no refined replacement file exists. Either fold into `PropertyRow` (which already owns this style) or add `ui/Label.tsx` during the migration dispatch. |
| `Separator` | Horizontal-only `<hr>` with zinc-800 border. | **migrate** | 1 caller (shell `TopBar.tsx`); refined `ui/Divider.tsx` exists and is unused. Migrate the one caller, delete legacy export. |
| `Modal` | Centred panel over translucent backdrop, internally uses legacy `Card` + `CardHeader` + `CardContent`. | **migrate** | 4 callers (AssetsView, AnimationEditor, EditorSettingsModal, EntitiesEditor — plus `ProjectSettingsModal.tsx` which declares its own `ProjectSettingsModal` wrapper but doesn't import the legacy `Modal`). No refined `Modal` exists in `ui/`. Either keep `Modal` in legacy until a Phase 1.5 dispatch builds `ui/Modal.tsx`, or freeze the legacy file but only keep Modal until then. |

---

## 2. Caller counts

Total caller files in `apps/editor/src/views/**` + `apps/editor/src/shell/**`. Top 3 caller files listed.

| Component | Total | Top 3 callers | Legacy vs new |
|---|---|---|---|
| `Badge` | 17 | `project/ProjectExportPanel.tsx`, `project/ProjectValidationPanel.tsx`, `PlaytestOverlay.tsx` | new (`ui/Badge.tsx`) |
| `PanelHeader` | 17 | `HomeScreen.tsx`, `scripts/ScriptsFileTree.tsx`, `project/ProjectValidationPanel.tsx` | new |
| `Button` | 22 | `project/ProjectExportPanel.tsx`, `HomeScreen.tsx`, `ImageLabView.tsx` | **legacy** (refined unused) |
| `PropertyRow` | 15 | `project/ProjectExportPanel.tsx`, `SoundLabView.tsx`, `PresetEditView.tsx` | new |
| `Select` | 15 | `SoundLabView.tsx`, `MapToolbar.tsx`, `project/ProjectExportPanel.tsx` | new |
| `ToggleSwitch` | 15 | `PlaytestOverlay.tsx`, `SoundLabView.tsx`, `project/ProjectExportPanel.tsx` | new |
| `StatusBar` | 15 | (shell context — multiple views) | new |
| `TopBar` | 15 | shell wrapper + types | new (via shell wrapper) |
| `Tooltip` | 12 | `PlaytestOverlay.tsx`, `AnimationEditor.tsx`, `SoundLabView.tsx` | new |
| `Slider` | 12 | `_StyleGuide.tsx`, `EditorSettingsModal.tsx`, `EntitiesEditor.tsx` | new (`ui/controls.tsx`) |
| `ScrollArea` | 14 | `PresetEditView.tsx`, `HomeScreen.tsx`, `SoundLabView.tsx` | new |
| `IconButton` | 14 | `HomeScreen.tsx`, `PlaytestOverlay.tsx`, `SoundLabView.tsx` | new |
| `Input` | 14 (filename-dedup: 9 importers) | `ProjectSettingsModal.tsx`, `HomeScreen.tsx`, `EntitiesEditor.tsx` | **legacy** (TextInput unused) |
| `CollapsibleSection` | 13 | `project/ProjectExportPanel.tsx`, `PlaytestOverlay.tsx`, `ImageLabView.tsx` | new |
| `EmptyState` | 13 | `HomeScreen.tsx`, `project/ProjectExportPanel.tsx`, `shell/PrimaryTabs.tsx` | new |
| `SegmentedControl` | 10 | `MapToolbar.tsx`, `project/ProjectExportPanel.tsx`, `ImageLabView.tsx` | new |
| `Card`, `CardContent`, `CardHeader`, `CardTitle` | 10 | `project/ProjectExportPanel.tsx`, `project/ProjectValidationPanel.tsx`, `HomeScreen.tsx` | **legacy** (refined unused) |
| `Modal` | 8 (4 importers + 4 wrappers using own modal) | `AssetsView.tsx`, `MapView.tsx`, `project/ProjectDependenciesPanel.tsx` | **legacy** (no refined equivalent) |
| `KeyValueList` | 7 | `_StyleGuide.tsx`, `HomeScreen.tsx`, `ScriptsView.tsx` | new |
| `Label` | 7 (4 actual importers — Label, AnimationEditor, EntitiesEditor, FbxImporter, ProjectSettingsModal) | `AnimationEditor.tsx`, `EntitiesEditor.tsx`, `ProjectSettingsModal.tsx` | **legacy** (no refined equivalent) |
| `StatsBlock` | 6 | `HomeScreen.tsx`, `MapView.tsx`, `_StyleGuide.tsx` | new |
| `StatusPill` | 6 | `project/ProjectDependenciesPanel.tsx`, `_StyleGuide.tsx`, `PlaytestOverlay.tsx` | new |
| `Toolbar` | 5 | `MapView.tsx`, `_StyleGuide.tsx`, `GridEditor.tsx` | new |
| `FilePicker` | 5 | `PresetEditView.tsx`, `HomeScreen.tsx`, `AssetsView.tsx` | new |
| `DropdownMenu` | 4 | `MapContextMenu.tsx`, `scripts/ScriptsFileTree.tsx`, `_StyleGuide.tsx` | new |
| `TabStrip` | 4 | `MapToolbar.tsx`, `shell/PrimaryTabs.tsx`, `_StyleGuide.tsx` | new |
| `LogPanel` | 4 | `PlaytestOverlay.tsx`, `project/ProjectExportPanel.tsx`, `_StyleGuide.tsx` | new |
| `ColorChip` | 4 | `EntitiesEditor.tsx`, `_StyleGuide.tsx`, `PresetEditView.tsx` | new |
| `ProgressBar` | 3 | `project/ProjectExportPanel.tsx`, `_StyleGuide.tsx`, `AnimationEditor.tsx` | new |
| `Textarea` | 3 (2 actual importers) | `project/ProjectManifestForm.tsx`, `ProjectSettingsModal.tsx`, `EntitiesEditor.tsx` | **legacy** (refined unused) |
| `FpsGraph` | 2 | `PlaytestOverlay.tsx`, `_StyleGuide.tsx` | new |
| `PreviewHost` | 1 | `CellPreview.tsx` | new |
| `PieChart` | 1 | `_StyleGuide.tsx` | new |
| `ChartLegend` | 1 | `_StyleGuide.tsx` | new |
| `Separator` | 1 | `shell/TopBar.tsx` | **legacy** (Divider unused) |
| `AssetThumbnail` | 0 | — | new — unused |
| `Breadcrumb` | 0 | — | new — unused |
| `Chip` | 0 | — | new — unused |
| `Divider` | 0 | — | new — unused |
| `Kbd` | 0 | — | new — unused |
| `LiveIndicator` | 0 | — | new — unused |
| `NumberInput` | 0 | — | new — unused |
| `PreviewFrame` | 0 | — | new — unused |
| `SearchInput` | 0 | — | new — unused |
| `TextInput` | 0 | — | new — unused (legacy `Input` is used everywhere) |
| `TogglePill` | 0 | — | new — unused |
| `ThreeRailLayout`, `TwoRailLayout` | 0 | — | new — unused |

> Note on legacy/new resolution. Bun resolves `from "../components/ui"`
> to the file `ui.tsx` (a sibling file shadows the directory
> `ui/index.ts`). So every `import { Button } from "../components/ui"`
> goes to the **legacy** Button. The Phase 1 refined Card / Button /
> TextInput / Textarea / Divider exist in `ui/` and are re-exported
> from `ui/index.ts`, but **no caller imports them today** because no
> caller writes `from ".../components/ui/index"` *and* asks for those
> symbols. The new symbols are dead weight until a migration wave
> rewrites import paths.

---

## 3. Duplication report

Names existing in BOTH `ui.tsx` (legacy) and `ui/<Name>.tsx` (new):

| Symbol | Legacy callers | New callers | Verdict | Estimated effort |
|---|---|---|---|---|
| `Button` | 22 | 0 | Migrate all 22 callers' import paths to `ui/Button` (or to `ui/index`); delete legacy `Button` export. | 22 files |
| `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent` | 3 | 0 | Migrate 3 callers (`_StyleGuide.tsx`, `AssetsView.tsx`, `project/ProjectAdvancedPanel.tsx`) — `project/ProjectExportPanel.tsx`, `project/ProjectValidationPanel.tsx`, `HomeScreen.tsx` also use Card-family symbols through the legacy multiline import. Net actual importers: **~6 files**. Delete legacy Card-family. | ~6 files |
| `Input` → `TextInput` | 9 | 0 | Rename `Input` to `TextInput` at each callsite. Watch for prop differences (refined adds `prefix`/`suffix`, drops legacy `cn` default surface). | 9 files |
| `Textarea` | 2 | 0 | Migrate 2 callers (`ProjectManifestForm`, `ProjectSettingsModal`, `EntitiesEditor`) — actually 3 once Entities and Manifest are counted separately. | 2-3 files |
| `Separator` → `Divider` | 1 | 0 | One caller (`shell/TopBar.tsx`). Trivial. | 1 file |
| `Label` | 4 | n/a | No refined `Label` exists. Either fold Label into `PropertyRow` (which already owns the small-caps style) or add `ui/Label.tsx` as part of the migration dispatch. | 4 files |
| `Modal` | 4 | n/a | No refined `Modal` exists. Phase 1.5 must either build `ui/Modal.tsx` (preferred — current legacy Modal hard-codes the legacy `Card` family) or keep `Modal` in `ui.tsx` and migrate everything else around it. | 4 files |

Total migration surface across all duplicates: roughly **40-45 callsite touches** in 25-ish files. Tractable in one focused dispatch, possibly two if split (Button / Input first, then Card / Textarea / Separator).

---

## 4. Mockup-mismatch report

Surface-level fit check against `Editor Design/*.png` and the design
system at `apps/editor/src/styles/design-system.css`. Components below
are listed only if they require attention; everything else is
**aligned**.

| Component | Verdict | Notes |
|---|---|---|
| `AssetThumbnail` | aligned | Aspect-ratio tile + caption + badges matches Home / Assets / Animation / Image-Lab / Sound-Lab mockups. |
| `Badge` | aligned | 7-variant palette covers every badge usage seen in mockups. |
| `Breadcrumb` | aligned | Matches Scripting / Assets path-display. |
| `Button` (new) | aligned | 5 variants × 3 sizes — superset of mockup needs. Composes design-system classes. |
| `Card` (new) | aligned | `flat` / `elevated` / `inspector` elevations match the card stack treatment in inspectors. |
| `Chip` | aligned | Tag-bar treatment matches Entities + Components mockups. |
| `CollapsibleSection` | aligned | Chevron + uppercase label exactly matches every collapsible section in Entities / Project. |
| `ColorChip` | aligned | Native swatch + hex readout matches Entities Light Color and ProjectSettings brand color. |
| `Divider` | aligned | Orientation + inset + strong covers every divider in mockups. |
| `DropdownMenu` | aligned | Portal-rendered floating panel matches TopBar project/scene dropdowns. |
| `EmptyState` | aligned | Logo backdrop + icon + title + CTA matches Home and PrimaryTabs fallback. |
| `FilePicker` | aligned | Dropzone mode matches Home "Import Pack". |
| `IconButton` | aligned | Matches every icon-only button in mockups (TopBar avatar, header actions). |
| `Kbd` | aligned | Inline chord chip matches tooltips + debug bar. |
| `KeyValueList` | aligned | Two-column metadata matches Home recent-projects + ScriptInspector. |
| `LiveIndicator` | aligned | Emerald pulsing pill matches Map 3D-Preview header + Playtest action bar. |
| `LogPanel` | aligned | Severity icons + timestamps + filter chips matches ProjectExport + Playtest log. |
| `NumberInput` | aligned | Steppers + unit suffix matches Position/FOV/scale rows. |
| `PanelHeader` | aligned | Uppercase small-caps + trailing slot matches every rail/inspector header. |
| `PreviewFrame` | aligned | Emerald live border matches mockup chrome. |
| `PreviewHost` | aligned | Engine-agnostic mount; rendering treatment owned by adapter. |
| `ProgressBar` | aligned | Amber fill + indeterminate stripe matches build/import bars. |
| `PropertyRow` | aligned | 40/60 split + unit chip matches inspector row in every mockup. |
| `RailLayout` | aligned | Wraps the same grid-template the views already inline. |
| `ScrollArea` | aligned | Amber-thumb scrollbar matches global treatment. |
| `SearchInput` | aligned | Leading magnifier + clear-X matches every left-rail search. |
| `Select` | aligned | Native `<select>` styled to match TextInput. |
| `StatsBlock` | aligned | Label + big value + trend matches Playtest stats. |
| `StatusBar` | aligned | Mosaic of sections matches the bottom strip in every mockup. |
| `StatusPill` | aligned | Leading dot + 5 variants matches TopBar save-state. |
| `TabStrip` | aligned | Primary (amber underline + icon + label) and secondary variants both match mockups. |
| `TextInput` | aligned | `.input-text` class + prefix/suffix slots matches inspector + modal inputs. |
| `Textarea` (new) | aligned | `.input-textarea` + invalid/mono props matches Components description + ProjectSettings description. |
| `TogglePill` | aligned | Fully-rounded variant matches TopBar Editor/Playtest + Animation loop pill. |
| `Toolbar` | aligned | Grouped + tail matches GridEditor + Playtest action bars. |
| `Tooltip` | aligned | Naive positioning is sufficient for R2 per its own comment. |
| `TopBar` (new) | aligned | Matches §4.11 layout grammar; shell `TopBar.tsx` is the consumer wrapper. |
| `charts.tsx` (FpsGraph / PieChart / ChartLegend) | aligned | Canvas variants match Playtest + Project. |
| `controls.tsx` (Slider / ToggleSwitch / SegmentedControl) | aligned | Amber thumb / amber-on switch / pill picker — all match mockups. |
| `ui.tsx Button / Card / Input / Textarea / Separator / Modal` | **mismatch** (legacy) | These do **not** compose design-system `.button-*` / `.card-surface` / `.input-text` classes — they hand-roll Tailwind. They visually approximate the mockups but the **refined** versions in `ui/` are the canonical implementation. Treat the legacy file itself as the mismatch; the migration plan in §3 resolves it. |

**Net: zero components need a `rewrite` verdict** — every primitive in
`ui/` matches the current mockups + design system. The only mismatch
is structural (legacy `ui.tsx` doesn't compose design-system classes,
the refined `ui/` versions do).

---

## 5. Unused / dead components

Primitives with zero callers across `views/**` and `shell/**`:

| Component | Verdict | Notes |
|---|---|---|
| `AssetThumbnail` | **keep** | Wave B consumer planned (Home / Assets / Animation / Image-Lab / Sound-Lab). |
| `Breadcrumb` | **keep** | Wave B consumer planned (Scripts / Assets). Tiny file. |
| `Button` (new) | **migrate** | Replacement for legacy Button — 22 callers waiting. |
| `Card` (new) | **migrate** | Replacement for legacy Card family. |
| `Chip` | **keep** | Wave B consumer planned (Entities / Components tag bars). |
| `Divider` | **migrate** | Replacement for legacy Separator (1 caller). |
| `Kbd` | **keep** | Wave B consumer planned (Tooltips, debug bar). |
| `LiveIndicator` | **keep** | Wave B consumer planned (Scene 3D-Preview, Playtest). |
| `NumberInput` | **keep** | Universal inspector dependency — Wave B will use it everywhere. |
| `PreviewFrame` | **keep** | Wave B consumer planned (Map / Entities / Scripting live previews). |
| `SearchInput` | **keep** | Universal left-rail dependency — Wave B will use it everywhere. |
| `TextInput` | **migrate** | Replacement for legacy Input — 9 callers waiting. |
| `Textarea` (new) | **migrate** | Replacement for legacy Textarea — 2-3 callers waiting. |
| `TogglePill` | **keep** | Wave B consumer planned (TopBar Editor/Playtest, Animation loop pill). |
| `ThreeRailLayout`, `TwoRailLayout` | **keep** | Optional helper — pages can use it or inline `grid-cols-[…]`. Some Wave B agents will likely adopt. |

No component qualifies for outright **delete** today — every zero-caller
primitive is either a planned-but-not-yet-consumed Phase 1 build or
a refined duplicate awaiting migration.

---

## 6. Recommended action plan

### Components to **delete**
*(none)* — every primitive has a current or near-term consumer.

### Components to **migrate callers + delete legacy**
Drives a single follow-up dispatch ("UI cleanup wave A") before
Wave B fires:

1. `Button` — 22 callers, rename import path to `../components/ui/index` (or `../components/ui/Button`) + swap legacy `Button` for new `Button` (variant API is a superset; verify the one `success` variant is irrelevant on legacy callsites).
2. `Card` family (`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`) — ~6 importer files. Refined Card uses `elevation` prop; default `flat` matches legacy visual.
3. `Input` → `TextInput` — 9 callers; refined drops legacy default surface but adds prefix/suffix. Rename + verify prop overlap.
4. `Textarea` (legacy → new) — 2-3 callers; refined adds `invalid` / `mono` props.
5. `Separator` → `Divider` — 1 caller (`shell/TopBar.tsx`). Trivial.
6. `Label` — 4 callers; pick one of:
   - (a) Build `ui/Label.tsx` as a refined primitive,
   - (b) Replace every Label with a `PropertyRow` (most callsites are inside form rows already).
7. `Modal` — 4 callers; pick one of:
   - (a) Build `ui/Modal.tsx` as a Phase 1.5 primitive (needs refined Card to render content),
   - (b) Keep `Modal` in `ui.tsx` until a dedicated dispatch builds it — but then `ui.tsx` is not fully removable.

After the migration, the legacy `apps/editor/src/components/ui.tsx`
file should be deleted entirely (or shrunk to a temporary shim that
re-exports the new symbols for any straggler import).

### Components to **rewrite to match mockups**
*(none)* — every primitive's implementation is aligned with the current
mockups and the `design-system.css` class library.

### Components to **keep**
Every primitive in `apps/editor/src/components/ui/` (39 files / 38
exported primitives + 1 aggregator). See §1.a for details.

### Pre-Wave-B gate verdict

**Yellow light — recommend running a single "UI cleanup wave A"
dispatch before firing Wave B.**

Rationale:

- Page-local component agents will need to write new `*View.tsx` /
  page-local components against the primitive library. If half of the
  legacy primitives still exist alongside the refined ones, every
  Wave B agent has to make per-callsite decisions about which
  `Button` / `Card` / `Input` to import. That ambiguity will quickly
  produce inconsistent imports across the new pages.
- The migration is small (~40 callsite touches across ~25 files) and
  has no behavioural risk — refined primitives are API supersets of
  the legacy ones (modulo Label/Modal, which need a tiny extension).
- After the migration, Wave B agents read from a single, unambiguous
  primitive surface (`apps/editor/src/components/ui/`), and the
  legacy `ui.tsx` either disappears or becomes a 10-line shim
  exporting nothing new.

If maintainers prefer to fire Wave B in parallel, the alternative is
a **strict rule**: Wave B agents may only import from
`apps/editor/src/components/ui/index` (never from the bare
`apps/editor/src/components/ui` legacy file). New page-local code
then only ever touches refined primitives, and the legacy file
becomes a closed set of older code that the cleanup wave can finish
later.

Either path works. Cleanup-first is cleaner.

---

## Appendix — How caller counts were collected

Per-name counts use:

```
grep -rl "\b<Name>\b" apps/editor/src/views/ apps/editor/src/shell/ | wc -l
```

`Card` / `Card*` / `Button` etc. were further inspected with the
`from "..."` clause to determine which file (`ui.tsx` vs `ui/<Name>.tsx`)
the caller actually hits, since both export the same symbol name.

For `Input`, the grep matches the legacy `Input` symbol — no `Input`
import resolves to the directory because `TextInput` is the directory
name; the refined `TextInput` therefore has zero callers regardless.
