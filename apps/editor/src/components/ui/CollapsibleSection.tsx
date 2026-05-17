import React from "react";
import { cn } from "../../lib/cn";

/**
 * CollapsibleSection — §4.5.
 *
 * Expand/collapse section with a chevron + uppercase label. Used by
 * the Entities inspector to fold/unfold component sub-forms (Light,
 * Sprite, Movement…).
 *
 * Controlled or uncontrolled — pass `open`+`onOpenChange` for the
 * controlled mode, or `defaultOpen` for self-managed state.
 */

export interface CollapsibleSectionProps {
  title: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /** Optional element on the right (e.g. enable-toggle switch). */
  trailing?: React.ReactNode;
  /** Optional icon to the left of the title. */
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function CollapsibleSection({
  title,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  trailing,
  icon,
  children,
  className,
}: CollapsibleSectionProps) {
  const isControlled = openProp !== undefined;
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const open = isControlled ? (openProp as boolean) : internalOpen;

  const toggle = () => {
    if (isControlled) {
      onOpenChange?.(!open);
    } else {
      setInternalOpen((v) => {
        const next = !v;
        onOpenChange?.(next);
        return next;
      });
    }
  };

  return (
    <div
      className={cn(
        "border border-zinc-800 rounded-lg bg-zinc-950/40 overflow-hidden",
        className,
      )}
    >
      <div className="flex items-center justify-between h-9 pr-2">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className={cn(
            "flex-1 flex items-center gap-2 h-full px-3",
            "text-xs uppercase tracking-wider font-semibold text-zinc-300",
            "hover:text-zinc-100 transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
          )}
        >
          <Chevron open={open} />
          {icon && (
            <span className="text-zinc-400 inline-flex items-center">
              {icon}
            </span>
          )}
          <span className="truncate">{title}</span>
        </button>
        {trailing && (
          <div className="shrink-0 flex items-center">{trailing}</div>
        )}
      </div>
      {/* Max-height collapse trick — no animated layout, just a
          clipped overflow with a transition. R5 polish may revisit. */}
      <div
        className={cn(
          "transition-[grid-template-rows] duration-200 ease-out grid",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-3 py-2 border-t border-zinc-800/60">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 text-zinc-500 transition-transform duration-150",
        open ? "rotate-90" : "rotate-0",
      )}
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
