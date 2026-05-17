import React from "react";
import { cn } from "../../lib/cn";

/**
 * StatsBlock — §4.15.
 *
 * Compact label-above-value pair used in stats cards (Playtest's left
 * rail, HomeScreen recent-project numbers). Stack multiple StatsBlocks
 * inside a Card or a grid to compose a stats panel.
 */

export interface StatsBlockProps {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Trend indicator after the value (↑ / ↓ / −). */
  trend?: "up" | "down" | "flat";
  /** Override value tone. */
  emphasis?: "default" | "warn" | "error" | "success";
  /** Numeric values render in mono by default. */
  font?: "mono" | "sans";
  className?: string;
}

const EMPHASIS_CLASSES: Record<NonNullable<StatsBlockProps["emphasis"]>, string> = {
  default: "text-zinc-100",
  warn: "text-amber-300",
  error: "text-red-300",
  success: "text-emerald-300",
};

export function StatsBlock({
  label,
  value,
  trend,
  emphasis = "default",
  font = "mono",
  className,
}: StatsBlockProps) {
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
        {label}
      </div>
      <div
        className={cn(
          "text-xl leading-tight tabular-nums truncate",
          font === "mono" ? "font-mono" : "font-semibold",
          EMPHASIS_CLASSES[emphasis],
        )}
      >
        {value}
        {trend && (
          <span
            className={cn(
              "ml-1 text-sm",
              trend === "up" && "text-emerald-400",
              trend === "down" && "text-red-400",
              trend === "flat" && "text-zinc-500",
            )}
            aria-hidden="true"
          >
            {trend === "up" ? "↑" : trend === "down" ? "↓" : "−"}
          </span>
        )}
      </div>
    </div>
  );
}
