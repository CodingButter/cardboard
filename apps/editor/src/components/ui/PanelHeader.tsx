import React from "react";
import { cn } from "../../lib/cn";

/**
 * PanelHeader — §4.4.
 *
 * Section header inside a sidebar / panel: uppercase small-caps
 * label, optional trailing action (button, badge, search icon), thin
 * underline. Distinct from `CardHeader` which is for inspector cards.
 */

export interface PanelHeaderProps {
  title: React.ReactNode;
  /** Trailing slot: Badge count, "+ New" button, IconButton search. */
  action?: React.ReactNode;
  size?: "sm" | "md";
  className?: string;
}

export function PanelHeader({
  title,
  action,
  size = "md",
  className,
}: PanelHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b border-zinc-800",
        size === "sm" ? "h-8 px-3" : "h-10 px-4",
        className,
      )}
    >
      <div
        className={cn(
          "uppercase tracking-wider text-zinc-400 font-semibold truncate",
          size === "sm" ? "text-[10px]" : "text-xs",
        )}
      >
        {title}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}
