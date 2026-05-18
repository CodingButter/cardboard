import React from "react";

/**
 * MapCanvasOverlay — translucent floating HUD strip rendered INSIDE
 * `MapCanvasPanel`.
 *
 * Visual target: the canvas-overlay HUD called out in the
 * "Architecture decisions (2026-05-18)" subsection of
 * `docs/EDITOR_DESIGN_INVENTORY.md` §1.2. Replaces the earlier
 * `LayerLegendFloater` concept and absorbs the scene picker that used
 * to live in the topbar tab-context slot. The strip floats over the
 * canvas (it is NOT a dock panel) and groups:
 *
 *   - A scene-selector slot on the left (Wave 2: moves the
 *     `SceneTabContextPicker` DropdownMenu here).
 *   - Six layer-visibility toggle slots on the right:
 *     Layers / Walls / Floor / Ceiling / Entities / Lights.
 *
 * Wave 1 leaves all six slots as empty stub buttons so the styling
 * and structure are wired without behaviour.
 */
export function MapCanvasOverlay(): React.JSX.Element {
  return (
    <div
      data-overlay="map-canvas-overlay"
      className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-3 rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 backdrop-blur"
    >
      {/* Scene-selector slot (left) — Wave 2 mounts the picker here. */}
      <div data-slot="scene-selector" className="min-w-0 flex-1" />

      {/* Layer-visibility toggle slots (right). Six stub spots in
       *  fixed order — Wave 2 swaps these for real ToggleButtons. */}
      <div className="flex items-center gap-1">
        <div data-slot="layer-toggle" data-layer="layers" className="h-6 w-6" />
        <div data-slot="layer-toggle" data-layer="walls" className="h-6 w-6" />
        <div data-slot="layer-toggle" data-layer="floor" className="h-6 w-6" />
        <div
          data-slot="layer-toggle"
          data-layer="ceiling"
          className="h-6 w-6"
        />
        <div
          data-slot="layer-toggle"
          data-layer="entities"
          className="h-6 w-6"
        />
        <div data-slot="layer-toggle" data-layer="lights" className="h-6 w-6" />
      </div>
    </div>
  );
}

export default MapCanvasOverlay;
