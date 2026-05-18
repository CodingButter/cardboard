import React from "react";
import { Construction } from "lucide-react";
import { Card } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { useTabContextSlot } from "../lib/tabContextSlot";
import { SceneTabContextPicker } from "./scene/SceneTabContextPicker";

/**
 * MapView — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    Editor Design/Map.png
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.2 (Scene)
 *
 * Tab-row contextual slot:
 *   The TopBar used to host a Scene picker between the brand and the
 *   action buttons. That picker has been moved to the tab strip's
 *   per-tab contextual right slot (see `lib/tabContextSlot.tsx`).
 *   MapView registers the Scene picker into that slot on mount; the
 *   hook's cleanup clears the slot when the view unmounts so other
 *   tabs (Prefabs, Components, etc.) see an empty slot until they
 *   register their own contextual content.
 *
 * Next dispatch: per-page Wave A (layout skeleton) + Wave B (page-local
 * components in parallel) + Wave C (wiring).
 */
export interface MapViewProps {
  /** Widened — Wave A will re-establish the real shape. */
  [key: string]: unknown;
}

export function MapView(_props: MapViewProps = {}): React.JSX.Element {
  // Stable reference — passing a new JSX element each render would
  // thrash the slot effect's deps. The picker reads everything it
  // needs from `<ActiveSceneProvider/>` via `useActiveScene()`, so a
  // single instance is fine.
  const picker = React.useMemo(() => <SceneTabContextPicker />, []);
  useTabContextSlot(picker);

  return (
    <div className="h-full w-full p-6">
      <Card padded className="h-full w-full flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Scene — coming soon"
          description="This page is being rebuilt. Mockup: Editor Design/Map.png · Inventory: docs/EDITOR_DESIGN_INVENTORY.md §1.2"
        />
      </Card>
    </div>
  );
}

export default MapView;
