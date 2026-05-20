// P3 prefabs batch migration. Moved from
// `apps/editor/src/views/prefabs/panels/ComponentEditorPanel.tsx` into
// the core-editor-pack with no behavioural changes — only the import
// paths flipped to pack-local `./prefabs-fixtures` and the shell-SDK
// externals. The pack-builder's `cardboard-react-externals` +
// `cardboard-shell-externals` plugins rewrite `react` and
// `@cardboard/editor-shell` imports into the host-populated global
// slots so the host React identity + host command-store are reused
// across the boundary.
//
// TODO: wire to selection store + entity store. For now the panel
// imports MOCK_ENTITIES[0] as if it were the currently-edited
// entity and keeps its component edits in local state (no persistence;
// expand/collapse state is the only thing that survives reload).
import React from "react";
import {
  ChevronDown,
  Image as ImageIcon,
  Lightbulb,
  Move,
  Music,
  Plus,
  Shapes,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
// Type-only — pack-builder erases at compile time.
import type { DockPanelDef } from "../../../../apps/editor/src/components/dock/DockShell";
import { Layers } from "lucide-react";
// Presentational primitives — safe to bundle (no singleton state, no
// host-side React Context to coordinate with).
import { Tooltip } from "../../../../apps/editor/src/components/ui/Tooltip";
import { NumberInput } from "../../../../apps/editor/src/components/ui/NumberInput";
import { TextInput } from "../../../../apps/editor/src/components/ui/TextInput";
import { ToggleSwitch } from "../../../../apps/editor/src/components/ui/controls";
// Externalised — `EmptyState` transitively imports a binary asset
// (`logo.png with { type: "file" }`) the pack-builder cannot resolve,
// so it ships via the SDK; `registerCommand` MUST run against the
// host's `useCommandStore` singleton so commands surface in the
// editor's command palette.
import { EmptyState, registerCommand } from "@cardboard/editor-shell";
import {
  COMPONENT_SCHEMAS,
  MOCK_ENTITIES,
  type ComponentInstance,
  type ComponentKind,
  type ComponentSchemaField,
  type EntityRow,
} from "./prefabs-fixtures";

/**
 * ComponentEditorPanel — schema-driven vertical stack of collapsible
 * component cards for the active entity.
 *
 * Visual target: the center-column body of `Editor Design/Entities.png`.
 * One card per ComponentInstance on the entity. Each card has:
 *   - Header bar: chevron (expand/collapse) + kind icon + uppercase
 *     name + enable ToggleSwitch + delete `×`.
 *   - Body (when expanded): one row per schema field, rendered with
 *     the appropriate control for `field.type` (slider, number,
 *     boolean, color, select, string).
 *
 * Header click (excluding toggle/delete) flips the expand state.
 *
 * Phase 2 sources its entity from `MOCK_ENTITIES[0]` and keeps all
 * field edits in local component state. Expand/collapse persists per
 * component kind via localStorage. Wave 3 wires both reads and writes
 * to the editor project store.
 *
 * Commands registered (one set per component instance on the entity):
 *   - `prefabs.component.toggleExpand.<kind>`   flips collapse state
 *   - `prefabs.component.toggleEnabled.<kind>`  flips enabled flag
 *   - `prefabs.component.delete.<kind>`         stub — console.log
 *
 * Plus a single static:
 *   - `prefabs.component.add`                   stub — console.log
 *
 * Responsive: a `ResizeObserver` drives two breakpoints. At ~200px the
 * per-row [label][control] grid stacks to two rows. Below 140px the
 * panel renders a "Resize panel" fallback.
 */

// ---------------------------------------------------------------------------
// Persistence

const LS_EXPANDED_KINDS = "cardboard.prefabs.componentEditor.expandedKinds";

const DEFAULT_EXPANDED: Record<string, boolean> = {
  light: true,
  sprite: true,
  movement: false,
  position: false,
};

function readExpandedLS(): Record<string, boolean> {
  try {
    if (typeof window === "undefined") return { ...DEFAULT_EXPANDED };
    const raw = window.localStorage.getItem(LS_EXPANDED_KINDS);
    if (!raw) return { ...DEFAULT_EXPANDED };
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      // Coerce values to boolean; merge over defaults so newly-added
      // kinds use their default expand state.
      const out: Record<string, boolean> = { ...DEFAULT_EXPANDED };
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        out[k] = Boolean(v);
      }
      return out;
    }
    return { ...DEFAULT_EXPANDED };
  } catch {
    return { ...DEFAULT_EXPANDED };
  }
}

