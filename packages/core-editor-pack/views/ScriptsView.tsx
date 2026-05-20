import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "@cardboard/editor-shell";

/**
 * ScriptsView — Phase 2 stub (migrated into core-editor-pack at P5b).
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/Scripting.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.6 (Scripts)
 */
export interface ScriptsViewProps {
  /** Widened — kept for compatibility with the shell-side
   *  ViewComponent signature. */
  [key: string]: unknown;
}

export function ScriptsView(_props: ScriptsViewProps = {}): React.JSX.Element {
  return (
    <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Scripts — coming soon"
          description="This page is being rebuilt. Mockup: Editor Design/Scripting.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.6"
        />
      </div>
  );
}

export default ScriptsView;
