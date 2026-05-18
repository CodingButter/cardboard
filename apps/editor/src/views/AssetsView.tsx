import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";
import type { PrimaryTabId } from "../shell/PrimaryTabs";

/**
 * AssetsView — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    (no dedicated mockup — rolled into Project tab or its own).
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md (asset browser TBD).
 *
 * KEEP exports — EditorShell imports `SET_TAB_EVENT` + `SetTabEventDetail`
 * for the cross-tab navigation event bus. Those identifiers continue to
 * live here because the shell hasn't migrated yet.
 */

/* -------------------------------------------------------------------- */
/* Cross-tab navigation event                                            */
/* -------------------------------------------------------------------- */

export interface SetTabEventDetail {
  tab: PrimaryTabId;
  assetId?: string;
}
export const SET_TAB_EVENT = "cardboard:set-tab";

/* -------------------------------------------------------------------- */
/* Stub view                                                             */
/* -------------------------------------------------------------------- */

export interface AssetsViewProps {
  projectId: string;
}

export function AssetsView(_props: AssetsViewProps): React.JSX.Element {
  return (
    <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Assets — coming soon"
          description="This page is being rebuilt. Inventory: docs/EDITOR_DESIGN_INVENTORY.md (asset browser)."
        />
      </div>
  );
}

export default AssetsView;
