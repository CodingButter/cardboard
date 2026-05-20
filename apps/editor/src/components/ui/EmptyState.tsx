import React from "react";
import { Play } from "lucide-react";
import { cn } from "../../lib/cn";
import logoUrl from "../../assets/logo.png" with { type: "file" };
import {
  hasTutorial,
  isCompleted,
  startTutorial,
} from "../../tutorials/runtime";

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
 * prop is the launcher slug for the guided-tour system. Tutorial
 * system T1 (`docs/plans/TUTORIALS.md`) wires this prop:
 *
 *   - If `tutorial` is unset → no Start tutorial button.
 *   - If `tutorial` is set but no matching slug is registered → no
 *     Start tutorial button (R2 behaviour preserved).
 *   - If `tutorial` is set + registered + not yet completed/skipped →
 *     a secondary "▶ Start tutorial" button alongside the primary CTA.
 *   - If the tutorial has been completed or skipped → the button
 *     stays hidden (the user can re-run from the Help menu in T2).
 */

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Optional CTA — typically a Button or a pair of Buttons in a Fragment. */
  action?: React.ReactNode;
  /** Tutorial slug. When set + registered + not yet completed, the
   *  primitive renders a "▶ Start tutorial" launcher next to `action`. */
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
  tutorial,
  logoSrc = logoUrl,
  className,
}: EmptyStateProps): React.JSX.Element {
  const showTutorialButton =
    typeof tutorial === "string" &&
    tutorial.length > 0 &&
    hasTutorial(tutorial) &&
    !isCompleted(tutorial);
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
        {(action || showTutorialButton) && (
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {action}
            {showTutorialButton && (
              <button
                type="button"
                onClick={() => {
                  void startTutorial(tutorial!);
                }}
                data-tutorial-launcher={tutorial}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border border-amber-500/60",
                  "px-3 py-1.5 text-sm font-medium text-amber-300 hover:bg-amber-500/10",
                  "transition-colors",
                )}
              >
                <Play size={14} aria-hidden="true" />
                Start tutorial
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
