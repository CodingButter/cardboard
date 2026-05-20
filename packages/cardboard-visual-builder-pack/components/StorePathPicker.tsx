/**
 * StorePathPicker — VB5 autocomplete control for `bind:` / `when:` /
 * `from:` store-path fields.
 *
 * Registered with the renderer via
 * `ctx.registerCustomComponent("panel-builder.store-path-picker", ...)`
 * so any pack can reference it from inspector JSON via
 * `{ type: "Custom", component: "panel-builder.store-path-picker",
 *    props: { value, onChange, placeholder? } }`. The visual builder's
 * own `<NodeInspector>` reaches it directly (no JSON indirection)
 * because the inspector is a TSX panel — the JSON path is exercised by
 * future third-party pack inspectors.
 *
 * Sources, in priority order:
 *   1. `STORE_REGISTRY` keys — the canonical Wave-3 shell stores
 *      (scene/selection/layer/tool/brush).
 *   2. `listDynamicStores()` — pack-contributed stores currently
 *      registered (panelBuilder/profiler/etc.).
 *   3. Per-store, one level of `getState()` keys — so `scene` suggests
 *      `scene.cells`, `scene.dims`, `scene.settings`, etc. Two levels
 *      get suggested when the user has typed two segments; we walk
 *      lazily by re-resolving `getState()` against the typed prefix.
 *
 * The walk is defensive against:
 *   • Functions in state — skipped (the action methods Zustand returns
 *     are functions; we don't want them in the path-completion list).
 *   • Null / undefined intermediates — early-exit.
 *   • Non-enumerable getters — Object.keys() naturally skips them.
 *
 * Output format: `store.<name>.<path>` (the resolver's accepted form).
 * Existing values starting with `$store.` round-trip — the picker
 * preserves whichever prefix the user already had.
 *
 * Keyboard: ArrowUp / ArrowDown navigate; Enter selects; Esc dismisses;
 * Tab also commits the highlighted suggestion. Substring-prefix match
 * keeps the deps slim (no fuzzy library).
 */

import React from "react";
import { STORE_REGISTRY, listDynamicStores } from "@cardboard/editor-shell";

const FIELD_LABEL = "text-[10px] uppercase tracking-wider text-zinc-500";
const FIELD_INPUT =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs " +
  "text-zinc-100 focus:border-amber-500/80 focus:outline-none";

export interface StorePathPickerProps {
  /** Field label rendered above the input. Optional — JSON inspectors
   *  pass it through their schema; TSX callers may pass it directly. */
  label?: string;
  /** Current value (a store-path string). May be empty. */
  value: string;
  /** Commit callback. Fires on every keystroke (controlled input). */
  onChange: (next: string) => void;
  /** Placeholder text shown when value is empty. */
  placeholder?: string;
  /** Optional id forwarded to the underlying input — lets tests target
   *  the field directly when several pickers share a panel. */
  inputId?: string;
}

/**
 * Strip the leading `$store.` or `store.` prefix; remember which prefix
 * was present so we can re-emit it on commit.
 */
function splitPrefix(raw: string): { prefix: string; body: string } {
  if (raw.startsWith("$store.")) return { prefix: "$store.", body: raw.slice(7) };
  if (raw.startsWith("store.")) return { prefix: "store.", body: raw.slice(6) };
  return { prefix: "store.", body: raw };
}

/**
 * Walk the live store state at the typed-so-far prefix to produce the
 * next-level keys. Returns the list of suggested completions WITHOUT
 * the prefix the user has typed — the picker concatenates them at
 * commit time.
 *
 * The walk re-resolves on every call rather than caching because the
 * dynamic-store registry can change after the inspector mounts (e.g.
 * a pack just registered a new store). Reads are cheap (`getState()`
 * is a property access on the Zustand store ref).
 */
