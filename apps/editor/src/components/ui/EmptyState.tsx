import React from "react";
import { cn } from "../../lib/cn";
import logoUrl from "../../assets/logo.png" with { type: "file" };

/**
 * EmptyState — §4.24.
 *
 * Centred placeholder for empty surfaces (no projects, no
 * animations, no scripts…). Layered visual:
 *
 *   - Background: faded cardboard hex logo (low opacity, behind).
 *   - Foreground: tab-specific Lucide-style glyph + heading + body
 *     + optional CTA.
 *
 * Per Q10 in EDITOR_REDESIGN.md §12 the optional `tutorial?: string`
 * prop is declared but a no-op for R2/R4 — the tutorial system
 * doesn't exist yet. R5 (or a later phase) can wire it.
 */

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional CTA — typically a Button or a pair of Buttons in a Fragment. */
  action?: React.ReactNode;
  /** Tutorial slug — reserved for future use, no-op in R2. */
  tutorial?: string;
  /** Override the background logo path. Defaults to the bundled
   *  cardboard hex. */
  logoSrc?: string;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  tutorial: _tutorial, // eslint-disable-line @typescript-eslint/no-unused-vars
  logoSrc = logoUrl,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center text-center",
        "px-6 py-12 min-h-[260px] w-full",
        className,
      )}
    >
      {/* Faded cardboard hex logo behind the content. */}
      <img
        src={logoSrc}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 m-auto w-44 h-44 object-contain opacity-[0.06] pointer-events-none select-none"
        draggable={false}
      />
      <div className="relative flex flex-col items-center gap-3 max-w-md">
        <div
          className={cn(
            "inline-flex items-center justify-center w-12 h-12 rounded-xl",
            "bg-zinc-900 border border-zinc-800 text-amber-400",
          )}
        >
          {icon}
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
          {description && (
            <p className="text-sm text-zinc-500 leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {action && <div className="mt-2 flex items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}
