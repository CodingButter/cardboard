import React from "react";
import { cn } from "../../lib/cn";

/**
 * Textarea — Phase 1 primitive.
 *
 * Refined replacement for the legacy `Textarea` in `ui.tsx`. Built on
 * the `.input-textarea` design-system class. Used for component
 * descriptions, prefab notes, manifest description, free-form text in
 * inspectors.
 *
 * Mockups: Components.png (description field), ProjectSettings.png
 * (manifest description), Entities.png (component description fields).
 *
 * Surface classes consumed: `.input-textarea`.
 */

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Marks the textarea as invalid (red ring). */
  invalid?: boolean;
  /** Use a mono font for code/JSON entry. */
  mono?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, invalid, mono = false, rows = 4, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          "input-textarea",
          mono && "font-mono text-xs",
          invalid &&
            "border-red-500/60 focus:border-red-500 focus:ring-red-500/40",
          className,
        )}
        {...rest}
      />
    );
  },
);