function writeExpandedLS(value: Record<string, boolean>): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LS_EXPANDED_KINDS, JSON.stringify(value));
  } catch {
    /* ignore quota / private-mode failures */
  }
}

// ---------------------------------------------------------------------------
// Component-kind metadata

const KIND_ICON: Record<ComponentKind, LucideIcon> = {
  light: Lightbulb,
  sprite: ImageIcon,
  movement: Move,
  position: Shapes,
  audio: Music,
  collider: Shapes,
};

/** Width breakpoints — see top-of-file docblock for semantics. */
const NARROW_WIDTH_PX = 280;
const TINY_WIDTH_PX = 140;
/** Below this width the "Add Component" button collapses to icon-only. */
const ADD_BUTTON_COLLAPSE_PX = 240;

// ---------------------------------------------------------------------------
// Field row — renders a single ComponentSchemaField + current value.

interface FieldRowProps {
  field: ComponentSchemaField;
  value: unknown;
  onChange: (next: unknown) => void;
  /** Stack control under label rather than side-by-side. */
  stacked: boolean;
  disabled: boolean;
}

function FieldRow({ field, value, onChange, stacked, disabled }: FieldRowProps): React.JSX.Element {
  // Build the tooltip stages once per field — label + description sit
  // on the schema, so this is consistent across every field across
  // every component.
  const tooltipStages = [
    { delay: 1000, content: <span>{field.label}</span> },
    {
      delay: 3000,
      content: (
        <div>
          <div className="font-semibold">{field.label}</div>
          <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
            {field.description}
          </div>
        </div>
      ),
    },
  ];

  const control = renderControl(field, value, onChange, disabled, tooltipStages);

  return (
    <div
      className={
        stacked
          ? "flex flex-col gap-1"
          : "grid items-center gap-2 grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)]"
      }
    >
      <Tooltip
        side="top"
        stages={tooltipStages}
        wrapperClassName="inline-block min-w-0"
      >
        <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) truncate select-none">
          {field.label}
        </span>
      </Tooltip>
      <div className="min-w-0 w-full">{control}</div>
    </div>
  );
}

