/**
 * NodeInspector — JSON Visual Builder VB3 property inspector.
 *
 * Renders a schema-driven form for the selected `NodeSpec`. Each node
 * type has a hand-rolled `<XxxInspector>` component below — the
 * dispatch happens in `NodeInspector` via a switch on `node.type`. The
 * forms read from the live node + write back through
 * `usePanelBuilderStore.updateNode(id, patch)`.
 *
 * Form pattern: every field is a small JSX wrapper around a native
 * `<input>` / `<select>` styled to match the editor's zinc-palette.
 * The pack doesn't reach into the shell's `<TextInput>` / `<Select>`
 * primitives because the inspector lives at the canvas-author
 * surface — its inputs target editing the AUTHORED spec, not editing
 * runtime store state. Routing through the shell primitives would
 * mix the two surfaces and bind the inspector to whatever the
 * primitives' look becomes; a few lines of bespoke styling keep
 * inspector-ness explicit.
 *
 * Bind-path and script-ref fields are plain text inputs in VB3 — the
 * autocomplete picker arrives in VB5. The user can still type any
 * binding path and the renderer will resolve it at preview time.
 */

import React from "react";
import type {
  ButtonNode,
  CanvasNode,
  ConditionalNode,
  HeadingNode,
  IconNode,
  InputNode,
  LayoutNode,
  NodeSpec,
  NumberInputNode,
  RenderSpecNode,
  ScrollRowNode,
  SelectNode,
  SliderNode,
  SpacerNode,
  StorePath,
  TextNode,
  ToggleButtonNode,
  TooltipNode,
  TooltipStageSpec,
} from "../../../apps/editor/src/panel-renderer/types";
import { StorePathPicker } from "./StorePathPicker";
import { ScriptRefPicker } from "./ScriptRefPicker";

// ---------------------------------------------------------------------------
// Small form primitives — bespoke to the inspector so the styling stays
// localised. Each emits an inline-label + input pair sized for the
// 288px right pane.
// ---------------------------------------------------------------------------

