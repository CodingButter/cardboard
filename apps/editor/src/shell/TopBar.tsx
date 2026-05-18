import React from "react";
import {
  Play,
  Square,
  Upload,
  Save as SaveIcon,
  Settings as SettingsIcon,
  Check,
  Loader2,
  AlertCircle,
  CircleDot,
} from "lucide-react";
import { cn } from "../lib/cn";
import { Button } from "../components/ui";
import { UserAvatar } from "./UserAvatar";
import logoUrl from "../assets/logo.png" with { type: "file" };
import type { SaveState } from "../components/ui/TopBar";

/**
 * Shell TopBar — the chrome's top strip. ~64px tall.
 *
 * Layout L→R, calibrated to `Editor Design/Map.png`:
 *   1. Cube logo (40px) + "CARDBOARD / editor" wordmark (bold white +
 *      tracking-wide muted eyebrow).
 *   2. Flex spacer — reserved for contextual project meta.
 *   3. SaveStatusPill — subtle neutral pill with a leading status
 *      glyph (emerald check / sky spinner / amber dot / red alert).
 *   4. Action group: Playtest (amber primary), Export (outlined),
 *      Save (amber primary when saved, outlined when dirty), Settings
 *      (outlined text+icon button).
 *   5. UserAvatar — circular 32px chip with the user's initials.
 */

export interface ShellTopBarProps {
  saveState: SaveState;
  onSave: () => void;
  /** When false the Save button renders disabled with a "Not available
   *  in this view." tooltip. */
  saveAvailable?: boolean;
  onExport: () => void;
  exportAvailable?: boolean;

  playtestDisabled?: boolean;
  playtestActive?: boolean;
  onTogglePlaytest?: () => void;

  onOpenSettings: () => void;
  onOpenUserMenu?: () => void;
  /** Initials shown in the user avatar chip. Defaults to "JD" until
   *  the shell threads real account data through. */
  userInitials?: string;
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
  onOpenUserMenu,
  userInitials = "JD",
  className,
}: ShellTopBarProps) {
  const NOT_AVAILABLE_HINT = "Not available in this view.";

  return (
    <header
      className={cn(
        "flex items-center h-16 px-5 gap-4 shrink-0",
        "border-b border-(--color-border) bg-(--color-bg-app)",
        className,
      )}
    >
      {/* Brand */}
      <div className="flex items-center gap-3 shrink-0">
        <img
          src={logoUrl}
          alt="cardboard"
          width={40}
          height={40}
          className="w-10 h-10 object-contain drop-shadow-[0_0_8px_rgba(217,119,6,0.35)]"
          draggable={false}
        />
        <div className="flex flex-col">
          <div className="text-[19px] font-black tracking-tight text-zinc-50 leading-none">
            CARDBOARD
          </div>
          <div className="text-[10px] tracking-[0.32em] text-amber-500/70 font-medium uppercase leading-none -mt-px">
            editor
          </div>
        </div>
      </div>

      {/* Flex spacer — future contextual project meta lives here. */}
      <div className="flex-1" />

      {/* Right-side actions. Top-bar buttons run at h-7 (28px) — denser
          than the default .button-* h-9 to match the chrome rhythm of
          Map.png. */}
      <div className="flex items-center gap-3 shrink-0">
        <SaveStatusPill state={saveState} />

        {/* Outline buttons read as stroked chips against the near-black
            TopBar (no background fill, just a hairline border). Save is
            the only exception — it stays amber-filled as the primary
            action. Override the .button-secondary background here
            rather than minting a new variant because the stroked
            treatment only applies in the top bar. */}
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="md"
            onClick={onTogglePlaytest}
            disabled={playtestDisabled}
            leadingIcon={
              playtestActive ? (
                <Square size={12} />
              ) : (
                <Play size={12} />
              )
            }
            className={cn(
              "h-7 px-3 bg-transparent border-zinc-700 hover:bg-zinc-800/50",
              playtestActive &&
                "border-red-500/60 text-red-300 hover:bg-red-500/10",
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
            leadingIcon={<Upload size={12} />}
            className="h-7 px-3 bg-transparent border-zinc-700 hover:bg-zinc-800/50"
            title={
              exportAvailable ? "Export pack to .apg" : NOT_AVAILABLE_HINT
            }
          >
            Export
          </Button>
          <Button
            variant={saveState === "saved" ? "primary" : "secondary"}
            size="md"
            onClick={onSave}
            disabled={!saveAvailable}
            leadingIcon={
              saveState === "saved" ? (
                <Check size={12} />
              ) : (
                <SaveIcon size={12} />
              )
            }
            className={cn(
              "h-7 px-3",
              saveState === "dirty" &&
                "bg-transparent border-amber-500/40 text-amber-200 hover:bg-amber-500/10",
            )}
            title={
              saveAvailable
                ? "Save the current edit (Ctrl/Cmd+S)"
                : NOT_AVAILABLE_HINT
            }
          >
            Save
          </Button>
          <Button
            variant="secondary"
            size="md"
            onClick={onOpenSettings}
            leadingIcon={<SettingsIcon size={12} />}
            className="h-7 px-3 bg-transparent border-zinc-700 hover:bg-zinc-800/50"
            title="Editor settings"
          >
            Settings
          </Button>
        </div>

        {/* Hairline divider between the settings/actions cluster and
            the avatar. Matches the vertical divider in Map.png. */}
        <div
          aria-hidden="true"
          className="h-6 w-px bg-zinc-700/60"
        />

        <UserAvatar onOpenUserMenu={onOpenUserMenu} initials={userInitials} />
      </div>
    </header>
  );
}

/**
 * SaveStatusPill — subtle neutral pill with state-specific leading
 * glyph. Calibrated to Map.png: present but not loud — neutral surface
 * + neutral text + a single tinted glyph.
 */
function SaveStatusPill({ state }: { state: SaveState }) {
  const meta: Record<
    SaveState,
    {
      text: string;
      icon: React.ReactNode;
      iconClass: string;
    }
  > = {
    saved: {
      text: "All changes saved",
      icon: <Check size={12} strokeWidth={3} />,
      iconClass: "text-emerald-400",
    },
    saving: {
      text: "Saving…",
      icon: <Loader2 size={12} className="animate-spin" />,
      iconClass: "text-sky-400",
    },
    dirty: {
      text: "Unsaved changes",
      icon: <CircleDot size={12} />,
      iconClass: "text-amber-300",
    },
    error: {
      text: "Save failed",
      icon: <AlertCircle size={12} />,
      iconClass: "text-red-400",
    },
  };
  const m = meta[state];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5",
        "text-[12px] font-medium text-(--color-fg-secondary) whitespace-nowrap",
      )}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center w-3 h-3 shrink-0",
          m.iconClass,
        )}
      >
        {m.icon}
      </span>
      {m.text}
    </span>
  );
}