function buildSuggestions(typedBody: string): string[] {
  // Split into ordered segments. A trailing dot means "the user wants
  // completions for the NEXT segment of `parts`" (treat empty); no
  // trailing dot means "the user is in the middle of typing the last
  // segment — match it as a substring filter".
  const endsInDot = typedBody.endsWith(".");
  const parts = typedBody.split(".").filter((s) => s.length > 0);
  // The completion target — what we're currently typing.
  const filter = endsInDot ? "" : (parts.length > 0 ? parts[parts.length - 1]! : "");
  // The known-good prefix segments — used to navigate into nested state.
  const lockedSegments = endsInDot ? parts : parts.slice(0, -1);

  // Step 1: enumerate store names if no segment locked.
  if (lockedSegments.length === 0) {
    const names = [
      ...Object.keys(STORE_REGISTRY),
      ...listDynamicStores().map((d) => d.name),
    ];
    return names
      .filter((n) => n.toLowerCase().includes(filter.toLowerCase()))
      .map((n) => n)
      .sort();
  }

  // Step 2: resolve the store, then walk into its state by locked
  // segments past the first (the first IS the store name).
  const storeName = lockedSegments[0]!;
  let hook =
    storeName in STORE_REGISTRY
      ? STORE_REGISTRY[storeName as keyof typeof STORE_REGISTRY]
      : undefined;
  if (!hook) {
    hook = listDynamicStores().find((d) => d.name === storeName)?.hook;
  }
  if (!hook) return [];

  let cursor: unknown;
  try {
    cursor = hook.getState();
  } catch {
    return [];
  }
  for (let i = 1; i < lockedSegments.length; i++) {
    if (cursor == null || typeof cursor !== "object") return [];
    cursor = (cursor as Record<string, unknown>)[lockedSegments[i]!];
  }
  if (cursor == null || typeof cursor !== "object") return [];

  const keys = Object.keys(cursor as Record<string, unknown>)
    // Skip function-typed entries — Zustand inlines `setX` actions
    // alongside state, and they're not bindable paths.
    .filter((k) => {
      const v = (cursor as Record<string, unknown>)[k];
      return typeof v !== "function";
    })
    // Skip keys starting with `_` — internal-only by convention.
    .filter((k) => !k.startsWith("_"))
    .filter((k) => k.toLowerCase().includes(filter.toLowerCase()))
    .sort();

  // Compose each suggestion back to the leading-segments form. So if
  // the user typed "scene.set" we return ["scene.settings"], etc.
  const headBody = lockedSegments.join(".");
  return keys.map((k) => `${headBody}.${k}`);
}

export function StorePathPicker({
  label,
  value,
  onChange,
  placeholder,
  inputId,
}: StorePathPickerProps): React.JSX.Element {
  const { prefix, body } = React.useMemo(() => splitPrefix(value), [value]);
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);

  const suggestions = React.useMemo(() => {
    if (!open) return [];
    return buildSuggestions(body).slice(0, 50);
  }, [open, body]);

  React.useEffect(() => {
    if (highlight >= suggestions.length) setHighlight(0);
  }, [highlight, suggestions.length]);

  const commit = React.useCallback(
    (nextBody: string) => {
      onChange(`${prefix}${nextBody}`);
    },
    [onChange, prefix],
  );

  const onSelect = React.useCallback(
    (nextBody: string) => {
      commit(nextBody + ".");
      setOpen(true);
      setHighlight(0);
    },
    [commit],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!open) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          setOpen(true);
          e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((h) =>
          suggestions.length === 0 ? 0 : (h + 1) % suggestions.length,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((h) =>
          suggestions.length === 0
            ? 0
            : (h - 1 + suggestions.length) % suggestions.length,
        );
      } else if (e.key === "Enter" || e.key === "Tab") {
        if (suggestions.length > 0) {
          e.preventDefault();
          onSelect(suggestions[highlight]!);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    },
    [open, suggestions, highlight, onSelect],
  );

  // Close when focus leaves the wrapper. Use blur-with-relatedTarget
  // check to allow clicks inside the dropdown to land before close.
  const onBlur = React.useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      if (!wrapperRef.current) return;
      const next = e.relatedTarget as Node | null;
      if (next && wrapperRef.current.contains(next)) return;
      setOpen(false);
    },
    [],
  );

  return (
    <label className="flex flex-col gap-1">
      {label !== undefined && <span className={FIELD_LABEL}>{label}</span>}
      <div
        ref={wrapperRef}
        className="relative"
        onBlur={onBlur}
      >
        <input
          id={inputId}
          type="text"
          className={FIELD_INPUT}
          value={value}
          placeholder={placeholder ?? "store.scene.settings.name"}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          data-testid="store-path-picker-input"
        />
        {open && suggestions.length > 0 && (
          <ul
            className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded border border-zinc-700 bg-zinc-950 shadow-lg"
            role="listbox"
            data-testid="store-path-picker-suggestions"
          >
            {suggestions.map((s, i) => (
              <li
                key={s}
                role="option"
                aria-selected={i === highlight}
                tabIndex={-1}
                className={[
                  "px-2 py-1 text-xs cursor-pointer",
                  i === highlight
                    ? "bg-amber-500/20 text-amber-100"
                    : "text-zinc-200 hover:bg-zinc-800",
                ].join(" ")}
                // Use mousedown — onClick after blur would close first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(s);
                }}
              >
                {prefix}
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    </label>
  );
}

export default StorePathPicker;
