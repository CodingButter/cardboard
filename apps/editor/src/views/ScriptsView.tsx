import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * ScriptsView — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/Scripting.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.6 (Scripts)
 *
 * The Monaco ambient typings in `scripts/modApiTypes.ts` survived the
 * wipe — they're foundational for whatever IDE surface Wave A picks.
 */
export interface ScriptsViewProps {
  projectId: string;
}

export function ScriptsView(_props: ScriptsViewProps): React.JSX.Element {
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
