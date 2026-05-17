import React from "react";
import { cn } from "../../lib/cn";

/**
 * Badge — §4.7.
 *
 * Small inline status indicator with intent colour. The formal typed
 * primitive for what's already informally used throughout the
 * mockups (`Walls`, `Live`, `solid`, validation counts, etc.).
 */

export type BadgeVariant =
  | "amber"
  | "emerald"
  | "sky"
  | "red"
  | "purple"
  | "zinc"
  | "yellow";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  shape?: "rounded" | "pill";
  /** Border + transparent bg (default) vs solid filled. */
  outlined?: boolean;
  className?: string;
}

/** Variant → solid+outlined Tailwind class pair. */
const VARIANT_CLASSES: Record<
  BadgeVariant,
  { solid: string; outlined: string }
> = {
  amber: {
    solid: "bg-amber-500/20 text-amber-200 border border-amber-500/40",
    outlined: "border border-amber-500/40 text-amber-300 bg-transparent",
  },
  emerald: {
    solid: "bg-emerald-500/20 text-emerald-200 border border-emerald-500/40",
    outlined: "border border-emerald-500/40 text-emerald-300 bg-transparent",
  },
  sky: {
    solid: "bg-sky-500/20 text-sky-200 border border-sky-500/40",
    outlined: "border border-sky-500/40 text-sky-300 bg-transparent",
  },
  red: {
    solid: "bg-red-500/20 text-red-200 border border-red-500/40",
    outlined: "border border-red-500/40 text-red-300 bg-transparent",
  },
  purple: {
    solid: "bg-purple-500/20 text-purple-200 border border-purple-500/40",
    outlined: "border border-purple-500/40 text-purple-300 bg-transparent",
  },
  zinc: {
    solid: "bg-zinc-700/60 text-zinc-200 border border-zinc-700",
    outlined: "border border-zinc-700 text-zinc-300 bg-transparent",
  },
  yellow: {
    solid: "bg-yellow-500/20 text-yellow-100 border border-yellow-500/40",
    outlined: "border border-yellow-500/40 text-yellow-300 bg-transparent",
  },
};

export function Badge({
  children,
  variant = "zinc",
  shape = "rounded",
  outlined = false,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 h-5 text-[11px] font-medium leading-none",
        shape === "pill" ? "rounded-full" : "rounded",
        outlined ? VARIANT_CLASSES[variant].outlined : VARIANT_CLASSES[variant].solid,
        className,
      )}
    >
      {children}
    </span>
  );
}
