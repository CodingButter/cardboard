import React from "react";
import { cn } from "../../lib/cn";

/**
 * TextInput — Phase 1 primitive.
 *
 * Refined replacement for the legacy `Input` in `ui.tsx`. Built on the
 * `.input-text` design-system class so focus ring, placeholder colour,
 * and surface treatments live in the central stylesheet. Adds a
 * `prefix` / `suffix` slot (icons or chips inside the input frame),
 * matching the input rhythm shown in the Map / Scripts / Animation /
 * Project mockups.
 *
 * Mockups: every page with an inspector input.
 *
 * Surface classes consumed: `.input-text`.
 */

export interface TextInputProps
  extends Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "prefix" | "type"
  > {
  /** Slot rendered inside the input frame, before the text. */
  prefix?: React.ReactNode;
  /** Slot rendered inside the input frame, after the text. */
  suffix?: React.ReactNode;
  /** Marks the input as invalid (red ring). */
  invalid?: boolean;
  /** Defaults to "text". Restricted to plain text-like inputs;
   *  use `NumberInput` for numerics. */
  type?: "text" | "email" | "url" | "password" | "search" | "tel";
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput(
    { prefix, suffix, invalid, type = "text", className, ...rest },
    ref,
  ) {
    if (!prefix && !suffix) {
      return (
        <input
          ref={ref}
          type={type}
          className={cn(
            "input-text",
            invalid && "border-red-500/60 focus:border-red-500 focus:ring-red-500/40",
            className,
          )}
          {...rest}
        />
      );
    }
    // When a slot is present, wrap the input so we can position the
    // icon/chip absolutely without affecting the input's internal
    // layout. Padding is bumped to reserve space for the slot.
    return (
      <div className={cn("relative w-full", className)}>
        {prefix && (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none inline-flex items-center">
            {prefix}
          </span>
        )}
        <input
          ref={ref}
          type={type}
          className={cn(
            "input-text",
            prefix && "pl-8",
            suffix && "pr-8",
            invalid && "border-red-500/60 focus:border-red-500 focus:ring-red-500/40",
          )}
          {...rest}
        />
        {suffix && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 inline-flex items-center">
            {suffix}
          </span>
        )}
      </div>
    );
  },
);
