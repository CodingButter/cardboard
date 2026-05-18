import React from "react";
import { cn } from "../../lib/cn";

/**
 * TogglePill — Phase 1 primitive.
 *
 * Segmented-control variant rendered as a fully-rounded pill rather
 * than the squared `SegmentedControl`. Matches the TopBar's
 * Editor/Playtest mode toggle and similar boolean-ish two-state
 * pills throughout the editor.
 *
 * Mockups: `Editor Design/GamePreview.png` (Editor/Playtest TopBar
 * pill), `Editor Design/ProjectSettings.png` (footer Reload Running
 * Game toggle), `Editor Design/Animation.png` (loop mode pill).
 *
 * Surface classes consumed: `.toggle-pill`, `.toggle-pill__item`,
 * `.toggle-pill__item--active`.
 */

export interface TogglePillOption<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
}

export interface TogglePillProps<T extends string> {
  options: ReadonlyArray<TogglePillOption<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
  "aria-label"?: string;
}

export function TogglePill<T extends string>({
  options,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: TogglePillProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("toggle-pill", className)}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => !active && onChange(opt.id)}
            className={cn(
              "toggle-pill__item",
              active && "toggle-pill__item--active",
            )}
          >
            {opt.icon && (
              <span className="inline-flex items-center justify-center w-3.5 h-3.5">
                {opt.icon}
              </span>
            )}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
