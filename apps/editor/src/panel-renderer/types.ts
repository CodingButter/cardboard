/**
 * JSON Panel Renderer — type spec (Phase 0).
 *
 * A panel can be authored as a JSON tree instead of TSX. The renderer
 * consumes this spec, resolves any `store.foo.bar` bindings against the
 * Wave-3 Zustand stores, and dispatches `{ script: "x.y" }` script-refs
 * through the command registry.
 *
 * Keep the initial node-type set TIGHT — Layout, Heading, Text, Input,
 * Button, Spacer, Conditional. We resist adding more until a real panel
 * needs them in Phase 1; every node-type expansion has a cost (renderer
 * size, builder surface, migration coverage). New types should be
 * justified by an actual migrated panel that can't be expressed with the
 * existing set.
 *
 * See `docs/plans/EDITOR_ENGINE.md` §4 for the spec rationale.
 */

/**
 * A path into a Zustand store. Accepts both `$store.foo.bar` (matches the
 * spec example in EDITOR_ENGINE.md §4) and the shorter `store.foo.bar`.
 * The first segment after the `store.` prefix is the store name; the
 * remaining segments are nested property accesses. A `[selected]`
 * dynamic-index segment resolves against `useSelectionStore.selected`
 * (Phase 0's only dynamic-index special case).
 *
 * Examples:
 *   "store.selection.selected"
 *   "$store.scene.settings.name"
 *   "store.scene.cells[selected].height"
 */
export type StorePath = `$store.${string}` | `store.${string}`;

/**
 * Script-ref escape hatch. Resolved at invoke time against the command
 * registry (`useCommandStore.commands[script]`). Args may contain the
 * placeholder `{ $value: true }` — at invoke time it's replaced with the
 * triggering control's current value (e.g. an Input's text). Strings and
 * numbers in args are passed through verbatim.
 *
 * Example:
 *   { script: "selection.clear" }
 *   { script: "scene.rename", args: [{ $value: true }] }
 */
export interface ScriptRef {
  script: string;
  args?: ReadonlyArray<string | number | boolean | ScriptValuePlaceholder>;
}

/** Placeholder slot in a script-ref's args. */
export interface ScriptValuePlaceholder {
  $value: true;
}

/** Discriminator helper for ScriptValuePlaceholder. */
export function isValuePlaceholder(
  v: unknown,
): v is ScriptValuePlaceholder {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { $value?: unknown }).$value === true
  );
}

// ---------------------------------------------------------------------------
// Node spec — discriminated union, no `any`.
// ---------------------------------------------------------------------------

export interface LayoutNode {
  type: "Layout";
  direction: "row" | "column";
  /** Tailwind-style gap in 0.25rem units; defaults to 2 (8px). */
  gap?: number;
  /** Optional padding in 0.25rem units; defaults to 0 (no padding). */
  padding?: number;
  children: NodeSpec[];
}

export interface HeadingNode {
  type: "Heading";
  /** Static string or a store-path binding. */
  text: string | StorePath;
  /** h1 = largest, h4 = smallest. Defaults to 2. */
  level?: 1 | 2 | 3 | 4;
}

export interface TextNode {
  type: "Text";
  /** Static string or a store-path binding. */
  text: string | StorePath;
  /** Render the text in a muted colour (for secondary copy). */
  muted?: boolean;
}

export interface InputNode {
  type: "Input";
  /** Optional label rendered above the input. */
  label?: string;
  /** Two-way binding — read AND write a store value. */
  bind: StorePath;
  placeholder?: string;
}

export interface ButtonNode {
  type: "Button";
  text: string;
  onClick: ScriptRef;
  /** Variant maps to the shell `<Button variant>` prop. Defaults to "secondary". */
  variant?: "primary" | "secondary" | "ghost" | "danger" | "success";
}

export interface SpacerNode {
  type: "Spacer";
  /** Size in 0.25rem units; defaults to 2. */
  size?: number;
}

export interface ConditionalNode {
  type: "Conditional";
  /** Show children when this binding's resolved value is truthy. */
  when: StorePath;
  children: NodeSpec[];
}

/**
 * Discriminated union of every node type the Phase 0 renderer
 * understands. Adding a new node type is a four-step process:
 *   1. Add the interface above.
 *   2. Add it to this union.
 *   3. Add a case in `PanelRenderer.tsx`'s switch.
 *   4. Cover it in `PanelRenderer.test.ts`.
 *
 * Skipping step 2 or 3 should produce a TypeScript error at the switch
 * site (the union is exhaustively checked via the `never` assertion).
 */
export type NodeSpec =
  | LayoutNode
  | HeadingNode
  | TextNode
  | InputNode
  | ButtonNode
  | SpacerNode
  | ConditionalNode;

/**
 * Optional per-panel local-state slice. Phase 0 doesn't actually wire
 * this up (no node-types read from local state yet) but we accept it on
 * the spec so authored JSONs are forward-compatible with Phase 1.
 */
export interface PanelLocalStateSpec {
  default: unknown;
}

/** The shell's dock-type catalog — mirrors `EDITOR_ENGINE.md` §3. */
export type DockKind =
  | "dockable-window"
  | "fullbleed-main"
  | "fixed-left-rail"
  | "fixed-right-rail"
  | "top-bar"
  | "bottom-bar"
  | "floating-overlay"
  | "modal"
  | "container-dockview";

/**
 * A complete panel spec — what a JSON file exports. The renderer
 * consumes one of these and produces a React subtree.
 */
export interface PanelSpec {
  id: string;
  title: string;
  dockKind: DockKind;
  /** Optional per-panel local state slice (Phase 0: accepted, not wired). */
  state?: Record<string, PanelLocalStateSpec>;
  root: NodeSpec;
}
