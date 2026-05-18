import React from "react";
import { cn } from "../../lib/cn";

/**
 * DockPanel — convenience wrapper for the body of a dockview panel.
 *
 * dockview already renders its own tab header (so there is no panel-
 * header to compose here — the title lives in the tab). DockPanel is
 * the container the *content* of a panel mounts into; it carries the
 * panel-surface background + scroll behavior + design-system padding
 * so every panel reads consistently regardless of who authored it.
 *
 * Use it inside the React component you register with `panels` on
 * `<DockShell/>`:
 *
 *   panels: {
 *     map:       (props) => <DockPanel><MapBody /></DockPanel>,
 *     inspector: (props) => <DockPanel scroll><InspectorBody /></DockPanel>,
 *   }
 */

export interface DockPanelProps {
  /** Whether the body should be vertically scrollable. Defaults to
   *  `true` — most editor panels overflow at narrow widths and want
   *  the standard amber scrollbar. Disable for self-managed canvases
   *  (the Map view's WebGL surface, for example) that own their own
   *  layout. */
  scroll?: boolean;
  /** Compact (no inner padding) — used by canvas-style panels that
   *  want edge-to-edge content. Default has `--gap-panel` padding to
   *  match the inspector cards in the design system. */
  padded?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export function DockPanel({
  scroll = true,
  padded = true,
  className,
  children,
}: DockPanelProps) {
  return (
    <div
      className={cn(
        "h-full w-full min-h-0 bg-(--color-bg-panel) text-zinc-100",
        scroll && "overflow-auto",
        padded && "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

export default DockPanel;
