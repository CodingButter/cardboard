import React from "react";
import { cn } from "../../lib/cn";

/**
 * Modal — Phase 1 primitive.
 *
 * Refined replacement for the legacy `Modal` in `ui.tsx`. Built on the
 * design-system `.panel-surface-rounded` (frame) + `.panel-header`
 * (title band) classes so retunes live in the central stylesheet
 * rather than scattered across page-level dialogs.
 *
 * Features added over the legacy modal:
 *   - Esc key dismisses (suppressible via `dismissOnEsc={false}`).
 *   - Backdrop click dismisses (suppressible via `dismissOnBackdrop={false}`).
 *   - Width presets (sm | md | lg) so callers don't reinvent max-w-* per dialog.
 *   - Optional `description` slot below the title.
 *   - Title band uses `.panel-header` semantic class — small caps, tracking,
 *     consistent with every other panel header in the editor.
 *
 * The legacy `Modal` in `ui.tsx` is still in use (EditorSettingsModal +
 * HomeScreen's URL-import dialog before this refactor). New dialogs
 * should reach for this primitive instead.
 */

export type ModalWidth = "sm" | "md" | "lg" | "xl" | "2xl" | "3xl";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Title rendered in the header band. */
  title: React.ReactNode;
  /** Optional short description rendered under the title. */
  description?: React.ReactNode;
  /** Body content. */
  children: React.ReactNode;
  /** Optional footer slot — typically right-aligned action buttons. */
  footer?: React.ReactNode;
  /** Width preset; defaults to "md" (max-w-md). */
  width?: ModalWidth;
  /** If false, clicking the backdrop does NOT dismiss. Defaults to true. */
  dismissOnBackdrop?: boolean;
  /** If false, pressing Esc does NOT dismiss. Defaults to true. */
  dismissOnEsc?: boolean;
  /** Optional className appended to the modal frame. */
  className?: string;
}

const WIDTH_CLASS: Record<ModalWidth, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  "2xl": "max-w-4xl",
  "3xl": "max-w-6xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "md",
  dismissOnBackdrop = true,
  dismissOnEsc = true,
  className,
}: ModalProps) {
  const titleId = React.useId();
  // Esc-to-dismiss. Captured at the window so the listener works
  // regardless of where focus lives inside the modal.
  React.useEffect(() => {
    if (!open || !dismissOnEsc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, dismissOnEsc, onClose]);

  if (!open) return null;
  return (
    // z-[1000] sits above dockview's sash/drop overlays (z-index: 999 in
    // dockview-core's stylesheet). With z-50, hovering through the
    // backdrop activated dockview's yellow drag-handle on the layout
    // underneath. Don't lower this without verifying dockview's stack.
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={dismissOnBackdrop ? onClose : undefined}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "panel-surface-rounded w-full mx-4 flex flex-col",
          WIDTH_CLASS[width],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-6 py-5 border-b border-zinc-800">
          <div className="flex flex-col min-w-0">
            <h2
              id={titleId}
              className="text-xl font-bold text-white truncate leading-tight"
            >
              {title}
            </h2>
            {description ? (
              <span className="text-xs font-normal text-zinc-400 mt-1 truncate">
                {description}
              </span>
            ) : null}
          </div>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-zinc-800 px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
