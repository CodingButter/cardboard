/**
 * Palette catalog — JSON Visual Builder VB2.
 *
 * Every NodeSpec type the renderer accepts gets one entry. Each entry
 * carries:
 *
 *   • `kind` — the NodeSpec discriminant.
 *   • `label` — the palette tile's user-facing name.
 *   • `description` — one-line tooltip body for the palette tile.
 *   • `iconName` — lucide-react icon name used by the palette tile.
 *   • `template` — the default NodeSpec the canvas drop handler
 *     appends when the user releases over the drop target. Templates
 *     ship sensible defaults so the renderer doesn't reject the node
 *     on required-field validation (e.g. `Heading` ships with `text`,
 *     `Button` ships with an `onClick` script-ref placeholder).
 *
 * Drop semantics for container-shaped nodes (Layout / ScrollRow /
 * Tooltip / Conditional): the template ships with an EMPTY container.
 * The visual builder doesn't yet support "drag-into-container" — those
 * containers render their default styling and accept future drops in
 * VB3+ when selection + nested drop zones land. For VB2 the inline
 * placeholder messaging lives on the rendered container itself (an
 * empty `<div>` for Layout, etc.). Tooltip is special-cased — its
 * shell primitive requires a single child, so the template ships with
 * a placeholder Text child the user can later replace.
 */

import type { NodeSpec } from "../../../apps/editor/src/panel-renderer/types";

export interface PaletteEntry {
  /** NodeSpec discriminant. Doubles as a stable id for the palette tile. */
  kind: NodeSpec["type"];
  /** Tile label. */
  label: string;
  /** Tooltip / sublabel. */
  description: string;
  /** lucide-react icon component name (resolved by the palette renderer). */
  iconName: string;
  /** Template NodeSpec appended on drop. */
  template: NodeSpec;
}

export const PALETTE_CATALOG: ReadonlyArray<PaletteEntry> = [
  {
    kind: "Layout",
    label: "Layout",
    description: "Flex / grid container that arranges its children.",
    iconName: "LayoutDashboard",
    template: {
      type: "Layout",
      direction: "column",
      gap: 2,
      children: [],
    },
  },
  {
    kind: "Heading",
    label: "Heading",
    description: "h1–h4 heading. Static text or bound to a store path.",
    iconName: "Heading1",
    template: { type: "Heading", text: "Heading", level: 2 },
  },
  {
    kind: "Text",
    label: "Text",
    description: "Body / label / value text. Optional formatter + truncate.",
    iconName: "Type",
    template: { type: "Text", text: "Lorem ipsum", variant: "default" },
  },
  {
    kind: "Input",
    label: "Input",
    description: "Two-way bound text input.",
    iconName: "TextCursorInput",
    template: {
      type: "Input",
      bind: "store.scene.settings.name",
      label: "Input",
      placeholder: "Type here",
    },
  },
  {
    kind: "NumberInput",
    label: "Number Input",
    description: "Two-way bound number input with optional bounds.",
    iconName: "Hash",
    template: {
      type: "NumberInput",
      bind: "store.brush.size",
      min: 1,
      max: 20,
      step: 1,
      label: "Number",
    },
  },
  {
    kind: "Slider",
    label: "Slider",
    description: "Two-way bound range slider.",
    iconName: "SlidersHorizontal",
    template: {
      type: "Slider",
      bind: "store.brush.size",
      min: 1,
      max: 20,
      step: 1,
      ariaLabel: "Slider",
    },
  },
  {
    kind: "Button",
    label: "Button",
    description: "Action button. Fires a registered command on click.",
    iconName: "MousePointerClick",
    template: {
      type: "Button",
      text: "Button",
      onClick: { script: "placeholder.command" },
      variant: "secondary",
    },
  },
  {
    kind: "ToggleButton",
    label: "Toggle Button",
    description: "Pressed-state aware tile / chip backed by a binding.",
    iconName: "ToggleLeft",
    template: {
      type: "ToggleButton",
      bind: "store.tool.activeTool",
      activeValue: "select",
      text: "Toggle",
      shape: "chip",
      onClick: { script: "placeholder.command" },
    },
  },
  {
    kind: "Spacer",
    label: "Spacer",
    description: "Empty box for visual padding between siblings.",
    iconName: "Space",
    template: { type: "Spacer", size: 2 },
  },
  {
    kind: "Conditional",
    label: "Conditional",
    description: "Conditionally render children based on a binding.",
    iconName: "GitBranch",
    template: {
      type: "Conditional",
      when: "store.selection.selected",
      children: [],
    },
  },
  {
    kind: "Tooltip",
    label: "Tooltip",
    description: "Progressive hover tooltip wrapping a single child.",
    iconName: "MessageSquare",
    template: {
      type: "Tooltip",
      side: "top",
      stages: [
        { delay: 600, content: { type: "Text", text: "Tooltip body" } },
      ],
      child: { type: "Text", text: "Hover trigger" },
    },
  },
  {
    kind: "Icon",
    label: "Icon",
    description: "Lucide-react icon by name.",
    iconName: "Star",
    template: { type: "Icon", name: "Crosshair", size: 14 },
  },
  {
    kind: "ScrollRow",
    label: "Scroll Row",
    description: "Horizontally-scrolling row with edge-fade affordances.",
    iconName: "ArrowRightLeft",
    template: {
      type: "ScrollRow",
      contentClassName: "flex items-center gap-1",
      children: [],
    },
  },
  {
    kind: "Select",
    label: "Select",
    description: "Two-way bound dropdown — static options or live source.",
    iconName: "ListFilter",
    template: {
      type: "Select",
      bind: "store.layer.activeId",
      optionsFrom: "layers",
      label: "Select",
    },
  },
  {
    kind: "Canvas",
    label: "Canvas",
    description: "Imperative <canvas> exposed to pack scripts via refName.",
    iconName: "Square",
    template: { type: "Canvas", refName: "preview-canvas", heightPx: 120 },
  },
  {
    kind: "RenderSpec",
    label: "Render Spec",
    description: "Recursively render a NodeSpec / PanelSpec from a binding.",
    iconName: "Boxes",
    template: { type: "RenderSpec", from: "store.panelBuilder.root" },
  },
];
