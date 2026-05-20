/**
 * Slimmed scene fixtures — pack-local subset used by the panels this
 * pack has so far migrated out of `apps/editor/src/views/`.
 *
 * Today only LightingPanel reads from this file, so only the light
 * fixtures live here. Subsequent P3 batches will fold in additional
 * MOCK_* exports (layers, presets, prefabs, etc.) as the panels that
 * consume them migrate in. The full source-of-truth at
 * `apps/editor/src/views/scene/scene-fixtures.ts` ALSO remains in the
 * shell tree while batches B–D are still pulling from it; once the
 * migration is complete the editor copy is deleted (CORE_EDITOR_PACK.md
 * §3.1).
 *
 * Keeping the file pack-local rather than reaching back into the
 * editor's source preserves the "no editor-source value imports"
 * invariant the dogfooding principle enforces. The shell SDK does not
 * expose fixture data — fixtures are pack content, not platform
 * surface area.
 */

// ---------------------------------------------------------------------------
// Lights — consumed by LightingPanel.

export type LightKind = "point" | "spot" | "directional" | "area";

export interface LightRow {
  id: string;
  name: string;
  kind: LightKind;
  position: { x: number; y: number; z: number };
  /** 6-digit `#RRGGBB` hex color of the light. */
  color: string;
  /** 0..10 brightness multiplier. */
  intensity: number;
  enabled: boolean;
  description: string;
}

export const MOCK_LIGHTS = [
  { id: "light-sun", name: "Sun", kind: "directional", position: { x: 0, y: 50, z: 0 }, color: "#fef9c3", intensity: 1.0, enabled: true, description: "Primary scene sunlight. Cast direction from above." },
  { id: "light-torch-1", name: "Torch 1", kind: "point", position: { x: 12, y: 2, z: 7 }, color: "#fb923c", intensity: 2.5, enabled: true, description: "Wall torch near the entrance. Flickers." },
  { id: "light-torch-2", name: "Torch 2", kind: "point", position: { x: 24, y: 2, z: 7 }, color: "#fb923c", intensity: 2.5, enabled: true, description: "Wall torch in the corridor." },
  { id: "light-spotlight-boss", name: "Boss Spotlight", kind: "spot", position: { x: 40, y: 6, z: 40 }, color: "#a78bfa", intensity: 4.0, enabled: false, description: "Dramatic spot on the boss arena. Triggers on encounter." },
  { id: "light-ambient-pit", name: "Pit Ambient", kind: "area", position: { x: 20, y: 0, z: 20 }, color: "#22d3ee", intensity: 1.2, enabled: true, description: "Cool fill light in the pit chamber." },
] as const satisfies readonly LightRow[];

// ---------------------------------------------------------------------------
// Layers — consumed by LayersPanel + SelectionInfoPanel (layer-name
// lookup for the readout). The built-in layer roster is panel content,
// not synced runtime state — user-added layers live in
// `useLayerStore.customLayers` and merge with this fixture at render
// time. See CORE_EDITOR_PACK.md §3.1.

export interface LayerRow {
  id: string;
  name: string;
  visible: boolean;
  /** 6-digit `#RRGGBB` hex string used by the layer legend chip. */
  color: string;
}

export const MOCK_LAYERS = [
  { id: "floors", name: "Floors", visible: true, color: "#f59e0b" },
  { id: "walls", name: "Walls", visible: true, color: "#38bdf8" },
  { id: "doors", name: "Doors", visible: true, color: "#10b981" },
  { id: "sprites", name: "Sprites", visible: true, color: "#a78bfa" },
  { id: "lights", name: "Lights", visible: false, color: "#ef4444" },
] as const satisfies readonly LayerRow[];

// ---------------------------------------------------------------------------
// Tile presets — type only; TilePresetPanel reads the live registry
// (`useTilePresetRegistryStore`) for its data, but the shape adapter
// returns rows in this layout so `PresetRow` can stay typed.

export type TilePresetCategory = "walls" | "floors" | "ceilings" | "decor";

