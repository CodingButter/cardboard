import React from "react";
import { Tooltip } from "../../../../apps/editor/src/components/ui/Tooltip";
import { useActiveScene } from "@cardboard/editor-shell";
import { MOCK_SCENE_SETTINGS } from "../../panels/scene-fixtures";

/**
 * SceneTopBarSlot — the per-tab right-slot content for the Scene view.
 *
 * Moved into the core-editor-pack as part of P4 (view-shell migration).
 * The component is presentational chrome; it reads the active scene
 * via the shell-SDK `useActiveScene` hook (singleton-bound) and the
 * remaining values from pack-local fixtures.
 *
 * Tooltip is bundled into the pack — it's pure presentational primitive
 * with no React Context / Zustand store dependency, so the pack-side
 * copy and the host-side copy are byte-equivalent.
 *
 * Wave 3 will swap the fixture cell count / dimensions for live
 * `EditorProjectStore` / Wave-3 store reads.
 */

/** Mock painted-cell count. Mirrors the fixture cells used by the
 *  MapCanvasPanel (~247 cells in the sample dungeon). */
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
