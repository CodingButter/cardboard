import React from "react";
import { cn } from "../../lib/cn";

/**
 * PropertyRow — §4.3.
 *
 * The workhorse row for inspectors. Label on the left, control on the
 * right, optional unit chip after the control. Used by every inspector
 * panel in the redesigned editor.
 */

export interface PropertyRowProps {
  label: React.ReactNode;
  /** Uppercase tracking small caps (default) or sentence case. */
  labelStyle?: "small-caps" | "plain";
  /** Help text rendered beneath the label. */
  hint?: React.ReactNode;
  /** Right-hand control (Input, Slider, ToggleSwitch, Select…). */
  children: React.ReactNode;
  /** Unit/suffix chip rendered after the control. */
  unit?: React.ReactNode;
  /** Stack label above control (full-width) instead of 40/60 grid. */
  stacked?: boolean;
  className?: string;
}

export function PropertyRow({
  label,
  labelStyle = "small-caps",
  hint,
  children,
  unit,
  stacked = false,
  className,
}: PropertyRowProps) {
  const labelClasses = cn(
    "text-zinc-400",
    labelStyle === "small-caps"
      ? "text-[11px] uppercase tracking-wider font-medium"
      : "text-sm",
  );
  if (stacked) {
    return (
      <div className={cn("py-2 space-y-1.5", className)}>
        <div className="space-y-0.5">
          <div className={labelClasses}>{label}</div>
          {hint && (
            <div className="text-xs text-zinc-500 leading-snug">{hint}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">{children}</div>
          {unit && <UnitChip>{unit}</UnitChip>}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "py-2 grid grid-cols-[40%_1fr] items-center gap-3",
        className,
      )}
    >
      <div className="space-y-0.5 min-w-0">
        <div className={labelClasses}>{label}</div>
        {hint && (
          <div className="text-xs text-zinc-500 leading-snug">{hint}</div>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">{children}</div>
        {unit && <UnitChip>{unit}</UnitChip>}
      </div>
    </div>
  );
}

function UnitChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 text-[11px] font-mono uppercase tracking-wider text-zinc-500">
      {children}
    </span>
  );
}
