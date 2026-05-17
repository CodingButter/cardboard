import React from "react";
import { cn } from "../../lib/cn";

/**
 * Toolbar — §4.23.
 *
 * Horizontal grouped controls separated by vertical rules. Used by
 * GridEditor (tool palette), AnimationEditor (clip toolbar) and the
 * Playtest action bar.
 */

export interface ToolbarGroup {
  id: string;
  children: React.ReactNode;
}

export interface ToolbarProps {
  groups: ReadonlyArray<ToolbarGroup>;
  /** Right-aligned tail group. */
  tail?: React.ReactNode;
  className?: string;
}

export function Toolbar({ groups, tail, className }: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 h-11 px-3 rounded-md",
        "border border-zinc-800 bg-zinc-950/60",
        className,
      )}
    >
      {groups.map((g, i) => (
        <React.Fragment key={g.id}>
          {i > 0 && (
            <span
              className="self-stretch w-px bg-zinc-800 my-1.5"
              aria-hidden="true"
            />
          )}
          <div className="flex items-center gap-1">{g.children}</div>
        </React.Fragment>
      ))}
      {tail && (
        <>
          <span className="flex-1" />
          <div className="flex items-center gap-1">{tail}</div>
        </>
      )}
    </div>
  );
}
