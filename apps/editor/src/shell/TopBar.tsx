import React from "react";
import { Play, Square, Upload, Save as SaveIcon, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/ui";
import { DropdownMenu } from "../components/ui/DropdownMenu";
import { IconButton } from "../components/ui/IconButton";
import logoUrl from "../assets/logo.png" with { type: "file" };
import type { TopBarScene, SaveState } from "../components/ui/TopBar";

/**
 * Shell TopBar — the chrome's top strip. ~64px tall.
 *
 * Layout L→R:
 *   1. Cardboard hex logo (28-32px) + "CARDBOARD" wordmark.
 *   2. Scene dropdown (current scene, only shown on Scene / Prefabs /
 *      Animation; hidden otherwise).
 *   3. Flex spacer.
 *   4. Playtest button (amber, prominent, currently disabled until
 *      R4h ships the in-editor Playtest view).
 *   5. Export button.
 *   6. Save button.
 *   7. Settings cog → opens EditorSettingsModal.
 *
 * Per Q3 (logo) we use the bundled hex logo image + wordmark. No red
 * plaque from the GPT mockups.
 *
 * Per the reversed Q9 (§12) the project dropdown is gone entirely —
 * the Home tab is the canonical project switcher; the TopBar no
 * longer surfaces project selection at all.
 *
 * The component used to live as a primitive in
 * `components/ui/TopBar.tsx`; R3 wraps it with shell-aware behaviour
 * (scene visibility, lucide icons) and lives here. The primitive
 * version is still exported for the StyleGuide.
 */

export interface ShellTopBarProps {
  sceneName: string;
  scenes: ReadonlyArray<TopBarScene>;
  onSelectScene: (path: string) => void;
  /** When false, the scene dropdown is hidden entirely. */
  showSceneDropdown: boolean;
  /** When true, the scene dropdown renders disabled (no project loaded
   *  or zero `scenes/*.json` assets). */
  sceneDropdownDisabled?: boolean;

  saveState: SaveState;
  onSave: () => void;
  /** When false the Save button renders disabled with a "Not available
   *  in this view." tooltip. Set by the shell based on whether the
   *  active view has registered a `save` handler via
   *  EditorActionsContext. Defaults to true for backwards-compat. */
  saveAvailable?: boolean;
  onExport: () => void;
  /** Mirror of `saveAvailable` for the Export button. */
  exportAvailable?: boolean;

  /** Playtest is wired but disabled in R3 — R4h provides the real
   *  in-editor playtest view + the wiring. */
  playtestDisabled?: boolean;
  /** R4h — true when Playtest mode is currently active. The button
   *  renders with a "Stop" affordance + amber-filled visual state to
   *  signal that a single click will exit playtest. */
  playtestActive?: boolean;
  onTogglePlaytest?: () => void;

  onOpenSettings: () => void;
  className?: string;
}

export function TopBar({
  sceneName,
  scenes,
  onSelectScene,
  showSceneDropdown,
  sceneDropdownDisabled = false,
  saveState,
  onSave,
  saveAvailable = true,
  onExport,
  exportAvailable = true,
  playtestDisabled = true,
  playtestActive = false,
  onTogglePlaytest,
  onOpenSettings,
  className,
}: ShellTopBarProps) {
  const NOT_AVAILABLE_HINT = "Not available in this view.";
  const currentSceneId =
    scenes.find((s) => s.label === sceneName || s.path === sceneName)?.path ??
    "";

  return (
    <header
      className={cn(
        "flex items-stretch h-16 px-5 gap-4 shrink-0",
        "border-b border-zinc-800 bg-zinc-950/80 backdrop-blur",
        className,
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <img
          src={logoUrl}
          alt="cardboard"
          width={32}
          height={32}
          className="w-8 h-8 object-contain"
          draggable={false}
        />
        <div className="leading-tight">
          <div className="text-lg font-black tracking-tight text-zinc-100">
            CARDBOARD
          </div>
          <div className="text-[10px] tracking-[0.25em] text-zinc-500 font-medium">
            EDITOR
          </div>
        </div>
      </div>

      <Separator />

      {/* Scene picker — only when the active tab cares about scenes. */}
      {showSceneDropdown && (
        <DropdownField
          label="SCENE"
          disabled={sceneDropdownDisabled || scenes.length === 0}
          tooltip={
            sceneDropdownDisabled
              ? "Open a project to pick a scene."
              : scenes.length === 0
                ? "This project has no scenes/*.json assets yet."
                : undefined
          }
        >
          <DropdownMenu
            trigger={
              <div className="flex items-center justify-between w-full h-9 px-3 border border-zinc-800 rounded-md bg-zinc-900/60 text-sm text-zinc-100">
                <span className="truncate">{sceneName || "—"}</span>
                <Chevron />
              </div>
            }
            value={currentSceneId}
            options={scenes.map((s) => ({ id: s.path, label: s.label }))}
            onChange={onSelectScene}
            disabled={sceneDropdownDisabled || scenes.length === 0}
            width={224}
          />
        </DropdownField>
      )}

      <div className="flex-1" />

      {/* Right-side actions */}
      <div className="flex items-center gap-2 shrink-0">
        <SaveBadge state={saveState} />
        <Button
          variant={playtestActive ? "danger" : "primary"}
          size="md"
          onClick={onTogglePlaytest}
          disabled={playtestDisabled}
          leadingIcon={
            playtestActive ? (
              <Square size={14} className="fill-current" />
            ) : (
              <Play size={14} className="fill-current" />
            )
          }
          className={cn(
            // When playtest is active, give the button a Stop-like
            // affordance: outlined red border + brighter focus ring
            // so it reads as "click to exit" rather than "click to
            // start". Falls back to the default primary (amber) when
            // inactive.
            playtestActive &&
              "bg-red-600 hover:bg-red-500 text-white border-red-500",
          )}
          title={
            playtestDisabled
              ? "Open a project to run Playtest."
              : playtestActive
                ? "Exit playtest (Esc)"
                : "Run the pack in an embedded playtest viewport"
          }
        >
          {playtestActive ? "Stop" : "Playtest"}
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={onExport}
          disabled={!exportAvailable}
          leadingIcon={<Upload size={14} />}
          className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
          title={
            exportAvailable ? "Export pack to .apg" : NOT_AVAILABLE_HINT
          }
        >
          Export
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={onSave}
          disabled={!saveAvailable}
          leadingIcon={<SaveIcon size={14} />}
          title={
            saveAvailable
              ? "Save the current edit (Ctrl/Cmd+S)"
              : NOT_AVAILABLE_HINT
          }
        >
          Save
        </Button>
        <IconButton
          icon={<Settings size={16} />}
          tooltip="Editor settings"
          onClick={onOpenSettings}
          size="md"
        />
      </div>
    </header>
  );
}

function Separator() {
  return (
    <span className="self-center w-px h-8 bg-zinc-800" aria-hidden="true" />
  );
}

function DropdownField({
  label,
  children,
  disabled,
  tooltip,
}: {
  label: string;
  children: React.ReactNode;
  disabled: boolean;
  tooltip?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-center gap-0.5 w-[224px] shrink-0",
        disabled && "opacity-60",
      )}
      title={tooltip}
    >
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500 font-semibold">
        {label}
      </div>
      {children}
    </div>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const map: Record<SaveState, { text: string; cls: string }> = {
    saved: { text: "Saved", cls: "text-emerald-400" },
    saving: { text: "Saving…", cls: "text-sky-300" },
    dirty: { text: "Unsaved", cls: "text-amber-300" },
    error: { text: "Save failed", cls: "text-red-300" },
  };
  const { text, cls } = map[state];
  return <span className={cn("text-xs mr-1", cls)}>{text}</span>;
}

function Chevron() {
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
