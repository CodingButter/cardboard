import React from "react";
import { cn } from "../../lib/cn";

/**
 * ProgressBar — §4.13.
 *
 * Amber fill over a zinc track. Used by Project build, light bakes,
 * asset imports. `indeterminate` renders an animated stripe band; the
 * `value` prop is ignored when indeterminate.
 */

export interface ProgressBarProps {
  /** 0..1. Clamped on render. */
  value: number;
  indeterminate?: boolean;
  size?: "sm" | "md";
  label?: React.ReactNode;
  /** Append a "% complete" or byte readout after the label row. */
  caption?: React.ReactNode;
  className?: string;
}

export function ProgressBar({
  value,
  indeterminate = false,
  size = "md",
  label,
  caption,
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  const trackHeight = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className={cn("w-full space-y-1", className)}>
      {(label || caption) && (
        <div className="flex items-center justify-between text-xs">
          {label && (
            <span className="uppercase tracking-wider text-zinc-400 font-medium">
              {label}
            </span>
          )}
          {caption && (
            <span className="font-mono text-zinc-400">{caption}</span>
          )}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : pct}
        className={cn(
          "w-full rounded-full bg-zinc-800 overflow-hidden",
          trackHeight,
        )}
      >
        {indeterminate ? (
          <div
            className={cn(
              "h-full w-1/3 rounded-full bg-amber-500",
              "cb-progress-indeterminate",
            )}
          />
        ) : (
          <div
            className="h-full rounded-full bg-amber-500 transition-[width] duration-200 ease-out"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <style>{`
        @keyframes cb-progress-slide {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(300%); }
        }
        .cb-progress-indeterminate { animation: cb-progress-slide 1.2s linear infinite; }
      `}</style>
    </div>
  );
}
