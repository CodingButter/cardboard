import React from "react";
import { cn } from "../../lib/cn";

/**
 * Card — Phase 1 primitive.
 *
 * Bordered panel surface used as the wrapping element for inspector
 * blocks, gallery tiles, and floating dialogs. Built on the
 * design-system `.card-surface` / `.card-surface-elev` classes so
 * background + border treatments stay centralised.
 *
 * Mockups: every page. Stack `Card`s with `gap-4` in inspectors;
 * use the `elevated` prop for dropdown panels or floating tile
 * pickers that need to read above the surrounding rail surface.
 *
 * The legacy `ui.tsx (Card, CardHeader, CardTitle, …)` primitives
 * still exist for callers that haven't migrated. This refined `Card`
 * is the preferred entry point for new code.
 */

type CardElevation = "flat" | "elevated" | "inspector";

const SURFACE_CLASS: Record<CardElevation, string> = {
  flat: "card-surface",
  elevated: "card-surface-elev",
  inspector: "inspector-card",
};

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * - `flat` (default): card-surface, used as a plain inspector tile.
   * - `elevated`: card-surface-elev, sits above panel surfaces (dropdowns,
   *   floating tile headers).
   * - `inspector`: inspector-card surface that already includes its own
   *   p-4 padding — pass-through children without doubling padding.
   */
  elevation?: CardElevation;
  /** Adds the standard interior padding when elevation isn't `inspector`. */
  padded?: boolean;
}

export function Card({
  elevation = "flat",
  padded = false,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={cn(
        SURFACE_CLASS[elevation],
        padded && elevation !== "inspector" && "p-4",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Header strip for a Card. Mirrors the `.card-header` class. */
export function CardHeader({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("card-header", className)} {...rest}>
      {children}
    </div>
  );
}

/** Title rendered inside a CardHeader. */
export function CardTitle({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("card-title", className)} {...rest}>
      {children}
    </h3>
  );
}

/** Optional description rendered beneath a CardTitle. */
export function CardDescription({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("card-description", className)} {...rest}>
      {children}
    </p>
  );
}

/** Padded body region of a Card. */
export function CardContent({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-5 py-4", className)} {...rest}>
      {children}
    </div>
  );
}
