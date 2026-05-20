/**
 * PanelRenderer — Phase 0 recursive JSON panel renderer.
 *
 * Walks a `PanelSpec` tree and emits React nodes. Each `NodeSpec` type
 * maps to a small wrapper that either renders a shell primitive
 * (`<Button>`, `<TextInput>`) or a plain element (`<div>` for Layout,
 * `<h2>` for Heading). The `useStoreBinding` hook handles two-way
 * binding into Zustand stores via the `resolveBinding` resolver.
 *
 * Constraints (per the brief):
 *   • Uses ONLY shell-exported primitives — `<Button>`, `<TextInput>`.
 *     No reinventing primitives.
 *   • Every interactive node routes through the command registry via
 *     `invokeScript`. There is no raw-function escape hatch.
 *   • TypeScript strict — the switch in NodeRenderer exhaustively
 *     handles every NodeSpec variant; the trailing `never` assert
 *     guarantees a compile-time error when a new variant is added
 *     without a matching case.
 *
 * Pop-out window compatibility:
 *   The renderer is a pure consumer of Zustand stores via the
 *   normal hook subscriptions. Wave-3 stores already broadcast via
 *   the storage event + BroadcastChannel (see `sync.ts`); a popped-
 *   out copy of any JSON panel will see the same store updates with
 *   no extra wiring. Verified mentally — the renderer never holds
 *   refs to DOM nodes across windows and never side-channels state.
 */

import React from "react";
import { Button } from "../components/ui/Button";
import { TextInput } from "../components/ui/TextInput";
import { cn } from "../lib/cn";
import { invokeScript } from "./invokeScript";
import {
  getStoreHook,
  resolveBinding,
  type ResolvedBinding,
} from "./resolveBinding";
import type {
  ButtonNode,
  ConditionalNode,
  HeadingNode,
  InputNode,
  LayoutNode,
  NodeSpec,
  PanelSpec,
  SpacerNode,
  StorePath,
  TextNode,
} from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true when a `string | StorePath` field is a binding (vs a plain
 * static string). Bindings start with `store.` or `$store.`.
 */
function isBindingPath(text: string): text is StorePath {
  return text.startsWith("store.") || text.startsWith("$store.");
}

/**
 * useStoreBinding — Phase 0 binding hook.
 *
 * Subscribes the calling component to the store the path roots into so
 * the component re-renders when ANY slice of that store changes. This
 * is coarser than necessary (the binding only depends on a specific
 * sub-tree), but it's correct, and Phase 0 prioritises correctness
 * over render-perf. Phase 1 should narrow the subscription using a
 * selector — feasible because `tokenisePath` already tells us which
 * top-level key to watch.
 *
 * Returns the resolved binding (stable across renders for the same
 * path) plus the current value. Callers that need to write back call
 * `binding.set(newValue)`.
 */
function useStoreBinding(path: string): {
  value: unknown;
  binding: ResolvedBinding;
} {
  // Re-resolve only when the path string changes.
  const binding = React.useMemo(() => resolveBinding(path), [path]);
  // Subscribe to the store the path roots into. We don't pass a
  // selector — the hook returns the whole state — but we IMMEDIATELY
  // re-read through `binding.get()` so the rendered value is the
  // freshest resolved view. The subscription itself is what triggers
  // re-render on change.
  const storeHook = getStoreHook(binding.storeName);
  storeHook((s) => s); // subscribe to all slice changes
  const value = binding.get();
  return { value, binding };
}

/**
 * Resolve a `string | StorePath` text field. If it's a binding, returns
 * the resolved current value coerced to string. If it's a static
 * string, returns it verbatim. Wrapped as a hook because the binding
 * path needs `useStoreBinding`.
 */
