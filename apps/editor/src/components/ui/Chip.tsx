import React from "react";
import { cn } from "../../lib/cn";

/**
 * Chip — Phase 1 primitive.
 *
 * Small pill, distinct from `Badge` in that chips usually carry a
 * leading icon and/or a trailing remove button. Used by tag inputs
 * (Entities tag bar, Components tag bar, prefab tag rows), filter
 * chips, and type-select rows.
 *
 * Mockups: `Editor Design/Entities.png` (tag bar), `Editor
 * Design/Components.png` (tag bar + filter chips).
 *
 * Surface classes consumed: `.chip` and its intent modifiers
 * (`.chip--accent`, `.chip--success`, …).
 */

export type ChipVariant =
  | "neutral"
  | "accent"
  | "success"
  | "info"
  | "warn"
  | "danger"
  | "special";

export interface ChipProps {
  children: React.ReactNode;
  /** Optional icon rendered before the label. */
  leadingIcon?: React.ReactNode;
  /** When set, render a trailing × button calling this on click. */
  onRemove?: () => void;
  variant?: ChipVariant;
  /** Render as a fully-rounded pill rather than a rounded rectangle. */
  pill?: boolean;
  /** Marks the chip as the selected member of a group. */
  selected?: boolean;
  /** Click-as-toggle support. When set, the chip renders as a button. */
  onClick?: () => void;
  className?: string;
}

const VARIANT_CLASS: Record<ChipVariant, string> = {
  neutral: "",
  accent: "chip--accent",
  success: "chip--success",
  info: "chip--info",
  warn: "chip--warn",
  danger: "chip--danger",
  special: "chip--special",
};

export function Chip({
  children,
  leadingIcon,
  onRemove,
  variant = "neutral",
  pill = false,
  selected = false,
  onClick,
  className,
}: ChipProps) {
  const content = (
    <>
      {leadingIcon && (
        <span className="inline-flex items-center justify-center w-3 h-3 shrink-0">
          {leadingIcon}
        </span>
      )}
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded-sm text-current/70 hover:text-current hover:bg-zinc-700/40"
        >
          <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </>
  );

  const baseClass = cn(
    "chip",
    pill && "chip--pill",
    VARIANT_CLASS[variant],
    selected && "ring-1 ring-amber-400/60",
    className,
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(baseClass, "transition-colors hover:brightness-110")}>
        {content}
      </button>
    );
  }
  return <span className={baseClass}>{content}</span>;
}
