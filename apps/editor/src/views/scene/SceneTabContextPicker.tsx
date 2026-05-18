import React from "react";
import { DropdownMenu } from "../../components/ui/DropdownMenu";
import { useActiveScene } from "../../shell/ActiveSceneContext";

/**
 * SceneTabContextPicker — the dropdown that used to live in the
 * TopBar. It now renders in the tab strip's per-tab right slot (see
 * `lib/tabContextSlot.tsx`) and is registered by the Scene view.
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
 */
export function SceneTabContextPicker(): React.JSX.Element {
  const { activeScene, setActiveScene, scenes, fallbackScene } =
    useActiveScene();
  const resolvedScene = activeScene ?? fallbackScene;
  const sceneName = resolvedScene
    ? resolvedScene.replace(/^scenes\//, "")
    : "";
  const currentSceneId =
    scenes.find((s) => s.path === resolvedScene)?.path ?? "";
  const disabled = scenes.length === 0;

  return (
    <div
      className="flex items-center gap-2"
      title={
        disabled ? "This project has no scenes/*.json assets yet." : undefined
      }
    >
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