const FIELD_LABEL = "text-[10px] uppercase tracking-wider text-zinc-500";
const FIELD_INPUT =
  "w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs " +
  "text-zinc-100 focus:border-amber-500/80 focus:outline-none";

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      <input
        type="text"
        className={FIELD_INPUT}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      <input
        type="number"
        className={FIELD_INPUT}
        value={value ?? ""}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") onChange(undefined);
          else {
            const n = Number(raw);
            if (Number.isFinite(n)) onChange(n);
          }
        }}
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T | undefined;
  onChange: (next: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}): React.JSX.Element {
  return (
    <label className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      <select
        className={FIELD_INPUT}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value as T)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CheckboxField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean | undefined;
  onChange: (next: boolean) => void;
}): React.JSX.Element {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="accent-amber-500"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-xs text-zinc-300">{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Per-node inspectors. Each takes the typed node + an `onPatch` callback
// the store wires to `updateNode(id, patch)`.
// ---------------------------------------------------------------------------

type Patcher<N extends NodeSpec> = (patch: Partial<N>) => void;

function LayoutInspector({
  node,
  onPatch,
}: {
  node: LayoutNode;
  onPatch: Patcher<LayoutNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Direction"
        value={node.direction}
        onChange={(v) => onPatch({ direction: v as LayoutNode["direction"] })}
        options={[
          { value: "column", label: "column" },
          { value: "row", label: "row" },
          { value: "grid", label: "grid" },
        ]}
      />
      <NumberField
        label="Gap"
        value={node.gap}
        onChange={(v) => onPatch({ gap: v })}
        min={0}
      />
      <NumberField
        label="Padding"
        value={node.padding}
        onChange={(v) => onPatch({ padding: v })}
        min={0}
      />
      <SelectField
        label="Align"
        value={node.align ?? ""}
        onChange={(v) =>
          onPatch({ align: (v || undefined) as LayoutNode["align"] })
        }
        options={[
          { value: "", label: "(default)" },
          { value: "start", label: "start" },
          { value: "center", label: "center" },
          { value: "end", label: "end" },
          { value: "stretch", label: "stretch" },
          { value: "baseline", label: "baseline" },
        ]}
      />
      <SelectField
        label="Justify"
        value={node.justify ?? ""}
        onChange={(v) =>
          onPatch({ justify: (v || undefined) as LayoutNode["justify"] })
        }
        options={[
          { value: "", label: "(default)" },
          { value: "start", label: "start" },
          { value: "center", label: "center" },
          { value: "between", label: "between" },
          { value: "end", label: "end" },
          { value: "around", label: "around" },
        ]}
      />
    </div>
  );
}

function HeadingInspector({
  node,
  onPatch,
}: {
  node: HeadingNode;
  onPatch: Patcher<HeadingNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Text (or $store.path)"
        value={node.text}
        onChange={(v) => onPatch({ text: v as string | StorePath })}
      />
      <SelectField
        label="Level"
        value={String(node.level ?? 2) as "1" | "2" | "3" | "4"}
        onChange={(v) =>
          onPatch({ level: Number(v) as HeadingNode["level"] })
        }
        options={[
          { value: "1", label: "h1" },
          { value: "2", label: "h2" },
          { value: "3", label: "h3" },
          { value: "4", label: "h4" },
        ]}
      />
    </div>
  );
}

function TextInspector({
  node,
  onPatch,
}: {
  node: TextNode;
  onPatch: Patcher<TextNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Text (or $store.path)"
        value={node.text}
        onChange={(v) => onPatch({ text: v as string | StorePath })}
      />
      <SelectField
        label="Variant"
        value={node.variant ?? "default"}
        onChange={(v) => onPatch({ variant: v as TextNode["variant"] })}
        options={[
          { value: "default", label: "default" },
          { value: "muted", label: "muted" },
          { value: "label", label: "label" },
          { value: "value", label: "value" },
        ]}
      />
      <CheckboxField
        label="Truncate"
        value={node.truncate}
        onChange={(v) => onPatch({ truncate: v })}
      />
    </div>
  );
}

function InputInspector({
  node,
  onPatch,
}: {
  node: InputNode;
  onPatch: Patcher<InputNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="Bind (store path)"
        value={node.bind}
        onChange={(v) => onPatch({ bind: v as StorePath })}
        placeholder="store.scene.settings.name"
      />
      <TextField
        label="Label"
        value={node.label ?? ""}
        onChange={(v) => onPatch({ label: v || undefined })}
      />
      <TextField
        label="Placeholder"
        value={node.placeholder ?? ""}
        onChange={(v) => onPatch({ placeholder: v || undefined })}
      />
    </div>
  );
}

function NumberInputInspector({
  node,
  onPatch,
}: {
  node: NumberInputNode;
  onPatch: Patcher<NumberInputNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="Bind (store path)"
        value={node.bind}
        onChange={(v) => onPatch({ bind: v as StorePath })}
      />
      <NumberField
        label="Min"
        value={node.min}
        onChange={(v) => onPatch({ min: v })}
      />
      <NumberField
        label="Max"
        value={node.max}
        onChange={(v) => onPatch({ max: v })}
      />
      <NumberField
        label="Step"
        value={node.step}
        onChange={(v) => onPatch({ step: v })}
      />
      <TextField
        label="Label"
        value={node.label ?? ""}
        onChange={(v) => onPatch({ label: v || undefined })}
      />
      <TextField
        label="Unit"
        value={node.unit ?? ""}
        onChange={(v) => onPatch({ unit: v || undefined })}
      />
      <CheckboxField
        label="Show steppers"
        value={node.showSteppers}
        onChange={(v) => onPatch({ showSteppers: v })}
      />
    </div>
  );
}

function SliderInspector({
  node,
  onPatch,
}: {
  node: SliderNode;
  onPatch: Patcher<SliderNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="Bind (store path)"
        value={node.bind}
        onChange={(v) => onPatch({ bind: v as StorePath })}
      />
      <NumberField
        label="Min"
        value={node.min}
        onChange={(v) => onPatch({ min: v ?? 0 })}
      />
      <NumberField
        label="Max"
        value={node.max}
        onChange={(v) => onPatch({ max: v ?? 100 })}
      />
      <NumberField
        label="Step"
        value={node.step}
        onChange={(v) => onPatch({ step: v })}
      />
    </div>
  );
}

function ButtonInspector({
  node,
  onPatch,
}: {
  node: ButtonNode;
  onPatch: Patcher<ButtonNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Text"
        value={node.text ?? ""}
        onChange={(v) => onPatch({ text: v })}
      />
      <ScriptRefPicker
        label="onClick script id"
        value={node.onClick.script}
        onChange={(v) => onPatch({ onClick: { ...node.onClick, script: v } })}
        placeholder="selection.clear"
      />
      <SelectField
        label="Variant"
        value={node.variant ?? "secondary"}
        onChange={(v) => onPatch({ variant: v as ButtonNode["variant"] })}
        options={[
          { value: "primary", label: "primary" },
          { value: "secondary", label: "secondary" },
          { value: "ghost", label: "ghost" },
          { value: "danger", label: "danger" },
          { value: "success", label: "success" },
        ]}
      />
      <TextField
        label="Icon (lucide name)"
        value={node.icon ?? ""}
        onChange={(v) => onPatch({ icon: v || undefined })}
      />
      <SelectField
        label="Shape"
        value={node.shape ?? "default"}
        onChange={(v) => onPatch({ shape: v as ButtonNode["shape"] })}
        options={[
          { value: "default", label: "default" },
          { value: "icon", label: "icon" },
        ]}
      />
    </div>
  );
}

function ToggleButtonInspector({
  node,
  onPatch,
}: {
  node: ToggleButtonNode;
  onPatch: Patcher<ToggleButtonNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="Bind"
        value={node.bind}
        onChange={(v) => onPatch({ bind: v as StorePath })}
      />
      <TextField
        label="Active value"
        value={
          node.activeValue == null ? "" : String(node.activeValue)
        }
        onChange={(v) => onPatch({ activeValue: v || undefined })}
      />
      <TextField
        label="Text"
        value={node.text}
        onChange={(v) => onPatch({ text: v })}
      />
      <TextField
        label="Icon (lucide name)"
        value={node.icon ?? ""}
        onChange={(v) => onPatch({ icon: v || undefined })}
      />
      <SelectField
        label="Shape"
        value={node.shape ?? "tile"}
        onChange={(v) =>
          onPatch({ shape: v as ToggleButtonNode["shape"] })
        }
        options={[
          { value: "tile", label: "tile" },
          { value: "chip", label: "chip" },
          { value: "tag", label: "tag" },
        ]}
      />
      <ScriptRefPicker
        label="onClick script id"
        value={node.onClick.script}
        onChange={(v) => onPatch({ onClick: { ...node.onClick, script: v } })}
      />
    </div>
  );
}

function SpacerInspector({
  node,
  onPatch,
}: {
  node: SpacerNode;
  onPatch: Patcher<SpacerNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <NumberField
        label="Size"
        value={node.size}
        onChange={(v) => onPatch({ size: v })}
        min={0}
      />
    </div>
  );
}

function ConditionalInspector({
  node,
  onPatch,
}: {
  node: ConditionalNode;
  onPatch: Patcher<ConditionalNode>;
}): React.JSX.Element {
  // `equals` accepts string | number | boolean | null. Treat it as
  // free-form string in the inspector — null gets the literal "null"
  // round-trip the user can clear.
  const equalsValue =
    node.equals === undefined
      ? ""
      : node.equals === null
        ? "null"
        : String(node.equals);
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="When (binding)"
        value={node.when}
        onChange={(v) => onPatch({ when: v as StorePath })}
      />
      <TextField
        label="Equals (literal)"
        value={equalsValue}
        onChange={(v) => {
          if (v === "") onPatch({ equals: undefined });
          else if (v === "null") onPatch({ equals: null });
          else if (v === "true") onPatch({ equals: true });
          else if (v === "false") onPatch({ equals: false });
          else if (/^-?\d+(?:\.\d+)?$/.test(v))
            onPatch({ equals: Number(v) });
          else onPatch({ equals: v });
        }}
      />
      <CheckboxField
        label="Non-empty (array/string)"
        value={node.notEmpty}
        onChange={(v) => onPatch({ notEmpty: v })}
      />
    </div>
  );
}

