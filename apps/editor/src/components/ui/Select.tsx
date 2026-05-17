import React from "react";
import { cn } from "../../lib/cn";

/**
 * Select — §4.26.
 *
 * A styled native `<select>`. Cheaper than DropdownMenu and the right
 * choice for inspector PropertyRows where you just need
 * single-string-value form behaviour. Use DropdownMenu when you need
 * icons, disabled-options, or custom rendering.
 */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  options: ReadonlyArray<SelectOption>;
  size?: "sm" | "md";
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ options, size = "md", className, ...rest }, ref) {
    return (
      <div className={cn("relative inline-flex w-full", className)}>
        <select
          ref={ref}
          className={cn(
            "appearance-none w-full rounded-md border border-zinc-700 bg-zinc-950",
            "text-zinc-100 font-medium",
            "px-3 pr-8 leading-none",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
            "disabled:cursor-not-allowed disabled:opacity-60",
            size === "sm" ? "h-8 text-xs" : "h-9 text-sm",
          )}
          {...rest}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {/* `<option>` can't render arbitrary JSX — coerce to
                  string. Callers should pass strings. */}
              {String(opt.label)}
            </option>
          ))}
        </select>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    );
  },
);
