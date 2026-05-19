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
}

export const MOCK_TILE_PRESETS = [
  { id: "wall-brick", name: "Brick", category: "walls" },
  { id: "wall-concrete", name: "Concrete", category: "walls" },
  { id: "wall-wood", name: "Wood Panel", category: "walls" },
  { id: "floor-stone", name: "Stone Floor", category: "floors" },
  { id: "floor-grass", name: "Grass", category: "floors" },
  { id: "ceil-wood", name: "Wood Ceiling", category: "ceilings" },
  { id: "ceil-sky", name: "Open Sky", category: "ceilings" },
  { id: "decor-barrel", name: "Barrel", category: "decor" },
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

export const MOCK_QUICK_TOOLS = [
  "solid",
  "door",
  "trigger",
  "spawn",
  "exit",
  "secret",
  "ambush-cover",
  "decor",
  "lit",
  "loot",
] as const satisfies readonly string[];

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
}

export const MOCK_BRUSHES = [
  { id: "brush-single", name: "Single", kind: "point" },
  { id: "brush-square-3", name: "Square 3x3", kind: "square" },
  { id: "brush-circle-5", name: "Circle 5", kind: "circle" },
  { id: "brush-line", name: "Line", kind: "line" },
  { id: "brush-rect", name: "Rectangle", kind: "rect" },
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
