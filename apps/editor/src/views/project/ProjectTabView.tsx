import React from "react";
import { Construction } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";

/**
 * ProjectTabView — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * KEPT in place (rather than deleted with the rest of `views/project/`)
 * because EditorShell imports it directly for the Project tab. Once
 * Wave A wires the new Project page, this file may move/rename.
 *
 * Mockup:    Editor Design/ProjectManagement.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.4 (Project)
 */
export interface ProjectTabViewProps {
  projectId: string;
  onManifestChanged?: () => void;
}

export function ProjectTabView(
  _props: ProjectTabViewProps,
): React.JSX.Element {
  return (
    <div className="h-full w-full p-6">
      <Card padded className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Project — coming soon"
          description="This page is being rebuilt. Mockup: Editor Design/ProjectManagement.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.4"
        />
      </Card>
    </div>
  );
}

export default ProjectTabView;
