import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "@cardboard/editor-shell";

/**
 * ProjectView — Phase 2 stub (migrated into core-editor-pack at P5b).
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/ProjectManagement.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.4 (Project)
 *
 * The `WorkflowMode` type that used to live here moved to
 * `apps/editor/src/packs/shellEvents.ts` (the shell SDK) so any pack
 * shipping a multi-mode body view can type its prop the same way.
 */

export interface ProjectViewProps {
  /** Widened — kept for compatibility with the shell-side
   *  ViewComponent signature. Pack-shipped views read their needed
   *  state from shell-SDK hooks (`useRoute`, etc.). */
  [key: string]: unknown;
}

export function ProjectView(_props: ProjectViewProps = {}): React.JSX.Element {
  return (
    <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Project workflow — coming soon"
          description="This page is being rebuilt. Mockup: Editor Design/ProjectManagement.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.4"
        />
      </div>
  );
}

export default ProjectView;
