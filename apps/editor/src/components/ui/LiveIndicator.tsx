import React from "react";
import { cn } from "../../lib/cn";

/**
 * LiveIndicator — Phase 1 primitive.
 *
 * Emerald-pulsing LIVE pill used in the Scene 3D-Preview card header,
 * the Playtest overlay's action bar, and anywhere the editor signals
 * an active engine session.
 *
 * Mockups: `Editor Design/Map.png` (3D Preview card header),
 * `Editor Design/GamePreview.png` (top bar).
 *
 * Surface classes consumed: `.live-indicator` + `.live-indicator__dot`.
 */

export interface LiveIndicatorProps {
  /** When false, render the pill in a "paused/inactive" zinc tone. */
  active?: boolean;
  /** Override the label. Default "LIVE". */
  label?: React.ReactNode;
  className?: string;
}

export function LiveIndicator({
  active = true,
  label = "LIVE",
  className,
}: LiveIndicatorProps) {
  if (!active) {
    // Inactive variant — zinc surface with a dim, non-pulsing dot.
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 px-2 h-6 rounded",
          "bg-zinc-800/60 border border-zinc-700",
          "text-[11px] font-semibold uppercase tracking-wider text-zinc-400",
          className,
        )}
      >
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-zinc-500" />
        {label}
      </span>
    );
  }
  return (
    <span className={cn("live-indicator", className)}>
      <span className="live-indicator__dot" />
      {label}
    </span>
  );
}