function useResolvedText(text: string): string {
  // ALWAYS call the hook to keep hook order stable across renders —
  // pass a sentinel path when the input is static. The sentinel reads
  // a stable value (just `useSelectionStore.selected`) and is then
  // discarded by the branch below.
  const isBinding = isBindingPath(text);
  const { value } = useStoreBinding(isBinding ? text : "store.selection.selected");
  if (!isBinding) return text;
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  // Object / array — JSON-stringify so authors see SOMETHING rather
  // than [object Object]. JSON panels shouldn't bind to non-scalar
  // values via Heading/Text, but we don't want to crash if they do.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Per-node renderers
// ---------------------------------------------------------------------------

function LayoutRenderer({ node }: { node: LayoutNode }): React.JSX.Element {
  const gap = node.gap ?? 2;
  const padding = node.padding ?? 0;
  return (
    <div
      className={cn(
        "flex",
        node.direction === "row" ? "flex-row" : "flex-col",
        `gap-${gap}`,
        padding > 0 && `p-${padding}`,
      )}
    >
      {node.children.map((child, i) => (
        <NodeRenderer key={i} node={child} />
      ))}
    </div>
  );
}

function HeadingRenderer({ node }: { node: HeadingNode }): React.JSX.Element {
  const text = useResolvedText(node.text);
  const level = node.level ?? 2;
  const sizeClass =
    level === 1
      ? "text-xl font-semibold"
      : level === 2
      ? "text-base font-semibold"
      : level === 3
      ? "text-sm font-semibold"
      : "text-xs font-semibold uppercase tracking-wide";
  const className = cn("text-zinc-100", sizeClass);
  if (level === 1) return <h1 className={className}>{text}</h1>;
  if (level === 2) return <h2 className={className}>{text}</h2>;
  if (level === 3) return <h3 className={className}>{text}</h3>;
  return <h4 className={className}>{text}</h4>;
}

function TextRenderer({ node }: { node: TextNode }): React.JSX.Element {
  const text = useResolvedText(node.text);
  return (
    <p
      className={cn(
        "text-sm",
        node.muted ? "text-zinc-500" : "text-zinc-300",
      )}
    >
      {text}
    </p>
  );
}

function InputRenderer({ node }: { node: InputNode }): React.JSX.Element {
  const { value, binding } = useStoreBinding(node.bind);
  // The bound value may be undefined (path doesn't currently resolve —
  // e.g. `cells[selected]` with no selection). Render an empty string
  // in that case rather than letting React warn about uncontrolled →
  // controlled transitions.
  const displayValue =
    value == null
      ? ""
      : typeof value === "string"
      ? value
      : String(value);
  return (
    <label className="flex flex-col gap-1">
      {node.label && (
        <span className="text-xs text-zinc-400">{node.label}</span>
      )}
      <TextInput
        value={displayValue}
        placeholder={node.placeholder}
        onChange={(e) => binding.set(e.target.value)}
      />
    </label>
  );
}

function ButtonRenderer({ node }: { node: ButtonNode }): React.JSX.Element {
  const onClick = React.useCallback(() => {
    void invokeScript(node.onClick);
  }, [node.onClick]);
  return (
    <Button variant={node.variant ?? "secondary"} onClick={onClick}>
      {node.text}
    </Button>
  );
}

function SpacerRenderer({ node }: { node: SpacerNode }): React.JSX.Element {
  const size = node.size ?? 2;
  return <div className={cn(`h-${size}`, `w-${size}`)} aria-hidden="true" />;
}

function ConditionalRenderer({
  node,
}: {
  node: ConditionalNode;
}): React.JSX.Element | null {
  const { value } = useStoreBinding(node.when);
  if (!value) return null;
  return (
    <>
      {node.children.map((child, i) => (
        <NodeRenderer key={i} node={child} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// Recursive dispatch
// ---------------------------------------------------------------------------

/**
 * Exhaustively dispatch a `NodeSpec` to its renderer. The trailing
 * `never` assertion guarantees a compile-time error if a new node type
 * is added to the `NodeSpec` union without a matching case here.
 */
export function NodeRenderer({ node }: { node: NodeSpec }): React.JSX.Element | null {
  switch (node.type) {
    case "Layout":
      return <LayoutRenderer node={node} />;
    case "Heading":
      return <HeadingRenderer node={node} />;
    case "Text":
      return <TextRenderer node={node} />;
    case "Input":
      return <InputRenderer node={node} />;
    case "Button":
      return <ButtonRenderer node={node} />;
    case "Spacer":
      return <SpacerRenderer node={node} />;
    case "Conditional":
      return <ConditionalRenderer node={node} />;
    default: {
      // Exhaustiveness check — if you added a NodeSpec variant and
      // skipped a case, TS will reject this assignment.
      const _never: never = node;
      // eslint-disable-next-line no-console
      console.error(
        `[PanelRenderer] unknown node type`,
        _never,
      );
      return null;
    }
  }
}

/**
 * Top-level entry point — render a complete panel spec into a React
 * subtree. Wraps the root in a flex column with sensible default
 * padding so JSON authors don't need to remember to set it.
 */
export function PanelRenderer({
  spec,
}: {
  spec: PanelSpec;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 p-3 h-full overflow-auto" data-panel-id={spec.id}>
      <NodeRenderer node={spec.root} />
    </div>
  );
}
