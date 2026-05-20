# Editor Design Inventory

Coordination document for the editor redesign. This is the single source
of truth that downstream agents read to know **what to build** (Phase 1
primitives) and **how each page composes** them (Phase 2 page rebuilds).

This doc reads the eleven mockups in `Editor Design/`, the existing
primitive library in `apps/editor/src/components/ui/`, and the existing
views in `apps/editor/src/views/`, and emits three sections:

1. **Pages** — one subsection per mockup with target view file, layout
   grammar, current state, page-local components, shared primitives in
   play, and design-token / surface treatments.
2. **Shared primitives catalog** — flat tables grouped by category.
   Every row carries an `existing` / `new` / `refine` status against
   `apps/editor/src/components/ui/`.
3. **Phase guide** — how Phase 1 (primitives), Phase 2 (per-page
   rebuild), and Phase 3 (real-state wiring) consume Sections 1 and 2.

Cross-references the master `docs/plans/EDITOR_REDESIGN.md` (especially
§3 palette/tokens and §6 layout grammar). When the design vocabulary
in this doc and EDITOR_REDESIGN disagree, **EDITOR_REDESIGN wins** —
this doc only restates the contract it imposes per-page.

A parallel agent (#21) has just landed
`apps/editor/src/styles/design-system.css` with `@apply`-composed
semantic classes (panel-surface, panel-header, button-primary, …). This
doc describes surfaces *semantically* — "panel surface (zinc-900 +
zinc-800 border)" — so Phase 1 / Phase 2 work picks the right class
name from #21 without this doc having to pin it.

---

## Section 1 — Pages

Eleven page subsections, in the order they appear in PrimaryTabs +
Playtest overlay. Each subsection follows the same template:

- **Mockup** — absolute path under `Editor Design/`.
- **Target view file** — where the implementation lives (or will live).
- **Layout grammar** — top-level grid choice per `EDITOR_REDESIGN.md §6.5`.
- **Current state** — does a view file exist? What's its rough shape?
- **Page-local components** — small composed widgets specific to this
  view that Phase 2 agents need to build (with status — these are not
  primitives, they live next to the view).
- **Shared primitives used** — pulls from Section 2.
- **Surface treatments** — palette / radius / spacing notes.
- **Notes** — judgement calls, dependencies, blockers.

### 1.1 Home — Project Picker

- **Mockup**: not in `Editor Design/` (see `Component Reference.ts
  §HomeProjectPageReference` for the visual reference). The eleven PNGs
  in `Editor Design/` cover the *in-shell* pages — Home renders inside
  the same shell but its mockup lives in the TSX reference instead.
- **Target view file**: `apps/editor/src/views/HomeScreen.tsx`
  (761 LOC, exists — needs full Phase 2 rebuild against the new shell).