function renderControl(
  field: ComponentSchemaField,
  value: unknown,
  onChange: (next: unknown) => void,
  disabled: boolean,
  tooltipStages: { delay: number; content: React.ReactNode }[],
): React.ReactNode {
  switch (field.type) {
    case "slider": {
      const num =
        typeof value === "number" && Number.isFinite(value)
          ? value
          : Number(field.defaultValue ?? 0);
      const min = field.min ?? 0;
      const max = field.max ?? 1;
      const step = field.step ?? 0.01;
      // Display precision: derive from step so 0.01 → 2dp, 0.1 → 1dp.
      const precision = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
      // Inline gradient on the track — amber fill up to the thumb,
      // neutral track after. Mirrors the canonical Slider primitive
      // in `components/ui/controls.tsx` so values are visible without
      // squinting at a 1px line.
      const pct =
        max === min
          ? 0
          : Math.max(0, Math.min(100, ((num - min) / (max - min)) * 100));
      const trackStyle: React.CSSProperties = {
        background: `linear-gradient(to right, oklch(0.769 0.188 70.08) 0%, oklch(0.769 0.188 70.08) ${pct}%, rgba(255,255,255,0.08) ${pct}%, rgba(255,255,255,0.08) 100%)`,
      };
      return (
        <div className="flex items-center gap-2 min-w-0">
          <Tooltip
            side="top"
            stages={tooltipStages}
            wrapperClassName="flex-1 min-w-0 flex items-center [&>span]:w-full"
          >
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={num}
              disabled={disabled}
              aria-label={field.label}
              onChange={(e) => onChange(Number.parseFloat(e.target.value))}
              style={trackStyle}
              className="w-full accent-amber-500 cb-slider h-1.5 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Tooltip>
          <span className="shrink-0 inline-flex items-center justify-center min-w-[36px] h-5 px-1.5 text-[10px] font-mono rounded tabular-nums bg-amber-500/10 text-amber-300 border border-amber-500/30">
            {num.toFixed(precision)}
          </span>
        </div>
      );
    }
    case "number": {
      const num =
        typeof value === "number" && Number.isFinite(value)
          ? value
          : Number(field.defaultValue ?? 0);
      const precision =
        typeof field.step === "number" && field.step < 1
          ? field.step >= 0.1
            ? 1
            : 2
          : 0;
      return (
        <Tooltip
          side="top"
          stages={tooltipStages}
          wrapperClassName="block w-full"
        >
          <span className="block w-full">
            <NumberInput
              value={num}
              onChange={(next) => onChange(next)}
              min={field.min}
              max={field.max}
              step={field.step ?? 1}
              precision={precision}
              disabled={disabled}
              aria-label={field.label}
            />
          </span>
        </Tooltip>
      );
    }
    case "boolean": {
      const checked = Boolean(value ?? field.defaultValue);
      return (
        <div className="flex items-center justify-start">
          <Tooltip side="top" stages={tooltipStages}>
            <span className="inline-flex">
              <ToggleSwitch
                checked={checked}
                onChange={(next) => onChange(next)}
                disabled={disabled}
                size="sm"
                aria-label={field.label}
              />
            </span>
          </Tooltip>
        </div>
      );
    }
    case "color": {
      const hex =
        typeof value === "string" ? value : String(field.defaultValue ?? "#ffffff");
      return (
        <Tooltip side="top" stages={tooltipStages}>
          <label
            className={[
              "inline-flex items-center gap-2 cursor-pointer",
              "rounded border border-(--color-border-strong) bg-zinc-950/60 px-2 py-1",
              "hover:border-amber-500/60 transition-colors",
              "focus-within:ring-2 focus-within:ring-amber-400",
              disabled ? "opacity-50 cursor-not-allowed" : "",
            ].join(" ")}
          >
            <span
              className="relative inline-block w-4 h-4 rounded-sm border border-(--color-border)"
              style={{ background: hex }}
            >
              <input
                type="color"
                value={hex}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer disabled:cursor-not-allowed"
                aria-label={field.label}
              />
            </span>
            <span className="text-[10px] font-mono uppercase text-(--color-fg-secondary) tabular-nums truncate">
              {hex}
            </span>
          </label>
        </Tooltip>
      );
    }
    case "select": {
      const current =
        typeof value === "string"
          ? value
          : String(field.defaultValue ?? field.options?.[0] ?? "");
      const opts = field.options ?? [];
      return (
        <Tooltip side="top" stages={tooltipStages} wrapperClassName="block w-full">
          <span className="block w-full">
            <div className="relative">
              <select
                value={current}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                aria-label={field.label}
                className={[
                  "appearance-none w-full rounded border border-(--color-border-strong)",
                  "bg-zinc-950/60 text-(--color-fg-primary) text-xs",
                  "pl-2 pr-5 h-7 leading-none",
                  "focus:outline-none focus:border-amber-500/80",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                ].join(" ")}
              >
                {opts.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={10}
                aria-hidden="true"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-(--color-fg-muted)"
              />
            </div>
          </span>
        </Tooltip>
      );
    }
    case "string": {
      const text =
        typeof value === "string" ? value : String(field.defaultValue ?? "");
      return (
        <Tooltip side="top" stages={tooltipStages} wrapperClassName="block w-full">
          <span className="block w-full">
            <TextInput
              value={text}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              aria-label={field.label}
            />
          </span>
        </Tooltip>
      );
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Component card

interface ComponentCardProps {
  component: ComponentInstance;
  expanded: boolean;
  stacked: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onFieldChange: (fieldKey: string, value: unknown) => void;
}

function ComponentCard(props: ComponentCardProps): React.JSX.Element {
  const {
    component,
    expanded,
    stacked,
    onToggleExpand,
    onToggleEnabled,
    onDelete,
    onFieldChange,
  } = props;

  const schema = COMPONENT_SCHEMAS[component.kind];
  const Icon = KIND_ICON[component.kind] ?? Shapes;

  const headerStages = [
    {
      delay: 1000,
      content: <span>{expanded ? "Collapse" : "Expand"} {schema.name}</span>,
    },
    {
      delay: 3000,
      content: (
        <div>
          <div className="font-semibold">{schema.name} component</div>
          <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
            {schema.description}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div
      data-component-kind={component.kind}
      className={[
        "rounded border border-(--color-border-strong)",
        "bg-(--color-surface-raised)",
        "overflow-hidden",
      ].join(" ")}
    >
      {/* Header bar — full row is the expand/collapse hit target. The
          enable toggle + delete sit on top and stop click propagation
          so they don't double-fire. */}
      <Tooltip side="top" stages={headerStages} wrapperClassName="block w-full">
        <div
          role="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${schema.name} component`}
          onClick={onToggleExpand}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onToggleExpand();
            }
          }}
          className={[
            "flex items-center gap-1.5 px-2 h-8 select-none cursor-pointer",
            "bg-zinc-900/80 hover:bg-zinc-900 transition-colors",
            "border-b border-(--color-border)",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
          ].join(" ")}
        >
          <ChevronDown
            size={12}
            className={[
              "shrink-0 text-(--color-fg-secondary) transition-transform",
              expanded ? "rotate-0" : "-rotate-90",
            ].join(" ")}
            aria-hidden="true"
          />
          <Icon
            size={12}
            className="shrink-0 text-amber-500"
            aria-hidden="true"
          />
          <span className="flex-1 min-w-0 text-[11px] uppercase tracking-wider font-semibold text-(--color-fg-primary) truncate">
            {schema.name}
          </span>

          {/* Enable toggle. Stop propagation so toggling doesn't also
              expand/collapse the card. */}
          <Tooltip
            side="top"
            stages={[
              {
                delay: 1000,
                content: (
                  <span>
                    {component.enabled ? "Disable" : "Enable"} component
                  </span>
                ),
              },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">
                      {component.enabled ? "Disable" : "Enable"} {schema.name}
                    </div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Toggles whether this component runs without removing it
                      from the entity. Disabled components grey out.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <span
              className="inline-flex shrink-0"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <ToggleSwitch
                checked={component.enabled}
                onChange={() => onToggleEnabled()}
                size="sm"
                aria-label={`${component.enabled ? "Disable" : "Enable"} ${schema.name} component`}
              />
            </span>
          </Tooltip>

          {/* Delete `×`. */}
          <Tooltip
            side="top"
            stages={[
              { delay: 1000, content: <span>Delete component</span> },
              {
                delay: 3000,
                content: (
                  <div>
                    <div className="font-semibold">Delete {schema.name}</div>
                    <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                      Removes this component from the entity. The action
                      can be undone from the command palette.
                    </div>
                  </div>
                ),
              },
            ]}
          >
            <button
              type="button"
              aria-label={`Delete ${schema.name} component`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className={[
                "shrink-0 h-5 w-5 rounded inline-flex items-center justify-center",
                "text-(--color-fg-muted) hover:text-red-400 hover:bg-zinc-800",
                "transition-colors",
              ].join(" ")}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
      </Tooltip>

      {/* Body — only mounted when expanded. Disabled components fade
          their body to 60% opacity to mirror the global disabled
          treatment used elsewhere in the editor. */}
      {expanded && (
        <div
          className={[
            "flex flex-col gap-2 p-2",
            component.enabled ? "" : "opacity-60",
          ].join(" ")}
        >
          {schema.fields.map((field) => (
            <FieldRow
              key={field.key}
              field={field}
              value={component.data[field.key]}
              onChange={(next) => onFieldChange(field.key, next)}
              stacked={stacked}
              disabled={!component.enabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel

export function ComponentEditorPanel(): React.JSX.Element {
  // Wave 3 swaps this for a selection-store read. Today the panel
  // always shows the first entity from the mock fixture.
  const initial = MOCK_ENTITIES[0];
  const [components, setComponents] = React.useState<ComponentInstance[]>(() =>
    initial.components.map((c) => ({
      ...c,
      data: { ...c.data },
    })),
  );

  const [expandedByKind, setExpandedByKind] = React.useState<
    Record<string, boolean>
  >(() => readExpandedLS());

  React.useEffect(() => {
    writeExpandedLS(expandedByKind);
  }, [expandedByKind]);

  // Container width tracking for responsive layout.
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = React.useState<number>(NARROW_WIDTH_PX + 1);
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(Math.round(entry.contentRect.width));
      }
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setWidth(Math.round(rect.width));
    return () => ro.disconnect();
  }, []);
  const narrow = width > 0 && width < NARROW_WIDTH_PX;
  const tooNarrow = width > 0 && width < TINY_WIDTH_PX;
  const collapseAddButton = width > 0 && width < ADD_BUTTON_COLLAPSE_PX;

  // ────────────────────────────────────────────────────────────────
  // Canonical handlers — single source of truth shared by the UI
  // event handlers and the registered commands. Mirrors the pattern
  // in BrushPanel / LightingPanel / EntityListPanel.

  const handleToggleExpand = React.useCallback((kind: ComponentKind) => {
    setExpandedByKind((prev) => ({
      ...prev,
      [kind]: !(prev[kind] ?? DEFAULT_EXPANDED[kind] ?? false),
    }));
  }, []);

  const handleToggleEnabled = React.useCallback((kind: ComponentKind) => {
    setComponents((prev) =>
      prev.map((c) =>
        c.kind === kind ? { ...c, enabled: !c.enabled } : c,
      ),
    );
  }, []);

  const handleDelete = React.useCallback((kind: ComponentKind) => {
    // Wave 3: route through entity-store mutation. For now keep the
    // delete behaviour visible in devtools so the command palette
    // entries are clearly hooked up.
    // eslint-disable-next-line no-console
    console.log(`[ComponentEditorPanel] delete component: ${kind}`);
  }, []);

  const handleAddComponent = React.useCallback(() => {
    // Wave 3: open a kind-picker dropdown. Stub for the Phase 2 wave.
    // eslint-disable-next-line no-console
    console.log("[ComponentEditorPanel] add component (stub)");
  }, []);

  const handleFieldChange = React.useCallback(
    (kind: ComponentKind, fieldKey: string, value: unknown) => {
      setComponents((prev) =>
        prev.map((c) =>
          c.kind === kind
            ? { ...c, data: { ...c.data, [fieldKey]: value } }
            : c,
        ),
      );
    },
    [],
  );

  // ────────────────────────────────────────────────────────────────
  // Command-registry refs — keep handlers fresh without re-running
  // the registration effect on every render.

  const toggleExpandRef = React.useRef(handleToggleExpand);
  const toggleEnabledRef = React.useRef(handleToggleEnabled);
  const deleteRef = React.useRef(handleDelete);
  const addRef = React.useRef(handleAddComponent);

  React.useEffect(() => {
    toggleExpandRef.current = handleToggleExpand;
  }, [handleToggleExpand]);
  React.useEffect(() => {
    toggleEnabledRef.current = handleToggleEnabled;
  }, [handleToggleEnabled]);
  React.useEffect(() => {
    deleteRef.current = handleDelete;
  }, [handleDelete]);
  React.useEffect(() => {
    addRef.current = handleAddComponent;
  }, [handleAddComponent]);

  // Static "Add Component" command — single registration on mount.
  React.useEffect(() => {
    const unreg = registerCommand({
      id: "prefabs.component.add",
      title: "Add Component…",
      category: "Component",
      keywords: ["component", "add", "new", "create"],
      description:
        "Adds a new component to the active entity. Opens a picker for the component kind.",
      icon: <Plus size={14} />,
      run: () => addRef.current(),
    });
    return unreg;
  }, []);

  // Dynamic per-component commands. Re-registers whenever the
  // component list shape changes (add/delete/reorder). Today the
  // list is stable but the effect is keyed defensively for Wave 3.
  React.useEffect(() => {
    const unregs: Array<() => void> = [];
    for (const c of components) {
      const schema = COMPONENT_SCHEMAS[c.kind];
      const name = schema.name;
      unregs.push(
        registerCommand({
          id: `prefabs.component.toggleExpand.${c.kind}`,
          title: `Toggle Component Section: ${name}`,
          category: "Component",
          keywords: ["component", "expand", "collapse", "toggle", c.kind, name],
          description: `Expands or collapses the ${name} component card.`,
          run: () => toggleExpandRef.current(c.kind),
        }),
      );
      unregs.push(
        registerCommand({
          id: `prefabs.component.toggleEnabled.${c.kind}`,
          title: `Toggle Component: ${name}`,
          category: "Component",
          keywords: ["component", "enable", "disable", "toggle", c.kind, name],
          description: `Enables or disables the ${name} component on the active entity.`,
          run: () => toggleEnabledRef.current(c.kind),
        }),
      );
      unregs.push(
        registerCommand({
          id: `prefabs.component.delete.${c.kind}`,
          title: `Delete Component: ${name}`,
          category: "Component",
          keywords: ["component", "delete", "remove", c.kind, name],
          description: `Removes the ${name} component from the active entity.`,
          run: () => deleteRef.current(c.kind),
        }),
      );
    }
    return () => {
      for (const u of unregs) u();
    };
    // We key on the list of kinds — once Wave 3 lets the user add or
    // remove components this re-registers cleanly. Kinds are unique
    // per-entity in the fixture today.
  }, [components.map((c) => c.kind).join("|")]);

  // ────────────────────────────────────────────────────────────────
  // Render

  return (
    <div
      ref={rootRef}
      data-panel="component-editor"
      // `data-tutorial-id="component-editor"` anchors the built-in
      // `prefabs-intro` walkthrough's "edit components here" step.
      data-tutorial-id="component-editor"
      className="h-full w-full flex flex-col gap-1.5 overflow-y-auto overflow-x-hidden"
    >
      {tooNarrow ? (
        <div className="flex items-center justify-center h-full text-[10px] text-(--color-fg-muted) text-center px-2">
          Resize panel
        </div>
      ) : (
        <>
          {/* Panel-level toolbar — eyebrow on the left, add-component
              on the right. Mirrors the EntityHeaderPanel "EDIT ENTITY"
              + "Edit Entity" toolbar row directly above. */}
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="text-[10px] uppercase tracking-wider text-(--color-fg-muted) truncate">
              Components
            </span>
            <Tooltip
              side="left"
              stages={[
                { delay: 1000, content: <span>Add component</span> },
                {
                  delay: 3000,
                  content: (
                    <div>
                      <div className="font-semibold">Add Component</div>
                      <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                        Adds a new component (light, sprite, movement, position,
                        audio, collider, …) to the active entity.
                      </div>
                    </div>
                  ),
                },
              ]}
            >
              <button
                type="button"
                aria-label="Add component"
                onClick={handleAddComponent}
                className={[
                  "shrink min-w-0 inline-flex items-center gap-1 h-6 rounded",
                  collapseAddButton ? "px-1.5 justify-center" : "px-2",
                  "text-[10px] uppercase tracking-wider font-semibold",
                  "border border-(--color-border-strong) text-(--color-fg-secondary)",
                  "hover:border-amber-500/60 hover:text-amber-300 transition-colors",
                ].join(" ")}
              >
                <Plus size={12} aria-hidden="true" />
                {!collapseAddButton && (
                  <span className="truncate">Add Component</span>
                )}
              </button>
            </Tooltip>
          </div>

          {/* Card stack — or empty state when the entity has no
              components yet. */}
          {components.length === 0 ? (
            <div className="flex-1 flex items-center justify-center min-w-0">
              <EmptyState
                icon={<Layers size={28} />}
                title="No components"
                description="This entity has no components yet. Click + Add Component to start."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 min-w-0">
              {components.map((c) => (
                <ComponentCard
                  key={c.id}
                  component={c}
                  expanded={
                    expandedByKind[c.kind] ?? DEFAULT_EXPANDED[c.kind] ?? false
                  }
                  stacked={narrow}
                  onToggleExpand={() => handleToggleExpand(c.kind)}
                  onToggleEnabled={() => handleToggleEnabled(c.kind)}
                  onDelete={() => handleDelete(c.kind)}
                  onFieldChange={(fieldKey, value) =>
                    handleFieldChange(c.kind, fieldKey, value)
                  }
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Re-export ComponentInstance / EntityRow types as a side-channel so
// downstream code (Wave 3) can import them via the panel module if
// needed. Avoids a second import path during the refactor.
export type { ComponentInstance, EntityRow };

export const MANIFEST: Pick<DockPanelDef, "id" | "title" | "icon" | "category"> = {
  id: "component-editor",
  title: "Components",
  category: "Inspector",
  icon: <Layers size={12} />,
};

export default ComponentEditorPanel;
