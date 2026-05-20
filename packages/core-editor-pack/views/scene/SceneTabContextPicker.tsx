import React from "react";
// Bundled — presentational primitives with no singleton/context
// dependency. The pack-builder's `cardboard-react-externals` plugin
// rewrites `import React from "react"` so the React identity matches
// the host; everything else here is safe to bundle alongside the
// component.
import { DropdownMenu } from "../../../../apps/editor/src/components/ui/DropdownMenu";
import { Tooltip } from "../../../../apps/editor/src/components/ui/Tooltip";
// Externalised — `useActiveScene` reads the host's
// `<ActiveSceneProvider/>` React Context. A bundled duplicate would
// resolve to a default empty context and the picker would render
// disabled regardless of the actual scene list.
import { useActiveScene } from "@cardboard/editor-shell";

/**
 * SceneTabContextPicker — the dropdown that used to live in the
 * TopBar. It renders in the tab strip's per-tab right slot (see
 * `apps/editor/src/lib/tabContextSlot.tsx`) and is mounted by
 * `MapCanvasPanel` in the pack (see the `useTabContextSlot` call
 * around the canvas body).
 *
 * Reads `scenes`, `fallbackScene`, `activeScene`, and `setActiveScene`
 * from `<ActiveSceneProvider/>` so the component has no required props
 * — drop it into the slot and it picks the rest up from context.
 *
 * Visual:
 *   `[SCENE  | <scene-name>          ▾ ]`
 *
 * The label sits inline (rather than stacked above the trigger) so the
 * picker fits in the 48px tab strip height. When the project has no
 * scenes/*.json assets the dropdown disables itself rather than
 * vanishing — we want users to see "yes, this tab cares about scenes,
 * you just haven't added any" instead of silently dropping the
 * affordance.
 *
 * P5 moved the file out of `apps/editor/src/views/scene/` and into the
 * core-editor-pack alongside `MapCanvasPanel`, its only consumer. The
 * previous shell-SDK export was retired in the same pass.
 */
export function SceneTabContextPicker(): React.JSX.Element {
  const { activeScene, setActiveScene, scenes, fallbackScene } =
    useActiveScene();
  const resolvedScene = activeScene ?? fallbackScene;
  // Display the resolved label (scene.json's `name` field or
  // title-cased filename) rather than the raw `scenes/foo.json` path.
  // If `resolvedScene` isn't in the scenes list (e.g. a fallback path
  // that doesn't match an asset), fall back to the path itself with
  // the directory prefix stripped.
  const sceneOption = scenes.find((s) => s.path === resolvedScene) ?? null;
  const sceneName = sceneOption
    ? sceneOption.label
    : resolvedScene
      ? resolvedScene.replace(/^scenes\//, "")
      : "";
  const currentSceneId = sceneOption?.path ?? "";
  const disabled = scenes.length === 0;

  const tipShort = disabled ? "No scenes yet" : "Active scene";
  const tipLong = disabled
    ? "This project has no scenes/*.json assets yet. Add one from the Assets tab to populate this picker."
    : `Switch the scene tab's active scene. Currently showing ${sceneName || "—"}.`;
  return (
    <Tooltip
      stages={[
        { delay: 1000, content: <span>{tipShort}</span> },
        {
          delay: 3000,
          content: (
            <div>
              <div className="font-semibold">{tipShort}</div>
              <div className="text-[10px] text-(--color-fg-muted) mt-1 max-w-[400px] whitespace-normal">
                {tipLong}
              </div>
            </div>
          ),
        },
      ]}
    >
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
        Scene
      </span>
      <DropdownMenu
        trigger={
          <div
            className={
              "flex items-center justify-between w-[224px] h-8 px-3 " +
              "border border-zinc-800 rounded-md bg-zinc-900/60 text-sm " +
              "text-zinc-100 " +
              (disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer")
            }
          >
            <span className="truncate">{sceneName || "—"}</span>
            <Chevron />
          </div>
        }
        value={currentSceneId}
        options={scenes.map((s) => ({ id: s.path, label: s.label }))}
        onChange={setActiveScene}
        disabled={disabled}
        width={224}
      />
    </div>
    </Tooltip>
  );
}

function Chevron(): React.JSX.Element {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-zinc-400"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
