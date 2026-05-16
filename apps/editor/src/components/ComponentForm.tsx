import React, { useEffect, useState } from "react";
import {
  findComponentSchema,
  type ComponentFieldSpec,
} from "../lib/componentSchemas";

/**
 * Schema-driven component form widget.
 *
 * Renders one component's editable form, falling back to a JSON
 * textarea for modder-defined components without a known schema.
 * Reused by `GridEditor` (cell/entity Inspector) and `EntitiesEditor`
 * (prefab authoring). EDITOR.md §6.3.
 */

/** RGB triple in [0,1] → `#rrggbb`. */
export function rgbToHex(rgb: ReadonlyArray<number>): string {
  const toByte = (v: number): string => {
    const clamped = Math.max(0, Math.min(1, v));
    const byte = Math.round(clamped * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${toByte(rgb[0] ?? 0)}${toByte(rgb[1] ?? 0)}${toByte(rgb[2] ?? 0)}`;
}

/** Parse a `#rrggbb` (or `#rgb`) string into an RGB triple in [0, 1]. */
export function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim();
  if (h.startsWith("#")) h = h.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
    return null;
  }
  return [r / 255, g / 255, b / 255];
}

/** RGB swatch + hex text input — feeds into `color3` schema fields. */
export function ColorPicker({
  value,
  onChange,
}: {
  value: ReadonlyArray<number>;
  onChange: (rgb: [number, number, number]) => void;
}) {
  const hex = rgbToHex(value);
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={hex}
        onChange={(e) => {
          const parsed = hexToRgb(e.target.value);
          if (parsed) onChange(parsed);
        }}
        className="h-7 w-9 rounded border border-zinc-700 bg-zinc-900 cursor-pointer"
      />
      <input
        type="text"
        value={hex}
        onChange={(e) => {
          const parsed = hexToRgb(e.target.value);
          if (parsed) onChange(parsed);
        }}
        className="flex-1 h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-mono"
      />
    </div>
  );
}

/** Numeric slider + bound number input. */
export function NumberSlider({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center gap-2">
      {min !== undefined && max !== undefined ? (
        <input
          type="range"
          min={min}
          max={max}
          step={step ?? 0.01}
          value={Number.isFinite(value) ? value : 0}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="flex-1 accent-amber-500"
        />
      ) : null}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step ?? 0.01}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        className="w-20 h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-mono"
      />
    </div>
  );
}

/**
 * One field on a component — dispatched by `field.kind`. Treated as a
 * dumb controlled input; the parent owns the data object.
 */
export function ComponentField({
  field,
  value,
  spriteIds,
  spriteFieldKey,
  onChange,
}: {
  field: ComponentFieldSpec;
  value: unknown;
  spriteIds?: ReadonlyArray<string>;
  spriteFieldKey: boolean;
  onChange: (next: unknown) => void;
}) {
  const label = field.label ?? field.key;
  switch (field.kind) {
    case "number": {
      const n = typeof value === "number" ? value : 0;
      return (
        <div>
          <div className="text-zinc-500 mb-1" title={field.hint}>
            {label}
          </div>
          <NumberSlider
            value={n}
            onChange={onChange}
            min={field.min}
            max={field.max}
            step={field.step}
          />
        </div>
      );
    }
    case "boolean":
      return (
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span className="text-zinc-300">{label}</span>
        </label>
      );
    case "color3":
      return (
        <div>
          <div className="text-zinc-500 mb-1">{label}</div>
          <ColorPicker
            value={
              Array.isArray(value) && value.length === 3
                ? (value as number[])
                : [1, 1, 1]
            }
            onChange={onChange}
          />
        </div>
      );
    case "string": {
      const s = typeof value === "string" ? value : "";
      if (spriteFieldKey && spriteIds && spriteIds.length > 0) {
        return (
          <div>
            <div className="text-zinc-500 mb-1" title={field.hint}>
              {label}
            </div>
            <select
              value={s}
              onChange={(e) => onChange(e.target.value)}
              className="w-full h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px]"
            >
              <option value="">(none)</option>
              {spriteIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        );
      }
      return (
        <div>
          <div className="text-zinc-500 mb-1" title={field.hint}>
            {label}
          </div>
          <input
            value={s}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.hint}
            className="w-full h-7 rounded border border-zinc-700 bg-zinc-900 px-2 text-[11px] font-mono"
          />
        </div>
      );
    }
    case "vec2": {
      const v = (value as { x?: number; y?: number }) ?? {};
      return (
        <div>
          <div className="text-zinc-500 mb-1">{label}</div>
          <div className="grid grid-cols-2 gap-2">
            <NumberSlider
              value={v.x ?? 0}
              onChange={(n) => onChange({ ...v, x: n })}
            />
            <NumberSlider
              value={v.y ?? 0}
              onChange={(n) => onChange({ ...v, y: n })}
            />
          </div>
        </div>
      );
    }
    case "vec3": {
      const v = (value as { x?: number; y?: number; z?: number }) ?? {};
      return (
        <div>
          <div className="text-zinc-500 mb-1">{label}</div>
          <div className="grid grid-cols-3 gap-2">
            <NumberSlider
              value={v.x ?? 0}
              onChange={(n) => onChange({ ...v, x: n })}
            />
            <NumberSlider
              value={v.y ?? 0}
              onChange={(n) => onChange({ ...v, y: n })}
            />
            <NumberSlider
              value={v.z ?? 0}
              onChange={(n) => onChange({ ...v, z: n })}
            />
          </div>
        </div>
      );
    }
  }
}

