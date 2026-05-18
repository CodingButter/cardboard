/**
 * QuickToolsGrid — Scene page right-rail "Quick Tools" card body.
 *
 * Phase 2 Wave A stub: extracts the 2×2 secondary-button grid out of
 * `MapView.tsx` (mockup §7.2 card 4 — Fill / Replace / Erase / Clear).
 *
 * Wave B will land the real scene-mutation pipeline (layer-scoped
 * Fill-Area / Replace-Preset / Erase-Layer / Clear-Layer ops). For now
 * the component takes a single `onAction(kind)` callback so the parent
 * can log + WIRING-comment the follow-up in one place.
 *
 * Mockup: `Editor Design/Map.png` (right-rail card 4 — "QUICK TOOLS").
 */
import React from "react";
import { Button } from "../../components/ui/index";
import {
  PaintBucket,
  Replace as ReplaceIcon,
  Eraser as EraserIcon,
  Trash2,
} from "lucide-react";

export type QuickToolKind = "fill" | "replace" | "erase" | "clear";

export interface QuickToolsGridProps {
  onAction: (kind: QuickToolKind) => void;
}

export function QuickToolsGrid({ onAction }: QuickToolsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction("fill")}
        className="justify-start"
      >
        <PaintBucket size={12} className="mr-1.5" />
        Fill Area
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction("replace")}
        className="justify-start"
      >
        <ReplaceIcon size={12} className="mr-1.5" />
        Replace
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction("erase")}
        className="justify-start"
      >
        <EraserIcon size={12} className="mr-1.5" />
        Erase
      </Button>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => onAction("clear")}
        className="justify-start"
      >
        <Trash2 size={12} className="mr-1.5" />
        Clear
      </Button>
    </div>
  );
}
