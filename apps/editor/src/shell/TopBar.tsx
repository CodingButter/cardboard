import React from "react";
import { Play, Square, Upload, Save as SaveIcon, Settings } from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/ui";
import { IconButton } from "../components/ui/IconButton";
import logoUrl from "../assets/logo.png" with { type: "file" };
import type { SaveState } from "../components/ui/TopBar";

/**
 * Shell TopBar — the chrome's top strip. ~64px tall.
 *
 * Layout L→R:
 *   1. Cardboard hex logo (28-32px) + "CARDBOARD" wordmark.
 *   2. Flex spacer — reserved for future contextual project meta
 *      (per the Map.png mockup the right side carries project-level
 *      info; we keep the region available without rendering anything
 *      until that surface is designed).
 *   3. Playtest button (amber, prominent).
 *   4. Export button.
 *   5. Save button.
 *   6. Settings cog → opens EditorSettingsModal.
 *
 * Per Q3 (logo) we use the bundled hex logo image + wordmark. No red
 * plaque from the GPT mockups.
 *
 * Per the reversed Q9 (§12) the project dropdown is gone — the Home
 * tab is the canonical project switcher.
 *
 * The Scene picker that used to sit between the brand and the action
 * buttons has been moved out of the TopBar entirely. It now renders
 * in the tab strip's per-tab contextual right slot (see
 * `lib/tabContextSlot.tsx`) and is registered by the Scene view
 * (MapView). When the user is on any other tab the slot is empty.
 *
 * The component used to live as a primitive in
 * `components/ui/TopBar.tsx`; R3 wraps it with shell-aware behaviour
 * (lucide icons + action wiring). The primitive version is still
 * exported for the StyleGuide.
 */

export interface ShellTopBarProps {
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

      {/* Flex spacer — the Scene picker that previously lived here is
          now in the tab strip's per-tab contextual right slot
          (lib/tabContextSlot.tsx). Future contextual project meta
          (per Map.png) can render in this region. */}
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
