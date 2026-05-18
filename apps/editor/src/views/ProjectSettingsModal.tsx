import React from "react";
import { Construction } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * ProjectSettingsModal — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/ProjectSettings.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.5
 *
 * Stub renders nothing while `open` is false so it can drop in as a
 * lazy-mounted modal slot once Wave A rebuilds it.
 */
export interface ProjectSettingsModalProps {
  open: boolean;
  onClose: () => void;
  /** Widened — Wave A will re-establish the real shape. */
  [key: string]: unknown;
}

export function ProjectSettingsModal({
  open,
  onClose,
}: ProjectSettingsModalProps): React.JSX.Element | null {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[min(640px,90vw)] max-h-[80vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <Card padded className="flex items-center justify-center">
          <EmptyState
            icon={<Construction size={28} />}
            title="Project settings — coming soon"
            description="This page is being rebuilt. Mockup: Editor Design/ProjectSettings.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.5"
          />
        </Card>
      </div>
    </div>
  );
}

export default ProjectSettingsModal;
