import React from "react";
import { Construction } from "lucide-react";
import { EmptyState } from "../components/ui/EmptyState";

/**
 * MapPalette — Phase 2 stub.
 *
 * The previous implementation was wiped 2026-05-18 to reset the
 * editor's view layer from a known foundation: design system (Phase 0)
 * + primitives (Phase 1) + shell + lib. Each page rebuilds from its
 * mockup in disciplined waves.
 */
export interface MapPaletteProps {
  /** Widened — Wave A will re-establish the real shape. */
  [key: string]: unknown;
}

export function MapPalette(
  _props: MapPaletteProps = {},
): React.JSX.Element {
  return (
    <div className="h-full w-full p-4 flex items-center justify-center">
      <EmptyState
        icon={<Construction size={28} />}
        title="Palette — coming soon"
        description="This component is being rebuilt as part of the Scene page."
      />
    </div>
  );
}

export default MapPalette;
