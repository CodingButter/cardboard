import React from "react";
import { cn } from "../../lib/cn";

/**
 * Breadcrumb — Phase 1 primitive.
 *
 * Hierarchical path display for nested asset / script paths (e.g.
 * `scripts / components / LightSource.js`). Used when Scripts' file
 * tabs feel cramped on long paths, and at the top of the Assets
 * inspector for selected-asset path display.
 *
 * Mockups: `Editor Design/Scripting.png`.
 *
 * Each segment can be clickable (links the user back up the tree) or
 * a plain label for the trailing entry.
 */

export interface BreadcrumbSegment {
  /** Display label for this segment. */
  label: React.ReactNode;
  /** Optional click handler — when omitted, the segment is plain text. */
  onClick?: () => void;
}

export interface BreadcrumbProps {
  segments: ReadonlyArray<BreadcrumbSegment>;
  /** Separator between segments. Default a chevron glyph. */
  separator?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
}

export function Breadcrumb({
  segments,
  separator,
  className,
  "aria-label": ariaLabel = "Breadcrumb",
}: BreadcrumbProps) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 min-w-0 text-xs text-zinc-400",
        className,
      )}
    >
      {segments.map((seg, i) => {
        const isLast = i === segments.length - 1;
        return (
          <React.Fragment key={i}>
            {seg.onClick && !isLast ? (
              <button
                type="button"
                onClick={seg.onClick}
                className="truncate hover:text-zinc-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 rounded"
              >
                {seg.label}
              </button>
            ) : (
              <span
                className={cn(
                  "truncate",
                  isLast ? "text-zinc-100 font-medium" : "text-zinc-500",
                )}
              >
                {seg.label}
              </span>
            )}
            {!isLast && (
              <span aria-hidden="true" className="text-zinc-600 shrink-0">
                {separator ?? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 18 6-6-6-6" />
                  </svg>
                )}
              </span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
