import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * EditorViewport — Phase 2 stub.
 *
 * The previous iframe-game-runner host was wiped 2026-05-18 to reset
 * the editor's view layer from a known foundation: design system
 * (Phase 0) + primitives (Phase 1) + shell + lib. Each page rebuilds
 * from its mockup in disciplined waves.
 */
export interface EditorViewportProps {
  /** Widened — Wave A will re-establish the real shape. */
  [key: string]: unknown;
}

export function EditorViewport(
  _props: EditorViewportProps = {},
): React.JSX.Element {
  return (
    <div className="h-full w-full p-6 flex items-center justify-center">
        <EmptyState
          icon={<Construction size={28} />}
          title="Viewport — coming soon"
          description="The iframe game-runner host is being rebuilt as part of the Scene page."
        />
      </div>
  );
}

export default EditorViewport;
