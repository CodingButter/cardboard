import React from "react";
import { Construction } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * ProjectView — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/ProjectManagement.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.4 (Project)
 *
 * KEEP: the named `WorkflowMode` export — EditorShell imports it for
 * its tab-id → ProjectView prop typing. Wave A may collapse this once
 * the shell's call site is rewritten, but for the stub we preserve it.
 */

export type WorkflowMode = "scene" | "prefabs" | "scripts" | "assets" | "animation";

export interface ProjectViewProps {
  projectId: string;
  onBackHome: () => void;
  workflowMode?: WorkflowMode;
}

export function ProjectView(_props: ProjectViewProps): React.JSX.Element {
  return (
    <div className="h-full w-full p-6">
      <Card padded className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Project workflow — coming soon"
          description="This page is being rebuilt. Mockup: Editor Design/ProjectManagement.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.4"
        />
      </Card>
    </div>
  );
}

export default ProjectView;
