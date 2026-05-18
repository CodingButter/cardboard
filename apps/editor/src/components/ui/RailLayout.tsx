import React from "react";
import { cn } from "../../lib/cn";

/**
 * RailLayout primitives — Phase 1 layout helpers.
 *
 * Standard three-rail and two-rail body grammars used by every page in
 * the redesign per `EDITOR_REDESIGN.md §6.5`. The grid columns reference
 * the `--rail-left` / `--rail-right` CSS variables defined in
 * `apps/editor/index.css`, so retuning the rail widths centrally
 * propagates across pages.
 *
 * Mockups: `Editor Design/{Map,Entities,Components,Scripting,Animation,
 * ImageLab,SoundLab,UIDeisgner,GamePreview}.png` (3-pane);
 * `Editor Design/ProjectManagement.png` (3-pane + log strip).
 *
 * These are NOT semantic primitives in the inventory's Section 2 — they
 * formalise the grid-template shorthand documented there as a
 * "composition pattern, not a primitive". Pages can either use these
 * wrappers or write the grid inline.
 */

export interface ThreeRailLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Left rail (palette, library, file tree, …). */
  left: React.ReactNode;
  /** Right rail (inspector, preview, validation …). */
  right: React.ReactNode;
  /** Center body. */
  children: React.ReactNode;
  /** Optional bottom strip rendered full-width below the rails (LogPanel, status console). */
  bottom?: React.ReactNode;
  /** Optional top strip rendered full-width above the rails (Toolbar, breadcrumb). */
  top?: React.ReactNode;
}

/**
 * Three-rail body: `grid-cols-[var(--rail-left)_1fr_var(--rail-right)]`.
 * When `top` or `bottom` is provided, the rails sit between those rows.
 */
export function ThreeRailLayout({
  left,
  right,
  children,
  bottom,
  top,
  className,
  ...rest
}: ThreeRailLayoutProps) {
  return (
    <div className={cn("flex flex-col h-full min-h-0", className)} {...rest}>
      {top && <div className="shrink-0">{top}</div>}
      <div className="flex-1 min-h-0 grid grid-cols-[var(--rail-left)_1fr_var(--rail-right)]">
        <div className="min-h-0 min-w-0 border-r border-zinc-800 overflow-hidden">{left}</div>
        <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
        <div className="min-h-0 min-w-0 border-l border-zinc-800 overflow-hidden">{right}</div>
      </div>
      {bottom && <div className="shrink-0 border-t border-zinc-800">{bottom}</div>}
    </div>
  );
}

export interface TwoRailLayoutProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Side rail content. */
  rail: React.ReactNode;
  /** Main body. */
  children: React.ReactNode;
  /** Rail position. Default `left`. */
  side?: "left" | "right";
  /** Optional bottom strip. */
  bottom?: React.ReactNode;
  /** Optional top strip. */
  top?: React.ReactNode;
}

/**
 * Two-rail body: rail on one side, main body on the other. Default is
 * left rail (`grid-cols-[var(--rail-left)_1fr]`). When `side="right"`,
 * uses `grid-cols-[1fr_var(--rail-right)]`.
 */
export function TwoRailLayout({
  rail,
  children,
  side = "left",
  bottom,
  top,
  className,
  ...rest
}: TwoRailLayoutProps) {
  const grid =
    side === "left"
      ? "grid-cols-[var(--rail-left)_1fr]"
      : "grid-cols-[1fr_var(--rail-right)]";
  return (
    <div className={cn("flex flex-col h-full min-h-0", className)} {...rest}>
      {top && <div className="shrink-0">{top}</div>}
      <div className={cn("flex-1 min-h-0 grid", grid)}>
        {side === "left" ? (
          <>
            <div className="min-h-0 min-w-0 border-r border-zinc-800 overflow-hidden">{rail}</div>
            <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
          </>
        ) : (
          <>
            <div className="min-h-0 min-w-0 overflow-hidden">{children}</div>
            <div className="min-h-0 min-w-0 border-l border-zinc-800 overflow-hidden">{rail}</div>
          </>
        )}
      </div>
      {bottom && <div className="shrink-0 border-t border-zinc-800">{bottom}</div>}
    </div>
  );
}
