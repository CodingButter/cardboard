import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "@cardboard/editor-shell";

/**
 * AssetsView — Phase 2 stub (migrated into core-editor-pack at P5b).
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 *
 * Mockup:    (no dedicated mockup — rolled into Project tab or its own).
 * Inventory: docs/EDITOR_DESIGN_INVENTORY.md (asset browser TBD).
 *
 * The `SET_TAB_EVENT` + `SetTabEventDetail` symbols that used to live
 * here moved to `apps/editor/src/packs/shellEvents.ts` (the shell SDK)
 * during the P5b view migration — both are now imported by views via
 * `@cardboard/editor-shell` so any pack (not just core) can dispatch a
 * tab-switch.
 */

export interface AssetsViewProps {
  /** Widened — kept for compatibility with the shell-side
   *  ViewComponent signature. Pack-shipped views read their needed
   *  state from shell-SDK hooks (`useRoute`, etc.). */
  [key: string]: unknown;
}

export function AssetsView(_props: AssetsViewProps = {}): React.JSX.Element {
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
