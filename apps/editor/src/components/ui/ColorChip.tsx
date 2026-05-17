import React from "react";
import { cn } from "../../lib/cn";

/**
 * ColorChip — §4.6.
 *
 * Native-color-picker swatch with adjacent hex readout. Used by the
 * Entities inspector (Light color, Sprite tint) and ProjectSettings
 * (brand colour).
 */

export interface ColorChipProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** Square swatch (default) or circular. */
  shape?: "square" | "circle";
  className?: string;
}

export function ColorChip({
  value,
  onChange,
  disabled = false,
  shape = "square",
  className,
}: ColorChipProps) {
  const shapeClasses =
    shape === "circle" ? "rounded-full" : "rounded-sm";
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2 cursor-pointer",
        "rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5",
        "hover:border-zinc-600 transition-colors",
        "focus-within:ring-2 focus-within:ring-amber-400",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      <span
        className={cn(
          "relative inline-block w-5 h-5 border border-zinc-700 shrink-0",
          shapeClasses,
        )}
        style={{ background: value }}
      >
        <input
          type="color"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer disabled:cursor-not-allowed"
          aria-label="Choose color"
        />
      </span>
      <span className="text-xs font-mono uppercase text-zinc-200 select-text">
        {value}
      </span>
    </label>
  );
}
