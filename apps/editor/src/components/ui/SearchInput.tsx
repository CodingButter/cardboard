import React from "react";
import { cn } from "../../lib/cn";

/**
 * SearchInput — Phase 1 primitive.
 *
 * Text input with a leading magnifier icon and an optional trailing
 * clear button (shows when the value is non-empty). Used by every
 * left rail's "search items" affordance — Prefabs list, Components
 * library, Scripts file tree, Map tile palette, Animation clips,
 * Image Lab / Sound Lab node library, Assets browser.
 *
 * Mockups: most §1 mockups in `Editor Design/`.
 *
 * Surface classes consumed: `.input-search`.
 */

export interface SearchInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "type"
  > {
  value: string;
  onChange: (next: string) => void;
  /** Show an X clear button when the value is non-empty. Default true. */
  clearable?: boolean;
}

export const SearchInput = React.forwardRef<HTMLInputElement, SearchInputProps>(
  function SearchInput(
    { value, onChange, clearable = true, placeholder, className, disabled, ...rest },
    ref,
  ) {
    const showClear = clearable && !disabled && value.length > 0;
    return (
      <div className={cn("relative w-full", className)}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          ref={ref}
          type="search"
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "Search…"}
          onChange={(e) => onChange(e.target.value)}
          className={cn("input-search", showClear && "pr-8")}
          {...rest}
        />
        {showClear && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    );
  },
);
