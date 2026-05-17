import React from "react";
import { cn } from "../../lib/cn";

/**
 * ScrollArea — §4.22.
 *
 * Wraps `overflow: auto` so callers don't have to remember to inherit
 * the editor's amber-thumb scrollbar styling (already global in
 * `index.css`). Adds a bottom fade gradient when content overflows.
 *
 * Cheap — could be a className helper, but formalising it gives R4
 * a single named spot to add features (sticky-fade, perfect-scrollbar
 * shimming, etc.) later.
 */

export interface ScrollAreaProps {
  className?: string;
  axis?: "y" | "x" | "both";
  children: React.ReactNode;
  /** Render a fade gradient at the trailing edge when scrolled. */
  fade?: boolean;
}

export function ScrollArea({
  className,
  axis = "y",
  children,
  fade = true,
}: ScrollAreaProps) {
  const overflow =
    axis === "x" ? "overflow-x-auto overflow-y-hidden" :
    axis === "both" ? "overflow-auto" :
    "overflow-y-auto overflow-x-hidden";
  return (
    <div className={cn("relative min-h-0 min-w-0", className)}>
      <div className={cn("h-full w-full", overflow)}>
        {children}
      </div>
      {fade && axis !== "x" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-zinc-950/80 to-transparent"
        />
      )}
    </div>
  );
}
