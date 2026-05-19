// FIXME: Wave 3 — replace with real EditorProjectStore reads.
//
// This module exists so the Wave 2 panel-body agents have a stable
// shape to import dummy data from while the real selectors are
// still in flight. Each export is a const, narrowed where it helps
// inference; row shapes are exported as `interface`s so panel code
// can reference them directly. When the real store lands, this file
// gets deleted in one go and the panel imports get repointed at the
// `editorProjectStore` selectors.

// ---------------------------------------------------------------------------
// Tile presets

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

export const MOCK_TILE_PRESETS = [
  {
    id: "wall-brick",
    name: "Brick",
    category: "walls",
    description:
      "Painted brick — solid wall material with high durability and a warm red tone.",
  },
  {
    id: "wall-concrete",
    name: "Concrete",
    category: "walls",
    description:
      "Poured concrete — cold gray wall surface, ideal for industrial interiors.",
  },
  {
    id: "wall-wood",
    name: "Wood Panel",
    category: "walls",
    description:
      "Vertical wood paneling — interior wall material with a mid-warm tone.",
  },
  {
    id: "floor-stone",
    name: "Stone Floor",
    category: "floors",
    description:
      "Flagstone floor — durable interior flooring with subtle tile seams.",
  },
  {
    id: "floor-grass",
    name: "Grass",
    category: "floors",
    description:
      "Outdoor grass cover — soft green ground surface for exterior scenes.",
  },
  {
    id: "ceil-wood",
    name: "Wood Ceiling",
    category: "ceilings",
    description:
      "Exposed wood beam ceiling — warm overhead surface for indoor levels.",
  },
  {
    id: "ceil-sky",
    name: "Open Sky",
    category: "ceilings",
    description:
      "Open sky — no ceiling geometry; renders the skybox above this cell.",
  },
  {
    id: "decor-barrel",
    name: "Barrel",
    category: "decor",
    description:
      "Wooden barrel decor — placeable solid prop for filling level space.",
  },
] as const satisfies readonly TilePresetRow[];

// ---------------------------------------------------------------------------
// Layers

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
// Tools + sub-tools

export interface ToolSubRow {
  id: string;
  name: string;
}

export interface ToolRow {
  id: string;
  name: string;
  /** Lucide icon name string — Wave 2 maps these to the icon component. */
  icon: string;
  /** Long-form tooltip body. Used by the tool palette's progressive
   *  reveal tooltip — appears after a longer hover than the bare name. */
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
// Cell inspector

export interface CellRow {
  x: number;
  y: number;
  type: string;
  height: number;
  layer: string;
  tags: string[];
  properties: Record<string, unknown>;
}

export const MOCK_CELL = {
  x: 12,
  y: 7,
  type: "wall-brick",
  height: 1.0,
  layer: "walls",
  tags: ["solid", "ambush-cover"],
  properties: {
    blocksMovement: true,
    blocksLight: true,
    material: "brick",
    health: 100,
  },
} as const satisfies CellRow;

// ---------------------------------------------------------------------------
// Status console log lines

export type LogSeverity = "info" | "warn" | "error";

export interface LogLineRow {
  severity: LogSeverity;
  message: string;
  /** Unix epoch ms. */
  ts: number;
}

export const MOCK_LOG_LINES = [
  { severity: "info", message: "Scene loaded: level-01", ts: 1715990000000 },
  { severity: "info", message: "Autosave complete", ts: 1715990012000 },
  { severity: "info", message: "Painted 14 tiles (Brick)", ts: 1715990045000 },
  { severity: "warn", message: "Tile preset 'door-old' deprecated", ts: 1715990060000 },
  { severity: "info", message: "Layer 'Lights' hidden", ts: 1715990078000 },
  { severity: "info", message: "Selection cleared", ts: 1715990092000 },
  { severity: "error", message: "Missing texture: wall-glass.png", ts: 1715990110000 },
  { severity: "warn", message: "Cell (12,7) has no ceiling assigned", ts: 1715990125000 },
  { severity: "info", message: "Undo: paint", ts: 1715990140000 },
  { severity: "info", message: "Redo: paint", ts: 1715990141000 },
  { severity: "info", message: "Saved scene to project", ts: 1715990200000 },
  { severity: "info", message: "Preview rebuilt", ts: 1715990215000 },
] as const satisfies readonly LogLineRow[];

// ---------------------------------------------------------------------------
// Quick tools

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
    name: "Ambush Cover",
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
// Selection info readout

export interface SelectionInfoRow {
  position: string;
  cell: string;
  layer: string;
  selection: string;
}

export const MOCK_SELECTION_INFO = {
  position: "x: 12.50  y: 7.25",
  cell: "(12, 7)",
  layer: "Walls",
  selection: "1 cell",
} as const satisfies SelectionInfoRow;

// ---------------------------------------------------------------------------
// Brushes

export interface BrushRow {
  id: string;
  name: string;
  kind: string;
  /** Long-form tooltip body. Used by the brush panel's progressive
   *  reveal tooltip — appears after a longer hover than the bare name. */
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
// Scene settings

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
// History

export type HistoryEntryType =
  | "paint"
  | "erase"
  | "place"
  | "delete"
  | "edit"
  | "select";

export interface HistoryEntryRow {
  id: string;
  type: HistoryEntryType;
  label: string;
  /** Unix epoch ms. */
  ts: number;
  description?: string;
}

export const MOCK_HISTORY = [
  {
    id: "h-1",
    type: "paint",
    label: "Paint Brick (14 cells)",
    ts: 1715990045000,
    description: "Painted 14 cells with the Brick tile preset in the Walls layer.",
  },
  {
    id: "h-2",
    type: "erase",
    label: "Erase (3 cells)",
    ts: 1715990048000,
    description: "Erased 3 cells from the Walls layer.",
  },
  {
    id: "h-3",
    type: "place",
    label: "Place Barrel x4",
    ts: 1715990060000,
    description: "Placed 4 barrel entities.",
  },
  {
    id: "h-4",
    type: "edit",
    label: "Edit cell (12,7) tags",
    ts: 1715990092000,
    description: "Modified the tag list on cell (12,7).",
  },
  {
    id: "h-5",
    type: "select",
    label: "Select region 10x10",
    ts: 1715990100000,
    description: "Selected a 10x10 region around (15,15).",
  },
  {
    id: "h-6",
    type: "paint",
    label: "Paint Stone Floor (50 cells)",
    ts: 1715990110000,
    description: "Painted 50 cells with the Stone Floor preset.",
  },
  {
    id: "h-7",
    type: "delete",
    label: "Delete Barrel x1",
    ts: 1715990120000,
    description: "Deleted 1 barrel entity at (12,7).",
  },
  {
    id: "h-8",
    type: "edit",
    label: "Edit layer 'Lights' visibility",
    ts: 1715990125000,
    description: "Hid the Lights layer.",
  },
] as const satisfies readonly HistoryEntryRow[];