function TooltipInspector({
  node,
  onPatch,
}: {
  node: TooltipNode;
  onPatch: Patcher<TooltipNode>;
}): React.JSX.Element {
  const updateStage = React.useCallback(
    (idx: number, partial: Partial<TooltipStageSpec>): void => {
      const stages = node.stages.slice();
      const existing = stages[idx];
      if (!existing) return;
      stages[idx] = { ...existing, ...partial };
      onPatch({ stages });
    },
    [node.stages, onPatch],
  );

  const updateStageText = React.useCallback(
    (idx: number, text: string): void => {
      const stages = node.stages.slice();
      const existing = stages[idx];
      if (!existing) return;
      // Update the stage content's `text` field IF the content is a
      // Text/Heading node — most stages authored via the inspector
      // are simple text labels. Anything more complex (Layouts) the
      // user edits via JSON-mode.
      const content = existing.content;
      if (content.type === "Text" || content.type === "Heading") {
        stages[idx] = {
          ...existing,
          content: { ...content, text } as typeof content,
        };
        onPatch({ stages });
      }
    },
    [node.stages, onPatch],
  );

  const addStage = React.useCallback((): void => {
    const lastDelay =
      node.stages.length > 0 ? node.stages[node.stages.length - 1]!.delay : 0;
    const stages: TooltipStageSpec[] = [
      ...node.stages,
      {
        delay: lastDelay + 300,
        content: { type: "Text", text: "New stage" },
      },
    ];
    onPatch({ stages });
  }, [node.stages, onPatch]);

  const removeStage = React.useCallback(
    (idx: number): void => {
      const stages = node.stages.slice();
      stages.splice(idx, 1);
      onPatch({ stages });
    },
    [node.stages, onPatch],
  );

  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label="Side"
        value={node.side ?? "top"}
        onChange={(v) => onPatch({ side: v as TooltipNode["side"] })}
        options={[
          { value: "top", label: "top" },
          { value: "bottom", label: "bottom" },
          { value: "left", label: "left" },
          { value: "right", label: "right" },
        ]}
      />
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className={FIELD_LABEL}>Stages</span>
          <button
            type="button"
            onClick={addStage}
            className="text-[10px] rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-zinc-300 hover:bg-zinc-800"
          >
            + Add
          </button>
        </div>
        {node.stages.length === 0 ? (
          <div className="text-[10px] text-zinc-500 italic">
            No stages — click + Add.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {node.stages.map((stage, idx) => {
              const content = stage.content;
              const textValue =
                content.type === "Text" || content.type === "Heading"
                  ? typeof content.text === "string"
                    ? content.text
                    : ""
                  : null;
              return (
                <li
                  key={idx}
                  className="rounded border border-zinc-800 bg-zinc-950/60 p-2 flex flex-col gap-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-zinc-500">
                      Stage {idx + 1} ({content.type})
                    </span>
                    <button
                      type="button"
                      onClick={() => removeStage(idx)}
                      className="text-[10px] text-rose-400 hover:text-rose-300"
                      aria-label={`Remove stage ${idx + 1}`}
                    >
                      Remove
                    </button>
                  </div>
                  <NumberField
                    label="Delay (ms)"
                    value={stage.delay}
                    onChange={(v) => updateStage(idx, { delay: v ?? 0 })}
                    min={0}
                    step={50}
                  />
                  {textValue !== null ? (
                    <TextField
                      label="Content text"
                      value={textValue}
                      onChange={(v) => updateStageText(idx, v)}
                    />
                  ) : (
                    <div className="text-[10px] text-zinc-500 italic">
                      Non-text content — edit via JSON-mode.
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function IconInspector({
  node,
  onPatch,
}: {
  node: IconNode;
  onPatch: Patcher<IconNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Name (lucide)"
        value={node.name}
        onChange={(v) => onPatch({ name: v })}
      />
      <NumberField
        label="Size (px)"
        value={node.size}
        onChange={(v) => onPatch({ size: v })}
        min={4}
      />
    </div>
  );
}

function ScrollRowInspector({
  node,
  onPatch,
}: {
  node: ScrollRowNode;
  onPatch: Patcher<ScrollRowNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Content class"
        value={node.contentClassName ?? ""}
        onChange={(v) => onPatch({ contentClassName: v || undefined })}
      />
      <TextField
        label="Outer class"
        value={node.className ?? ""}
        onChange={(v) => onPatch({ className: v || undefined })}
      />
    </div>
  );
}

function SelectInspector({
  node,
  onPatch,
}: {
  node: SelectNode;
  onPatch: Patcher<SelectNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="Bind"
        value={node.bind}
        onChange={(v) => onPatch({ bind: v as StorePath })}
      />
      <TextField
        label="Label"
        value={node.label ?? ""}
        onChange={(v) => onPatch({ label: v || undefined })}
      />
      <SelectField
        label="Options source"
        value={node.optionsFrom ?? ""}
        onChange={(v) =>
          onPatch({
            optionsFrom: (v || undefined) as SelectNode["optionsFrom"],
          })
        }
        options={[
          { value: "", label: "(static / none)" },
          { value: "layers", label: "layers" },
        ]}
      />
    </div>
  );
}

function CanvasInspector({
  node,
  onPatch,
}: {
  node: CanvasNode;
  onPatch: Patcher<CanvasNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Ref name"
        value={node.refName}
        onChange={(v) => onPatch({ refName: v })}
      />
      <NumberField
        label="Height (px)"
        value={node.heightPx}
        onChange={(v) => onPatch({ heightPx: v })}
        min={1}
      />
    </div>
  );
}

function RenderSpecInspector({
  node,
  onPatch,
}: {
  node: RenderSpecNode;
  onPatch: Patcher<RenderSpecNode>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <StorePathPicker
        label="From (binding)"
        value={node.from}
        onChange={(v) => onPatch({ from: v as StorePath })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export interface NodeInspectorProps {
  /** The selected node. Null when nothing is selected — caller should
   *  render the empty state instead. */
  node: NodeSpec;
  /** Selected id — forwarded to `onUpdate` calls. */
  nodeId: string;
  /** Patch callback. The store wires this to `updateNode(nodeId, patch)`. */
  onUpdate: (nodeId: string, patch: Partial<NodeSpec>) => void;
  /** Delete callback. The Inspector renders a "Delete" button at the
   *  bottom of the form. */
  onDelete: (nodeId: string) => void;
}

export function NodeInspector({
  node,
  nodeId,
  onUpdate,
  onDelete,
}: NodeInspectorProps): React.JSX.Element {
  // Build a per-node patcher with stable identity per (nodeId, node.type)
  // so child inputs don't re-render on every keystroke from another field.
  const patch = React.useCallback(
    <N extends NodeSpec>(p: Partial<N>) => onUpdate(nodeId, p as Partial<NodeSpec>),
    [nodeId, onUpdate],
  );

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[11px] uppercase tracking-wider text-zinc-400">
          {node.type}
        </div>
        <div className="text-[9px] text-zinc-600 truncate" title={nodeId}>
          {nodeId}
        </div>
      </div>
      {renderForm(node, patch)}
      {nodeId !== "root" && (
        <button
          type="button"
          className="mt-2 self-start rounded border border-red-700/60 bg-red-950/40 px-2 py-1 text-xs text-red-300 hover:bg-red-900/40"
          onClick={() => onDelete(nodeId)}
        >
          Delete node
        </button>
      )}
    </div>
  );
}

function renderForm(
  node: NodeSpec,
  patch: <N extends NodeSpec>(p: Partial<N>) => void,
): React.JSX.Element {
  switch (node.type) {
    case "Layout":
      return <LayoutInspector node={node} onPatch={patch} />;
    case "Heading":
      return <HeadingInspector node={node} onPatch={patch} />;
    case "Text":
      return <TextInspector node={node} onPatch={patch} />;
    case "Input":
      return <InputInspector node={node} onPatch={patch} />;
    case "NumberInput":
      return <NumberInputInspector node={node} onPatch={patch} />;
    case "Slider":
      return <SliderInspector node={node} onPatch={patch} />;
    case "Button":
      return <ButtonInspector node={node} onPatch={patch} />;
    case "ToggleButton":
      return <ToggleButtonInspector node={node} onPatch={patch} />;
    case "Spacer":
      return <SpacerInspector node={node} onPatch={patch} />;
    case "Conditional":
      return <ConditionalInspector node={node} onPatch={patch} />;
    case "Tooltip":
      return <TooltipInspector node={node} onPatch={patch} />;
    case "Icon":
      return <IconInspector node={node} onPatch={patch} />;
    case "ScrollRow":
      return <ScrollRowInspector node={node} onPatch={patch} />;
    case "Select":
      return <SelectInspector node={node} onPatch={patch} />;
    case "Canvas":
      return <CanvasInspector node={node} onPatch={patch} />;
    case "RenderSpec":
      return <RenderSpecInspector node={node} onPatch={patch} />;
    default: {
      // Exhaustiveness — TS guarantees every variant is handled above.
      const _never: never = node;
      return (
        <div className="text-xs text-zinc-500">
          No inspector for: {String((_never as { type?: unknown }).type)}
        </div>
      );
    }
  }
}