/** JSON-textarea fallback for unknown (modder-defined) components. */
export function JsonComponentEditor({
  data,
  onPatch,
}: {
  data: Record<string, unknown>;
  onPatch: (next: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(data, null, 2));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setText(JSON.stringify(data, null, 2));
    setError(null);
  }, [data]);
  return (
    <div className="space-y-1">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          try {
            const parsed = JSON.parse(text);
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
              setError("must be a JSON object");
              return;
            }
            setError(null);
            onPatch(parsed as Record<string, unknown>);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
        className="w-full min-h-[80px] rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-mono"
        spellCheck={false}
      />
      {error ? <div className="text-red-400 text-[10px]">{error}</div> : null}
    </div>
  );
}

/**
 * Render the editable sub-form for one component on an entity / prefab.
 * Known components use their schema; unknown components fall back to a
 * JSON textarea so modder-defined shapes are still editable.
 */
export function ComponentSubform({
  name,
  data,
  spriteIds,
  onPatch,
  onRemove,
}: {
  name: string;
  data: Record<string, unknown> | undefined;
  spriteIds?: ReadonlyArray<string>;
  onPatch: (next: Record<string, unknown>) => void;
  onRemove?: () => void;
}) {
  const schema = findComponentSchema(name);
  const safe = data ?? {};
  if (!schema) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="text-zinc-300 font-medium">
            {name}{" "}
            <span className="text-[10px] text-zinc-500">(JSON)</span>
          </div>
          {onRemove ? (
            <button
              onClick={onRemove}
              className="text-[10px] text-zinc-500 hover:text-red-400"
              title="Remove component"
            >
              ✕
            </button>
          ) : null}
        </div>
        <JsonComponentEditor data={safe} onPatch={onPatch} />
      </div>
    );
  }
  return (
    <div className="space-y-2 border border-zinc-800 rounded p-2 bg-zinc-950/40">
      <div className="flex items-center justify-between">
        <div className="text-zinc-300 font-medium">{name}</div>
        {onRemove ? (
          <button
            onClick={onRemove}
            className="text-[10px] text-zinc-500 hover:text-red-400"
            title="Remove component"
          >
            ✕
          </button>
        ) : null}
      </div>
      {schema.fields.map((field) => (
        <ComponentField
          key={field.key}
          field={field}
          value={safe[field.key]}
          spriteIds={spriteIds}
          spriteFieldKey={
            name === "Sprite" && field.key === "imageId" ? true : false
          }
          onChange={(v) => onPatch({ ...safe, [field.key]: v })}
        />
      ))}
    </div>
  );
}