export interface TilePresetRow {
  id: string;
  name: string;
  category: TilePresetCategory;
  thumbnail?: string;
  /** Long-form tooltip body. Used by the tile-preset panel's
   *  progressive reveal tooltip — appears after a longer hover than
   *  the bare preset name. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Quick tools — consumed by QuickToolsPanel for chip labels +
// per-id command registration.

export interface QuickToolRow {
  id: string;
  name: string;
  /** Long-form tooltip body. Used by the quick-tools panel's
   *  progressive reveal tooltip — appears after a longer hover than
   *  the bare chip label. */
  description: string;
  /** Optional lucide icon name string. Wave 3 may map these to icons
   *  on the chip face; for now the chip is text-only. */
  icon?: string;
}

export const MOCK_QUICK_TOOLS = [
  {
    id: "solid",
    name: "Solid",
    description:
      "Mark the selection as a solid blocker — collides with movement and blocks projectiles.",
  },
  {
    id: "door",
    name: "Door",
    description:
      "Tag the selection as a door — interactable opening that can swing, slide, or be locked.",
  },
  {
    id: "trigger",
    name: "Trigger",
    description:
      "Tag the selection as a trigger volume — fires script events when entered or exited.",
  },
  {
    id: "spawn",
    name: "Spawn",
    description:
      "Mark the selection as a spawn point — players or entities enter the scene here.",
  },
  {
    id: "exit",
    name: "Exit",
    description:
      "Mark the selection as an exit point — leads to the next scene or level.",
  },
  {
    id: "secret",
    name: "Secret",
    description:
      "Tag the selection as a secret — hidden area tracked by the level's completion stats.",
  },
  {
    id: "ambush-cover",
    name: "Cover",
    description:
      "Tag the selection as ambush cover — AI uses it for line-of-sight breaks and flanking.",
  },
  {
    id: "decor",
    name: "Decor",
    description:
      "Tag the selection as decor — non-interactive visual dressing that doesn't affect gameplay.",
  },
  {
    id: "lit",
    name: "Lit",
    description:
      "Mark the selection as a light source — emits illumination into the surrounding cells.",
  },
  {
    id: "loot",
    name: "Loot",
    description:
      "Tag the selection as a loot container — drops items when interacted with or destroyed.",
  },
] as const satisfies readonly QuickToolRow[];

// ---------------------------------------------------------------------------
// Selection info readout — consumed by SelectionInfoPanel as the
// shape for the multi-line clipboard payload.

export interface SelectionInfoRow {
  position: string;
  cell: string;
  layer: string;
  selection: string;
}

// ---------------------------------------------------------------------------
// Brushes — consumed by BrushPanel for chip labels + per-id command
// registration. The JSON spec ("brush.json" alongside this file) binds
// the tile grid to this roster by id.

export interface BrushRow {
  id: string;
  name: string;
  kind: string;
  /** Long-form tooltip body. */
  description?: string;
}

export const MOCK_BRUSHES = [
  {
    id: "brush-single",
    name: "Single",
    kind: "point",
    description: "Single-cell point brush — paints one cell at a time.",
  },
  {
    id: "brush-square-3",
    name: "Square 3x3",
    kind: "square",
    description:
      "Square footprint brush — paints an N×N block centered on the cursor (size controls N).",
  },
  {
    id: "brush-circle-5",
    name: "Circle 5",
    kind: "circle",
    description:
      "Circular footprint brush — paints a disc of radius `size` centered on the cursor.",
  },
  {
    id: "brush-line",
    name: "Line",
    kind: "line",
    description:
      "Line brush — click + drag to paint a straight line of cells between the press and release points.",
  },
  {
    id: "brush-rect",
    name: "Rectangle",
    kind: "rect",
    description:
      "Rectangle brush — click + drag to fill an axis-aligned rectangle between the press and release points.",
  },
] as const satisfies readonly BrushRow[];

// ---------------------------------------------------------------------------
// Tools + sub-tools — consumed by ToolPalettePanel.

export interface ToolSubRow {
  id: string;
  name: string;
}

export interface ToolRow {
  id: string;
  name: string;
  /** Lucide icon name string — Wave 2 maps these to the icon component. */
  icon: string;
  /** Long-form tooltip body. */
  description?: string;
  subTools?: ToolSubRow[];
}

