import React from "react";
import { Construction } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * AnimationEditor — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/Animation.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.7 (Animation)
 */
export interface AnimationEditorProps {
  /** Widened — Wave A will re-establish the real shape. */
  [key: string]: unknown;
}

export function AnimationEditor(
  _props: AnimationEditorProps = {},
): React.JSX.Element {
  return (
    <div className="h-full w-full p-6">
      <Card padded className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Animation — coming soon"
          description="This page is being rebuilt. Mockup: Editor Design/Animation.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.7"
        />
      </Card>
    </div>
  );
}

export default AnimationEditor;
