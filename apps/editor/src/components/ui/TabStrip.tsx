import React from "react";
import { cn } from "../../lib/cn";

/**
 * TabStrip — §4.10.
 *
 * Two variants:
 *   - **primary**: icon + label, ~44px tall, amber underline + faint
 *     amber bg on active. Used as PrimaryTabs in the app shell.
 *   - **secondary**: label-only, ~34px tall, amber bottom border on
 *     active. Used by modal sub-tabs and the StatusConsole.
 */

export interface TabDescriptor<T extends string> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabStripProps<T extends string> {
  variant: "primary" | "secondary";
  tabs: ReadonlyArray<TabDescriptor<T>>;
  value: T;
  onChange: (next: T) => void;
  className?: string;
  "aria-label"?: string;
}

export function TabStrip<T extends string>({
  variant,
  tabs,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: TabStripProps<T>) {
  const containerClasses =
    variant === "primary"
      ? "flex items-stretch h-12 border-b border-zinc-800 bg-zinc-950/40"
      : "flex items-stretch h-9 border-b border-zinc-800";

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(containerClasses, className)}
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-disabled={tab.disabled}
            disabled={tab.disabled}
            onClick={() => !tab.disabled && onChange(tab.id)}
            className={cn(
              "relative inline-flex items-center gap-2 px-4 -mb-px",
              "transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-inset",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              variant === "primary"
                ? primaryTabClasses(active)
                : secondaryTabClasses(active),
            )}
          >
            {variant === "primary" && tab.icon && (
              <span className="inline-flex items-center justify-center w-4 h-4">
                {tab.icon}
              </span>
            )}
            <span
              className={
                variant === "primary"
                  ? "text-sm font-medium"
                  : "text-sm font-medium"
              }
            >
              {tab.label}
            </span>
            {tab.badge && <span className="ml-1">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

function primaryTabClasses(active: boolean): string {
  return active
    ? "text-amber-300 bg-amber-500/10 border-b-2 border-amber-400"
    : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60 border-b-2 border-transparent";
}

function secondaryTabClasses(active: boolean): string {
  return active
    ? "text-amber-300 border-b-2 border-amber-400"
    : "text-zinc-400 hover:text-zinc-100 border-b-2 border-transparent";
}