export const MOCK_TOOLS = [
  {
    id: "select",
    name: "Select",
    icon: "MousePointer2",
    description:
      "Pick existing cells, entities, or selection regions. Hold Shift to add to selection.",
    subTools: [
      { id: "select-box", name: "Box" },
      { id: "select-polygon", name: "Polygon" },
      { id: "select-contiguous", name: "Contiguous" },
    ],
  },
  {
    id: "paint",
    name: "Paint",
    icon: "Brush",
    description:
      "Paint the active tile preset onto the canvas. Drag to paint multiple cells.",
  },
  {
    id: "eraser",
    name: "Eraser",
    icon: "Eraser",
    description: "Remove content from the active layer. Drag to erase a region.",
  },
  {
    id: "eye-dropper",
    name: "Dropper",
    icon: "Pipette",
    description: "Sample the cell under the cursor as the active brush.",
  },
  {
    id: "fill",
    name: "Fill",
    icon: "PaintBucket",
    description:
      "Flood-fill the area under the cursor with the active tile preset.",
  },
  {
    id: "entity-place",
    name: "Entity",
    icon: "PlusSquare",
    description: "Place the selected entity prefab on the canvas.",
  },
] as const satisfies readonly ToolRow[];

// ---------------------------------------------------------------------------
// Scene settings — consumed by SceneSettingsPanel for seed/reset values.

export interface SceneSettingsRow {
  name: string;
  dimensions: { w: number; h: number };
  /** 0..1, fog density. */
  fog: number;
  /** 0..1, ambient light level. */
  ambient: number;
}

export const MOCK_SCENE_SETTINGS = {
  name: "level-01",
  dimensions: { w: 64, h: 64 },
  fog: 0.25,
  ambient: 0.35,
} as const satisfies SceneSettingsRow;

// ---------------------------------------------------------------------------
// Asset references — consumed by AssetReferencesPanel.
//
// `AssetKind` here mirrors `SemanticAssetKind` from the editor's
// `apps/editor/src/state/dnd/payload.ts`. We inline the union as a
// pack-local type rather than reaching into the editor source — types
// erase at compile time and the pack doesn't need any runtime symbol
// from `payload.ts`. If the canonical union widens, this list widens
// in lockstep (low churn).

export type AssetKind =
  | "script"
  | "texture"
  | "sprite"
  | "sound"
  | "music"
  | "prefab"
  | "tilePreset"
  | "scene";

export interface AssetRefRow {
  id: string;
  name: string;
  kind: AssetKind;
  path: string;
  /** Number of references to this asset across the scene. */
  refCount: number;
  /** Whether the asset is missing on disk. */
  missing: boolean;
  description: string;
}

export const MOCK_ASSETS = [
  { id: "tex-wall-brick", name: "wall-brick.png", kind: "texture", path: "textures/walls/brick.png", refCount: 142, missing: false, description: "Brick wall texture, 256x256." },
  { id: "tex-wall-concrete", name: "wall-concrete.png", kind: "texture", path: "textures/walls/concrete.png", refCount: 78, missing: false, description: "Concrete wall texture." },
  { id: "tex-wall-glass", name: "wall-glass.png", kind: "texture", path: "textures/walls/glass.png", refCount: 4, missing: true, description: "Glass wall texture. MISSING — referenced but not on disk." },
  { id: "tex-floor-stone", name: "floor-stone.png", kind: "texture", path: "textures/floors/stone.png", refCount: 220, missing: false, description: "Stone floor tile." },
  { id: "snd-door-open", name: "door-open.ogg", kind: "sound", path: "sounds/door/open.ogg", refCount: 12, missing: false, description: "Door opening SFX." },
  { id: "snd-grunt-alert", name: "grunt-alert.ogg", kind: "sound", path: "sounds/enemies/grunt-alert.ogg", refCount: 8, missing: false, description: "Grunt enemy alert vocal." },
  { id: "music-level-01", name: "level-01.mp3", kind: "music", path: "music/level-01.mp3", refCount: 1, missing: false, description: "Level 01 background music loop." },
  { id: "prefab-barrel-ref", name: "barrel.prefab", kind: "prefab", path: "prefabs/barrel.prefab", refCount: 7, missing: false, description: "Standard barrel prop prefab." },
  { id: "script-trigger-door", name: "trigger-door.ts", kind: "script", path: "scripts/triggers/door.ts", refCount: 3, missing: false, description: "Door trigger behavior script." },
] as const satisfies readonly AssetRefRow[];
