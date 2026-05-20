import React from "react";
import { Blocks } from "lucide-react";
import { EmptyState } from "@cardboard/editor-shell";

/**
 * Components — Phase 2 stub (migrated into core-editor-pack at P5b).
 *
 * The Component Builder page where users will author manifest.components[]
 * schemas: component name + tags + property fields (type, default,
 * description). Sister to Prefabs (which attaches instances) but
 * conceptually distinct.
 *
 * Mockup:    Editor Design/Components.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1 (Component Builder)
 *
 * Next: Wave A page-layout agent + Wave B page-local components.
 */
export interface ComponentsViewProps {
  /** Widened — kept for compatibility with the shell-side
   *  ViewComponent signature. */
  [key: string]: unknown;
}

export function ComponentsView(_props: ComponentsViewProps = {}): React.JSX.Element {
  return (
    <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Blocks size={28} />}
          title="Components — coming soon"
          description="Mockup: Editor Design/Components.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1 (Component Builder)"
        />
      </div>
  );
}

export default ComponentsView;
