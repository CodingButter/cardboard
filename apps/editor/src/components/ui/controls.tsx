import React from "react";
import { cn } from "../../lib/cn";

/**
 * Form controls — Slider, ToggleSwitch, SegmentedControl.
 *
 * Grouped because they share a visual family (radio-ish small inputs
 * inside PropertyRows) and because none of them is large enough to
 * warrant its own file. See EDITOR_REDESIGN.md §4.1, §4.2, §4.19.
 */

/* -------------------------------------------------------------------- */
/* Slider — §4.1                                                         */
/* -------------------------------------------------------------------- */

export interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
  /** Inline value chip rendered to the right of the track. */
  valueLabel?: React.ReactNode;
  /** Outline chip (default) vs solid amber-tinted chip. */
  valueChipVariant?: "outline" | "solid";
  className?: string;
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  valueLabel,
  valueChipVariant = "outline",
  className,
}: SliderProps) {
  const pct =
    max === min ? 0 : Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  // Inline gradient on the track communicates "fill before the thumb"
  // without needing a second DOM element.
  const trackStyle: React.CSSProperties = {
    background: `linear-gradient(to right,
      var(--color-accent) 0%,
      var(--color-accent) ${pct}%,
      rgba(63, 63, 70, 0.6) ${pct}%,
      rgba(63, 63, 70, 0.6) 100%)`,
  };

  return (
    <div className={cn("flex items-center gap-3 min-w-0", className)}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={trackStyle}
        className={cn(
          "cb-slider flex-1 h-1 rounded-full appearance-none cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
      />
      {valueLabel !== undefined && (
        <span
          className={cn(
            "shrink-0 inline-flex items-center justify-center min-w-[44px]",
            "h-6 px-2 text-xs font-mono rounded-md tabular-nums",
            valueChipVariant === "outline"
              ? "border border-zinc-700 text-zinc-300 bg-transparent"
              : "bg-amber-500/10 text-amber-300 border border-amber-500/30",
          )}
        >
          {valueLabel}
        </span>
      )}
      {/* Slider thumb styling lives in a tiny <style> tag — the
          range-input pseudo-elements (::-webkit-slider-thumb,
          ::-moz-range-thumb) cannot be styled via Tailwind utilities
          and we want the same look across browsers. Scoped via the
          `cb-slider` class on the input. */}
      <style>{sliderThumbCSS}</style>
    </div>
  );
}

const sliderThumbCSS = `
.cb-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  background: oklch(0.74 0.18 65);
  box-shadow: 0 0 0 2px oklch(0.12 0 0), 0 0 0 3px oklch(0.74 0.18 65 / 0.4);
  cursor: grab;
  transition: transform 100ms ease-out;
}
.cb-slider::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.1); }
.cb-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 9999px;
  border: 2px solid oklch(0.12 0 0);
  background: oklch(0.74 0.18 65);
  cursor: grab;
}
.cb-slider:disabled::-webkit-slider-thumb { background: oklch(0.40 0 0); box-shadow: none; }
.cb-slider:disabled::-moz-range-thumb { background: oklch(0.40 0 0); }
`;

/* -------------------------------------------------------------------- */
/* ToggleSwitch — §4.2                                                   */
/* -------------------------------------------------------------------- */

export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /** sm = 28x16, md = 36x20. */
  size?: "sm" | "md";
  "aria-label": string;
  className?: string;
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  size = "md",
  "aria-label": ariaLabel,
  className,
}: ToggleSwitchProps) {
  const dims =
    size === "sm"
      ? { track: "w-7 h-4", thumb: "w-3 h-3", translate: "translate-x-3" }
      : { track: "w-9 h-5", thumb: "w-4 h-4", translate: "translate-x-4" };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex items-center rounded-full",
        "transition-colors duration-150 shrink-0",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-950",
        "disabled:cursor-not-allowed disabled:opacity-50",
        dims.track,
        checked ? "bg-amber-500" : "bg-zinc-700",
        className,
      )}
    >
      <span
        className={cn(
          "inline-block rounded-full bg-zinc-50 shadow",
          "transition-transform duration-150 will-change-transform",
          "ml-0.5",
          dims.thumb,
          checked ? dims.translate : "translate-x-0",
        )}
      />
    </button>
  );
}

/* -------------------------------------------------------------------- */
/* SegmentedControl — §4.19                                              */
/* -------------------------------------------------------------------- */

export interface SegmentedControlOption<T extends string> {
  id: T;
  label?: React.ReactNode;
  icon?: React.ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T | null;
  onChange: (next: T | null) => void;
  size?: "sm" | "md";
  /** If true, clicking the active segment clears the selection. */
  allowEmpty?: boolean;
  className?: string;
  "aria-label"?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  allowEmpty = false,
  className,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const sizeClasses =
    size === "sm" ? "h-7 text-xs px-2" : "h-9 text-sm px-3";
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center rounded-md border border-zinc-800 bg-zinc-950/60 p-0.5 gap-0.5",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              if (active && allowEmpty) onChange(null);
              else if (!active) onChange(opt.id);
            }}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 rounded-[5px] font-medium",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
              sizeClasses,
              active
                ? "bg-amber-500/10 text-amber-300 border border-amber-500/40"
                : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-transparent",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
