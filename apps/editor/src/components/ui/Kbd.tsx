import React from "react";
import { cn } from "../../lib/cn";

/**
 * Kbd — Phase 1 primitive.
 *
 * Inline keyboard-shortcut chip used in tooltips, menu shortcuts, log
 * lines, and the "Move Camera To Target" debug button. Accepts either
 * a single string ("⌘") or an array (`["⌘", "S"]`) — the array form
 * inserts thin separators between keys.
 *
 * Surface classes consumed: `.kbd`.
 */

export interface KbdProps {
  /** A single key label, or an ordered list of keys forming a chord. */
  children: React.ReactNode | ReadonlyArray<React.ReactNode>;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  if (Array.isArray(children)) {
    return (
      <span className={cn("inline-flex items-center gap-1", className)}>
        {children.map((key, i) => (
          <React.Fragment key={i}>
            <kbd className="kbd">{key}</kbd>
            {i < children.length - 1 && (
              <span aria-hidden="true" className="text-zinc-600 text-[10px]">+</span>
            )}
          </React.Fragment>
        ))}
      </span>
    );
  }
  return <kbd className={cn("kbd", className)}>{children}</kbd>;
}
