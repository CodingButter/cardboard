import React from "react";
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
 *   - The active scene's NAME (e.g. "level-01") — a quick orientation
 *     anchor for which scene the panels are bound to.
 *   - The active scene's dimensions ("64 × 64") in tabular numerals.
 *   - The painted-cell count in the fixture scene ("247 cells"), which
 *     gives the user a sense of scene density without opening a panel.
 *
 * NOTE: This slot previously rendered an "All changes saved" pip. That
 * indicator has been removed to avoid duplicating the SaveStatusPill
 * already shown in the shell TopBar (next to the Playtest/Save action
 * cluster). Save state is a global concern and lives in TopBar; this
 * slot is reserved for SCENE-scoped readouts only.
 *
 * Why a separate component (not inline in MapView):
 *   - Keeps `MapView` short and the slot content easy to swap.
 *   - The component can read its own context — `useActiveScene` gives us
 *     the active scene name for the tooltip without prop drilling.
 *   - Wave 3 will wire the cell-count and dimensions to real stores;
 *     keeping this self-contained makes that a one-file change.
 *
 * Progressive tooltips:
 *   - Every readout pairs with a 2-stage Tooltip (label at 1s, full
 *     description at 3s) per the project-wide hover standard.
 */

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
      : MOCK_SCENE_SETTINGS.name;

  const dims = MOCK_SCENE_SETTINGS.dimensions;
  const dimsLabel = `${dims.w} × ${dims.h}`;
  const cellLabel = `${MOCK_CELL_COUNT} cells`;

  const nameShort = `Scene: ${sceneName}`;
  const nameLong = `The scene currently bound to the editor panels. Switch scenes from the project tree or the Scene tab dropdown.`;

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
          { delay: 1000, content: <span>{nameShort}</span> },
          {
            delay: 3000,
            content: (
              <div>
                <div className="font-semibold">{nameShort}</div>
                <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                  {nameLong}
                </div>
              </div>
            ),
          },
        ]}
      >
        <span
          className="font-mono text-(--color-fg-primary) truncate max-w-[140px]"
          aria-label={nameShort}
        >
          {sceneName}
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