- **Layout grammar**: **2-column** body `grid-cols-[1.2fr_1fr] gap-5 p-6`.
- **Current state**: existing implementation is a vertically stacked
  sequence of cards (project picker on top, "New Project / Import Pack
  / Open URL Pack" actions below). No template gallery, no
  thumbnails, no per-row "last edited" beyond a timestamp line.
- **Page-local components**:
  - `RecentProjectRow` — `new` — thumbnail + name + last-edited + two
    version badges + circular Play IconButton.
  - `TemplateTile` — `new` — aspect-video preview + name + caption,
    hover ring.
  - `CreateOrImportCard` — `new` — three full-width action buttons
    (New Project amber primary, Import Pack outlined, Open URL outlined).
- **Shared primitives used**: Card, CardHeader, CardContent, Badge,
  KeyValueList, EmptyState, FilePicker, IconButton, Button.
- **Surface treatments**: app background gradient visible at the
  outermost frame. Selected/most-recent project row gets an amber
  border + faint amber fill (`border-amber-400 bg-amber-500/5`).
  Template tiles are card-surface tiles with a hover amber ring.
- **Notes**: HomeScreen is project-independent — TopBar's project
  dropdown is disabled while Home is the active tab. Clicking Home
  while a project is open implies "switch projects" and must respect
  the existing unsaved-work confirm dialog.

### 1.2 Scene (Map)

- **Mockup**: `Editor Design/Map.png`.
- **Target view file**: `apps/editor/src/views/MapView.tsx` (1866 LOC,
  exists — the §7.2 three-rail layout has already landed per commit
  `87f01d6`). The center grid painter is `GridEditor.tsx` (2338 LOC).
  Left rail is `MapPalette.tsx` (314 LOC). Inspector is the existing
  preview + cell + scene cards. **Refine in Phase 2** to swap inline
  controls for shared primitives + apply design-system surface classes.
- **Layout grammar**: **3-pane**
  `grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`.
- **Current state**: shell skeleton exists. Inline `<input
  type="range">`, ad-hoc checkboxes, and bare `<div>` property rows
  still appear inside the inspector cards.
- **Page-local components**:
  - `MapPalette` — `existing` (`apps/editor/src/views/MapPalette.tsx`,
    refine for Phase 2 to slot tile-category sections into
    `CollapsibleSection` + use the shared SearchInput).
  - `MapToolbar` — `existing` (`apps/editor/src/views/MapToolbar.tsx`,
    refine for Phase 2 to use the shared `Toolbar` primitive +
    Badge-as-toggle for layer chips).
  - `MapContextMenu` — `existing` (`apps/editor/src/views/MapContextMenu.tsx`).
  - `CellPreview` — `existing` (`apps/editor/src/views/CellPreview.tsx`,
    1297 LOC — center of the "3D Preview" card on the right).
  - `MapStatusConsole` — `new` (bottom-of-view tabbed Output / Problems
    / Search log + 4-cell info grid Position / Cell / Layer / Selection).
  - `LayerLegendFloater` — `new` (the small floating pill of 5 layer
    Badges hovering over the canvas bottom-left).
  - Tool tile grid (`2×3` of Select / Paint / Entity / Light / Eraser /
    Fill, active tile amber-filled) — `new`.
- **Shared primitives used**: PanelHeader, CollapsibleSection,
  Toolbar, Badge, ScrollArea, PropertyRow, Slider, ToggleSwitch,
  Select, Card, StatsBlock, Button, SegmentedControl, LogPanel,
  KeyValueList, TabStrip (secondary for status-console tabs),
  IconButton.
- **Surface treatments**: 3-rail body uses panel surfaces. Cards in
  the right inspector are darker card surfaces stacked with `gap-4`.
  Active tile / tool / layer chip uses amber-500 fill + amber-400
  border. Floating layer-legend pill is rounded-full with card-surface
  background.
- **Notes**: the right-rail "3D Preview" mounts a non-interactive
  iframe pinned to the current cell; a screenshot-bake fallback is
  acceptable for low-end users. Existing scene-paint smoke tests must
  pass unchanged after the refine.
- **Architecture decisions (2026-05-18)** — supersede the
  `Layout grammar` and `Page-local components` bullets above where
  they conflict. These were settled in conversation; until those
  earlier bullets are rewritten to match, **these take precedence**.
  - **Dockable everything**: the Scene page uses the dockview shell
    in `apps/editor/src/views/MapView.tsx` + `WorkspaceRail`, not
    the fixed `3-pane grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`
    grammar. Every page-local panel — Map Toolbar, Tool Palette,
    Brush, Tile Preset, Layers, Map Canvas, 3D Preview, Cell
    Inspector, Quick Tools, Map Status Console, Selection Info — is
    its own dock entry. Default layout evokes `Map.png` but the user
    can retile and pop out freely; persisted per project under
    `cardboard_workspace.dockLayouts[scene::<projectId>]`.
  - **Tile Preset panel**: walls, floors, ceilings, and decor are
    sub-categories of a **tile preset**, surfaced through the
    `TilePresetPanel` (see `docs/plans/TILE_PRESETS.md`). The
    overloaded "TOOLS / BRUSH / TILE TYPES / LAYERS" `ToolsPanel`
    stub at `apps/editor/src/views/scene/panels/ToolsPanel.tsx`
    splits into separate dock panels per concern.
  - **Map / Entity as modes**: the Scene page treats **Map** and
    **Entity** as modes within the same view, not separate pages.
    Each mode dictates the active tool palette and painting / picking
    semantics.
    - **Map mode** — tile painting against the `TilePresetPanel`.
    - **Entity mode** — place / author entities, either from scratch
      or instantiated from prefabs.
    - **Lights are not a distinct mode** — any entity becomes a light
      source by attaching the right components (see
      `docs/plans/LIGHTING_OVERHAUL.md` Phase 7).
    - **Shared tools** in both modes: Select, Eraser, Eye Dropper,
      plus mode-specific extras (Paint / Fill in Map mode; Place /
      Prefab Drop in Entity mode).
    - **Sub-tool modes**: selecting a tool may reveal sub-tool
      buttons underneath it (Select → Box / Polygon / Contiguous,
      etc.). A default sub-tool is auto-selected the first time a
      tool is activated in a session.
  - **Persistence (`localStorage`)**: the active **mode**, the active
    **tool**, and the per-tool **sub-tool** each persist across
    sessions so the user's last working configuration restores on
    reload.
  - **Canvas overlay HUD**: a translucent floating strip rendered
    *inside* `MapCanvasPanel` (not as a dock entry) holds the
    **scene selector** and the Layers / Walls / Floor / Ceiling /
    Entities / Lights visibility toggles. Replaces the earlier
    `LayerLegendFloater` concept and absorbs the scene picker that
    used to live in the topbar tab-context slot.
  - **Topbar tab-context strip (Scene page)**: with the scene
    selector moved out, `useTabContextSlot()` content mirrors
    `Map.png`'s strip — pack info + save-status pill on the left,
    **Raycast Mode** select, **Grid** toggle, and a **Zoom group**
    on the right (`[−][+]` IconButton pair grouped together, then a
    chevron dropdown that opens a zoom-slider popover). The existing
    `apps/editor/src/views/scene/SceneTabContextPicker.tsx` is
    repurposed — its DropdownMenu moves into the canvas overlay and
    the topbar slot gets a new `MapTabContextStrip`.

### 1.3 Prefabs (Entities)

- **Mockup**: `Editor Design/Entities.png`.
- **Target view file**: `apps/editor/src/views/EntitiesEditor.tsx`
  (1990 LOC, exists — needs full Phase 2 rebuild). The companion
  `apps/editor/src/components/ComponentForm.tsx` already exists and
  drives per-component sub-forms; Phase 2 keeps the data model, swaps
  the visual chrome.
- **Layout grammar**: **3-pane**
  `grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`.
- **Current state**: prefab list on the left, giant
  component-form editor in the middle, JSON preview on the right.
  Sub-forms are hand-rolled collapsibles with inline labels, sliders,
  selects. The pattern is correct; the chrome is not.
- **Page-local components**:
  - `PrefabListRail` — `new` — search input + scrolling list + drag-drop
    `FilePicker` zone at the bottom for prefab JSON imports.
  - `ComponentForm` — `existing` (refine to render each component as a
    shared `CollapsibleSection` with a leading icon and a trailing
    enable/disable ToggleSwitch).
  - `JsonPreviewCard` — `new` — read-only monospace preview with a copy
    IconButton, fed by the existing `serializePrefab` helper.
  - `TagInputBar` — `new` — pill-chip multi-tag input under the prefab
    header.
- **Shared primitives used**: PanelHeader, CollapsibleSection,
  PropertyRow, Slider, ToggleSwitch, Select, ColorChip,
  SegmentedControl, FilePicker, ScrollArea, Button, Badge, IconButton,
  Chip, SearchInput, NumberInput, TextInput.
- **Surface treatments**: each component is a CollapsibleSection with
  card-surface background. Per-component icon (Light → Sun, Sprite →
  ImageIcon, Movement → ArrowRight, Position → MapPin) resolved from a
  lookup table. JSON preview uses mono text on darker card-elev surface.
- **Notes**: existing prefab smoke tests must pass after the refactor.
  Save / Save & Test buttons live under the JSON preview — primary
  amber + outlined respectively.

### 1.4 Components — **NEW PAGE**

- **Mockup**: `Editor Design/Components.png`.
- **Target view file**: `apps/editor/src/views/ComponentsView.tsx`
  (does not exist — Phase 2 builds it from scratch).
- **Layout grammar**: **3-pane**
  `grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`.
- **Current state**: no view file exists. This is one of the two
  genuinely new pages in this redesign cycle.
- **What `Components.png` depicts (visual inspection)**: a
  **Component Builder** — the authoring surface for editing
  `manifest.components[]` entries: each component declares a name,
  a JSON schema (typed property rows), default values, and category
  tags. The page lets a pack author *define* a component once, then
  the Prefabs page (§1.3) lets the user *attach instances* of it to a
  prefab.
  - **Left rail**: "COMPONENT LIBRARY" header, list of component
    names (Camera, Transform, Sprite, Collider, Light, Audio, Weapon,
    AudioEmitter, …), each row with an icon + name. Selected row is
    amber-tinted. Sticky "+ Add Component" amber button at the top.
  - **Center**: "Component Builder" pane. Header row with the
    component name + category badge + Duplicate / Export Schema /
    Delete buttons. Below: a tag input bar + description Textarea.
    Then a **schema editor** — repeating rows of `[Property Name |
    Type Select | Default value | Description]` with a chevron to
    expand into per-field advanced settings (min/max/step for
    numbers, enum values for selects, etc.) and a trailing trash
    IconButton. The rows can be grouped into named property groups
    ("Camera / Audio / Lighting") via "+ Add Group" buttons.
    Controls along the strip: "Expand All / Collapse All / Auto-Reload".
  - **Right inspector**: JSON preview of the resolved component
    schema (mono, syntax-highlighted) + "DEFAULTS" Card with a quick
    preview of the resolved default-instance values.
- **Page-local components**:
  - `ComponentLibraryRail` — `new` — header + Add button + scrolling list.
  - `ComponentSchemaEditor` — `new` — the central repeating
    `SchemaFieldRow`s, possibly grouped into `SchemaFieldGroup`s.
  - `SchemaFieldRow` — `new` — `[name input | type select | default
    control | description input | expand chevron | trash IconButton]`,
    with an expanded panel for type-specific advanced settings.
  - `SchemaFieldGroup` — `new` — collapsible header wrapping a set of
    rows + an "Add field" button at the bottom of the group.
  - `ComponentDefaultsCard` — `new` — right-rail preview of the resolved
    instance with default values applied.
- **Shared primitives used**: PanelHeader, ScrollArea, Button,
  IconButton, SearchInput, TextInput, NumberInput, Select, Textarea
  (legacy `ui.tsx`), Chip, Badge, CollapsibleSection, PropertyRow,
  Card, ToggleSwitch.
- **Surface treatments**: same three-rail panel/card grammar as
  Prefabs. The schema rows are card-surface strips with an amber-tinted
  border when the row is being edited. Type-select chips inside the
  schema editor use neutral zinc fill.
- **Notes**: this page should write to a new
  `EditorProjectStore.upsertComponentSchema(componentName, schema)` —
  not in scope for Phase 2, which only builds the shell + binds to
  placeholder state. Phase 3 wires it to the pack manifest's
  `components[]` array (or to the planned `apps/pack-builder` schema
  pipeline — clarify with maintainers).

### 1.5 Scripts

- **Mockup**: `Editor Design/Scripting.png`.
- **Target view file**: `apps/editor/src/views/ScriptsView.tsx`
  (1046 LOC, exists — refine in Phase 2; the Monaco integration is
  already wired via `apps/editor/src/views/scripts/ScriptsMonaco.tsx`
  and `ScriptsFileTree.tsx`).
- **Layout grammar**: **3-pane**
  `grid-cols-[240px_1fr_320px]` (narrower left rail than the standard
  300px to give Monaco more room).
- **Current state**: skeleton exists. Phase 2 work is to apply the
  surface treatments and swap inline buttons / chips for shared
  primitives. The defunct `ScriptsAssetsRail.tsx` has already been
  deleted (see worktree status — `D`).
- **Page-local components**:
  - `ScriptsFileTree` — `existing` (refine: search input + collapse-all
    IconButton in header; each folder is a `CollapsibleSection`-like
    node).
  - `ScriptsMonaco` — `existing` (refine: hosts open-file `TabStrip`
    above + the problems strip below).
  - `ScriptInspectorCard` — `new` — component name + exported
    `@property` KeyValueList + "Used by" prefabs hyperlinked list +
    Live Edit ToggleSwitch + Save Button.
  - `ProblemsStrip` — `new` — collapsible bottom strip listing
    Monaco diagnostics with severity icons.
- **Shared primitives used**: SearchInput, IconButton, PanelHeader,
  ScrollArea, TabStrip (file tabs — primary, smaller size), Card,
  KeyValueList, ToggleSwitch, Button, Badge (for problem counts).
- **Surface treatments**: Monaco's theme is dark with default font;
  the surrounding chrome uses card surface. File tabs use the
  amber-underline active state from the design vocabulary.
- **Notes**: `parseComponentScript` (already used by the engine loader)
  feeds the Script Inspector. Live Edit ToggleSwitch maps to the
  existing `EditorAssetPack.hotReloadScript(scriptPath)` flow.

### 1.6 Animation

- **Mockup**: `Editor Design/Animation.png`.
- **Target view file**: `apps/editor/src/views/AnimationEditor.tsx`
  (file exists per `ls`; see `ANIMATION_EDITOR.md` plan — already a
  substantial implementation). Refine in Phase 2 — re-skin only, no
  logic refactor.
- **Layout grammar**: **3-pane**
  `grid-cols-[260px_1fr_300px]`.
- **Current state**: existing implementation has the sprite-sheet
  preview, frame timeline, keyframe markers, playback controls.
  Visual style is the older shadcn-ish look.
- **Page-local components**:
  - `AnimationClipsRail` — `new` — search + scrolling list of clips
    (Player / Walk Forward / Idle / Run / Jump / Attack), each row a
    name + duration sub-label + icon. Selected = amber-tinted.
  - `SpriteSheetStrip` — `new` — horizontally scrollable strip of
    frame thumbnails with a yellow scrubber handle on top.
  - `KeyframeTimeline` — `new` — vertical rows (layers / body parts),
    horizontal frame markers, draggable keyframe dots. Below the
    timeline: play/pause/reverse `SegmentedControl` + speed Slider +
    loop ToggleSwitch + frame counter Badge.
  - `AnimationInspectorCard` — `new` — Name Input + Duration Input +
    Frame Count StatsBlock + Loop Mode SegmentedControl + Event
    Markers list.
  - `LoopPreviewCard` — `new` — looping preview of the active clip
    with mini play/pause/reverse controls beneath.
- **Shared primitives used**: PanelHeader, TextInput, SearchInput,
  ScrollArea, Toolbar, ToggleSwitch, Slider, SegmentedControl,
  Button, Badge, Card, PropertyRow, StatsBlock, IconButton, EmptyState.
- **Surface treatments**: the timeline rows use rounded amber/grey
  track segments (not the current solid lines). Right inspector is
  the same card stack as other 3-pane views.
- **Notes**: keyframe data model + IDB schema stay put; this is a
  visual re-skin. Acceptance: existing animation smoke tests pass.

### 1.7 Project (management subtab)

- **Mockup**: `Editor Design/ProjectManagement.png`.
- **Target view file**:
  `apps/editor/src/views/project/ProjectTabView.tsx` (507 LOC, exists
  — refine in Phase 2). Sibling panels in `apps/editor/src/views/project/`
  (Manifest, Dependencies, Export, Advanced, Validation, Log) each
  already exist; Phase 2 re-skins them against shared primitives.
- **Layout grammar**: **3-pane + bottom log strip** — left category
  rail + center config + right validation/output stack, with a
  full-width LogPanel pinned to the bottom of the view.
- **Current state**: standalone Project tab exists and is wired into
  the shell. Internal panels render forms with inline labels. The
  design lands the surface chrome on top.
- **Page-local components**:
  - `ProjectCategoryRail` — `new` — left list (Settings / Build /
    Export / Assets / Scripts / Production Stats / Web (Build) /
    Setup) with a 3-line mini-log tile at the bottom.
  - `BuildConfigCard` — `new` — Version + Output Directory inputs
    grouped under a Card heading.
  - `AssetBundlingSection` — `new` — Browser Bundles / Asset Files /
    Include Comments ToggleSwitches + Granularity Select.
  - `OptimisationGrid` — `new` — Minify Assets / Compress Lights /
    Remove Unused Assets / Compress Audio ToggleSwitches with
    sub-rows for sub-options ("Aggressive").
  - `ProjectValidationCard` — `existing` (refine — `ProjectValidationPanel.tsx`,
    4-column count grid: Issues Total / Errors / Warnings / Info).
  - `ValidationIssuesList` — `existing` (refine — embedded in
    `ProjectValidationPanel.tsx`, list rows with severity icons +
    short messages).
  - `BuildOutputKeyValueList` — `existing` (refine, in `ProjectExportPanel.tsx`).
  - `BuildSizeCompositionCard` — `new` — PieChart segments (Walls,
    Floors, Sprites, Scripts, Audio, Manifest, Other) + ChartLegend.
  - `BottomLogStrip` — `existing` (refine — `ProjectLogPanel.tsx`,
    full-width LogPanel).
- **Shared primitives used**: PanelHeader, ScrollArea, Card,
  PropertyRow, TextInput, NumberInput, ToggleSwitch, Select,
  SegmentedControl, Slider, Badge, Button, KeyValueList, PieChart,
  ChartLegend, LogPanel, ProgressBar, CollapsibleSection, StatusPill,
  StatsBlock, IconButton.
- **Surface treatments**: most information-dense view in the editor.
  Heavy use of card-surface stacks. Right rail validation card uses
  red / yellow / sky / emerald badge tints for severity counts.
  Build action buttons at the bottom of the center column: large amber
  "Repack Package" primary + outlined "Build Web Version" + amber
  "Export Package" + outlined "Validate".
- **Notes**: validation surface uses the existing `validatePack(meta)`
  pipeline. Build Output stats come from
  `EditorAssetPack.estimateBuildSize()` (a new helper). PieChart
  segments compute from the same helper.

### 1.8 Project (settings subtab) — Modal

- **Mockup**: `Editor Design/ProjectSettings.png`.
- **Target view file**:
  `apps/editor/src/views/ProjectSettingsModal.tsx` (1214 LOC, exists
  — refine in Phase 2). Sibling forms in
  `apps/editor/src/views/project/ProjectManifestForm.tsx`,
  `ProjectDependenciesPanel.tsx`, `ProjectExportPanel.tsx`,
  `ProjectAdvancedPanel.tsx` already exist.
- **Layout grammar**: **modal** (Modal primitive from legacy `ui.tsx`)
  wrapping a **secondary TabStrip** with 4 tabs (Manifest /
  Dependencies / Export / Advanced).
- **Current state**: large floating modal exists with all forms stacked
  simultaneously. Phase 2 paginates them into the 4-tab TabStrip and
  swaps inline labels for `PropertyRow`s.
- **Page-local components**:
  - `ManifestTab` — `existing` (refine — `ProjectManifestForm.tsx`).
  - `DependenciesTab` — `existing` (refine — `ProjectDependenciesPanel.tsx`,
    KeyValueList of dependency packs with a remove IconButton per row).
  - `ExportTab` — `existing` (refine — `ProjectExportPanel.tsx`,
    Build target Select + Output directory Input + bundle ToggleSwitches).
  - `AdvancedTab` — `existing` (refine — `ProjectAdvancedPanel.tsx`,
    feature-flag ToggleSwitches + telemetry opt-in + advanced flags).
  - `ModalFooter` — `new` — "Reload Running Game" left-aligned outlined
    Button + "Cancel" + "Save" right-aligned (Save amber).
- **Shared primitives used**: Modal (legacy), TabStrip (secondary),
  PropertyRow, TextInput, Textarea (legacy), Select, ToggleSwitch,
  Button, KeyValueList, IconButton, Badge.
- **Surface treatments**: modal body uses panel surface. Tab strip
  along the top with amber-underline active. Footer separator + a
  destructive Button uses red border.
- **Notes**: every existing manifest field must still round-trip
  through this modal. "Reload Running Game" still broadcasts the
  existing reset postMessage. Manifest fields (Name / Version / Start
  Scene) are *also* editable from the Project tab's BuildConfig card —
  intentional dual entry point.

### 1.9 Image Lab — **NEW PAGE**

- **Mockup**: `Editor Design/ImageLab.png`.
- **Target view file**: `apps/editor/src/views/ImageLabView.tsx`
  (1005 LOC, exists as a stub — needs full Phase 2 rebuild). The
  skeleton with lucide icons (Brush / Filter / Layers / Wand2 …)
  is present but not wired against the real procedural-graph backend.
- **Layout grammar**: **3-pane** — node-graph rail + center
  node-graph canvas + right inspector.
- **Current state**: skeleton view exists with the right shell shape
  but no real graph editing. Phase 2 lands the visual chrome; Phase 3
  wires it to whatever procedural-image backend ships.
- **Page-local components**:
  - `NodeLibraryRail` — `new` — search + scrolling list of node types
    (Texture / Noise / Color Ramp / Output / Mix / etc.) grouped into
    sections.
  - `NodeGraphCanvas` — `new` — pannable / zoomable canvas with
    draggable node cards connected by bezier wires. Each node card is
    a small surface with a title bar, input/output sockets, and a
    mini-preview thumbnail.
  - `AssetBinRail` — `new` — bottom-left strip of recent / saved
    procedural-image outputs as tile thumbnails.
  - `NodePropertiesCard` — `new` — right-rail inspector for the
    selected node (per-node form: e.g. Noise → Scale / Octaves /
    Seed; Color Ramp → list of stops).
  - `PreviewCard` — `new` — large square preview of the current graph
    output (top of the right inspector).
- **Shared primitives used**: SearchInput, PanelHeader, ScrollArea,
  Card, PropertyRow, NumberInput, Slider, ColorChip, Button,
  IconButton, Badge, EmptyState, AssetThumbnail.
- **Surface treatments**: graph canvas is a darker panel surface with
  a subtle grid background. Nodes are card-elev surfaces with
  per-category accent borders (Noise = sky, Color = purple, Output =
  amber).
- **Notes**: node-graph drag/drop + wire routing is the largest
  Phase 2 unknown. Acceptable to ship Phase 2 with placeholder static
  nodes and stub wires; Phase 3 wires interaction + backend.

### 1.10 Sound Lab — **NEW PAGE**

- **Mockup**: `Editor Design/SoundLab.png`.
- **Target view file**: `apps/editor/src/views/SoundLabView.tsx`
  (1060 LOC, exists as a stub — needs full Phase 2 rebuild). Mirrors
  Image Lab's structure with audio-specific node types.
- **Layout grammar**: **3-pane** — node-graph rail + center
  procedural-audio graph + right inspector.
- **Current state**: skeleton view exists with lucide audio icons
  (AudioWaveform / Music2 / MicVocal / Waves …). No real graph wiring.
- **Page-local components**:
  - `AudioNodeLibraryRail` — `new` — search + categorised list of
    audio node types (Oscillator / ADSR / Filter / Reverb / Mixer /
    Output …).
  - `AudioGraphCanvas` — `new` — analogous to Image Lab's graph
    canvas with audio-specific node bodies (ADSR widgets, mini EQ
    meters, etc.).
  - `WaveformViewer` — `new` — right-rail card showing the rendered
    output waveform with a play scrubber.
  - `SpectrogramViewer` — `new` — beneath the waveform, FFT
    spectrogram of the rendered audio.
  - `SoundEffectInspectorCard` — `new` — per-node properties (filter
    cutoff, reverb wet/dry, ADSR envelopes — all PropertyRows).
  - `AudioAssetBin` — `new` — bottom strip of saved synthesised SFX
    with play IconButtons per row.
- **Shared primitives used**: SearchInput, PanelHeader, ScrollArea,
  Card, PropertyRow, Slider, NumberInput, ToggleSwitch, Button,
  IconButton, Badge, AssetThumbnail.
- **Surface treatments**: same node-graph treatment as Image Lab but
  with cooler accent colours per node category (Oscillator = sky,
  Filter = amber, Output = emerald).
- **Notes**: shares the node-graph primitive with Image Lab — Phase 2
  agents should coordinate on a shared `GraphCanvas` page-local
  helper if it makes sense, but it's not a Section-2 primitive (too
  domain-specific).

