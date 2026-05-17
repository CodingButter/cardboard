import React from "react";
import { cn } from "../../lib/cn";

/**
 * StatusPill — §4.8.
 *
 * Pill-shaped status with leading coloured dot. Larger than `Badge`,
 * intended for the TopBar ("All changes saved") and ProjectView
 * header (build state).
 */

export type StatusPillVariant = "ok" | "warn" | "error" | "info" | "neutral";

export interface StatusPillProps {
  variant: StatusPillVariant;
  children: React.ReactNode;
  /** Hide the leading coloured dot. */
  noDot?: boolean;
  className?: string;
}

const VARIANTS: Record<StatusPillVariant, { dot: string; text: string; border: string }> = {
  ok: {
    dot: "bg-emerald-500",
    text: "text-emerald-300",
    border: "border-emerald-500/30",
  },
  warn: {
    dot: "bg-yellow-400",
    text: "text-yellow-200",
    border: "border-yellow-500/30",
  },
  error: {
    dot: "bg-red-500",
    text: "text-red-300",
    border: "border-red-500/30",
  },
  info: {
    dot: "bg-sky-400",
    text: "text-sky-300",
    border: "border-sky-500/30",
  },
  neutral: {
    dot: "bg-zinc-500",
    text: "text-zinc-300",
    border: "border-zinc-700",
  },
};

export function StatusPill({
  variant,
  children,
  noDot = false,
  className,
}: StatusPillProps) {
  const v = VARIANTS[variant];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 h-7 px-3 rounded-full",
        "border bg-zinc-950/40 text-xs font-medium",
        v.border,
        v.text,
        className,
      )}
    >
      {!noDot && (
        <span
          className={cn(
            "inline-block w-2 h-2 rounded-full",
            v.dot,
            // Pulse the success dot subtly to feel "live".
            variant === "ok" && "shadow-[0_0_8px_currentColor]",
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
