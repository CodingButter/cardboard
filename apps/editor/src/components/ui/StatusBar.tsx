import React from "react";
import { cn } from "../../lib/cn";

/**
 * StatusBar — §4.12.
 *
 * Bottom-fixed strip (28-32px tall) with a mosaic of context-sensitive
 * sections. Each section is `[label] value`. The last section with
 * `align: "right"` floats to the right of the bar; everything else
 * stacks left-to-right separated by thin vertical rules.
 *
 * The shell (R3) drives this via `StatusBarContext` —
 * see `apps/editor/src/shell/StatusBarContext.tsx`. Views call
 * `useStatusBar()` to push their per-view sections.
 */

export interface StatusBarSection {
  id: string;
  label?: React.ReactNode;
  value: React.ReactNode;
  align?: "left" | "right";
}

export interface StatusBarProps {
  sections: ReadonlyArray<StatusBarSection>;
  className?: string;
}

export function StatusBar({ sections, className }: StatusBarProps) {
  const left = sections.filter((s) => s.align !== "right");
  const right = sections.filter((s) => s.align === "right");

  return (
    <footer
      className={cn(
        "flex items-stretch h-8 px-3 gap-0",
        "border-t border-zinc-800 bg-zinc-950/80 backdrop-blur",
        "text-xs text-zinc-400",
        className,
      )}
    >
      {left.map((s, i) => (
        <Section
          key={s.id}
          section={s}
          divider={i > 0}
        />
      ))}
      <div className="flex-1" />
      {right.map((s, i) => (
        <Section
          key={s.id}
          section={s}
          divider={i > 0 || left.length > 0}
        />
      ))}
    </footer>
  );
}

function Section({
  section,
  divider,
}: {
  section: StatusBarSection;
  divider: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 min-w-0",
        divider && "border-l border-zinc-800",
      )}
    >
      {section.label && (
        <span className="uppercase tracking-wider text-[10px] text-zinc-500 font-medium shrink-0">
          {section.label}
        </span>
      )}
      <span className="font-mono text-zinc-200 truncate">{section.value}</span>
    </div>
  );
}
