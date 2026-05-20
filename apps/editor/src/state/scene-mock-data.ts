/**
 * scene-mock-data — shell-side scene fixtures the JSON panel renderer
 * + the Wave-3 stores still consume.
 *
 * P5 moved the bulk of `apps/editor/src/views/scene/scene-fixtures.ts`
 * into the core-editor-pack (each panel ships its own pack-local
 * fixtures now — see `packages/core-editor-pack/panels/scene-fixtures.ts`
 * and `panels/prefabs/prefabs-fixtures.ts`). The shell only needs a
 * narrow slice of those types + the two fixtures the JSON renderer
 * resolves at runtime:
 *
 *   - `TilePresetCategory` — referenced as a type by the three
 *     preset-aware stores (`useTilePresetStore`,
 *     `useTilePresetRegistryStore`, the IDB hydration helper).
 *   - `MOCK_LAYERS` — read by `PanelRenderer.tsx` to resolve the
 *     `activeLayerId` → layer-name fallback when the bound spec asks
 *     for the layer label.
 *   - `MOCK_QUICK_TOOLS` — referenced by `PanelRenderer.test.ts` to
 *     assert the QuickTools JSON spec emits one tag per fixture row.
 *
 * These remain shell-side because they're consumed by shell code that
 * runs before any pack loads (store init, renderer evaluation, test
 * fixtures). When the JSON renderer itself moves into the pack chain
 * we can collapse these into the pack's own fixtures.
 */

// ---------------------------------------------------------------------------
// Tile preset category — the four-way category enum the preset stores
// narrow over.

export type TilePresetCategory = "walls" | "floors" | "ceilings" | "decor";

// ---------------------------------------------------------------------------
// Layers — read by the JSON panel renderer for label fallback.

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
// Quick tools — read by the PanelRenderer test to assert spec shape.

export interface QuickToolRow {
  id: string;
  name: string;
  /** Long-form tooltip body. Used by the quick-tools panel's
   *  progressive reveal tooltip — appears after a longer hover than
   *  the bare chip label. */
  description: string;
  /** Optional lucide icon name string. Reserved for chip-face icons. */
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
