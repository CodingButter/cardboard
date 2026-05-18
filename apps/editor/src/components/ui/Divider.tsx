import React from "react";
import { cn } from "../../lib/cn";

/**
 * Divider — Phase 1 primitive.
 *
 * Refined replacement for the legacy `Separator` in `ui.tsx`. Adds a
 * vertical orientation, an `inset` variant (margin-trimmed for use
 * inside cards), and a `strong` variant for higher-contrast section
 * breaks.
 *
 * Mockups: every page (between rail sections, toolbar groups, card
 * stacks).
 *
 * Surface classes consumed: `.divider-h`, `.divider-v`,
 * `.divider-h--strong`.
 */

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical";
  /** Trim the start/end so the divider doesn't bleed past inset content. */
  inset?: boolean;
  /** Higher-contrast variant for stronger section breaks. */
  strong?: boolean;
}

export function Divider({
  orientation = "horizontal",
  inset = false,
  strong = false,
  className,
  role = "separator",
  ...rest
}: DividerProps) {
  if (orientation === "vertical") {
    return (
      <div
        role={role}
        aria-orientation="vertical"
        className={cn(
          "divider-v shrink-0",
          inset && "my-2",
          strong && "bg-zinc-700",
          className,
        )}
        {...rest}
      />
    );
  }
  return (
    <div
      role={role}
      aria-orientation="horizontal"
      className={cn(
        strong ? "divider-h--strong" : "divider-h",
        inset && "mx-3",
        className,
      )}
      {...rest}
    />
  );
}