### 1.11 UI Builder — **NEW PAGE**

- **Mockup**: `Editor Design/UIDeisgner.png` (preserve the typo
  filename — that's the literal filename on disk).
- **Target view file**: `apps/editor/src/views/UIBuilderView.tsx`
  (does not exist — Phase 2 builds it from scratch).
- **Layout grammar**: **3-pane** with the center pane split
  vertically into preview-on-top, code/tree-on-bottom.
- **Current state**: no view file exists. This is the second
  genuinely new page in this redesign (after Components — §1.4).
- **What `UIDeisgner.png` depicts**: a layout editor for the engine's
  in-game HUD / menus. Left rail = a palette of HUD widget types
  (button, panel, label, image, progress bar, joystick, etc.) +
  layer / template tabs. Center top = a live HUD preview with example
  widgets (a "100 / HP" bar, an ammo counter, a "Find the exit"
  banner, a crosshair). Center bottom = a synced
  template-code / element-tree pane (mockup shows what looks like
  JSX-ish markup with a tree-outline beside it). Right rail =
  property inspector for the selected widget (Container settings,
  Layout settings — flex direction / alignment / padding — and Style
  settings — colour / radius / shadow).
- **Page-local components**:
  - `UIWidgetPaletteRail` — `new` — categorised list of HUD widget
    types as drag-source tiles.
  - `UIHudPreview` — `new` — live preview canvas with the rendered
    HUD. Click to select widgets.
  - `UITemplatePane` — `new` — center-bottom split between the
    template source (code editor) and the element tree (outline
    panel).
  - `UIWidgetInspectorCard` — `new` — right-rail card with Layout +
    Style sub-sections, each a PropertyRow stack.
  - `UILayoutPropertyRow` — `new` — flex-direction icon picker, gap
    Slider, padding 4-input row, alignment SegmentedControl. Variant
    of PropertyRow with custom controls.
- **Shared primitives used**: PanelHeader, ScrollArea, Card,
  CollapsibleSection, PropertyRow, NumberInput, TextInput, Select,
  ColorChip, Slider, SegmentedControl, ToggleSwitch, Button,
  IconButton, Badge, TabStrip (for the layer/template tabs in the
  left rail and for the code/tree toggle in the bottom-center pane).
- **Surface treatments**: preview pane uses app-background surface to
  show what the engine HUD looks like over a dark scene. Widget
  cards have amber-border selection state. Template pane uses
  card-elev surface for both the code and the tree.
- **Notes**: Phase 2 ships the shell + a static example HUD. Phase 3
  wires the widget data model to whatever serialised HUD-template
  format the engine consumes (clarify with maintainers).

### 1.12 Playtest Overlay

- **Mockup**: `Editor Design/GamePreview.png`.
- **Target view file**: `apps/editor/src/views/PlaytestOverlay.tsx`
  (842 LOC, exists — refine in Phase 2). This is the chrome around
  the runtime game iframe (telemetry rails + log + frame graph).
- **Layout grammar**: **specialised** — top action bar + 3-pane body
  (left telemetry rail / center iframe / right inspector) + bottom
  log + FPS graph strip. Overrides the normal PrimaryTab view body
  when active.
- **Current state**: skeleton exists. Phase 2 lands the visual chrome
  and wires placeholder values; full telemetry depends on
  `EDITOR_IFRAME.md §12 (I2)`.
- **Page-local components**:
  - `PlaytestActionBar` — `new` — Stop (red outline) / Pause (yellow
    outline) / Restart / Free Camera (toggle) / Half Walk (toggle) /
    Debug View (toggle) — all on a Toolbar. Right-aligned: render
    mode SegmentedControl (Editor / Playtest) + FOV Badge.
  - `RuntimeStatsCard` — `new` — left-rail StatsBlocks: FPS, Frame
    Time, Draw Calls, Active Lights, Total Cells, Active Frames.
  - `PlayerStatsCard` — `new` — Position (x/y/z), Facing, Velocity.
  - `WorldStatsCard` — `new` — Active Entities, Lights, Baked Cells.
  - `SelectedEntityInspector` — `new` — right-rail card with name,
    type, tags, position of the engine-side picked entity.
  - `CameraFovCard` — `new` — Slider with valueLabel.
  - `LightingSettingsCard` — `new` — Ambient Slider + Intensity Slider
    + "Trigger Bake" Button.
  - `DebugNavCard` — `new` — SegmentedControl for nav-overlay mode +
    "Move Camera To Target" outlined Button.
  - `EngineLogPanel` — `new` — bottom-left LogPanel filtered to
    engine `[Engine]` / `[ModAPI]` prefixes.
  - `FpsGraphCard` — `new` — bottom-right last-240-frames FPS curve
    + average sub-label.
- **Shared primitives used**: Toolbar, Button, IconButton, Card,
  StatsBlock, KeyValueList, Slider, ToggleSwitch, SegmentedControl,
  LogPanel, FpsGraph, ChartLegend, Badge, StatusPill.
- **Surface treatments**: all telemetry cards use card surface stacks.
  Action bar uses panel surface. Iframe pane has no chrome inside it.
- **Notes**: blocked on `EDITOR_IFRAME §12` (I2) telemetry
  postMessages — Phase 2 ships placeholder "—" stats values until I2
  lands `engine-stats`, `world-stats`, `selection-change`.

---

## Section 2 — Shared Primitives Catalog

Flat tables, grouped by category. **Status legend**:

- **existing** — implemented in `apps/editor/src/components/ui/`,
  ready to use. Phase 2 may still want minor polish.
- **refine** — implemented but needs visual / API revision before
  Phase 2 consumes it.
- **new** — Phase 1 must build it before Phase 2 can compose it.

Source paths refer to `apps/editor/src/components/ui/` unless noted.
The legacy primitive file `apps/editor/src/components/ui.tsx` is the
only non-directory primitive surface still in use; it currently
exports `Card`, `CardHeader`, `CardTitle`, `CardDescription`,
`CardContent`, `Button`, `Input`, `Textarea`, `Label`, `Separator`,
`Modal` (11 primitives).

### 2.1 Surfaces

| Component | Status | Source | Description | Key props |
|---|---|---|---|---|
| Card | existing | `ui.tsx` (Card / CardHeader / CardTitle / CardDescription / CardContent) | Stack of related controls on a card surface. Used everywhere as the wrapping element for inspector blocks. | `{ children }` on each subcomponent |
| PanelHeader | existing | `ui/PanelHeader.tsx` | Section header with uppercase small-caps label + optional trailing action (button, count badge, IconButton). Used at the top of every left rail / inspector card. | `{ title, action?, size? }` |
| Divider | refine | `ui.tsx (Separator)` | Thin horizontal rule between rail sections. The existing `Separator` works but Phase 2 likely wants a vertical variant + an inset variant — extend rather than replace. | `{ orientation?, inset? }` |
| CollapsibleSection | existing | `ui/CollapsibleSection.tsx` | Expand/collapse section with chevron + uppercase label + optional trailing element (icon, ToggleSwitch). Used heavily on Prefabs and Components pages. | `{ title, defaultOpen?, open?, onOpenChange?, trailing?, icon?, children }` |
| Toolbar | existing | `ui/Toolbar.tsx` | Horizontal row of grouped action buttons + separators. Used by Scene's top action strip and Playtest action bar. | `{ groups: ToolbarGroup[] }` |
| Modal | existing | `ui.tsx (Modal)` | Floating dialog. Used by ProjectSettings + confirm dialogs. | `{ open, onOpenChange, title, children }` |
| ScrollArea | existing | `ui/ScrollArea.tsx` | Wraps a scrollable region with the editor-wide thin scrollbar styling. | `{ children, maxHeight? }` |

### 2.2 Form controls

| Component | Status | Source | Description | Key props |
|---|---|---|---|---|
| TextInput | refine | `ui.tsx (Input)` | Single-line text input. The legacy `Input` works but needs Phase 1 polish to match the new surface treatments (focus ring, placeholder colour) and to expose a `prefix` slot for icons. | `{ value, onChange, prefix?, suffix?, ariaLabel }` |
| NumberInput | new | — | Numeric input with optional step buttons, unit suffix, min/max clamp. Used pervasively in inspectors (Position X/Y/Z, FOV degrees, scale). | `{ value, onChange, min?, max?, step?, unit?, precision? }` |
| Textarea | refine | `ui.tsx (Textarea)` | Multi-line text input. Same polish as TextInput — focus ring + scrollbar consistency. | `{ value, onChange, rows? }` |
| SearchInput | new | — | TextInput variant with a leading magnifier icon + clear-button suffix. Used in every left rail's "search items" affordance. | `{ value, onChange, placeholder? }` |
| Slider | existing | `ui/controls.tsx` | Horizontal range slider with amber thumb + dark track + amber-tinted fill. Optional inline value chip on the right. | `{ value, min?, max?, step?, onChange, valueLabel?, valueChipVariant? }` |
| ToggleSwitch | existing | `ui/controls.tsx` | iOS-style toggle, amber-on / zinc-off. | `{ checked, onChange, size?, "aria-label" }` |
| SegmentedControl | existing | `ui/controls.tsx` | Multi-option pill picker (loop mode, render mode, alignment, falloff). | `{ value, options, onChange }` |
| Select | existing | `ui/Select.tsx` | Custom dropdown select (not the native `<select>` — styled to match other inputs). | `{ value, options, onChange }` |
| ColorChip | existing | `ui/ColorChip.tsx` | Native color-picker swatch + readable hex value. | `{ value, onChange, shape? }` |
| PropertyRow | existing | `ui/PropertyRow.tsx` | The workhorse row for inspectors: label on the left, control on the right, optional unit chip after the control. Used by every inspector. | `{ label, labelStyle?, hint?, children, unit?, stacked? }` |
| FilePicker | existing | `ui/FilePicker.tsx` | Drag-drop file zone + browse button. Used for asset / prefab imports. | `{ accept?, onFiles, multiple? }` |
| KeyValueList | existing | `ui/KeyValueList.tsx` | Two-column key/value rendering for metadata blocks (Asset Inspector, Build Output, Script Inspector exported properties). | `{ rows: KeyValueRow[] }` |

### 2.3 Action controls

| Component | Status | Source | Description | Key props |
|---|---|---|---|---|
| Button (primary / outline / ghost / danger / secondary) | existing | `ui.tsx (Button)` | Standard buttons. Five variants × two sizes. | `{ variant?, size?, leadingIcon?, trailingIcon?, children, onClick }` |
| IconButton | existing | `ui/IconButton.tsx` | Icon-only button with a `title` tooltip. Used in headers (Save / Settings / Add / Close). | `{ icon, label, onClick, variant?, size? }` |
| DropdownMenu | existing | `ui/DropdownMenu.tsx` | Click-to-open menu of options. Used for project / scene pickers in TopBar. | `{ trigger, options, onSelect }` |

### 2.4 Display

| Component | Status | Source | Description | Key props |
|---|---|---|---|---|
| Badge | existing | `ui/Badge.tsx` | Small inline status indicator. Seven intent colours × rounded/pill × solid/outlined. Used for layer chips, severity counts, tag pills, version markers. | `{ children, variant?, shape?, outlined? }` |
| StatusPill | existing | `ui/StatusPill.tsx` | Larger pill-shaped status indicator with leading dot. Used in TopBar ("All changes saved") and ProjectView build-state header. | `{ variant, children, noDot? }` |
| LiveIndicator | new | — | Specialised StatusPill variant — solid emerald dot + "LIVE" label, used in Scene's 3D Preview card header. Could be a StatusPill preset rather than its own primitive; Phase 1 decides. | `{ active }` |
| Chip | new | — | Standalone small pill used for tag inputs (Entities tag bar, Components tag bar, Prefabs prefab-tag rows). Distinct from Badge in that Chips usually have a leading icon or a trailing remove button. | `{ children, leadingIcon?, onRemove?, variant? }` |
| StatsBlock | existing | `ui/StatsBlock.tsx` | Single big-number + small-label tile. Used in Playtest telemetry rails and Project validation count grid. | `{ value, label, intent?, suffix? }` |
| ProgressBar | existing | `ui/ProgressBar.tsx` | Linear progress indicator. Used by long-running operations (pack export, FBX import). | `{ value, max?, label? }` |
| LogPanel | existing | `ui/LogPanel.tsx` | Scrollable list of log lines with severity icons + timestamps. Used in Project bottom strip, Playtest log, Scene status console. | `{ lines: LogLine[], maxHeight? }` |
| FpsGraph | existing | `ui/charts.tsx` | Last-N frame times line graph. Used in Playtest bottom-right card. | `{ samples, target? }` |
| PieChart | existing | `ui/charts.tsx` | Build-size composition chart. Used in ProjectManagement right rail. | `{ segments }` |
| ChartLegend | existing | `ui/charts.tsx` | Companion legend for FpsGraph / PieChart. | `{ items }` |
| EmptyState | existing | `ui/EmptyState.tsx` | Centred placeholder for empty lists / no-selection states. | `{ icon?, title, description?, action? }` |
| Tooltip | existing | `ui/Tooltip.tsx` | Hover-positioned tooltip wrapper. | `{ content, children, side? }` |
| AssetThumbnail | new | — | Aspect-video / square tile with the asset's preview image + truncated name + optional badges. Used on Assets, Image Lab asset bin, Sound Lab asset bin, Home recent-projects, Animation clips list. | `{ src, name, badges?, selected?, onClick }` |
| PreviewHost | existing | `ui/PreviewHost.tsx` | Sandboxed iframe-or-canvas preview wrapper. Used by Scene's 3D Preview card. | `{ engine, src, controls? }` |

### 2.5 Layout

| Component | Status | Source | Description | Key props |
|---|---|---|---|---|
| TopBar | existing | `ui/TopBar.tsx` | The fixed 64px header across all views — logo + project picker + scene picker + save indicator + Playtest toggle + Export + Save + Settings buttons. | `{ project, scenes, saveState, onPlaytestToggle, onExport, onSave, onSettings }` |
| StatusBar | existing | `ui/StatusBar.tsx` | The fixed 32px bottom strip. Per-view sections via `getStatusBarSections()` callback. | `{ sections: StatusBarSection[] }` |
| 3-pane body grammar (`grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`) | existing | `apps/editor/index.css @theme` | Composition pattern, not a primitive. Use the CSS variables (`--rail-left`, `--rail-right`) for pinned rail widths. | — |
| 2-pane body grammar | existing | `apps/editor/index.css @theme` | `grid-cols-[var(--rail-left)_1fr]` or `grid-cols-[1fr_var(--rail-right)]`. Used by Assets (filter+grid+inspector collapses to 2-pane on narrow widths) and Project (category+config). | — |

### 2.6 Navigation

| Component | Status | Source | Description | Key props |
|---|---|---|---|---|
| TabStrip | existing | `ui/TabStrip.tsx` | Horizontal strip of tabs with amber-underline active. Used by PrimaryTabs, ProjectSettings modal tabs, Scripts open-file tabs, Scene status-console tabs. | `{ tabs, value, onChange, size? }` |
| PrimaryTabs (TabStrip preset) | existing | `ui/TabStrip.tsx` (composed) | The 8-item primary navigation strip — Home / Scene / Prefabs / Components / Assets / Scripts / Animation / Project. Currently 5 tabs in the live editor (see §1.7 current state) — Phase 2 extends. | — |
| Breadcrumb | new | — | Hierarchical path display for nested asset / script paths (e.g. `scripts/components/LightSource.js`). Optional — only needed if Scripts' file tabs feel too cramped on long paths. | `{ segments }` |

---

## Section 3 — Phase Guide

### Phase 1 — Primitives wave (one agent, possibly two)

**Goal**: every Section-2 row tagged `new` or `refine` is buildable
and renderable in the existing `_StyleGuide.tsx` route.

**Inputs**:

- This document, Section 2.
- `docs/plans/EDITOR_REDESIGN.md §3` (palette + tokens) and `§4`
  (per-primitive prop sketches).
- `apps/editor/src/styles/design-system.css` (from agent #21) for
  the semantic class library.

**Outputs**:

- New files in `apps/editor/src/components/ui/` for every `new` row:
  `NumberInput`, `SearchInput`, `Chip`, `LiveIndicator`,
  `AssetThumbnail`, `Breadcrumb`.
- Refine pass on `refine` rows: TextInput / Textarea polish on the
  legacy `ui.tsx` primitives, optional Divider variants.
- Each primitive renders a representative example in
  `apps/editor/src/views/_StyleGuide.tsx`.
- Existing editor smoke tests pass unchanged.

**Out of scope**:

- Touching any file under `apps/editor/src/views/` except `_StyleGuide.tsx`.
- Touching any non-`apps/editor` source.

### Phase 2 — Per-page rebuild wave (one agent per page, parallel)

**Goal**: every Section-1 subsection has its target view file
composed against Section-2 primitives. Real state is **stubbed** —
this phase is visual + structural.

**Inputs**:

- This document, Section 1.
- Phase 1's completed primitives.
- `docs/plans/EDITOR_REDESIGN.md §6` (shell architecture) and `§7`
  (per-view migration plans).

**Outputs (one PR per agent)**:

- **Phase 2a — Home** → rebuilds `HomeScreen.tsx` against the new
  shell. Real state: project list from `EditorProjectStore`.
- **Phase 2b — Scene refine** → swap inline controls inside
  `MapView.tsx` + `GridEditor.tsx` + `MapPalette.tsx` + `MapToolbar.tsx`
  + `CellPreview.tsx` for shared primitives. New: `MapStatusConsole`,
  `LayerLegendFloater`, tool-tile grid.
- **Phase 2c — Prefabs rebuild** → rebuild `EntitiesEditor.tsx`
  against the new shell. Real state preserved.
- **Phase 2d — Components new** → build
  `apps/editor/src/views/ComponentsView.tsx` from scratch. Stub state.
- **Phase 2e — Scripts refine** → re-skin `ScriptsView.tsx` +
  `ScriptsFileTree.tsx` + `ScriptsMonaco.tsx`. Real state preserved.
- **Phase 2f — Animation refine** → re-skin `AnimationEditor.tsx`.
  Real state preserved.
- **Phase 2g — Project refine** → re-skin `ProjectTabView.tsx` +
  sibling panels in `apps/editor/src/views/project/`. Real state
  preserved.
- **Phase 2h — ProjectSettings refine** → re-skin
  `ProjectSettingsModal.tsx`. Real state preserved.
- **Phase 2i — Image Lab rebuild** → rebuild `ImageLabView.tsx`.
  Stub state.
- **Phase 2j — Sound Lab rebuild** → rebuild `SoundLabView.tsx`.
  Stub state.
- **Phase 2k — UI Builder new** → build
  `apps/editor/src/views/UIBuilderView.tsx` from scratch. Stub state.
- **Phase 2l — Playtest refine** → re-skin `PlaytestOverlay.tsx`.
  Real state via existing iframe postMessages where available;
  placeholder "—" for stats blocked on `EDITOR_IFRAME` I2.

Each Phase 2 PR is independent. Multiple agents can land in parallel
after Phase 1 completes.

### Phase 3 — State wiring wave

**Goal**: replace every Phase 2 stub with real editor state, write
new `EditorProjectStore` / `EditorAssetPack` helpers as needed.

**Per-page entries**:

- **Components** — write `EditorProjectStore.upsertComponentSchema()`
  + read path; wire to `manifest.components[]`.
- **Image Lab** — wire the node-graph data model to whatever
  procedural-image backend ships (clarify with maintainers).
- **Sound Lab** — wire the node-graph data model to the procedural
  audio backend.
- **UI Builder** — wire the widget tree to the engine's serialised
  HUD-template format.
- **Project** — implement `EditorAssetPack.estimateBuildSize()` for
  the right-rail Build Output + PieChart.
- **Playtest** — depends on `EDITOR_IFRAME I2` (telemetry postMessages
  `engine-stats`, `world-stats`, `selection-change`). Land
  incrementally as each message type ships.

Phase 3 can run serially per page after the corresponding Phase 2 PR
lands. No coordination needed between Phase 3 work on different
pages.

---

## Appendix — Discrepancies and Judgement Calls

- **Map.png vs `EDITOR_REDESIGN.md §7.2`**: the mockup shows six tool
  tiles in a `2×3` grid (Select / Paint / Entity / Light / Eraser /
  Fill). The plan doc mentions four. Trust the mockup — Phase 2b
  builds six tiles.
- **Naming**: the live editor's `WorkflowMode` enum still uses `scene`
  / `prefabs` (per `ProjectView.tsx:51`). The redesign plan uses
  `map` / `entities` in some places. This doc tracks the **mockup**
  naming convention: Scene / Prefabs / Components / Scripts /
  Animation / Project / Image Lab / Sound Lab / UI Builder.
- **Components vs Prefabs**: these are *different pages*.
  Components.png is the schema authoring surface
  (`manifest.components[]`). Entities.png is the prefab assembly
  surface (attach component instances to a prefab). Phase 2 ships
  them as two views.
- **Image Lab / Sound Lab / UI Builder**: not present in
  `EDITOR_REDESIGN.md`'s 9-view enumeration. They're new pages added
  by the second mockup wave. Treat them as full Phase 2 builds with
  shared chrome but page-specific page-local components (node-graph
  canvas + widget palette are not Section-2 primitives).
- **Components page write path**: `manifest.components[]` may or may
  not be the canonical home — could route through
  `apps/pack-builder`'s schema pipeline instead. Clarify with
  maintainers before Phase 3.
- **Playtest as a tab vs an overlay**: existing
  `PlaytestOverlay.tsx` (842 LOC) implements the overlay-style
  behaviour from `EDITOR_REDESIGN.md §9.4` — playtest is a TopBar
  button toggle, not a PrimaryTab. This doc follows that decision.
