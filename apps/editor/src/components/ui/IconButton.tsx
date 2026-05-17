import React from "react";
import { cn } from "../../lib/cn";

/**
 * IconButton — §4.9.
 *
 * Icon-only button. The `tooltip` prop is the accessible name AND the
 * hover hint. In R2 we use the browser-native `title` attribute; R5
 * polish swaps the wrapper for the `Tooltip` primitive.
 */

type IconButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface IconButtonProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "title"
  > {
  icon: React.ReactNode;
  tooltip: string;
  variant?: IconButtonVariant;
  /** sm = 32x32, md = 36x36. */
  size?: "sm" | "md";
}

const VARIANT_CLASSES: Record<IconButtonVariant, string> = {
  primary:
    "bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:bg-amber-500/50",
  secondary:
    "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700 disabled:opacity-60",
  ghost:
    "bg-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
  danger:
    "bg-red-600 text-white hover:bg-red-500 disabled:bg-red-600/50",
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { icon, tooltip, variant = "ghost", size = "sm", className, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        title={tooltip}
        aria-label={tooltip}
        className={cn(
          "inline-flex items-center justify-center rounded-md",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
          "disabled:cursor-not-allowed",
          size === "sm" ? "w-8 h-8" : "w-9 h-9",
          VARIANT_CLASSES[variant],
          className,
        )}
        {...rest}
      >
        <span className="inline-flex items-center justify-center w-4 h-4">
          {icon}
        </span>
      </button>
    );
  },
);
