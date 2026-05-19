import React from "react";
import { Check } from "lucide-react";
import { Tooltip } from "../../components/ui/Tooltip";
import { useActiveScene } from "../../shell/ActiveSceneContext";
import { MOCK_SCENE_SETTINGS } from "./scene-fixtures";

/**
 * SceneTopBarSlot — the per-tab right-slot content for the Scene view.
 *
 * Replaces the old SceneTabContextPicker that used to live in this slot.
 * The picker has been relocated under the MapCanvas (see
 * `MapCanvasPanel`), freeing up the top-bar slot for at-a-glance scene
 * context readouts — mirroring the design comp in `Editor Design/Map.png`.
 *
 * The readouts surface:
 *   - A small "All changes saved" pip (status indicator, green check).
 *   - The active scene's dimensions ("64 × 64") in tabular numerals.
 *   - The painted-cell count in the fixture scene ("247 cells"), which
 *     gives the user a sense of scene density without opening a panel.
 *
 * Why a separate component (not inline in MapView):
 *   - Keeps `MapView` short and the slot content easy to swap.
 *   - The component can read its own context — `useActiveScene` gives us
 *     the active scene name for the tooltip without prop drilling.
 *   - Wave 3 will wire the "saved" pip and cell-count to real stores;
 *     keeping this self-contained makes that a one-file change.
 *
 * Progressive tooltips:
 *   - Every readout pairs with a 2-stage Tooltip (label at 1s, full
 *     description at 3s) per the project-wide hover standard.
 */

/** Mock saved-state — Wave 3 wires this to the editor dirty-tracking
 *  store. For now we surface a steady "All changes saved" affordance
 *  so the slot reads as intended in the design comp. */
const MOCK_SAVED = true;

/** Mock painted-cell count. Mirrors the fixture cells used by the
 *  MapCanvasPanel (~247 cells in the sample dungeon). Wave 3 reads the
 *  real count from `EditorProjectStore.cells`. */
const MOCK_CELL_COUNT = 247;

export function SceneTopBarSlot(): React.JSX.Element {
  const { activeScene, fallbackScene, scenes } = useActiveScene();
  const resolvedScene = activeScene ?? fallbackScene;
  const sceneOption = scenes.find((s) => s.path === resolvedScene) ?? null;
  const sceneName = sceneOption
    ? sceneOption.label
    : resolvedScene
      ? resolvedScene.replace(/^scenes\//, "")
      : "—";

  const dims = MOCK_SCENE_SETTINGS.dimensions;
  const dimsLabel = `${dims.w} × ${dims.h}`;
  const cellLabel = `${MOCK_CELL_COUNT} cells`;

  const savedShort = MOCK_SAVED ? "All changes saved" : "Unsaved changes";
  const savedLong = MOCK_SAVED
    ? "The Scene tab has no pending changes. The dirty-state pip flips amber when an edit is unsaved."
    : "The Scene tab has unsaved changes. Save the project to clear this indicator.";

  const dimsShort = `${dimsLabel} cells`;
  const dimsLong = `Active scene dimensions — width × height in cells. Edit dimensions from the Scene Settings panel. Scene: ${sceneName}.`;

  const cellShort = `${cellLabel} painted`;
  const cellLong = `Number of painted cells across all layers in the active scene. Tracks how dense the scene is at a glance.`;

  return (
    <div
      className="flex items-center gap-3 px-2 text-[10px] text-(--color-fg-secondary)"
      data-slot="scene-top-bar"
      aria-label="Scene context readouts"
    >
      <Tooltip
        stages={[
          { delay: 1000, content: <span>{savedShort}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{savedShort}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {savedLong}
                </div>
              </div>
            ),
          },
        ]}
      >
        <span
          className="flex items-center gap-1"
          aria-label={savedShort}
          role="status"
        >
          <Check
            size={11}
            className={MOCK_SAVED ? "text-emerald-400" : "text-amber-400"}
            aria-hidden="true"
          />
          <span>{savedShort}</span>
        </span>
      </Tooltip>

      <span
        aria-hidden="true"
        className="text-(--color-border-strong) select-none"
      >
        ·
      </span>

      <Tooltip
        stages={[
          { delay: 1000, content: <span>{dimsShort}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{dimsShort}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {dimsLong}
                </div>
              </div>
            ),
          },
        ]}
      >
        <span
          className="font-mono tabular-nums text-(--color-fg-primary)"
          aria-label={dimsShort}
        >
          {dimsLabel}
        </span>
      </Tooltip>

      <span
        aria-hidden="true"
        className="text-(--color-border-strong) select-none"
      >
        ·
      </span>

      <Tooltip
        stages={[
          { delay: 1000, content: <span>{cellShort}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{cellShort}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {cellLong}
                </div>
              </div>
            ),
          },
        ]}
      >
        <span
          className="font-mono tabular-nums"
          aria-label={cellShort}
        >
          {cellLabel}
        </span>
      </Tooltip>
    </div>
  );
}

export default SceneTopBarSlot;
