import React from "react";
import { cn } from "../../lib/cn";

/**
 * PreviewFrame — Phase 1 primitive.
 *
 * Container for a live preview surface — typically an iframe, a canvas,
 * or a screenshot fallback. Owns the bordered + rounded chrome around
 * the surface. When `live` is true, the border picks up the emerald
 * accent (matches `LiveIndicator`).
 *
 * Mockups: `Editor Design/Map.png` (3D Preview), `Editor
 * Design/Entities.png` (live prefab preview), `Editor
 * Design/Scripting.png` (live test surface).
 *
 * Surface classes consumed: `.preview-frame`, `.preview-frame--live`.
 *
 * Distinct from the existing `PreviewHost` primitive — `PreviewHost`
 * owns iframe/canvas wiring and engine adapters, `PreviewFrame` is
 * the dumb visual wrapper anything can sit inside.
 */

export interface PreviewFrameProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Render the emerald "live" border accent. */
  live?: boolean;
  /** Optional overlay rendered above the preview content
   *  (e.g. a LIVE pill, FPS counter, control strip). */
  overlay?: React.ReactNode;
  /** Stretch the frame to fill its grid track. */
  fill?: boolean;
  children?: React.ReactNode;
}

export function PreviewFrame({
  live = false,
  overlay,
  fill = true,
  className,
  children,
  ...rest
}: PreviewFrameProps) {
  return (
    <div
      className={cn(
        "preview-frame",
        live && "preview-frame--live",
        fill && "w-full h-full",
        className,
      )}
      {...rest}
    >
      {children}
      {overlay && (
        <div className="absolute inset-0 pointer-events-none">{overlay}</div>
      )}
    </div>
  );
}
