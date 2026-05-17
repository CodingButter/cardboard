import React from "react";
import { cn } from "../../lib/cn";

/**
 * KeyValueList — §4.16.
 *
 * Table-like metadata display: small-caps label on the left,
 * mono-ish value on the right. Used in HomeScreen recent-project
 * cards, ProjectSettings dependency tab, Asset inspector.
 */

export interface KeyValueRow {
  label: React.ReactNode;
  value: React.ReactNode;
}

export interface KeyValueListProps {
  rows: ReadonlyArray<KeyValueRow>;
  /** `comfortable` (py-2) vs `dense` (py-1). Default comfortable. */
  density?: "comfortable" | "dense";
  /** Render bottom borders between rows. Default true. */
  divided?: boolean;
  className?: string;
}

export function KeyValueList({
  rows,
  density = "comfortable",
  divided = true,
  className,
}: KeyValueListProps) {
  const rowPad = density === "dense" ? "py-1" : "py-2";
  return (
    <dl className={cn("text-sm", className)}>
      {rows.map((row, i) => (
        <div
          key={i}
          className={cn(
            "grid grid-cols-[40%_1fr] gap-3 items-baseline",
            rowPad,
            divided && i !== rows.length - 1 && "border-b border-zinc-800/60",
          )}
        >
          <dt className="text-xs uppercase tracking-wider text-zinc-500 font-medium truncate">
            {row.label}
          </dt>
          <dd className="font-mono text-zinc-200 truncate text-right md:text-left">
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
